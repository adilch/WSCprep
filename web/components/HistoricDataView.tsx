"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { DailyResponse, DailyPoint } from "@/lib/types";
import { fmtDischarge, fmtLevel, fmtDate } from "@/lib/format";
import { strings } from "@/lib/strings";
import { Callout } from "./Callout";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false, loading: () => <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Loading chart…</div> });

type Variable = "discharge" | "level";

function computeStats(series: DailyPoint[], variable: Variable) {
  const vals = series.filter((d) => d.value !== null).map((d) => d.value as number);
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const pct = (p: number) => vals[Math.floor((p / 100) * (vals.length - 1))];
  const maxIdx = vals.indexOf(Math.max(...vals));
  const minIdx = vals.indexOf(Math.min(...vals));
  const sorted = [...series].filter((d) => d.value !== null);
  sorted.sort((a, b) => (a.value as number) - (b.value as number));
  return {
    mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    median: pct(50),
    min: Math.min(...vals),
    minDate: sorted[0]?.date,
    max: Math.max(...vals),
    maxDate: sorted[sorted.length - 1]?.date,
    q5: pct(5), q10: pct(10), q90: pct(90), q95: pct(95),
    count: vals.length,
  };
}

function computeFdc(series: DailyPoint[]) {
  const vals = series.filter((d) => d.value !== null && (d.value as number) > 0)
    .map((d) => d.value as number)
    .sort((a, b) => b - a);
  if (!vals.length) return { x: [], y: [] };
  return {
    x: vals.map((_, i) => ((i + 1) / vals.length) * 100),
    y: vals,
  };
}

function computeRegime(series: DailyPoint[]) {
  const byDoy: number[][] = Array.from({ length: 366 }, () => []);
  series.forEach((d) => {
    if (d.value === null) return;
    const date = new Date(d.date + "T00:00:00");
    const doy = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
    if (doy >= 1 && doy <= 366) byDoy[doy - 1].push(d.value as number);
  });
  const x: number[] = [], y: number[] = [];
  byDoy.forEach((vals, i) => {
    if (vals.length > 0) { x.push(i + 1); y.push(vals.reduce((a, b) => a + b) / vals.length); }
  });
  return { x, y };
}

