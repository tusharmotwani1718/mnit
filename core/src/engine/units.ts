const HECTARES_PER: Record<string, number> = {
  hectare: 1,
  are: 0.01, // Maharashtra 7/12 extracts record land in hectare-are
  acre: 0.404686,
  guntha: 0.0101172, // 1 acre = 40 guntha
};

/**
 * Converts a land area to hectares. Returns null when the unit can't be converted
 * reliably (bigha varies by state and isn't used in Maharashtra), so the caller is asked again.
 */
export function toHectares(value: number, unit: string, _state?: string): number | null {
  const factor = HECTARES_PER[unit.toLowerCase()];
  if (factor === undefined || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * factor * 10000) / 10000;
}
