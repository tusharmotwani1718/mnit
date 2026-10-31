const HECTARES_PER: Record<string, number> = {
  hectare: 1,
  are: 0.01, // Maharashtra 7/12 extracts record land in hectare-are
  acre: 0.404686,
  guntha: 0.0101172, // 1 acre = 40 guntha
};

/**
 * Bigha differs from state to state (and within Rajasthan between pucca and kachha bigha). For Rajasthan we use the
 * pucca bigha (3,025 sq yards ≈ 0.2529 ha); the agent adds a note to confirm the area in hectares at the CSC.
 */
const BIGHA_HECTARES: Record<string, number> = { RJ: 0.2529 };

/**
 * Converts a land area to hectares. Returns null when the unit can't be converted reliably
 * (bigha outside Rajasthan, where its size isn't known), so the caller is asked again.
 */
export function toHectares(value: number, unit: string, state?: string): number | null {
  const u = unit.toLowerCase();
  const factor = u === "bigha" ? BIGHA_HECTARES[state ?? ""] : HECTARES_PER[u];
  if (factor === undefined || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * factor * 10000) / 10000;
}
