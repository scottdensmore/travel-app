"use client"

import * as React from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card"
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart"
import PointsActivityService from "@/lib/PointsActivityService"

const chartConfig = {
    points: {
        label: "Points",
        color: "hsl(var(--chart-1))",
    },
} satisfies ChartConfig

export default function PointsHistoryChart() {
    const [chartData, setChartData] = React.useState<any[]>([])

    React.useEffect(() => {
        const service = new PointsActivityService()
        const data = service.getMonthlyPointsActivity()
        setChartData(data)
    }, [])

    return (
        <Card>
            <CardHeader>
                <CardTitle>Points History</CardTitle>
                <CardDescription>Monthly points accumulation over the last year</CardDescription>
            </CardHeader>
            <CardContent>
                <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
                    <LineChart
                        accessibilityLayer
                        data={chartData}
                        margin={{
                            left: 12,
                            right: 12,
                        }}
                    >
                        <CartesianGrid vertical={false} />
                        <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            width={40}
                        />
                        <ChartTooltip
                            cursor={false}
                            content={<ChartTooltipContent hideLabel />}
                        />
                        <Line
                            dataKey="points"
                            type="natural"
                            stroke="var(--color-points)"
                            strokeWidth={2}
                            dot={{
                                fill: "var(--color-points)",
                            }}
                            activeDot={{
                                r: 6,
                            }}
                        />
                    </LineChart>
                </ChartContainer>
            </CardContent>
        </Card>
    )
}
