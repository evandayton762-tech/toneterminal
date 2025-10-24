export type NativeExporterKey =
  | "reaper"
  | "fl_studio"
  | "ableton_live"
  | "logic_pro"
  | "pro_tools"
  | "studio_one";

export type NativeExporterMetadata = {
  id: NativeExporterKey;
  label: string;
  formatLabel: string;
  fileExtension: string;
  serializerId: string;
};

export const NATIVE_EXPORTER_ORDER: NativeExporterKey[] = [
  "reaper",
  "fl_studio",
  "ableton_live",
  "logic_pro",
  "pro_tools",
  "studio_one",
];

export const NATIVE_EXPORTER_INFO: Record<NativeExporterKey, NativeExporterMetadata> = {
  reaper: {
    id: "reaper",
    label: "Reaper",
    formatLabel: "Reaper RFX Chain",
    fileExtension: ".rfxchain",
    serializerId: "reaper-rfx",
  },
  fl_studio: {
    id: "fl_studio",
    label: "FL Studio",
    formatLabel: "FL Studio Mixer State (.fst)",
    fileExtension: ".fst",
    serializerId: "fl-studio-fst",
  },
  ableton_live: {
    id: "ableton_live",
    label: "Ableton Live",
    formatLabel: "Ableton Device Rack (.adg)",
    fileExtension: ".adg",
    serializerId: "ableton-adg",
  },
  logic_pro: {
    id: "logic_pro",
    label: "Logic Pro",
    formatLabel: "Logic Channel Strip (.patch)",
    fileExtension: ".patch",
    serializerId: "logic-patch",
  },
  pro_tools: {
    id: "pro_tools",
    label: "Pro Tools",
    formatLabel: "Pro Tools XML Preset",
    fileExtension: ".ptpreset.xml",
    serializerId: "pro-tools-xml",
  },
  studio_one: {
    id: "studio_one",
    label: "Studio One",
    formatLabel: "Studio One Preset (.preset)",
    fileExtension: ".preset",
    serializerId: "studio-one-preset",
  },
} as const;
