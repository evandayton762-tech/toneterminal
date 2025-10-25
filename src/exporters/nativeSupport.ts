import { labelToDawId, dawIdToLabel } from "@/lib/daws";
import {
  NATIVE_EXPORTER_INFO,
  type NativeExporterKey,
  type NativeExporterMetadata,
} from "@/data/nativeExporters";

export type { NativeExporterKey, NativeExporterMetadata };

export const NATIVE_EXPORTERS: Record<NativeExporterKey, NativeExporterMetadata> = NATIVE_EXPORTER_INFO;

export function resolveNativeExporterKey(daw: string): NativeExporterKey | null {
  if (typeof daw !== "string" || !daw.trim()) {
    return null;
  }
  const direct = daw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_") as NativeExporterKey;
  if (direct in NATIVE_EXPORTERS) {
    return direct;
  }
  const mapped = labelToDawId(daw);
  if (mapped && mapped in NATIVE_EXPORTERS) {
    return mapped as NativeExporterKey;
  }
  return null;
}

export function hasNativeExporter(daw: string): boolean {
  return resolveNativeExporterKey(daw) !== null;
}

export type ExportCoverageStatus = "native" | "manual";

export function getExporterCoverage(daw: string): {
  status: ExportCoverageStatus;
  nativeFormat?: string;
  serializerId?: string;
  dawId: string;
  label: string;
} {
  const normalized = resolveNativeExporterKey(daw);
  if (normalized) {
    const metadata = NATIVE_EXPORTERS[normalized];
    return {
      status: "native",
      nativeFormat: metadata.formatLabel,
      serializerId: metadata.serializerId,
      dawId: metadata.id,
      label: metadata.label,
    };
  }
  const dawId = labelToDawId(daw);
  return {
    status: "manual",
    dawId: dawId ?? daw.toLowerCase().replace(/\s+/g, "_"),
    label: dawId ? dawIdToLabel(dawId) : daw,
  };
}
