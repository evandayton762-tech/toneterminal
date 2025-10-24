"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import HeaderNav from "@/components/HeaderNav";
import ParticlesBackground from "@/components/ParticlesBackground";
import PluginCard from "@/components/PluginCard";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { supabase } from "@/lib/supabaseClient";
import {
  getCreditLimit,
  getPlan,
  getPlanLabel,
  getNormalizedTier,
  isPaidTier,
  getPlanPrice,
} from "@/lib/plan";
import { dawIdToLabel, labelToDawId } from "@/lib/daws";
import { pluginsForDAW } from "@/lib/pluginInventory";
import type { DawId } from "@/data/daws";
import type { PluginPreset } from "@/types/plugins";
import { NATIVE_EXPORTER_INFO } from "@/data/nativeExporters";

type ProfileSummary = {
  credits: number | null;
  tier: string | null;
  loading: boolean;
  error: string | null;
};

type ChainSummary = {
  id: string;
  daw: string;
  clip_start: number;
  clip_end: number;
  duration: number;
  created_at: string;
  plugins: PluginPreset[];
  summary?: string | null;
  features?: Record<string, unknown> | null;
  tags?: string[] | null;
  favorite?: boolean | null;
  folder_id?: string | null;
};

type HistoryState<T> = {
  loading: boolean;
  items: T[];
  error: string | null;
};

type AccountTab = "overview" | "premium" | "saved" | "history" | "preferences";

const ACCOUNT_TABS: { id: AccountTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "premium", label: "Premium Profiles" },
  { id: "saved", label: "Saved Presets" },
  { id: "history", label: "History" },
  { id: "preferences", label: "Preferences" },
];

const ACTION_BUTTON_CLASS =
  "terminal-button rounded-full border border-white/30 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.35em] text-white transition hover:border-sky-400/70 hover:bg-white/5 active:shadow-inner active:bg-white/10";

type DetectedSongFeature = {
  title?: string;
  artist?: string;
  album?: string | null;
  timecode?: string | null;
};

const extractDetectedSong = (
  features?: Record<string, unknown> | null
): DetectedSongFeature | null => {
  if (!features || typeof features !== "object") {
    return null;
  }
  const raw = (features as Record<string, unknown>).detected_song;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return {
    title:
      typeof (raw as { title?: unknown }).title === "string"
        ? (raw as { title: string }).title
        : undefined,
    artist:
      typeof (raw as { artist?: unknown }).artist === "string"
        ? (raw as { artist: string }).artist
        : undefined,
    album:
      typeof (raw as { album?: unknown }).album === "string"
        ? (raw as { album: string }).album
        : null,
    timecode:
      typeof (raw as { timecode?: unknown }).timecode === "string"
        ? (raw as { timecode: string }).timecode
        : null,
  };
};

