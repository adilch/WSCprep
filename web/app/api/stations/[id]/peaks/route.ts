import { NextResponse } from "next/server";
import { fetchAnnualPeaks } from "@/lib/ogc";
import type { PeakPoint } from "@/lib/types";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const features = await fetchAnnualPeaks(id.toUpperCase());

    // Filter to annual maximum instantaneous discharge
    const maxDischarge = features.filter(
      (f) =>
        f.properties.DATA_TYPE_EN?.toLowerCase().includes("discharge") &&
        f.properties.PEAK_CODE_EN?.toLowerCase().includes("maximum")
    );

    const peaks: PeakPoint[] = maxDischarge
      .filter((f) => f.properties.PEAK !== null)
      .map((f) => {
        const date = f.properties.DATE ?? "";
        const year = date ? parseInt(date.slice(0, 4), 10) : NaN;
        return {
          year,
          value: f.properties.PEAK!,
          date: date || undefined,
          symbol: f.properties.SYMBOL_EN ?? null,
        };
      })
      .filter((p) => !isNaN(p.year))
      .sort((a, b) => a.year - b.year);

    return NextResponse.json({
      station_id: id.toUpperCase(),
      variable: "discharge",
      peak_code: "max",
      unit: "m3/s",
      peaks,
    }, {
      headers: {
        // Annual peak series changes at most a few times a year.
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
