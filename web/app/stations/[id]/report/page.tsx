import { readFileSync } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import type { Station } from "@/lib/types";
import { ReportView } from "@/components/ReportView";

function getStation(id: string): Station | null {
  const stationsPath = path.join(process.cwd(), "public/data/stations.json");
  const stations: Station[] = JSON.parse(readFileSync(stationsPath, "utf-8"));
  return stations.find((s) => s.station_number === id.toUpperCase()) ?? null;
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const station = getStation(id);
  if (!station) notFound();

  return <ReportView stationId={id.toUpperCase()} station={station} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const station = getStation(id);
  return {
    title: station ? `${station.name} — Hydrometric Report` : "Station Report",
  };
}
