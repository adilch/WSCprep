"use client";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Station, CatalogMeta } from "@/lib/types";
import { Badge } from "./Badge";
import { fmtArea } from "@/lib/format";
import { strings } from "@/lib/strings";
import { haversineKm } from "@/lib/haversine";
import {
  type ColorMetric,
  COLOR_METRIC_LABELS,
  scaleColor,
  legendTicks,
} from "@/lib/colorScale";

const StationMap = dynamic(
  () => import("./StationMap").then((m) => m.StationMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
        Loading map…
      </div>
    ),
  }
);

const PROVINCES = [
  "AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT",
];

interface Filters {
  province: string[];
  status: "all" | "active" | "discontinued";
  hasFlow: boolean;
  hasLevel: boolean;
  regulation: "all" | "natural" | "regulated";
  rhbnOnly: boolean;
  minRecordYears: number;
}

const DEFAULT_FILTERS: Filters = {
  province: [], status: "all", hasFlow: false, hasLevel: false,
  regulation: "all", rhbnOnly: false, minRecordYears: 0,
};

function applyFilters(stations: Station[], f: Filters, query: string): Station[] {
  const q = query.toLowerCase();
  return stations.filter((s) => {
    if (q && !s.name.toLowerCase().includes(q) && !s.station_number.toLowerCase().includes(q))
      return false;
    if (f.province.length && !f.province.includes(s.province)) return false;
    if (f.status !== "all" && s.status !== f.status) return false;
    if (f.hasFlow  && !s.data_ranges.flow)  return false;
    if (f.hasLevel && !s.data_ranges.level) return false;
    if (f.regulation === "natural"   && s.regulated !== false) return false;
    if (f.regulation === "regulated" && s.regulated !== true)  return false;
    if (f.rhbnOnly && !s.rhbn) return false;
    const maxRec = Math.max(
      s.data_ranges.flow?.record_length  ?? 0,
      s.data_ranges.level?.record_length ?? 0
    );
    if (maxRec < f.minRecordYears) return false;
    return true;
  });
}

function stationMetricValue(s: Station, metric: ColorMetric): number {
  if (metric === "record_length")
    return Math.max(
      s.data_ranges.flow?.record_length  ?? 0,
      s.data_ranges.level?.record_length ?? 0
    );
  if (metric === "drainage_area") return s.drainage_area_gross_km2 ?? 0;
  return 0;
}

// ── Component ────────────────────────────────────────────────────────────────

