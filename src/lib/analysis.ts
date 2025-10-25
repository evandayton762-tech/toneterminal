import type { PluginPreset } from "@/types/plugins";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type AnalysisRecord = {
  id: string;
  user_id: string;
  daw: string;
  clip_start: number;
  clip_end: number;
  duration: number;
  plugins: PluginPreset[];
  summary?: string | null;
  features?: Record<string, unknown> | null;
  created_at: string;
};

export async function saveAnalysis(params: {
  userId: string;
  daw: string;
  start: number;
  end: number;
  duration: number;
  plugins: PluginPreset[];
  summary?: string | null;
  features?: Record<string, unknown> | null;
}) {
  if (!supabaseAdmin) {
    return;
  }

  const { userId, daw, start, end, duration, plugins, summary, features } =
    params;

  const payload: Record<string, unknown> = {
    user_id: userId,
    daw,
    clip_start: start,
    clip_end: end,
    duration,
    plugins,
  };

  if (typeof summary === "string") {
    payload.summary = summary;
  } else if (summary === null) {
    payload.summary = null;
  }

  if (features !== undefined) {
    payload.features = features;
  }

  let { error } = await supabaseAdmin
    .from("analyses")
    .insert(payload);

  const missingColumn =
    error?.message &&
    /summary|features/.test(error.message.toLowerCase());

  if (missingColumn) {
    const fallbackPayload = { ...payload };
    delete (fallbackPayload as { summary?: unknown }).summary;
    delete (fallbackPayload as { features?: unknown }).features;
    const fallback = await supabaseAdmin
      .from("analyses")
      .insert(fallbackPayload);
    error = fallback.error;
  }

  if (error) {
    console.warn("saveAnalysis insert error", error);
  }
}

export async function getRecentAnalyses(userId: string, limit = 10) {
  if (!supabaseAdmin) {
    return [];
  }

  const columnsWithSummary =
    "id, daw, clip_start, clip_end, duration, plugins, summary, features, created_at";
  const columnsWithoutFeatures =
    "id, daw, clip_start, clip_end, duration, plugins, summary, created_at";
  const columnsWithoutSummary =
    "id, daw, clip_start, clip_end, duration, plugins, created_at";

  const mapRows = (
    items: unknown[] | null,
    defaults: Partial<AnalysisRecord> = {}
  ): AnalysisRecord[] => {
    if (!Array.isArray(items)) return [];
    return items
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
      .map((item) => ({ ...(item as Record<string, unknown>), ...defaults }))
      .map((item) => item as AnalysisRecord);
  };

  const primaryQuery = supabaseAdmin
    .from("analyses")
    .select(columnsWithSummary)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data, error: primaryError } = await primaryQuery;
  let error = primaryError;
  let rows = mapRows(data);

  if (error?.message && error.message.toLowerCase().includes("features")) {
    const fallbackQuery = supabaseAdmin
      .from("analyses")
      .select(columnsWithoutFeatures)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    const fallback = await fallbackQuery;
    error = fallback.error;
    rows = mapRows(fallback.data, { features: null });
  }

  if (error?.message && error.message.toLowerCase().includes("summary")) {
    const fallbackQuery = supabaseAdmin
      .from("analyses")
      .select(columnsWithoutSummary)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    const fallback = await fallbackQuery;
    error = fallback.error;
    rows = mapRows(fallback.data, { summary: null, features: null });
  }

  if (error) {
    return [];
  }

  return rows;
}
