export function fmtDischarge(v: number | null): string {
  if (v === null || isNaN(v)) return "—";
  if (v >= 1000) return v.toLocaleString("en-CA", { maximumSignificantDigits: 4 });
  return v.toPrecision(4).replace(/\.?0+$/, "");
}

export function fmtLevel(v: number | null): string {
  if (v === null || isNaN(v)) return "—";
  return v.toFixed(3);
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-CA", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtAep(t: number): string {
  const aep = 1 / t;
  if (aep >= 0.01) return `${(aep * 100).toFixed(0)}%`;
  return `${(aep * 100).toFixed(2)}%`;
}

export function fmtArea(km2: number | null): string {
  if (km2 === null) return "—";
  return `${km2.toLocaleString("en-CA", { maximumFractionDigits: 1 })} km²`;
}
