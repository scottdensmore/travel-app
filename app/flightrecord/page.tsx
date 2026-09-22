import type { Metadata } from 'next';
import FlightRecordChart from './FlightRecordChart';
import { getFlightOnTimeAnalytics } from '@/lib/flightAnalyticsService';

export const metadata: Metadata = {
    title: 'Flight record',
    description: 'A record of your Mona Airways journeys and operational performance.',
};

export const dynamic = 'force-dynamic';

/**
 * A server component, so the route can carry its own title and description.
 * Aggregates trailing completed flight performance from PostgreSQL records.
 */
export default async function FlightRecordPage() {
    const analytics = await getFlightOnTimeAnalytics();

    return (
        <div className="content">
            <FlightRecordChart analytics={analytics} />
        </div>
    );
}
