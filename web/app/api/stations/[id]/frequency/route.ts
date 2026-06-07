import { NextResponse } from "next/server";
import { fetchAnnualPeaks } from "@/lib/ogc";
import type { FrequencyRequest, PeakPoint } from "@/lib/types";

const FFA_SERVICE_URL = process.env.FFA_SERVICE_URL ?? "http://localhost:8000";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stationId = id.toUpperCase();
  const body = (await req.json()) as FrequencyRequest & { peaks?: PeakPoint[] };

  // Fetch peaks directly from OGC (no HTTP self-call)
  let peaks: PeakPoint[] = body.peaks ?? [];
  if (!peaks.length) {
    try {
      const features = await fetchAnnualPeaks(stationId);
      peaks = features
        .filter(
          (f) =>
            f.properties.DATA_TYPE_EN?.toLowerCase().includes("discharge") &&
            f.properties.PEAK_CODE_EN?.toLowerCase().includes("maximum") &&
            f.properties.PEAK !== null
        )
        .map((f) => {
          const date = f.properties.DATE ?? "";
          return {
            year: parseInt(date.slice(0, 4), 10),
            value: f.properties.PEAK!,
            date: date || undefined,
            symbol: f.properties.SYMBOL_EN ?? null,
          };
        })
        .filter((p) => !isNaN(p.year))
        .sort((a, b) => a.year - b.year);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return NextResponse.json({ error: `Failed to fetch peaks: ${msg}` }, { status: 502 });
    }
  }

  const payload = {
    station_id: stationId,
    variable: "discharge",
    peaks,
    distributions: body.distributions ?? ["gev", "glo", "gumbel", "lp3", "pe3"],
    estimation_method: body.estimation_method ?? "lmoments",
    plotting_position: body.plotting_position ?? "cunnane",
    return_periods: body.return_periods ?? [2, 5, 10, 20, 25, 50, 100, 200, 500],
    exclude_estimated: body.exclude_estimated ?? true,
    confidence_level: body.confidence_level ?? 0.9,
    ci_method: body.ci_method ?? "bootstrap",
    bootstrap_samples: body.bootstrap_samples ?? 2000,
    random_seed: 42,
  };

  try {
    const ffaRes = await fetch(`${FFA_SERVICE_URL}/api/v1/flood-frequency`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!ffaRes.ok) {
      const err = await ffaRes.text();
      return NextResponse.json({ error: err }, { status: ffaRes.status });
    }

    return NextResponse.json(await ffaRes.json());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `FFA service unreachable: ${msg}` }, { status: 503 });
  }
}
