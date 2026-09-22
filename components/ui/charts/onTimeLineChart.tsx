// line chart for on time percentage of flights
'use client';

import React, { Suspense } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { CardContent } from "@/components/ui/card";
import {
    ChartTooltip,
    ChartTooltipContent,
    ChartContainer,
    ChartConfig
} from "@/components/ui/chart";

const chartConfig = {
    desktop: {
        label: "Desktop",
        color: "hsl(var(--chart-1))",
    },
} satisfies ChartConfig;

export interface OnTimeLineChartProps {
    ontimeData: Array<{
        name: string;
        ontimepercent: number;
        totalFlights?: number;
        ontimeCount?: number;
        delayedCount?: number;
        cancelledCount?: number;
    }>;
    source?: 'OPERATIONAL_DATABASE' | 'SAMPLE_DATA';
    sourceLabel?: string;
    isSample?: boolean;
    freshness?: string;
    totalCompletedFlights?: number;
}

const OnTimeLineChart: React.FC<OnTimeLineChartProps> = ({
    ontimeData,
    source,
    sourceLabel,
    isSample = false,
    freshness,
    totalCompletedFlights,
}) => {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <CardContent>
                <div className="flex flex-col gap-2 mb-4">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold tracking-tight">On Time Percentage</h1>
                        {source && (
                            <span
                                role="status"
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                    isSample
                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                }`}
                            >
                                {isSample ? 'Sample Demonstration Data' : 'Operational Flight Data'}
                            </span>
                        )}
                    </div>
                    {sourceLabel && (
                        <p className="text-sm text-gray-400">
                            {sourceLabel}
                            {totalCompletedFlights !== undefined && totalCompletedFlights > 0
                                ? ` • ${totalCompletedFlights} completed flights analyzed`
                                : ''}
                            {freshness ? ` • Freshness: ${new Date(freshness).toLocaleDateString()}` : ''}
                        </p>
                    )}
                </div>

                {/* Accessible screen-reader table representation */}
                <div className="sr-only">
                    <table aria-label="On Time Performance Data">
                        <thead>
                            <tr>
                                <th scope="col">Month</th>
                                <th scope="col">On-Time %</th>
                                <th scope="col">Total Flights</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ontimeData.map(d => (
                                <tr key={d.name}>
                                    <td>{d.name}</td>
                                    <td>{d.ontimepercent}%</td>
                                    <td>{d.totalFlights ?? 'N/A'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <ChartContainer config={chartConfig} className="min-h-[200px] w-2/3">
                    <LineChart data={ontimeData} margin={{
                        top: 20,
                        right: 20,
                        left: 20,
                        bottom: 10
                    }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="name" />
                        <YAxis domain={[0, 100]} unit="%" />
                        <ChartTooltip
                            cursor={false}
                            content={<ChartTooltipContent hideLabel />}
                        />
                        <Line
                            dataKey="ontimepercent"
                            type="natural"
                            stroke="var(--color-desktop)"
                            strokeWidth={2}
                            dot={false}
                        />
                    </LineChart>
                </ChartContainer>
            </CardContent>
        </Suspense>
    );
};

export default OnTimeLineChart;