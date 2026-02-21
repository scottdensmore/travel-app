"use client"
import OnTimeLineChart from "@/components/ui/charts/onTimeLineChart";
import OnTimeData from "@/lib/data/OnTimeData";

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <div className="content">
      <OnTimeLineChart ontimeData={OnTimeData} />
    </div>
  )
}
