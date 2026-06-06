"use client";
import { useState, useMemo, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Station, CatalogMeta } from "@/lib/types";
import { Badge } from "./Badge";
import { fmtArea } from "@/lib/format";
import { strings } from "@/lib/strings";

const StationMap = dynamic(() => import("./StationMap").then((m) => m.StationMap), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">Loading map…</div>,
});

const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];

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
  province: [],
  status: "all",
  hasFlow: false,
  hasLevel: false,
  regulation: "all",
  rhbnOnly: false,
  minRecordYears: 0,
};

function applyFilters(stations: Station[], f: Filters, query: string): Station[] {
  const q = query.toLowerCase();
  return stations.filter((s) => {
    if (q && !s.name.toLowerCase().includes(q) && !s.station_number.toLowerCase().includes(q)) return false;
    if (f.province.length && !f.province.includes(s.province)) return false;
    if (f.status !== "all" && s.status !== f.status) return false;
    if (f.hasFlow && !s.data_ranges.flow) return false;
    if (f.hasLevel && !s.data_ranges.level) return false;
    if (f.regulation === "natural" && s.regulated !== false) return false;
    if (f.regulation === "regulated" && s.regulated !== true) return false;
    if (f.rhbnOnly && !s.rhbn) return false;
    const maxRecord = Math.max(s.data_ranges.flow?.record_length ?? 0, s.data_ranges.level?.record_length ?? 0);
    if (maxRecord < f.minRecordYears) return false;
    return true;
  });
}

export function MapPage({ stations, meta }: { stations: Station[]; meta: CatalogMeta | null }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<Station | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [searchResults, setSearchResults] = useState<Station[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const visible = useMemo(() => applyFilters(stations, filters, ""), [stations, filters]);

  useEffect(() => {
    if (query.length < 2) { setSearchResults([]); setShowDropdown(false); return; }
    const q = query.toLowerCase();
    const results = stations
      .filter((s) => s.name.toLowerCase().includes(q) || s.station_number.toLowerCase().includes(q))
      .slice(0, 10);
    setSearchResults(results);
    setShowDropdown(true);
  }, [query, stations]);

  const handleSelect = useCallback((s: Station) => {
    setSelected(s);
    setQuery("");
    setShowDropdown(false);
  }, []);

  const pf = (key: keyof Filters, val: unknown) => setFilters((f) => ({ ...f, [key]: val }));

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-gray-50 z-30 relative">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
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
                    <span className="ml-2 text-gray-400 text-xs">{s.station_number} · {s.province}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          onClick={() => setShowFilters((v) => !v)}
          className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-white transition-colors"
        >
          {strings.map.filters} {showFilters ? "▲" : "▼"}
        </button>

        <span className="text-xs text-gray-500 ml-auto">
          {strings.map.showingOf(visible.length, stations.length)}
        </span>

        {meta && (
          <span className="text-xs text-gray-400 hidden sm:block">
            HYDAT {meta.hydat_version}
          </span>
        )}
      </div>

      {/* Filter panel */}
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
                    pf("province", filters.province.includes(p) ? filters.province.filter((x) => x !== p) : [...filters.province, p])
                  }
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                    filters.province.includes(p)
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
            <select className="border border-gray-300 rounded px-2 py-1 text-xs" value={filters.status} onChange={(e) => pf("status", e.target.value)}>
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
                <input type="checkbox" checked={filters.hasFlow} onChange={(e) => pf("hasFlow", e.target.checked)} /> Flow
              </label>
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input type="checkbox" checked={filters.hasLevel} onChange={(e) => pf("hasLevel", e.target.checked)} /> Level
              </label>
            </div>
          </div>

          {/* Regulation */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Regulation</label>
            <select className="border border-gray-300 rounded px-2 py-1 text-xs" value={filters.regulation} onChange={(e) => pf("regulation", e.target.value)}>
              <option value="all">All</option>
              <option value="natural">Natural</option>
              <option value="regulated">Regulated</option>
            </select>
          </div>

          {/* RHBN */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">RHBN only</label>
            <input type="checkbox" checked={filters.rhbnOnly} onChange={(e) => pf("rhbnOnly", e.target.checked)} />
          </div>

          {/* Min record length */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Min record: {filters.minRecordYears} yr</label>
            <input
              type="range" min={0} max={100} step={5}
              value={filters.minRecordYears}
              onChange={(e) => pf("minRecordYears", Number(e.target.value))}
              className="w-32"
            />
          </div>

          <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-xs text-blue-600 hover:underline self-end">
            Reset filters
          </button>
        </div>
      )}

      {/* Map + panel */}
      <div className="flex flex-1 min-h-0">
        {/* Map */}
        <div className="flex-1 min-h-0">
          <StationMap stations={visible} onSelect={handleSelect} selectedId={selected?.station_number} />
        </div>

        {/* Station detail panel */}
        {selected ? (
          <aside className="w-72 border-l border-gray-200 bg-white flex flex-col overflow-y-auto shrink-0">
            <div className="p-4 flex-1">
              <button onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-600 mb-3">✕ Close</button>
              <p className="text-xs font-mono text-gray-500">{selected.station_number}</p>
              <h2 className="font-semibold text-gray-900 leading-tight mb-1">{selected.name}</h2>
              <p className="text-sm text-gray-500 mb-3">{selected.province}</p>

              <div className="flex flex-wrap gap-1.5 mb-3">
                <Badge variant={selected.status === "active" ? "green" : "gray"}>
                  {selected.status === "active" ? "Active" : "Discontinued"}
                </Badge>
                {selected.regulated === true && <Badge variant="amber">Regulated</Badge>}
                {selected.regulated === false && <Badge variant="blue">Natural</Badge>}
                {selected.rhbn && <Badge variant="blue">RHBN</Badge>}
              </div>

              <dl className="text-xs text-gray-700 space-y-1.5 mb-4">
                <div className="flex justify-between"><dt className="text-gray-500">Drainage area</dt><dd>{fmtArea(selected.drainage_area_gross_km2)}</dd></div>
                {selected.datum && <div className="flex justify-between"><dt className="text-gray-500">Datum</dt><dd>{selected.datum}</dd></div>}
                {selected.data_ranges.flow && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Flow record</dt>
                    <dd>{selected.data_ranges.flow.year_from}–{selected.data_ranges.flow.year_to} ({selected.data_ranges.flow.record_length} yr)</dd>
                  </div>
                )}
                {selected.data_ranges.level && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Level record</dt>
                    <dd>{selected.data_ranges.level.year_from}–{selected.data_ranges.level.year_to} ({selected.data_ranges.level.record_length} yr)</dd>
                  </div>
                )}
              </dl>

              <div className="flex flex-col gap-2">
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
                  className="block w-full text-center text-gray-500 text-xs hover:text-gray-700 underline text-center"
                >
                  Station overview →
                </Link>
              </div>
            </div>
          </aside>
        ) : (
          <aside className="w-72 border-l border-gray-200 bg-gray-50 flex items-center justify-center shrink-0">
            <p className="text-sm text-gray-400 text-center px-4">{strings.map.selectStation}</p>
          </aside>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 left-4 z-10 bg-white border border-gray-200 rounded shadow-sm px-3 py-2 text-xs text-gray-600 flex gap-4">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-500 border border-blue-700"></span> Active
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-gray-300 border border-gray-500"></span> Discontinued
        </span>
      </div>
    </div>
  );
}
