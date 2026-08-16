/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import type { CabinClass, FlightStatus } from '@prisma/client';
import { airportCodesForRoute } from '@/lib/airports';
import { ItineraryRebookingService } from '@/lib/itineraryRebookingService';
import { ItineraryReplacementSearch } from '@/lib/itineraryReplacementSearch';
import { prisma } from '@/lib/prisma';

const created = {
    bookingIds: [] as number[],
    flightIds: [] as number[],
    userIds: [] as string[],
};

async function createUser(label: string) {
    const user = await prisma.user.create({
        data: {
            name: label,
            email: `replacement-search-${randomUUID()}@example.com`,
            password: 'not-used',
            emailVerified: new Date(),
        },
    });
    created.userIds.push(user.id);
    return user;
}

async function createFlight({
    suffix,
    from = 'Seattle, USA',
    to = 'Detroit, USA',
    departureDate = '2099-06-15T20:00:00.000Z',
    status = 'ON_TIME',
    businessRows,
}: {
    suffix: string;
    from?: string;
    to?: string;
    departureDate?: string;
    status?: FlightStatus;
    businessRows?: number | null;
}) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `RPS-${suffix}-${randomUUID().slice(0, 6)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute(from, to),
            departureDate: new Date(departureDate),
            priceCents: 45_000,
            status,
            economyRows: 20,
            businessRows,
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

async function createBooking({
    userId,
    from = 'Seattle, USA',
    to = 'Detroit, USA',
    departureDate = '2099-06-15T20:00:00.000Z',
    status = 'DISRUPTED' as const,
    cabins = ['ECONOMY', 'BUSINESS'] as CabinClass[],
}: {
    userId: string;
    from?: string;
    to?: string;
    departureDate?: string;
    status?: 'CONFIRMED' | 'DISRUPTED';
    cabins?: CabinClass[];
}) {
    const original = await createFlight({
        suffix: 'ORIGINAL',
        from,
        to,
        departureDate,
        status: 'CANCELLED',
    });
    const passengerIds = cabins.map(() => randomUUID());
    const booking = await prisma.booking.create({
        data: {
            userId,
            status,
            passengers: {
                create: passengerIds.map((id, index) => ({
                    id,
                    firstName: `Passenger ${index + 1}`,
                    lastName: 'Search',
                    gender: 'Unspecified',
                    sensitiveDataDeletedAt: new Date(),
                })),
            },
            legs: { create: [{ sequence: 1, flightId: original.id }] },
        },
        include: { legs: true },
    });
    created.bookingIds.push(booking.id);
    await prisma.seatAssignment.createMany({
        data: passengerIds.map((passengerId, index) => ({
            passengerId,
            legId: booking.legs[0].id,
            flightId: original.id,
            seatNumber: index === 0 ? '14A' : '4B',
            cabinClass: cabins[index],
        })),
    });
    return { booking, original, passengerIds, leg: booking.legs[0] };
}

async function addLeg({
    bookingId,
    flightId,
    passengerIds,
    sequence,
}: {
    bookingId: number;
    flightId: number;
    passengerIds: string[];
    sequence: number;
}) {
    const leg = await prisma.itineraryLeg.create({
        data: { bookingId, flightId, sequence },
    });
    await prisma.seatAssignment.createMany({
        data: passengerIds.map((passengerId, index) => ({
            passengerId,
            legId: leg.id,
            flightId,
            seatNumber: index === 0 ? '15A' : '5B',
            cabinClass: index === 0 ? 'ECONOMY' : 'BUSINESS',
        })),
    });
    return leg;
}

afterEach(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    created.bookingIds.length = 0;
    created.flightIds.length = 0;
    created.userIds.length = 0;
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('ItineraryReplacementSearch', () => {
    it('returns future operating flights on the same route within three local days', async () => {
        const user = await createUser('Route Owner');
        const scenario = await createBooking({ userId: user.id });
        const later = await createFlight({
            suffix: 'LATER',
            departureDate: '2099-06-18T20:00:00.000Z',
        });
        const earlier = await createFlight({
            suffix: 'EARLIER',
            departureDate: '2099-06-12T20:00:00.000Z',
        });
        const sameDay = await createFlight({
            suffix: 'SAME-DAY',
            departureDate: '2099-06-15T22:00:00.000Z',
        });
        await createFlight({
            suffix: 'OUTSIDE-EARLY',
            departureDate: '2099-06-11T20:00:00.000Z',
        });
        await createFlight({
            suffix: 'OUTSIDE-LATE',
            departureDate: '2099-06-19T20:00:00.000Z',
        });
        await createFlight({
            suffix: 'CANCELLED',
            departureDate: '2099-06-16T20:00:00.000Z',
            status: 'CANCELLED',
        });
        await createFlight({
            suffix: 'WRONG-DESTINATION',
            to: 'Paris, France',
            departureDate: '2099-06-16T20:00:00.000Z',
        });
        await createFlight({
            suffix: 'WRONG-ORIGIN',
            from: 'Miami, USA',
            departureDate: '2099-06-16T20:00:00.000Z',
        });

        const result = await new ItineraryReplacementSearch().forBooking({
            bookingId: scenario.booking.id,
            userId: user.id,
        });

        expect(result).toEqual([{
            fromLegId: scenario.leg.id,
            originalFlightNumber: scenario.original.flightNumber,
            originalDepartureDate: scenario.original.departureDate,
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            flights: [earlier, sameDay, later].map(flight => expect.objectContaining({
                id: flight.id,
                flightNumber: flight.flightNumber,
                from: 'Seattle, USA',
                to: 'Detroit, USA',
            })),
        }]);
    });

    it('anchors the window to the origin airport calendar day', async () => {
        const user = await createUser('Local Date Owner');
        const scenario = await createBooking({
            userId: user.id,
            from: 'Miami, USA',
            to: 'Rio de Janeiro, Brazil',
            // June 14 at 22:00 in Miami, though the UTC date is June 15.
            departureDate: '2099-06-15T02:00:00.000Z',
            cabins: ['ECONOMY'],
        });
        const withinLocalWindow = await createFlight({
            suffix: 'LOCAL-PLUS-THREE',
            from: 'Miami, USA',
            to: 'Rio de Janeiro, Brazil',
            departureDate: '2099-06-18T02:00:00.000Z',
        });
        await createFlight({
            suffix: 'LOCAL-PLUS-FOUR',
            from: 'Miami, USA',
            to: 'Rio de Janeiro, Brazil',
            departureDate: '2099-06-19T02:00:00.000Z',
        });

        const [group] = await new ItineraryReplacementSearch().forBooking({
            bookingId: scenario.booking.id,
            userId: user.id,
        });

        expect(group.flights.map(flight => flight.id)).toEqual([withinLocalWindow.id]);
    });

    it('offers only flights that carry every passenger cabin', async () => {
        const user = await createUser('Cabin Owner');
        const scenario = await createBooking({ userId: user.id });
        const compatible = await createFlight({ suffix: 'CABIN-YES', businessRows: 4 });
        const legacyCompatible = await createFlight({ suffix: 'CABIN-LEGACY', businessRows: null });
        await createFlight({ suffix: 'CABIN-NO', businessRows: 0 });

        const [group] = await new ItineraryReplacementSearch().forBooking({
            bookingId: scenario.booking.id,
            userId: user.id,
        });

        expect(group.flights.map(flight => flight.id)).toEqual([
            compatible.id,
            legacyCompatible.id,
        ]);
    });

    it('does not disclose options for another customer or a confirmed booking', async () => {
        const owner = await createUser('Booking Owner');
        const stranger = await createUser('Other Customer');
        const disrupted = await createBooking({ userId: owner.id });
        const confirmed = await createBooking({ userId: owner.id, status: 'CONFIRMED' });
        await createFlight({ suffix: 'PRIVATE-OPTION' });

        const search = new ItineraryReplacementSearch();
        await expect(search.forBooking({
            bookingId: disrupted.booking.id,
            userId: stranger.id,
        })).resolves.toEqual([]);
        await expect(search.forBooking({
            bookingId: confirmed.booking.id,
            userId: owner.id,
        })).resolves.toEqual([]);
    });

    it('does not offer a replacement that has already departed', async () => {
        const user = await createUser('Past Owner');
        const scenario = await createBooking({
            userId: user.id,
            departureDate: '2000-06-15T20:00:00.000Z',
            cabins: ['ECONOMY'],
        });
        await createFlight({
            suffix: 'PAST-OPTION',
            departureDate: '2000-06-16T20:00:00.000Z',
        });

        await expect(new ItineraryReplacementSearch().forBooking({
            bookingId: scenario.booking.id,
            userId: user.id,
        })).resolves.toEqual([expect.objectContaining({ flights: [] })]);
    });

    it('returns one ordered group for every active cancelled leg', async () => {
        const user = await createUser('Multi Leg Owner');
        const scenario = await createBooking({ userId: user.id });
        const inbound = await createFlight({
            suffix: 'INBOUND-ORIGINAL',
            from: 'Detroit, USA',
            to: 'Seattle, USA',
            departureDate: '2099-06-22T20:00:00.000Z',
            status: 'CANCELLED',
        });
        const inboundLeg = await addLeg({
            bookingId: scenario.booking.id,
            flightId: inbound.id,
            passengerIds: scenario.passengerIds,
            sequence: 2,
        });
        const outboundOption = await createFlight({
            suffix: 'OUTBOUND-OPTION',
            departureDate: '2099-06-16T20:00:00.000Z',
            businessRows: 4,
        });
        const inboundOption = await createFlight({
            suffix: 'INBOUND-OPTION',
            from: 'Detroit, USA',
            to: 'Seattle, USA',
            departureDate: '2099-06-23T20:00:00.000Z',
            businessRows: 4,
        });

        const result = await new ItineraryReplacementSearch().forBooking({
            bookingId: scenario.booking.id,
            userId: user.id,
        });

        expect(result.map(group => ({
            fromLegId: group.fromLegId,
            flightIds: group.flights.map(flight => flight.id),
        }))).toEqual([
            { fromLegId: scenario.leg.id, flightIds: [outboundOption.id] },
            { fromLegId: inboundLeg.id, flightIds: [inboundOption.id] },
        ]);
    });

    it('does not create a replacement group for an active operating leg', async () => {
        const user = await createUser('Partially Disrupted Owner');
        const scenario = await createBooking({ userId: user.id });
        const operatingInbound = await createFlight({
            suffix: 'OPERATING-INBOUND',
            from: 'Detroit, USA',
            to: 'Seattle, USA',
            departureDate: '2099-06-22T20:00:00.000Z',
        });
        await addLeg({
            bookingId: scenario.booking.id,
            flightId: operatingInbound.id,
            passengerIds: scenario.passengerIds,
            sequence: 2,
        });
        const outboundOption = await createFlight({
            suffix: 'ONLY-CANCELLED-LEG-OPTION',
            departureDate: '2099-06-16T20:00:00.000Z',
            businessRows: 4,
        });

        const result = await new ItineraryReplacementSearch().forBooking({
            bookingId: scenario.booking.id,
            userId: user.id,
        });

        expect(result).toHaveLength(1);
        expect(result[0].fromLegId).toBe(scenario.leg.id);
        expect(result[0].flights.map(flight => flight.id)).toEqual([outboundOption.id]);
    });

    it('does not present a leg as replaceable when any passenger lacks a held seat', async () => {
        const user = await createUser('Incomplete Seats Owner');
        const scenario = await createBooking({ userId: user.id });
        await prisma.seatAssignment.deleteMany({
            where: { passengerId: scenario.passengerIds[1], legId: scenario.leg.id },
        });
        await createFlight({ suffix: 'INCOMPLETE-SEATS-OPTION', businessRows: 4 });

        await expect(new ItineraryReplacementSearch().forBooking({
            bookingId: scenario.booking.id,
            userId: user.id,
        })).resolves.toEqual([expect.objectContaining({ flights: [] })]);
    });

    it('does not count a released assignment as a passenger seat', async () => {
        const user = await createUser('Released Seat Owner');
        const scenario = await createBooking({ userId: user.id });
        await prisma.seatAssignment.updateMany({
            where: { passengerId: scenario.passengerIds[1], legId: scenario.leg.id },
            data: { releasedAt: new Date() },
        });
        await createFlight({ suffix: 'RELEASED-SEAT-OPTION', businessRows: 4 });

        await expect(new ItineraryReplacementSearch().forBooking({
            bookingId: scenario.booking.id,
            userId: user.id,
        })).resolves.toEqual([expect.objectContaining({ flights: [] })]);
    });

    it('ignores a superseded cancelled leg after a later disruption', async () => {
        const user = await createUser('Rebooked Owner');
        const scenario = await createBooking({ userId: user.id });
        const firstReplacement = await createFlight({
            suffix: 'FIRST-REPLACEMENT',
            departureDate: '2099-06-16T20:00:00.000Z',
            businessRows: 4,
        });
        const rebooking = await new ItineraryRebookingService().rebook({
            bookingId: scenario.booking.id,
            replacements: [{
                fromLegId: scenario.leg.id,
                replacementFlightId: firstReplacement.id,
                seats: [
                    { passengerId: scenario.passengerIds[0], seatNumber: '14C' },
                    { passengerId: scenario.passengerIds[1], seatNumber: '4D' },
                ],
            }],
        });
        await prisma.flight.update({
            where: { id: firstReplacement.id },
            data: { status: 'CANCELLED' },
        });
        await prisma.booking.update({
            where: { id: scenario.booking.id },
            data: { status: 'DISRUPTED' },
        });
        const nextOption = await createFlight({
            suffix: 'NEXT-OPTION',
            departureDate: '2099-06-17T20:00:00.000Z',
            businessRows: 4,
        });

        const result = await new ItineraryReplacementSearch().forBooking({
            bookingId: scenario.booking.id,
            userId: user.id,
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            fromLegId: rebooking.replacements[0].toLegId,
            originalFlightNumber: firstReplacement.flightNumber,
        });
        expect(result[0].flights.map(flight => flight.id)).toEqual([nextOption.id]);
    });
});
