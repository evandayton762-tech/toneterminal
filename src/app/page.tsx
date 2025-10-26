"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import ParticlesBackground from "@/components/ParticlesBackground";
import PluginCard from "@/components/PluginCard";
import HeaderNav from "@/components/HeaderNav";
import type { PluginPreset } from "@/types/plugins";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { getPlan, getNormalizedTier } from "@/lib/plan";
import { dawIdToLabel, listDaws, labelToDawId } from "@/lib/daws";
import { pluginsForDAW } from "@/lib/pluginInventory";
import type { DawId } from "@/data/daws";
import { NATIVE_EXPORTER_INFO } from "@/data/nativeExporters";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, {
  type Region,
} from "wavesurfer.js/dist/plugins/regions.esm.js";
type RegionsPluginFactory = ReturnType<typeof RegionsPlugin.create>;
type RegionsPluginInstance = ReturnType<RegionsPluginFactory>;
import { useRouter } from "next/navigation";

const MAX_CLIP_SECONDS = 15;
const DEFAULT_DAW_LABEL = dawIdToLabel("ableton_live");
type PremiumOption = ReturnType<typeof pluginsForDAW>[number];

type DetectedSong = {
  title: string;
  artist: string;
  album: string | null;
  releaseDate: string | null;
  label: string | null;
  timecode: string | null;
  songId: string | null;
  score: number | null;
  appleMusicUrl: string | null;
  spotifyUrl: string | null;
  genres: string[];
  lyrics: string | null;
};

type SampleTrack = {
  id: string;
  title: string;
  artist: string;
  src: string;
  cover: string;
  initials: string;
  gradientClass: string;
};

const SAMPLE_TRACKS = [
  {
    id: "sample-frank-ocean",
    title: "Eyes Like Sky",
    artist: "Frank Ocean [unreleased]",
    src: "/audio/Eyes Like Sky - Frank Ocean.mp3",
    cover: "/assets/eyeslikesky.png",
    initials: "FO",
    gradientClass: "from-sky-500/40 to-indigo-500/60",
  },
  {
    id: "sample-ceelo",
    title: "I'm a Fool",
    artist: "J. Cole & CeeLo Green",
    src: "/audio/I\u2019m a Fool (feat. CeeLo Green).mp3",
    cover: "/assets/imafool.png",
    initials: "CG",
    gradientClass: "from-emerald-500/40 to-teal-500/60",
  },
  {
    id: "sample-roddy-ricch",
    title: "Throw My Money Everywhere",
    artist: "ye",
    src: "/audio/Throw My Money Everywhere.mp3",
    cover: "/assets/goodassjob.png",
    initials: "RR",
    gradientClass: "from-amber-500/40 to-orange-500/60",
  },
  {
    id: "sample-the-weeknd",
    title: "Try Me (feat. Quavo)",
    artist: "The Weeknd",
    src: "/audio/Try Me (feat. Quavo).mp3",
    cover: "/assets/MyDearMelancholy.png",
    initials: "TW",
    gradientClass: "from-rose-500/40 to-purple-500/60",
  },
] satisfies readonly SampleTrack[];

type AudioContextConstructor = typeof AudioContext;

const getAudioContextConstructor = (): AudioContextConstructor => {
  if (typeof window === "undefined") {
    throw new Error("Audio context unavailable during server render.");
  }
  const win = window as Window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  if (win.AudioContext) return win.AudioContext;
  if (win.webkitAudioContext) return win.webkitAudioContext;
  throw new Error("Web Audio API is not supported in this browser.");
};

const clampClipBounds = (
  duration: number,
  start: number,
  end: number
): { start: number; end: number } => {
  const safeStart = Math.max(0, Math.min(start, duration));
  const maxEnd = Math.min(
    duration,
    Math.max(safeStart + 0.01, Math.min(end, safeStart + MAX_CLIP_SECONDS))
  );
  return { start: safeStart, end: maxEnd };
};

const audioBufferToWav = (buffer: AudioBuffer): ArrayBuffer => {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const totalLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  const channelData: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel += 1) {
    channelData.push(buffer.getChannelData(channel));
  }

  let offset = 44;
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = channelData[channel][frame] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      const intSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return arrayBuffer;
};

