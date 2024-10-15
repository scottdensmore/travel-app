"use client"
import OnTimeLineChart from "@/components/ui/charts/onTimeLineChart";
import OnTimeData from "@/lib/data/OnTimeData";

export default function Home() {
  return (
    <div className="content">
        <OnTimeLineChart ontimeData={OnTimeData} />
    </div>
  )
}
