import { prisma } from '@/lib/prisma';
import { flightRouteInclude, withRouteLabels } from '@/lib/flightRoute';
import { flightPhaseAt, type FlightPhase } from '@/lib/flightPhase';
import { getEffectiveFlightGates, type EffectiveFlightGates } from '@/lib/flightGates';
import { airportDayBounds, durationLabel, flightArrival, flightDeparture, type LocalArrival, type LocalDeparture } from '@/lib/flightTime';
import { airportTimeZoneFor } from '@/lib/airports';
import type { FlightStatusSearchInput } from '@/lib/validation';
import type { FlightStatus, Prisma } from '@prisma/client';

export interface FlightStatusResult {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    fromAirportCode: string;
    toAirportCode: string;
    departureDate: string;
    durationMinutes: number | null;
    durationFormatted: string;
    status: FlightStatus;
    phase: FlightPhase;
    delayReason: string | null;
    estimatedDeparture: string | null;
    actualDeparture: string | null;
    estimatedArrival: string | null;
    actualArrival: string | null;
    departure: LocalDeparture;
    arrival: LocalArrival | null;
    gates: EffectiveFlightGates;
}

export class FlightStatusService {
    static async searchFlightStatus(
        input: FlightStatusSearchInput,
        renderedAt: number
    ): Promise<FlightStatusResult[]> {
        const whereClause: Prisma.FlightWhereInput = {};

        if (input.mode === 'flightNumber') {
            const cleanNumber = input.flightNumber.replace(/\s+/g, '').toUpperCase();
            whereClause.flightNumber = {
                equals: cleanNumber,
                mode: 'insensitive',
            };

            if (input.date) {
                // Find airport zone for bounding search or default to UTC
                const candidate = await prisma.flight.findFirst({
                    where: { flightNumber: { equals: cleanNumber, mode: 'insensitive' } },
                    select: { fromAirportCode: true },
                });
                const zone = (candidate ? airportTimeZoneFor(candidate.fromAirportCode) : null) ?? 'UTC';
                const { start, end } = airportDayBounds(input.date, zone);
                whereClause.departureDate = { gte: start, lte: end };
            } else {
                whereClause.departureDate = {
                    gte: new Date(renderedAt - 24 * 60 * 60 * 1000),
                    lte: new Date(renderedAt + 48 * 60 * 60 * 1000),
                };
            }
        } else {
            whereClause.fromAirportCode = input.from.toUpperCase();
            whereClause.toAirportCode = input.to.toUpperCase();

            const zone = airportTimeZoneFor(input.from) ?? 'UTC';
            const dateStr = input.date || new Date(renderedAt).toISOString().slice(0, 10);
            const { start, end } = airportDayBounds(dateStr, zone);
            whereClause.departureDate = { gte: start, lte: end };
        }

        const flights = await prisma.flight.findMany({
            where: whereClause,
            orderBy: { departureDate: 'asc' },
            take: 50,
            include: flightRouteInclude,
        });

        return flights.map((flight) => {
            const routed = withRouteLabels(flight);
            const dep = flightDeparture(routed);
            const arr = routed.durationMinutes ? flightArrival({
                departureDate: routed.departureDate,
                durationMinutes: routed.durationMinutes,
                from: routed.from,
                to: routed.to,
            }) : null;

            const phase = flightPhaseAt(flight, renderedAt);
            const gates = getEffectiveFlightGates(flight);

            return {
                id: routed.id,
                flightNumber: routed.flightNumber,
                airline: routed.airline,
                from: routed.from,
                to: routed.to,
                fromAirportCode: flight.fromAirportCode,
                toAirportCode: flight.toAirportCode,
                departureDate: routed.departureDate.toISOString(),
                durationMinutes: routed.durationMinutes,
                durationFormatted: routed.durationMinutes ? durationLabel(routed.durationMinutes) : 'N/A',
                status: routed.status,
                phase,
                delayReason: flight.delayReason,
                estimatedDeparture: flight.estimatedDeparture?.toISOString() || null,
                actualDeparture: flight.actualDeparture?.toISOString() || null,
                estimatedArrival: flight.estimatedArrival?.toISOString() || null,
                actualArrival: flight.actualArrival?.toISOString() || null,
                departure: dep,
                arrival: arr,
                gates,
            };
        });
    }
}
