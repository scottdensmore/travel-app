"use client"

import OnTimeLineChart from "@/components/ui/charts/onTimeLineChart";
import OnTimeData from "@/lib/data/OnTimeData";

/** The chart alone, so the route itself can stay a server component. */
export default function FlightRecordChart() {
    return <OnTimeLineChart ontimeData={OnTimeData} />;
}
