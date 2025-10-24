import { labelToDawId } from "@/lib/daws";
import type {
  PresetSerializer,
  PluginChain,
  SerializedPreset,
  PluginChainPlugin,
  PluginIdentifierMap,
  PluginParameter,
} from "./types";
import ReaperRfxSerializer from "./reaperRfx";
import FlStudioFstSerializer from "./flStudioFst";
import AbletonAdgSerializer from "./abletonAdg";
import LogicPatchSerializer from "./logicPatch";
import ProToolsPresetSerializer from "./proToolsPreset";
import StudioOnePresetSerializer from "./studioOnePreset";
import StubZipSerializer from "./stubZip";
export {
  NATIVE_EXPORTERS,
  resolveNativeExporterKey,
  hasNativeExporter,
  getExporterCoverage,
} from "./nativeSupport";
export type {
  NativeExporterKey,
  NativeExporterMetadata,
  ExportCoverageStatus,
} from "./nativeSupport";

const SERIALIZERS: PresetSerializer[] = [
  ReaperRfxSerializer,
  FlStudioFstSerializer,
  AbletonAdgSerializer,
  LogicPatchSerializer,
  ProToolsPresetSerializer,
  StudioOnePresetSerializer,
];

export async function serializePreset(chain: PluginChain): Promise<SerializedPreset> {
  const dawId =
    chain.dawId ??
    labelToDawId(chain.daw) ??
    chain.daw.toLowerCase().replace(/\s+/g, "_");
  const serializer = SERIALIZERS.find((item) => item.canHandle(dawId));
  if (serializer) {
    return serializer.serialize({ ...chain, dawId });
  }
  return StubZipSerializer.serialize({ ...chain, dawId });
}

export {
  ReaperRfxSerializer,
  FlStudioFstSerializer,
  AbletonAdgSerializer,
  LogicPatchSerializer,
  ProToolsPresetSerializer,
  StudioOnePresetSerializer,
  StubZipSerializer,
};
export type {
  PresetSerializer,
  PluginChain,
  SerializedPreset,
  PluginChainPlugin,
  PluginIdentifierMap,
  PluginParameter,
};
