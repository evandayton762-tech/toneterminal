import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  PlanGateError,
  assertFeature,
  isPlanGateError,
  resolvePlanContext,
} from "@/middleware/planGate";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      {
        error:
          "Supabase configuration missing on server. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      },
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
    error: authError,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  try {
    const context = await resolvePlanContext(user.id);
    assertFeature(
      context.plan,
      "canAccessLibrary",
      "Upgrade your plan to save chains to your library."
    );
  } catch (error) {
    if (isPlanGateError(error)) {
      return NextResponse.json({ error: error.message }, { status: (error as PlanGateError).status });
    }
    throw error;
  }

  const {
    daw,
    clipStart,
    clipEnd,
    duration,
    plugins,
    tags,
    favorite,
    summary,
    features,
    folderId,
  } = payload;

  if (typeof daw !== "string" || !Array.isArray(plugins)) {
    return NextResponse.json({ error: "Missing or invalid preset data." }, { status: 400 });
  }

  const normalizedTags = Array.isArray(tags) ? tags : [];
  const favoriteFlag = Boolean(favorite);

  const insertPayload: Record<string, unknown> = {
    user_id: user.id,
    daw,
    clip_start: Number(clipStart) || 0,
    clip_end: Number(clipEnd) || 0,
    duration: Number(duration) || 0,
    plugins,
    tags: normalizedTags,
    favorite: favoriteFlag,
  };

  if (typeof folderId === "string" && folderId.trim().length > 0) {
    insertPayload.folder_id = folderId.trim();
  } else if (folderId === null) {
    insertPayload.folder_id = null;
  }

  const normalizedSummary =
    typeof summary === "string" && summary.trim().length > 0
      ? summary.trim()
      : null;

  if (normalizedSummary !== null) {
    insertPayload.summary = normalizedSummary;
  } else if (summary === null) {
    insertPayload.summary = null;
  }

  const featuresPayload = isRecord(features)
    ? { ...features }
    : features === null
    ? null
    : undefined;

  if (featuresPayload !== undefined) {
    let featuresToStore: Record<string, unknown> | null;

    if (featuresPayload && normalizedSummary) {
      featuresToStore = {
        ...featuresPayload,
        ai_summary: normalizedSummary,
      };
    } else if (featuresPayload && !normalizedSummary) {
      const copy: Record<string, unknown> = { ...featuresPayload };
      const candidate = copy["ai_summary"];
      if (typeof candidate !== "string" || !candidate.trim()) {
        delete copy["ai_summary"];
      }
      featuresToStore = copy;
    } else if (!featuresPayload && normalizedSummary) {
      featuresToStore = { ai_summary: normalizedSummary };
    } else {
      featuresToStore = featuresPayload;
    }

    insertPayload.features = featuresToStore;
  } else if (normalizedSummary) {
    insertPayload.features = { ai_summary: normalizedSummary };
  }

  let { error } = await supabaseAdmin
    .from("analysis_presets")
    .insert(insertPayload);

  const missingColumn =
    error?.message &&
    /does not exist|'?(tags|favorite|summary|features)'?/.test(
      error.message.toLowerCase()
    );

  if (missingColumn) {
    const fallbackPayload = {
      ...insertPayload,
    };
    delete (fallbackPayload as { tags?: unknown }).tags;
    delete (fallbackPayload as { favorite?: unknown }).favorite;
    delete (fallbackPayload as { summary?: unknown }).summary;
    delete (fallbackPayload as { features?: unknown }).features;
    const fallback = await supabaseAdmin
      .from("analysis_presets")
      .insert(fallbackPayload);
    error = fallback.error;
  }

  if (error) {
    return NextResponse.json(
      { error: `Unable to save preset: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
