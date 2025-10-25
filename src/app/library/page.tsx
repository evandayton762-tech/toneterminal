"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HeaderNav from "@/components/HeaderNav";
import ParticlesBackground from "@/components/ParticlesBackground";
import PluginCard from "@/components/PluginCard";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { getPlan, getNormalizedTier } from "@/lib/plan";
import { labelToDawId } from "@/lib/daws";
import { NATIVE_EXPORTER_INFO } from "@/data/nativeExporters";
import type { PluginPreset } from "@/types/plugins";

const ACTION_BUTTON_CLASS =
  "terminal-button rounded-full border border-white/30 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.35em] text-white transition hover:border-sky-400/70 hover:bg-white/5 active:shadow-inner active:bg-white/10";

const FILTER_INPUT_CLASS =
  "min-w-[260px] flex-1 rounded-full border border-white/20 bg-[color:var(--surface)] px-4 py-2 text-xs uppercase tracking-[0.3em] text-[color:var(--primary-text)] outline-none transition focus:border-sky-400/70";

type LibraryFolder = {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string | null;
};

type ViewMode = "list" | "grid";

const VIEW_MODE_STORAGE_KEY = "tone:library:view-mode";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readFeatureString = (
  features: unknown,
  key: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {}
): string | null => {
  if (!isRecord(features)) return null;
  const value = features[key];
  if (typeof value !== "string") return allowEmpty ? "" : null;
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) return null;
  return allowEmpty ? value : trimmed;
};

const ensureFeatures = (
  features: unknown
): Record<string, unknown> | null =>
  isRecord(features) ? { ...features } : null;

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

const extractDetectedSong = (
  features?: Record<string, unknown> | null
): { title?: string; artist?: string; timecode?: string | null } | null => {
  if (!features || typeof features !== "object") return null;
  const raw = (features as Record<string, unknown>).detected_song;
  if (!raw || typeof raw !== "object") return null;
  return {
    title:
      typeof (raw as { title?: unknown }).title === "string"
        ? (raw as { title: string }).title
        : undefined,
    artist:
      typeof (raw as { artist?: unknown }).artist === "string"
        ? (raw as { artist: string }).artist
        : undefined,
    timecode:
      typeof (raw as { timecode?: unknown }).timecode === "string"
        ? (raw as { timecode: string }).timecode
        : null,
  };
};

const extractSummary = (preset: {
  summary?: string | null;
  features?: Record<string, unknown> | null;
}): string | null => {
  if (typeof preset.summary === "string" && preset.summary.trim()) {
    return preset.summary.trim();
  }
  const fromFeatures =
    readFeatureString(preset.features ?? null, "ai_summary") ??
    readFeatureString(preset.features ?? null, "summary");
  return fromFeatures ?? null;
};

const extractNotes = (features: Record<string, unknown> | null | undefined) =>
  readFeatureString(features ?? null, "user_notes", { allowEmpty: true }) ?? "";

type PresetRecord = {
  id: string;
  daw: string;
  clip_start: number;
  clip_end: number;
  duration: number;
  created_at: string;
  plugins: PluginPreset[];
  summary?: string | null;
  features: Record<string, unknown> | null;
  tags?: string[] | null;
  favorite?: boolean | null;
  folder_id?: string | null;
};

type PresetState = {
  loading: boolean;
  items: PresetRecord[];
  error: string | null;
};

type SelectedView = {
  title: string;
  subtitle: string;
  plugins: PluginPreset[];
  summary?: string | null;
  features?: Record<string, unknown> | null;
};

type NotesEditorState = {
  id: string;
  daw: string;
  value: string;
  initialValue: string;
  saving: boolean;
  error: string | null;
};

