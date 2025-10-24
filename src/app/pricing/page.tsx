"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import HeaderNav from "@/components/HeaderNav";
import ParticlesBackground from "@/components/ParticlesBackground";
import { PLANS } from "@/lib/plans";
import { getPlanLabel, getPlanPrice } from "@/lib/plan";
import { listDaws } from "@/lib/daws";
import { NATIVE_EXPORTER_INFO, NATIVE_EXPORTER_ORDER } from "@/data/nativeExporters";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";

const PLAN_ORDER = ["free", "standard_15", "pro_29"] as const;

const NATIVE_EXPORT_LABELS = NATIVE_EXPORTER_ORDER.map((key) => NATIVE_EXPORTER_INFO[key].label);

type FeatureRow = {
  key: string;
  label: string;
  render: (plan: (typeof PLANS)[(typeof PLAN_ORDER)[number]]) => string;
  indicator?: (plan: (typeof PLANS)[(typeof PLAN_ORDER)[number]]) => boolean | undefined;
};

const FEATURE_ROWS: readonly FeatureRow[] = [
  {
    key: "generationsPerMonth",
    label: "Monthly analyses",
    render: (plan: (typeof PLANS)[(typeof PLAN_ORDER)[number]]) =>
      `${plan.generationsPerMonth} per month`,
  },
  {
    key: "allowedDAWs",
    label: "DAWs included",
    render: (plan: (typeof PLANS)[(typeof PLAN_ORDER)[number]]) =>
      listDaws(plan.allowedDAWs).join(" • "),
  },
  {
    key: "canAccessLibrary",
    label: "Library access",
    render: (plan: (typeof PLANS)[(typeof PLAN_ORDER)[number]]) =>
      plan.canAccessLibrary ? "Included" : "Not included",
  },
  {
    key: "canUsePremiumInventory",
    label: "Premium plugin profiles",
    render: (plan: (typeof PLANS)[(typeof PLAN_ORDER)[number]]) =>
      plan.canUsePremiumInventory
        ? plan.id === "standard_15"
          ? "Save one profile per DAW (popular DAWs)"
          : "Save one profile per DAW (all DAWs)"
        : "Not included",
  },
  {
    key: "canExportPreset",
    label: "Native preset exports",
    render: (plan: (typeof PLANS)[(typeof PLAN_ORDER)[number]]) => {
      if (!plan.canExportPreset) {
        return "Not included";
      }
      if (plan.id === "pro_29") {
        return `${NATIVE_EXPORT_LABELS.join(" • ")} • future formats included`; 
      }
      return NATIVE_EXPORT_LABELS.join(" • ");
    },
    indicator: (plan) => plan.canExportPreset,
  },
  {
    key: "priorityProcessing",
    label: "Priority processing",
    render: (plan: (typeof PLANS)[(typeof PLAN_ORDER)[number]]) =>
      plan.priorityProcessing ? "Yes" : "Standard queue",
  },
] as const;

function FeatureValue({
  plan,
  row,
}: {
  plan: (typeof PLANS)[(typeof PLAN_ORDER)[number]];
  row: (typeof FEATURE_ROWS)[number];
}) {
  const raw = row.render(plan);
  const isIncluded = row.indicator
    ? row.indicator(plan)
    : typeof plan[row.key as keyof typeof plan] === "boolean"
    ? Boolean(plan[row.key as keyof typeof plan])
    : undefined;

  return (
    <li className="flex items-start gap-2">
      <span
        className={`mt-[2px] text-sm ${
          isIncluded === undefined
            ? "text-slate-300"
            : isIncluded
            ? "text-emerald-400"
            : "text-slate-500"
        }`}
      >
        {isIncluded === undefined ? "•" : isIncluded ? "✓" : "✕"}
      </span>
      <span className="text-sm text-slate-200">{raw}</span>
    </li>
  );
}

export default function PricingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  const beginCheckout = async (planId: string) => {
    if (loadingPlan) return;

    if (planId === "free") {
      router.push(user ? "/account" : "/auth");
      return;
    }

    if (!supabase) {
      setCheckoutError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      return;
    }

    setCheckoutError(null);
    setLoadingPlan(planId);

    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        throw new Error(error.message);
      }

      const token = session?.access_token;
      if (!token) {
        router.push("/auth");
        return;
      }

      const response = await fetch(`/api/checkout?planId=${planId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload || typeof payload.url !== "string") {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to start checkout."
        );
      }

      window.location.href = payload.url;
    } catch (error) {
      setCheckoutError(
        error instanceof Error
          ? error.message
          : "Unable to start checkout. Please try again."
      );
      setLoadingPlan(null);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <ParticlesBackground variant="subtle" />
      <div className="relative z-10 flex min-h-screen flex-col px-6 py-10 sm:px-10 lg:px-16">
        <HeaderNav />
        <section className="mx-auto mt-12 flex w-full max-w-5xl flex-col gap-4 text-center">
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">
            Choose the plan that fits your workflow
          </h1>
          <p className="text-sm text-slate-300 sm:text-base">
            Unlock more DAWs, faster turnarounds, premium plugin profiles, and export tools as you scale.
          </p>
        </section>

        <section className="mt-10 grid flex-1 gap-6 md:grid-cols-3">
          {PLAN_ORDER.map((planId) => {
            const plan = PLANS[planId];
            const label = getPlanLabel(planId);
            const price = getPlanPrice(planId);
            const isPopular = planId === "standard_15";
            const isFree = planId === "free";

            return (
              <div
                key={planId}
                className={`relative flex flex-col justify-between rounded-2xl border border-white/15 bg-black/60 p-6 shadow-lg shadow-black/50 ${
                  isPopular ? "ring-2 ring-sky-400/60" : ""
                }`}
              >
                {isPopular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-sky-400/40 bg-sky-500/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.35em] text-sky-200">
                    Popular
                  </span>
                )}
                <div className="flex flex-col gap-4">
                  <div className="text-left">
                    <h2 className="text-2xl font-semibold text-white">{label}</h2>
                    <p className="text-sm text-slate-300">{price}</p>
                  </div>
                  <ul className="flex flex-col gap-3 text-left">
                    {FEATURE_ROWS.map((row) => (
                      <FeatureValue key={row.key} plan={plan} row={row} />
                    ))}
                  </ul>
                </div>
                {isFree ? (
                  <Link
                    href={user ? "/account" : "/auth"}
                    className="mt-6 inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white transition hover:border-sky-400/70 hover:bg-white/5"
                  >
                    {user ? "Manage plan" : "Get started free"}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => void beginCheckout(planId)}
                    disabled={loadingPlan === planId}
                    className="mt-6 inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white transition hover:border-sky-400/70 hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/15 disabled:text-white/40"
                  >
                    {loadingPlan === planId ? "Redirecting…" : `Upgrade to ${label}`}
                  </button>
                )}
              </div>
            );
          })}
        </section>
        {checkoutError && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {checkoutError}
          </div>
        )}
      </div>
    </div>
  );
}
