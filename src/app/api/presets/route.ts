import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  assertFeature,
  isPlanGateError,
  resolvePlanContext,
} from "@/middleware/planGate";

const buildError = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readFeatureString = (
  features: unknown,
  key: string
): string | null => {
  if (!isRecord(features)) return null;
  const value = features[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

type PresetRow = Record<string, unknown> & {
  summary?: unknown;
  tags?: unknown;
  favorite?: unknown;
  features?: unknown;
  folder_id?: unknown;
};

export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return buildError(
      "Supabase configuration missing on server.",
      500
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return buildError("Authorization header missing.", 401);
  }

  const accessToken = authorization.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    return buildError("Invalid or expired session.", 401);
  }

  try {
    const context = await resolvePlanContext(user.id);
    assertFeature(
      context.plan,
      "canAccessLibrary",
      "Upgrade your plan to access saved chains."
    );
  } catch (error) {
    if (isPlanGateError(error)) {
      return buildError(error.message, error.status);
    }
    throw error;
  }

  const client = supabaseAdmin;

  const BASE_COLUMNS =
    "id, daw, clip_start, clip_end, duration, plugins, created_at, folder_id";
  const OPTIONAL_COLUMNS = ["summary", "tags", "favorite", "features"];
  const FULL_COLUMNS = `${BASE_COLUMNS}, ${OPTIONAL_COLUMNS.join(", ")}`;

  const url = new URL(request.url);
  const folderFilter = url.searchParams.get("folderId");

  const selectPresets = async (columns: string) => {
    const query = client
      .from("analysis_presets")
      .select(columns)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (folderFilter === "null") {
      query.is("folder_id", null);
    } else if (folderFilter) {
      query.eq("folder_id", folderFilter);
    }

    return query;
  };

  const { data, error: initialError } = await selectPresets(FULL_COLUMNS);
  let fetchError = initialError;
  let rows: PresetRow[] = Array.isArray(data)
    ? data
        .map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? (item as PresetRow)
            : null
        )
        .filter((item): item is PresetRow => item !== null)
    : [];

  const missingColumn =
    fetchError?.message &&
    /does not exist|'?(tags|favorite|summary|features|folder_id)'?/.test(
      fetchError.message.toLowerCase()
    );

  if (missingColumn) {
    const fallback = await selectPresets(BASE_COLUMNS);
    fetchError = fallback.error;
    rows = Array.isArray(fallback.data)
      ? fallback.data.map((item) => {
          const base: PresetRow = {
            summary: null,
            tags: [],
            favorite: false,
            features: null,
            folder_id: null,
          };

          if (item && typeof item === "object" && !Array.isArray(item)) {
            return { ...(item as PresetRow), ...base };
          }

          return base;
        })
      : [];
  }

  if (fetchError) {
    return buildError(
      `Unable to load presets: ${fetchError.message}`,
      500
    );
  }

  const normalized =
    rows.length > 0
      ? rows.map((item) => {
          const record = item as PresetRow;
          const features = isRecord(record.features) ? record.features : null;
          const directSummary =
            typeof record.summary === "string" && record.summary.trim().length > 0
              ? record.summary.trim()
              : null;
          const fallbackSummary =
            directSummary ??
            readFeatureString(features, "ai_summary") ??
            readFeatureString(features, "summary");

          return {
            ...record,
            tags: Array.isArray(record.tags) ? record.tags : [],
            favorite:
              typeof record.favorite === "boolean" ? record.favorite : false,
            summary:
              fallbackSummary !== null
                ? fallbackSummary
                : record.summary === null
                ? null
                : undefined,
            features,
            folder_id: record.folder_id ?? null,
          };
        })
      : [];

  return NextResponse.json({ items: normalized });
}
