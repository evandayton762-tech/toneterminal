import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  PlanGateError,
  assertFeature,
  resolvePlanContext,
} from "@/middleware/planGate";

const errorResponse = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

async function ensureLibraryAccess(userId: string) {
  const context = await resolvePlanContext(userId);
  assertFeature(
    context.plan,
    "canAccessLibrary",
    "Upgrade your plan to manage saved chains."
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  if (!supabaseAdmin) {
    return errorResponse(
      "Supabase configuration missing on server.",
      500
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return errorResponse("Authorization header missing.", 401);
  }

  const accessToken = authorization.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    return errorResponse("Invalid or expired session.", 401);
  }

  try {
    await ensureLibraryAccess(user.id);
  } catch (error) {
    if (error instanceof PlanGateError) {
      return errorResponse(error.message, error.status);
    }
    throw error;
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return errorResponse("Invalid request payload.");
  }

  const updates: Record<string, unknown> = {};
  let featuresUpdate: Record<string, unknown> | null | undefined;

  if (Array.isArray(payload.tags)) {
    updates.tags = payload.tags;
  }
  if (typeof payload.favorite === "boolean") {
    updates.favorite = payload.favorite;
  }
  if (payload && "folderId" in payload) {
    if (payload.folderId === null) {
      updates.folder_id = null;
    } else if (typeof payload.folderId === "string" && payload.folderId.trim().length > 0) {
      updates.folder_id = payload.folderId.trim();
    } else {
      return errorResponse("folderId must be a string or null.");
    }
  }

  if ("notes" in payload) {
    if (
      typeof payload.notes !== "string" &&
      payload.notes !== null
    ) {
      return errorResponse("Notes must be a string or null.");
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("analysis_presets")
      .select("features")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError) {
      return errorResponse(
        `Unable to load preset: ${fetchError.message}`,
        500
      );
    }

    const currentFeatures = isRecord(existing?.features)
      ? existing?.features
      : {};
    const nextFeatures: Record<string, unknown> = {
      ...currentFeatures,
    };

    const trimmedNotes =
      typeof payload.notes === "string" ? payload.notes : "";

    if (trimmedNotes.trim().length > 0) {
      nextFeatures["user_notes"] = trimmedNotes;
    } else {
      delete nextFeatures["user_notes"];
    }

    featuresUpdate = nextFeatures;
    updates.features = nextFeatures;
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse("No valid fields provided.");
  }

  const { error: updateError } = await supabaseAdmin
    .from("analysis_presets")
    .update(updates)
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (updateError) {
    return errorResponse(
      `Unable to update preset: ${updateError.message}`,
      500
    );
  }

  return NextResponse.json({
    ok: true,
    features: featuresUpdate ?? undefined,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  if (!supabaseAdmin) {
    return errorResponse(
      "Supabase configuration missing on server.",
      500
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return errorResponse("Authorization header missing.", 401);
  }

  const accessToken = authorization.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    return errorResponse("Invalid or expired session.", 401);
  }

  try {
    await ensureLibraryAccess(user.id);
  } catch (error) {
    if (error instanceof PlanGateError) {
      return errorResponse(error.message, error.status);
    }
    throw error;
  }

  const { error: deleteError } = await supabaseAdmin
    .from("analysis_presets")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (deleteError) {
    return errorResponse(
      `Unable to delete preset: ${deleteError.message}`,
      500
    );
  }

  return NextResponse.json({ ok: true });
}
