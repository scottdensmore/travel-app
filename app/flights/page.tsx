import type { Metadata } from 'next';
import { redirect, RedirectType } from 'next/navigation';

export const metadata: Metadata = {
    title: 'Flight status',
    description: 'Redirecting to flight status tracker.',
};

export default function FlightsPage() {
    redirect('/flight-status', RedirectType.replace);
}
