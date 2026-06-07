import { Suspense } from "react";
import { FrequencyView } from "@/components/FrequencyView";

export default async function FrequencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>}>
      <FrequencyView stationId={id.toUpperCase()} />
    </Suspense>
  );
}
