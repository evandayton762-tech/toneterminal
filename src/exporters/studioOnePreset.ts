import { sanitizeFilename, sortChainPlugins, buildZipArchive, encodeUtf8, prettyXml } from "./utils";
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
    plugin.identifiers?.studioOne ??
    plugin.identifiers?.vst3 ??
    plugin.identifiers?.generic ??
    plugin.name;

  const parameters = Object.entries(plugin.settings)
    .map(
      ([name, value], paramIndex) =>
        `<Parameter index="${paramIndex}" name="${xmlEscape(name)}" value="${xmlEscape(
          String(value)
        )}"/>`
    )
    .join("");

  return `<Device index="${index}">
    <Name>${xmlEscape(plugin.name)}</Name>
    <Identifier>${xmlEscape(identifier)}</Identifier>
    <Type>${xmlEscape(plugin.type)}</Type>
    <Bypassed>${plugin.bypassed ? "true" : "false"}</Bypassed>
    <Parameters>${parameters}</Parameters>
    <Notes>${plugin.comment ? xmlEscape(plugin.comment) : ""}</Notes>
  </Device>`;
}

async function buildPreset(chain: PluginChain): Promise<Buffer> {
  const devices = sortChainPlugins(chain)
    .map((plugin, index) => serializeDevice(plugin, index))
    .join("");

  const presetInfo = prettyXml(`<?xml version="1.0" encoding="UTF-8"?>
<Preset>
  <Header>
    <Title>${xmlEscape(chain.song?.title ?? chain.summary ?? "ToneTerminal Chain")}</Title>
    <Creator>ToneTerminal</Creator>
    <Category>${xmlEscape(chain.daw)}</Category>
    ${chain.clipWindow ? `<Comment>${xmlEscape(chain.clipWindow)}</Comment>` : ""}
  </Header>
  <Devices>${devices}</Devices>
</Preset>`);

  const userData = prettyXml(`<?xml version="1.0" encoding="UTF-8"?>
<ToneTerminal>
  <Summary>${chain.summary ? xmlEscape(chain.summary) : ""}</Summary>
  <SongTitle>${chain.song?.title ? xmlEscape(chain.song.title) : ""}</SongTitle>
  <SongArtist>${chain.song?.artist ? xmlEscape(chain.song.artist) : ""}</SongArtist>
  <ClipWindow>${chain.clipWindow ? xmlEscape(chain.clipWindow) : ""}</ClipWindow>
</ToneTerminal>`);

  return buildZipArchive([
    { path: "PresetInfo.xml", data: encodeUtf8(presetInfo) },
    { path: "UserData/ToneTerminal.xml", data: encodeUtf8(userData) },
  ]);
}

const StudioOnePresetSerializer: PresetSerializer = {
  id: "studio-one-preset",
  label: "Studio One Native Preset",
  canHandle(daw: string) {
    return daw === "studio_one" || daw === "studioone";
  },
  async serialize(chain: PluginChain): Promise<SerializedPreset> {
    const archive = await buildPreset(chain);
    const safeBase =
      chain.song?.title ?? chain.summary ?? `${chain.daw.replace(/\s+/g, "_")}_preset`;
    const filename = `${sanitizeFilename(safeBase)}.preset`;
    return {
      filename,
      mime: "application/zip",
      data: archive,
      serializerId: StudioOnePresetSerializer.id,
      label: StudioOnePresetSerializer.label,
      isNative: true,
    };
  },
};

export default StudioOnePresetSerializer;
