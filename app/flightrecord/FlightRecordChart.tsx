"use client";

import React from "react";
import OnTimeLineChart from "@/components/ui/charts/onTimeLineChart";
import OnTimeData from "@/lib/data/OnTimeData";
import type { FlightOnTimeAnalyticsResult } from "@/lib/flightAnalyticsService";

interface FlightRecordChartProps {
    analytics?: FlightOnTimeAnalyticsResult;
}

/** The chart component, rendering either live analytics or sample fallback data. */
export default function FlightRecordChart({ analytics }: FlightRecordChartProps) {
    if (!analytics) {
        return (
            <OnTimeLineChart
                ontimeData={OnTimeData}
                source="SAMPLE_DATA"
                sourceLabel="Sample demonstration data (no historical completed flights found in database)"
                isSample={true}
                totalCompletedFlights={0}
            />
        );
    }

    return (
        <OnTimeLineChart
            ontimeData={analytics.data}
            source={analytics.source}
            sourceLabel={analytics.sourceLabel}
            isSample={analytics.isSample}
            freshness={analytics.freshness}
            totalCompletedFlights={analytics.totalCompletedFlights}
        />
    );
}
