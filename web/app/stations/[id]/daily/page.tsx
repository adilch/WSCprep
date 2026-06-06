import { HistoricDataView } from "@/components/HistoricDataView";

export default async function DailyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HistoricDataView stationId={id.toUpperCase()} />;
}
