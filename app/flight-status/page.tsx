import type { Metadata } from 'next';
import React from 'react';
import FlightStatusTracker from '@/components/ui/FlightStatusTracker';
import { FlightStatusService, type FlightStatusResult } from '@/lib/flightStatusService';
import { flightStatusSearchSchema, type FlightStatusSearchInput } from '@/lib/validation';
import { serverRenderTime } from '@/lib/serverClock';

export const metadata: Metadata = {
    title: 'Flight Status Tracker',
    description: 'Check real-time flight status, gate assignments, and route progress for Mona Airways flights.',
};

export const dynamic = 'force-dynamic';

interface FlightStatusPageProps {
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }> | { [key: string]: string | string[] | undefined };
}

export default async function FlightStatusPage({ searchParams }: FlightStatusPageProps) {
    const resolvedParams = searchParams ? await searchParams : {};
    const flightParam = typeof resolvedParams.flight === 'string' ? resolvedParams.flight : undefined;
    const fromParam = typeof resolvedParams.from === 'string' ? resolvedParams.from : undefined;
    const toParam = typeof resolvedParams.to === 'string' ? resolvedParams.to : undefined;
    const dateParam = typeof resolvedParams.date === 'string' ? resolvedParams.date : undefined;

    let initialSearch: FlightStatusSearchInput | null = null;

    if (flightParam) {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'flightNumber',
            flightNumber: flightParam,
            date: dateParam || undefined,
        });
        if (parsed.success) {
            initialSearch = parsed.data;
        }
    } else if (fromParam && toParam) {
        const parsed = flightStatusSearchSchema.safeParse({
            mode: 'route',
            from: fromParam,
            to: toParam,
            date: dateParam || undefined,
        });
        if (parsed.success) {
            initialSearch = parsed.data;
        }
    }

    let initialFlights: FlightStatusResult[] = [];
    const renderedAt = await serverRenderTime();

    if (initialSearch) {
        try {
            initialFlights = await FlightStatusService.searchFlightStatus(initialSearch, renderedAt);
        } catch (error) {
            console.error('Error fetching initial flight status:', error);
            initialFlights = [];
        }
    }

    return (
        <FlightStatusTracker
            initialFlights={initialFlights}
            initialSearch={initialSearch}
            coverage="the next 48 hours"
        />
    );
}
