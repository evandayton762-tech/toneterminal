import { sanitizeFilename, sortChainPlugins, prettyXml } from "./utils";
import type { PresetSerializer, PluginChain, PluginChainPlugin, SerializedPreset } from "./types";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function serializePlugin(plugin: PluginChainPlugin): string {
  const identifier =
    plugin.identifiers?.proTools ??
    plugin.identifiers?.aax ??
    plugin.identifiers?.generic ??
    plugin.name;

  const parameters = Object.entries(plugin.settings)
    .map(
      ([name, value], paramIndex) =>
        `<Parameter index="${paramIndex}" name="${xmlEscape(name)}" value="${xmlEscape(String(value))}"/>`
    )
    .join("");

  return `<PlugIn name="${xmlEscape(plugin.name)}" identifier="${xmlEscape(identifier)}" category="${xmlEscape(plugin.type)}" bypassed="${plugin.bypassed ? "true" : "false"}">
    <Notes>${plugin.comment ? xmlEscape(plugin.comment) : ""}</Notes>
    <Parameters>${parameters}</Parameters>
  </PlugIn>`;
}

function buildPreset(chain: PluginChain): string {
  const plugins = sortChainPlugins(chain)
    .map((plugin) => serializePlugin(plugin))
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PlugInPreset version="1.0" creator="ToneTerminal">
  <Meta>
    <DAW>${xmlEscape(chain.daw)}</DAW>
    ${chain.summary ? `<Summary>${xmlEscape(chain.summary)}</Summary>` : ""}
    ${chain.clipWindow ? `<ClipWindow>${xmlEscape(chain.clipWindow)}</ClipWindow>` : ""}
    ${
      chain.song
        ? `<Song title="${chain.song.title ? xmlEscape(chain.song.title) : ""}" artist="${
            chain.song.artist ? xmlEscape(chain.song.artist) : ""
          }" />`
        : ""
    }
  </Meta>
  <PlugIns>
    ${plugins}
  </PlugIns>
</PlugInPreset>`;
  return prettyXml(xml);
}

const ProToolsPresetSerializer: PresetSerializer = {
  id: "pro-tools-xml",
  label: "Pro Tools XML Preset",
  canHandle(daw: string) {
    return daw === "pro_tools" || daw === "protools";
  },
  async serialize(chain: PluginChain): Promise<SerializedPreset> {
    const xml = buildPreset(chain);
    const safeBase =
      chain.song?.title ?? chain.summary ?? `${chain.daw.replace(/\s+/g, "_")}_preset`;
    const filename = `${sanitizeFilename(safeBase)}.ptpreset.xml`;
    return {
      filename,
      mime: "application/xml",
      data: Buffer.from(xml, "utf-8"),
      serializerId: ProToolsPresetSerializer.id,
      label: ProToolsPresetSerializer.label,
      isNative: true,
    };
  },
};

export default ProToolsPresetSerializer;
