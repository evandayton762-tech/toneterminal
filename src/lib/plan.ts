import {
  PLANS,
  PLAN_IDS,
  PLAN_FEATURE_KEYS,
  type PlanFeatureKey,
  type PlanId,
  getPlan as getPlanInternal,
  getPlanLabel as getPlanLabelInternal,
  getPlanPrice as getPlanPriceInternal,
  getCreditLimit as getCreditLimitInternal,
  isPaidPlan as isPaidPlanInternal,
  normalizePlanId,
  isPaidPlan,
} from "./plans";

export { PLANS, PLAN_IDS, PLAN_FEATURE_KEYS };
export type { PlanFeatureKey, PlanId };

const forcedPlanEnv =
  (typeof process !== "undefined" && process.env.FORCE_PLAN_ID) ||
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_FORCE_PLAN_ID) ||
  null;

let FORCED_PLAN_ID: PlanId | null = null;
if (forcedPlanEnv && (PLAN_IDS as readonly string[]).includes(forcedPlanEnv)) {
  FORCED_PLAN_ID = forcedPlanEnv as PlanId;
}

export const getForcedPlanId = (): PlanId | null => FORCED_PLAN_ID;

const resolvePlanId = (planId?: string | null): PlanId =>
  FORCED_PLAN_ID ?? normalizePlanId(planId);

export const getNormalizedTier = (tier?: string | null): PlanId =>
  resolvePlanId(tier);

export const getPlan = (tier?: string | null) =>
  getPlanInternal(resolvePlanId(tier));

export const getPlanLabel = (tier?: string | null) =>
  getPlanLabelInternal(resolvePlanId(tier));

export const getPlanPrice = (tier?: string | null) =>
  getPlanPriceInternal(resolvePlanId(tier));

export const getCreditLimit = (tier?: string | null) =>
  getCreditLimitInternal(resolvePlanId(tier));

export const isPaidTier = (tier?: string | null) =>
  isPaidPlanInternal(resolvePlanId(tier));

export const isPaidPlanId = (planId?: string | null) =>
  isPaidPlan(resolvePlanId(planId));
