"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import type {
  FrequencyResponse, FrequencyRequest, PeakPoint, PeaksResponse, DailyPoint,
} from "@/lib/types";
import { fmtDischarge, fmtAep } from "@/lib/format";
import { strings } from "@/lib/strings";
import { Callout } from "./Callout";
import { mannKendall, sequentialMannKendall } from "@/lib/mannKendall";
import {
  computePot, computePotQuantiles, dischargePercentile,
  DEFAULT_POT_RETURN_PERIODS,
} from "@/lib/pot";
import type { PotResult, GpdParams } from "@/lib/pot";
import { MethodologyBox } from "./MethodologyBox";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => (
    <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
      Loading chart…
    </div>
  ),
});

const DIST_COLORS: Record<string, string> = {
  gev: "#2563eb", glo: "#16a34a", gumbel: "#dc2626", lp3: "#9333ea", pe3: "#ea580c",
};

const ALL_DISTRIBUTIONS = ["gev", "glo", "gumbel", "lp3", "pe3"];

/** Safely format a nullable/NaN number; returns "—" when value is absent. */
const fmt = (v: number | null | undefined, dp: number): string =>
  v == null || !isFinite(v) ? "—" : v.toFixed(dp);

const DEFAULT_RETURN_PERIODS = [2, 5, 10, 20, 25, 50, 100, 200, 500];
const VALID_TABS = ["peaks", "freq", "table", "gof", "trend", "pot"] as const;
type FfaTab = (typeof VALID_TABS)[number];

