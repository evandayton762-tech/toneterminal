export const DAWS = {
  fl_studio: {
    label: "FL Studio",
    formats: ["VST3"],
    exportFormats: ["fst_stub"],
    os: ["mac", "win"],
  },
  ableton_live: {
    label: "Ableton Live",
    formats: ["VST3", "AU(mac)"],
    exportFormats: ["adg_stub"],
    os: ["mac", "win"],
  },
  logic_pro: {
    label: "Logic Pro",
    formats: ["AU"],
    exportFormats: ["patch_stub", "aupreset_stub"],
    os: ["mac"],
  },
  pro_tools: {
    label: "Pro Tools",
    formats: ["AAX"],
    exportFormats: ["ptx_stub"],
    os: ["mac", "win"],
  },
  reaper: {
    label: "Reaper",
    formats: ["VST3", "AU(mac)"],
    exportFormats: ["rfxchain"],
    os: ["mac", "win"],
  },
  cubase: {
    label: "Cubase",
    formats: ["VST3"],
    exportFormats: ["vstpreset_stub"],
    os: ["mac", "win"],
  },
  studio_one: {
    label: "Studio One",
    formats: ["VST3", "AU(mac)"],
    exportFormats: ["preset_stub"],
    os: ["mac", "win"],
  },
  bitwig: {
    label: "Bitwig",
    formats: ["VST3", "CLAP"],
    exportFormats: ["bwdevice_stub"],
    os: ["mac", "win"],
  },
  reason: {
    label: "Reason",
    formats: ["VST3", "RE"],
    exportFormats: ["reason_patch_stub"],
    os: ["mac", "win"],
  },
  nuendo: {
    label: "Nuendo",
    formats: ["VST3"],
    exportFormats: ["vstpreset_stub"],
    os: ["mac", "win"],
  },
  garageband: {
    label: "GarageBand",
    formats: ["AU"],
    exportFormats: ["patch_stub"],
    os: ["mac"],
  },
  digital_performer: {
    label: "Digital Performer",
    formats: ["VST3", "AU(mac)"],
    exportFormats: ["dp_preset_stub"],
    os: ["mac", "win"],
  },
  samplitude: {
    label: "Samplitude",
    formats: ["VST3"],
    exportFormats: ["sam_preset_stub"],
    os: ["win"],
  },
  cakewalk: {
    label: "Cakewalk",
    formats: ["VST3"],
    exportFormats: ["cwp_preset_stub"],
    os: ["win"],
  },
  ardour: {
    label: "Ardour",
    formats: ["VST3", "AU(mac)"],
    exportFormats: ["ardour_preset_stub"],
    os: ["mac", "win"],
  },
  mixbus: {
    label: "Harrison Mixbus",
    formats: ["VST3", "AU(mac)"],
    exportFormats: ["mixbus_preset_stub"],
    os: ["mac", "win"],
  },
  waveform: {
    label: "Tracktion Waveform",
    formats: ["VST3"],
    exportFormats: ["waveform_preset_stub"],
    os: ["mac", "win"],
  },
} as const;

export type DawId = keyof typeof DAWS;