export function MapPage({ stations, meta }: { stations: Station[]; meta: CatalogMeta | null }) {
  const [query, setQuery] = useState("");
  const [pendingFilters, setPendingFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected]     = useState<Station | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [searchResults, setSearchResults] = useState<Station[]>([]);
  const [showDropdown, setShowDropdown]   = useState(false);
  const [nearbyRadius, setNearbyRadius]   = useState(50);
  const [showNearby,   setShowNearby]     = useState(false);

  // ── Feature 12: colour-by-metric ───────────────────────────────────────
  const [colorBy, setColorBy] = useState<ColorMetric>("status");

  // [min, max] of the chosen metric across ALL stations (for normalisation).
  const colorRange = useMemo<[number, number]>(() => {
    if (colorBy === "status") return [0, 1];
    const vals = stations
      .map((s) => stationMetricValue(s, colorBy))
      .filter((v) => v > 0);
    if (!vals.length) return [0, 1];
    return [Math.min(...vals), Math.max(...vals)];
  }, [stations, colorBy]);

  // ── Feature 13: favourites ──────────────────────────────────────────────
  // Start empty on both server and client so SSR output matches the first
  // client render, then load the saved set after mount (see the
  // "preventing-flash-before-hydration" guide in next/dist/docs).
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  const favouritesLoaded = useRef(false);
  const [showFavOnly, setShowFavOnly] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("wsc-fav");
      if (raw) setFavourites(new Set<string>(JSON.parse(raw) as string[]));
    } catch {}
  }, []);

  // Persist favourites to localStorage whenever they change. Skip the mount
  // run: it fires with the initial empty set, before the saved set above has
  // been applied, and would erase it.
  useEffect(() => {
    if (!favouritesLoaded.current) { favouritesLoaded.current = true; return; }
    try { localStorage.setItem("wsc-fav", JSON.stringify([...favourites])); } catch {}
  }, [favourites]);

  const toggleFavourite = useCallback((id: string) => {
    setFavourites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── Filter logic ────────────────────────────────────────────────────────
  const isDirty    = JSON.stringify(pendingFilters) !== JSON.stringify(appliedFilters);
  const previewCount = useMemo(
    () => applyFilters(stations, pendingFilters, "").length,
    [stations, pendingFilters]
  );

  const visible = useMemo(() => {
    const base = applyFilters(stations, appliedFilters, "");
    return showFavOnly ? base.filter((s) => favourites.has(s.station_number)) : base;
  }, [stations, appliedFilters, showFavOnly, favourites]);

  // ── Search dropdown ─────────────────────────────────────────────────────
  useEffect(() => {
    if (query.length < 2) { setSearchResults([]); setShowDropdown(false); return; }
    const q = query.toLowerCase();
    setSearchResults(
      stations
        .filter((s) => s.name.toLowerCase().includes(q) || s.station_number.toLowerCase().includes(q))
        .slice(0, 10)
    );
    setShowDropdown(true);
  }, [query, stations]);

  const handleSelect = useCallback((s: Station) => {
    setSelected(s); setQuery(""); setShowDropdown(false); setShowNearby(false);
  }, []);

  // ── Nearby stations ─────────────────────────────────────────────────────
  const nearbyStations = useMemo<{ station: Station; km: number }[]>(() => {
    if (!selected) return [];
    return stations
      .filter((s) => s.station_number !== selected.station_number)
      .map((s) => ({
        station: s,
        km: haversineKm(selected.latitude, selected.longitude, s.latitude, s.longitude),
      }))
      .filter(({ km }) => km <= nearbyRadius)
      .sort((a, b) => a.km - b.km)
      .slice(0, 15);
  }, [selected, stations, nearbyRadius]);

  const pf           = (key: keyof Filters, val: unknown) =>
    setPendingFilters((f) => ({ ...f, [key]: val }));
  const applyFiltersNow = () => setAppliedFilters(pendingFilters);
  const resetFilters    = () => { setPendingFilters(DEFAULT_FILTERS); setAppliedFilters(DEFAULT_FILTERS); };

  // ── Legend ticks for colour-by-metric ───────────────────────────────────
  const colorLegendTicks = useMemo(
    () => legendTicks(colorRange[0], colorRange[1], 5),
    [colorRange]
  );

  const favCount = favourites.size;

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-gray-50 z-30 relative flex-wrap">
        {/* Search */}
        <div className="relative flex-1 max-w-xs min-w-0">
          <input
            type="search"
            placeholder={strings.map.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {showDropdown && searchResults.length > 0 && (
            <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 max-h-60 overflow-y-auto">
              {searchResults.map((s) => (
                <li key={s.station_number}>
                  <button
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                    onClick={() => handleSelect(s)}
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
        </div>

        <button
          onClick={() => setShowFilters((v) => !v)}
          className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-white transition-colors shrink-0"
        >
          {strings.map.filters} {showFilters ? "▲" : "▼"}
        </button>

        {/* ── Feature 13: Favourites toggle ── */}
        <button
          onClick={() => setShowFavOnly((v) => !v)}
          title={showFavOnly ? "Show all stations" : "Show favourites only"}
          className={`text-sm border rounded px-3 py-1.5 transition-colors shrink-0 flex items-center gap-1 ${
            showFavOnly
              ? "bg-amber-400 border-amber-500 text-white"
              : favCount > 0
                ? "border-amber-400 text-amber-600 hover:bg-amber-50"
                : "border-gray-300 text-gray-400 hover:bg-white"
          }`}
        >
          {showFavOnly ? "★" : "☆"} Favourites
          {favCount > 0 && (
            <span className={`text-xs ml-0.5 ${showFavOnly ? "text-white" : "text-amber-500"}`}>
              ({favCount})
            </span>
          )}
        </button>

        {/* ── Feature 12: Colour-by dropdown ── */}
        <div className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0">
          <span className="hidden sm:inline">Color by:</span>
          <select
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value as ColorMetric)}
            className="border border-gray-300 rounded px-2 py-1 text-xs"
          >
            {(Object.keys(COLOR_METRIC_LABELS) as ColorMetric[]).map((k) => (
              <option key={k} value={k}>{COLOR_METRIC_LABELS[k]}</option>
            ))}
          </select>
        </div>

        {/* Compare stations link */}
        <Link
          href="/compare"
          className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-white transition-colors shrink-0"
          title="Compare multiple stations side by side"
        >
          ⇄ Compare
        </Link>

        <span className="text-xs text-gray-500 ml-auto shrink-0">
          {strings.map.showingOf(visible.length, stations.length)}
          {showFavOnly && <span className="ml-1 text-amber-600">(favourites)</span>}
        </span>

        {meta && (
          <span className="text-xs text-gray-400 hidden sm:block shrink-0">
            HYDAT {meta.hydat_version}
          </span>
        )}
      </div>

      {/* ── Filter panel ── */}
      {showFilters && (
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 z-20 flex flex-wrap gap-4 text-sm">
          {/* Province */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Province/Territory</label>
            <div className="flex flex-wrap gap-1">
              {PROVINCES.map((p) => (
                <button
                  key={p}
                  onClick={() =>
                    pf(
                      "province",
                      pendingFilters.province.includes(p)
                        ? pendingFilters.province.filter((x) => x !== p)
                        : [...pendingFilters.province, p]
                    )
                  }
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                    pendingFilters.province.includes(p)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "border-gray-300 hover:border-blue-400"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-xs"
              value={pendingFilters.status}
              onChange={(e) => pf("status", e.target.value)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="discontinued">Discontinued</option>
            </select>
          </div>

          {/* Data type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Has data</label>
            <div className="flex gap-2">
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={pendingFilters.hasFlow}
                  onChange={(e) => pf("hasFlow", e.target.checked)}
                /> Flow
              </label>
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={pendingFilters.hasLevel}
                  onChange={(e) => pf("hasLevel", e.target.checked)}
                /> Level
              </label>
            </div>
          </div>

          {/* Regulation */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Regulation</label>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-xs"
              value={pendingFilters.regulation}
              onChange={(e) => pf("regulation", e.target.value)}
            >
              <option value="all">All</option>
              <option value="natural">Natural</option>
              <option value="regulated">Regulated</option>
            </select>
          </div>

          {/* RHBN */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">RHBN only</label>
            <input
              type="checkbox"
              checked={pendingFilters.rhbnOnly}
              onChange={(e) => pf("rhbnOnly", e.target.checked)}
            />
          </div>

          {/* Min record length */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Min record: {pendingFilters.minRecordYears} yr
            </label>
            <input
              type="range" min={0} max={100} step={5}
              value={pendingFilters.minRecordYears}
              onChange={(e) => pf("minRecordYears", Number(e.target.value))}
              className="w-32"
            />
          </div>

          <div className="flex items-end gap-2 ml-auto">
            <button
              onClick={applyFiltersNow}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                isDirty
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-blue-100 text-blue-400 cursor-default"
              }`}
              disabled={!isDirty}
              title={isDirty ? `Apply filters (${previewCount} stations)` : "No pending changes"}
            >
              {isDirty
                ? `Apply filters — ${previewCount.toLocaleString()} stations`
                : "Filters applied"}
            </button>
            <button
              onClick={resetFilters}
              className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* ── Map + side panel ── */}
      <div className="flex flex-1 min-h-0">
        {/* Map */}
        <div className="flex-1 min-h-0 relative">
          <StationMap
            stations={visible}
            onSelect={handleSelect}
            selectedId={selected?.station_number}
            colorBy={colorBy}
            colorRange={colorRange}
          />

          {/* ── Legend (bottom-left, dynamic) ── */}
          <div className="absolute bottom-6 left-4 z-10 bg-white border border-gray-200 rounded shadow-sm px-3 py-2 text-xs text-gray-600 pointer-events-none select-none">
            {colorBy === "status" ? (
              <div className="flex gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full bg-blue-500 border border-blue-700" />
                  Active
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full bg-gray-300 border border-gray-500" />
                  Discontinued
                </span>
              </div>
            ) : (
              /* ── Feature 12: colour-scale legend ── */
              <div className="space-y-1">
                <p className="text-gray-500 text-xs">{COLOR_METRIC_LABELS[colorBy]}</p>
                {/* Gradient bar */}
                <div
                  className="h-2.5 w-36 rounded"
                  style={{
                    background: `linear-gradient(to right, ${colorLegendTicks.map((tk) => tk.fill).join(", ")})`,
                  }}
                />
                {/* Min / max labels */}
                <div className="flex justify-between w-36 text-gray-500" style={{ fontSize: "10px" }}>
                  <span>
                    {colorRange[0] >= 1000
                      ? `${(colorRange[0] / 1000).toFixed(0)}k`
                      : colorRange[0].toFixed(0)}
                  </span>
                  <span>
                    {colorRange[1] >= 1000
                      ? `${(colorRange[1] / 1000).toFixed(0)}k`
                      : colorRange[1].toFixed(0)}
                  </span>
                </div>
                <p className="text-gray-400" style={{ fontSize: "10px" }}>
                  Grey dots = no data
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Station detail panel ── */}
        {selected ? (
          <aside className="w-72 border-l border-gray-200 bg-white flex flex-col overflow-y-auto shrink-0">
            <div className="p-4 flex-1 space-y-0">
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => setSelected(null)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  ✕ Close
                </button>
                {/* ── Feature 13: Star / favourite button ── */}
                <button
                  onClick={() => toggleFavourite(selected.station_number)}
                  title={
                    favourites.has(selected.station_number)
                      ? "Remove from favourites"
                      : "Add to favourites"
                  }
                  className={`text-lg transition-colors ${
                    favourites.has(selected.station_number)
                      ? "text-amber-400 hover:text-amber-500"
                      : "text-gray-300 hover:text-amber-400"
                  }`}
                >
                  {favourites.has(selected.station_number) ? "★" : "☆"}
                </button>
              </div>

              <p className="text-xs font-mono text-gray-500">{selected.station_number}</p>
              <h2 className="font-semibold text-gray-900 leading-tight mb-1">{selected.name}</h2>
              <p className="text-sm text-gray-500 mb-3">{selected.province}</p>

              <div className="flex flex-wrap gap-1.5 mb-3">
                <Badge variant={selected.status === "active" ? "green" : "gray"}>
                  {selected.status === "active" ? "Active" : "Discontinued"}
                </Badge>
                {selected.regulated === true  && <Badge variant="amber">Regulated</Badge>}
                {selected.regulated === false && <Badge variant="blue">Natural</Badge>}
                {selected.rhbn && <Badge variant="blue">RHBN</Badge>}
              </div>

              <dl className="text-xs text-gray-700 space-y-1.5 mb-4">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Drainage area</dt>
                  <dd>{fmtArea(selected.drainage_area_gross_km2)}</dd>
                </div>
                {selected.datum && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Datum</dt>
                    <dd>{selected.datum}</dd>
                  </div>
                )}
                {selected.data_ranges.flow && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Flow record</dt>
                    <dd>
                      {selected.data_ranges.flow.year_from}–{selected.data_ranges.flow.year_to}{" "}
                      ({selected.data_ranges.flow.record_length} yr)
                    </dd>
                  </div>
                )}
                {selected.data_ranges.level && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Level record</dt>
                    <dd>
                      {selected.data_ranges.level.year_from}–{selected.data_ranges.level.year_to}{" "}
                      ({selected.data_ranges.level.record_length} yr)
                    </dd>
                  </div>
                )}
              </dl>

              <div className="flex flex-col gap-2 mb-4">
                <Link
                  href={`/stations/${selected.station_number}/daily`}
                  className="block w-full text-center bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Historic Data Analysis
                </Link>
                <Link
                  href={`/stations/${selected.station_number}/frequency`}
                  className="block w-full text-center border border-blue-600 text-blue-700 rounded px-4 py-2 text-sm font-medium hover:bg-blue-50 transition-colors"
                >
                  Flood Frequency Analysis
                </Link>
                <Link
                  href={`/stations/${selected.station_number}`}
                  className="block w-full text-center text-gray-500 text-xs hover:text-gray-700 underline"
                >
                  Station overview →
                </Link>
              </div>

              {/* ── Nearby stations ── */}
              <div className="border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <button
                    onClick={() => setShowNearby((v) => !v)}
                    className="text-xs font-medium text-gray-600 hover:text-gray-800 flex items-center gap-1"
                  >
                    📍 Nearby stations {showNearby ? "▲" : "▼"}
                  </button>
                  {showNearby && (
                    <select
                      value={nearbyRadius}
                      onChange={(e) => setNearbyRadius(Number(e.target.value))}
                      className="text-xs border border-gray-300 rounded px-1.5 py-0.5"
                    >
                      {[25, 50, 100, 200].map((r) => (
                        <option key={r} value={r}>{r} km</option>
                      ))}
                    </select>
                  )}
                </div>
                {showNearby && (
                  nearbyStations.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">
                      No stations within {nearbyRadius} km.
                    </p>
                  ) : (
                    <ul className="space-y-1 max-h-48 overflow-y-auto">
                      {nearbyStations.map(({ station: s, km }) => (
                        <li key={s.station_number}>
                          <button
                            onClick={() => handleSelect(s)}
                            className="w-full text-left px-2 py-1.5 rounded hover:bg-blue-50 transition-colors group"
                          >
                            <div className="flex items-start justify-between gap-1">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-gray-800 truncate group-hover:text-blue-700">
                                  {s.name}
                                </p>
                                <p className="text-xs text-gray-400">
                                  {s.station_number} · {s.province}
                                </p>
                              </div>
                              <span className="flex items-center gap-1 shrink-0">
                                {/* mini star for nearby favourites */}
                                {favourites.has(s.station_number) && (
                                  <span className="text-amber-400 text-xs">★</span>
                                )}
                                <span className="text-xs text-gray-400 tabular-nums">
                                  {km < 10 ? km.toFixed(1) : Math.round(km)} km
                                </span>
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            </div>
          </aside>
        ) : (
          <aside className="w-72 border-l border-gray-200 bg-gray-50 flex flex-col items-center justify-center shrink-0 gap-3 px-4">
            <p className="text-sm text-gray-400 text-center">{strings.map.selectStation}</p>
            {favCount > 0 && !showFavOnly && (
              <button
                onClick={() => setShowFavOnly(true)}
                className="text-xs text-amber-600 border border-amber-300 rounded px-3 py-1.5 hover:bg-amber-50 transition-colors"
              >
                ★ Show {favCount} favourite{favCount !== 1 ? "s" : ""}
              </button>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
