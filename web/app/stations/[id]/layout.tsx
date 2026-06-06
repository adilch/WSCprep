import { readFileSync } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import type { Station } from "@/lib/types";
import { StationHeader } from "@/components/StationHeader";

function getStation(id: string): Station | null {
  const stationsPath = path.join(process.cwd(), "public/data/stations.json");
  const stations: Station[] = JSON.parse(readFileSync(stationsPath, "utf-8"));
  return stations.find((s) => s.station_number === id.toUpperCase()) ?? null;
}

export default async function StationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const station = getStation(id);
  if (!station) notFound();

  return (
    <div className="flex flex-col flex-1">
      <StationHeader station={station} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
