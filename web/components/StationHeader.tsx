"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Station } from "@/lib/types";
import { Badge } from "./Badge";
import { fmtArea } from "@/lib/format";

function Tab({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-blue-600 text-blue-700"
          : "border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300"
      }`}
    >
      {label}
    </Link>
  );
}

export function StationHeader({ station }: { station: Station }) {
  const id = station.station_number;
  const maxRecord = Math.max(
    station.data_ranges.flow?.record_length ?? 0,
    station.data_ranges.level?.record_length ?? 0
  );

  return (
    <div className="print-hide sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-screen-xl mx-auto px-4 pt-3 pb-0">
        {/* Title row */}
        <div className="flex flex-wrap items-start gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 font-mono">{id}</p>
            <h1 className="text-lg font-semibold text-gray-900 leading-tight truncate">{station.name}</h1>
            <p className="text-sm text-gray-500">{station.province}</p>
          </div>
          <div className="flex flex-wrap gap-1.5 items-center pt-1">
            <Badge variant={station.status === "active" ? "green" : "gray"}>
              {station.status === "active" ? "Active" : "Discontinued"}
            </Badge>
            {station.regulated === true && <Badge variant="amber">Regulated</Badge>}
            {station.regulated === false && <Badge variant="blue">Natural</Badge>}
            {station.rhbn && <Badge variant="blue">RHBN</Badge>}
          </div>
        </div>

        {/* Metadata strip */}
        <div className="flex flex-wrap gap-4 text-xs text-gray-600 mb-2">
          {station.drainage_area_gross_km2 && (
            <span>Drainage area: <strong>{fmtArea(station.drainage_area_gross_km2)}</strong></span>
          )}
          {station.datum && <span>Datum: <strong>{station.datum}</strong></span>}
          {station.data_ranges.flow && (
            <span>
              Flow: <strong>{station.data_ranges.flow.year_from}–{station.data_ranges.flow.year_to}</strong>{" "}
              ({station.data_ranges.flow.record_length} yr)
            </span>
          )}
          {station.data_ranges.level && (
            <span>
              Level: <strong>{station.data_ranges.level.year_from}–{station.data_ranges.level.year_to}</strong>{" "}
              ({station.data_ranges.level.record_length} yr)
            </span>
          )}
          {maxRecord === 0 && <span className="text-gray-400">No record range available</span>}
        </div>

        {/* Regulation caution */}
        {station.regulated === true && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
            ⚠ Regulated station — flood frequency analysis assumes natural, stationary flow. Use results with caution.
          </p>
        )}

        {/* Tab navigation */}
        <nav className="flex gap-0 -mb-px" aria-label="Station sections">
          <Tab href={`/stations/${id}`} label="Overview" />
          <Tab href={`/stations/${id}/daily`} label="Historic Data" />
          <Tab href={`/stations/${id}/frequency`} label="Flood Frequency" />
        </nav>
      </div>
    </div>
  );
}
