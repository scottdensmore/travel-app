'use client';

import React from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import {
    CardContent,
} from "@/components/ui/card"
import {
    ChartTooltip,
    ChartTooltipContent,
    ChartContainer,
    ChartConfig
} from "@/components/ui/chart"

const chartConfig = {
    desktop: {
        label: "Desktop",
        color: "hsl(var(--chart-1))",
    },
} satisfies ChartConfig

import { Suspense } from 'react';
import LaunchDarklyService from '@/lib/LaunchDarklyService';

const OnTimeLineChart: React.FC<{ ontimeData: { name: string, ontimepercent: number }[] }> = ({ ontimeData }) => {
    if (!new LaunchDarklyService().getFlagStatus('trips-line-chart')) {
        return <div></div>;
    }

    return (
        <Suspense fallback={<div>Loading...</div>}>
                <CardContent>
                <h1>On Time Percentage</h1>
                    <ChartContainer config={chartConfig} className="min-h-[200px] w-2/3">
                        <LineChart data={ontimeData} margin={{
                            top: 20,
                            right: 20,
                            left: 20,
                            bottom: 10
                        }}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="name" />
                            <YAxis />
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
}

export default OnTimeLineChart;