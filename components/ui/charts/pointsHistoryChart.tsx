"use client"

import * as React from "react"
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card"
import { PointsActivityDisplayData } from "@/lib/types/PointsActivity"

export default function PointsHistoryChart({
    accountTimeZone,
    chartData = [],
}: {
    accountTimeZone: string;
    chartData?: PointsActivityDisplayData[];
}) {
    const maxPoints = Math.max(1, ...chartData.map(row => row.points));

    return (
        <Card>
            <CardHeader>
                <CardTitle>Points History</CardTitle>
                <CardDescription>
                    Monthly points accumulation in {accountTimeZone}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ol
                    className="points-history-chart"
                    aria-label={`Monthly points history in ${accountTimeZone}`}
                >
                    {chartData.map(row => (
                        <li key={row.date}>
                            <div className="points-history-label">
                                <span>{row.date}</span>
                                <strong>{row.points.toLocaleString()} points</strong>
                            </div>
                            <span className="points-history-track" aria-hidden="true">
                                <span
                                    className="points-history-bar"
                                    style={{ width: `${Math.max(4, (row.points / maxPoints) * 100)}%` }}
                                />
                            </span>
                        </li>
                    ))}
                </ol>
            </CardContent>
        </Card>
    )
}
