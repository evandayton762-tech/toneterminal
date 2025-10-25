import OpenAI from "openai";
import { File } from "node:buffer";

if (typeof globalThis.File === "undefined") {
  // Ensure OpenAI file uploads work on Node runtimes lacking the File global
  (globalThis as unknown as { File: typeof File }).File = File;
}
let client: OpenAI | null = null;

function ensureClient(explicitKey?: string) {
  if (explicitKey) {
    return new OpenAI({ apiKey: explicitKey });
  }

  if (!client) {
    client = new OpenAI();
  }

  return client;
}

type TranscriptionOptions = {
  fileName?: string;
  mimeType?: string;
};

function resolveFilename(rawName?: string): string {
  if (!rawName) return "clip.wav";
  const trimmed = rawName.trim();
  if (!trimmed) return "clip.wav";
  if (trimmed.includes(".")) return trimmed;
  return `${trimmed}.wav`;
}

function resolveMimeType(
  explicitMime?: string,
  fileName?: string
): string | undefined {
  if (explicitMime?.trim()) return explicitMime;
  const name = fileName?.toLowerCase() ?? "";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".flac")) return "audio/flac";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".aac")) return "audio/aac";
  if (name.endsWith(".webm")) return "audio/webm";
  return undefined;
}

export async function transcribe15s(
  buffer: Buffer,
  apiKey?: string,
  options?: TranscriptionOptions
): Promise<string> {
  if (!buffer || buffer.length === 0) {
    return "";
  }

  const openai = ensureClient(apiKey);

  try {
    const fileName = resolveFilename(options?.fileName);
    const contentType = resolveMimeType(options?.mimeType, fileName);
    const fileSource = await OpenAI.toFile(
      buffer,
      fileName,
      contentType ? { type: contentType } : undefined
    );

    const response = await openai.audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      file: fileSource,
    });

    const rawText =
      typeof (response as { text?: unknown }).text === "string"
        ? (response as { text: string }).text
        : "";

    if (!rawText.trim()) {
      return "";
    }

    return rawText;
  } catch (error) {
    console.warn("transcribe15s failed", error);
    return "";
  }
}
