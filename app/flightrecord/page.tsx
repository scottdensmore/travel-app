import type { Metadata } from 'next';
import FlightRecordChart from './FlightRecordChart';

export const metadata: Metadata = {
    title: 'Flight record',
    description: 'A record of your Mona Airways journeys.',
};

export const dynamic = 'force-dynamic';

/**
 * A server component, so the route can carry its own title and description.
 * The chart is browser-interactive and lives in its own client component (#72).
 */
export default function FlightRecordPage() {
    return (
        <div className="content">
            <FlightRecordChart />
        </div>
    );
}
