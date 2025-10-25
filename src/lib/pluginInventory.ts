import { DAWS, type DawId } from "@/data/daws";
import catalog from "@/data/premiumPlugins.json";

export type Platform = "mac" | "win";

type PremiumPlugin = (typeof catalog)[number];
type PluginFormat = PremiumPlugin["formats"][number];

export function isValidPluginSlug(slug: string): boolean {
  return catalog.some((plugin) => plugin.slug === slug);
}

export function getPluginBySlug(slug: string): PremiumPlugin | undefined {
  return catalog.find((plugin) => plugin.slug === slug);
}

export function pluginsForDAW(
  dawId: DawId,
  platform?: Platform
): PremiumPlugin[] {
  const daw = DAWS[dawId];
  if (!daw) {
    return [];
  }

  const allowedFormats = new Set<PluginFormat>(
    (daw.formats as readonly PluginFormat[]) ?? []
  );
  const allowedOS = platform ? new Set([platform]) : new Set(daw.os);

  return catalog.filter((plugin) => {
    const formatMatch = plugin.formats.some((format) =>
      allowedFormats.has(format)
    );
    if (!formatMatch) return false;

    const osMatch = plugin.os.some((os) => allowedOS.has(os as Platform));
    return osMatch;
  });
}

export function sanitizePluginSelection(
  dawId: DawId,
  plugins: string[],
  platform?: Platform
): string[] {
  const validSlugs = new Set(
    pluginsForDAW(dawId, platform).map((plugin) => plugin.slug)
  );
  return Array.from(
    new Set(
      plugins.filter((slug) => validSlugs.has(slug))
    )
  );
}

export function prettyPluginList(slugs: string[]): string {
  const names = slugs
    .map((slug) => getPluginBySlug(slug)?.name)
    .filter((name): name is string => Boolean(name));
  return names.join(", ");
}
