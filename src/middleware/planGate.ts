import { getPlan } from "@/lib/plans";
import { dawIdToLabel, labelToDawId } from "@/lib/daws";
import { getOrCreateProfile, type Profile } from "@/lib/profile";

const BYPASS_PLAN_GATES = (() => {
  if (typeof process === "undefined") return false;
  const candidates = [
    process.env.UNLOCK_ALL_FEATURES,
    process.env.NEXT_PUBLIC_UNLOCK_ALL_FEATURES,
    process.env.FORCE_PLAN_UNLOCK,
    process.env.NEXT_PUBLIC_FORCE_PLAN_UNLOCK,
  ];
  return candidates.some((value) => {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  });
})();

const PRO_PLAN_ID = "pro_29";

export class PlanGateError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export type PlanContext = {
  userId: string;
  profile: Profile;
  plan: ReturnType<typeof getPlan>;
};

export type PlanFeatureFlag =
  | "canExportPreset"
  | "canUsePremiumInventory"
  | "canAccessLibrary"
  | "priorityProcessing";

export async function resolvePlanContext(userId: string): Promise<PlanContext> {
  const profile = await getOrCreateProfile(userId);
  if (BYPASS_PLAN_GATES) {
    const plan = getPlan(PRO_PLAN_ID);
    const elevatedProfile: Profile = {
      ...profile,
      tier: plan.id,
      credits: Math.max(
        typeof profile.credits === "number" ? profile.credits : 0,
        plan.generationsPerMonth
      ),
    };
    return {
      userId,
      profile: elevatedProfile,
      plan,
    };
  }
  const plan = getPlan(profile.tier);
  return {
    userId,
    profile,
    plan,
  };
}

export function normalizeDawIdentifier(value: string): string {
  const id = labelToDawId(value) ?? value.toLowerCase().replace(/\s+/g, "_");
  return id;
}

export function assertDAWAllowed(plan: ReturnType<typeof getPlan>, dawId: string) {
  if (BYPASS_PLAN_GATES) {
    return;
  }
  if ((plan.allowedDAWs as readonly string[]).includes(dawId)) {
    return;
  }
  const friendlyName = dawIdToLabel(dawId);
  throw new PlanGateError(
    `${friendlyName} is not included in your current plan. Upgrade to unlock this DAW.`,
    403
  );
}

export function assertQuotaAvailable(context: PlanContext) {
  if (BYPASS_PLAN_GATES) {
    return;
  }
  const remaining = context.profile.credits ?? 0;
  if (remaining > 0) {
    return;
  }
  const planName =
    context.plan.id === "standard_15"
      ? "Standard"
      : context.plan.id === "pro_29"
      ? "Pro"
      : "Free";
  throw new PlanGateError(
    `You have used all ${context.plan.generationsPerMonth} analyses on the ${planName} plan. Upgrade or wait for your quota to reset.`,
    402
  );
}

export function assertFeature(
  plan: ReturnType<typeof getPlan>,
  feature: PlanFeatureFlag,
  message?: string
) {
  if (BYPASS_PLAN_GATES) {
    return;
  }
  if (plan[feature]) {
    return;
  }
  throw new PlanGateError(
    message ??
      "Your current plan does not include this feature. Upgrade to unlock it.",
    403
  );
}

export function isPlanGateError(error: unknown): error is PlanGateError {
  return error instanceof PlanGateError;
}
