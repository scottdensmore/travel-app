"use client"

import * as React from "react"
import { Label, Pie, PieChart } from "recharts"

import {
  CardContent,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

export const description = "Status Progress"

const chartData = [
  { status: "Bronze", points: 300, fill: "var(--color-bronze)" },
  { status: "Silver", points: 500, fill: "var(--color-silver)" },
  { status: "Gold", points: 300, fill: "var(--color-gold)" },
  { status: "Remaining Gold", points: 700, fill: "var(--color-notgold)" },
  { status: "Remaining Platinum", points: 1000, fill: "var(--color-notplatinum)" },
]

const chartConfig = {
    bronze: {
        label: "Bronze",
        color: "hsl(38, 43%, 54%)"
    },
    silver: {
        label: "Silver", // silver color
        color: "hsl(60, 0%, 50%)"
    },
    gold: {
        label: "Gold",
        color: "hsl(57, 81%, 42%)"
    },
    notgold: {
        label: "Remaining Gold",
        color: "hsl(57, 15%, 85%)"
    },
    notplatinum: {
        label: "Remaining Platinum",
        color: "hsl(0, 0%, 90%)"
    }
} satisfies ChartConfig

export default function NextStatusChart() {
  const totalpoints = React.useMemo(() => {
    return chartData.reduce((acc, curr) => acc + curr.points, 0)
  }, [])

  return (
   <>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[350px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData}
              dataKey="points"
              nameKey="status"
              innerRadius={30}
              strokeWidth={5}
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {totalpoints.toLocaleString()}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className="fill-muted-foreground"
                        >
                          points
                        </tspan>
                      </text>
                    )
                  }
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
        <div>
          1,700 points until Platinum
        </div>
 
      </>
  )
}
