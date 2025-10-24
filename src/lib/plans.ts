export type PlanId = keyof typeof PLANS;

type PlanDefinition = {
  id: PlanId;
  priceMonthlyUSD: number;
  generationsPerMonth: number;
  allowedDAWs: readonly string[];
  canExportPreset: boolean;
  canUsePremiumInventory: boolean;
  canAccessLibrary: boolean;
  priorityProcessing: boolean;
};

export const PLANS = {
  free: {
    id: "free",
    priceMonthlyUSD: 0,
    generationsPerMonth: 3,
    allowedDAWs: ["fl_studio", "ableton_live"] as const,
    canExportPreset: false,
    canUsePremiumInventory: false,
    canAccessLibrary: false,
    priorityProcessing: false,
  },
  standard_15: {
    id: "standard_15",
    priceMonthlyUSD: 15,
    generationsPerMonth: 30,
    allowedDAWs: [
      "fl_studio",
      "ableton_live",
      "logic_pro",
      "pro_tools",
      "reaper",
      "cubase",
      "studio_one",
    ] as const,
    canExportPreset: true,
    canUsePremiumInventory: true,
    canAccessLibrary: true,
    priorityProcessing: false,
  },
  pro_29: {
    id: "pro_29",
    priceMonthlyUSD: 29,
    generationsPerMonth: 60,
    allowedDAWs: [
      "fl_studio",
      "ableton_live",
      "logic_pro",
      "pro_tools",
      "reaper",
      "cubase",
      "studio_one",
      "bitwig",
      "reason",
      "nuendo",
      "garageband",
      "digital_performer",
      "samplitude",
      "cakewalk",
      "ardour",
      "mixbus",
      "waveform",
    ] as const,
    canExportPreset: true,
    canUsePremiumInventory: true,
    canAccessLibrary: true,
    priorityProcessing: true,
  },
} as const satisfies Record<string, PlanDefinition>;

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export function normalizePlanId(raw?: string | null): PlanId {
  if (!raw) return "free";
  const lower = raw.toLowerCase();
  if ((PLAN_IDS as string[]).includes(lower)) {
    return lower as PlanId;
  }
  return "free";
}

export function getPlan(planId?: string | null): PlanDefinition {
  const normalized = normalizePlanId(planId);
  return PLANS[normalized];
}

export function getPlanLabel(planId?: string | null): string {
  const plan = getPlan(planId);
  switch (plan.id) {
    case "standard_15":
      return "Standard";
    case "pro_29":
      return "Pro";
    default:
      return "Free";
  }
}

export function getPlanPrice(planId?: string | null): string {
  const plan = getPlan(planId);
  return plan.priceMonthlyUSD === 0
    ? "$0/mo"
    : `$${plan.priceMonthlyUSD}/mo`;
}

export function getCreditLimit(planId?: string | null): number {
  const plan = getPlan(planId);
  return plan.generationsPerMonth;
}

export function isPaidPlan(planId?: string | null): boolean {
  const plan = getPlan(planId);
  return plan.id !== "free";
}

export const PLAN_FEATURE_KEYS = [
  "generationsPerMonth",
  "allowedDAWs",
  "canAccessLibrary",
  "canUsePremiumInventory",
  "canExportPreset",
  "priorityProcessing",
] as const;

export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[number];
