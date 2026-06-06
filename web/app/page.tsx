import { readFileSync } from "fs";
import path from "path";
import type { Station, CatalogMeta } from "@/lib/types";
import { MapPage } from "@/components/MapPage";

function loadData(): { stations: Station[]; meta: CatalogMeta | null } {
  const stationsPath = path.join(process.cwd(), "public/data/stations.json");
  const metaPath = path.join(process.cwd(), "public/data/catalog_meta.json");
  const stations: Station[] = JSON.parse(readFileSync(stationsPath, "utf-8"));
  let meta: CatalogMeta | null = null;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    // optional
  }
  return { stations, meta };
}

export default function Home() {
  const { stations, meta } = loadData();
  return <MapPage stations={stations} meta={meta} />;
}
