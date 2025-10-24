import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { transcribe15s } from "../lib/transcription";

export type Metrics = {
  tempo_bpm: number;
  centroid_hz: number;
  mfcc_mean: number[];
  pitch_dev_cents: number;
  rms_lufs: number;
  transient_density: "low" | "high";
  spectral_rolloff_hz: number;
  harmonic_to_noise_ratio: number;
  transcription: string;
  formant_frequencies: number[];
};

type EssentiaModule = typeof import("essentia.js");

const TARGET_SAMPLE_RATE = 44100;
const CLIP_SECONDS = 15;
const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const TMP_ROOT = join(tmpdir(), "chain-gen-metrics");

if (typeof ffmpegStatic === "string") {
  const resolvedFfmpegPath = join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
  console.log("Attempting to set ffmpeg path to:", resolvedFfmpegPath);
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
}

let essentiaModulePromise: Promise<EssentiaModule> | null = null;
let essentiaInstance: InstanceType<EssentiaModule["Essentia"]> | null = null;

async function ensureEssentia() {
  if (!essentiaModulePromise) {
    essentiaModulePromise = import("essentia.js");
  }

  if (!essentiaInstance) {
    const { EssentiaWASM, Essentia } = await essentiaModulePromise;
    essentiaInstance = new Essentia(EssentiaWASM);
  }

  return essentiaInstance;
}

async function ensureTmpDir() {
  await mkdir(TMP_ROOT, { recursive: true });
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  const total = values.reduce((acc, value) => acc + value, 0);
  return total / values.length;
}