export function HistoricDataView({ stationId }: { stationId: string }) {
  const [variable, setVariable] = useState<Variable>("discharge");
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [tab, setTab] = useState<"hydrograph" | "fdc" | "regime" | "stats">("hydrograph");

  const fetch_ = useCallback(async (v: Variable) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/stations/${stationId}/daily?variable=${v}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [stationId]);

  useEffect(() => { fetch_(variable); }, [variable, fetch_]);

  const fmt = variable === "discharge" ? fmtDischarge : fmtLevel;
  const unit = variable === "discharge" ? "m³/s" : "m";

  const downloadCsv = () => {
    if (!data) return;
    const rows = ["date,value,symbol", ...data.series.map((d) => `${d.date},${d.value ?? ""},${d.symbol ?? ""}`)];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stationId}_${variable}_daily.csv`;
    a.click();
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">{strings.daily.loading}</div>;
  if (error) return <div className="max-w-2xl mx-auto px-4 py-8"><Callout level="error">{error}</Callout></div>;
  if (!data || data.series.length === 0) return <div className="max-w-2xl mx-auto px-4 py-8"><Callout level="info">{strings.daily.noData}</Callout></div>;

  const series = data.series;
  const stats = computeStats(series, variable);
  const fdc = tab === "fdc" ? computeFdc(series) : { x: [], y: [] };
  const regime = tab === "regime" ? computeRegime(series) : { x: [], y: [] };

  const dates = series.map((d) => d.date);
  const vals = series.map((d) => d.value);

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex rounded border border-gray-300 overflow-hidden text-sm">
          {(["discharge", "level"] as Variable[]).map((v) => (
            <button
              key={v}
              onClick={() => setVariable(v)}
              className={`px-4 py-1.5 ${variable === v ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              {v === "discharge" ? "Discharge (m³/s)" : "Water Level (m)"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />
          Log scale
        </label>
        <button onClick={downloadCsv} className="ml-auto text-sm text-blue-600 hover:underline">
          {strings.daily.downloadCsv}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200">
        {(["hydrograph", "fdc", "regime", "stats"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "hydrograph" ? "Hydrograph" : t === "fdc" ? "Flow-Duration Curve" : t === "regime" ? "Annual Regime" : "Statistics"}
          </button>
        ))}
      </div>

      {/* Charts */}
      {tab === "hydrograph" && (
        <div className="bg-white border border-gray-200 rounded p-2">
          <Plot
            data={[{ x: dates, y: vals, type: "scatter", mode: "lines", line: { color: "#3b82f6", width: 1 }, name: `${variable} (${unit})` }]}
            layout={{
              title: { text: strings.daily.hydrograph },
              xaxis: { title: { text: "Date" } },
              yaxis: { title: { text: unit }, type: logScale ? "log" : "linear" },
              height: 420,
              margin: { l: 60, r: 20, t: 40, b: 50 },
            }}
            config={{ responsive: true, toImageButtonOptions: { format: "png", filename: `${stationId}_hydrograph` } }}
            style={{ width: "100%" }}
          />
        </div>
      )}

      {tab === "fdc" && variable === "discharge" && (
        <div className="bg-white border border-gray-200 rounded p-2">
          <Plot
            data={[{ x: fdc.x, y: fdc.y, type: "scatter", mode: "lines", line: { color: "#3b82f6", width: 2 }, name: "Discharge" }]}
            layout={{
              title: { text: strings.daily.fdc },
              xaxis: { title: { text: "% Time Exceeded" }, range: [0, 100] },
              yaxis: { title: { text: unit }, type: "log" },
              height: 420,
              margin: { l: 70, r: 20, t: 40, b: 50 },
            }}
            config={{ responsive: true, toImageButtonOptions: { format: "png", filename: `${stationId}_fdc` } }}
            style={{ width: "100%" }}
          />
        </div>
      )}
      {tab === "fdc" && variable === "level" && (
        <Callout level="info">Flow-Duration Curve is computed for discharge only. Please switch to Discharge.</Callout>
      )}

      {tab === "regime" && (
        <div className="bg-white border border-gray-200 rounded p-2">
          <Plot
            data={[{ x: regime.x, y: regime.y, type: "scatter", mode: "lines", line: { color: "#3b82f6", width: 2 }, name: `Mean ${variable}` }]}
            layout={{
              title: { text: strings.daily.regime },
              xaxis: { title: { text: "Day of Year" }, range: [1, 366] },
              yaxis: { title: { text: unit }, type: logScale ? "log" : "linear" },
              height: 420,
              margin: { l: 70, r: 20, t: 40, b: 50 },
            }}
            config={{ responsive: true, toImageButtonOptions: { format: "png", filename: `${stationId}_regime` } }}
            style={{ width: "100%" }}
          />
        </div>
      )}

      {tab === "stats" && stats && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Statistic</th>
                <th className="px-4 py-2 text-right">Value ({unit})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                ["Period", `${data.meta.start} → ${data.meta.end}`],
                ["Days", stats.count.toLocaleString()],
                ["Mean", fmt(stats.mean)],
                ["Median (Q50)", fmt(stats.median)],
                ["Q5 (exceeded 5% of time)", fmt(stats.q5)],
                ["Q10", fmt(stats.q10)],
                ["Q90", fmt(stats.q90)],
                ["Q95 (exceeded 95% of time)", fmt(stats.q95)],
                ["Maximum", `${fmt(stats.max)} (${stats.maxDate ? fmtDate(stats.maxDate) : "—"})`],
                ["Minimum", `${fmt(stats.min)} (${stats.minDate ? fmtDate(stats.minDate) : "—"})`],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td className="px-4 py-2 text-gray-600">{label}</td>
                  <td className="px-4 py-2 text-right font-mono">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
