import { NextResponse } from "next/server";
import OpenAI from "openai";
import pluginCatalog from "@/data/dawPlugins.json";
import type { PluginPreset } from "@/types/plugins";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decrementCredits } from "@/lib/profile";
import { saveAnalysis } from "@/lib/analysis";
import { extractMetrics, type Metrics } from "@/workers/metrics.worker";
import { transcribe15s } from "@/lib/transcription";
import { identifySong, type AudDSongMetadata } from "@/lib/audd";
import {
  assertDAWAllowed,
  assertQuotaAvailable,
  isPlanGateError,
  normalizeDawIdentifier,
  resolvePlanContext,
  type PlanContext,
} from "@/middleware/planGate";
import { dawIdToLabel } from "@/lib/daws";
import { getPluginProfile } from "@/lib/pluginProfile";
import {
  prettyPluginList,
  sanitizePluginSelection,
  getPluginBySlug,
} from "@/lib/pluginInventory";
import type { DawId } from "@/data/daws";

export const runtime = "nodejs";
const CLIP_SECONDS = 15;

type PluginDefinition = {
  name: string;
  type: string;
  description: string;
};

const catalog = pluginCatalog as Record<string, PluginDefinition[]>;

const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiClient = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

const ENABLE_TRANSCRIPTS = process.env.ENABLE_TRANSCRIPTS === "true";
const USE_NATIVE_AUDIO = process.env.USE_NATIVE_AUDIO === "true";

function secondsToTimestamp(value: number): string {
  if (!Number.isFinite(value)) {
    return "0:00";
  }
  const clamped = Math.max(0, value);
  const minutes = Math.floor(clamped / 60)
    .toString()
    .padStart(1, "0");
  const seconds = Math.floor(clamped % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatMetricValue(value: number | string): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Number.isFinite(value)) {
    return "null";
  }
  return Number(value).toFixed(2);
}

function buildSystemPrompt(
  daw: string,
  allowedPlugins: PluginDefinition[],
  premiumLine?: string | null,
  songLine?: string | null
): string {
  const pluginLines = allowedPlugins
    .map(
      (plugin) =>
        `- ${plugin.name} (${plugin.type}): ${plugin.description}`
    )
    .join("\n");

  return [
    `You are ChainGen, an elite mix engineer who crafts DAW-ready plugin chains for vocals in ${daw}.`,
    premiumLine ? premiumLine : null,
    songLine ? songLine : null,
    "Respond ONLY with valid JSON shaped as {\"summary\": string, \"plugins\": [{\"name\": string, \"type\": string, \"settings\": object, \"comment\": string}]}.",
    "Use realistic parameters, reference the provided metrics, and be explicit about tone, timing, and dynamics.",
    "Ground every statement in the supplied metrics or transcript. If genre, vibe, or vocal style is unclear, say it is unspecified—never guess or default to trap/rap.",
    "Stay within the following plugin catalog:",
    pluginLines || "- No plugins available; fall back to general advice.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserPrompt(params: {
  daw: string;
  metrics: Metrics | null;
  transcript: string | null;
  songContext?: string | null;
  premiumGuidance?: string | null;
}): string {
  const { daw, metrics, transcript, songContext, premiumGuidance } = params;
  const featureText = metrics
    ? [
        `tempo_bpm=${formatMetricValue(metrics.tempo_bpm)}`,
        `centroid_hz=${formatMetricValue(metrics.centroid_hz)}`,
        `mfcc_mean=${JSON.stringify(metrics.mfcc_mean)}`,
        `pitch_dev_cents=${formatMetricValue(metrics.pitch_dev_cents)}`,
        `rms_lufs=${formatMetricValue(metrics.rms_lufs)}`,
        `transient_density="${metrics.transient_density}"`,
      ].join(", ")
    : "tempo_bpm=null, centroid_hz=null, mfcc_mean=[], pitch_dev_cents=null, rms_lufs=null, transient_density=\"unknown\"";

  const transcriptLine = transcript
    ? `transcript_excerpt="${transcript}"`
    : "transcript_excerpt=\"\"";

  const guidanceLines = [premiumGuidance ?? null].filter(
    (line): line is string => Boolean(line)
  );

  return [
    `DAW = ${daw}`,
    `Features: ${featureText}`,
    transcriptLine,
    songContext ?? "Song context unknown.",
    ...guidanceLines,
    "Base the summary strictly on these inputs. Do not invent genres or vocal types; if the energy or style is unclear, say so explicitly.",
    "Return JSON only. No prose outside the JSON payload.",
  ].join("\n");
}

