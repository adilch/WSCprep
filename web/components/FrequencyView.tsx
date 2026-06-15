"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import type {
  FrequencyResponse, FrequencyRequest, PeakPoint, PeaksResponse, DailyPoint,
  Station,
} from "@/lib/types";
import {
  transferScaleFactor, findNearbyDonors, DEFAULT_TRANSFER_EXPONENT,
  AREA_RATIO_VALID_MIN, AREA_RATIO_VALID_MAX,
} from "@/lib/transfer";
import {
  REGRESSION_PARAMS, computeYValue, fitPowerLaw, predictPowerLaw, predictionRange,
} from "@/lib/regression";
import type { RegressionParam, StationFlowData } from "@/lib/regression";
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

const BASE_RETURN_PERIODS = [2, 5, 10, 20, 25, 50, 100, 200, 500];
/** Allowed upper bounds for the frequency analysis. */
const MAX_RP_OPTIONS = [500, 1000, 10000] as const;
type MaxRp = (typeof MAX_RP_OPTIONS)[number];

/** Return periods to analyse for a given upper bound. */
function returnPeriodsForMax(maxRp: MaxRp): number[] {
  return [...BASE_RETURN_PERIODS, ...[1000, 10000].filter((t) => t <= maxRp)];
}

/** Parse the ?rp= URL param into a valid max return period (default 500). */
function parseMaxRp(value: string | null): MaxRp {
  const v = parseInt(value ?? "", 10);
  return v === 1000 || v === 10000 ? v : 500;
}

const VALID_TABS = ["peaks", "freq", "table", "gof", "trend", "pot", "transfer", "regression"] as const;

const REG_MAX_GAUGES = 15;
type FfaTab = (typeof VALID_TABS)[number];