export default function LibraryPage() {
  const { user } = useAuth();
  const [presets, setPresets] = useState<PresetState>({
    loading: true,
    items: [],
    error: null,
  });
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<"all" | "none" | string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [planTier, setPlanTier] = useState<string>("free");
  const [selected, setSelected] = useState<SelectedView | null>(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [notesEditor, setNotesEditor] = useState<NotesEditorState | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored === "grid" || stored === "list") {
      setViewMode(stored);
    }
  }, []);

  useEffect(() => {
    const loadPresets = async () => {
      if (!user || !supabase) {
        setPresets((prev) => ({ ...prev, loading: false }));
        setPlanTier("free");
        return;
      }

      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error || !session?.access_token) {
        setPresets({
          loading: false,
          items: [],
          error: error ? error.message : "Session expired.",
        });
        setPlanTier("free");
        return;
      }

      let tier = "free";
      try {
        const planResponse = await fetch("/api/check-credits", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const planPayload = await planResponse.json().catch(() => null);
        if (planResponse.ok && planPayload && typeof planPayload.tier === "string") {
          tier = planPayload.tier;
        }
      } catch {
        tier = "free";
      }

      setPlanTier(tier);
      const normalizedTier = getNormalizedTier(tier);
      const plan = getPlan(normalizedTier);

      if (!plan.canAccessLibrary) {
        setPresets((prev) => ({ ...prev, loading: false, items: [], error: null }));
        return;
      }

      try {
        const response = await fetch("/api/presets", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload) {
          throw new Error(
            (payload && typeof payload.error === "string"
              ? payload.error
              : null) ?? "Unable to load presets."
          );
        }

        const items = Array.isArray(payload.items)
          ? (payload.items as PresetRecord[]).map((item) => {
              const features = ensureFeatures(item.features);
              return {
                ...item,
                features,
                summary: extractSummary({ summary: item.summary, features }),
                tags: Array.isArray(item.tags) ? item.tags : [],
                favorite:
                  typeof item.favorite === "boolean" ? item.favorite : false,
              };
            })
          : [];

        setPresets({
          loading: false,
          items,
          error: null,
        });
      } catch (caught) {
        setPresets({
          loading: false,
          items: [],
          error:
            caught instanceof Error ? caught.message : "Unable to load presets.",
        });
      }
    };

    void loadPresets();
  }, [user]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  const currentPlanId = getNormalizedTier(planTier);
  const currentPlan = getPlan(currentPlanId);
  const canAccessLibrary = currentPlan.canAccessLibrary;
  const canExportPreset = currentPlan.canExportPreset;

  const toggleFavorite = async (id: string) => {
    const target = presets.items.find((item) => item.id === id);
    if (!target) return;
    const headers = await withSessionHeaders();
    if (!headers) return;

    const previousItems = presets.items.map((item) => ({ ...item }));
    const nextFavorite = target.favorite ? !target.favorite : true;

    setPresets((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === id
          ? {
              ...item,
              favorite: nextFavorite,
            }
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
      setPresets((prev) => ({
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

  const handleExport = async (preset: PresetRecord) => {
    if (!canExportPreset) {
      setToast("Upgrade your plan to export presets.");
      return;
    }

    const headers = await withSessionHeaders();
    if (!headers) return;

    const clipWindow = buildClipWindowLabel(preset.clip_start, preset.clip_end, preset.duration || 15);
    const detectedSong = extractDetectedSong(preset.features ?? null);

    try {
      const response = await fetch("/api/export-preset", {
        method: "POST",
        headers,
        body: JSON.stringify({
          daw: preset.daw,
          summary: preset.summary ?? null,
          clipWindow,
          song: detectedSong,
          plugins: preset.plugins,
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
      const filename = match ? match[1] : `${preset.daw.replace(/\s+/g, "_")}_chain`;

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

  const handleDelete = async (id: string) => {
    const headers = await withSessionHeaders();
    if (!headers) return;

    const previousItems = presets.items.map((item) => ({ ...item }));
    setPresets((prev) => ({
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
      setPresets((prev) => ({
        ...prev,
        items: previousItems,
      }));
      setToast(
        caught instanceof Error
          ? caught.message
          : "Unable to delete preset."
      );
    }
  };

  const withSessionHeaders = useCallback(async () => {
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
  }, [setToast]);

  const updateViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    }
  }, []);

  const loadFolders = useCallback(async () => {
    if (!supabase) return;
    const headers = await withSessionHeaders();
    if (!headers) return;
    setFoldersLoading(true);
    setFolderError(null);
    try {
      const response = await fetch("/api/library-folders", { headers });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to load folders."
        );
      }
      setFolders(Array.isArray(payload.items) ? payload.items : []);
    } catch (caught) {
      setFolderError(
        caught instanceof Error ? caught.message : "Unable to load folders."
      );
    } finally {
      setFoldersLoading(false);
    }
  }, [withSessionHeaders]);

  useEffect(() => {
    if (!user || !supabase) {
      setFolders([]);
      return;
    }
    if (!canAccessLibrary) {
      setFolders([]);
      return;
    }
    void loadFolders();
  }, [user, canAccessLibrary, loadFolders]);

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt("Folder name");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setToast("Folder name cannot be empty.");
      return;
    }
    const headers = await withSessionHeaders();
    if (!headers) return;
    try {
      const response = await fetch("/api/library-folders", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to create folder."
        );
      }
      setFolders((prev) => [...prev, payload]);
      setSelectedFolder(payload.id);
      setToast("Folder created.");
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "Unable to create folder."
      );
    }
  }, [withSessionHeaders]);

  const handleRenameFolder = useCallback(async (folderId: string) => {
    const current = folders.find((folder) => folder.id === folderId);
    const name = window.prompt("Rename folder", current?.name ?? "");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setToast("Folder name cannot be empty.");
      return;
    }
    const headers = await withSessionHeaders();
    if (!headers) return;
    try {
      const response = await fetch(`/api/library-folders/${folderId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to rename folder."
        );
      }
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === folderId ? { ...folder, name: trimmed } : folder
        )
      );
      setToast("Folder renamed.");
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "Unable to rename folder."
      );
    }
  }, [folders, withSessionHeaders]);

  const handleDeleteFolder = useCallback(async (folderId: string) => {
    const folder = folders.find((item) => item.id === folderId);
    const confirmed = window.confirm(
      `Delete folder "${folder?.name ?? "Unnamed"}"? Presets will remain in the library.`
    );
    if (!confirmed) return;
    const headers = await withSessionHeaders();
    if (!headers) return;
    try {
      const response = await fetch(`/api/library-folders/${folderId}`, {
        method: "DELETE",
        headers,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to delete folder."
        );
      }
      setFolders((prev) => prev.filter((item) => item.id !== folderId));
      setPresets((prev) => ({
        ...prev,
        items: prev.items.map((item) =>
          item.folder_id === folderId
            ? {
                ...item,
                folder_id: null,
              }
            : item
        ),
      }));
      if (selectedFolder === folderId) {
        setSelectedFolder("all");
      }
      setToast("Folder deleted.");
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "Unable to delete folder."
      );
    }
  }, [folders, selectedFolder, withSessionHeaders]);

  const handleMovePreset = useCallback(
    async (presetId: string, folderId: string | null) => {
      const headers = await withSessionHeaders();
      if (!headers) return;
      try {
        const response = await fetch(`/api/presets/${presetId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ folderId }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload) {
          throw new Error(
            (payload && typeof payload.error === "string"
              ? payload.error
              : null) ?? "Unable to move preset."
          );
        }
        setPresets((prev) => ({
          ...prev,
          items: prev.items.map((item) =>
            item.id === presetId
              ? {
                  ...item,
                  folder_id: folderId,
                }
              : item
          ),
        }));
        setToast("Preset updated.");
      } catch (caught) {
        setToast(
          caught instanceof Error ? caught.message : "Unable to move preset."
        );
      }
    },
    [withSessionHeaders]
  );

  const handleView = (preset: PresetRecord) => {
    const features = ensureFeatures(preset.features);
    setSelected({
      title: preset.daw,
      subtitle: `Saved preset • ${new Date(preset.created_at).toLocaleString()}`,
      plugins: preset.plugins,
      summary: extractSummary({ summary: preset.summary ?? null, features }),
      features,
    });
  };

  const handleRestyle = async (preset: PresetRecord) => {
    const input = window.prompt(
      "How should this chain be re-styled? (e.g. 'brighter pop sheen with tighter compression')"
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
          daw: preset.daw,
          plugins: preset.plugins,
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

      setSelected({
        title: `${preset.daw} (Re-styled)`,
        subtitle: `Re-styled • ${new Date().toLocaleString()}`,
        plugins: payload.plugins as PluginPreset[],
        summary: null,
        features: null,
      });
      setToast("Re-style ready.");
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "Unable to re-style chain."
      );
    }
  };

  const handleTag = async (id: string) => {
    const value = window.prompt("Add tags (comma separated)");
    if (value === null) return;
    const tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    const headers = await withSessionHeaders();
    if (!headers) return;

    const previousItems = presets.items.map((item) => ({ ...item }));
    setPresets((prev) => ({
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
      setPresets((prev) => ({
        ...prev,
        items: previousItems,
      }));
      setToast(
        caught instanceof Error ? caught.message : "Unable to update tags."
      );
    }
  };

  const handleNotes = (preset: PresetRecord) => {
    const features = ensureFeatures(preset.features);
    const existingNotes = extractNotes(features);
    setNotesEditor({
      id: preset.id,
      daw: preset.daw,
      value: existingNotes,
      initialValue: existingNotes,
      saving: false,
      error: null,
    });
  };

  const handleNotesChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = event.target;
    setNotesEditor((prev) => (prev ? { ...prev, value } : prev));
  };

  const handleNotesSave = async () => {
    if (!notesEditor) return;
    const headers = await withSessionHeaders();
    if (!headers) return;

    setNotesEditor((prev) =>
      prev ? { ...prev, saving: true, error: null } : prev
    );

    try {
      const response = await fetch(`/api/presets/${notesEditor.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ notes: notesEditor.value }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to save notes."
        );
      }

      const updatedFeatures = ensureFeatures(payload?.features ?? null);

      setPresets((prev) => ({
        ...prev,
        items: prev.items.map((item) => {
          if (item.id !== notesEditor.id) return item;
          const currentFeatures = ensureFeatures(item.features);
          const nextFeatures = updatedFeatures
            ? updatedFeatures
            : (() => {
                const base = currentFeatures ? { ...currentFeatures } : {};
                const trimmed = notesEditor.value;
                if (trimmed.trim().length > 0) {
                  base["user_notes"] = trimmed;
                } else {
                  delete base["user_notes"];
                }
                return Object.keys(base).length > 0 ? base : null;
              })();

          return {
            ...item,
            features: nextFeatures,
            summary: extractSummary({
              summary: item.summary ?? null,
              features: nextFeatures,
            }),
          };
        }),
      }));

      setNotesEditor(null);
      setToast("Notes saved.");
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Unable to save notes.";
      setNotesEditor((prev) =>
        prev ? { ...prev, saving: false, error: message } : prev
      );
    }
  };

  const viewButtonClass = useCallback(
    (mode: ViewMode) =>
      `rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.35em] transition ${
        viewMode === mode
          ? "border-white/70 bg-white/10 text-white"
          : "border-white/20 text-slate-400 hover:border-white/40 hover:bg-white/5 hover:text-white"
      }`,
    [viewMode]
  );

  const folderChipClass = useCallback(
    (active: boolean) =>
      `rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.35em] transition ${
        active
          ? "border-sky-400/70 bg-sky-500/20 text-white"
          : "border-white/15 text-slate-300 hover:border-white/40 hover:bg-white/5"
      }`,
    []
  );

  const filteredPresets = useMemo(() => {
    const normalized = query.toLowerCase();
    return presets.items.filter((preset) => {
      const matchesFolder =
        selectedFolder === "all"
          ? true
          : selectedFolder === "none"
          ? !preset.folder_id
          : preset.folder_id === selectedFolder;

      if (!matchesFolder) return false;

      if (!query) return true;

      const summaryText = extractSummary(preset) ?? "";
      const notesText = extractNotes(preset.features);
      return [
        preset.daw,
        summaryText,
        notesText,
        ...(preset.tags ?? []),
        ...preset.plugins.map((plugin) => plugin.name),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [presets.items, query, selectedFolder]);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <ParticlesBackground variant="subtle" />
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/70 shadow-lg shadow-black/60">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
              <div>
                <h2 className="text-2xl font-semibold text-white">{selected.title}</h2>
                <p className="text-sm text-slate-400">{selected.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-full border border-white/30 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white transition hover:border-white/60 hover:bg-white/5"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {selected.summary && (
                <div className="surface-card mb-5 rounded-xl p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    AI Summary
                  </p>
                  <p className="mt-2 text-sm italic text-slate-200">
                    {selected.summary}
                  </p>
                  {/* TODO: Provide a re-summarize option for alternate descriptions. */}
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {selected.plugins.map((plugin) => (
                  <PluginCard key={`${plugin.name}-${plugin.type}`} plugin={plugin} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {notesEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6">
          <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/70 shadow-lg shadow-black/60">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold text-white">
                  {notesEditor.daw} Notes
                </h2>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Private notes for this chain
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNotesEditor(null)}
                className="rounded-full border border-white/30 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white transition hover:border-white/60 hover:bg-white/5"
                disabled={notesEditor.saving}
              >
                Close
              </button>
            </div>
            <div className="px-6 py-5">
              <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Notes
              </label>
              <textarea
                value={notesEditor.value}
                onChange={handleNotesChange}
                placeholder="Add thoughts about this chain, vocal context, or next tweaks."
                className="mt-3 h-40 w-full resize-none rounded-xl border border-white/15 bg-black/50 p-3 text-sm text-white outline-none transition focus:border-sky-400/70"
                disabled={notesEditor.saving}
                autoFocus
              />
              {notesEditor.error && (
                <p className="mt-2 text-xs text-red-300">{notesEditor.error}</p>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-white/10 px-6 py-4">
              <button
                type="button"
                onClick={() => setNotesEditor(null)}
                className="rounded-full border border-white/30 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white transition hover:border-white/60 hover:bg-white/5"
                disabled={notesEditor.saving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleNotesSave()}
                className={`${ACTION_BUTTON_CLASS} ${
                  notesEditor.saving ||
                  notesEditor.value === notesEditor.initialValue
                    ? "pointer-events-none opacity-60"
                    : ""
                }`}
                disabled={
                  notesEditor.saving ||
                  notesEditor.value === notesEditor.initialValue
                }
              >
                {notesEditor.saving ? "Saving…" : "Save Notes"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="relative z-10 flex min-h-screen flex-col px-6 py-10 sm:px-10 lg:px-16">
        <HeaderNav />

        {toast && (
          <div className="pointer-events-none fixed right-8 top-8 z-40 rounded-full border border-white/20 bg-black/60 px-4 py-2 text-xs uppercase tracking-[0.35em] text-white shadow-lg">
            {toast}
          </div>
        )}

        <section className="mb-10 flex flex-col gap-3">
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">Library</h1>
          <p className="text-sm text-slate-400">
            All of your saved plugin chains, ready to reuse, share, or re-style.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by DAW, tag, or plugin"
              className={FILTER_INPUT_CLASS}
            />
            <button
              type="button"
              onClick={() => void handleCreateFolder()}
              className={ACTION_BUTTON_CLASS}
            >
              Add Folder
            </button>
            <Link href="/account#history" className={ACTION_BUTTON_CLASS}>
              Browse History
            </Link>
            <button type="button" className={ACTION_BUTTON_CLASS}>
              Compare Chains
            </button>
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.35em] text-slate-400">
              <span>View</span>
              <button
                type="button"
                onClick={() => updateViewMode("list")}
                className={viewButtonClass("list")}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => updateViewMode("grid")}
                className={viewButtonClass("grid")}
              >
                Grid
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedFolder("all")}
              className={folderChipClass(selectedFolder === "all")}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setSelectedFolder("none")}
              className={folderChipClass(selectedFolder === "none")}
            >
              No Folder
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => setSelectedFolder(folder.id)}
                className={folderChipClass(selectedFolder === folder.id)}
              >
                {folder.name}
              </button>
            ))}
            {foldersLoading && (
              <span className="text-[10px] uppercase tracking-[0.35em] text-slate-500">
                Loading…
              </span>
            )}
          </div>
          {folderError && (
            <p className="mt-2 text-xs text-red-300">{folderError}</p>
          )}
          {selectedFolder !== "all" && selectedFolder !== "none" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRenameFolder(selectedFolder)}
                className={ACTION_BUTTON_CLASS}
              >
                Rename Folder
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteFolder(selectedFolder)}
                className={`${ACTION_BUTTON_CLASS} border-red-400/40 text-red-200 hover:border-red-400/70 hover:bg-red-500/10`}
              >
                Delete Folder
              </button>
            </div>
          )}
          <p className="mt-2 text-xs uppercase tracking-[0.3em] text-amber-300">
            Unsaved analyses expire after 48 hours. Use Browse History to add any keeper to your library.
          </p>
        </section>

        {!canAccessLibrary ? (
          <div className="surface-card mt-6 flex flex-col gap-3 rounded-xl px-5 py-6 text-center">
            <p className="text-sm text-slate-300">
              Library access is available on Standard and Pro plans. Upgrade to save and revisit chains.
            </p>
            <Link
              href="/pricing"
              className="mx-auto rounded-full border border-white/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white transition hover:border-sky-400/70 hover:bg-white/5"
            >
              View plans
            </Link>
          </div>
        ) : presets.loading ? (
          <p className="text-sm text-slate-400">Loading presets…</p>
        ) : presets.error ? (
          <p className="text-sm text-red-300">{presets.error}</p>
        ) : filteredPresets.length === 0 ? (
          <div className="surface-card mt-6 flex flex-col gap-3 rounded-xl border border-dashed border-white/20 px-5 py-6 text-center">
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
          <div
            className={
              viewMode === "grid"
                ? "grid gap-4 sm:grid-cols-2"
                : "flex flex-col gap-4"
            }
          >
            {filteredPresets.map((preset) => {
              const detectedSong = extractDetectedSong(preset.features ?? null);
              const dawId = labelToDawId(preset.daw);
              const exportMeta = dawId && dawId in NATIVE_EXPORTER_INFO
                ? NATIVE_EXPORTER_INFO[dawId as keyof typeof NATIVE_EXPORTER_INFO]
                : null;
              const cardClass = `surface-card rounded-xl px-5 py-4 ${
                viewMode === "grid" ? "h-full" : ""
              }`;
              return (
                <div key={preset.id} className={cardClass}>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <p className="text-lg font-semibold text-white">
                          {preset.daw}
                        </p>
                        <button
                          type="button"
                          onClick={() => void toggleFavorite(preset.id)}
                          className={`text-lg transition ${
                            preset.favorite ? "text-yellow-300" : "text-slate-400"
                          } hover:text-yellow-300`}
                          aria-label={
                            preset.favorite ? "Remove favorite" : "Mark favorite"
                          }
                        >
                          {preset.favorite ? "★" : "☆"}
                        </button>
                      </div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                        {new Date(preset.created_at).toLocaleString()}
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
                      {preset.tags?.length ? (
                        <p className="mt-1 text-[10px] uppercase tracking-[0.35em] text-slate-500">
                          {preset.tags.join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2 text-sm text-slate-300">
                      <p>
                        Clip {preset.clip_start.toFixed(1)}s → {preset.clip_end.toFixed(1)}s
                      </p>
                      <p>{preset.plugins.length} plugins saved</p>
                      <div className="flex flex-col items-end gap-1 text-xs">
                        <span className="text-[10px] uppercase tracking-[0.35em] text-slate-500">
                          Folder
                        </span>
                        <select
                          value={preset.folder_id ?? ""}
                          onChange={(event) =>
                            void handleMovePreset(
                              preset.id,
                              event.target.value ? event.target.value : null
                            )
                          }
                          disabled={foldersLoading}
                          className="min-w-[150px] rounded-md border border-white/20 bg-black/60 px-3 py-1 text-xs text-white outline-none transition hover:border-white/40 focus:border-white"
                        >
                          <option value="" className="bg-black text-white">
                            No folder
                          </option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id} className="bg-black text-white">
                              {folder.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleView(preset)}
                          className={ACTION_BUTTON_CLASS}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleExport(preset)}
                          className={`${ACTION_BUTTON_CLASS} ${
                            canExportPreset ? "" : "cursor-not-allowed opacity-60"
                          }`}
                          disabled={!canExportPreset}
                        >
                          Export
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRestyle(preset)}
                          className={ACTION_BUTTON_CLASS}
                        >
                          Re-Style
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNotes(preset)}
                          className={ACTION_BUTTON_CLASS}
                        >
                          Notes
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleTag(preset.id)}
                          className={ACTION_BUTTON_CLASS}
                        >
                          Tag
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(preset.id)}
                          className={ACTION_BUTTON_CLASS}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