export function FrequencyView({ stationId }: { stationId: string }) {
  const searchParams = useSearchParams();
  const router      = useRouter();
  const pathname    = usePathname();

  // ── Tab from URL ──────────────────────────────────────────────────────────
  const [tab, setTab] = useState<FfaTab>(() => {
    const t = searchParams.get("tab") as FfaTab | null;
    return t && (VALID_TABS as readonly string[]).includes(t) ? t : "freq";
  });

  // ── FFA analysis state ────────────────────────────────────────────────────
  const [result,  setResult]  = useState<FrequencyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [options, setOptions] = useState<Omit<FrequencyRequest, "peaks">>({
    distributions:    ALL_DISTRIBUTIONS,
    estimation_method: "lmoments",
    plotting_position: "cunnane",
    return_periods:    DEFAULT_RETURN_PERIODS,
    exclude_estimated: true,
    confidence_level:  0.9,
    ci_method:         "bootstrap",
    bootstrap_samples: 2000,
  });

  // ── Annual peaks (fetched independently) ──────────────────────────────────
  const [peaks,     setPeaks]     = useState<PeakPoint[] | null>(null);
  const [peaksErr,  setPeaksErr]  = useState<string | null>(null);

  const peaksYearRange = useMemo<[number, number] | null>(() => {
    if (!peaks?.length) return null;
    const years = peaks.map((p) => p.year);
    return [Math.min(...years), Math.max(...years)];
  }, [peaks]);

  const [yearRange, setYearRange] = useState<[number, number] | null>(null);
  useEffect(() => { if (peaksYearRange) setYearRange(peaksYearRange); }, [peaksYearRange]);

  const [excludedYears, setExcludedYears] = useState<Set<number>>(new Set());

  const peaksRef         = useRef(peaks);
  const yearRangeRef     = useRef(yearRange);
  const excludedYearsRef = useRef(excludedYears);
  peaksRef.current         = peaks;
  yearRangeRef.current     = yearRange;
  excludedYearsRef.current = excludedYears;

  // ── Feature 14: POT analysis state ────────────────────────────────────────
  const [dailySeries,    setDailySeries]    = useState<DailyPoint[] | null>(null);
  const [dailyLoading,   setDailyLoading]   = useState(false);
  const [dailyError,     setDailyError]     = useState<string | null>(null);
  const [potThreshPct,   setPotThreshPct]   = useState(90);
  const [potManualVal,   setPotManualVal]   = useState("");
  const [potManualMode,  setPotManualMode]  = useState(false);
  const [potSepGap,      setPotSepGap]      = useState(7);

  // ── Fetch peaks on mount ──────────────────────────────────────────────────
  useEffect(() => {
    async function loadPeaks() {
      try {
        const res = await fetch(`/api/stations/${stationId}/peaks`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PeaksResponse = await res.json();
        setPeaks(data.peaks);
      } catch (e) {
        setPeaksErr(e instanceof Error ? e.message : "Could not load peaks");
      }
    }
    loadPeaks();
  }, [stationId]);

  // ── Lazy-fetch daily data when POT tab is first visited ───────────────────
  useEffect(() => {
    if (tab !== "pot" || dailySeries !== null || dailyLoading) return;
    setDailyLoading(true);
    setDailyError(null);
    fetch(`/api/stations/${stationId}/daily?variable=discharge`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => setDailySeries(d.series))
      .catch((e) => setDailyError(e instanceof Error ? e.message : "Failed to load daily data"))
      .finally(() => setDailyLoading(false));
  }, [tab, stationId, dailySeries, dailyLoading]);

  // ── URL sync (tab) ────────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "freq") params.set("tab", tab);
    const qs = params.size ? `?${params.toString()}` : "";
    router.replace(`${pathname}${qs}`, { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── Derived peaks lists ───────────────────────────────────────────────────
  const peaksInRange = useMemo<PeakPoint[]>(() => {
    if (!peaks) return [];
    const yr = yearRange ?? peaksYearRange;
    if (!yr) return peaks;
    return peaks.filter((p) => p.year >= yr[0] && p.year <= yr[1]);
  }, [peaks, yearRange, peaksYearRange]);

  const peaksForFfa = useMemo<PeakPoint[]>(
    () => peaksInRange.filter((p) => !excludedYears.has(p.year)),
    [peaksInRange, excludedYears]
  );

  // ── Mann-Kendall ──────────────────────────────────────────────────────────
  const mkSorted = useMemo(
    () => (peaksInRange.length >= 5
      ? [...peaksInRange].sort((a, b) => a.year - b.year)
      : null),
    [peaksInRange]
  );

  const mkResult = useMemo(
    () => mkSorted
      ? mannKendall(mkSorted.map((p) => p.value), mkSorted.map((p) => p.year))
      : null,
    [mkSorted]
  );

  const seqMk = useMemo(
    () => mkSorted
      ? sequentialMannKendall(mkSorted.map((p) => p.value), mkSorted.map((p) => p.year))
      : null,
    [mkSorted]
  );

  const senIntercept = useMemo(() => {
    if (!mkResult || !mkSorted) return null;
    const bs = mkSorted
      .map((p) => p.value - mkResult.senSlope * p.year)
      .sort((a, b) => a - b);
    const mid = Math.floor(bs.length / 2);
    return bs.length % 2 === 1 ? bs[mid] : (bs[mid - 1] + bs[mid]) / 2;
  }, [mkResult, mkSorted]);

  // ── POT derived values ────────────────────────────────────────────────────
  const potThreshold = useMemo<number | null>(() => {
    if (!dailySeries) return null;
    if (potManualMode) {
      const v = parseFloat(potManualVal);
      return isFinite(v) && v > 0 ? v : null;
    }
    return dischargePercentile(dailySeries, potThreshPct);
  }, [dailySeries, potManualMode, potThreshPct, potManualVal]);

  const potResult = useMemo<PotResult | null>(() => {
    if (!dailySeries || potThreshold === null) return null;
    return computePot(dailySeries, potThreshold, potSepGap, DEFAULT_POT_RETURN_PERIODS);
  }, [dailySeries, potThreshold, potSepGap]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const toggleYear = (year: number) =>
    setExcludedYears((s) => {
      const next = new Set(s);
      if (next.has(year)) next.delete(year); else next.add(year);
      return next;
    });

  // ── Run analysis ──────────────────────────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let peaksToSend: PeakPoint[] | undefined;
      if (peaksRef.current) {
        const yr = yearRangeRef.current;
        const ex = excludedYearsRef.current;
        const filtered = peaksRef.current.filter((p) => {
          if (yr && (p.year < yr[0] || p.year > yr[1])) return false;
          if (ex.has(p.year)) return false;
          return true;
        });
        peaksToSend = filtered;
      }
      const body: FrequencyRequest = peaksToSend
        ? { ...options, peaks: peaksToSend }
        : { ...options };
      const res = await fetch(`/api/stations/${stationId}/frequency`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  // peaks/yearRange/excludedYears intentionally excluded — read via refs
  }, [stationId, options]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { runAnalysis(); }, [runAnalysis]);

  // ── Downloads ─────────────────────────────────────────────────────────────
  const downloadFreqCsv = () => {
    if (!result) return;
    const dists = result.distributions.filter((d) => !d.fit_error);
    const header = ["return_period", "aep", ...dists.map((d) => d.key),
      ...dists.flatMap((d) => [`${d.key}_ci_lo`, `${d.key}_ci_hi`])];
    const rows = options.return_periods.map((t) => {
      const aep = 1 / t;
      return [t, aep.toFixed(6),
        ...dists.map((d) => d.quantiles.find((q) => q.return_period === t)?.value ?? ""),
        ...dists.flatMap((d) => {
          const q = d.quantiles.find((q) => q.return_period === t);
          return [q?.ci_lower ?? "", q?.ci_upper ?? ""];
        })];
    });
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stationId}_ffa_design_floods.csv`;
    a.click();
  };

  const downloadPeaksCsv = () => {
    if (!peaksInRange.length) return;
    const rows = ["year,peak_discharge_m3s,date,symbol,excluded",
      ...peaksInRange.map((p) =>
        `${p.year},${p.value},${p.date ?? ""},${p.symbol ?? ""},${excludedYears.has(p.year) ? "yes" : "no"}`
      )];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stationId}_annual_peaks.csv`;
    a.click();
  };

  const downloadPotCsv = () => {
    if (!potResult?.peaks.length) return;
    const rows = ["date,peak_discharge_m3s",
      ...potResult.peaks.map((p) => `${p.date},${p.value}`)];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stationId}_pot_peaks.csv`;
    a.click();
  };

  const toggleDist = (key: string) =>
    setOptions((o) => ({
      ...o,
      distributions: o.distributions.includes(key)
        ? o.distributions.filter((d) => d !== key)
        : [...o.distributions, key],
    }));

  const fitted = result?.distributions.filter((d) => !d.fit_error) ?? [];
  const best   = result?.best_fit;

  const isFullRange =
    !peaksYearRange || !yearRange ||
    (yearRange[0] === peaksYearRange[0] && yearRange[1] === peaksYearRange[1]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-6">

      {/* ── Options panel ── */}
      <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-4">
        <div className="flex flex-wrap gap-4 items-start">

          {/* Distributions */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Distributions</p>
            <div className="flex gap-2 flex-wrap">
              {ALL_DISTRIBUTIONS.map((d) => (
                <button key={d} onClick={() => toggleDist(d)}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${
                    options.distributions.includes(d)
                      ? "text-white border-transparent"
                      : "bg-white text-gray-600 border-gray-300"}`}
                  style={options.distributions.includes(d) ? { backgroundColor: DIST_COLORS[d] } : {}}>
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Plotting position */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Plotting Position</p>
            <select className="border border-gray-300 rounded px-2 py-1 text-xs"
              value={options.plotting_position}
              onChange={(e) => setOptions((o) => ({ ...o,
                plotting_position: e.target.value as FrequencyRequest["plotting_position"] }))}>
              <option value="cunnane">Cunnane</option>
              <option value="weibull">Weibull</option>
              <option value="gringorten">Gringorten</option>
            </select>
          </div>

          {/* Estimation method */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Estimation Method</p>
            <select className="border border-gray-300 rounded px-2 py-1 text-xs"
              value={options.estimation_method}
              onChange={(e) => setOptions((o) => ({ ...o,
                estimation_method: e.target.value as FrequencyRequest["estimation_method"] }))}>
              <option value="lmoments">L-moments</option>
              <option value="mom">Method of Moments</option>
            </select>
          </div>

          {/* Confidence level */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Confidence</p>
            <select className="border border-gray-300 rounded px-2 py-1 text-xs"
              value={options.confidence_level}
              onChange={(e) => setOptions((o) => ({ ...o, confidence_level: Number(e.target.value) }))}>
              <option value={0.9}>90%</option>
              <option value={0.95}>95%</option>
            </select>
          </div>

          {/* Exclude estimated */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Exclude Estimated (E)</p>
            <input type="checkbox" checked={options.exclude_estimated}
              onChange={(e) => setOptions((o) => ({ ...o, exclude_estimated: e.target.checked }))} />
          </div>

          {/* Period-of-record selector */}
          {peaksYearRange && yearRange && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="text-xs font-medium text-gray-600">Peak Record:</span>
              <input type="number" value={yearRange[0]}
                min={peaksYearRange[0]} max={yearRange[1] - 1}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= peaksYearRange[0] && v < yearRange[1])
                    setYearRange([v, yearRange[1]]);
                }}
                className="w-20 border border-gray-300 rounded px-2 py-1 text-xs text-center" />
              <span className="text-gray-400 text-xs">–</span>
              <input type="number" value={yearRange[1]}
                min={yearRange[0] + 1} max={peaksYearRange[1]}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v <= peaksYearRange[1] && v > yearRange[0])
                    setYearRange([yearRange[0], v]);
                }}
                className="w-20 border border-gray-300 rounded px-2 py-1 text-xs text-center" />
              {!isFullRange && (
                <button onClick={() => setYearRange(peaksYearRange)}
                  className="text-xs text-blue-600 hover:underline">Full record</button>
              )}
            </div>
          )}

          <button onClick={runAnalysis} disabled={loading}
            className="ml-auto bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors self-end">
            {loading ? "Running…" : "Run Analysis"}
          </button>
        </div>

        {peaks && (
          <p className="text-xs text-gray-500">
            {peaksForFfa.length} of {peaksInRange.length} peaks in period · {excludedYears.size} manually excluded
            {excludedYears.size > 0 && (
              <button onClick={() => setExcludedYears(new Set())}
                className="ml-2 text-blue-600 hover:underline">
                Clear exclusions
              </button>
            )}
          </p>
        )}
      </div>

      {/* ── Mann-Kendall trend callout ── */}
      {mkResult && (() => {
        const mk = mkResult;
        const pFmt = mk.pValue < 0.001 ? "< 0.001" : mk.pValue.toFixed(3);
        const slopeFmt = (mk.senSlope >= 0 ? "+" : "") + mk.senSlope.toFixed(2) + " m³/s/yr";
        if (!mk.significant && mk.pValue >= 0.1) {
          return (
            <Callout level="info">
              <strong>Trend test (Mann-Kendall):</strong> No statistically significant trend in
              annual peaks (τ = {mk.tau.toFixed(3)}, p = {pFmt}, Sen's slope {slopeFmt}).
              Stationarity assumption is supported.{" "}
              <button className="underline text-blue-700 ml-1" onClick={() => setTab("trend")}>
                View trend plots →
              </button>
            </Callout>
          );
        }
        const dir = mk.trend === "increasing" ? "upward ↑" : "downward ↓";
        return (
          <Callout level={mk.significant ? "caution" : "info"}>
            <strong>Trend test (Mann-Kendall):</strong>{" "}
            {mk.significant
              ? `Statistically significant ${dir} trend detected`
              : `Weak ${dir} tendency (not significant at α = 0.05)`}{" "}
            (τ = {mk.tau.toFixed(3)}, p = {pFmt}, Sen's slope {slopeFmt}).
            {mk.significant &&
              " Non-stationarity may affect FFA reliability — interpret results with caution."}
            {" "}
            <button className="underline text-blue-700 ml-1" onClick={() => setTab("trend")}>
              View trend plots →
            </button>
          </Callout>
        );
      })()}

      {error && <Callout level="error">{error}</Callout>}
      {peaksErr && <Callout level="caution">Peaks load error: {peaksErr}</Callout>}

      {loading && (
        <div className="flex items-center justify-center h-32 text-gray-400">
          {strings.ffa.loading}
        </div>
      )}

      {result && !loading && (
        <>
          {result.warnings.length > 0 && (
            <div className="space-y-2">
              {result.warnings.map((w, i) => (
                <Callout key={i} level={w.level}>{w.message}</Callout>
              ))}
            </div>
          )}

          {result.too_few_years && (
            <Callout level="error">{strings.ffa.tooFewYears}</Callout>
          )}

          {!result.too_few_years && (
            <>
              {/* ── Tab bar ── */}
              <div className="flex gap-0 border-b border-gray-200 overflow-x-auto">
                {VALID_TABS.map((t) => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      tab === t
                        ? "border-blue-600 text-blue-700"
                        : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                    {t === "peaks" ? `Annual Peaks (${peaksForFfa.length})`
                     : t === "freq"  ? "Frequency Plot"
                     : t === "table" ? "Design Floods"
                     : t === "gof"   ? "Goodness of Fit"
                     : t === "trend" ? "Trend Analysis"
                     : /* pot */       `POT${potResult ? ` (${potResult.peaks.length})` : ""}`}
                  </button>
                ))}
                {/* Download + Print Report */}
                <button
                  onClick={
                    tab === "peaks" ? downloadPeaksCsv
                    : tab === "pot" ? downloadPotCsv
                    : downloadFreqCsv
                  }
                  className="ml-auto text-sm text-blue-600 hover:underline self-center px-4">
                  {tab === "peaks" ? "Download peaks CSV"
                   : tab === "pot" ? "Download POT CSV"
                   : "Download CSV"}
                </button>
                {/* ── Feature 15: Print Report link ── */}
                <a href={`/stations/${stationId}/report`} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-gray-500 hover:text-gray-700 self-center pr-4 print-hide">
                  📄 Report
                </a>
              </div>

              {/* ── Annual Peaks tab ── */}
              {tab === "peaks" && (
                <div className="space-y-4">
                  <div className="bg-white border border-gray-200 rounded p-2">
                    {peaksInRange.length > 0 ? (
                      <Plot
                        data={[
                          {
                            x: peaksInRange.filter((p) => !excludedYears.has(p.year)).map((p) => p.year),
                            y: peaksInRange.filter((p) => !excludedYears.has(p.year)).map((p) => p.value),
                            type: "bar", marker: { color: "#3b82f6" }, name: "Included in FFA",
                          },
                          ...(excludedYears.size > 0 ? [{
                            x: peaksInRange.filter((p) => excludedYears.has(p.year)).map((p) => p.year),
                            y: peaksInRange.filter((p) => excludedYears.has(p.year)).map((p) => p.value),
                            type: "bar" as const, marker: { color: "#d1d5db" }, name: "Excluded",
                          }] : []),
                        ]}
                        layout={{
                          title: { text: `${strings.ffa.annualPeaks} (n = ${peaksForFfa.length} yr used)` },
                          xaxis: { title: { text: "Year" } },
                          yaxis: { title: { text: "Peak Discharge (m³/s)" } },
                          barmode: "stack", height: 380,
                          margin: { l: 70, r: 20, t: 50, b: 50 },
                          legend: { orientation: "h", y: -0.2 },
                        }}
                        config={{ responsive: true,
                          toImageButtonOptions: { format: "png", filename: `${stationId}_annual_peaks` } }}
                        style={{ width: "100%" }}
                      />
                    ) : (
                      <Callout level="info">
                        No peaks in the selected year range. Adjust the Peak Record range in options.
                      </Callout>
                    )}
                  </div>

                  {peaksInRange.length > 0 && (
                    <div className="overflow-x-auto">
                      <p className="text-xs text-gray-500 mb-2">
                        Uncheck a year to exclude it from the FFA, then click <strong>Run Analysis</strong>.
                      </p>
                      <table className="min-w-full text-sm border border-gray-200 rounded">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                          <tr>
                            <th className="px-3 py-2 text-center w-12">Include</th>
                            <th className="px-4 py-2 text-left">Year</th>
                            <th className="px-4 py-2 text-right">Peak (m³/s)</th>
                            <th className="px-4 py-2 text-left">Date</th>
                            <th className="px-4 py-2 text-left">Flag</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {[...peaksInRange].sort((a, b) => b.year - a.year).map((p) => {
                            const excluded = excludedYears.has(p.year);
                            return (
                              <tr key={p.year} className={excluded ? "bg-gray-50 opacity-60" : ""}>
                                <td className="px-3 py-1.5 text-center">
                                  <input type="checkbox" checked={!excluded}
                                    onChange={() => toggleYear(p.year)} />
                                </td>
                                <td className="px-4 py-1.5 font-medium">{p.year}</td>
                                <td className="px-4 py-1.5 text-right font-mono">
                                  {p.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-4 py-1.5 text-gray-500 text-xs">{p.date ?? "—"}</td>
                                <td className="px-4 py-1.5">
                                  {p.symbol && <span className="text-xs text-gray-500 italic">{p.symbol}</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── Frequency plot ── */}
              {tab === "freq" && (
                <div className="bg-white border border-gray-200 rounded p-2">
                  <Plot
                    data={[
                      {
                        x: result.plotting_positions.map((p) => p.return_period),
                        y: result.plotting_positions.map((p) => p.value),
                        type: "scatter", mode: "markers",
                        marker: { color: "#1f2937", size: 7, symbol: "circle" },
                        name: "Observed (plotting position)",
                      },
                      ...fitted.map((d) => ({
                        x: d.curve.map((c) => c.return_period),
                        y: d.curve.map((c) => c.value),
                        type: "scatter" as const, mode: "lines" as const,
                        line: {
                          color: DIST_COLORS[d.key] ?? "#999",
                          width: d.key === best ? 2.5 : 1.5,
                          dash: (d.key === best ? "solid" : "dot") as "solid" | "dot",
                        },
                        name: d.label + (d.key === best ? " ★" : ""),
                      })),
                      ...(best && fitted.find((d) => d.key === best)
                        ? (() => {
                            const bd = fitted.find((d) => d.key === best)!;
                            const pts = bd.quantiles.filter((q) => q.ci_lower !== null);
                            return [{
                              x: [...pts.map((q) => q.return_period), ...pts.map((q) => q.return_period).reverse()],
                              y: [...pts.map((q) => q.ci_upper ?? 0), ...pts.map((q) => q.ci_lower ?? 0).reverse()],
                              type: "scatter" as const, mode: "lines" as const,
                              fill: "toself" as const,
                              fillcolor: (DIST_COLORS[best] ?? "#999") + "22",
                              line: { color: "transparent" },
                              name: `${best.toUpperCase()} CI`, showlegend: true,
                            }];
                          })()
                        : []),
                    ]}
                    layout={{
                      title: { text: strings.ffa.frequencyPlot },
                      xaxis: { title: { text: "Return Period (yr)" }, type: "log",
                        tickvals: [2, 5, 10, 20, 50, 100, 200, 500] },
                      yaxis: { title: { text: "Peak Discharge (m³/s)" } },
                      height: 480, legend: { orientation: "h", y: -0.25 },
                      margin: { l: 70, r: 20, t: 50, b: 100 },
                    }}
                    config={{ responsive: true,
                      toImageButtonOptions: { format: "png", filename: `${stationId}_frequency_plot` } }}
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              {/* ── Design flood table ── */}
              {tab === "table" && (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm border border-gray-200 rounded text-right">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <tr>
                        <th className="px-4 py-2 text-left">Return Period (yr)</th>
                        <th className="px-4 py-2 text-left">AEP</th>
                        {fitted.map((d) => (
                          <th key={d.key} className="px-4 py-2" style={{ color: DIST_COLORS[d.key] }}>
                            {d.key.toUpperCase()}{d.key === best ? " ★" : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {options.return_periods.map((t) => (
                        <tr key={t} className={t >= 100 ? "bg-blue-50" : ""}>
                          <td className="px-4 py-2 text-left font-medium">{t}</td>
                          <td className="px-4 py-2 text-left text-gray-500">{fmtAep(t)}</td>
                          {fitted.map((d) => {
                            const q = d.quantiles.find((q) => q.return_period === t);
                            return (
                              <td key={d.key} className="px-4 py-2">
                                {q ? (
                                  <span>
                                    <span className="font-mono font-medium">{fmtDischarge(q.value)}</span>
                                    {q.ci_lower !== null && (
                                      <span className="block text-xs text-gray-400">
                                        [{fmtDischarge(q.ci_lower)}–{fmtDischarge(q.ci_upper)}]
                                      </span>
                                    )}
                                  </span>
                                ) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-400 mt-2">
                    Values in m³/s. Confidence intervals in brackets. ★ = best fit by AIC.
                    Using {peaksForFfa.length} peak years.
                  </p>
                </div>
              )}

              {/* ── Goodness of fit ── */}
              {tab === "gof" && (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm border border-gray-200 rounded">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <tr>
                        <th className="px-4 py-2 text-left">Distribution</th>
                        <th className="px-4 py-2 text-right">AIC</th>
                        <th className="px-4 py-2 text-right">BIC</th>
                        <th className="px-4 py-2 text-right">KS stat</th>
                        <th className="px-4 py-2 text-right">KS p-value</th>
                        <th className="px-4 py-2 text-right">AD stat</th>
                        <th className="px-4 py-2 text-right">RMSE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {[...result.distributions]
                        .sort((a, b) => (a.goodness_of_fit?.aic ?? Infinity) - (b.goodness_of_fit?.aic ?? Infinity))
                        .map((d) => (
                          <tr key={d.key} className={d.key === best ? "bg-blue-50" : ""}>
                            <td className="px-4 py-2 font-medium" style={{ color: DIST_COLORS[d.key] }}>
                              {d.label}{d.key === best ? " ★" : ""}
                            </td>
                            {d.fit_error ? (
                              <td colSpan={6} className="px-4 py-2 text-red-600 text-xs">{d.fit_error}</td>
                            ) : d.goodness_of_fit ? (
                              <>
                                <td className="px-4 py-2 text-right font-mono">{fmt(d.goodness_of_fit.aic, 1)}</td>
                                <td className="px-4 py-2 text-right font-mono">{fmt(d.goodness_of_fit.bic, 1)}</td>
                                <td className="px-4 py-2 text-right font-mono">{fmt(d.goodness_of_fit.ks_stat, 4)}</td>
                                <td className="px-4 py-2 text-right font-mono">{fmt(d.goodness_of_fit.ks_pvalue, 4)}</td>
                                <td className="px-4 py-2 text-right font-mono">{fmt(d.goodness_of_fit.ad_stat, 4)}</td>
                                <td className="px-4 py-2 text-right font-mono">{fmt(d.goodness_of_fit.rmse, 2)}</td>
                              </>
                            ) : null}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-400 mt-2">★ = best fit by AIC (lowest). Ranked ascending by AIC.</p>
                </div>
              )}

              {/* ── Trend Analysis tab ── */}
              {tab === "trend" && (
                <div className="space-y-8">
                  {!mkResult || !mkSorted ? (
                    <Callout level="info">Load at least 5 years of peak data to run trend analysis.</Callout>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        {[
                          ["n years",    mkResult.n.toString()],
                          ["Kendall τ",  mkResult.tau.toFixed(3)],
                          ["p-value",    mkResult.pValue < 0.001 ? "< 0.001" : mkResult.pValue.toFixed(3)],
                          ["Sen's slope", (mkResult.senSlope >= 0 ? "+" : "") + mkResult.senSlope.toFixed(2) + " m³/s/yr"],
                        ].map(([label, value]) => (
                          <div key={label} className="bg-gray-50 border border-gray-200 rounded px-3 py-2">
                            <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
                            <p className={`font-semibold mt-0.5 ${
                              label === "p-value" && mkResult.significant ? "text-amber-700" : "text-gray-800"}`}>
                              {value}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* Plot 1: Peaks + Sen's slope */}
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700 mb-2">
                          Annual Peaks with Sen's Slope Trend Line
                        </h3>
                        <div className="bg-white border border-gray-200 rounded p-2">
                          <Plot
                            data={(() => {
                              const years  = mkSorted.map((p) => p.year);
                              const values = mkSorted.map((p) => p.value);
                              const x0 = years[0], x1 = years[years.length - 1];
                              const trendY = (t: number) => mkResult.senSlope * t + (senIntercept ?? 0);
                              return [
                                { x: mkSorted.filter((p) => !excludedYears.has(p.year)).map((p) => p.year),
                                  y: mkSorted.filter((p) => !excludedYears.has(p.year)).map((p) => p.value),
                                  type: "bar" as const, marker: { color: "#93c5fd" }, name: "Annual peak (included)" },
                                ...(excludedYears.size > 0 ? [{
                                  x: mkSorted.filter((p) => excludedYears.has(p.year)).map((p) => p.year),
                                  y: mkSorted.filter((p) => excludedYears.has(p.year)).map((p) => p.value),
                                  type: "bar" as const, marker: { color: "#d1d5db" }, name: "Excluded",
                                }] : []),
                                { x: [x0, x1], y: [trendY(x0), trendY(x1)],
                                  type: "scatter" as const, mode: "lines" as const,
                                  line: { color: mkResult.significant ? "#dc2626" : "#6b7280", width: 2.5 },
                                  name: `Sen's slope (${(mkResult.senSlope >= 0 ? "+" : "") + mkResult.senSlope.toFixed(2)} m³/s/yr)` },
                                { x: years, y: values, type: "scatter" as const, mode: "markers" as const,
                                  marker: { color: "#1e40af", size: 6, symbol: "circle" },
                                  name: "Peak value", showlegend: false },
                              ];
                            })()}
                            layout={{
                              title: { text: "Annual Maximum Peaks with Trend" },
                              xaxis: { title: { text: "Year" } },
                              yaxis: { title: { text: "Peak Discharge (m³/s)" } },
                              barmode: "overlay", height: 400,
                              margin: { l: 70, r: 20, t: 50, b: 50 },
                              legend: { orientation: "h", y: -0.22 },
                            }}
                            config={{ responsive: true,
                              toImageButtonOptions: { format: "png", filename: `${stationId}_peaks_trend` } }}
                            style={{ width: "100%" }}
                          />
                        </div>
                      </div>

                      {/* Plot 2: Sequential MK */}
                      {seqMk && (
                        <div>
                          <h3 className="text-sm font-semibold text-gray-700 mb-1">
                            Sequential Mann-Kendall (Sneyers Test)
                          </h3>
                          <p className="text-xs text-gray-500 mb-2">
                            Forward u(t) traces trend accumulation from the beginning; backward u′(t)
                            traces it from the end. Intersections near the ±1.96 lines indicate
                            approximate change-point years.
                          </p>
                          <div className="bg-white border border-gray-200 rounded p-2">
                            <Plot
                              data={(() => {
                                const tMin = mkSorted[0].year;
                                const tMax = mkSorted[mkSorted.length - 1].year;
                                const cv   = seqMk.criticalValue;
                                return [
                                  { x: seqMk.forward.map((p) => p.t), y: seqMk.forward.map((p) => p.u),
                                    type: "scatter" as const, mode: "lines" as const,
                                    line: { color: "#2563eb", width: 2 }, name: "u(t) forward" },
                                  { x: seqMk.backward.map((p) => p.t), y: seqMk.backward.map((p) => p.u),
                                    type: "scatter" as const, mode: "lines" as const,
                                    line: { color: "#dc2626", width: 2, dash: "dash" as const }, name: "u′(t) backward" },
                                  { x: [tMin, tMax], y: [cv, cv],
                                    type: "scatter" as const, mode: "lines" as const,
                                    line: { color: "#6b7280", width: 1, dash: "dot" as const },
                                    name: `+${cv} (α = 0.05)` },
                                  { x: [tMin, tMax], y: [-cv, -cv],
                                    type: "scatter" as const, mode: "lines" as const,
                                    line: { color: "#6b7280", width: 1, dash: "dot" as const },
                                    name: `-${cv} (α = 0.05)`, showlegend: false },
                                  { x: [tMin, tMax], y: [0, 0],
                                    type: "scatter" as const, mode: "lines" as const,
                                    line: { color: "#d1d5db", width: 1 },
                                    name: "No trend", showlegend: false },
                                ];
                              })()}
                              layout={{
                                title: { text: "Sequential Mann-Kendall (Sneyers Test)" },
                                xaxis: { title: { text: "Year" } },
                                yaxis: { title: { text: "Standardised MK statistic u(t)" }, zeroline: false },
                                height: 400, margin: { l: 70, r: 20, t: 50, b: 50 },
                                legend: { orientation: "h", y: -0.22 },
                                shapes: [{
                                  type: "rect" as const, xref: "paper" as const, yref: "y" as const,
                                  x0: 0, x1: 1, y0: -seqMk.criticalValue, y1: seqMk.criticalValue,
                                  fillcolor: "rgba(220,252,231,0.3)", line: { width: 0 },
                                }],
                              }}
                              config={{ responsive: true,
                                toImageButtonOptions: { format: "png", filename: `${stationId}_sequential_mk` } }}
                              style={{ width: "100%" }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Plot 3: Cumulative departure */}
                      {seqMk && (
                        <div>
                          <h3 className="text-sm font-semibold text-gray-700 mb-1">
                            Cumulative Departure from Mean
                          </h3>
                          <p className="text-xs text-gray-500 mb-2">
                            Sustained positive or negative departures highlight multi-year wet/dry periods.
                          </p>
                          <div className="bg-white border border-gray-200 rounded p-2">
                            <Plot
                              data={[{
                                x: seqMk.cumulDep.map((p) => p.t),
                                y: seqMk.cumulDep.map((p) => p.u),
                                type: "scatter" as const, mode: "lines" as const,
                                fill: "tozeroy" as const,
                                line: { color: "#7c3aed", width: 2 },
                                fillcolor: "rgba(124,58,237,0.12)",
                                name: "Cumulative departure (σ)",
                              }]}
                              layout={{
                                title: { text: "Cumulative Standardised Departure from Mean" },
                                xaxis: { title: { text: "Year" } },
                                yaxis: { title: { text: "Σ (xᵢ − x̄) / σ" }, zeroline: true },
                                height: 340, margin: { l: 70, r: 20, t: 50, b: 50 },
                                legend: { orientation: "h", y: -0.22 },
                              }}
                              config={{ responsive: true,
                                toImageButtonOptions: { format: "png", filename: `${stationId}_cumul_departure` } }}
                              style={{ width: "100%" }}
                            />
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── POT Analysis tab (Feature 14) ── */}
              {tab === "pot" && (
                <div className="space-y-6">
                  {/* Controls */}
                  <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-3">
                    <div className="flex flex-wrap gap-4 items-end">
                      {/* Threshold mode toggle */}
                      <div>
                        <p className="text-xs font-medium text-gray-600 mb-1.5">Threshold Mode</p>
                        <div className="flex rounded border border-gray-300 overflow-hidden text-xs">
                          <button onClick={() => setPotManualMode(false)}
                            className={`px-3 py-1.5 transition-colors ${!potManualMode ? "bg-blue-600 text-white" : "bg-white text-gray-700"}`}>
                            Percentile
                          </button>
                          <button onClick={() => setPotManualMode(true)}
                            className={`px-3 py-1.5 transition-colors ${potManualMode ? "bg-blue-600 text-white" : "bg-white text-gray-700"}`}>
                            Manual (m³/s)
                          </button>
                        </div>
                      </div>

                      {/* Percentile slider */}
                      {!potManualMode && (
                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1.5">
                            Percentile: {potThreshPct}%
                            {potThreshold !== null && ` ≈ ${potThreshold.toFixed(1)} m³/s`}
                          </p>
                          <input type="range" min={50} max={99} step={1}
                            value={potThreshPct}
                            onChange={(e) => setPotThreshPct(Number(e.target.value))}
                            className="w-40" />
                        </div>
                      )}

                      {/* Manual threshold */}
                      {potManualMode && (
                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1.5">Threshold (m³/s)</p>
                          <input type="number" min={0} step={1}
                            value={potManualVal}
                            onChange={(e) => setPotManualVal(e.target.value)}
                            placeholder="e.g. 250"
                            className="w-32 border border-gray-300 rounded px-2 py-1 text-xs" />
                        </div>
                      )}

                      {/* Separation gap */}
                      <div>
                        <p className="text-xs font-medium text-gray-600 mb-1.5">Min Separation Gap</p>
                        <select value={potSepGap}
                          onChange={(e) => setPotSepGap(Number(e.target.value))}
                          className="border border-gray-300 rounded px-2 py-1 text-xs">
                          <option value={3}>3 days</option>
                          <option value={7}>7 days</option>
                          <option value={14}>14 days</option>
                          <option value={30}>30 days</option>
                        </select>
                      </div>
                    </div>

                    {/* Peak count + λ */}
                    {potResult && potThreshold !== null && (
                      <p className="text-xs text-gray-500">
                        <strong>{potResult.peaks.length}</strong> POT peaks above{" "}
                        {potThreshold.toFixed(1)} m³/s
                        {potResult.params && (
                          <> · λ = {potResult.params.lambda.toFixed(2)} events/year on average</>
                        )}
                      </p>
                    )}
                  </div>

                  {/* Loading / error */}
                  {dailyLoading && (
                    <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
                      Loading daily data…
                    </div>
                  )}
                  {dailyError && <Callout level="error">Daily data error: {dailyError}</Callout>}
                  {!dailySeries && !dailyLoading && !dailyError && (
                    <Callout level="info">Daily data will load automatically when you open this tab.</Callout>
                  )}

                  {potResult && (
                    <>
                      {potResult.warning && <Callout level="caution">{potResult.warning}</Callout>}

                      {/* Chart 1: POT peaks over time */}
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700 mb-2">
                          POT Peaks over Time
                        </h3>
                        <div className="bg-white border border-gray-200 rounded p-2">
                          <Plot
                            data={[{
                              x: potResult.peaks.map((p) => p.date),
                              y: potResult.peaks.map((p) => p.value),
                              type: "bar", marker: { color: "#0891b2" }, name: "POT peak",
                            }]}
                            layout={{
                              title: { text: `POT Peaks (threshold = ${potThreshold?.toFixed(1)} m³/s)` },
                              xaxis: { title: { text: "Date" } },
                              yaxis: { title: { text: "Discharge (m³/s)" } },
                              height: 320,
                              margin: { l: 70, r: 20, t: 50, b: 50 },
                              shapes: potThreshold !== null ? [{
                                type: "line" as const, xref: "paper" as const, yref: "y" as const,
                                x0: 0, x1: 1, y0: potThreshold, y1: potThreshold,
                                line: { color: "#dc2626", width: 1.5, dash: "dash" as const },
                              }] : [],
                            }}
                            config={{ responsive: true,
                              toImageButtonOptions: { format: "png", filename: `${stationId}_pot_peaks` } }}
                            style={{ width: "100%" }}
                          />
                        </div>
                      </div>

                      {/* Chart 2: GPD frequency curve */}
                      {potResult.params && (() => {
                        const params = potResult.params as GpdParams;
                        const n = potResult.peaks.length;
                        const sortedPeaks = [...potResult.peaks].sort((a, b) => a.value - b.value);
                        // Cunnane plotting positions for POT peaks
                        const empirical = sortedPeaks.map((p, i) => {
                          const excProb = 1 - (i + 1 - 0.4) / (n + 0.2);
                          const rp = 1 / (excProb * params.lambda);
                          return { rp: Math.max(rp, 1.01), value: p.value };
                        });
                        const rpCurve = [1.1, 2, 5, 10, 20, 50, 100, 200, 500];
                        const fittedCurve = computePotQuantiles(params, rpCurve)
                          .filter((q) => q.quantile !== null);
                        return (
                          <div>
                            <h3 className="text-sm font-semibold text-gray-700 mb-2">
                              GPD Frequency Curve
                            </h3>
                            <div className="bg-white border border-gray-200 rounded p-2">
                              <Plot
                                data={[
                                  {
                                    x: empirical.map((p) => p.rp),
                                    y: empirical.map((p) => p.value),
                                    type: "scatter" as const, mode: "markers" as const,
                                    marker: { color: "#1f2937", size: 7, symbol: "circle" },
                                    name: "Observed (Cunnane)",
                                  },
                                  {
                                    x: fittedCurve.map((q) => q.returnPeriod),
                                    y: fittedCurve.map((q) => q.quantile!),
                                    type: "scatter" as const, mode: "lines" as const,
                                    line: { color: "#0891b2", width: 2.5 },
                                    name: "GPD fitted",
                                  },
                                ]}
                                layout={{
                                  title: { text: `GPD Frequency Curve — λ = ${params.lambda.toFixed(2)} ev/yr` },
                                  xaxis: { title: { text: "Return Period (yr)" }, type: "log",
                                    tickvals: [2, 5, 10, 20, 50, 100, 200, 500] },
                                  yaxis: { title: { text: "Discharge (m³/s)" } },
                                  height: 420,
                                  margin: { l: 70, r: 20, t: 50, b: 80 },
                                  legend: { orientation: "h", y: -0.2 },
                                }}
                                config={{ responsive: true,
                                  toImageButtonOptions: { format: "png", filename: `${stationId}_gpd_freq` } }}
                                style={{ width: "100%" }}
                              />
                            </div>
                          </div>
                        );
                      })()}

                      {/* Quantile table */}
                      {potResult.params && (
                        <div>
                          <h3 className="text-sm font-semibold text-gray-700 mb-2">
                            GPD Design Flood Estimates
                          </h3>
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm border border-gray-200 rounded text-right">
                              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                                <tr>
                                  <th className="px-4 py-2 text-left">Return Period (yr)</th>
                                  <th className="px-4 py-2 text-left">AEP</th>
                                  <th className="px-4 py-2">GPD Quantile (m³/s)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {computePotQuantiles(potResult.params, DEFAULT_POT_RETURN_PERIODS).map((q) => (
                                  <tr key={q.returnPeriod} className={q.returnPeriod >= 100 ? "bg-blue-50" : ""}>
                                    <td className="px-4 py-2 text-left font-medium">{q.returnPeriod}</td>
                                    <td className="px-4 py-2 text-left text-gray-500">{fmtAep(q.returnPeriod)}</td>
                                    <td className="px-4 py-2 font-mono">
                                      {q.quantile !== null ? fmtDischarge(q.quantile) : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p className="text-xs text-gray-400 mt-2">
                              GPD fitted by L-moments.{" "}
                              λ = {potResult.params.lambda.toFixed(2)} events/yr ·{" "}
                              ξ = {potResult.params.shape.toFixed(4)} ·{" "}
                              σ = {potResult.params.scale.toFixed(2)} m³/s ·{" "}
                              u = {potResult.params.threshold.toFixed(1)} m³/s
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Methodology accordion ── */}
      <MethodologyBox id={tab} />
    </div>
  );
}
