import { NextResponse } from "next/server";
import {
  serializePreset,
  getExporterCoverage,
  type PluginChain,
  type PluginChainPlugin,
  type PluginIdentifierMap,
  type PluginParameter,
} from "@/exporters";
import { resolvePlanContext, assertFeature, isPlanGateError, normalizeDawIdentifier } from "@/middleware/planGate";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function normalizeIdentifierMap(raw: unknown): PluginIdentifierMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const map = Object.entries(raw).reduce<PluginIdentifierMap>((acc, [key, value]) => {
    if (typeof value === "string" && value.trim().length > 0) {
      acc[key as keyof PluginIdentifierMap] = value;
    }
    return acc;
  }, {});
  return Object.keys(map).length ? map : null;
}

function normalizeParameters(raw: unknown): PluginParameter[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const entries = raw
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const idRaw = record.id ?? record.parameter ?? record.name;
      if (typeof idRaw !== "string" || idRaw.trim().length === 0) {
        return null;
      }
      const valueRaw = record.value ?? record.current ?? record.default;
      if (typeof valueRaw !== "string" && typeof valueRaw !== "number" && typeof valueRaw !== "boolean") {
        return null;
      }
      const param: PluginParameter = {
        id: idRaw,
        value: typeof valueRaw === "string" ? valueRaw : String(valueRaw),
      };
      if (typeof record.label === "string" && record.label.trim().length > 0) {
        param.label = record.label;
      }
      if (typeof record.normalized === "number" && Number.isFinite(record.normalized)) {
        param.normalized = Number(record.normalized);
      }
      if (typeof record.min === "number" && Number.isFinite(record.min)) {
        param.min = Number(record.min);
      }
      if (typeof record.max === "number" && Number.isFinite(record.max)) {
        param.max = Number(record.max);
      }
      if (typeof record.step === "number" && Number.isFinite(record.step)) {
        param.step = Number(record.step);
      }
      if (typeof record.unit === "string" && record.unit.trim().length > 0) {
        param.unit = record.unit;
      }
      return param;
    })
    .filter((entry): entry is PluginParameter => entry !== null);

  return entries.length ? entries : null;
}

function normalizePlugins(raw: unknown): PluginChain["plugins"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "Unnamed Plugin";
      const type = typeof record.type === "string" ? record.type : "Unknown";
      const comment =
        typeof record.comment === "string"
          ? record.comment
          : typeof record.summary === "string"
          ? record.summary
          : null;
      const settings =
        record.settings && typeof record.settings === "object" && !Array.isArray(record.settings)
          ? Object.entries(record.settings).reduce<Record<string, string>>((acc, [key, value]) => {
              if (typeof key === "string" && (typeof value === "string" || typeof value === "number")) {
                acc[key] = String(value);
              }
              return acc;
            }, {})
          : {};
      const rawTags =
        Array.isArray(record.tags) && record.tags.every((tag) => typeof tag === "string")
          ? (record.tags as string[])
              .map((tag) => tag.trim())
              .filter((tag) => tag.length > 0)
          : [];

      const plugin: PluginChainPlugin = {
        name,
        type,
        comment,
        settings,
        vendor: typeof record.vendor === "string" ? record.vendor : null,
        category: typeof record.category === "string" ? record.category : null,
        identifiers: normalizeIdentifierMap(record.identifiers ?? null),
        parameters: normalizeParameters(record.parameters ?? null),
        bypassed: typeof record.bypassed === "boolean" ? record.bypassed : undefined,
        slotIndex:
          typeof record.slotIndex === "number" && Number.isFinite(record.slotIndex)
            ? Math.max(0, Math.floor(record.slotIndex))
            : typeof record.slot === "number" && Number.isFinite(record.slot)
            ? Math.max(0, Math.floor(record.slot))
            : undefined,
        tags: rawTags.length ? rawTags : null,
      };
      return plugin;
    })
    .filter((plugin): plugin is PluginChain["plugins"][number] => plugin !== null);
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: "Supabase configuration missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
        { status: 500 }
      );
    }

    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Authorization header missing." }, { status: 401 });
    }

    const accessToken = authorization.replace("Bearer ", "");
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (error || !user) {
      return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
    }

    let planContext;
    try {
      planContext = await resolvePlanContext(user.id);
      assertFeature(
        planContext.plan,
        "canExportPreset",
        "Exporting presets is available on paid plans. Upgrade to export chains."
      );
    } catch (gateError) {
      if (isPlanGateError(gateError)) {
        return NextResponse.json({ error: gateError.message }, { status: gateError.status });
      }
      throw gateError;
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
    }

    const daw = typeof (body as { daw?: unknown }).daw === "string" ? (body as { daw: string }).daw : null;
    if (!daw) {
      return NextResponse.json({ error: "Missing DAW identifier." }, { status: 400 });
    }

    const plugins = normalizePlugins((body as { plugins?: unknown }).plugins);
    if (!plugins.length) {
      return NextResponse.json(
        { error: "No plugins were provided. Run an analysis before exporting a preset." },
        { status: 400 }
      );
    }

    const summary =
      typeof (body as { summary?: unknown }).summary === "string"
        ? (body as { summary: string }).summary
        : null;
    const clipWindow =
      typeof (body as { clipWindow?: unknown }).clipWindow === "string"
        ? (body as { clipWindow: string }).clipWindow
        : null;
    const songRaw = (body as { song?: unknown }).song;
    const song =
      songRaw && typeof songRaw === "object"
        ? {
            title:
              typeof (songRaw as { title?: unknown }).title === "string"
                ? (songRaw as { title: string }).title
                : undefined,
            artist:
              typeof (songRaw as { artist?: unknown }).artist === "string"
                ? (songRaw as { artist: string }).artist
                : undefined,
            album:
              typeof (songRaw as { album?: unknown }).album === "string"
                ? (songRaw as { album: string }).album
                : null,
            timecode:
              typeof (songRaw as { timecode?: unknown }).timecode === "string"
                ? (songRaw as { timecode: string }).timecode
                : null,
          }
        : null;

    const dawId = normalizeDawIdentifier(daw);

    const chain: PluginChain = {
      daw,
      dawId,
      summary,
      clipWindow,
      song,
      plugins,
    };

    const preset = await serializePreset(chain);

    console.info("export_preset", {
      user_id: user.id,
      daw: chain.daw,
      daw_id: dawId,
      serializer: preset.serializerId,
      native: preset.isNative,
    });

    const coverage = getExporterCoverage(dawId);
    const binaryBody = new Uint8Array(preset.data);

    return new Response(binaryBody, {
      status: 200,
      headers: {
        "Content-Type": preset.mime,
        "Content-Disposition": `attachment; filename="${preset.filename}"`,
        "Cache-Control": "no-store",
        "X-ToneTerminal-Exporter": preset.serializerId,
        "X-ToneTerminal-Native": preset.isNative ? "true" : "false",
        "X-ToneTerminal-Format": preset.mime,
        "X-ToneTerminal-Target": coverage.nativeFormat ?? "manual",
      },
    });
  } catch (error) {
    console.error("/api/export-preset error", error);
    return NextResponse.json(
      { error: "Unable to export preset. Please try again later." },
      { status: 500 }
    );
  }
}
