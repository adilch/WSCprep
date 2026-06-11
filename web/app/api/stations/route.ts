import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";

let catalog: unknown[] | null = null;

function loadCatalog() {
  if (catalog) return catalog;
  const filePath = path.join(process.cwd(), "public/data/stations.json");
  catalog = JSON.parse(readFileSync(filePath, "utf-8"));
  return catalog!;
}

export async function GET() {
  try {
    const stations = loadCatalog();
    return NextResponse.json(stations, {
      headers: {
        // Catalog is bundled at build time — cache hard, refresh weekly.
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return NextResponse.json({ error: "Station catalog not found" }, { status: 500 });
  }
}
