import { sanitizeFilename, encodeUtf8, sortChainPlugins } from "./utils";
import type { PresetSerializer, PluginChain, PluginChainPlugin, SerializedPreset } from "./types";

function escapeValue(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/=/g, "-");
}

function formatParameterLines(plugin: PluginChainPlugin): string[] {
  const entries = Object.entries(plugin.settings);
  if (!entries.length) {
    return ["Param0=Default=0"];
  }

  return entries.map(([name, rawValue], index) => {
    const cleanName = escapeValue(name);
    const cleanValue =
      typeof rawValue === "string" ? escapeValue(rawValue) : escapeValue(String(rawValue));
    return `Param${index}=${cleanName}=${cleanValue}`;
  });
}

function formatSlot(index: number, plugin: PluginChainPlugin): string {
  const identifier =
    plugin.identifiers?.flStudio ??
    plugin.identifiers?.vst3 ??
    plugin.identifiers?.generic ??
    plugin.name;

  const section: Array<string | null> = [
    `[Slot${index}]`,
    `Name=${escapeValue(identifier)}`,
    `DisplayName=${escapeValue(plugin.name)}`,
    `Type=${escapeValue(plugin.type)}`,
    `State=${plugin.bypassed ? "Bypassed" : "Active"}`,
  ];

  if (plugin.comment) {
    section.push(`Comment=${escapeValue(plugin.comment)}`);
  }

  if (plugin.parameters && plugin.parameters.length) {
    plugin.parameters.forEach((param, paramIndex) => {
      section.push(
        `Param${paramIndex}=${escapeValue(param.label ?? param.id)}=${escapeValue(param.value)}`
      );
    });
  } else {
    section.push(...formatParameterLines(plugin));
  }

  return section.filter((line): line is string => Boolean(line)).join("\n");
}

function buildFst(chain: PluginChain): string {
  const ordered = sortChainPlugins(chain);
  const header = [
    "[ToneTerminalFST]",
    "Version=1",
    `CreatedBy=ToneTerminal`,
    `DAW=${escapeValue(chain.daw)}`,
    chain.song?.title ? `Song=${escapeValue(chain.song.title)}` : null,
    chain.clipWindow ? `ClipWindow=${escapeValue(chain.clipWindow)}` : null,
    chain.summary ? `Summary=${escapeValue(chain.summary)}` : null,
    `SlotCount=${ordered.length}`,
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const slots = ordered.map((plugin, index) => formatSlot(index, plugin)).join("\n\n");
  return `${header}${slots}\n`;
}

const FlStudioFstSerializer: PresetSerializer = {
  id: "fl-studio-fst",
  label: "FL Studio Mixer State",
  canHandle(daw: string) {
    return daw === "fl_studio" || daw === "flstudio";
  },
  async serialize(chain: PluginChain): Promise<SerializedPreset> {
    const fst = buildFst(chain);
    const safeBase =
      chain.song?.title ??
      chain.summary ??
      `${chain.daw.replace(/\s+/g, "_")}_chain`;
    const filename = `${sanitizeFilename(safeBase)}.fst`;
    return {
      filename,
      mime: "application/octet-stream",
      data: encodeUtf8(fst),
      serializerId: FlStudioFstSerializer.id,
      label: FlStudioFstSerializer.label,
      isNative: true,
    };
  },
};

export default FlStudioFstSerializer;
