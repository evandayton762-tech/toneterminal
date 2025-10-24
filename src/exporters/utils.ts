import JSZip from "jszip";
import type { PluginChain, PluginChainPlugin } from "./types";

export function sanitizeFilename(name: string, fallback = "tone-terminal"): string {
  const safe = name
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return safe || fallback;
}

export function encodeUtf8(value: string): Buffer {
  return Buffer.from(value, "utf-8");
}

export async function buildZipArchive(
  entries: Array<{
    path: string;
    data: string | Buffer;
    binary?: boolean;
  }>,
  options: {
    compression?: "STORE" | "DEFLATE";
  } = {}
): Promise<Buffer> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.path, entry.data, {
      binary: entry.binary ?? entry.data instanceof Buffer,
    });
  }
  return zip.generateAsync({
    type: "nodebuffer",
    compression: options.compression ?? "DEFLATE",
  });
}

export function prettyXml(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}

export function sortChainPlugins(chain: PluginChain): PluginChainPlugin[] {
  return chain.plugins
    .map((plugin, index) => ({
      plugin,
      order: typeof plugin.slotIndex === "number" ? plugin.slotIndex : index,
    }))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.plugin);
}
