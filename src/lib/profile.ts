import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPlan, normalizePlanId } from "@/lib/plans";

export type Profile = {
  id: string;
  credits: number;
  tier: string;
  updated_at: string | null;
  stripe_customer_id?: string | null;
};

const DEFAULT_TIER = "free";
export const DEFAULT_CREDITS = getPlan(DEFAULT_TIER).generationsPerMonth;

const clampCredits = (planId: string, credits: unknown): number => {
  const plan = getPlan(planId);
  const numeric =
    typeof credits === "number" && Number.isFinite(credits) ? credits : plan.generationsPerMonth;
  return Math.max(0, Math.min(plan.generationsPerMonth, numeric));
};

const ensureAdmin = () => {
  if (!supabaseAdmin) {
    throw new Error(
      "Supabase admin client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return supabaseAdmin;
};

export async function getOrCreateProfile(userId: string): Promise<Profile> {
  const client = ensureAdmin();

  const selectColumns = "id, credits, tier, updated_at, stripe_customer_id";
  let { data, error } = await client
    .from("profiles")
    .select(selectColumns)
    .eq("id", userId)
    .maybeSingle();

  const missingColumn =
    error?.message &&
    error.message.toLowerCase().includes("stripe_customer_id");

  if (missingColumn) {
    const fallback = await client
      .from("profiles")
      .select("id, credits, tier, updated_at")
      .eq("id", userId)
      .maybeSingle();
    error = fallback.error;
    data = fallback.data
      ? { ...fallback.data, stripe_customer_id: null }
      : fallback.data;
  }

  if (error) {
    throw new Error(`Failed to fetch profile: ${error.message}`);
  }

  if (data) {
    const normalizedTier = normalizePlanId(data.tier);
    const credits = clampCredits(normalizedTier, data.credits);
    const needsSync = normalizedTier !== data.tier || credits !== data.credits;
    if (needsSync) {
      await client
        .from("profiles")
        .update({ tier: normalizedTier, credits })
        .eq("id", userId);
    }
    return {
      ...data,
      stripe_customer_id: data.stripe_customer_id ?? null,
      tier: normalizedTier,
      credits,
    };
  }

  const insertPayload: Record<string, unknown> = {
    id: userId,
    credits: DEFAULT_CREDITS,
    tier: DEFAULT_TIER,
    stripe_customer_id: null,
  };

  let { data: inserted, error: insertError } = await client
    .from("profiles")
    .insert(insertPayload)
    .select("id, credits, tier, updated_at, stripe_customer_id")
    .single();

  const insertMissingColumn =
    insertError?.message &&
    insertError.message.toLowerCase().includes("stripe_customer_id");

  if (insertMissingColumn) {
    const fallbackPayload = { ...insertPayload };
    delete (fallbackPayload as { stripe_customer_id?: unknown }).stripe_customer_id;
    const fallback = await client
      .from("profiles")
      .insert(fallbackPayload)
      .select("id, credits, tier, updated_at")
      .single();
    insertError = fallback.error;
    inserted = fallback.data
      ? { ...fallback.data, stripe_customer_id: null }
      : fallback.data;
  }

  if (insertError || !inserted) {
    throw new Error(
      `Failed to initialize profile: ${insertError?.message ?? "Unknown error"}`
    );
  }

  return {
    ...inserted,
    stripe_customer_id: inserted.stripe_customer_id ?? null,
    credits: clampCredits(DEFAULT_TIER, inserted.credits),
  };
}

export async function decrementCredits(userId: string): Promise<Profile> {
  const client = ensureAdmin();

  const { data: current, error: fetchError } = await client
    .from("profiles")
    .select("id, credits, tier, updated_at, stripe_customer_id")
    .eq("id", userId)
    .single<Profile>();

  if (fetchError || !current) {
    throw new Error(
      `Failed to load profile for decrement: ${fetchError?.message ?? "Not found"}`
    );
  }

  const plan = getPlan(current.tier);
  const currentCredits = clampCredits(plan.id, current.credits);
  const nextCredits = Math.max(0, currentCredits - 1);

  const { data: updated, error: updateError } = await client
    .from("profiles")
    .update({ credits: nextCredits })
    .eq("id", userId)
    .select("id, credits, tier, updated_at, stripe_customer_id")
    .single<Profile>();

  if (updateError || !updated) {
    throw new Error(
      `Failed to decrement credits: ${updateError?.message ?? "Unknown error"}`
    );
  }

  return updated;
}

export async function updateProfileCredits(
  userId: string,
  credits: number
): Promise<Profile> {
  const client = ensureAdmin();

  const { data, error } = await client
    .from("profiles")
    .update({ credits })
    .eq("id", userId)
    .select("id, credits, tier, updated_at, stripe_customer_id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update profile credits: ${error?.message ?? "Unknown error"}`
    );
  }

  return {
    ...data,
    credits: clampCredits(data.tier, data.credits),
    stripe_customer_id: data.stripe_customer_id ?? null,
  };
}

export async function updateProfileTier(
  userId: string,
  tier: string,
  credits?: number
): Promise<Profile> {
  const client = ensureAdmin();

  const normalizedTier = normalizePlanId(tier);
  const targetPlan = getPlan(normalizedTier);

  const payload: Partial<Profile> & { tier: string } = { tier: normalizedTier };
  if (typeof credits === "number") {
    payload.credits = credits;
  } else {
    payload.credits = targetPlan.generationsPerMonth;
  }

  const { data, error } = await client
    .from("profiles")
    .update(payload)
    .eq("id", userId)
    .select("id, credits, tier, updated_at, stripe_customer_id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update profile: ${error?.message ?? "Unknown error"}`
    );
  }

  return {
    ...data,
    tier: normalizedTier,
    credits: clampCredits(normalizedTier, payload.credits),
    stripe_customer_id: data.stripe_customer_id ?? null,
  };
}

export async function setStripeCustomerId(
  userId: string,
  customerId: string
): Promise<void> {
  const client = ensureAdmin();
  const { error } = await client
    .from("profiles")
    .update({ stripe_customer_id: customerId })
    .eq("id", userId);

  if (error) {
    if (error.message.toLowerCase().includes("stripe_customer_id")) {
      console.warn(
        "profiles.stripe_customer_id column missing. Add it to persist Stripe customer IDs."
      );
      return;
    }
    throw new Error(`Failed to set stripe customer id: ${error.message}`);
  }
}
