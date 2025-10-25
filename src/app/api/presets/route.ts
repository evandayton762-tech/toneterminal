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

  let { data, error: fetchError } = await selectPresets(FULL_COLUMNS);

  const missingColumn =
    fetchError?.message &&
    /does not exist|'?(tags|favorite|summary|features|folder_id)'?/.test(
      fetchError.message.toLowerCase()
    );

  if (missingColumn) {
    const fallback = await selectPresets(BASE_COLUMNS);
    fetchError = fallback.error;
    data = Array.isArray(fallback.data)
      ? fallback.data.map((item) => ({
          ...item,
          summary: null,
          tags: [],
          favorite: false,
          features: null,
          folder_id: null,
        }))
      : [];
  }

  if (fetchError) {
    return buildError(
      `Unable to load presets: ${fetchError.message}`,
      500
    );
  }

  const normalized =
    Array.isArray(data) && data.length > 0
      ? data.map((item) => {
          const features = isRecord(item.features) ? item.features : null;
          const directSummary =
            typeof item.summary === "string" && item.summary.trim().length > 0
              ? item.summary.trim()
              : null;
          const fallbackSummary =
            directSummary ??
            readFeatureString(features, "ai_summary") ??
            readFeatureString(features, "summary");

          return {
            ...item,
            tags: Array.isArray(item.tags) ? item.tags : [],
            favorite: typeof item.favorite === "boolean" ? item.favorite : false,
            summary:
              fallbackSummary !== null
                ? fallbackSummary
                : item.summary === null
                ? null
                : undefined,
            features,
            folder_id: item.folder_id ?? null,
          };
        })
      : [];

  return NextResponse.json({ items: normalized });
}