export function FrequencyView({ stationId }: { stationId: string }) {
  const searchParams = useSearchParams();
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

  // Options restored from URL params so a copied link reproduces the analysis.
  const [options, setOptions] = useState<Omit<FrequencyRequest, "peaks">>(() => {
    const dist = searchParams.get("dist")?.split(",")
      .filter((d) => ALL_DISTRIBUTIONS.includes(d));
    const est = searchParams.get("est");
    const pp  = searchParams.get("pp");
    return {
      distributions:    dist?.length ? dist : ALL_DISTRIBUTIONS,
      estimation_method: est === "mom" ? "mom" : "lmoments",
      plotting_position:
        pp === "weibull" || pp === "gringorten" ? pp : "cunnane",
      return_periods:    returnPeriodsForMax(parseMaxRp(searchParams.get("rp"))),
      exclude_estimated: searchParams.get("inclEst") !== "1",
      confidence_level:  searchParams.get("cl") === "0.95" ? 0.95 : 0.9,
      ci_method:         "bootstrap",
      bootstrap_samples: 2000,
    };
  });

  // Upper bound for return periods — drives both the table and the plot axis.
  const [maxRp, setMaxRp] = useState<MaxRp>(() => parseMaxRp(searchParams.get("rp")));

  // Keep the analysed return periods in sync with the selected upper bound.
  // Changing this triggers runAnalysis via the options dependency.
  useEffect(() => {
    setOptions((o) => {
      const next = returnPeriodsForMax(maxRp);
      return next.length === o.return_periods.length ? o : { ...o, return_periods: next };
    });
  }, [maxRp]);

  // ── Annual peaks (fetched independently) ──────────────────────────────────
  const [peaks,     setPeaks]     = useState<PeakPoint[] | null>(null);
  const [peaksErr,  setPeaksErr]  = useState<string | null>(null);

  const peaksYearRange = useMemo<[number, number] | null>(() => {
    if (!peaks?.length) return null;
    const years = peaks.map((p) => p.year);
    return [Math.min(...years), Math.max(...years)];
  }, [peaks]);

  const [yearRange, setYearRange] = useState<[number, number] | null>(null);

  // Year range requested via URL (?yr=1975-2010) — applied once when peaks load.
  const urlYearRangeRef = useRef<[number, number] | null>((() => {
    const m = /^(\d{4})-(\d{4})$/.exec(searchParams.get("yr") ?? "");
    if (!m) return null;
    const lo = Number(m[1]), hi = Number(m[2]);
    return lo < hi ? [lo, hi] : null;
  })());

  // Re-run analysis after URL-restored range/exclusions are applied to refs.
  const [needsRerun, setNeedsRerun] = useState(false);

  const [excludedYears, setExcludedYears] = useState<Set<number>>(() => {
    const ex = searchParams.get("ex");
    if (!ex) return new Set();
    return new Set(
      ex.split(",").map(Number).filter((y) => Number.isInteger(y) && y > 1800)
    );
  });

  useEffect(() => {
    if (!peaksYearRange) return;
    const u = urlYearRangeRef.current;
    urlYearRangeRef.current = null; // apply once
    let applied = false;
    if (u) {
      const lo = Math.max(peaksYearRange[0], u[0]);
      const hi = Math.min(peaksYearRange[1], u[1]);
      if (lo < hi && (lo !== peaksYearRange[0] || hi !== peaksYearRange[1])) {
        setYearRange([lo, hi]);
        applied = true;
      }
    }
    if (!applied) setYearRange(peaksYearRange);
    // The mount-time auto-run races the peaks fetch, so restored filters
    // wouldn't be in that request — trigger a corrective run.
    if (applied || excludedYearsRef.current.size > 0) setNeedsRerun(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peaksYearRange]);

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
  const [potThreshPct,   setPotThreshPct]   = useState(() => {
    const v = parseInt(searchParams.get("pthr") ?? "", 10);
    return v >= 50 && v <= 99 ? v : 90;
  });
  const [potManualVal,   setPotManualVal]   = useState(() => searchParams.get("pman") ?? "");
  const [potManualMode,  setPotManualMode]  = useState(() => searchParams.get("pman") !== null);
  const [potSepGap,      setPotSepGap]      = useState(() => {
    const v = parseInt(searchParams.get("pgap") ?? "", 10);
    return [3, 7, 14, 30].includes(v) ? v : 7;
  });

  // ── Area-ratio transfer state ─────────────────────────────────────────────
  const [station,         setStation]         = useState<Station | null>(null);
  const [catalog,         setCatalog]         = useState<Station[] | null>(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError,   setTransferError]   = useState<string | null>(null);
  const [siteAreaStr,     setSiteAreaStr]     = useState(() => searchParams.get("ta") ?? "");
  const [transferExp,     setTransferExp]     = useState(() => {
    const v = parseFloat(searchParams.get("tn") ?? "");
    return v >= 0.3 && v <= 1.2 ? v : DEFAULT_TRANSFER_EXPONENT;
  });

  // ── Regional regression state ─────────────────────────────────────────────
  const [regSelected, setRegSelected] = useState<string[]>(() => {
    const rg = searchParams.get("rg");
    if (rg) {
      const ids = [...new Set(rg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
      if (ids.length) return ids.slice(0, REG_MAX_GAUGES);
    }
    return [stationId.toUpperCase()];
  });
  const [regParam, setRegParam] = useState<RegressionParam>(() => {
    const ry = searchParams.get("ry");
    return ry && ry in REGRESSION_PARAMS ? (ry as RegressionParam) : "meanPeak";
  });
  const [regPredictArea, setRegPredictArea] = useState(() => searchParams.get("ra") ?? "");
  const [regExclRegulated, setRegExclRegulated] = useState(true);
  const [regAddInput,  setRegAddInput]  = useState("");
  const [regAddError,  setRegAddError]  = useState<string | null>(null);
  /** Fetched flow data per station; error blocks refetch for the session. */
  const [regData, setRegData] = useState<Record<string, StationFlowData & { error?: string }>>({});
  const regFetching = useRef(new Set<string>());

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

  // ── Lazy-fetch station metadata + catalog (Transfer & Regression tabs) ────
  useEffect(() => {
    if ((tab !== "transfer" && tab !== "regression") || (station && catalog) || transferLoading) return;
    setTransferLoading(true);
    setTransferError(null);
    Promise.all([
      station ?? fetch(`/api/stations/${stationId}`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      catalog ?? fetch(`/api/stations`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    ])
      .then(([st, cat]) => { setStation(st); setCatalog(cat); })
      .catch((e) => setTransferError(e instanceof Error ? e.message : "Failed to load station data"))
      .finally(() => setTransferLoading(false));
  }, [tab, stationId, station, catalog, transferLoading]);

  // ── Transfer derived values ───────────────────────────────────────────────
  const siteArea = useMemo(() => {
    const v = parseFloat(siteAreaStr);
    return isFinite(v) && v > 0 ? v : null;
  }, [siteAreaStr]);

  const donorArea   = station?.drainage_area_gross_km2 ?? null;
  const areaRatio   = siteArea !== null && donorArea ? siteArea / donorArea : null;
  const scaleFactor = siteArea !== null && donorArea
    ? transferScaleFactor(siteArea, donorArea, transferExp) : null;

  const nearbyDonors = useMemo(() => {
    if (!catalog || !station) return null;
    return findNearbyDonors(
      catalog, station.latitude, station.longitude, station.station_number, 8);
  }, [catalog, station]);

  // ── Regression: fetch flow data for selected gauges ───────────────────────
  useEffect(() => {
    if (tab !== "regression") return;
    const needs = REGRESSION_PARAMS[regParam].needs;
    regSelected.forEach((id) => {
      const have = regData[id];
      if (have?.error) return;
      if (needs === "peaks" ? have?.peaks : have?.daily) return;
      const key = `${id}:${needs}`;
      if (regFetching.current.has(key)) return;
      regFetching.current.add(key);
      const url = needs === "peaks"
        ? `/api/stations/${id}/peaks`
        : `/api/stations/${id}/daily?variable=discharge`;
      fetch(url)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((d) => setRegData((m) => ({
          ...m,
          [id]: needs === "peaks"
            ? { ...m[id], peaks: d.peaks }
            : { ...m[id], daily: d.series },
        })))
        .catch((e) => setRegData((m) => ({
          ...m,
          [id]: { ...m[id], error: e instanceof Error ? e.message : "fetch failed" },
        })))
        .finally(() => regFetching.current.delete(key));
    });
  }, [tab, regParam, regSelected, regData]);

  // ── Regression: derived points + fit ──────────────────────────────────────
  const catalogById = useMemo(() => {
    if (!catalog) return null;
    return new Map(catalog.map((s) => [s.station_number, s]));
  }, [catalog]);

  const regPoints = useMemo(() => {
    if (!catalogById) return null;
    const needs = REGRESSION_PARAMS[regParam].needs;
    return regSelected.map((id) => {
      const st   = catalogById.get(id) ?? null;
      const data = regData[id];
      const area = st?.drainage_area_gross_km2 ?? null;
      let y: number | null = null;
      let status: "ok" | "loading" | "error" | "noArea" | "noY";
      if (!st)                            status = "error";
      else if (area === null || area <= 0) status = "noArea";
      else if (data?.error)               status = "error";
      else if (needs === "peaks" ? data?.peaks : data?.daily) {
        y = computeYValue(regParam, data, area);
        status = y !== null && y > 0 ? "ok" : "noY";
      } else                              status = "loading";
      return { id, st, area, y, status };
    });
  }, [catalogById, regSelected, regData, regParam]);

  const regFit = useMemo(() => {
    if (!regPoints) return null;
    const pts = regPoints
      .filter((p) => p.status === "ok" && !(regExclRegulated && p.st?.regulated))
      .map((p) => ({ x: p.area as number, y: p.y as number }));
    return fitPowerLaw(pts);
  }, [regPoints, regExclRegulated]);

  const regPredArea = useMemo(() => {
    const v = parseFloat(regPredictArea);
    return isFinite(v) && v > 0 ? v : null;
  }, [regPredictArea]);

  // Nearby gauges not yet in the set, for the picker sidebar.
  const regNearby = useMemo(() => {
    if (!catalog || !station) return null;
    return findNearbyDonors(
      catalog, station.latitude, station.longitude, station.station_number, 40)
      .filter((d) => !regSelected.includes(d.station.station_number))
      .slice(0, 12);
  }, [catalog, station, regSelected]);

  const addRegStation = (raw: string) => {
    const id = raw.trim().toUpperCase();
    setRegAddError(null);
    if (!id) return;
    if (regSelected.includes(id))            { setRegAddError(`${id} is already in the set.`); return; }
    if (regSelected.length >= REG_MAX_GAUGES) { setRegAddError(`Maximum ${REG_MAX_GAUGES} gauges.`); return; }
    const st = catalogById?.get(id);
    if (!st)                          { setRegAddError(`Station ${id} not found.`); return; }
    if (!st.drainage_area_gross_km2)  { setRegAddError(`${id} has no published drainage area.`); return; }
    setRegSelected((s) => [...s, id]);
    setRegAddInput("");
  };

  const removeRegStation = (id: string) =>
    setRegSelected((s) => s.filter((x) => x !== id));

  // ── URL sync — full analysis state, defaults omitted for clean URLs ──────
  // Uses history.replaceState (integrates with the Next router) so slider
  // moves don't trigger server round-trips.
  useEffect(() => {
    const p = new URLSearchParams();
    if (tab !== "freq") p.set("tab", tab);
    if (options.distributions.length !== ALL_DISTRIBUTIONS.length)
      p.set("dist", options.distributions.join(","));
    if (options.estimation_method !== "lmoments") p.set("est", options.estimation_method);
    if (options.plotting_position !== "cunnane")  p.set("pp", options.plotting_position);
    if (options.confidence_level !== 0.9)         p.set("cl", String(options.confidence_level));
    if (!options.exclude_estimated)               p.set("inclEst", "1");
    if (peaksYearRange && yearRange &&
        (yearRange[0] !== peaksYearRange[0] || yearRange[1] !== peaksYearRange[1]))
      p.set("yr", `${yearRange[0]}-${yearRange[1]}`);
    if (excludedYears.size > 0)
      p.set("ex", [...excludedYears].sort((a, b) => a - b).join(","));
    if (potManualMode) {
      if (potManualVal) p.set("pman", potManualVal);
    } else if (potThreshPct !== 90) {
      p.set("pthr", String(potThreshPct));
    }
    if (potSepGap !== 7) p.set("pgap", String(potSepGap));
    if (siteAreaStr) p.set("ta", siteAreaStr);
    if (transferExp !== DEFAULT_TRANSFER_EXPONENT) p.set("tn", String(transferExp));
    if (regSelected.length !== 1 || regSelected[0] !== stationId.toUpperCase())
      p.set("rg", regSelected.join(","));
    if (regParam !== "meanPeak") p.set("ry", regParam);
    if (regPredictArea) p.set("ra", regPredictArea);
    if (maxRp !== 500) p.set("rp", String(maxRp));

    const qs  = p.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (`${window.location.pathname}${window.location.search}` !== url)
      window.history.replaceState(null, "", url);
  }, [tab, options, yearRange, peaksYearRange, excludedYears,
      potManualMode, potManualVal, potThreshPct, potSepGap,
      siteAreaStr, transferExp, regSelected, regParam, regPredictArea,
      maxRp, stationId, pathname]);

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

  // Corrective re-run once URL-restored filters are reflected in the refs.
  useEffect(() => {
    if (!needsRerun) return;
    setNeedsRerun(false);
    runAnalysis();
  }, [needsRerun, runAnalysis]);

  // ── Copy shareable link ───────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — select-and-copy fallback
      window.prompt("Copy this link:", window.location.href);
    }
  };

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

  // Frequency-plot x-axis ticks/range follow the selected max return period.
  const freqAxis = useMemo(() => {
    const ticks = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 10000].filter((t) => t <= maxRp);
    return {
      tickvals: ticks,
      ticktext: ticks.map((t) => t.toLocaleString()),
      range: [Math.log10(1.5), Math.log10(maxRp * 1.5)] as [number, number],
    };
  }, [maxRp]);

  // Y-axis range from only the values inside the visible x-window, so the
  // off-screen high-return-period quantiles don't stretch the plot.
  const freqYRange = useMemo<[number, number] | undefined>(() => {
    if (!result) return undefined;
    const xMax = Math.pow(10, freqAxis.range[1]); // visible upper bound (years)
    const ys: number[] = [];
    result.plotting_positions.forEach((p) => {
      if (p.return_period <= xMax) ys.push(p.value);
    });
    fitted.forEach((d) => d.curve.forEach((c) => {
      if (c.return_period <= xMax) ys.push(c.value);
    }));
    if (best) {
      fitted.find((d) => d.key === best)?.quantiles.forEach((q) => {
        if (q.return_period > xMax) return;
        if (q.ci_lower != null) ys.push(q.ci_lower);
        if (q.ci_upper != null) ys.push(q.ci_upper);
      });
    }
    if (!ys.length) return undefined;
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const pad = (hi - lo) * 0.05 || hi * 0.05 || 1;
    return [Math.max(0, lo - pad), hi + pad];
  }, [result, fitted, best, freqAxis]);

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

          {/* Max return period */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Max Return Period</p>
            <div className="flex rounded border border-gray-300 overflow-hidden text-xs">
              {MAX_RP_OPTIONS.map((rp) => (
                <button key={rp} onClick={() => setMaxRp(rp)}
                  className={`px-2.5 py-1 transition-colors border-l border-gray-300 first:border-l-0 ${
                    maxRp === rp ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                  {rp.toLocaleString()}
                </button>
              ))}
              <span className="px-1.5 py-1 bg-white text-gray-400 border-l border-gray-300">yr</span>
            </div>
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

          <div className="ml-auto flex gap-2 self-end">
            <button onClick={copyLink}
              title="Copy a link that reproduces this exact analysis"
              className="border border-gray-300 bg-white text-gray-600 px-3 py-2 rounded text-sm hover:bg-gray-100 transition-colors">
              {copied ? "✓ Copied" : "🔗 Copy link"}
            </button>
            <button onClick={runAnalysis} disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {loading ? "Running…" : "Run Analysis"}
            </button>
          </div>
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
        <div className="flex flex-col items-center justify-center py-16 gap-5">

          {/* Spinner ring with chart icon inside */}
          <div className="relative w-16 h-16">
            {/* Static track */}
            <div className="absolute inset-0 rounded-full border-[3px] border-blue-100" />
            {/* Spinning arc */}
            <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-blue-600 animate-spin" />
            {/* Centre icon */}
            <div className="absolute inset-0 flex items-center justify-center text-blue-400">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="2"  y="13" width="4" height="8" rx="1" opacity="0.6" />
                <rect x="9"  y="8"  width="4" height="13" rx="1" opacity="0.8" />
                <rect x="16" y="3"  width="4" height="18" rx="1" />
              </svg>
            </div>
          </div>

          {/* Status text */}
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-gray-700">Running flood frequency analysis…</p>
            <p className="text-xs text-gray-400">
              Fitting {options.distributions.length} distribution{options.distributions.length !== 1 ? "s" : ""}&nbsp;·&nbsp;
              {options.bootstrap_samples.toLocaleString()} bootstrap samples&nbsp;·&nbsp;
              {peaksForFfa.length} peak years
            </p>
          </div>

          {/* Indeterminate progress bar */}
          <div className="w-72 h-1.5 bg-blue-100 rounded-full overflow-hidden">
            <div className="ffa-progress-bar h-full bg-blue-500 rounded-full" />
          </div>

          {/* Stage pills — staggered pulse */}
          <div className="flex gap-2 flex-wrap justify-center">
            {[
              "Fetching peaks",
              `${options.distributions.map((d) => d.toUpperCase()).join(" · ")}`,
              `${Math.round(options.confidence_level * 100)}% CI`,
              "Model selection",
            ].map((label, i) => (
              <span
                key={label}
                className="ffa-stage-pill px-3 py-1 rounded-full text-xs font-medium
                           bg-blue-50 text-blue-600 border border-blue-200"
                style={{ animationDelay: `${i * 0.3}s` }}
              >
                {label}
              </span>
            ))}
          </div>
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
                     : t === "pot"   ? `POT${potResult ? ` (${potResult.peaks.length})` : ""}`
                     : t === "transfer" ? "Ungauged Transfer"
                     : /* regression */  `Regression (${regSelected.length})`}
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
                        tickvals: freqAxis.tickvals,
                        ticktext: freqAxis.ticktext,
                        range: freqAxis.range },
                      yaxis: { title: { text: "Peak Discharge (m³/s)" },
                        range: freqYRange, autorange: freqYRange ? false : true },
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

              {/* ── Ungauged Transfer tab ── */}
              {tab === "transfer" && (
                <div className="space-y-6">
                  {transferLoading && (
                    <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
                      Loading station catalog…
                    </div>
                  )}
                  {transferError && (
                    <Callout level="error">Station data error: {transferError}</Callout>
                  )}

                  {station && (
                    <>
                      {/* Controls */}
                      <div className="bg-gray-50 border border-gray-200 rounded p-4">
                        <div className="flex flex-wrap gap-6 items-end">
                          <div>
                            <p className="text-xs font-medium text-gray-600 mb-1.5">Donor station</p>
                            <p className="text-sm font-medium text-gray-800">
                              {station.station_number} — {station.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              Drainage area:{" "}
                              {donorArea !== null
                                ? `${donorArea.toLocaleString()} km²`
                                : "not published"}
                              {station.regulated && " · regulated"}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs font-medium text-gray-600 mb-1.5">
                              Ungauged site area (km²)
                            </p>
                            <input type="number" min={0} step="any" value={siteAreaStr}
                              onChange={(e) => setSiteAreaStr(e.target.value)}
                              placeholder="e.g. 320"
                              className="w-36 border border-gray-300 rounded px-2 py-1.5 text-sm" />
                          </div>

                          <div>
                            <p className="text-xs font-medium text-gray-600 mb-1.5">
                              Exponent n = {transferExp.toFixed(2)}
                            </p>
                            <input type="range" min={0.5} max={1.0} step={0.01}
                              value={transferExp}
                              onChange={(e) => setTransferExp(Number(e.target.value))}
                              className="w-40" />
                            {transferExp !== DEFAULT_TRANSFER_EXPONENT && (
                              <button onClick={() => setTransferExp(DEFAULT_TRANSFER_EXPONENT)}
                                className="block text-xs text-blue-600 hover:underline">
                                Reset to 0.75
                              </button>
                            )}
                          </div>

                          {scaleFactor !== null && areaRatio !== null && (
                            <div className="bg-white border border-gray-200 rounded px-3 py-2">
                              <p className="text-xs text-gray-500">
                                Area ratio {areaRatio.toFixed(3)} → scale factor
                              </p>
                              <p className="text-lg font-semibold text-blue-700">
                                × {scaleFactor.toFixed(3)}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {donorArea === null && (
                        <Callout level="error">
                          This station has no published drainage area, so the area-ratio method
                          cannot be applied from here. Pick a donor from the nearby stations below.
                        </Callout>
                      )}

                      {station.regulated && scaleFactor !== null && (
                        <Callout level="caution">
                          The donor station is regulated. Transferred quantiles inherit the effects
                          of regulation and may not represent natural flood response at the
                          ungauged site.
                        </Callout>
                      )}

                      {areaRatio !== null &&
                        (areaRatio < AREA_RATIO_VALID_MIN || areaRatio > AREA_RATIO_VALID_MAX) && (
                        <Callout level="caution">
                          Area ratio {areaRatio.toFixed(2)} is outside the commonly accepted
                          validity range ({AREA_RATIO_VALID_MIN}–{AREA_RATIO_VALID_MAX}× the donor
                          area). Transferred estimates are unreliable — consider a similar-sized
                          donor or a regional regression approach.
                        </Callout>
                      )}

                      {/* Scaled design flood table */}
                      {scaleFactor !== null && fitted.length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold text-gray-700 mb-2">
                            Scaled Design Floods at Ungauged Site
                            ({siteArea?.toLocaleString()} km²)
                          </h3>
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm border border-gray-200 rounded text-right">
                              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                                <tr>
                                  <th className="px-4 py-2 text-left">Return Period (yr)</th>
                                  <th className="px-4 py-2 text-left">AEP</th>
                                  {fitted.map((d) => (
                                    <th key={d.key} className="px-4 py-2"
                                      style={{ color: DIST_COLORS[d.key] }}>
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
                                              <span className="font-mono font-medium">
                                                {fmtDischarge(q.value * scaleFactor)}
                                              </span>
                                              {q.ci_lower !== null && (
                                                <span className="block text-xs text-gray-400">
                                                  [{fmtDischarge(q.ci_lower * scaleFactor)}–
                                                  {fmtDischarge((q.ci_upper ?? 0) * scaleFactor)}]
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
                              Q_site = Q_donor × ({siteArea?.toLocaleString()} / {donorArea?.toLocaleString()})^
                              {transferExp.toFixed(2)} = Q_donor × {scaleFactor.toFixed(3)}.
                              Values in m³/s. CIs are the donor's bootstrap intervals scaled by the
                              same factor — they exclude transfer-method uncertainty. ★ = best fit by AIC.
                            </p>
                          </div>
                        </div>
                      )}

                      {scaleFactor === null && donorArea !== null && (
                        <Callout level="info">
                          Enter your ungauged site's drainage area above to scale this station's
                          design floods.
                        </Callout>
                      )}

                      {/* Nearby alternative donors */}
                      {nearbyDonors && nearbyDonors.length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold text-gray-700 mb-2">
                            Alternative Donor Stations Nearby
                          </h3>
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm border border-gray-200 rounded">
                              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                                <tr>
                                  <th className="px-4 py-2 text-left">Station</th>
                                  <th className="px-4 py-2 text-left">Name</th>
                                  <th className="px-4 py-2 text-right">Distance (km)</th>
                                  <th className="px-4 py-2 text-right">Area (km²)</th>
                                  <th className="px-4 py-2 text-right">Ratio to site</th>
                                  <th className="px-4 py-2 text-center">Use</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {nearbyDonors.map(({ station: d, distanceKm }) => {
                                  const dArea = d.drainage_area_gross_km2!;
                                  const ratio = siteArea !== null ? siteArea / dArea : null;
                                  const inRange = ratio !== null &&
                                    ratio >= AREA_RATIO_VALID_MIN && ratio <= AREA_RATIO_VALID_MAX;
                                  const href = `/stations/${d.station_number}/frequency?tab=transfer` +
                                    (siteAreaStr ? `&ta=${encodeURIComponent(siteAreaStr)}` : "") +
                                    (transferExp !== DEFAULT_TRANSFER_EXPONENT ? `&tn=${transferExp}` : "");
                                  return (
                                    <tr key={d.station_number}>
                                      <td className="px-4 py-2 font-mono text-xs">{d.station_number}</td>
                                      <td className="px-4 py-2">
                                        {d.name}
                                        {d.regulated && (
                                          <span className="ml-1.5 text-xs text-amber-600">(regulated)</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-right font-mono">{distanceKm.toFixed(0)}</td>
                                      <td className="px-4 py-2 text-right font-mono">{dArea.toLocaleString()}</td>
                                      <td className={`px-4 py-2 text-right font-mono ${
                                        ratio === null ? "text-gray-400"
                                        : inRange ? "text-green-700" : "text-amber-600"}`}>
                                        {ratio !== null ? ratio.toFixed(2) : "—"}
                                      </td>
                                      <td className="px-4 py-2 text-center">
                                        <a href={href}
                                          className="text-xs text-blue-600 hover:underline">
                                          Open as donor →
                                        </a>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            <p className="text-xs text-gray-400 mt-2">
                              Distance from the donor gauge, not from your site. Green ratio =
                              within the {AREA_RATIO_VALID_MIN}–{AREA_RATIO_VALID_MAX}× validity
                              range. Links carry your site area into the next station's transfer tab.
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Regional Regression tab ── */}
              {tab === "regression" && (
                <div className="space-y-6">
                  {transferLoading && (
                    <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
                      Loading station catalog…
                    </div>
                  )}
                  {transferError && (
                    <Callout level="error">Station data error: {transferError}</Callout>
                  )}

                  {station && regPoints && (
                    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6 space-y-6 lg:space-y-0">

                      {/* ── Main column ── */}
                      <div className="space-y-5 min-w-0">

                        {/* Controls */}
                        <div className="bg-gray-50 border border-gray-200 rounded p-4">
                          <div className="flex flex-wrap gap-5 items-end">
                            <div>
                              <p className="text-xs font-medium text-gray-600 mb-1.5">
                                Y-axis parameter (X = gross drainage area)
                              </p>
                              <select value={regParam}
                                onChange={(e) => setRegParam(e.target.value as RegressionParam)}
                                className="border border-gray-300 rounded px-2 py-1.5 text-sm">
                                {(Object.keys(REGRESSION_PARAMS) as RegressionParam[]).map((k) => (
                                  <option key={k} value={k}>
                                    {REGRESSION_PARAMS[k].label} ({REGRESSION_PARAMS[k].unit})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-gray-600 pb-2">
                              <input type="checkbox" checked={regExclRegulated}
                                onChange={(e) => setRegExclRegulated(e.target.checked)} />
                              Exclude regulated gauges from fit
                            </label>
                            {REGRESSION_PARAMS[regParam].needs === "daily" && (
                              <p className="text-xs text-gray-400 pb-2">
                                Daily-series parameters fetch the full record per gauge on first load.
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Fit statistics */}
                        {regFit ? (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                            <div className="col-span-2 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                              <p className="text-xs text-blue-500 uppercase tracking-wide">Fitted power law</p>
                              <p className="font-semibold text-blue-900 mt-0.5 font-mono">
                                Q = {regFit.coefficient.toPrecision(3)} · A^{regFit.slope.toFixed(3)}
                              </p>
                            </div>
                            {[
                              ["R²", regFit.r2.toFixed(3)],
                              ["SE (log₁₀)", regFit.seLog.toFixed(3)],
                            ].map(([label, value]) => (
                              <div key={label} className="bg-gray-50 border border-gray-200 rounded px-3 py-2">
                                <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
                                <p className="font-semibold text-gray-800 mt-0.5">{value}</p>
                              </div>
                            ))}
                            {(regParam === "meanPeak" || regParam === "medianPeak") &&
                              regFit.slope >= 0.3 && regFit.slope <= 1.2 && (
                              <div className="col-span-2 sm:col-span-4 text-xs text-gray-500">
                                The exponent b = {regFit.slope.toFixed(2)} is the region-specific
                                value of n for the area-ratio method.{" "}
                                <button
                                  onClick={() => {
                                    setTransferExp(Math.min(1.0, Math.max(0.5, Number(regFit.slope.toFixed(2)))));
                                    setTab("transfer");
                                  }}
                                  className="text-blue-600 hover:underline">
                                  Use it on the Ungauged Transfer tab →
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <Callout level="info">
                            Add gauges until at least 3 have valid data
                            {regExclRegulated ? " (regulated gauges are excluded from the fit)" : ""} —
                            use the panel on the right.
                          </Callout>
                        )}

                        {/* Scatter + fit plot */}
                        {(() => {
                          const okPts = regPoints.filter((p) => p.status === "ok");
                          if (okPts.length === 0) return null;
                          const info = REGRESSION_PARAMS[regParam];
                          const natural   = okPts.filter((p) => !p.st?.regulated);
                          const regulated = okPts.filter((p) =>  p.st?.regulated);
                          const hover = (p: typeof okPts[number]) =>
                            `${p.id} — ${p.st!.name}<br>A = ${p.area!.toLocaleString()} km²<br>` +
                            `${info.label} = ${p.y!.toPrecision(4)} ${info.unit}`;
                          const xs = okPts.map((p) => p.area as number);
                          const xMin = Math.min(...xs) * 0.6;
                          const xMax = Math.max(...xs) * 1.6;
                          return (
                            <div className="bg-white border border-gray-200 rounded p-2">
                              <Plot
                                data={[
                                  ...(natural.length ? [{
                                    x: natural.map((p) => p.area as number),
                                    y: natural.map((p) => p.y as number),
                                    type: "scatter" as const, mode: "markers" as const,
                                    marker: { color: "#2563eb", size: 9 },
                                    text: natural.map(hover),
                                    hoverinfo: "text" as const,
                                    name: "Natural gauge",
                                  }] : []),
                                  ...(regulated.length ? [{
                                    x: regulated.map((p) => p.area as number),
                                    y: regulated.map((p) => p.y as number),
                                    type: "scatter" as const, mode: "markers" as const,
                                    marker: { color: "#d97706", size: 9, symbol: "diamond" },
                                    text: regulated.map(hover),
                                    hoverinfo: "text" as const,
                                    name: "Regulated gauge",
                                  }] : []),
                                  ...(regFit ? [{
                                    // Power law is a straight line in log-log — two points suffice.
                                    x: [xMin, xMax],
                                    y: [predictPowerLaw(regFit, xMin), predictPowerLaw(regFit, xMax)],
                                    type: "scatter" as const, mode: "lines" as const,
                                    line: { color: "#111827", width: 2 },
                                    name: `Fit (R² = ${regFit.r2.toFixed(2)})`,
                                  }] : []),
                                  ...(regFit && regPredArea !== null ? [{
                                    x: [regPredArea],
                                    y: [predictPowerLaw(regFit, regPredArea)],
                                    type: "scatter" as const, mode: "markers" as const,
                                    marker: { color: "#16a34a", size: 13, symbol: "star" },
                                    name: "Your site",
                                  }] : []),
                                ]}
                                layout={{
                                  title: { text: `${info.label} vs Drainage Area` },
                                  xaxis: { title: { text: "Gross drainage area (km²)" }, type: "log" },
                                  yaxis: { title: { text: `${info.label} (${info.unit})` }, type: "log" },
                                  height: 460,
                                  margin: { l: 70, r: 20, t: 50, b: 80 },
                                  legend: { orientation: "h", y: -0.2 },
                                }}
                                config={{ responsive: true,
                                  toImageButtonOptions: { format: "png", filename: `${stationId}_regression` } }}
                                style={{ width: "100%" }}
                              />
                            </div>
                          );
                        })()}

                        {/* Prediction at ungauged area */}
                        <div className="bg-gray-50 border border-gray-200 rounded p-4 flex flex-wrap items-end gap-5">
                          <div>
                            <p className="text-xs font-medium text-gray-600 mb-1.5">
                              Estimate at drainage area (km²)
                            </p>
                            <input type="number" min={0} step="any" value={regPredictArea}
                              onChange={(e) => setRegPredictArea(e.target.value)}
                              placeholder="e.g. 320"
                              className="w-36 border border-gray-300 rounded px-2 py-1.5 text-sm" />
                          </div>
                          {regFit && regPredArea !== null && (() => {
                            const pred  = predictPowerLaw(regFit, regPredArea);
                            const range = predictionRange(regFit, regPredArea);
                            const info  = REGRESSION_PARAMS[regParam];
                            return (
                              <div className="bg-white border border-gray-200 rounded px-3 py-2">
                                <p className="text-xs text-gray-500">
                                  {info.label} at {regPredArea.toLocaleString()} km²
                                </p>
                                <p className="text-lg font-semibold text-green-700">
                                  {pred.toPrecision(4)} {info.unit}
                                  <span className="ml-2 text-xs font-normal text-gray-400">
                                    ~95% range {range.low.toPrecision(3)}–{range.high.toPrecision(3)}
                                  </span>
                                </p>
                              </div>
                            );
                          })()}
                          {!regFit && regPredArea !== null && (
                            <p className="text-xs text-gray-400 pb-2">Fit needs at least 3 valid gauges.</p>
                          )}
                        </div>

                        {/* Selected gauges */}
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm border border-gray-200 rounded">
                            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                              <tr>
                                <th className="px-3 py-2 text-left">Station</th>
                                <th className="px-3 py-2 text-left">Name</th>
                                <th className="px-3 py-2 text-right">Area (km²)</th>
                                <th className="px-3 py-2 text-right">{REGRESSION_PARAMS[regParam].label}</th>
                                <th className="px-3 py-2 text-center w-10"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {regPoints.map((p) => (
                                <tr key={p.id}
                                  className={p.status === "ok" && regExclRegulated && p.st?.regulated ? "opacity-60" : ""}>
                                  <td className="px-3 py-1.5 font-mono text-xs">
                                    {p.id}
                                    {p.id === stationId.toUpperCase() && (
                                      <span className="ml-1 text-blue-500" title="Current station">●</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    {p.st?.name ?? "—"}
                                    {p.st?.regulated && (
                                      <span className="ml-1.5 text-xs text-amber-600">
                                        (regulated{regExclRegulated ? ", not in fit" : ""})
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono">
                                    {p.area !== null ? p.area.toLocaleString() : "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono">
                                    {p.status === "ok"      ? `${(p.y as number).toPrecision(4)}`
                                     : p.status === "loading" ? <span className="text-gray-400 text-xs">loading…</span>
                                     : p.status === "noArea"  ? <span className="text-red-500 text-xs">no area</span>
                                     : p.status === "noY"     ? <span className="text-amber-600 text-xs">no data</span>
                                     : <span className="text-red-500 text-xs">error</span>}
                                  </td>
                                  <td className="px-3 py-1.5 text-center">
                                    <button onClick={() => removeRegStation(p.id)}
                                      className="text-gray-400 hover:text-red-600" title="Remove">
                                      ✕
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* ── Gauge picker sidebar ── */}
                      <div className="space-y-4">
                        <div className="bg-gray-50 border border-gray-200 rounded p-3">
                          <p className="text-xs font-medium text-gray-600 mb-2">
                            Add gauge by number ({regSelected.length}/{REG_MAX_GAUGES})
                          </p>
                          <div className="flex gap-2">
                            <input type="text" value={regAddInput}
                              onChange={(e) => { setRegAddInput(e.target.value); setRegAddError(null); }}
                              onKeyDown={(e) => { if (e.key === "Enter") addRegStation(regAddInput); }}
                              placeholder="e.g. 05BB001"
                              className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1.5 text-sm font-mono uppercase" />
                            <button onClick={() => addRegStation(regAddInput)}
                              disabled={regSelected.length >= REG_MAX_GAUGES}
                              className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
                              Add
                            </button>
                          </div>
                          {regAddError && (
                            <p className="text-xs text-red-600 mt-1.5">{regAddError}</p>
                          )}
                        </div>

                        {regNearby && regNearby.length > 0 && (
                          <div className="bg-white border border-gray-200 rounded p-3">
                            <p className="text-xs font-medium text-gray-600 mb-2">
                              Nearby gauges (distance from {station.station_number})
                            </p>
                            <ul className="space-y-1.5">
                              {regNearby.map(({ station: d, distanceKm }) => (
                                <li key={d.station_number}
                                  className="flex items-center justify-between gap-2 text-xs">
                                  <div className="min-w-0">
                                    <p className="font-mono text-gray-700">
                                      {d.station_number}
                                      <span className="ml-1.5 font-sans text-gray-400">
                                        {distanceKm.toFixed(0)} km · {d.drainage_area_gross_km2!.toLocaleString()} km²
                                        {d.regulated ? " · reg." : ""}
                                      </span>
                                    </p>
                                    <p className="text-gray-500 truncate">{d.name}</p>
                                  </div>
                                  <button onClick={() => addRegStation(d.station_number)}
                                    disabled={regSelected.length >= REG_MAX_GAUGES}
                                    className="shrink-0 border border-blue-300 text-blue-600 rounded px-2 py-0.5 hover:bg-blue-50 disabled:opacity-40"
                                    title="Add to regression">
                                    + Add
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
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
