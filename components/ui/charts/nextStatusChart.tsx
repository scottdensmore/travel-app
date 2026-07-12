"use client"

import * as React from "react"
import { Label, Pie, PieChart } from "recharts"
import { CardContent } from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

export const description = "Status Progress"

const chartConfig = {
    bronze: {
        label: "Bronze",
        color: "hsl(38, 43%, 54%)"
    },
    silver: {
        label: "Silver",
        color: "hsl(60, 0%, 50%)"
    },
    gold: {
        label: "Gold",
        color: "hsl(57, 81%, 42%)"
    },
    platinum: {
        label: "Platinum",
        color: "hsl(197, 37%, 24%)"
    },
    remaining: {
        label: "Remaining",
        color: "hsl(0, 0%, 90%)"
    }
} satisfies ChartConfig

export default function NextStatusChart({ points = 1300 }: { points?: number }) {
  const { chartData, nextTier, remainingPoints } = React.useMemo(() => {
    const bronze = Math.min(points, 1000);
    const silver = Math.min(Math.max(points - 1000, 0), 2000);
    const gold = Math.min(Math.max(points - 3000, 0), 3000);
    const platinum = Math.min(Math.max(points - 6000, 0), 4000);

    let nextTier = "Silver";
    let remainingPoints = 1000 - points;
    if (points >= 6000) {
      nextTier = "Platinum";
      remainingPoints = Math.max(10000 - points, 0);
    } else if (points >= 3000) {
      nextTier = "Platinum";
      remainingPoints = 6000 - points;
    } else if (points >= 1000) {
      nextTier = "Gold";
      remainingPoints = 3000 - points;
    } else {
      nextTier = "Silver";
      remainingPoints = 1000 - points;
    }

    const data = [
      { status: "Bronze", points: bronze, fill: "hsl(38, 43%, 54%)" },
      { status: "Silver", points: silver, fill: "hsl(60, 0%, 50%)" },
      { status: "Gold", points: gold, fill: "hsl(57, 81%, 42%)" },
      { status: "Platinum", points: platinum, fill: "hsl(197, 37%, 24%)" },
    ];

    if (remainingPoints > 0) {
      data.push({ status: `Remaining to ${nextTier}`, points: remainingPoints, fill: "hsl(0, 0%, 90%)" });
    }

    return { chartData: data, nextTier, remainingPoints };
  }, [points]);

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
                          {points.toLocaleString()}
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
        <div className="text-center font-semibold text-sm text-gray-700 mt-2">
          {remainingPoints > 0 
            ? `${remainingPoints.toLocaleString()} points until ${nextTier}`
            : `Platinum Status Reached!`}
        </div>
      </>
  )
}
