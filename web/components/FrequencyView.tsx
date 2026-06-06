"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { FrequencyResponse, FrequencyRequest, DistributionResult } from "@/lib/types";
import { fmtDischarge, fmtAep } from "@/lib/format";
import { strings } from "@/lib/strings";
import { Callout } from "./Callout";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false, loading: () => <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Loading chart…</div> });

const DIST_COLORS: Record<string, string> = {
  gev: "#2563eb", glo: "#16a34a", gumbel: "#dc2626", lp3: "#9333ea", pe3: "#ea580c",
};

const ALL_DISTRIBUTIONS = ["gev", "glo", "gumbel", "lp3", "pe3"];
const DEFAULT_RETURN_PERIODS = [2, 5, 10, 20, 25, 50, 100, 200, 500];

export function FrequencyView({ stationId }: { stationId: string }) {
  const [result, setResult] = useState<FrequencyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"peaks" | "freq" | "table" | "gof">("freq");

  const [options, setOptions] = useState<FrequencyRequest>({
    distributions: ALL_DISTRIBUTIONS,
    estimation_method: "lmoments",
    plotting_position: "cunnane",
    return_periods: DEFAULT_RETURN_PERIODS,
    exclude_estimated: true,
    confidence_level: 0.9,
    ci_method: "bootstrap",
    bootstrap_samples: 2000,
  });

  const runAnalysis = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/stations/${stationId}/frequency`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
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
  }, [stationId, options]);

  useEffect(() => { runAnalysis(); }, [runAnalysis]);

  const downloadCsv = () => {
    if (!result) return;
    const dists = result.distributions.filter((d) => !d.fit_error);
    const header = ["return_period", "aep", ...dists.map((d) => d.key), ...dists.flatMap((d) => [`${d.key}_ci_lo`, `${d.key}_ci_hi`])];
    const rows = options.return_periods.map((t) => {
      const aep = 1 / t;
      return [
        t, aep.toFixed(6),
        ...dists.map((d) => d.quantiles.find((q) => q.return_period === t)?.value ?? ""),
        ...dists.flatMap((d) => {
          const q = d.quantiles.find((q) => q.return_period === t);
          return [q?.ci_lower ?? "", q?.ci_upper ?? ""];
        }),
      ];
    });
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stationId}_ffa_design_floods.csv`;
    a.click();
  };

  const toggleDist = (key: string) =>
    setOptions((o) => ({
      ...o,
      distributions: o.distributions.includes(key) ? o.distributions.filter((d) => d !== key) : [...o.distributions, key],
    }));

  const fitted = result?.distributions.filter((d) => !d.fit_error) ?? [];
  const best = result?.best_fit;

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-6">
      {/* Controls */}
      <div className="bg-gray-50 border border-gray-200 rounded p-4 space-y-4">
        <div className="flex flex-wrap gap-4 items-start">
          {/* Distributions */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Distributions</p>
            <div className="flex gap-2 flex-wrap">
              {ALL_DISTRIBUTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => toggleDist(d)}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${
                    options.distributions.includes(d)
                      ? "text-white border-transparent"
                      : "bg-white text-gray-600 border-gray-300"
                  }`}
                  style={options.distributions.includes(d) ? { backgroundColor: DIST_COLORS[d] } : {}}
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Plotting position */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Plotting Position</p>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-xs"
              value={options.plotting_position}
              onChange={(e) => setOptions((o) => ({ ...o, plotting_position: e.target.value as FrequencyRequest["plotting_position"] }))}
            >
              <option value="cunnane">Cunnane</option>
              <option value="weibull">Weibull</option>
              <option value="gringorten">Gringorten</option>
            </select>
          </div>

          {/* Estimation method */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Estimation Method</p>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-xs"
              value={options.estimation_method}
              onChange={(e) => setOptions((o) => ({ ...o, estimation_method: e.target.value as FrequencyRequest["estimation_method"] }))}
            >
              <option value="lmoments">L-moments</option>
              <option value="mom">Method of Moments</option>
            </select>
          </div>

          {/* Confidence level */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Confidence</p>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-xs"
              value={options.confidence_level}
              onChange={(e) => setOptions((o) => ({ ...o, confidence_level: Number(e.target.value) }))}
            >
              <option value={0.9}>90%</option>
              <option value={0.95}>95%</option>
            </select>
          </div>

          {/* Exclude estimated */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Exclude Estimated (E)</p>
            <input
              type="checkbox"
              checked={options.exclude_estimated}
              onChange={(e) => setOptions((o) => ({ ...o, exclude_estimated: e.target.checked }))}
            />
          </div>

          <button
            onClick={runAnalysis}
            disabled={loading}
            className="ml-auto bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors self-end"
          >
            {loading ? "Running…" : "Run Analysis"}
          </button>
        </div>
      </div>

      {error && <Callout level="error">{error}</Callout>}

      {loading && <div className="flex items-center justify-center h-32 text-gray-400">{strings.ffa.loading}</div>}

      {result && !loading && (
        <>
          {/* Warnings */}
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
              {/* Tabs */}
              <div className="flex gap-0 border-b border-gray-200">
                {(["peaks", "freq", "table", "gof"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {t === "peaks" ? "Annual Peaks" : t === "freq" ? "Frequency Plot" : t === "table" ? "Design Floods" : "Goodness of Fit"}
                  </button>
                ))}
                <button onClick={downloadCsv} className="ml-auto text-sm text-blue-600 hover:underline self-center px-4">
                  Download CSV
                </button>
              </div>

              {/* Annual peaks chart */}
              {tab === "peaks" && (
                <div className="bg-white border border-gray-200 rounded p-2">
                  <Plot
                    data={[{
                      x: result.plotting_positions.map((p) => p.year),
                      y: result.plotting_positions.map((p) => p.value),
                      type: "bar",
                      marker: { color: "#3b82f6" },
                      name: "Annual Max Peak (m³/s)",
                    }]}
                    layout={{
                      title: { text: `${strings.ffa.annualPeaks} (n = ${result.n_years} yr)` },
                      xaxis: { title: { text: "Year" } },
                      yaxis: { title: { text: "Peak Discharge (m³/s)" } },
                      height: 420,
                      margin: { l: 70, r: 20, t: 50, b: 50 },
                    }}
                    config={{ responsive: true, toImageButtonOptions: { format: "png", filename: `${stationId}_annual_peaks` } }}
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              {/* Frequency plot */}
              {tab === "freq" && (
                <div className="bg-white border border-gray-200 rounded p-2">
                  <Plot
                    data={[
                      // Empirical points
                      {
                        x: result.plotting_positions.map((p) => p.return_period),
                        y: result.plotting_positions.map((p) => p.value),
                        type: "scatter",
                        mode: "markers",
                        marker: { color: "#1f2937", size: 7, symbol: "circle" },
                        name: "Observed (plotting position)",
                      },
                      // Fitted curves
                      ...fitted.map((d) => ({
                        x: d.curve.map((c) => c.return_period),
                        y: d.curve.map((c) => c.value),
                        type: "scatter" as const,
                        mode: "lines" as const,
                        line: {
                          color: DIST_COLORS[d.key] ?? "#999",
                          width: d.key === best ? 2.5 : 1.5,
                          dash: d.key === best ? "solid" : "dot" as "solid" | "dot",
                        },
                        name: d.label + (d.key === best ? " ★" : ""),
                      })),
                      // CI band for best fit
                      ...(best && fitted.find((d) => d.key === best)
                        ? (() => {
                            const bd = fitted.find((d) => d.key === best)!;
                            const pts = bd.quantiles.filter((q) => q.ci_lower !== null);
                            return [
                              {
                                x: [...pts.map((q) => q.return_period), ...pts.map((q) => q.return_period).reverse()],
                                y: [...pts.map((q) => q.ci_upper ?? 0), ...pts.map((q) => q.ci_lower ?? 0).reverse()],
                                type: "scatter" as const,
                                mode: "lines" as const,
                                fill: "toself" as const,
                                fillcolor: DIST_COLORS[best] + "22",
                                line: { color: "transparent" },
                                name: `${best.toUpperCase()} CI`,
                                showlegend: true,
                              },
                            ];
                          })()
                        : []),
                    ]}
                    layout={{
                      title: { text: strings.ffa.frequencyPlot },
                      xaxis: { title: { text: "Return Period (yr)" }, type: "log", tickvals: [2, 5, 10, 20, 50, 100, 200, 500] },
                      yaxis: { title: { text: "Peak Discharge (m³/s)" } },
                      height: 480,
                      legend: { orientation: "h", y: -0.25 },
                      margin: { l: 70, r: 20, t: 50, b: 100 },
                    }}
                    config={{ responsive: true, toImageButtonOptions: { format: "png", filename: `${stationId}_frequency_plot` } }}
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              {/* Design flood table */}
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
                  <p className="text-xs text-gray-400 mt-2">Values in m³/s. Confidence intervals in brackets. ★ = best fit by AIC.</p>
                </div>
              )}

              {/* Goodness of fit */}
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
                                <td className="px-4 py-2 text-right font-mono">{d.goodness_of_fit.aic.toFixed(1)}</td>
                                <td className="px-4 py-2 text-right font-mono">{d.goodness_of_fit.bic.toFixed(1)}</td>
                                <td className="px-4 py-2 text-right font-mono">{d.goodness_of_fit.ks_stat.toFixed(4)}</td>
                                <td className="px-4 py-2 text-right font-mono">{d.goodness_of_fit.ks_pvalue.toFixed(4)}</td>
                                <td className="px-4 py-2 text-right font-mono">{d.goodness_of_fit.ad_stat.toFixed(4)}</td>
                                <td className="px-4 py-2 text-right font-mono">{d.goodness_of_fit.rmse.toFixed(2)}</td>
                              </>
                            ) : null}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-400 mt-2">★ = best fit by AIC (lowest). Ranked ascending by AIC.</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
