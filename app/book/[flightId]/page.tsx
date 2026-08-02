import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{
        flightId: string;
    }>;
}

/**
 * Checkout moved to /checkout, which addresses a whole itinerary rather than a
 * single flight. This keeps older one-way links working; /checkout does the
 * auth check and validates the id.
 */
export default async function LegacyBookingCheckoutPage({ params }: PageProps) {
    const { flightId } = await params;
    redirect(`/checkout?outbound=${encodeURIComponent(flightId)}`);
}
