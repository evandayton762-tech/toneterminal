import { DAWS, type DawId } from "@/data/daws";

const LABEL_TO_ID = Object.entries(DAWS).reduce<Record<string, DawId>>(
  (acc, [id, value]) => {
    acc[value.label.toLowerCase()] = id as DawId;
    return acc;
  },
  {}
);

export function dawIdToLabel(id: string): string {
  if (id in DAWS) {
    return DAWS[id as DawId].label;
  }
  return id
    .split("_")
    .map((segment) =>
      segment.length > 0
        ? segment[0].toUpperCase() + segment.slice(1)
        : segment
    )
    .join(" ");
}

export function labelToDawId(label: string | null | undefined): DawId | null {
  if (!label) return null;
  const normalized = label.trim().toLowerCase();
  return LABEL_TO_ID[normalized] ?? null;
}

export function listDaws(labels: readonly string[]): string[] {
  return labels.map((id) => dawIdToLabel(id));
}

export function getAllDawLabels(): Record<DawId, string> {
  return Object.entries(DAWS).reduce<Record<DawId, string>>((acc, [id, value]) => {
    acc[id as DawId] = value.label;
    return acc;
  }, {} as Record<DawId, string>);
}
