import type { CabinClass, Flight, FlightStatus } from '@prisma/client';
import { airportTimeZoneFor } from '@/lib/airports';
import { addDaysToIsoDate } from '@/lib/dates';
import { flightRouteInclude, withRouteLabels } from '@/lib/flightRoute';
import { airportDayBounds, flightDeparture } from '@/lib/flightTime';
import { prisma } from '@/lib/prisma';
import { heldSeats } from '@/lib/seatOccupancy';

export const REPLACEMENT_SEARCH_DAY_RADIUS = 3;

export interface ReplacementFlightOption {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureDate: Date;
    durationMinutes: number | null;
    status: FlightStatus;
    firstClassRows: number | null;
    businessRows: number | null;
    premiumEconomyRows: number | null;
    economyRows: number | null;
    seatPattern: string | null;
}

export interface ReplacementFlightGroup {
    fromLegId: number;
    originalFlightNumber: string;
    originalDepartureDate: Date;
    from: string;
    to: string;
    flights: ReplacementFlightOption[];
}

interface ReplacementSearchInput {
    bookingId: number;
    userId: string;
}

const CABIN_ROWS: Record<CabinClass, keyof Pick<
    Flight,
    'firstClassRows' | 'businessRows' | 'premiumEconomyRows' | 'economyRows'
>> = {
    FIRST: 'firstClassRows',
    BUSINESS: 'businessRows',
    PREMIUM_ECONOMY: 'premiumEconomyRows',
    ECONOMY: 'economyRows',
};

type ReplacementCandidate = Pick<Flight,
    | 'id'
    | 'flightNumber'
    | 'airline'
    | 'departureDate'
    | 'durationMinutes'
    | 'status'
    | 'firstClassRows'
    | 'businessRows'
    | 'premiumEconomyRows'
    | 'economyRows'
    | 'seatPattern'
> & {
    fromAirport: { label: string };
    toAirport: { label: string };
};

const replacementFlightSelect = {
    id: true,
    flightNumber: true,
    airline: true,
    departureDate: true,
    durationMinutes: true,
    status: true,
    firstClassRows: true,
    businessRows: true,
    premiumEconomyRows: true,
    economyRows: true,
    seatPattern: true,
    ...flightRouteInclude,
} as const;

function supportsCabins(
    flight: Pick<Flight, typeof CABIN_ROWS[CabinClass]>,
    requiredCabins: ReadonlySet<CabinClass>,
): boolean {
    return [...requiredCabins].every(cabin => (flight[CABIN_ROWS[cabin]] ?? 1) > 0);
}

function toReplacementFlightOption(flight: ReplacementCandidate): ReplacementFlightOption {
    const routed = withRouteLabels(flight);
    return {
        id: routed.id,
        flightNumber: routed.flightNumber,
        airline: routed.airline,
        from: routed.from,
        to: routed.to,
        departureDate: routed.departureDate,
        durationMinutes: routed.durationMinutes,
        status: routed.status,
        firstClassRows: routed.firstClassRows,
        businessRows: routed.businessRows,
        premiumEconomyRows: routed.premiumEconomyRows,
        economyRows: routed.economyRows,
        seatPattern: routed.seatPattern,
    };
}

export class ItineraryReplacementSearch {
    async forBooking(input: ReplacementSearchInput): Promise<ReplacementFlightGroup[]> {
        const [booking, clock] = await Promise.all([
            prisma.booking.findFirst({
                where: {
                    id: input.bookingId,
                    userId: input.userId,
                    status: 'DISRUPTED',
                },
                select: {
                    passengers: { select: { id: true } },
                    legs: {
                        where: {
                            supersededAt: null,
                            flight: { status: 'CANCELLED' },
                        },
                        include: {
                            flight: { include: flightRouteInclude },
                            seatAssignments: {
                                where: heldSeats(),
                                select: { cabinClass: true },
                            },
                        },
                        orderBy: { sequence: 'asc' },
                    },
                },
            }),
            prisma.$queryRaw<Array<{ now: Date }>>`
                SELECT statement_timestamp() AS "now"
            `,
        ]);
        if (!booking || !clock[0]) return [];

        return Promise.all(booking.legs.map(async leg => {
            const original = withRouteLabels(leg.flight);
            const originalLocalDate = flightDeparture(original).date;
            const timeZone = airportTimeZoneFor(original.from);
            const startDate = addDaysToIsoDate(
                originalLocalDate,
                -REPLACEMENT_SEARCH_DAY_RADIUS,
            );
            const endDate = addDaysToIsoDate(
                originalLocalDate,
                REPLACEMENT_SEARCH_DAY_RADIUS,
            );
            const { start } = airportDayBounds(startDate, timeZone);
            const { end } = airportDayBounds(endDate, timeZone);
            const requiredCabins = new Set(
                leg.seatAssignments.map(assignment => assignment.cabinClass),
            );

            const candidates = leg.seatAssignments.length === booking.passengers.length
                ? await prisma.flight.findMany({
                    where: {
                        id: { not: original.id },
                        fromAirportCode: original.fromAirportCode,
                        toAirportCode: original.toAirportCode,
                        status: { not: 'CANCELLED' },
                        departureDate: {
                            gte: start,
                            gt: clock[0].now,
                            lt: end,
                        },
                    },
                    select: replacementFlightSelect,
                    orderBy: { departureDate: 'asc' },
                })
                : [];

            return {
                fromLegId: leg.id,
                originalFlightNumber: original.flightNumber,
                originalDepartureDate: original.departureDate,
                from: original.from,
                to: original.to,
                flights: candidates
                    .filter(flight => supportsCabins(flight, requiredCabins))
                    .map(toReplacementFlightOption),
            };
        }));
    }
}
