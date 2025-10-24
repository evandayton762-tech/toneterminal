export type SerializedPreset = {
  filename: string;
  mime: string;
  data: Buffer;
  serializerId: string;
  label: string;
  isNative: boolean;
};

export type PluginIdentifierMap = Partial<{
  generic: string;
  vst3: string;
  vst2: string;
  au: string;
  aax: string;
  clap: string;
  flStudio: string;
  ableton: string;
  logic: string;
  proTools: string;
  studioOne: string;
  reaper: string;
}>;

export type PluginParameter = {
  id: string;
  label?: string;
  value: string;
  normalized?: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
};

export type PluginChainPlugin = {
  name: string;
  type: string;
  settings: Record<string, string>;
  comment?: string | null;
  vendor?: string | null;
  category?: string | null;
  identifiers?: PluginIdentifierMap | null;
  parameters?: PluginParameter[] | null;
  bypassed?: boolean;
  slotIndex?: number;
  tags?: string[] | null;
};

export type PluginChain = {
  daw: string;
  dawId?: string;
  summary?: string | null;
  plugins: PluginChainPlugin[];
  song?: {
    title?: string;
    artist?: string;
    album?: string | null;
    timecode?: string | null;
  } | null;
  clipWindow?: string | null;
};

export interface PresetSerializer {
  id: string;
  label: string;
  canHandle: (daw: string) => boolean;
  serialize: (chain: PluginChain) => Promise<SerializedPreset>;
}
