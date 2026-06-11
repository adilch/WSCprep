import { NextResponse } from "next/server";
import { fetchDailyMean } from "@/lib/ogc";
import type { DailyPoint } from "@/lib/types";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const variable = searchParams.get("variable") ?? "discharge";
  const start = searchParams.get("start") ?? undefined;
  const end = searchParams.get("end") ?? undefined;

  try {
    const features = await fetchDailyMean(id.toUpperCase(), start, end);

    const series: DailyPoint[] = features.map((f) => ({
      date: f.properties.DATE,
      value: variable === "discharge" ? f.properties.DISCHARGE : f.properties.LEVEL,
      symbol:
        variable === "discharge"
          ? f.properties.DISCHARGE_SYMBOL_EN
          : f.properties.LEVEL_SYMBOL_EN,
    }));

    series.sort((a, b) => a.date.localeCompare(b.date));

    const values = series.filter((s) => s.value !== null).map((s) => s.date);
    return NextResponse.json({
      station_id: id.toUpperCase(),
      variable,
      unit: variable === "discharge" ? "m3/s" : "m",
      series,
      meta: {
        count: series.length,
        start: values[0] ?? null,
        end: values[values.length - 1] ?? null,
      },
    }, {
      headers: {
        // HYDAT daily data updates at most once a day — let the CDN absorb
        // repeat traffic and serve stale while revalidating in the background.
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