function normalizeSettings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== "string") continue;
    if (typeof value === "string") {
      result[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[key] = String(value);
    }
  }
  return result;
}

function normalizePlugins(
  raw: unknown,
  allowedPlugins: PluginDefinition[]
): PluginPreset[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const fallback = allowedPlugins[0] ?? {
    name: "Unknown Plugin",
    type: "Effect",
    description: "Fallback plugin when the expected catalog is missing.",
  };

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const nameRaw = typeof record.name === "string" ? record.name.trim() : "";
      const candidate =
        allowedPlugins.find(
          (plugin) => plugin.name.toLowerCase() === nameRaw.toLowerCase()
        ) ?? fallback;

      if (!candidate) {
        return null;
      }

      const type =
        typeof record.type === "string" && record.type.trim().length > 0
          ? record.type.trim()
          : candidate.type;

      const settings = normalizeSettings(record.settings);
      const comment =
        typeof record.comment === "string"
          ? record.comment
          : typeof record.summary === "string"
          ? record.summary
          : "";

      return {
        name: candidate.name,
        type,
        settings,
        comment,
      };
    })
    .filter((plugin): plugin is PluginPreset => plugin !== null)
    .slice(0, 12);
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json(
        {
          error:
            "Supabase configuration missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 500 }
      );
    }

    if (!openaiClient) {
      return NextResponse.json(
        { error: "OpenAI configuration missing." },
        { status: 500 }
      );
    }

    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authorization header missing." },
        { status: 401 }
      );
    }

    const accessToken = authorization.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 }
      );
    }

    let planContext: PlanContext;
    try {
      planContext = await resolvePlanContext(user.id);
      assertQuotaAvailable(planContext);
    } catch (error) {
      if (isPlanGateError(error)) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        { error: "Invalid multipart form payload." },
        { status: 400 }
      );
    }

    const skipSongDetection =
      typeof formData.get("skipSongDetection") === "string"
        ? formData.get("skipSongDetection") === "true"
        : false;

    const daw = formData.get("daw");
    if (typeof daw !== "string" || !daw.trim()) {
      return NextResponse.json(
        { error: "Missing DAW selection." },
        { status: 400 }
      );
    }

    const dawId = normalizeDawIdentifier(daw) as DawId;
    try {
      assertDAWAllowed(planContext.plan, dawId);
    } catch (error) {
      if (isPlanGateError(error)) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    const dawLabel = catalog[daw]
      ? daw
      : dawIdToLabel(dawId);

    let premiumPlugins: string[] = [];
    let usedProfile = false;

    if (planContext.plan.canUsePremiumInventory) {
      const profileRow = await getPluginProfile(user.id, dawId);
      if (profileRow && profileRow.plugins.length > 0) {
        premiumPlugins = sanitizePluginSelection(dawId, profileRow.plugins);
        usedProfile = premiumPlugins.length > 0;
      } else {
        const rawPremium = formData.get("premiumPlugins");
        if (typeof rawPremium === "string" && rawPremium.trim()) {
          try {
            const parsed = JSON.parse(rawPremium);
            if (Array.isArray(parsed)) {
              premiumPlugins = sanitizePluginSelection(
                dawId,
                parsed.filter((slug): slug is string => typeof slug === "string")
              );
            }
          } catch (error) {
            console.warn("premiumPlugins parse failed", error);
          }
        }
      }
    }

    const file = formData.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Audio file missing from request." },
        { status: 400 }
      );
    }
    const uploadedFile = file as File;
    const uploadedFileName =
      typeof uploadedFile?.name === "string" && uploadedFile.name.trim().length > 0
        ? uploadedFile.name
        : undefined;
    const uploadedFileType =
      typeof uploadedFile?.type === "string" && uploadedFile.type.trim().length > 0
        ? uploadedFile.type
        : undefined;

    const [startValue, endValue] = [formData.get("start"), formData.get("end")];
    const rawStart =
      typeof startValue === "string" ? Number.parseFloat(startValue) : 0;
    const rawEnd = typeof endValue === "string" ? Number.parseFloat(endValue) : 0;
    const clipStart = Number.isFinite(rawStart) ? Math.max(0, rawStart) : 0;
    const clipEnd = Number.isFinite(rawEnd)
      ? Math.max(clipStart, rawEnd)
      : clipStart + 15;
    const duration = Math.max(0, clipEnd - clipStart);
    const clipWindowLabel = `${secondsToTimestamp(clipStart)} \u2192 ${secondsToTimestamp(
      clipEnd
    )} (${secondsToTimestamp(Math.min(duration, CLIP_SECONDS))} of max ${secondsToTimestamp(
      CLIP_SECONDS
    )})`;

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    if (!fileBuffer.length) {
      return NextResponse.json(
        { error: "Uploaded audio is empty." },
        { status: 400 }
      );
    }

    let songMetadata: AudDSongMetadata | null = null;
    if (!skipSongDetection) {
      const recognition = await identifySong(fileBuffer);
      songMetadata =
        recognition && (recognition.score === null || recognition.score >= 0.4)
          ? recognition
          : null;
    }

    if (USE_NATIVE_AUDIO) {
      return NextResponse.json(
        {
          error:
            "Native audio mode is not yet available. Set USE_NATIVE_AUDIO=false to run hybrid analysis.",
        },
        { status: 501 }
      );
    }

    const metrics = await extractMetrics(fileBuffer, uploadedFileName);

    const transcript =
      ENABLE_TRANSCRIPTS && openaiApiKey
        ? await transcribe15s(fileBuffer, openaiApiKey, {
            fileName: uploadedFileName,
            mimeType: uploadedFileType,
          })
        : "";

    const basePlugins = catalog[dawLabel] ?? catalog[daw] ?? [];
    const premiumDetails = premiumPlugins
      .map((slug) => getPluginBySlug(slug))
      .filter(
        (plugin): plugin is NonNullable<ReturnType<typeof getPluginBySlug>> =>
          Boolean(plugin)
      );
    const premiumCatalogEntries = premiumDetails.map((plugin) => {
      const categories = Array.isArray(plugin.categories)
        ? plugin.categories
        : [];
      const inferredType =
        categories.find((category) =>
          ["compressor", "eq", "equalizer", "saturator", "reverb", "delay", "pitch", "vocal"].includes(
            category.toLowerCase()
          )
        ) ?? categories[0];
      const type =
        inferredType?.length && inferredType.trim()
          ? inferredType[0].toUpperCase() + inferredType.slice(1)
          : plugin.name.toLowerCase().includes("compressor")
          ? "Compressor"
          : plugin.name.toLowerCase().includes("eq")
          ? "Equalizer"
          : plugin.name.toLowerCase().includes("reverb")
          ? "Reverb"
          : plugin.name.toLowerCase().includes("delay")
          ? "Delay"
          : plugin.name.toLowerCase().includes("satur")
          ? "Saturation"
          : plugin.name.toLowerCase().includes("tune")
          ? "Pitch Correction"
          : "Plugin";
      const categorySummary =
        categories.length > 1
          ? ` (${categories.join(", ")})`
          : categories.length === 1
          ? ""
          : "";
      return {
        name: plugin.name,
        type,
        description: `${plugin.vendor} premium ${type.toLowerCase()}${categorySummary}.`,
      };
    });

    const allowedPlugins = [
      ...basePlugins,
      ...premiumCatalogEntries.filter(
        (entry) =>
          !basePlugins.some(
            (plugin) => plugin.name.toLowerCase() === entry.name.toLowerCase()
          )
      ),
    ];

    const premiumLine = premiumDetails.length
      ? (() => {
          const premiumNames = prettyPluginList(premiumPlugins);
          const pitchTools = premiumDetails
            .filter((plugin) => {
              const name = `${plugin.vendor} ${plugin.name}`.toLowerCase();
              const categories = Array.isArray(plugin.categories)
                ? plugin.categories.map((cat) => cat.toLowerCase())
                : [];
              return (
                name.includes("auto-tune") ||
                name.includes("autotune") ||
                name.includes("pitch") ||
                categories.includes("pitch")
              );
            })
            .map((plugin) => plugin.name);
          const pitchNote = pitchTools.length
            ? ` When pitch stability or tuning is required, lean on ${pitchTools.join(
                " or "
              )} for transparent correction.`
            : "";
          return `User owns these premium plugins for ${dawLabel}: ${premiumNames}. Always favor these premium tools over stock equivalents when they fit the task.${pitchNote}`;
        })()
      : null;
    const songLine = songMetadata
      ? [
          `Song Detected: "${songMetadata.title}" by ${songMetadata.artist}.`,
          songMetadata.album ? `Album: ${songMetadata.album}.` : null,
          songMetadata.releaseDate ? `Release Date: ${songMetadata.releaseDate}.` : null,
          songMetadata.timecode
            ? `AudD reported this section occurs around ${songMetadata.timecode} within the original track.`
            : null,
          `Uploaded clip window (actual audio analyzed): ${clipWindowLabel}. Use this window as the true reference even if external metadata differs.`,
          songMetadata.genres.length
            ? `Associated genres: ${songMetadata.genres.join(", ")}.`
            : null,
          "Focus on the vocal processing present around this clip window rather than generic artist defaults.",
        ]
          .filter(Boolean)
          .join("\n")
      : `Uploaded clip window (actual audio analyzed): ${clipWindowLabel}. Treat this as the reference range and do not assume a song or timecode beyond the provided metrics.`;
    const systemPrompt = buildSystemPrompt(
      dawLabel,
      allowedPlugins,
      premiumLine,
      songLine
    );
    const songContext = songMetadata
      ? `Snippet is from "${songMetadata.title}" by ${songMetadata.artist}${
          songMetadata.timecode ? ` (AudD timecode ${songMetadata.timecode})` : ""
        } (album: ${songMetadata.album ?? "unknown"}). Uploaded clip window analyzed: ${clipWindowLabel}. Ignore any global album timecodes and base conclusions strictly on this clip window.`
      : `Song context unknown. Uploaded clip window analyzed: ${clipWindowLabel}.`;
    const shouldHintPitchCorrection =
      metrics && typeof metrics.pitch_dev_cents === "number"
        ? Math.abs(metrics.pitch_dev_cents) >= 120
        : false;
    const premiumGuidance = premiumDetails.length
      ? [
          "Incorporate at least one of the premium plugins when it meaningfully improves the chain.",
          shouldHintPitchCorrection
            ? "Pitch deviation is high—apply premium pitch correction (for example Auto-Tune) to capture the reference vibe."
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : null;

    const userPrompt = buildUserPrompt({
      daw: dawLabel,
      metrics,
      transcript: transcript || null,
      songContext,
      premiumGuidance,
    });

    const response = await openaiClient.responses.create({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: userPrompt,
            },
          ],
        },
      ],
      text: { format: { type: "json_object" } },
    });

    const rawContent = response.output_text;
    if (!rawContent) {
      return NextResponse.json(
        { error: "Model returned no content." },
        { status: 502 }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (error) {
      console.error("analyze parse error", error, rawContent);
      return NextResponse.json(
        { error: "Model response was not valid JSON." },
        { status: 502 }
      );
    }

    const summary =
      typeof (parsed as { summary?: unknown }).summary === "string"
        ? (parsed as { summary: string }).summary.trim()
        : "";

    const plugins = normalizePlugins(
      (parsed as { plugins?: unknown }).plugins,
      allowedPlugins
    );

    let updatedProfile = planContext.profile;
    try {
      updatedProfile = await decrementCredits(user.id);
    } catch (error) {
      console.error("decrement credits failed", error);
    }

    const featuresPayload: Record<string, unknown> = {
      ...metrics,
      transcript_excerpt: transcript || null,
      premium_plugins: premiumPlugins,
      premium_profile_used: usedProfile,
      detected_song: songMetadata,
      song_detection_skipped: skipSongDetection,
    };

    try {
      await saveAnalysis({
        userId: user.id,
        daw: dawLabel,
        start: clipStart,
        end: clipEnd,
        duration,
        plugins,
        summary: summary || null,
        features: featuresPayload,
      });
    } catch (error) {
      console.warn("saveAnalysis failed", error);
    }

    console.info("analyze_telemetry", {
      user_id: user.id,
      daw: dawLabel,
      used_profile: usedProfile,
      premium_count: premiumPlugins.length,
      song_detected: Boolean(songMetadata),
      song_detection_skipped: skipSongDetection,
    });

    return NextResponse.json({
      daw: dawLabel,
      summary: summary || null,
      plugins,
      remainingCredits: updatedProfile.credits,
      usedAudio: true,
      features: featuresPayload,
      premiumProfileUsed: usedProfile,
      premiumPlugins,
      song: songMetadata,
    });
  } catch (error) {
    console.error("/api/analyze error", error);
    return NextResponse.json(
      {
        error: "Unable to analyze the audio clip. Please try again later.",
      },
      { status: 500 }
    );
  }
}