function standardDeviation(values: number[], valueMean?: number): number {
  if (!values.length) return 0;
  const localMean = valueMean ?? mean(values);
  const variance =
    values.reduce((acc, value) => acc + (value - localMean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function clampFinite(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function sanitizeExt(filename?: string): string {
  if (!filename) {
    return ".bin";
  }
  const index = filename.lastIndexOf(".");
  if (index === -1) {
    return ".bin";
  }
  const ext = filename.slice(index).toLowerCase();
  if (ext.length > 6) {
    return ".bin";
  }
  return ext;
}

async function trimToRaw(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(sourcePath)
      .audioFrequency(TARGET_SAMPLE_RATE)
      .audioChannels(1)
      .audioCodec("pcm_f32le")
      .format("f32le")
      .duration(CLIP_SECONDS)
      .output(targetPath)
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .run();
  });
}

export async function extractMetrics(
  buffer: Buffer,
  filename?: string
): Promise<Metrics> {
  if (!buffer || buffer.length === 0) {
    throw new Error("Audio buffer is empty.");
  }

  await ensureTmpDir();

  const essentia = await ensureEssentia();
  const uniqueId = randomUUID();
  const inputExt = sanitizeExt(filename);
  const inputPath = join(TMP_ROOT, `${uniqueId}_in${inputExt}`);
  const outputPath = join(TMP_ROOT, `${uniqueId}_out.f32`);

  try {
    await writeFile(inputPath, buffer);
    await trimToRaw(inputPath, outputPath);

    const rawBuffer = await readFile(outputPath);
    const pcmBuffer = rawBuffer.buffer.slice(
      rawBuffer.byteOffset,
      rawBuffer.byteOffset + rawBuffer.byteLength
    );
    const audio = new Float32Array(pcmBuffer);

    if (!audio.length) {
      throw new Error("Decoded audio has no samples.");
    }

    const durationSeconds = Math.min(
      CLIP_SECONDS,
      audio.length / TARGET_SAMPLE_RATE
    );
    const audioVector = essentia.arrayToVector(audio);

    const rhythm = essentia.RhythmExtractor2013(
      audioVector,
      208,
      "multifeature",
      40
    );
    const tempoBpm = clampFinite(rhythm.bpm ?? 0);

    const { centroid } = essentia.SpectralCentroidTime(
      audioVector,
      TARGET_SAMPLE_RATE
    );
    const centroidHz = clampFinite(centroid ?? 0);

    const spectral = essentia.LowLevelSpectralExtractor(
      audioVector,
      FRAME_SIZE,
      HOP_SIZE,
      TARGET_SAMPLE_RATE
    );

    const mfccVector = spectral.mfcc;
    const mfccFrames = mfccVector?.size?.() ?? 0;
    const coefficients = 13;
    const mfccTotals = Array.from({ length: coefficients }, () => 0);

    if (mfccFrames > 0 && typeof mfccVector.get === "function") {
      for (let frameIndex = 0; frameIndex < mfccFrames; frameIndex += 1) {
        const frame = mfccVector.get(frameIndex);
        const coeffs = essentia.vectorToArray(frame);
        for (let i = 0; i < coefficients; i += 1) {
          mfccTotals[i] += coeffs[i] ?? 0;
        }
      }
    }

    const mfccMean = mfccTotals.map((total) =>
      Number((total / Math.max(1, mfccFrames)).toFixed(4))
    );

    const pitchVector = spectral.pitch;
    const pitchValues: number[] = [];
    if (pitchVector?.size) {
      for (let i = 0; i < pitchVector.size(); i += 1) {
        const value = pitchVector.get(i);
        if (Number.isFinite(value) && value > 0) {
          pitchValues.push(value);
        }
      }
    }

    let pitchDevCents = 0;
    if (pitchValues.length > 1) {
      const pivot = median(pitchValues);
      if (pivot > 0) {
        const cents = pitchValues.map((value) =>
          clampFinite(1200 * Math.log2(value / pivot))
        );
        pitchDevCents = Number(
          standardDeviation(cents.map((value) => Math.abs(value))).toFixed(2)
        );
      }
    }

    const rmsVector = spectral.spectral_rms;
    const rmsValues: number[] = [];
    if (rmsVector?.size) {
      for (let i = 0; i < rmsVector.size(); i += 1) {
        const value = rmsVector.get(i);
        if (Number.isFinite(value) && value > 0) {
          rmsValues.push(value);
        }
      }
    }

    const meanRms = mean(rmsValues);
    const rmsLufsRaw =
      meanRms > 0 ? Number((-0.691 * Math.log(meanRms)).toFixed(2)) : -Infinity;
    const rmsLufs = Number.isFinite(rmsLufsRaw)
      ? rmsLufsRaw
      : Number((-0.691 * Math.log(Math.max(meanRms, 1e-6))).toFixed(2));

    const fluxVector = spectral.spectral_flux;
    const fluxValues: number[] = [];
    if (fluxVector?.size) {
      for (let i = 0; i < fluxVector.size(); i += 1) {
        const value = fluxVector.get(i);
        if (Number.isFinite(value)) {
          fluxValues.push(value);
        }
      }
    }

    const fluxMean = mean(fluxValues);
    const fluxStd = standardDeviation(fluxValues, fluxMean);
    const fluxThreshold = fluxMean + fluxStd * 1.5;
    const transients = fluxValues.filter((value) => value > fluxThreshold).length;
    const transientsPerSecond =
      durationSeconds > 0 ? transients / durationSeconds : 0;
    const transientDensity = transientsPerSecond > 6 ? "high" : "low";

    const spectralRolloffVector = spectral.spectral_rolloff;
    const spectralRolloffValues = spectralRolloffVector
      ? Array.from(essentia.vectorToArray(spectralRolloffVector))
      : [];
    const spectralRolloffHz = clampFinite(mean(spectralRolloffValues));

    const pitchSalienceVector =
      spectral.pitch_salience ?? spectral.pitch_instantaneous_confidence;
    const pitchSalienceValues = pitchSalienceVector
      ? Array.from(essentia.vectorToArray(pitchSalienceVector))
      : [];
    const harmonicToNoiseRatio = clampFinite(mean(pitchSalienceValues));

    const transcription = await transcribe15s(buffer);

    const frames = essentia.FrameGenerator(audio, FRAME_SIZE, HOP_SIZE);
    const frameCount =
      typeof frames?.size === "function" ? frames.size() : 0;
    const framesToProcess = Math.min(frameCount, 20);
    const aggregatedSpectrum = new Float32Array(FRAME_SIZE / 2 + 1);
    let processedFrames = 0;

    for (let i = 0; i < framesToProcess; i += 1) {
      const frame = frames.get(i);
      if (!frame) continue;
      const windowed = essentia.Windowing(frame, true, FRAME_SIZE, "hann");
      const spectrumFrame = essentia.Spectrum(windowed.frame);
      const spectrumValues = essentia.vectorToArray(spectrumFrame.spectrum);
      const limit = Math.min(aggregatedSpectrum.length, spectrumValues.length);
      for (let j = 0; j < limit; j += 1) {
        aggregatedSpectrum[j] += spectrumValues[j] ?? 0;
      }
      processedFrames += 1;
    }

    if (processedFrames > 0) {
      for (let i = 0; i < aggregatedSpectrum.length; i += 1) {
        aggregatedSpectrum[i] /= processedFrames;
      }
    }

    let formantFrequencies: number[] = [];
    if (processedFrames > 0) {
      const aggregatedSpectrumVector = essentia.arrayToVector(
        aggregatedSpectrum
      );
      const peaks = essentia.SpectralPeaks(
        aggregatedSpectrumVector,
        0.0001,
        5000,
        20,
        90,
        "magnitude",
        TARGET_SAMPLE_RATE
      );
      const peakFrequencies = peaks?.frequencies
        ? Array.from(essentia.vectorToArray(peaks.frequencies))
        : [];
      const peakMagnitudes = peaks?.magnitudes
        ? Array.from(essentia.vectorToArray(peaks.magnitudes))
        : [];

      formantFrequencies = peakFrequencies
        .map((freq, index) => ({
          freq,
          mag: peakMagnitudes[index] ?? 0,
        }))
        .filter(
          ({ freq }) =>
            Number.isFinite(freq) && freq >= 90 && freq <= 5000
        )
        .sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0))
        .slice(0, 3)
        .map(({ freq }) => clampFinite(freq));
    }

    return {
      tempo_bpm: Number(tempoBpm.toFixed(2)),
      centroid_hz: Number(centroidHz.toFixed(2)),
      mfcc_mean: mfccMean,
      pitch_dev_cents: pitchDevCents,
      rms_lufs: rmsLufs,
      transient_density: transientDensity,
      spectral_rolloff_hz: Number(spectralRolloffHz.toFixed(2)),
      harmonic_to_noise_ratio: Number(harmonicToNoiseRatio.toFixed(2)),
      transcription: transcription,
      formant_frequencies: formantFrequencies.map((f: number) => Number(f.toFixed(2))),
    };
  } finally {
    await Promise.allSettled([
      unlink(inputPath),
      unlink(outputPath),
    ]);
  }
}
