import { prisma } from '@/lib/prisma';
import OnTimeData from '@/lib/data/OnTimeData';

export interface FlightOnTimePoint {
    name: string;
    ontimepercent: number;
    totalFlights?: number;
    ontimeCount?: number;
    delayedCount?: number;
    cancelledCount?: number;
}

export type FlightAnalyticsSource = 'OPERATIONAL_DATABASE' | 'SAMPLE_DATA';

export interface FlightOnTimeAnalyticsResult {
    data: FlightOnTimePoint[];
    source: FlightAnalyticsSource;
    sourceLabel: string;
    isSample: boolean;
    freshness: string;
    totalCompletedFlights: number;
}

export interface GetFlightOnTimeAnalyticsOptions {
    referenceDate?: Date;
    months?: number;
}

/**
 * Calculates trailing monthly on-time departure performance for completed flights.
 * Falls back to clearly labeled sample demonstration data when no historical flight records exist.
 */
export async function getFlightOnTimeAnalytics(
    options?: GetFlightOnTimeAnalyticsOptions
): Promise<FlightOnTimeAnalyticsResult> {
    const referenceDate = options?.referenceDate ?? new Date();
    const months = options?.months ?? 12;

    const startYear = referenceDate.getUTCFullYear();
    const startMonth = referenceDate.getUTCMonth() - (months - 1);
    const startDate = new Date(Date.UTC(startYear, startMonth, 1, 0, 0, 0, 0));

    const completedFlights = await prisma.flight.findMany({
        where: {
            departureDate: {
                gte: startDate,
                lte: referenceDate,
            },
        },
        select: {
            departureDate: true,
            status: true,
        },
        orderBy: {
            departureDate: 'asc',
        },
    });

    if (completedFlights.length === 0) {
        return {
            data: OnTimeData.map(d => ({
                name: d.name,
                ontimepercent: d.ontimepercent,
            })),
            source: 'SAMPLE_DATA',
            sourceLabel: 'Sample demonstration data (no historical completed flights found in database)',
            isSample: true,
            freshness: referenceDate.toISOString(),
            totalCompletedFlights: 0,
        };
    }

    // Build ordered list of month buckets
    const monthFormatter = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    });

    interface MonthBucket {
        key: string;
        name: string;
        total: number;
        onTime: number;
        delayed: number;
        cancelled: number;
    }

    const bucketsMap = new Map<string, MonthBucket>();

    for (let i = 0; i < months; i++) {
        const d = new Date(Date.UTC(startYear, startMonth + i, 1));
        if (d > referenceDate && d.getUTCMonth() !== referenceDate.getUTCMonth()) {
            continue;
        }
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const name = monthFormatter.format(d);
        bucketsMap.set(key, {
            key,
            name,
            total: 0,
            onTime: 0,
            delayed: 0,
            cancelled: 0,
        });
    }

    for (const flight of completedFlights) {
        const d = new Date(flight.departureDate);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        let bucket = bucketsMap.get(key);
        if (!bucket) {
            bucket = {
                key,
                name: monthFormatter.format(d),
                total: 0,
                onTime: 0,
                delayed: 0,
                cancelled: 0,
            };
            bucketsMap.set(key, bucket);
        }

        bucket.total += 1;
        if (flight.status === 'ON_TIME') {
            bucket.onTime += 1;
        } else if (flight.status === 'DELAYED') {
            bucket.delayed += 1;
        } else if (flight.status === 'CANCELLED') {
            bucket.cancelled += 1;
        }
    }

    // Filter buckets with data, or keep active month range
    const data: FlightOnTimePoint[] = [];
    for (const bucket of bucketsMap.values()) {
        if (bucket.total === 0) continue;
        const ontimepercent = Math.round((bucket.onTime / bucket.total) * 100);
        data.push({
            name: bucket.name,
            ontimepercent,
            totalFlights: bucket.total,
            ontimeCount: bucket.onTime,
            delayedCount: bucket.delayed,
            cancelledCount: bucket.cancelled,
        });
    }

    return {
        data,
        source: 'OPERATIONAL_DATABASE',
        sourceLabel: 'Operational flight records from Mona Airways departures',
        isSample: false,
        freshness: referenceDate.toISOString(),
        totalCompletedFlights: completedFlights.length,
    };
}
