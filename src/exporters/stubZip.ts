import JSZip from "jszip";
import { PresetSerializer, PluginChain, SerializedPreset } from "./types";

const StubZipSerializer: PresetSerializer = {
  id: "stub-zip",
  label: "Stub ZIP Export",
  canHandle() {
    return true; // fallback for any DAW not handled elsewhere
  },
  async serialize(chain: PluginChain): Promise<SerializedPreset> {
    const zip = new JSZip();
    const safeDaw = chain.daw.replace(/[^a-z0-9]+/gi, "_").toLowerCase();

    const instructions = [
      `ToneTerminal Export Stub`,
      `=======================`,
      "",
      `DAW: ${chain.daw}`,
      chain.clipWindow ? `Clip window analyzed: ${chain.clipWindow}` : null,
      chain.song
        ? `Reference: ${chain.song.title ?? "Unknown"} - ${
            chain.song.artist ?? "Unknown"
          }${chain.song.timecode ? ` (${chain.song.timecode})` : ""}`
        : null,
      "",
      "This DAW does not yet have a native preset exporter.",
      "Follow these steps to recreate the chain manually:",
      "",
      "1. Insert the listed plugins in order.",
      "2. Apply the suggested settings and notes.",
      "3. Save the chain within your DAW for future use.",
      "",
      "Plugin Chain:",
    ]
      .filter(Boolean)
      .join("\n");

    const chainLines = chain.plugins
      .map((plugin, index) => {
        const settings = Object.entries(plugin.settings)
          .map(([key, value]) => `      - ${key}: ${value}`)
          .join("\n");
        return [
          `${index + 1}. ${plugin.name} (${plugin.type})`,
          settings ? `    Settings:\n${settings}` : "    Settings: (use defaults)",
          plugin.comment ? `    Notes: ${plugin.comment}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    const readmeText = `${instructions}\n\n${chainLines}\n`;

    zip.file("README.txt", readmeText);
    zip.file(
      "chain.json",
      JSON.stringify(
        {
          daw: chain.daw,
          summary: chain.summary ?? null,
          clipWindow: chain.clipWindow ?? null,
          song: chain.song ?? null,
          plugins: chain.plugins,
        },
        null,
        2
      )
    );

    const clipboardText = chain.plugins
      .map((plugin, index) => {
        const settings = Object.entries(plugin.settings)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" | ");
        return `${index + 1}. ${plugin.name} (${plugin.type})${
          settings ? ` -> ${settings}` : ""
        }${plugin.comment ? ` // ${plugin.comment}` : ""}`;
      })
      .join("\n");

    zip.file("clipboard.txt", clipboardText);

    const data = await zip.generateAsync({ type: "nodebuffer" });
    return {
      filename: `${safeDaw || "tone"}_chain_stub.zip`,
      mime: "application/zip",
      data,
      serializerId: StubZipSerializer.id,
      label: StubZipSerializer.label,
      isNative: false,
    };
  },
};

export default StubZipSerializer;
