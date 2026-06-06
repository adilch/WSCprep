import { FrequencyView } from "@/components/FrequencyView";

export default async function FrequencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FrequencyView stationId={id.toUpperCase()} />;
}
