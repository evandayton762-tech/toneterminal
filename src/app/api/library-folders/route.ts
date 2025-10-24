import { NextRequest, NextResponse } from "next/server";
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

export async function GET(request: NextRequest) {
  if (!supabaseAdmin) {
    return errorResponse(
      "Supabase configuration missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      500
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return errorResponse("Authorization header missing.", 401);
  }

  const token = authorization.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return errorResponse("Invalid or expired session.", 401);
  }

  try {
    await ensureLibraryAccess(user.id);
  } catch (caught) {
    if (caught instanceof PlanGateError) {
      return errorResponse(caught.message, caught.status);
    }
    throw caught;
  }

  const { data, error: fetchError } = await supabaseAdmin
    .from("analysis_folders")
    .select("id, name, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (fetchError) {
    return errorResponse(`Unable to load folders: ${fetchError.message}`, 500);
  }

  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!supabaseAdmin) {
    return errorResponse(
      "Supabase configuration missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      500
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return errorResponse("Authorization header missing.", 401);
  }

  const token = authorization.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return errorResponse("Invalid or expired session.", 401);
  }

  let name: string | null = null;
  try {
    const payload = await request.json();
    name = typeof payload?.name === "string" ? payload.name.trim() : "";
  } catch {
    name = null;
  }

  if (!name) {
    return errorResponse("Folder name is required.");
  }

  try {
    await ensureLibraryAccess(user.id);
  } catch (caught) {
    if (caught instanceof PlanGateError) {
      return errorResponse(caught.message, caught.status);
    }
    throw caught;
  }

  const { data: folder, error: insertError } = await supabaseAdmin
    .from("analysis_folders")
    .insert({
      user_id: user.id,
      name,
    })
    .select("id, name, created_at, updated_at")
    .single();

  if (insertError || !folder) {
    return errorResponse(
      `Unable to create folder: ${insertError?.message ?? "Unknown error."}`,
      500
    );
  }

  return NextResponse.json(folder, { status: 201 });
}
