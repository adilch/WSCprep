import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";
import type { Station } from "@/lib/types";

let catalog: Station[] | null = null;

function loadCatalog(): Station[] {
  if (catalog) return catalog;
  const filePath = path.join(process.cwd(), "public/data/stations.json");
  catalog = JSON.parse(readFileSync(filePath, "utf-8"));
  return catalog!;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const stations = loadCatalog();
    const station = stations.find((s) => s.station_number === id.toUpperCase());
    if (!station) return NextResponse.json({ error: "Station not found" }, { status: 404 });
    return NextResponse.json(station);
  } catch {
    return NextResponse.json({ error: "Station catalog not found" }, { status: 500 });
  }
}
