/**
 * Color scale utilities for choropleth map markers.
 *
 * Uses a Viridis-like HSL ramp (purple → blue → green → yellow) that is
 * perceptually uniform and safe for the most common forms of colour-blindness.
 */

export type ColorMetric = "status" | "record_length" | "drainage_area";

export const COLOR_METRIC_LABELS: Record<ColorMetric, string> = {
  status:          "Status (default)",
  record_length:   "Record Length (yr)",
  drainage_area:   "Drainage Area (km²)",
};

/**
 * Map a normalised value t ∈ [0, 1] to a fill + stroke colour pair.
 * t = 0 → deep purple (low)   t = 1 → bright yellow (high)
 */
export function scaleColor(t: number): { fill: string; stroke: string } {
  t = Math.max(0, Math.min(1, t));
  // Hue: 260° (purple) → 65° (yellow) — Viridis-like
  const hue = Math.round(260 - 195 * t);
  const sat = Math.round(70  +  20 * t);  // 70 → 90 %
  const lit = Math.round(40  +  12 * t);  // 40 → 52 %
  return {
    fill:   `hsl(${hue},${sat}%,${lit}%)`,
    stroke: `hsl(${hue},${sat}%,${Math.max(22, lit - 13)}%)`,
  };
}

/** Generate n evenly-spaced tick colours + values for a colour legend. */
export function legendTicks(
  min: number,
  max: number,
  n = 5
): { value: number; fill: string }[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { value: min + t * (max - min), fill: scaleColor(t).fill };
  });
}
