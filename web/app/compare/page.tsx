import { readFileSync } from "fs";
import path from "path";
import type { Station } from "@/lib/types";
import { CompareView } from "@/components/CompareView";

function loadCatalog(): Station[] {
  const p = path.join(process.cwd(), "public/data/stations.json");
  return JSON.parse(readFileSync(p, "utf-8"));
}

export const metadata = {
  title: "Compare Stations — WSCprep",
};

export default function ComparePage() {
  return <CompareView catalog={loadCatalog()} />;
}
