import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';

export const metadata: Metadata = {
    title: 'Flight status',
    description: 'Redirecting to flight status tracker.',
};

export default function FlightsPage() {
    permanentRedirect('/flight-status');
}
