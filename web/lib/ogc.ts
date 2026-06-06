const OGC_BASE = process.env.OGC_BASE_URL ?? "https://api.weather.gc.ca";

async function fetchAllFeatures(url: string, params: Record<string, string>): Promise<unknown[]> {
  const all: unknown[] = [];
  let offset = 0;
  const limit = 10000;

  while (true) {
    const u = new URL(`${OGC_BASE}/collections/${url}/items`);
    Object.entries({ ...params, limit: String(limit), offset: String(offset), f: "json" }).forEach(
      ([k, v]) => u.searchParams.set(k, v)
    );

    const res = await fetch(u.toString(), {
      next: { revalidate: 86400 }, // cache 24h — historical data changes slowly
      headers: { "User-Agent": "WSC-Hydro-App/1.0" },
    });

    if (!res.ok) throw new Error(`OGC API error ${res.status}: ${url}`);

    const json = (await res.json()) as { features: unknown[]; numberMatched?: number };
    const features = json.features ?? [];
    all.push(...features);

    if (features.length < limit) break;
    offset += limit;
  }

  return all;
}

export interface OgcDailyFeature {
  properties: {
    STATION_NUMBER: string;
    DATE: string;
    DISCHARGE: number | null;
    LEVEL: number | null;
    DISCHARGE_SYMBOL_EN: string | null;
    LEVEL_SYMBOL_EN: string | null;
  };
}

export async function fetchDailyMean(
  stationId: string,
  start?: string,
  end?: string
): Promise<OgcDailyFeature[]> {
  const params: Record<string, string> = { STATION_NUMBER: stationId };
  if (start && end) params["datetime"] = `${start}/${end}`;
  const features = await fetchAllFeatures("hydrometric-daily-mean", params);
  return features as OgcDailyFeature[];
}

export interface OgcPeakFeature {
  properties: {
    STATION_NUMBER: string;
    DATA_TYPE_EN: string;
    PEAK_CODE_EN: string;
    PEAK: number | null;
    DATE: string | null;
    TIME: string | null;
    SYMBOL_EN: string | null;
    UNITS: string | null;
  };
}

export async function fetchAnnualPeaks(stationId: string): Promise<OgcPeakFeature[]> {
  const features = await fetchAllFeatures("hydrometric-annual-peaks", {
    STATION_NUMBER: stationId,
  });
  return features as OgcPeakFeature[];
}
