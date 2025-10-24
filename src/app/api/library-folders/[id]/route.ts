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
    "Upgrade your plan to organize saved chains."
  );
}

async function resolveUser(request: Request) {
  if (!supabaseAdmin) {
    throw new PlanGateError(
      "Supabase configuration missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      500
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new PlanGateError("Authorization header missing.", 401);
  }

  const token = authorization.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    throw new PlanGateError("Invalid or expired session.", 401);
  }

  return user;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUser(request);
    await ensureLibraryAccess(user.id);

    const payload = await request.json().catch(() => null);
    const nextName =
      payload && typeof payload.name === "string"
        ? payload.name.trim()
        : "";

    if (!nextName) {
      return errorResponse("Folder name is required.");
    }

    const { data, error } = await supabaseAdmin!
      .from("analysis_folders")
      .update({
        name: nextName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select("id, name, created_at, updated_at")
      .single();

    if (error || !data) {
      return errorResponse(
        `Unable to rename folder: ${error?.message ?? "Unknown error."}`,
        500
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof PlanGateError) {
      return errorResponse(error.message, error.status);
    }
    throw error;
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUser(request);
    await ensureLibraryAccess(user.id);

    const { error } = await supabaseAdmin!
      .from("analysis_folders")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.id);

    if (error) {
      return errorResponse(
        `Unable to delete folder: ${error.message}`,
        500
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PlanGateError) {
      return errorResponse(error.message, error.status);
    }
    throw error;
  }
}
