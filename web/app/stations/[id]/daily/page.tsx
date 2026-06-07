import { Suspense } from "react";
import { HistoricDataView } from "@/components/HistoricDataView";

export default async function DailyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>}>
      <HistoricDataView stationId={id.toUpperCase()} />
    </Suspense>
  );
}
