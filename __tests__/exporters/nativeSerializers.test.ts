import { gunzipSync } from "zlib";

import {
  FlStudioFstSerializer,
  AbletonAdgSerializer,
  LogicPatchSerializer,
  ProToolsPresetSerializer,
  StudioOnePresetSerializer,
  StubZipSerializer,
  serializePreset,
  getExporterCoverage,
} from "../../src/exporters";
import type { PluginChain } from "../../src/exporters";

const buildChain = (overrides: Partial<PluginChain>): PluginChain => ({
  daw: "FL Studio",
  dawId: "fl_studio",
  summary: "Test chain",
  clipWindow: "00:00 → 00:15",
  song: {
    title: "Unit Test",
    artist: "ToneTerminal",
    album: null,
    timecode: "0:10",
  },
  plugins: [
    {
      name: "Tone EQ",
      type: "Equalizer",
      settings: {
        Gain: "+3dB",
        Frequency: "5kHz",
      },
      comment: "Boost presence",
    },
  ],
  ...overrides,
});

describe("native exporters", () => {
  it("serializes FL Studio chains to FST", async () => {
    const chain = buildChain({ daw: "FL Studio", dawId: "fl_studio" });
    const preset = await FlStudioFstSerializer.serialize(chain);

    expect(preset.serializerId).toBe("fl-studio-fst");
    expect(preset.isNative).toBe(true);
    expect(preset.filename.endsWith(".fst")).toBe(true);
    const content = preset.data.toString("utf-8");
    expect(content).toContain("[ToneTerminalFST]");
    expect(content).toContain("SlotCount=1");
  });

  it("serializes Ableton racks as gzipped XML", async () => {
    const chain = buildChain({ daw: "Ableton Live", dawId: "ableton_live" });
    const preset = await AbletonAdgSerializer.serialize(chain);

    expect(preset.serializerId).toBe("ableton-adg");
    expect(preset.isNative).toBe(true);
    expect(preset.filename.endsWith(".adg")).toBe(true);
    const xml = gunzipSync(preset.data).toString("utf-8");
    expect(xml).toContain("<Ableton");
    expect(xml).toContain("ToneTerminal");
  });

  it("creates Logic patch archives", async () => {
    const chain = buildChain({ daw: "Logic Pro", dawId: "logic_pro" });
    const preset = await LogicPatchSerializer.serialize(chain);

    expect(preset.serializerId).toBe("logic-patch");
    expect(preset.isNative).toBe(true);
    expect(preset.filename.endsWith(".patch")).toBe(true);
    expect(preset.mime).toBe("application/zip");
    expect(preset.data.subarray(0, 2).toString("utf-8")).toBe("PK");
  });

  it("serializes Pro Tools presets to XML", async () => {
    const chain = buildChain({ daw: "Pro Tools", dawId: "pro_tools" });
    const preset = await ProToolsPresetSerializer.serialize(chain);

    expect(preset.serializerId).toBe("pro-tools-xml");
    expect(preset.isNative).toBe(true);
    expect(preset.mime).toBe("application/xml");
    const xml = preset.data.toString("utf-8");
    expect(xml).toContain("<PlugInPreset");
    expect(xml).toContain("ToneTerminal");
  });

  it("builds Studio One preset archives", async () => {
    const chain = buildChain({ daw: "Studio One", dawId: "studio_one" });
    const preset = await StudioOnePresetSerializer.serialize(chain);

    expect(preset.serializerId).toBe("studio-one-preset");
    expect(preset.isNative).toBe(true);
    expect(preset.filename.endsWith(".preset")).toBe(true);
    expect(preset.mime).toBe("application/zip");
    expect(preset.data.subarray(0, 2).toString("utf-8")).toBe("PK");
  });

  it("falls back to stub exporter when DAW is unsupported", async () => {
    const chain = buildChain({ daw: "Unknown DAW", dawId: "unknown_daw" });
    const preset = await serializePreset(chain);

    expect(preset.serializerId).toBe(StubZipSerializer.id);
    expect(preset.isNative).toBe(false);
    expect(preset.filename.endsWith("stub.zip")).toBe(true);
  });

  it("reports coverage metadata", () => {
    const nativeCoverage = getExporterCoverage("FL Studio");
    expect(nativeCoverage.status).toBe("native");
    expect(nativeCoverage.serializerId).toBe("fl-studio-fst");

    const manualCoverage = getExporterCoverage("Bitwig");
    expect(manualCoverage.status).toBe("manual");
  });
});
