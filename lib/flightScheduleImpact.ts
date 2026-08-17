import type { FlightStatus } from '@prisma/client';
import { flightRouteInclude, withRouteLabels } from '@/lib/flightRoute';
import { prisma } from '@/lib/prisma';

export type ScheduleOccurrenceEligibility =
    | 'SAFE_FUTURE'
    | 'HISTORICAL'
    | 'BOOKING_HISTORY'
    | 'ACTIVE_CHECKOUT'
    | 'OPERATIONAL_OVERRIDE';

interface ScheduleOccurrencePolicyInput {
    departureDate: Date;
    status: FlightStatus;
    bookingIds: number[];
    hasActiveCheckout: boolean;
}

export interface ScheduleImpactSummary {
    total: number;
    safeFuture: number;
    protected: number;
    historical: number;
    bookingHistory: number;
    activeCheckout: number;
    operationalOverride: number;
}

export interface ScheduleImpactOccurrence extends ScheduleOccurrencePolicyInput {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    durationMinutes: number | null;
    priceCents: number;
    eligibility: ScheduleOccurrenceEligibility;
}

export interface FlightScheduleImpact {
    asOf: Date;
    schedule: {
        id: number;
        flightNumber: string;
        airline: string;
        from: string;
        to: string;
        durationMinutes: number;
        priceCents: number;
    };
    summary: ScheduleImpactSummary;
    occurrences: ScheduleImpactOccurrence[];
}

/**
 * The preview policy is deliberately stricter than a future-date check.
 *
 * A customer may already have been promised this exact occurrence through a
 * booking or an in-progress checkout, and an operational status is itself a
 * staff override. Those rows are protected even when departure is in the
 * future. Historical wins first so the five categories remain mutually
 * exclusive and their counts add back to the linked total.
 */
export function classifyScheduleOccurrence(
    occurrence: ScheduleOccurrencePolicyInput,
    asOf: Date,
): ScheduleOccurrenceEligibility {
    if (occurrence.departureDate.getTime() <= asOf.getTime()) return 'HISTORICAL';
    if (occurrence.bookingIds.length > 0) return 'BOOKING_HISTORY';
    if (occurrence.hasActiveCheckout) return 'ACTIVE_CHECKOUT';
    if (occurrence.status !== 'ON_TIME') return 'OPERATIONAL_OVERRIDE';
    return 'SAFE_FUTURE';
}

export function summarizeScheduleImpact(
    eligibility: ScheduleOccurrenceEligibility[],
): ScheduleImpactSummary {
    const summary: ScheduleImpactSummary = {
        total: eligibility.length,
        safeFuture: 0,
        protected: 0,
        historical: 0,
        bookingHistory: 0,
        activeCheckout: 0,
        operationalOverride: 0,
    };

    for (const category of eligibility) {
        if (category === 'SAFE_FUTURE') {
            summary.safeFuture += 1;
            continue;
        }

        summary.protected += 1;
        if (category === 'HISTORICAL') summary.historical += 1;
        if (category === 'BOOKING_HISTORY') summary.bookingHistory += 1;
        if (category === 'ACTIVE_CHECKOUT') summary.activeCheckout += 1;
        if (category === 'OPERATIONAL_OVERRIDE') summary.operationalOverride += 1;
    }

    return summary;
}

export class FlightScheduleImpactService {
    async forSchedule(scheduleId: number): Promise<FlightScheduleImpact | null> {
        // Use the database clock for both hold liveness and the historical
        // boundary. Application and database clocks can disagree, and a
        // preview must not describe the same row as safe and held at once.
        const clock = await prisma.$queryRaw<Array<{ now: Date }>>`
            SELECT statement_timestamp() AS "now"
        `;
        if (!clock[0]) throw new Error('Could not establish the schedule impact preview time.');
        const asOf = clock[0].now;

        const stored = await prisma.flightSchedule.findUnique({
            where: { id: scheduleId },
            select: {
                id: true,
                flightNumber: true,
                airline: true,
                from: true,
                to: true,
                durationMinutes: true,
                priceCents: true,
                flights: {
                    orderBy: { departureDate: 'asc' },
                    select: {
                        id: true,
                        flightNumber: true,
                        airline: true,
                        departureDate: true,
                        durationMinutes: true,
                        priceCents: true,
                        status: true,
                        ...flightRouteInclude,
                        itineraryLegs: { select: { bookingId: true } },
                        seatHolds: {
                            where: { expiresAt: { gt: asOf } },
                            select: { id: true },
                            take: 1,
                        },
                    },
                },
            },
        });
        if (!stored) return null;

        const { flights, ...schedule } = stored;
        const occurrences = flights.map((flight): ScheduleImpactOccurrence => {
            const routed = withRouteLabels(flight);
            const bookingIds = [...new Set(routed.itineraryLegs.map(leg => leg.bookingId))]
                .sort((left, right) => left - right);
            const hasActiveCheckout = routed.seatHolds.length > 0;
            const policyInput = {
                departureDate: routed.departureDate,
                status: routed.status,
                bookingIds,
                hasActiveCheckout,
            };

            return {
                id: routed.id,
                flightNumber: routed.flightNumber,
                airline: routed.airline,
                from: routed.from,
                to: routed.to,
                departureDate: routed.departureDate,
                durationMinutes: routed.durationMinutes,
                priceCents: routed.priceCents,
                status: routed.status,
                bookingIds,
                hasActiveCheckout,
                eligibility: classifyScheduleOccurrence(policyInput, asOf),
            };
        });

        return {
            asOf,
            schedule,
            summary: summarizeScheduleImpact(occurrences.map(({ eligibility }) => eligibility)),
            occurrences,
        };
    }
}
