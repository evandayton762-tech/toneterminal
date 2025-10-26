"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { getCreditLimit, getNormalizedTier } from "@/lib/plan";

type CreditsState = {
  loading: boolean;
  error: string | null;
  remaining: number | null;
  tier: string | null;
};

type CreditsUpdatedDetail = {
  remaining?: number | null;
  tier?: string | null;
};

const BUTTON_CLASS =
  "terminal-button rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-sky-400/70 hover:bg-white/5 active:shadow-inner active:bg-white/10";

function useCredits(enabled: boolean) {
  const [state, setState] = useState<CreditsState>({
    loading: enabled,
    error: null,
    remaining: null,
    tier: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }

    const client = supabase;

    if (!client) {
      setState({
        loading: false,
        error:
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        remaining: null,
        tier: null,
      });
      return;
    }

    let cancelled = false;

    const fetchCredits = async () => {
      try {
        const {
          data: { session },
          error,
        } = await client.auth.getSession();

        if (error) {
          throw new Error(error.message);
        }

        const token = session?.access_token;
        if (!token) {
          throw new Error("Session expired. Please sign in again.");
        }

        const response = await fetch("/api/check-credits", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = await response.json().catch(() => null);

        if (cancelled) return;

        if (!response.ok || !payload) {
          throw new Error(
            (payload && typeof payload.error === "string"
              ? payload.error
              : null) ?? "Unable to load credits."
          );
        }

        setState({
          loading: false,
          error: null,
          remaining:
            typeof payload.credits === "number" ? payload.credits : null,
          tier: typeof payload.tier === "string" ? payload.tier : null,
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          loading: false,
          error:
            error instanceof Error ? error.message : "Unable to load credits.",
          remaining: null,
          tier: null,
        });
      }
    };

    void fetchCredits();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const handleCreditsUpdated = (event: Event) => {
      const detail =
        (event as CustomEvent<CreditsUpdatedDetail>).detail ?? undefined;
      if (!detail) return;
      setState((prev) => ({
        ...prev,
        remaining:
          typeof detail.remaining === "number" || detail.remaining === null
            ? detail.remaining
            : prev.remaining,
        tier:
          typeof detail.tier === "string" || detail.tier === null
            ? detail.tier
            : prev.tier,
      }));
    };
    window.addEventListener("credits-updated", handleCreditsUpdated as EventListener);
    return () => {
      window.removeEventListener(
        "credits-updated",
        handleCreditsUpdated as EventListener
      );
    };
  }, [enabled]);

  return state;
}

export default function HeaderNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const credits = useCredits(Boolean(user));
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const creditsLabel = useMemo(() => {
    if (!user) return null;
    const tierKey = getNormalizedTier(credits.tier ?? undefined);
    const limit = getCreditLimit(tierKey);
    if (credits.loading) return `Credits: …/${limit}`;
    if (credits.error || credits.remaining === null) {
      return "Credits: ?";
    }
    return `Credits: ${credits.remaining}/${limit}`;
  }, [credits, user]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    const { error } = await signOut();
    if (!error) {
      setToast("Signed out.");
      router.push("/");
    }
    setSigningOut(false);
  };

  const navLinks = (
    <>
      {creditsLabel && (
        <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
          {creditsLabel}
        </span>
      )}
      <Link
        href="/library"
        className={`${BUTTON_CLASS} ${
          pathname === "/library" ? "border-sky-400/70 bg-white/10" : ""
        }`}
      >
        Library
      </Link>
      <Link
        href="/account"
        className={`${BUTTON_CLASS} ${
          pathname === "/account" ? "border-sky-400/70 bg-white/10" : ""
        }`}
      >
        Account
      </Link>
      {user ? (
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className={`${BUTTON_CLASS} disabled:cursor-not-allowed disabled:border-white/15 disabled:text-white/50`}
        >
          {signingOut ? "Signing out…" : "Sign Out"}
        </button>
      ) : (
        <Link href="/auth" className={BUTTON_CLASS}>
          Sign In
        </Link>
      )}
    </>
  );

  return (
    <>
      <header className="relative z-20 mb-10 flex flex-wrap items-center justify-between gap-4 rounded-full border border-white/10 bg-black/40 pl-8 pr-5 py-4 text-sm backdrop-blur">
        <Link
          href="/"
          aria-label="Go to home"
          className="flex items-center translate-y-0 shadow-none transition-none hover:!translate-y-0 hover:!shadow-none focus-visible:!translate-y-0 focus-visible:!shadow-none active:!translate-y-0 active:!shadow-none"
        >
        <Image
          src="/assets/tuneterminallogo.png"
          alt="Tune Terminal logo"
          width={240}
          height={240}
          className="header-logo h-9 w-auto"
          priority
        />
      </Link>
      <nav className="hidden items-center gap-3 lg:flex">{navLinks}</nav>
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-sky-400/70 hover:bg-white/5 lg:hidden"
        aria-expanded={menuOpen}
        aria-label="Toggle navigation"
      >
        Menu
        <span className="relative h-2 w-3.5">
          <span
            className={`absolute inset-x-0 top-0 h-0.5 bg-white transition ${menuOpen ? "translate-y-1 rotate-45" : ""}`}
          />
          <span
            className={`absolute inset-x-0 top-1 h-0.5 bg-white transition ${menuOpen ? "opacity-0" : ""}`}
          />
          <span
            className={`absolute inset-x-0 top-2 h-0.5 bg-white transition ${menuOpen ? "-translate-y-1 -rotate-45" : ""}`}
          />
        </span>
      </button>
      {toast && (
        <div className="absolute left-1/2 top-full mt-3 w-max -translate-x-1/2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-emerald-200 shadow-lg shadow-emerald-500/20">
          {toast}
        </div>
      )}
      </header>
      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="Close menu background"
          />
          <aside className="absolute right-0 top-0 flex h-full w-[min(320px,85vw)] flex-col gap-6 bg-black/90 px-6 py-8 shadow-2xl">
            <div className="flex items-center justify-between">
              <Image
                src="/assets/tuneterminallogo.png"
                alt="Tune Terminal logo"
                width={180}
                height={180}
                className="h-8 w-auto"
              />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white transition hover:border-white/40 hover:bg-white/5"
              >
                Close
              </button>
            </div>
            <div className="flex flex-col gap-4 text-sm uppercase tracking-[0.3em] text-slate-300">
              {creditsLabel && <span>{creditsLabel}</span>}
              <Link
                href="/library"
                onClick={() => setMenuOpen(false)}
                className={`${BUTTON_CLASS} ${
                  pathname === "/library" ? "border-sky-400/70 bg-white/10" : ""
                }`}
              >
                Library
              </Link>
              <Link
                href="/account"
                onClick={() => setMenuOpen(false)}
                className={`${BUTTON_CLASS} ${
                  pathname === "/account" ? "border-sky-400/70 bg-white/10" : ""
                }`}
              >
                Account
              </Link>
              {user ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void handleSignOut();
                  }}
                  disabled={signingOut}
                  className={`${BUTTON_CLASS} disabled:cursor-not-allowed disabled:border-white/15 disabled:text-white/50`}
                >
                  {signingOut ? "Signing out…" : "Sign Out"}
                </button>
              ) : (
                <Link
                  href="/auth"
                  onClick={() => setMenuOpen(false)}
                  className={BUTTON_CLASS}
                >
                  Sign In
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