const formatSeconds = (value: number) => {
  const clamped = Math.max(0, value);
  const minutes = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(clamped % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const buildClipWindowLabel = (start: number, end: number, maxSeconds: number) => {
  const windowLength = Math.max(0, end - start);
  return `${formatSeconds(start)} → ${formatSeconds(end)} (${formatSeconds(
    Math.min(windowLength, maxSeconds)
  )} of max ${formatSeconds(maxSeconds)})`;
};

export default function AccountPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<ProfileSummary>({
    credits: null,
    tier: null,
    loading: true,
    error: null,
  });
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<HistoryState<ChainSummary>>({
    loading: true,
    items: [],
    error: null,
  });
  const [presetHistory, setPresetHistory] = useState<HistoryState<ChainSummary>>({
    loading: true,
    items: [],
    error: null,
  });
  const [selectedChain, setSelectedChain] = useState<{
    title: string;
    subtitle: string;
    plugins: PluginPreset[];
    summary?: string | null;
    features?: Record<string, unknown> | null;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [profileDaw, setProfileDaw] = useState<DawId>("fl_studio");
  const [profilePlugins, setProfilePlugins] = useState<string[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AccountTab>("overview");
  const { theme, setTheme } = useTheme();
  const isLight = theme === "light";

  const planKey = getNormalizedTier(profile.tier);
  const planLabel = getPlanLabel(planKey);
  const planPrice = getPlanPrice(planKey);
  const creditLimit = getCreditLimit(planKey);
  const creditsRemaining = profile.credits ?? 0;
  const limitReached =
    !profile.loading && !profile.error && creditsRemaining <= 0;
  const currentPlan = getPlan(planKey);
  const premiumEnabled = currentPlan.canUsePremiumInventory;
  const canExportPreset = currentPlan.canExportPreset;
  const allowedProfileDaws = currentPlan.allowedDAWs;
  const premiumOptions = useMemo(
    () => pluginsForDAW(profileDaw),
    [profileDaw]
  );
  const canAccessLibrary = currentPlan.canAccessLibrary;
  const headingClass = isLight ? "text-slate-900" : "text-white";
  const subheadingClass = isLight ? "text-slate-600" : "text-slate-400";
  const tabButtonClass = useCallback(
    (tab: AccountTab) =>
      `rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] transition ${
        activeTab === tab
          ? "border-sky-400/70 bg-sky-500/20 text-white"
          : "border-white/20 text-slate-300 hover:border-white/40 hover:bg-white/5"
      }`,
    [activeTab]
  );

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (!supabase) return null;
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    if (error || !session?.access_token) {
      setToast("Session expired. Please sign in again.");
      return null;
    }
    return session.access_token;
  }, [setToast]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const applyHash = () => {
      const raw = window.location.hash.replace("#", "");
      if (raw === "premium" || raw === "saved" || raw === "history" || raw === "preferences" || raw === "overview") {
        setActiveTab((raw === "" ? "overview" : (raw as AccountTab)) || "overview");
      } else if (raw === "") {
        setActiveTab("overview");
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useEffect(() => {
    if (!user || !supabase) {
      setProfile((prev) => ({ ...prev, loading: false }));
      setAnalysisHistory((prev) => ({ ...prev, loading: false }));
      setPresetHistory((prev) => ({ ...prev, loading: false }));
      return;
    }

    let cancelled = false;

    const loadAccountData = async () => {
      setProfile((prev) => ({ ...prev, loading: true, error: null }));
      setAnalysisHistory((prev) => ({ ...prev, loading: true, error: null }));
      setPresetHistory((prev) => ({ ...prev, loading: true, error: null }));

      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error || !session?.access_token) {
        if (!cancelled) {
          setProfile({
            credits: null,
            tier: null,
            loading: false,
            error: error ? error.message : "Session expired. Please sign in again.",
          });
        }
        return;
      }

      const headers = {
        Authorization: `Bearer ${session.access_token}`,
      };

      const [profileResponse, analysesResponse, presetsResponse] = await Promise.all([
        fetch("/api/check-credits", { headers }),
        fetch("/api/analyses", { headers }),
        fetch("/api/presets", { headers }),
      ]);

      const profilePayload = await profileResponse.json().catch(() => null);
      const analysesPayload = await analysesResponse.json().catch(() => null);
      const presetsPayload = await presetsResponse.json().catch(() => null);

      if (cancelled) return;

      if (!profileResponse.ok || !profilePayload) {
        setProfile({
          credits: null,
          tier: null,
          loading: false,
          error:
            (profilePayload && typeof profilePayload.error === "string"
              ? profilePayload.error
              : null) ?? "Unable to load profile.",
        });
      } else {
        setProfile({
          credits:
            typeof profilePayload.credits === "number"
              ? profilePayload.credits
              : null,
          tier:
            typeof profilePayload.tier === "string"
              ? profilePayload.tier
              : null,
          loading: false,
          error: null,
        });
      }

      if (!analysesResponse.ok || !analysesPayload) {
        setAnalysisHistory({
          loading: false,
          items: [],
          error:
            (analysesPayload && typeof analysesPayload.error === "string"
              ? analysesPayload.error
              : null) ?? "Unable to load history.",
        });
      } else {
        setAnalysisHistory({
          loading: false,
          items: Array.isArray(analysesPayload.items)
            ? (analysesPayload.items as ChainSummary[])
            : [],
          error: null,
        });
      }

      if (!presetsResponse.ok || !presetsPayload) {
        setPresetHistory({
          loading: false,
          items: [],
          error:
            (presetsPayload && typeof presetsPayload.error === "string"
              ? presetsPayload.error
              : null) ?? "Unable to load presets.",
        });
      } else {
        setPresetHistory({
          loading: false,
          items: Array.isArray(presetsPayload.items)
            ? (presetsPayload.items as ChainSummary[])
            : [],
          error: null,
        });
      }
    };

    void loadAccountData();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!premiumEnabled) {
      setProfilePlugins([]);
      return;
    }
    const firstAllowed = allowedProfileDaws[0] ?? "fl_studio";
    setProfileDaw((prev) =>
      allowedProfileDaws.includes(prev) ? prev : firstAllowed
    );
  }, [premiumEnabled, allowedProfileDaws]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!premiumEnabled || !user) {
        setProfileLoading(false);
        setProfileError(null);
        setProfilePlugins([]);
        return;
      }

      setProfileLoading(true);
      setProfileError(null);

      const token = await getAccessToken();
      if (!token) {
        setProfileLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/plugin-profile?daw=${profileDaw}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload) {
          throw new Error(
            (payload && typeof payload.error === "string"
              ? payload.error
              : null) ?? "Unable to load plugin profile."
          );
        }

        const plugins = Array.isArray(payload.profile?.plugins)
          ? (payload.profile.plugins as string[])
          : [];
        setProfilePlugins(plugins);
        setProfileError(null);
      } catch (error) {
        setProfileError(
          error instanceof Error
            ? error.message
            : "Unable to load plugin profile."
        );
        setProfilePlugins([]);
      } finally {
        setProfileLoading(false);
      }
    };

    void loadProfile();
  }, [premiumEnabled, profileDaw, user, getAccessToken]);

  const openChain = (
    title: string,
    subtitle: string,
    plugins: PluginPreset[],
    summary?: string | null,
    features?: Record<string, unknown> | null
  ) => {
    setSelectedChain({ title, subtitle, plugins, summary, features });
  };

  const toggleProfilePlugin = (slug: string) => {
    setProfilePlugins((prev) =>
      prev.includes(slug)
        ? prev.filter((item) => item !== slug)
        : [...prev, slug]
    );
  };

  const handleProfileSave = async () => {
    if (!premiumEnabled) return;
    const token = await getAccessToken();
    if (!token) return;
    setProfileSaving(true);
    setProfileError(null);
    try {
      const response = await fetch(`/api/plugin-profile?daw=${profileDaw}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plugins: profilePlugins }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to save plugin profile."
        );
      }
      const saved = Array.isArray(payload.profile?.plugins)
        ? (payload.profile.plugins as string[])
        : [];
      setProfilePlugins(saved);
      setToast("Premium profile saved.");
    } catch (error) {
      setProfileError(
        error instanceof Error
          ? error.message
          : "Unable to save plugin profile."
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const handleProfileClear = async () => {
    if (!premiumEnabled) return;
    const token = await getAccessToken();
    if (!token) return;
    setProfileSaving(true);
    setProfileError(null);
    try {
      const response = await fetch(`/api/plugin-profile?daw=${profileDaw}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to delete plugin profile."
        );
      }
      setProfilePlugins([]);
      setToast("Premium profile cleared.");
    } catch (error) {
      setProfileError(
        error instanceof Error
          ? error.message
          : "Unable to delete plugin profile."
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const handleViewChain = (chain: ChainSummary, prefix: string) => {
    openChain(
      chain.daw,
      `${prefix} ${new Date(chain.created_at).toLocaleString()}`,
      chain.plugins,
      chain.summary ?? null,
      chain.features ?? null
    );
  };

  const handleExportChain = async (chain: ChainSummary) => {
    if (!canExportPreset) {
      setToast("Upgrade your plan to export presets.");
      return;
    }

    const clipWindow = buildClipWindowLabel(chain.clip_start, chain.clip_end, chain.duration || 15);
    const detectedSong = extractDetectedSong(chain.features ?? null);
    const headers = await withSessionHeaders();
    if (!headers) return;

    try {
      const response = await fetch("/api/export-preset", {
        method: "POST",
        headers,
        body: JSON.stringify({
          daw: chain.daw,
          summary: chain.summary ?? null,
          clipWindow,
          song: detectedSong,
          plugins: chain.plugins,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to export preset."
        );
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?(.+?)"?$/);
      const filename = match ? match[1] : `${chain.daw.replace(/\s+/g, "_")}_chain`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      const nativeHeader = response.headers.get("X-ToneTerminal-Native");
      const targetHeader = response.headers.get("X-ToneTerminal-Target");
      if (nativeHeader === "true") {
        setToast(
          targetHeader && targetHeader !== "manual"
            ? `Native preset downloaded (${targetHeader}).`
            : "Native preset downloaded."
        );
      } else {
        setToast(
          "Manual setup ZIP downloaded (README included). Native preset coming soon—Pro members get early access."
        );
      }
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "Unable to export preset."
      );
    }
  };

  const withSessionHeaders = async () => {
    if (!supabase) return null;
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    if (error || !session?.access_token) {
      setToast("Session expired. Please sign in again.");
      return null;
    }
    return {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    } as Record<string, string>;
  };

  const handleDeletePreset = async (id: string) => {
    const headers = await withSessionHeaders();
    if (!headers) return;

    const previousItems = presetHistory.items.map((item) => ({ ...item }));
    setPresetHistory((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id),
    }));

    try {
      const response = await fetch(`/api/presets/${id}`, {
        method: "DELETE",
        headers,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to delete preset."
        );
      }
      setToast("Preset deleted.");
    } catch (caught) {
      setPresetHistory((prev) => ({
        ...prev,
        items: previousItems,
      }));
      setToast(
        caught instanceof Error ? caught.message : "Unable to delete preset."
      );
    }
  };

  const handleRestyleChain = async (chain: ChainSummary) => {
    const input = window.prompt(
      "How should this chain be re-styled? (e.g. 'wider ambience with smoother top end')"
    );
    if (input === null) return;
    const stylePrompt = input.trim();
    if (!stylePrompt) {
      setToast("Enter a direction to re-style the chain.");
      return;
    }

    const headers = await withSessionHeaders();
    if (!headers) return;

    try {
      const response = await fetch("/api/restyle", {
        method: "POST",
        headers,
        body: JSON.stringify({
          daw: chain.daw,
          plugins: chain.plugins,
          stylePrompt,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || !Array.isArray(payload.plugins)) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to re-style chain."
        );
      }

      openChain(
        chain.daw,
        `Re-styled • ${new Date().toLocaleString()}`,
        payload.plugins as PluginPreset[],
        null,
        null
      );
      setToast("Re-style ready.");
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "Unable to re-style chain."
      );
    }
  };

  const handleSaveHistoryPreset = async (chain: ChainSummary) => {
    if (!canAccessLibrary) {
      setToast("Upgrade to Standard to save chains to your library.");
      return;
    }

    const headers = await withSessionHeaders();
    if (!headers) return;

    try {
      const response = await fetch("/api/save-analysis", {
        method: "POST",
        headers,
        body: JSON.stringify({
          daw: chain.daw,
          clipStart: chain.clip_start,
          clipEnd: chain.clip_end,
          duration: chain.duration,
          plugins: chain.plugins,
          summary: chain.summary ?? null,
          features: chain.features ?? null,
          tags: chain.tags ?? [],
          favorite: false,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to save preset."
        );
      }

      const libraryResponse = await fetch("/api/presets", { headers });
      const libraryPayload = await libraryResponse.json().catch(() => null);
      if (libraryResponse.ok && libraryPayload && Array.isArray(libraryPayload.items)) {
        setPresetHistory({
          loading: false,
          items: libraryPayload.items as ChainSummary[],
          error: null,
        });
      }

      setToast("Preset added to your library.");
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "Unable to save preset."
      );
    }
  };

  const togglePresetFavorite = async (id: string) => {
    const target = presetHistory.items.find((item) => item.id === id);
    if (!target) return;

    const headers = await withSessionHeaders();
    if (!headers) return;

    const previousItems = presetHistory.items.map((item) => ({ ...item }));
    const nextFavorite = target.favorite ? !target.favorite : true;

    setPresetHistory((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === id
          ? { ...item, favorite: nextFavorite }
          : item
      ),
    }));

    try {
      const response = await fetch(`/api/presets/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ favorite: nextFavorite }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to update favorite."
        );
      }
      setToast(nextFavorite ? "Marked favorite." : "Favorite removed.");
    } catch (caught) {
      setPresetHistory((prev) => ({
        ...prev,
        items: previousItems,
      }));
      setToast(
        caught instanceof Error
          ? caught.message
          : "Unable to update favorite."
      );
    }
  };

  const handleTagPreset = async (id: string) => {
    const value = window.prompt("Add a tag (comma separated)");
    if (value === null) return;
    const tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    const headers = await withSessionHeaders();
    if (!headers) return;

    const previousItems = presetHistory.items.map((item) => ({ ...item }));
    setPresetHistory((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === id
          ? {
              ...item,
              tags,
            }
          : item
      ),
    }));

    try {
      const response = await fetch(`/api/presets/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ tags }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to update tags."
        );
      }
      setToast("Tags updated.");
    } catch (caught) {
      setPresetHistory((prev) => ({
        ...prev,
        items: previousItems,
      }));
      setToast(
        caught instanceof Error ? caught.message : "Unable to update tags."
      );
    }
  };

  const handleUpgrade = async () => {
    if (profile.loading || checkoutLoading) return;
    if (!supabase) {
      setCheckoutError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError(null);

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
        throw new Error("Session expired. Please sign in again.");
      }

      const response = await fetch("/api/checkout?planId=standard_15", {
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
      const message =
        error instanceof Error
          ? error.message
          : "Unable to start checkout. Please try again.";
      setCheckoutError(message);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleBuyCredits = () => {
    setToast("One-time purchases coming soon.");
  };

  const handleManageSubscription = async () => {
    if (portalLoading) return;
    setPortalLoading(true);
    setCheckoutError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setPortalLoading(false);
        return;
      }

      const response = await fetch("/api/customer-portal", {
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
            : null) ?? "Unable to open subscription settings."
        );
      }

      window.location.href = payload.url;
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Unable to manage subscription right now."
      );
    } finally {
      setPortalLoading(false);
    }
  };

  const handleTabChange = useCallback((tab: AccountTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const { pathname } = window.location;
      if (tab === "overview") {
        window.history.replaceState(null, "", pathname);
      } else {
        window.history.replaceState(null, "", `${pathname}#${tab}`);
      }
    }
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="text-sm text-slate-400">Loading account…</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <ParticlesBackground variant="subtle" />
      {selectedChain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6">
          <div className="surface-card flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl shadow-lg shadow-black/60">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
              <div>
                <h2 className="text-2xl font-semibold text-white">
                  {selectedChain.title}
                </h2>
                <p className="text-sm text-slate-400">{selectedChain.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedChain(null)}
                className="rounded-full border border-white/30 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white transition hover:border-white/60 hover:bg-white/5"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {selectedChain.summary && (
                <div className="surface-card mb-5 rounded-xl border px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    AI Summary
                  </p>
                  <p className="mt-2 text-sm italic text-slate-200">
                    {selectedChain.summary}
                  </p>
                  {/* TODO: Add a re-summarize control so users can request alternate takes. */}
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {selectedChain.plugins.map((plugin) => (
                  <PluginCard key={`${plugin.name}-${plugin.type}`} plugin={plugin} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="relative z-10 flex min-h-screen flex-col px-6 py-10 sm:px-10 lg:px-16">
        <HeaderNav />

        <button
          type="button"
          onClick={() => router.push("/")}
          className="terminal-button mt-4 mb-8 self-start rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-sky-400/70 hover:bg-white/5"
        >
          Back to Builder
        </button>

        {toast && (
          <div className="pointer-events-none fixed right-8 top-8 z-40 rounded-full border border-white/20 bg-black/60 px-4 py-2 text-xs uppercase tracking-[0.35em] text-white shadow-lg">
            {toast}
          </div>
        )}

        <nav className="mt-6 flex flex-wrap gap-2">
          {ACCOUNT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={tabButtonClass(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section className={activeTab === "overview" ? "mt-8 flex flex-col gap-4" : "hidden"}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold text-white sm:text-4xl">
                Account Center
              </h1>
              <p className="text-sm text-slate-400">
                Manage your plan, credits, and saved plugin chains.
              </p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-black/40 px-6 py-4 text-xs uppercase tracking-[0.3em] text-slate-300">
              <p>
                Plan: {planLabel}
                {planPrice ? ` • ${planPrice}` : ""}
              </p>
              <p>
                Credits: {profile.loading ? "…" : `${creditsRemaining}/${creditLimit}`}
              </p>
            </div>
          </div>

          {profile.error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs uppercase tracking-[0.3em] text-red-200">
              {profile.error}
            </p>
          )}

          {limitReached && (
            <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs uppercase tracking-[0.3em] text-amber-200">
              You’ve reached your limit. Upgrade to save more.
            </p>
          )}
        </section>

        <div className={activeTab === "overview" ? "mb-10 flex flex-wrap items-center gap-3" : "hidden"}>
          <button
            type="button"
            onClick={handleUpgrade}
            disabled={profile.loading || checkoutLoading || isPaidTier(planKey)}
            className="terminal-button rounded-full border border-white/30 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-sky-400/70 hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/15 disabled:text-white/50"
          >
            {isPaidTier(planKey)
              ? `${planLabel} Active`
              : checkoutLoading
              ? "Redirecting…"
              : "Upgrade to Standard"}
          </button>
          <button
            type="button"
            onClick={handleBuyCredits}
            className="terminal-button rounded-full border border-white/30 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-sky-400/70 hover:bg-white/5"
          >
            Buy More Credits
          </button>
          <button
            type="button"
            onClick={handleManageSubscription}
            disabled={portalLoading}
            className="terminal-button rounded-full border border-white/30 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white/60 hover:bg-white/5"
          >
            {portalLoading ? "Opening…" : "Manage Subscription"}
          </button>
        </div>

        {activeTab === "overview" && checkoutError && (
          <p className="mb-8 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs uppercase tracking-[0.3em] text-red-200">
            {checkoutError}
          </p>
        )}

        <section className={activeTab === "premium" ? "mt-12" : "hidden"}>
          <h2 className="text-xl font-semibold text-white">Premium Plugin Profile</h2>
          <p className="text-sm text-slate-400">
            Save one premium plugin profile per DAW. Analyze will auto-apply it when available.
          </p>

          {!premiumEnabled ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/40 px-5 py-6 text-center">
              <p className="text-sm text-slate-300">
                Upgrade to Standard or Pro to manage premium plugin profiles.
              </p>
              <Link
                href="/pricing"
                className="mt-3 inline-flex rounded-full border border-white/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white transition hover:border-sky-400/70 hover:bg-white/5"
              >
                View plans
              </Link>
            </div>
          ) : (
            <div className="mt-4 space-y-4 rounded-xl border border-white/10 bg-black/40 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    DAW
                  </label>
                  <select
                    value={profileDaw}
                    onChange={(event) => setProfileDaw(event.target.value as DawId)}
                    className="rounded-md border border-white/20 bg-black/60 px-4 py-3 text-sm text-white outline-none transition hover:border-white/40 focus:border-white"
                  >
                    {allowedProfileDaws.map((dawId) => (
                      <option key={dawId} value={dawId} className="bg-black text-white">
                        {dawIdToLabel(dawId)}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
                    Profile auto-applies for {dawIdToLabel(profileDaw)} on Analyze.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    Premium plugins in profile
                  </label>
                  <div className="max-h-56 overflow-y-auto rounded-md border border-white/15 bg-black/50 p-3">
                    {profileLoading ? (
                      <p className="text-sm text-slate-400">Loading…</p>
                    ) : premiumOptions.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        No compatible premium plugins found for this DAW.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {premiumOptions.map((plugin) => (
                          <li key={plugin.slug}>
                            <label className="flex items-center gap-2 text-sm text-slate-200">
                              <input
                                type="checkbox"
                                checked={profilePlugins.includes(plugin.slug)}
                                onChange={() => toggleProfilePlugin(plugin.slug)}
                                disabled={profileSaving}
                                className="h-3.5 w-3.5 rounded border-white/30 bg-black/60"
                              />
                              <span>
                                <span className="text-slate-200">{plugin.vendor}</span> — {plugin.name}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
              {profileError && (
                <p className="text-xs text-red-300">{profileError}</p>
              )}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleProfileSave}
                  disabled={profileSaving || profileLoading}
                  className="terminal-button rounded-full border border-white/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white transition hover:border-white/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/15 disabled:text-white/50"
                >
                  {profileSaving ? "Saving…" : "Save Profile"}
                </button>
                <button
                  type="button"
                  onClick={handleProfileClear}
                  disabled={profileSaving || profileLoading || profilePlugins.length === 0}
                  className="terminal-button rounded-full border border-white/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white transition hover:border-white/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/15 disabled:text-white/50"
                >
                  Clear Profile
                </button>
              </div>
            </div>
          )}
        </section>

        {canAccessLibrary ? (
          <>
            <section className={activeTab === "saved" ? "mt-12" : "hidden"}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={`text-xl font-semibold ${headingClass}`}>Saved presets</h2>
                  <p className={`text-sm ${subheadingClass}`}>
                    Bookmarks you saved manually for quick recall.
                  </p>
                </div>
              </div>

              {presetHistory.loading ? (
                <p className="mt-4 text-sm text-slate-400">Loading presets…</p>
              ) : presetHistory.error ? (
                <p className="mt-4 text-sm text-red-300">{presetHistory.error}</p>
              ) : presetHistory.items.length === 0 ? (
                <div className="surface-card mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-white/20 px-5 py-6 text-center">
                  <p className="text-sm text-slate-400">
                    No saved chains yet. Analyze a clip to create your first.
                  </p>
                  <Link
                    href="/"
                    className="mx-auto rounded-full border border-white/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white transition hover:border-sky-400/70 hover:bg-white/5"
                  >
                    Analyze a clip
                  </Link>
                </div>
              ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {presetHistory.items.map((item) => {
                const detectedSong = extractDetectedSong(item.features ?? null);
                const dawId = labelToDawId(item.daw);
                const exportMeta = dawId && dawId in NATIVE_EXPORTER_INFO
                  ? NATIVE_EXPORTER_INFO[dawId as keyof typeof NATIVE_EXPORTER_INFO]
                  : null;
                return (
                  <li
                    key={item.id}
                    className="surface-card rounded-2xl border px-5 py-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <p className="text-lg font-semibold text-white">{item.daw}</p>
                          <button
                            type="button"
                            onClick={() => void togglePresetFavorite(item.id)}
                            className={`text-lg transition ${
                              item.favorite ? "text-yellow-300" : "text-slate-400"
                            } hover:text-yellow-300`}
                            aria-label={
                              item.favorite ? "Remove favorite" : "Mark favorite"
                            }
                          >
                            {item.favorite ? "★" : "☆"}
                          </button>
                        </div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                          {new Date(item.created_at).toLocaleString()}
                        </p>
                        <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">
                          {exportMeta
                            ? `Native format: ${exportMeta.fileExtension} (${exportMeta.label})`
                            : "Manual setup ZIP (instructions included • native preset coming soon)"}
                        </p>
                        {detectedSong && (
                          <p className="mt-1 text-[10px] uppercase tracking-[0.35em] text-slate-500">
                            Detected: {detectedSong.title ?? "Unknown"} by {detectedSong.artist ?? "Unknown"}
                            {detectedSong.timecode ? ` @ ${detectedSong.timecode}` : ""}
                          </p>
                        )}
                        {item.tags?.length ? (
                          <p className="mt-1 text-[10px] uppercase tracking-[0.35em] text-slate-500">
                            {item.tags.join(" · ")}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end gap-2 text-sm text-slate-300">
                        <p>
                          Clip {item.clip_start.toFixed(1)}s → {item.clip_end.toFixed(1)}s
                        </p>
                        <p>{item.plugins.length} plugins saved</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleViewChain(item, "Saved preset •")}
                            className={ACTION_BUTTON_CLASS}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleExportChain(item)}
                            className={`${ACTION_BUTTON_CLASS} ${
                              canExportPreset ? "" : "cursor-not-allowed opacity-60"
                            }`}
                            disabled={!canExportPreset}
                          >
                            Export
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleTagPreset(item.id)}
                            className={ACTION_BUTTON_CLASS}
                          >
                            Tag
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeletePreset(item.id)}
                            className={ACTION_BUTTON_CLASS}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
              )}
            </section>

            <section className={activeTab === "history" ? "mt-12" : "hidden"}>
              <h2 className={`text-xl font-semibold ${headingClass}`}>Recent analyses</h2>
              <p className={`text-sm ${subheadingClass}`}>
                Last 10 plugin chains generated for your account.
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.3em] text-amber-300">
                History items are automatically removed after 48 hours unless you add them to your library.
              </p>

              {analysisHistory.loading ? (
                <p className="mt-4 text-sm text-slate-400">Loading history…</p>
              ) : analysisHistory.error ? (
                <p className="mt-4 text-sm text-red-300">{analysisHistory.error}</p>
              ) : analysisHistory.items.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400">
                  No analyses yet. Upload a clip to generate your first chain.
                </p>
              ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {analysisHistory.items.map((item) => {
                const detectedSong = extractDetectedSong(item.features ?? null);
                return (
                  <li
                    key={item.id}
                    className="surface-card rounded-2xl border px-5 py-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-lg font-semibold text-white">
                          {item.daw}
                        </p>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                          {new Date(item.created_at).toLocaleString()}
                        </p>
                        {detectedSong && (
                          <p className="mt-1 text-[10px] uppercase tracking-[0.35em] text-slate-500">
                            Detected: {detectedSong.title ?? "Unknown"} by {detectedSong.artist ?? "Unknown"}
                            {detectedSong.timecode ? ` @ ${detectedSong.timecode}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 text-sm text-slate-300">
                        <p>
                          Clip {item.clip_start.toFixed(1)}s → {item.clip_end.toFixed(1)}s
                        </p>
                        <p>{item.plugins.length} plugins suggested</p>
                        <div className="flex gap-2">
                          {canAccessLibrary && (
                            <button
                              type="button"
                              onClick={() => void handleSaveHistoryPreset(item)}
                              className={ACTION_BUTTON_CLASS}
                            >
                              Add to Library
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleViewChain(item, "Generated")}
                            className={ACTION_BUTTON_CLASS}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRestyleChain(item)}
                            className={ACTION_BUTTON_CLASS}
                          >
                            Re-Style
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
              )}
            </section>
          </>
        ) : (
          <>
            {(activeTab === "saved" || activeTab === "history") && (
              <section className="mt-12">
                <div className="surface-card rounded-2xl px-6 py-8 text-center">
                  <p className="text-sm text-slate-300">
                    Library access is available on Standard and Pro plans. Upgrade to save,
                    organize, and revisit your chains.
                  </p>
                  <Link
                    href="/pricing"
                    className="mt-4 inline-flex rounded-full border border-white/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white transition hover:border-sky-400/70 hover:bg-white/5"
                  >
                    View plans
                  </Link>
                </div>
              </section>
            )}
          </>
        )}

        <section className={activeTab === "preferences" ? "mt-12" : "hidden"}>
          <div className="surface-card rounded-2xl px-6 py-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className={`text-xl font-semibold ${headingClass}`}>Preferences</h2>
                <p className={`text-sm ${subheadingClass}`}>
                  Personalize your workspace appearance.
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Theme</p>
                <p className={`text-sm ${subheadingClass}`}>
                  {theme === "light"
                    ? "Light mode brightens the interface for well-lit rooms."
                    : "Dark mode keeps the UI low-glare for late sessions."}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] transition ${
                    theme === "dark"
                      ? "border-sky-400/70 bg-sky-500/20 text-white"
                      : "border-white/20 text-slate-300 hover:border-white/40 hover:bg-white/5"
                  }`}
                >
                  Dark
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] transition ${
                    theme === "light"
                      ? "border-sky-400/70 bg-sky-500/20 text-white"
                      : "border-white/20 text-slate-300 hover:border-white/40 hover:bg-white/5"
                  }`}
                >
                  Light
                </button>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="uppercase tracking-[0.3em]">Coming soon:</span>
              <span>notification controls, email summaries, and default export settings.</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
