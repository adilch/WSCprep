import { readFileSync } from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Station } from "@/lib/types";
import { Badge } from "@/components/Badge";
import { fmtArea } from "@/lib/format";

function getStation(id: string): Station | null {
  const p = path.join(process.cwd(), "public/data/stations.json");
  const stations: Station[] = JSON.parse(readFileSync(p, "utf-8"));
  return stations.find((s) => s.station_number === id.toUpperCase()) ?? null;
}

export default async function StationOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const station = getStation(id);
  if (!station) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h2 className="text-xl font-semibold mb-6 text-gray-800">Station Overview</h2>

      <div className="grid grid-cols-2 gap-4 mb-8 text-sm">
        <div className="bg-gray-50 rounded p-4">
          <p className="text-xs text-gray-500 mb-1">Station Number</p>
          <p className="font-mono font-semibold">{station.station_number}</p>
        </div>
        <div className="bg-gray-50 rounded p-4">
          <p className="text-xs text-gray-500 mb-1">Province</p>
          <p className="font-semibold">{station.province}</p>
        </div>
        <div className="bg-gray-50 rounded p-4">
          <p className="text-xs text-gray-500 mb-1">Status</p>
          <Badge variant={station.status === "active" ? "green" : "gray"}>
            {station.status === "active" ? "Active" : "Discontinued"}
          </Badge>
        </div>
        <div className="bg-gray-50 rounded p-4">
          <p className="text-xs text-gray-500 mb-1">Regulation</p>
          {station.regulated === true && <Badge variant="amber">Regulated</Badge>}
          {station.regulated === false && <Badge variant="blue">Natural</Badge>}
          {station.regulated === null && <span className="text-gray-400 text-xs">Unknown</span>}
        </div>
        <div className="bg-gray-50 rounded p-4">
          <p className="text-xs text-gray-500 mb-1">Drainage Area (gross)</p>
          <p className="font-semibold">{fmtArea(station.drainage_area_gross_km2)}</p>
        </div>
        <div className="bg-gray-50 rounded p-4">
          <p className="text-xs text-gray-500 mb-1">Datum</p>
          <p className="font-semibold">{station.datum ?? "—"}</p>
        </div>
        <div className="bg-gray-50 rounded p-4">
          <p className="text-xs text-gray-500 mb-1">Coordinates</p>
          <p className="font-mono text-xs">{station.latitude.toFixed(4)}° N, {Math.abs(station.longitude).toFixed(4)}° W</p>
        </div>
        <div className="bg-gray-50 rounded p-4">
          <p className="text-xs text-gray-500 mb-1">Flags</p>
          <div className="flex gap-1.5 flex-wrap">
            {station.rhbn && <Badge variant="blue">RHBN</Badge>}
            {station.real_time && <Badge variant="green">Real-time</Badge>}
            {!station.rhbn && !station.real_time && <span className="text-gray-400 text-xs">—</span>}
          </div>
        </div>
      </div>

      {/* Data availability */}
      <h3 className="font-semibold text-gray-700 mb-3">Data Availability</h3>
      <div className="border border-gray-200 rounded overflow-hidden mb-8 text-sm">
        <table className="w-full">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Data Type</th>
              <th className="px-4 py-2 text-left">Period</th>
              <th className="px-4 py-2 text-left">Record Length</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {station.data_ranges.flow ? (
              <tr>
                <td className="px-4 py-2 font-medium">Flow (Discharge)</td>
                <td className="px-4 py-2">{station.data_ranges.flow.year_from}–{station.data_ranges.flow.year_to}</td>
                <td className="px-4 py-2">{station.data_ranges.flow.record_length} yr</td>
              </tr>
            ) : (
              <tr>
                <td className="px-4 py-2 text-gray-400" colSpan={3}>No flow data</td>
              </tr>
            )}
            {station.data_ranges.level ? (
              <tr>
                <td className="px-4 py-2 font-medium">Water Level</td>
                <td className="px-4 py-2">{station.data_ranges.level.year_from}–{station.data_ranges.level.year_to}</td>
                <td className="px-4 py-2">{station.data_ranges.level.record_length} yr</td>
              </tr>
            ) : (
              <tr>
                <td className="px-4 py-2 text-gray-400" colSpan={3}>No level data</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        <Link
          href={`/stations/${station.station_number}/daily`}
          className="flex-1 text-center bg-blue-600 text-white rounded px-4 py-3 text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Historic Data Analysis →
        </Link>
        <Link
          href={`/stations/${station.station_number}/frequency`}
          className="flex-1 text-center border border-blue-600 text-blue-700 rounded px-4 py-3 text-sm font-medium hover:bg-blue-50 transition-colors"
        >
          Flood Frequency Analysis →
        </Link>
      </div>
    </div>
  );
}
