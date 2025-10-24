import { gzipSync } from "zlib";
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

function serializeDevice(plugin: PluginChainPlugin, index: number): string {
  const identifier =
    plugin.identifiers?.ableton ??
    plugin.identifiers?.vst3 ??
    plugin.identifiers?.generic ??
    plugin.name;

  const parameters = Object.entries(plugin.settings).map(([name, value]) => {
    return `<PlugInParameter>
        <Id Value="${xmlEscape(name)}"/>
        <Value Value="${xmlEscape(String(value))}"/>
      </PlugInParameter>`;
  });

  return `<Device>
    <AudioEffect>
      <PluginDevice>
        <PluginType Value="VST3"/>
        <IsEnabled Value="${plugin.bypassed ? "false" : "true"}"/>
        <PresetName Value="${xmlEscape(plugin.name)}"/>
        <UserName Value="${xmlEscape(plugin.name)}"/>
        <PluginDesc>
          <PluginIdentifier Value="${xmlEscape(identifier)}"/>
        </PluginDesc>
        <Parameters>${parameters.join("")}</Parameters>
        <UserComment Value="${plugin.comment ? xmlEscape(plugin.comment) : ""}"/>
        <PresentationIndex Value="${index}"/>
      </PluginDevice>
    </AudioEffect>
  </Device>`;
}

function buildAdg(chain: PluginChain): string {
  const devices = sortChainPlugins(chain)
    .map((plugin, index) => serializeDevice(plugin, index))
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="11" MinorVersion="0" SchemaChangeCount="0" Creator="ToneTerminal">
  <DeviceGroup>
    ${
      chain.summary
        ? `<Annotation Author="ToneTerminal">${xmlEscape(chain.summary)}</Annotation>`
        : ""
    }
    <DeviceChain>
      <Devices>${devices}</Devices>
    </DeviceChain>
  </DeviceGroup>
</Ableton>`;

  return prettyXml(xml);
}

const AbletonAdgSerializer: PresetSerializer = {
  id: "ableton-adg",
  label: "Ableton Device Rack",
  canHandle(daw: string) {
    return daw === "ableton_live" || daw === "ableton";
  },
  async serialize(chain: PluginChain): Promise<SerializedPreset> {
    const xml = buildAdg(chain);
    const gzip = gzipSync(xml, { level: 9 });
    const safeBase =
      chain.song?.title ?? chain.summary ?? `${chain.daw.replace(/\s+/g, "_")}_rack`;
    const filename = `${sanitizeFilename(safeBase)}.adg`;
    return {
      filename,
      mime: "application/gzip",
      data: gzip,
      serializerId: AbletonAdgSerializer.id,
      label: AbletonAdgSerializer.label,
      isNative: true,
    };
  },
};

export default AbletonAdgSerializer;