const prepareClipFile = async (
  sourceFile: File,
  clipStart: number,
  clipEnd: number
): Promise<File> => {
  const AudioCtor = getAudioContextConstructor();
  const context = new AudioCtor();
  try {
    const arrayBuffer = await sourceFile.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
    const { start, end } = clampClipBounds(audioBuffer.duration, clipStart, clipEnd);
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.floor(end * sampleRate);
    const frameCount = Math.max(1, endSample - startSample);
    const channels = Math.max(1, audioBuffer.numberOfChannels);
    const trimmed = context.createBuffer(channels, frameCount, sampleRate);
    for (let channel = 0; channel < channels; channel += 1) {
      const sourceData = audioBuffer.getChannelData(channel);
      const targetData = trimmed.getChannelData(channel);
      targetData.set(sourceData.subarray(startSample, endSample));
    }
    const wavBuffer = audioBufferToWav(trimmed);
    const baseName = sourceFile.name.replace(/\.[^/.]+$/, "") || "clip";
    return new File([wavBuffer], `${baseName}-clip.wav`, { type: "audio/wav" });
  } finally {
    await context.close().catch(() => undefined);
  }
};

const formatSeconds = (value: number) => {
  const clamped = Math.max(value, 0);
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
  const formattedWindow = `${formatSeconds(start)} → ${formatSeconds(end)}`;
  return `${formattedWindow} (${formatSeconds(
    Math.min(windowLength, maxSeconds)
  )} of max ${formatSeconds(maxSeconds)})`;
};

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [clipRange, setClipRange] = useState<{ start: number; end: number }>();
  const [selectedDAW, setSelectedDAW] = useState<string>(DEFAULT_DAW_LABEL);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{
    daw: string;
    plugins: PluginPreset[];
    summary: string | null;
    remainingCredits: number | null;
    usedAudio: boolean;
    features: Record<string, unknown> | null;
    song: DetectedSong | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [planTier, setPlanTier] = useState<string>("free");
  const [sampleLoadingId, setSampleLoadingId] = useState<string | null>(null);
  const [selectedPremium, setSelectedPremium] = useState<string[]>([]);
  const [usingSavedProfile, setUsingSavedProfile] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [ignoreSongNextRun, setIgnoreSongNextRun] = useState(false);

  type ExportFormatInfo =
    | { native: true; label: string; formatLabel: string; extension: string }
    | { native: false };

  const exportFormatInfo = useMemo<ExportFormatInfo | null>(() => {
    if (!analysis) {
      return null;
    }
    const normalized = labelToDawId(analysis.daw);
    if (normalized && normalized in NATIVE_EXPORTER_INFO) {
      const meta = NATIVE_EXPORTER_INFO[normalized as keyof typeof NATIVE_EXPORTER_INFO];
      return {
        native: true,
        label: meta.label,
        formatLabel: meta.formatLabel,
        extension: meta.fileExtension,
      };
    }
    return { native: false };
  }, [analysis]);

  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted.length) return;
    const pickedFile = accepted[0];
    setFile(pickedFile);
    setClipRange(undefined);
    setAnalysis(null);
    setError(null);
    setInfo(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "audio/*": [],
    },
    multiple: false,
  });
  const selectSampleTrack = useCallback(async (sampleId: string) => {
    const sample = SAMPLE_TRACKS.find((item) => item.id === sampleId);
    if (!sample) return;

    try {
      setSampleLoadingId(sampleId);
      setError(null);
      setInfo(null);

      const response = await fetch(sample.src);
      if (!response.ok) {
        throw new Error("Unable to load sample audio.");
      }

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("Content-Type") ?? "audio/mpeg";
      const sampleFile = new File([buffer], sample.src.split("/").pop() ?? "sample.mp3", {
        type: contentType,
      });

      setFile(sampleFile);
      setClipRange(undefined);
      setAnalysis(null);
      setInfo(`Loaded sample track: ${sample.title} — ${sample.artist}`);
    } catch (caught) {
      console.error("sample load failed", caught);
      setError(
        caught instanceof Error ? caught.message : "Unable to load the sample track."
      );
    } finally {
      setSampleLoadingId(null);
    }
  }, []);
  const handleSampleClick = useCallback(
    (sampleId: string) => {
      if (sampleLoadingId) return;
      void selectSampleTrack(sampleId);
    },
    [sampleLoadingId, selectSampleTrack]
  );

  const togglePremiumSelection = useCallback((slug: string) => {
    setSelectedPremium((prev) =>
      prev.includes(slug)
        ? prev.filter((item) => item !== slug)
        : [...prev, slug]
    );
  }, []);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (!supabase) return null;
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    if (error || !session?.access_token) {
      setError("Session expired. Please sign in again.");
      return null;
    }
    return session.access_token;
  }, [setError]);

  const handleRejectSong = useCallback(() => {
    setIgnoreSongNextRun(true);
    setAnalysis((prev) =>
      prev
        ? {
            ...prev,
            song: null,
            features:
              prev.features && typeof prev.features === "object"
                ? { ...prev.features, detected_song: null }
                : prev.features,
          }
        : prev
    );
    setInfo(
      "Song detection will be ignored on the next analysis run. Re-run the clip if you want to proceed without it."
    );
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!user || !client) {
      setPlanTier("free");
      return;
    }

    let cancelled = false;

    const loadPlan = async () => {
      const {
        data: { session },
        error,
      } = await client.auth.getSession();

      if (error || !session?.access_token) {
        if (!cancelled) {
          setPlanTier("free");
        }
        return;
      }

      try {
        const response = await fetch("/api/check-credits", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const payload = await response.json().catch(() => null);

        if (!cancelled && response.ok && payload && typeof payload.tier === "string") {
          setPlanTier(payload.tier);
        }
      } catch {
        if (!cancelled) {
          setPlanTier("free");
        }
      }
    };

    void loadPlan();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const normalizedTier = getNormalizedTier(planTier);
  const currentPlan = useMemo(() => getPlan(normalizedTier), [normalizedTier]);
  const availableDaws = useMemo(
    () => listDaws(currentPlan.allowedDAWs),
    [currentPlan]
  );
  const canAccessLibrary = currentPlan.canAccessLibrary;
  const premiumEnabled = currentPlan.canUsePremiumInventory;
  const canExportPreset = currentPlan.canExportPreset;
  const currentDawId = labelToDawId(selectedDAW) as DawId | null;
const premiumOptions = useMemo<PremiumOption[]>(() => {
  if (!currentDawId) return [];
  return pluginsForDAW(currentDawId);
}, [currentDawId]);
const selectedPremiumDetails = useMemo(
  () => {
    const lookup = new Map(premiumOptions.map((plugin) => [plugin.slug, plugin]));
    return selectedPremium
      .map((slug) => lookup.get(slug))
      .filter((plugin): plugin is PremiumOption => Boolean(plugin));
  },
  [premiumOptions, selectedPremium]
);

  useEffect(() => {
    if (availableDaws.length === 0) {
      setSelectedDAW(DEFAULT_DAW_LABEL);
      return;
    }
    setSelectedDAW((prev) =>
      availableDaws.includes(prev) ? prev : availableDaws[0]
    );
  }, [availableDaws]);

  useEffect(() => {
    if (!currentDawId) {
      setSelectedPremium([]);
      setUsingSavedProfile(false);
      setProfileLoading(false);
      setProfileError(null);
      return;
    }

    const validSlugs = new Set(premiumOptions.map((plugin) => plugin.slug));
    setSelectedPremium((prev) => prev.filter((slug) => validSlugs.has(slug)));

    if (!premiumEnabled || !user) {
      setUsingSavedProfile(false);
      setProfileLoading(false);
      setProfileError(null);
      return;
    }

    let cancelled = false;

    const loadProfile = async () => {
      setProfileLoading(true);
      setProfileError(null);
      const token = await getAccessToken();
      if (!token) {
        setProfileLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/plugin-profile?daw=${currentDawId}`, {
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
              : null) ?? "Unable to load premium profile."
          );
        }
        const plugins = Array.isArray(payload.profile?.plugins)
          ? (payload.profile.plugins as string[])
          : [];
        if (plugins.length > 0) {
          setSelectedPremium(plugins.filter((slug) => validSlugs.has(slug)));
          setUsingSavedProfile(true);
        } else {
          setUsingSavedProfile(false);
        }
      } catch (error) {
        if (cancelled) return;
        setUsingSavedProfile(false);
        setProfileError(
          error instanceof Error
            ? error.message
            : "Unable to load premium profile."
        );
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [currentDawId, premiumOptions, premiumEnabled, user, getAccessToken]);

  useEffect(() => {
    const container = waveformRef.current;

    if (!container) {
      return;
    }

    if (!file) {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
        regionRef.current = null;
      }
      setClipRange(undefined);
      return;
    }

    const ws = WaveSurfer.create({
      container,
      waveColor: "#6b7280",
      progressColor: "#f5f5f5",
      cursorColor: "#f5f5f5",
      height: 160,
      barWidth: 2,
      barRadius: 2,
      normalize: true,
    });

    const regionsPluginFactory = RegionsPlugin.create({
      dragSelection: {
        color: "rgba(255,255,255,0.1)",
      },
    });

    const regions = ws.registerPlugin(
      regionsPluginFactory as unknown as Parameters<typeof ws.registerPlugin>[0]
    ) as unknown as RegionsPluginInstance;

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));
    ws.on("error", (err) => {
      console.error("WaveSurfer error", err);
      setError(
        "Unable to render the waveform for this file. Try a different audio clip."
      );
    });

    ws.on("ready", () => {
      const duration = ws.getDuration();
      const end = Math.min(duration, MAX_CLIP_SECONDS);
      regions.clearRegions();
      const region = regions.addRegion({
        id: "selection",
        start: 0,
        end,
        drag: true,
        resize: true,
        color: "rgba(255,255,255,0.1)",
      });
      regionRef.current = region;
      setClipRange({ start: 0, end });
    });

    if (typeof regions.on === "function") {
      regions.on("region-updated", (region: Region) => {
        const duration = ws.getDuration();
        const length = region.end - region.start;
        if (length > MAX_CLIP_SECONDS) {
          region.setOptions({
            end: Math.min(region.start + MAX_CLIP_SECONDS, duration),
          });
        }
        setClipRange({
          start: Math.max(region.start, 0),
          end: Math.min(region.end, duration),
        });
      });

      regions.on("region-clicked", (region: Region, event: MouseEvent) => {
        event.stopPropagation();
        region.play();
      });
    }

    void ws.loadBlob(file).catch((err) => {
      console.error("WaveSurfer load error", err);
      setError(
        "Unable to load the waveform for this file. Try a different audio clip."
      );
    });
    wavesurferRef.current = ws;

    return () => {
      regions.clearRegions();
      ws.destroy();
      wavesurferRef.current = null;
      regionRef.current = null;
    };
  }, [file]);

  const clipDuration = useMemo(() => {
    if (!clipRange) return 0;
    return clipRange.end - clipRange.start;
  }, [clipRange]);

  const togglePlayback = () => {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer) {
      return;
    }
    if (wavesurfer.isPlaying()) {
      wavesurfer.pause();
    } else {
      wavesurfer.play();
    }
  };

  const handleAnalyze = async (options?: { skipSongDetection?: boolean }) => {
    if (!user) {
      router.push("/auth");
      return;
    }

    if (!file || !clipRange) {
      return;
    }

    const skipSongDetection = options?.skipSongDetection ?? ignoreSongNextRun;

    setIsAnalyzing(true);
    setError(null);
    setInfo(null);
    setAnalysis(null);

    try {
      if (!supabase) {
        throw new Error(
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
        );
      }

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(sessionError.message);
      }

      const accessToken = session?.access_token;

      if (!accessToken) {
        throw new Error("Session expired. Please sign in again.");
      }

      let clipFile: File;
      try {
        clipFile = await prepareClipFile(file, clipRange.start, clipRange.end);
      } catch (clipError) {
        console.error("clip preparation failed", clipError);
        throw new Error(
          "Unable to prepare the selected audio clip. Try a different segment or file."
        );
      }

      const authHeaders = {
        Authorization: `Bearer ${accessToken}`,
      };

      const creditsResponse = await fetch("/api/check-credits", {
        method: "GET",
        headers: authHeaders,
      });

      const creditsPayload = await creditsResponse.json().catch(() => null);

      if (creditsPayload && typeof creditsPayload.tier === "string") {
        setPlanTier(creditsPayload.tier);
      }

      if (!creditsResponse.ok || !creditsPayload) {
        const message =
          (creditsPayload && typeof creditsPayload.error === "string"
            ? creditsPayload.error
            : null) ?? "Unable to verify remaining credits.";
        throw new Error(message);
      }

      if (
        typeof creditsPayload.credits === "number" &&
        creditsPayload.credits <= 0 &&
        creditsPayload.tier === "free"
      ) {
        throw new Error(
          "You are out of analyses. Upgrade to Pro to keep going."
        );
      }

      const formData = new FormData();
      formData.append("file", clipFile, clipFile.name);
      formData.append("daw", selectedDAW);
      formData.append("start", clipRange.start.toString());
      formData.append("end", clipRange.end.toString());
      formData.append("skipSongDetection", skipSongDetection ? "true" : "false");
      if (premiumEnabled && !usingSavedProfile && selectedPremium.length > 0) {
        formData.append("premiumPlugins", JSON.stringify(selectedPremium));
      }

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
        headers: authHeaders,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload) {
        const message =
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to analyze the segment right now.";
        throw new Error(message);
      }

      const plugins: PluginPreset[] = Array.isArray(payload.plugins)
        ? payload.plugins
        : [];

      const dawName =
        typeof payload.daw === "string" && payload.daw.length > 0
          ? payload.daw
          : selectedDAW;

      const summaryText =
        typeof payload.summary === "string" && payload.summary.trim().length > 0
          ? payload.summary.trim()
          : null;

      const remainingCredits =
        typeof payload.remainingCredits === "number"
          ? payload.remainingCredits
          : typeof creditsPayload.credits === "number"
          ? creditsPayload.credits
          : null;
      const nextTier =
        typeof payload.tier === "string"
          ? payload.tier
          : typeof creditsPayload.tier === "string"
          ? creditsPayload.tier
          : null;

      if (premiumEnabled) {
        const validSlugs = new Set(premiumOptions.map((plugin) => plugin.slug));
        if (payload.premiumProfileUsed) {
          setUsingSavedProfile(true);
          if (Array.isArray(payload.premiumPlugins)) {
            setSelectedPremium(
              payload.premiumPlugins.filter(
                (slug: unknown): slug is string =>
                  typeof slug === "string" && validSlugs.has(slug)
              )
            );
          }
        } else if (Array.isArray(payload.premiumPlugins)) {
          setUsingSavedProfile(false);
          setSelectedPremium(
            payload.premiumPlugins.filter(
              (slug: unknown): slug is string =>
                typeof slug === "string" && validSlugs.has(slug)
            )
          );
        }
      }

      const songData: DetectedSong | null =
        payload.song && typeof payload.song === "object"
          ? {
              title:
                typeof payload.song.title === "string"
                  ? payload.song.title
                  : "Unknown title",
              artist:
                typeof payload.song.artist === "string"
                  ? payload.song.artist
                  : "Unknown artist",
              album:
                typeof payload.song.album === "string"
                  ? payload.song.album
                  : null,
              releaseDate:
                typeof payload.song.releaseDate === "string"
                  ? payload.song.releaseDate
                  : null,
              label:
                typeof payload.song.label === "string"
                  ? payload.song.label
                  : null,
              timecode:
                typeof payload.song.timecode === "string"
                  ? payload.song.timecode
                  : null,
              songId:
                typeof payload.song.songId === "string"
                  ? payload.song.songId
                  : null,
              score:
                typeof payload.song.score === "number"
                  ? payload.song.score
                  : null,
              appleMusicUrl:
                typeof payload.song.appleMusicUrl === "string"
                  ? payload.song.appleMusicUrl
                  : null,
              spotifyUrl:
                typeof payload.song.spotifyUrl === "string"
                  ? payload.song.spotifyUrl
                  : null,
              genres: Array.isArray(payload.song.genres)
                ? payload.song.genres.filter(
                    (item: unknown): item is string => typeof item === "string"
                  )
                : [],
              lyrics:
                typeof payload.song.lyrics === "string"
                  ? payload.song.lyrics
                  : null,
            }
          : null;

      setAnalysis({
        daw: dawName,
        plugins,
        summary: summaryText,
        remainingCredits,
        usedAudio: payload.usedAudio === true,
        features: (payload.features ?? null) as Record<string, unknown> | null,
        song: songData,
      });
      if (typeof remainingCredits === "number") {
        window.dispatchEvent(
          new CustomEvent("credits-updated", {
            detail: { remaining: remainingCredits, tier: nextTier },
          })
        );
      }
      if (ignoreSongNextRun) {
        setIgnoreSongNextRun(false);
      }
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Unexpected error while analyzing audio.";
      setError(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExport = async () => {
    if (!user || !analysis) {
      setError("Run an analysis before exporting a preset.");
      return;
    }
    if (!canExportPreset) {
      setError("Exporting presets is available on paid plans. Upgrade to unlock exports.");
      return;
    }
    setExporting(true);
    setError(null);
    try {
      if (!supabase) {
        throw new Error(
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
        );
      }

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(sessionError.message);
      }

      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Session expired. Please sign in again.");
      }

      const authHeaders = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      };

      const clipLabel = clipRange
        ? buildClipWindowLabel(clipRange.start, clipRange.end, MAX_CLIP_SECONDS)
        : null;

      const response = await fetch("/api/export-preset", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          daw: analysis.daw,
          summary: analysis.summary,
          clipWindow: clipLabel,
          song: analysis.song,
          plugins: analysis.plugins,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          (payload && typeof payload.error === "string" ? payload.error : null) ??
          "Unable to export preset.";
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?(.+?)"?$/);
      const filename = match ? match[1] : `${analysis.daw.replace(/\s+/g, "_")}_chain`;

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
        setInfo(
          targetHeader && targetHeader !== "manual"
            ? `Native preset downloaded (${targetHeader}).`
            : "Native preset downloaded."
        );
      } else {
        setInfo(
          "Manual setup ZIP downloaded (README included). Native preset coming soon—Pro members get early access."
        );
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Unexpected error while exporting preset.";
      setError(message);
    } finally {
      setExporting(false);
    }
  };

  const handleSaveAnalysis = async () => {
    if (!user || !analysis) return;
    if (!canAccessLibrary) {
      setError("Saving presets is a Standard feature. Upgrade to unlock the library.");
      return;
    }
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      if (!supabase) {
        throw new Error(
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
        );
      }

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(sessionError.message);
      }

      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Session expired. Please sign in again.");
      }

      const response = await fetch("/api/save-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          daw: analysis.daw,
          clipStart: clipRange?.start ?? 0,
          clipEnd: clipRange?.end ?? 0,
          duration: clipRange ? clipRange.end - clipRange.start : 0,
          plugins: analysis.plugins,
          summary: analysis.summary ?? null,
          features: (() => {
            const base =
              analysis.features &&
              typeof analysis.features === "object" &&
              !Array.isArray(analysis.features)
                ? { ...analysis.features }
                : {};
            if (typeof analysis.summary === "string" && analysis.summary.trim()) {
              base.ai_summary = analysis.summary.trim();
            }
            return base;
          })(),
          tags: [],
          favorite: false,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? "Unable to save preset right now."
        );
      }
      setInfo("Preset saved to your library.");
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Unexpected error while saving the preset.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      {isAnalyzing && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 text-white">
            <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <p className="text-sm uppercase tracking-[0.3em]">Analyzing segment…</p>
          </div>
        </div>
      )}
      <ParticlesBackground />
      <div className="relative z-10 flex min-h-screen flex-col px-6 py-10 sm:px-10 lg:px-16">
        <HeaderNav />
        <section className="mb-5 flex flex-col items-center gap-4 text-center sm:mb-14">
          <h1 className="text-3xl font-semibold text-white sm:text-5xl">
            Turn any vocal clip into a DAW-ready plugin chain.
          </h1>
          <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
            Upload a snippet, choose your workstation, and let the AI reverse
            engineer the processing. Designed for producers chasing exact sonic
            textures.
          </p>
        </section>

        <main
          className={`flex flex-1 flex-col gap-4 pb-20 ${
            !file ? "items-center" : ""
          }`}
        >
          {!file ? (
            <>
              <section
                {...getRootProps()}
                className={`mt-0 flex h-72 w-full max-w-3xl flex-col items-center justify-center rounded-2xl border border-white/20 bg-white/5 p-10 text-center transition focus:outline-none focus:ring-2 focus:ring-white/60 ${
                  isDragActive ? "border-white/60 bg-white/10" : ""
                }`}
              >
                <input {...getInputProps()} />
                <p className="text-lg font-medium text-white sm:text-xl">
                  {isDragActive
                    ? "Drop your audio file"
                    : "Drag & drop or click to upload"}
                </p>
                <p className="mt-3 text-xs uppercase tracking-[0.3em] text-slate-400 sm:text-sm">
                  MP3 · WAV · FLAC · AAC
                </p>
              </section>

              <section className="flex w-full max-w-3xl flex-col items-center gap-3 rounded-2xl bg-black/20 p-4 text-center shadow-lg shadow-black/20 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
                  No audio file? Try one of these:
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
                  {SAMPLE_TRACKS.map((sample) => (
                    <button
                      key={sample.id}
                      type="button"
                      onClick={() => handleSampleClick(sample.id)}
                      className="group flex w-full max-w-[7.5rem] flex-col items-center rounded-2xl border border-white/10 bg-white/5 p-2 text-center transition hover:border-white/40 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 sm:w-auto"
                    >
                      <div
                        className={`relative h-16 w-16 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${sample.gradientClass} transition-transform group-hover:scale-105 group-focus-visible:scale-105`}
                      >
                        {sample.cover ? (
                          <Image
                            src={sample.cover}
                            alt={`${sample.title} cover art`}
                            fill
                            className="object-cover"
                            sizes="96px"
                          />
                        ) : (
                          <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-[0.4em] text-white">
                            {sample.initials}
                          </span>
                        )}
                        {sampleLoadingId === sample.id && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] uppercase tracking-[0.35em] text-white">
                            Loading…
                          </div>
                        )}
                      </div>
                      <span className="mt-2 text-xs font-semibold text-white">
                        {sample.title}
                      </span>
                      <span className="text-[9px] uppercase tracking-[0.35em] text-slate-400">
                        {sample.artist}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="rounded-2xl border border-white/10 bg-black/30 p-6 shadow-lg shadow-black/40 backdrop-blur">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                        Clip window
                      </p>
                      <p className="text-sm text-slate-200">
                        {clipRange
                          ? `${formatSeconds(clipRange.start)} → ${formatSeconds(
                              clipRange.end
                            )} (${formatSeconds(clipDuration)} of max 00:${MAX_CLIP_SECONDS
                              .toString()
                              .padStart(2, "0")})`
                          : "Select up to 00:30"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={togglePlayback}
                      disabled={!clipRange}
                      className="rounded-full border border-white/30 px-4 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40"
                    >
                      {isPlaying ? "Pause" : "Play"}
                    </button>
                  </div>

                  <div
                    ref={waveformRef}
                    className="mt-2 h-40 w-full overflow-hidden rounded-lg border border-white/10 bg-black/40"
                  />
                  {!clipRange && (
                    <p className="text-center text-xs uppercase tracking-[0.3em] text-slate-500">
                      Drag the selection handles to choose up to 30 seconds
                    </p>
                  )}
                </div>
              </section>

              <section className="flex flex-col gap-6 rounded-2xl border border-white/10 bg-black/30 p-6 shadow-lg shadow-black/40 backdrop-blur">
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="daw"
                    className="text-xs uppercase tracking-[0.3em] text-slate-500"
                  >
                    Choose your DAW
                  </label>
                  <select
                    id="daw"
                    value={selectedDAW}
                    onChange={(event) => setSelectedDAW(event.target.value)}
                    className="w-full rounded-md border border-white/20 bg-black/60 px-4 py-3 text-sm text-white outline-none transition hover:border-white/40 focus:border-white"
                  >
                    {availableDaws.map((daw) => (
                      <option key={daw} value={daw} className="bg-black text-white">
                        {daw}
                      </option>
                    ))}
                  </select>
                </div>

                {premiumEnabled ? (
                  usingSavedProfile ? (
                    <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
                      <p className="text-xs uppercase tracking-[0.3em] text-emerald-200">
                        Using saved Premium Plugin Profile for {selectedDAW}
                      </p>
                      {selectedPremiumDetails.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-100">
                          {selectedPremiumDetails.map((plugin) => (
                            <li key={plugin.slug}>
                              {plugin.vendor} — {plugin.name}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-emerald-100">
                          Profile contains no plugins. Add some in your account settings.
                        </p>
                      )}
                      <Link
                        href="/account"
                        className="mt-3 inline-flex rounded-full border border-emerald-400/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.35em] text-emerald-100 transition hover:border-emerald-200/70 hover:bg-emerald-400/10"
                      >
                        Edit profile in Account
                      </Link>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                        Premium plugins (optional)
                      </p>
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-white/15 bg-black/50 p-3">
                        {profileLoading ? (
                          <p className="text-sm text-slate-400">Checking saved profile…</p>
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
                                    checked={selectedPremium.includes(plugin.slug)}
                                    onChange={() => togglePremiumSelection(plugin.slug)}
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
                      {profileError && (
                        <p className="text-xs text-red-300">{profileError}</p>
                      )}
                    </div>
                  )
                ) : (
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">
                    Upgrade to Standard to save premium plugin profiles.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => {
                    void handleAnalyze();
                  }}
                  className="terminal-button self-start rounded-full border border-white/30 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40"
                  disabled={!user || !file || !clipRange || isAnalyzing}
                >
                  {isAnalyzing ? "Analyzing…" : "Analyze Segment"}
                </button>
                {!authLoading && !user && (
                  <p className="text-sm text-slate-400">
                    Sign in to analyze clips and save plugin chains.
                  </p>
                )}
                {currentPlan.id === "free" && (
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">
                    Standard unlocks the full DAW list and library features.
                  </p>
                )}
              </section>
            </>
          )}
          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}
          {info && (
            <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {info}
            </p>
          )}

          {analysis && (
            <section className="flex flex-col gap-6 rounded-2xl border border-white/10 bg-black/30 p-6 shadow-lg shadow-black/40 backdrop-blur">
              <div className="flex flex-col gap-2">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Plugin Chain
                </p>
                <h2 className="text-2xl font-semibold text-white">
                  Suggested Processing for {analysis.daw}
                </h2>
                <p className="text-sm text-slate-300">
                  Detailed parameters returned from the analysis service.
                </p>
                {typeof analysis.remainingCredits === "number" && (
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Remaining credits: {analysis.remainingCredits}
                  </p>
                )}
              </div>

              {analysis.song && (
                <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                        Detected Song
                      </p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {analysis.song.title}
                      </p>
                      <p className="text-sm text-slate-300">
                        {analysis.song.artist}
                        {analysis.song.album ? ` • ${analysis.song.album}` : ""}
                      </p>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                        {analysis.song.timecode
                          ? `Snippet at ${analysis.song.timecode}`
                          : "Timestamp unknown"}
                      </p>
                      {analysis.song.genres.length > 0 && (
                        <p className="mt-1 text-[11px] uppercase tracking-[0.35em] text-slate-500">
                          {analysis.song.genres.join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {analysis.song.appleMusicUrl && (
                        <a
                          href={analysis.song.appleMusicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.35em] text-white transition hover:border-white/60 hover:bg-white/5"
                        >
                          Apple Music
                        </a>
                      )}
                      {analysis.song.spotifyUrl && (
                        <a
                          href={analysis.song.spotifyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.35em] text-white transition hover:border-white/60 hover:bg-white/5"
                        >
                          Spotify
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={handleRejectSong}
                        className="rounded-full border border-white/30 px-3 py-1 text-[11px] uppercase tracking-[0.35em] text-white transition hover:border-red-400/70 hover:bg-red-500/10"
                      >
                        Not correct?
                      </button>
                    </div>
                  </div>
                  {analysis.song.lyrics && (
                    <details className="mt-3 text-sm text-slate-300">
                      <summary className="cursor-pointer text-xs uppercase tracking-[0.3em] text-slate-500">
                        View snippet lyrics
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap text-slate-300">
                        {analysis.song.lyrics}
                      </p>
                    </details>
                  )}
                </div>
              )}
              {!analysis.song && ignoreSongNextRun && (
                <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs uppercase tracking-[0.3em] text-amber-200">
                  Song detection will be skipped on the next analysis. Re-run the clip to continue.
                </p>
              )}

              {analysis.summary && (
                <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    AI Summary
                  </p>
                  <p className="mt-2 text-sm italic text-slate-200">
                    {analysis.summary}
                  </p>
                  {/* TODO: Offer a “Re-Generate Summary” action for alternative takes. */}
                </div>
              )}

              {analysis.plugins.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No plugins were suggested for this snippet. Try a different
                  section or upload a new file.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {analysis.plugins.map((plugin) => (
                    <PluginCard key={`${plugin.name}-${plugin.type}`} plugin={plugin} />
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleSaveAnalysis}
                  disabled={!user || saving || !canAccessLibrary}
                  className="terminal-button rounded-full border border-white/30 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40"
                >
                  {saving ? "Saving…" : "Save Preset"}
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={!user || exporting || !canExportPreset}
                  className="terminal-button rounded-full border border-white/30 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40"
                >
                  {exporting ? "Exporting…" : "Export Preset"}
                </button>
                {exportFormatInfo && (
                  <div className="basis-full">
                    <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">
                      {exportFormatInfo.native
                        ? `Native format ready (${exportFormatInfo.extension})`
                        : "Manual setup ZIP (native preset coming soon)"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {exportFormatInfo.native
                        ? `Downloads ${exportFormatInfo.formatLabel} for ${exportFormatInfo.label}.`
                        : "Includes README instructions and chain.json for manual recreation."}
                    </p>
                  </div>
                )}
                {!canAccessLibrary && (
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">
                    Upgrade to Standard to save chains to your library.
                  </p>
                )}
                {!canExportPreset && canAccessLibrary && (
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">
                    Upgrade to export chains as preset files.
                  </p>
                )}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
