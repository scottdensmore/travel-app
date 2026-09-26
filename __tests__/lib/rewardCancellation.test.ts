/** @jest-environment node */
import {
    calculateCancellationOutcome,
    cancellationOutcome,
    cancellableBooking,
} from '@/lib/cancellationPolicy';

describe('reward cancellation policy', () => {
    const HOUR = 60 * 60 * 1000;
    const now = new Date('2026-08-10T12:00:00Z');
    const inHours = (hours: number) => new Date(now.getTime() + hours * HOUR);

    it('returns 100% points for First and Business cabin before 24h cutoff', () => {
        const outcome = calculateCancellationOutcome({
            status: 'CONFIRMED',
            isRewardBooking: true,
            pointsRedeemed: 40000,
            totalPriceCents: 1010,
            departsAt: new Date(Date.now() + 48 * 3600 * 1000),
            legFareCents: [25000],
            cabins: ['BUSINESS'],
        });

        expect(outcome.allowed).toBe(true);
        expect(outcome.pointsRedeposited).toBe(40000);
        expect(outcome.refundCents).toBe(1010);
    });

    it('returns 80% points for Economy cabin before 24h cutoff with 20% penalty', () => {
        const outcome = calculateCancellationOutcome({
            status: 'CONFIRMED',
            isRewardBooking: true,
            pointsRedeemed: 15000,
            totalPriceCents: 1010,
            departsAt: new Date(Date.now() + 48 * 3600 * 1000),
            legFareCents: [15000],
            cabins: ['ECONOMY'],
        });

        expect(outcome.allowed).toBe(true);
        expect(outcome.pointsRedeposited).toBe(12000); // 80% of 15,000
        expect(outcome.refundCents).toBe(1010);
    });

    it('returns 100% points for First cabin and 80% for Premium Economy before cutoff', () => {
        const firstOutcome = cancellationOutcome({
            status: 'CONFIRMED',
            isRewardBooking: true,
            pointsRedeemed: 60000,
            totalPriceCents: 1010,
            departsAt: inHours(48),
            legFareCents: [50000],
            cabins: ['FIRST'],
        }, now);

        expect(firstOutcome.allowed).toBe(true);
        expect(firstOutcome.pointsRedeposited).toBe(60000);
        expect(firstOutcome.refundCents).toBe(1010);

        const peOutcome = cancellationOutcome({
            status: 'CONFIRMED',
            isRewardBooking: true,
            pointsRedeemed: 25000,
            totalPriceCents: 1010,
            departsAt: inHours(48),
            legFareCents: [20000],
            cabins: ['PREMIUM_ECONOMY'],
        }, now);

        expect(peOutcome.allowed).toBe(true);
        expect(peOutcome.pointsRedeposited).toBe(20000); // 80% of 25,000
        expect(peOutcome.refundCents).toBe(1010);
    });

    it('calculates weighted redeposit for mixed cabins', () => {
        // Business (40,000 pts nominal) + Economy (15,000 pts nominal) = 55,000 nominal
        // Business share = 40,000, 100% redeposit = 40,000
        // Economy share = 15,000, 80% redeposit = 12,000
        // Total redeposited = 52,000
        const outcome = cancellationOutcome({
            status: 'CONFIRMED',
            isRewardBooking: true,
            pointsRedeemed: 55000,
            totalPriceCents: 2020,
            departsAt: inHours(48),
            legFareCents: [25000],
            cabins: ['BUSINESS', 'ECONOMY'],
        }, now);

        expect(outcome.allowed).toBe(true);
        expect(outcome.pointsRedeposited).toBe(52000);
        expect(outcome.refundCents).toBe(2020);
    });

    it('forfeits points and cash taxes when cancelled inside 24h cutoff', () => {
        const outcome = cancellationOutcome({
            status: 'CONFIRMED',
            isRewardBooking: true,
            pointsRedeemed: 40000,
            totalPriceCents: 1010,
            departsAt: inHours(12),
            legFareCents: [25000],
            cabins: ['BUSINESS'],
        }, now);

        expect(outcome.allowed).toBe(true);
        expect(outcome.reason).toBe('INSIDE_CUTOFF');
        expect(outcome.pointsRedeposited).toBe(0);
        expect(outcome.refundCents).toBe(0);
    });

    it('returns 100% points and full cash taxes when flight is disrupted by airline', () => {
        const outcome = cancellationOutcome({
            status: 'DISRUPTED',
            isRewardBooking: true,
            pointsRedeemed: 15000,
            totalPriceCents: 1010,
            departsAt: inHours(2),
            legFareCents: [15000],
            cabins: ['ECONOMY'],
        }, now);

        expect(outcome.allowed).toBe(true);
        expect(outcome.reason).toBe('DISRUPTED');
        expect(outcome.pointsRedeposited).toBe(15000);
        expect(outcome.refundCents).toBe(1010);
    });

    it('refuses cancellation once flight has departed', () => {
        const outcome = cancellationOutcome({
            status: 'CONFIRMED',
            isRewardBooking: true,
            pointsRedeemed: 40000,
            totalPriceCents: 1010,
            departsAt: inHours(-1),
            legFareCents: [25000],
            cabins: ['BUSINESS'],
        }, now);

        expect(outcome.allowed).toBe(false);
        expect(outcome.reason).toBe('ALREADY_DEPARTED');
        expect(outcome.pointsRedeposited).toBe(0);
        expect(outcome.refundCents).toBe(0);
    });

    it('preserves isRewardBooking and pointsRedeemed in cancellableBooking adapter', () => {
        const booking = cancellableBooking({
            status: 'CONFIRMED',
            totalPriceCents: 1010,
            isRewardBooking: true,
            pointsRedeemed: 40000,
            legs: [{
                flight: { priceCents: 25000, departureDate: inHours(48) },
                seatAssignments: [{ cabinClass: 'BUSINESS' }],
            }],
        });

        expect(booking.isRewardBooking).toBe(true);
        expect(booking.pointsRedeemed).toBe(40000);
        expect(booking.totalPriceCents).toBe(1010);
    });
});
