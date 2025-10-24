import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  PlanGateError,
  assertFeature,
  isPlanGateError,
  normalizeDawIdentifier,
  resolvePlanContext,
} from "@/middleware/planGate";
import { getPluginProfile, upsertPluginProfile, deletePluginProfile } from "@/lib/pluginProfile";
import { sanitizePluginSelection, isValidPluginSlug } from "@/lib/pluginInventory";
import { DAWS, type DawId } from "@/data/daws";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function ensureUser(request: Request) {
  if (!supabaseAdmin) {
    throw new Error(
      "Supabase configuration missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new PlanGateError("Authorization header missing.", 401);
  }

  const accessToken = authorization.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    throw new PlanGateError("Invalid or expired session.", 401);
  }

  return user;
}

function parseDaw(searchParams: URLSearchParams): DawId {
  const raw = searchParams.get("daw");
  if (!raw) {
    throw new PlanGateError("Missing daw parameter.", 400);
  }
  const normalized = normalizeDawIdentifier(raw) as DawId;
  if (!(normalized in DAWS)) {
    throw new PlanGateError("Unsupported DAW.", 400);
  }
  return normalized;
}

export async function GET(request: Request) {
  try {
    const user = await ensureUser(request);
    const planContext = await resolvePlanContext(user.id);
    assertFeature(
      planContext.plan,
      "canUsePremiumInventory",
      "Upgrade your plan to manage premium plugin profiles."
    );

    const { searchParams } = new URL(request.url);
    const daw = parseDaw(searchParams);

    const profile = await getPluginProfile(user.id, daw);

    return NextResponse.json({
      profile: profile
        ? {
            daw: profile.daw,
            plugins: profile.plugins,
          }
        : null,
    });
  } catch (error) {
    if (isPlanGateError(error)) {
      const gate = error as PlanGateError;
      return errorResponse(gate.message, gate.status);
    }
    console.error("GET /api/plugin-profile error", error);
    return errorResponse("Unable to load plugin profile.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await ensureUser(request);
    const planContext = await resolvePlanContext(user.id);
    assertFeature(
      planContext.plan,
      "canUsePremiumInventory",
      "Upgrade your plan to save premium plugin profiles."
    );

    const { searchParams } = new URL(request.url);
    const daw = parseDaw(searchParams);

    const payload = await request.json().catch(() => null);
    if (!payload || !Array.isArray(payload.plugins)) {
      return errorResponse("Invalid request body. Expected { plugins: string[] }.");
    }

    const unique = Array.from(new Set(payload.plugins)).filter((slug) =>
      typeof slug === "string"
    );

    const invalid = unique.filter((slug) => !isValidPluginSlug(slug));
    if (invalid.length > 0) {
      return errorResponse(
        `Unknown plugin slugs: ${invalid.join(", ")}`,
        400
      );
    }

    const sanitized = sanitizePluginSelection(daw, unique);
    const profile = await upsertPluginProfile(user.id, daw, sanitized);

    return NextResponse.json({
      profile: {
        daw: profile.daw,
        plugins: profile.plugins,
      },
    });
  } catch (error) {
    if (isPlanGateError(error)) {
      const gate = error as PlanGateError;
      return errorResponse(gate.message, gate.status);
    }
    console.error("PUT /api/plugin-profile error", error);
    return errorResponse("Unable to save plugin profile.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await ensureUser(request);
    const planContext = await resolvePlanContext(user.id);
    assertFeature(
      planContext.plan,
      "canUsePremiumInventory",
      "Upgrade your plan to manage premium plugin profiles."
    );

    const { searchParams } = new URL(request.url);
    const daw = parseDaw(searchParams);

    await deletePluginProfile(user.id, daw);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isPlanGateError(error)) {
      const gate = error as PlanGateError;
      return errorResponse(gate.message, gate.status);
    }
    console.error("DELETE /api/plugin-profile error", error);
    return errorResponse("Unable to delete plugin profile.", 500);
  }
}
