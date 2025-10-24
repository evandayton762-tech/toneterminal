import type { PluginIdentifierMap, PluginParameter } from "@/exporters";

export type PluginPreset = {
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
