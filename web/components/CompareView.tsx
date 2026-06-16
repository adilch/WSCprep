"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Station, DailyPoint, PeakPoint } from "@/lib/types";
import type { FrequencyResponse, FrequencyRequest } from "@/lib/types";
import { computeFdc, computeRegime, computeStats } from "@/lib/hydro";
import type { DescStats, RegimeData } from "@/lib/hydro";
import { fmtDischarge, fmtArea } from "@/lib/format";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => (
    <div className="h-72 flex items-center justify-center text-gray-400 text-sm">
      Loading chart…
    </div>
  ),
});

const MAX_STATIONS = 4;
const COMPARE_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea"];
const FFA_RETURN_PERIODS = [2, 5, 10, 25, 50, 100, 200, 500];
const REGIME_MONTH_TICKS = {
  tickmode: "array" as const,
  tickvals: [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335],
  ticktext: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

interface StationData {
  daily?: DailyPoint[];
  peaks?: PeakPoint[];
  error?: string;
}

interface FfaData {
  loading?: boolean;
  error?: string;
  result?: FrequencyResponse;
}

export function CompareView({ catalog }: { catalog: Station[] }) {
  const catalogById = useMemo(
    () => new Map(catalog.map((s) => [s.station_number, s])),
    [catalog]
  );

  // ── Selected stations (from URL ?s=) ───────────────────────────────────────
  const [selected, setSelected] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const s = new URLSearchParams(window.location.search).get("s");
    if (!s) return [];
    return [...new Set(s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))]
      .slice(0, MAX_STATIONS);
  });

  // Keep the URL in sync so a comparison is shareable.
  useEffect(() => {
    const qs = selected.length ? `?s=${selected.join(",")}` : "";
    const url = `${window.location.pathname}${qs}`;
    if (`${window.location.pathname}${window.location.search}` !== url)
      window.history.replaceState(null, "", url);
  }, [selected]);

  // ── Per-station data ────────────────────────────────────────────────────────
  const [data, setData] = useState<Record<string, StationData>>({});
  const fetching = useRef(new Set<string>());

  useEffect(() => {
    selected.forEach((id) => {
      if (data[id]?.daily || data[id]?.error || fetching.current.has(id)) return;
      fetching.current.add(id);
      Promise.all([
        fetch(`/api/stations/${id}/daily?variable=discharge`)
          .then((r) => { if (!r.ok) throw new Error(`daily HTTP ${r.status}`); return r.json(); }),
        fetch(`/api/stations/${id}/peaks`)
          .then((r) => { if (!r.ok) throw new Error(`peaks HTTP ${r.status}`); return r.json(); }),
      ])
        .then(([d, p]) => setData((m) => ({ ...m, [id]: { daily: d.series, peaks: p.peaks } })))
        .catch((e) => setData((m) => ({
          ...m, [id]: { error: e instanceof Error ? e.message : "load failed" },
        })))
        .finally(() => fetching.current.delete(id));
    });
  }, [selected, data]);

  // ── Derived per-station series ─────────────────────────────────────────────
  const derived = useMemo(() => selected.map((id, i) => {
    const st = catalogById.get(id) ?? null;
    const d  = data[id];
    const daily = d?.daily ?? null;
    return {
      id, station: st, color: COMPARE_COLORS[i % COMPARE_COLORS.length],
      loading: !d,
      error: d?.error ?? null,
      daily,
      peaks: d?.peaks ?? null,
      fdc:    daily ? computeFdc(daily) : null,
      regime: daily ? computeRegime(daily) : null,
      stats:  daily ? computeStats(daily) : null,
    };
  }), [selected, data, catalogById]);

  const ready = derived.filter((s) => s.daily && !s.error);

  // ── Station picker ──────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return catalog
      .filter((s) =>
        !selected.includes(s.station_number) &&
        (s.name.toLowerCase().includes(q) || s.station_number.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [query, catalog, selected]);

  const addStation = useCallback((rawId: string) => {
    const id = rawId.trim().toUpperCase();
    setAddError(null);
    if (!id) return;
    if (selected.includes(id)) { setAddError(`${id} is already selected.`); return; }
    if (selected.length >= MAX_STATIONS) { setAddError(`Maximum ${MAX_STATIONS} stations.`); return; }
    if (!catalogById.has(id)) { setAddError(`Station ${id} not found.`); return; }
    setSelected((s) => [...s, id]);
    setQuery("");
  }, [selected, catalogById]);

  const removeStation = (id: string) => setSelected((s) => s.filter((x) => x !== id));

  // Seed from favourites if the comparison is empty.
  const [favourites, setFavourites] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("wsc-fav");
      if (raw) setFavourites(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
  }, []);

  // ── Design floods (lazy — one FFA call per station) ────────────────────────
  const [ffa, setFfa] = useState<Record<string, FfaData>>({});
  const [ffaRequested, setFfaRequested] = useState(false);

  const loadDesignFloods = useCallback(() => {
    setFfaRequested(true);
    const body: FrequencyRequest = {
      distributions: ["gev", "gumbel", "lp3"],
      estimation_method: "lmoments",
      plotting_position: "cunnane",
      return_periods: FFA_RETURN_PERIODS,
      exclude_estimated: true,
      confidence_level: 0.9,
      ci_method: "bootstrap",
      bootstrap_samples: 1000,
    };
    ready.forEach((s) => {
      if (ffa[s.id]?.result || ffa[s.id]?.loading) return;
      setFfa((m) => ({ ...m, [s.id]: { loading: true } }));
      fetch(`/api/stations/${s.id}/frequency`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => { if (!r.ok) throw new Error(`FFA HTTP ${r.status}`); return r.json(); })
        .then((result: FrequencyResponse) => setFfa((m) => ({ ...m, [s.id]: { result } })))
        .catch((e) => setFfa((m) => ({
          ...m, [s.id]: { error: e instanceof Error ? e.message : "FFA failed" },
        })));
    });
  }, [ready, ffa]);

  const bestQuantile = (res: FrequencyResponse | undefined, T: number): number | null => {
    if (!res || res.too_few_years) return null;
    const best = res.distributions.find((d) => d.key === res.best_fit && !d.fit_error)
      ?? res.distributions.find((d) => !d.fit_error);
    return best?.quantiles.find((q) => q.return_period === T)?.value ?? null;
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Compare Stations</h1>
          <p className="text-sm text-gray-500">
            Overlay flow-duration curves, annual regimes, and key statistics for up to {MAX_STATIONS} gauges.
          </p>
        </div>
        <Link href="/" className="text-sm text-blue-600 hover:underline shrink-0">← Back to map</Link>
      </div>

      {/* Station picker */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-4">
          <div className="relative flex-1 min-w-[240px]">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Add a station ({selected.length}/{MAX_STATIONS})
            </label>
            <input
              type="text" value={query}
              onChange={(e) => { setQuery(e.target.value); setAddError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchResults.length) addStation(searchResults[0].station_number);
              }}
              placeholder="Search by name or number (e.g. Bow River, 05BB001)"
              disabled={selected.length >= MAX_STATIONS}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchResults.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 max-h-64 overflow-y-auto">
                {searchResults.map((s) => (
                  <li key={s.station_number}>
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                      onClick={() => addStation(s.station_number)}
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="ml-2 text-gray-400 text-xs">
                        {s.station_number} · {s.province}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {addError && <p className="text-xs text-red-600 mt-1">{addError}</p>}
          </div>

          {/* Add favourites */}
          {favourites.filter((f) => !selected.includes(f)).length > 0 &&
            selected.length < MAX_STATIONS && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Favourites</label>
              <button
                onClick={() =>
                  setSelected((s) => [
                    ...s,
                    ...favourites.filter((f) => !s.includes(f)),
                  ].slice(0, MAX_STATIONS))
                }
                className="text-sm border border-amber-400 text-amber-600 rounded px-3 py-1.5 hover:bg-amber-50">
                ★ Add favourites
              </button>
            </div>
          )}
        </div>

        {/* Selected chips */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {derived.map((s) => (
              <span key={s.id}
                className="inline-flex items-center gap-2 bg-white border rounded-full pl-2.5 pr-1.5 py-1 text-sm"
                style={{ borderColor: s.color }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="font-mono text-xs">{s.id}</span>
                <span className="text-gray-500 text-xs max-w-[180px] truncate">
                  {s.station?.name ?? "unknown"}
                </span>
                {s.loading && <span className="text-gray-400 text-xs">…</span>}
                {s.error && <span className="text-red-500 text-xs" title={s.error}>⚠</span>}
                <button onClick={() => removeStation(s.id)}
                  className="text-gray-400 hover:text-red-600 ml-0.5" title="Remove">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {selected.length === 0 && (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-lg">
          Add stations above to start comparing.
        </div>
      )}

      {ready.length > 0 && (
        <>
          {/* ── Summary comparison table ── */}
          <Section title="Summary">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border border-gray-200 rounded">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Metric</th>
                    {ready.map((s) => (
                      <th key={s.id} className="px-3 py-2 text-right" style={{ color: s.color }}>
                        {s.id}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {summaryRows(ready).map((row) => (
                    <tr key={row.label}>
                      <td className="px-3 py-1.5 text-gray-600">{row.label}</td>
                      {row.values.map((v, i) => (
                        <td key={i} className="px-3 py-1.5 text-right font-mono">{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ── Flow Duration Curve overlay ── */}
          <Section title="Flow Duration Curve">
            <div className="bg-white border border-gray-200 rounded p-2">
              <Plot
                data={ready.filter((s) => s.fdc && s.fdc.x.length).map((s) => ({
                  x: s.fdc!.x, y: s.fdc!.y,
                  type: "scatter" as const, mode: "lines" as const,
                  line: { color: s.color, width: 1.8 },
                  name: s.id,
                }))}
                layout={{
                  xaxis: { title: { text: "Exceedance probability (%)" }, range: [0, 100] },
                  yaxis: { title: { text: "Discharge (m³/s)" }, type: "log" },
                  height: 420, margin: { l: 70, r: 20, t: 20, b: 50 },
                  legend: { orientation: "h", y: -0.18 },
                }}
                config={{ responsive: true }}
                style={{ width: "100%" }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Steeper curves indicate flashier, rainfall-driven rivers; flatter curves indicate
              well-buffered, groundwater- or lake-fed systems.
            </p>
          </Section>

          {/* ── Annual Regime overlay ── */}
          <Section title="Annual Regime (mean daily discharge)">
            <div className="bg-white border border-gray-200 rounded p-2">
              <Plot
                data={ready.filter((s) => s.regime && s.regime.x.length).map((s) => ({
                  x: s.regime!.x, y: s.regime!.mean,
                  type: "scatter" as const, mode: "lines" as const,
                  line: { color: s.color, width: 1.8 },
                  name: s.id,
                }))}
                layout={{
                  xaxis: { title: { text: "" }, range: [1, 366], ...REGIME_MONTH_TICKS },
                  yaxis: { title: { text: "Discharge (m³/s)" } },
                  height: 420, margin: { l: 70, r: 20, t: 20, b: 50 },
                  legend: { orientation: "h", y: -0.18 },
                }}
                config={{ responsive: true }}
                style={{ width: "100%" }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Reveals seasonal timing — e.g. spring snowmelt freshet vs rainfall-dominated regimes.
              Absolute magnitudes scale with drainage area.
            </p>
          </Section>

          {/* ── Design floods (lazy) ── */}
          <Section title="Design Floods (flood frequency)">
            {!ffaRequested ? (
              <div className="bg-gray-50 border border-gray-200 rounded p-4 text-sm text-gray-600 flex items-center justify-between flex-wrap gap-3">
                <span>
                  Fit flood frequency curves and compare design floods across the selected stations.
                  This runs one analysis per station and may take a few seconds.
                </span>
                <button onClick={loadDesignFloods}
                  className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 shrink-0">
                  Compare design floods
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-gray-200 rounded text-right">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Return period (yr)</th>
                      {ready.map((s) => (
                        <th key={s.id} className="px-3 py-2" style={{ color: s.color }}>{s.id}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {FFA_RETURN_PERIODS.map((T) => (
                      <tr key={T} className={T >= 100 ? "bg-blue-50" : ""}>
                        <td className="px-3 py-1.5 text-left font-medium">{T}</td>
                        {ready.map((s) => {
                          const f = ffa[s.id];
                          let cell: string;
                          if (f?.loading) cell = "…";
                          else if (f?.error) cell = "err";
                          else {
                            const q = bestQuantile(f?.result, T);
                            cell = q !== null ? fmtDischarge(q) : "—";
                          }
                          return <td key={s.id} className="px-3 py-1.5 font-mono">{cell}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 mt-1.5">
                  Best-fit distribution per station (by AIC), fitted to the annual maximum series
                  by L-moments. Values in m³/s. Compare in the context of each station&apos;s drainage
                  area (see Summary).
                </p>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold text-gray-800 border-b border-gray-200 pb-1">{title}</h2>
      {children}
    </div>
  );
}

interface ReadyStation {
  id: string;
  station: Station | null;
  stats: DescStats | null;
  peaks: PeakPoint[] | null;
  regime: RegimeData | null;
}

function summaryRows(ready: ReadyStation[]) {
  const dash = "—";
  const num = (v: number | null | undefined, dp = 1) =>
    v == null || !isFinite(v) ? dash : v.toLocaleString(undefined, { maximumFractionDigits: dp });

  const recordSpan = (s: ReadyStation) => {
    const f = s.station?.data_ranges.flow;
    return f ? `${f.year_from}–${f.year_to}` : dash;
  };
  const recordLen = (s: ReadyStation) =>
    s.station?.data_ranges.flow?.record_length
      ? `${s.station.data_ranges.flow.record_length} yr` : dash;
  const maxPeak = (s: ReadyStation) =>
    s.peaks?.length ? num(Math.max(...s.peaks.map((p) => p.value)), 0) : dash;

  return [
    { label: "Station name",          values: ready.map((s) => s.station?.name ?? dash) },
    { label: "Province",              values: ready.map((s) => s.station?.province ?? dash) },
    { label: "Drainage area",         values: ready.map((s) => s.station?.drainage_area_gross_km2
                                          ? fmtArea(s.station.drainage_area_gross_km2) : dash) },
    { label: "Regulated",             values: ready.map((s) => s.station?.regulated === true ? "Yes"
                                          : s.station?.regulated === false ? "No" : dash) },
    { label: "Flow record",           values: ready.map(recordSpan) },
    { label: "Record length",         values: ready.map(recordLen) },
    { label: "Mean Q (m³/s)",         values: ready.map((s) => num(s.stats?.mean, 1)) },
    { label: "Median Q (m³/s)",       values: ready.map((s) => num(s.stats?.median, 1)) },
    { label: "Max daily Q (m³/s)",    values: ready.map((s) => num(s.stats?.max, 0)) },
    { label: "Min daily Q (m³/s)",    values: ready.map((s) => num(s.stats?.min, 2)) },
    { label: "Max annual peak (m³/s)", values: ready.map(maxPeak) },
  ];
}
