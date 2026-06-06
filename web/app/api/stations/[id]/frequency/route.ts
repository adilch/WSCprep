import { NextResponse } from "next/server";
import type { FrequencyRequest } from "@/lib/types";

const FFA_SERVICE_URL = process.env.FFA_SERVICE_URL ?? "http://localhost:8000";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as FrequencyRequest & { peaks?: unknown[] };

  let peaks = body.peaks;

  if (!peaks) {
    const peaksRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/stations/${id}/peaks`
    );
    if (!peaksRes.ok) {
      return NextResponse.json({ error: "Failed to fetch peaks" }, { status: 502 });
    }
    const data = await peaksRes.json();
    peaks = data.peaks;
  }

  const payload = {
    station_id: id.toUpperCase(),
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
