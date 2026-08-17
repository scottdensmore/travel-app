/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { airportCodesForRoute } from '@/lib/airports';
import { lockBookingForUpdate, lockFlightForUpdate } from '@/lib/flightLock';
import {
    ItineraryRebookingError,
    ItineraryRebookingService,
} from '@/lib/itineraryRebookingService';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/flightLock', () => {
    const actual = jest.requireActual<typeof import('@/lib/flightLock')>('@/lib/flightLock');
    return {
        ...actual,
        lockBookingForUpdate: jest.fn(actual.lockBookingForUpdate),
        lockFlightForUpdate: jest.fn(actual.lockFlightForUpdate),
    };
});

const created = {
    bookingIds: [] as number[],
    flightIds: [] as number[],
    userIds: [] as string[],
};

async function createFlight({
    suffix,
    from = 'Seattle, USA',
    to = 'Detroit, USA',
    departureDate = '2099-05-10T16:00:00.000Z',
    priceCents = 30_000,
    status = 'ON_TIME' as const,
}: {
    suffix: string;
    from?: string;
    to?: string;
    departureDate?: string;
    priceCents?: number;
    status?: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
}) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `RBS-${suffix}-${randomUUID().slice(0, 6)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute(from, to),
            departureDate: new Date(departureDate),
            priceCents,
            status,
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

async function createDisruptedBooking() {
    const originalFlight = await createFlight({ suffix: 'OLD', status: 'CANCELLED' });
    const passengerIds = [randomUUID(), randomUUID()];
    const paymentIntentId = `pi_rebook_service_${randomUUID()}`;
    const booking = await prisma.booking.create({
        data: {
            status: 'DISRUPTED',
            paymentIntentId,
            totalPriceCents: 55_000,
            currency: 'USD',
            passengers: {
                create: passengerIds.map((id, index) => ({
                    id,
                    firstName: index === 0 ? 'Ada' : 'Grace',
                    lastName: index === 0 ? 'Lovelace' : 'Hopper',
                    gender: 'Female',
                    sensitiveDataDeletedAt: new Date(),
                })),
            },
            legs: { create: [{ sequence: 1, flightId: originalFlight.id }] },
        },
        include: { legs: true },
    });
    created.bookingIds.push(booking.id);
    await prisma.seatAssignment.createMany({
        data: [
            {
                passengerId: passengerIds[0],
                legId: booking.legs[0].id,
                flightId: originalFlight.id,
                seatNumber: '11A',
                cabinClass: 'ECONOMY',
            },
            {
                passengerId: passengerIds[1],
                legId: booking.legs[0].id,
                flightId: originalFlight.id,
                seatNumber: '5B',
                cabinClass: 'BUSINESS',
            },
        ],
    });
    return { booking, originalFlight, oldLeg: booking.legs[0], passengerIds };
}

async function addLeg(
    bookingId: number,
    flightId: number,
    sequence: number,
    passengerIds: string[],
) {
    const leg = await prisma.itineraryLeg.create({
        data: { bookingId, flightId, sequence },
    });
    await prisma.seatAssignment.createMany({
        data: [
            {
                passengerId: passengerIds[0],
                legId: leg.id,
                flightId,
                seatNumber: '12A',
                cabinClass: 'ECONOMY',
            },
            {
                passengerId: passengerIds[1],
                legId: leg.id,
                flightId,
                seatNumber: '6B',
                cabinClass: 'BUSINESS',
            },
        ],
    });
    return leg;
}

function replacementRequest(
    scenario: Awaited<ReturnType<typeof createDisruptedBooking>>,
    replacementFlightId: number,
) {
    return {
        bookingId: scenario.booking.id,
        replacements: [{
            fromLegId: scenario.oldLeg.id,
            replacementFlightId,
            seats: [
                { passengerId: scenario.passengerIds[0], seatNumber: '14C' },
                { passengerId: scenario.passengerIds[1], seatNumber: '4D' },
            ],
        }],
    };
}

async function occupySeat(flightId: number, seatNumber: string) {
    const passengerId = randomUUID();
    const booking = await prisma.booking.create({
        data: {
            passengers: {
                create: [{
                    id: passengerId,
                    firstName: 'Katherine',
                    lastName: 'Johnson',
                    gender: 'Female',
                    sensitiveDataDeletedAt: new Date(),
                }],
            },
            legs: { create: [{ sequence: 1, flightId }] },
        },
        include: { legs: true },
    });
    created.bookingIds.push(booking.id);
    await prisma.seatAssignment.create({
        data: {
            passengerId,
            legId: booking.legs[0].id,
            flightId,
            seatNumber,
            cabinClass: 'ECONOMY',
        },
    });
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

describe('ItineraryRebookingService', () => {
    it('reports a missing booking without starting a replacement transaction', async () => {
        await expect(new ItineraryRebookingService().rebook({
            bookingId: 2_147_483_647,
            replacements: [],
        })).rejects.toEqual(new ItineraryRebookingError(
            'BOOKING_NOT_FOUND',
            'Booking not found.',
        ));
    });

    it('refuses a customer who does not own the booking after taking the lock', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'WRONG-OWNER',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        const owner = await prisma.user.create({
            data: {
                name: 'Booking Owner',
                email: `rebooking-owner-${randomUUID()}@example.com`,
                password: 'not-used',
            },
        });
        created.userIds.push(owner.id);
        await prisma.booking.update({
            where: { id: scenario.booking.id },
            data: { userId: owner.id },
        });

        await expect(new ItineraryRebookingService().rebook({
            ...replacementRequest(scenario, replacement.id),
            ownerUserId: randomUUID(),
        })).rejects.toEqual(new ItineraryRebookingError(
            'BOOKING_NOT_FOUND',
            'Booking not found.',
        ));
        expect(await prisma.booking.findUniqueOrThrow({
            where: { id: scenario.booking.id },
            select: { status: true, rebookings: true },
        })).toEqual({ status: 'DISRUPTED', rebookings: [] });
    });

    it('locks every flight in ascending order before locking and rereading the booking', async () => {
        const replacement = await createFlight({
            suffix: 'LOCK-FIRST',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        const scenario = await createDisruptedBooking();
        const flightLockSpy = jest.mocked(lockFlightForUpdate);
        const bookingLockSpy = jest.mocked(lockBookingForUpdate);
        flightLockSpy.mockClear();
        bookingLockSpy.mockClear();

        try {
            await new ItineraryRebookingService().rebook(
                replacementRequest(scenario, replacement.id),
            );

            expect(flightLockSpy.mock.calls.map(([, flightId]) => flightId)).toEqual(
                [scenario.originalFlight.id, replacement.id].sort((left, right) => left - right),
            );
            expect(bookingLockSpy).toHaveBeenCalledTimes(1);
            expect(bookingLockSpy).toHaveBeenCalledWith(
                expect.anything(),
                scenario.booking.id,
            );
            expect(Math.max(...flightLockSpy.mock.invocationCallOrder)).toBeLessThan(
                bookingLockSpy.mock.invocationCallOrder[0],
            );
        } finally {
            flightLockSpy.mockClear();
            bookingLockSpy.mockClear();
        }
    });

    it('holds the booking row until the locking transaction releases it', async () => {
        const scenario = await createDisruptedBooking();
        let announceLocked!: () => void;
        let releaseLock!: () => void;
        const locked = new Promise<void>(resolve => { announceLocked = resolve; });
        const release = new Promise<void>(resolve => { releaseLock = resolve; });
        const blockingTransaction = prisma.$transaction(async tx => {
            await lockBookingForUpdate(tx, scenario.booking.id);
            announceLocked();
            await release;
        });
        await locked;

        try {
            await expect(prisma.$transaction(async tx => {
                await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
                await lockBookingForUpdate(tx, scenario.booking.id);
            })).rejects.toThrow(/lock timeout/);
        } finally {
            releaseLock();
            await blockingTransaction;
        }
    });

    it('rechecks disruption state after waiting for a concurrent booking lock', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'BOOKING-LOCK-REREAD',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        let announceLocked!: () => void;
        let releaseLock!: () => void;
        const locked = new Promise<void>(resolve => { announceLocked = resolve; });
        const release = new Promise<void>(resolve => { releaseLock = resolve; });
        const concurrentResolution = prisma.$transaction(async tx => {
            await tx.$queryRaw`
                SELECT "id" FROM "Booking"
                WHERE "id" = ${scenario.booking.id}
                FOR UPDATE
            `;
            announceLocked();
            await release;
            await tx.booking.update({
                where: { id: scenario.booking.id },
                data: { status: 'CONFIRMED' },
            });
        });
        await locked;

        const bookingLockSpy = jest.mocked(lockBookingForUpdate);
        bookingLockSpy.mockClear();
        const attempted = new ItineraryRebookingService().rebook(
            replacementRequest(scenario, replacement.id),
        ).then(
            value => ({ value, error: null }),
            error => ({ value: null, error }),
        );
        while (bookingLockSpy.mock.calls.length === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }
        releaseLock();
        await concurrentResolution;

        expect(await attempted).toEqual({
            value: null,
            error: expect.objectContaining({ code: 'BOOKING_NOT_DISRUPTED' }),
        });
        expect(await prisma.booking.findUniqueOrThrow({
            where: { id: scenario.booking.id },
            include: { rebookings: true, legs: true },
        })).toMatchObject({
            status: 'CONFIRMED',
            rebookings: [],
            legs: [expect.objectContaining({ id: scenario.oldLeg.id, supersededAt: null })],
        });
    });

    it('atomically replaces a cancelled leg while preserving booking and fare identity', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'NEW',
            departureDate: '2099-05-11T16:00:00.000Z',
            priceCents: 90_000,
        });

        const result = await new ItineraryRebookingService().rebook({
            ...replacementRequest(scenario, replacement.id),
        });

        const saved = await prisma.booking.findUniqueOrThrow({
            where: { id: scenario.booking.id },
            include: {
                statusChanges: { orderBy: { sequence: 'asc' } },
                legs: {
                    include: { seatAssignments: { orderBy: { passengerId: 'asc' } } },
                    orderBy: { id: 'asc' },
                },
                rebookings: { include: { legs: true } },
            },
        });
        const historical = saved.legs.find(leg => leg.id === scenario.oldLeg.id)!;
        const active = saved.legs.find(leg => leg.id === result.replacements[0].toLegId)!;

        expect(result).toEqual({
            bookingId: scenario.booking.id,
            rebookingId: expect.any(String),
            status: 'CONFIRMED',
            replacements: [{
                fromLegId: scenario.oldLeg.id,
                toLegId: expect.any(Number),
                replacementFlightId: replacement.id,
            }],
        });
        expect(saved).toMatchObject({
            status: 'CONFIRMED',
            paymentIntentId: scenario.booking.paymentIntentId,
            totalPriceCents: 55_000,
            currency: 'USD',
        });
        expect(historical.supersededAt).toEqual(expect.any(Date));
        expect(historical.seatAssignments).toEqual(expect.arrayContaining([
            expect.objectContaining({ seatNumber: '11A', releasedAt: expect.any(Date) }),
            expect.objectContaining({ seatNumber: '5B', releasedAt: expect.any(Date) }),
        ]));
        expect(active).toMatchObject({
            sequence: scenario.oldLeg.sequence,
            flightId: replacement.id,
            supersededAt: null,
        });
        expect(active.seatAssignments).toEqual(expect.arrayContaining([
            expect.objectContaining({
                passengerId: scenario.passengerIds[0],
                seatNumber: '14C',
                cabinClass: 'ECONOMY',
                releasedAt: null,
            }),
            expect.objectContaining({
                passengerId: scenario.passengerIds[1],
                seatNumber: '4D',
                cabinClass: 'BUSINESS',
                releasedAt: null,
            }),
        ]));
        expect(saved.statusChanges.at(-1)).toMatchObject({
            from: 'DISRUPTED',
            to: 'CONFIRMED',
            reason: 'Rebooked after an airline cancellation.',
            refundCents: null,
            actorUserId: null,
        });
        expect(saved.rebookings).toEqual([
            expect.objectContaining({
                id: result.rebookingId,
                farePolicy: 'DISRUPTION_WAIVER',
                legs: [{
                    rebookingId: result.rebookingId,
                    fromLegId: scenario.oldLeg.id,
                    toLegId: result.replacements[0].toLegId,
                }],
            }),
        ]);
    });

    it('replaces only the cancelled position and leaves an operating leg unchanged', async () => {
        const scenario = await createDisruptedBooking();
        const continuing = await createFlight({
            suffix: 'RETURN',
            from: 'Detroit, USA',
            to: 'Seattle, USA',
            departureDate: '2099-05-20T16:00:00.000Z',
        });
        const continuingLeg = await addLeg(
            scenario.booking.id,
            continuing.id,
            2,
            scenario.passengerIds,
        );
        const replacement = await createFlight({
            suffix: 'NEW-OUTBOUND',
            departureDate: '2099-05-11T16:00:00.000Z',
        });

        await new ItineraryRebookingService().rebook(
            replacementRequest(scenario, replacement.id),
        );

        const active = await prisma.itineraryLeg.findMany({
            where: { bookingId: scenario.booking.id, supersededAt: null },
            orderBy: { sequence: 'asc' },
        });
        expect(active).toEqual([
            expect.objectContaining({ sequence: 1, flightId: replacement.id }),
            expect.objectContaining({ id: continuingLeg.id, sequence: 2, flightId: continuing.id }),
        ]);
    });

    it('replaces every cancelled leg under one status event and rebooking record', async () => {
        const scenario = await createDisruptedBooking();
        const cancelledReturn = await createFlight({
            suffix: 'CANCELLED-RETURN-ALL',
            from: 'Detroit, USA',
            to: 'Seattle, USA',
            departureDate: '2099-05-20T16:00:00.000Z',
            status: 'CANCELLED',
        });
        const oldReturnLeg = await addLeg(
            scenario.booking.id,
            cancelledReturn.id,
            2,
            scenario.passengerIds,
        );
        const [replacementOutbound, replacementReturn] = await Promise.all([
            createFlight({
                suffix: 'NEW-OUTBOUND-ALL',
                departureDate: '2099-05-11T16:00:00.000Z',
            }),
            createFlight({
                suffix: 'NEW-RETURN-ALL',
                from: 'Detroit, USA',
                to: 'Seattle, USA',
                departureDate: '2099-05-21T16:00:00.000Z',
            }),
        ]);

        const result = await new ItineraryRebookingService().rebook({
            bookingId: scenario.booking.id,
            replacements: [
                replacementRequest(scenario, replacementOutbound.id).replacements[0],
                {
                    fromLegId: oldReturnLeg.id,
                    replacementFlightId: replacementReturn.id,
                    seats: [
                        { passengerId: scenario.passengerIds[0], seatNumber: '15A' },
                        { passengerId: scenario.passengerIds[1], seatNumber: '5C' },
                    ],
                },
            ],
        });

        expect(result.replacements).toEqual([
            expect.objectContaining({
                fromLegId: scenario.oldLeg.id,
                replacementFlightId: replacementOutbound.id,
            }),
            expect.objectContaining({
                fromLegId: oldReturnLeg.id,
                replacementFlightId: replacementReturn.id,
            }),
        ]);
        expect(await prisma.bookingRebooking.count({
            where: { bookingId: scenario.booking.id },
        })).toBe(1);
        expect(await prisma.bookingRebookingLeg.count({
            where: { rebookingId: result.rebookingId },
        })).toBe(2);
        expect(await prisma.bookingStatusChange.count({
            where: {
                bookingId: scenario.booking.id,
                from: 'DISRUPTED',
                to: 'CONFIRMED',
            },
        })).toBe(1);
    });

    it('requires every cancelled active leg to be replaced in the same transaction', async () => {
        const scenario = await createDisruptedBooking();
        const secondCancelled = await createFlight({
            suffix: 'CANCELLED-RETURN',
            from: 'Detroit, USA',
            to: 'Seattle, USA',
            departureDate: '2099-05-20T16:00:00.000Z',
            status: 'CANCELLED',
        });
        await addLeg(
            scenario.booking.id,
            secondCancelled.id,
            2,
            scenario.passengerIds,
        );
        const replacement = await createFlight({
            suffix: 'ONLY-ONE-REPLACEMENT',
            departureDate: '2099-05-11T16:00:00.000Z',
        });

        await expect(new ItineraryRebookingService().rebook(
            replacementRequest(scenario, replacement.id),
        )).rejects.toMatchObject({
            code: 'REPLACEMENT_SET_INVALID',
            message: 'Every cancelled active leg must be replaced exactly once.',
        });

        expect(await prisma.booking.findUniqueOrThrow({
            where: { id: scenario.booking.id },
            select: { status: true, rebookings: true },
        })).toEqual({ status: 'DISRUPTED', rebookings: [] });
    });

    it('refuses to substitute an operating leg for a cancelled leg', async () => {
        const scenario = await createDisruptedBooking();
        const continuing = await createFlight({
            suffix: 'OPERATING-SOURCE',
            from: 'Detroit, USA',
            to: 'Seattle, USA',
            departureDate: '2099-05-20T16:00:00.000Z',
        });
        const continuingLeg = await addLeg(
            scenario.booking.id,
            continuing.id,
            2,
            scenario.passengerIds,
        );
        const replacement = await createFlight({
            suffix: 'OPERATING-SUBSTITUTE',
            from: 'Detroit, USA',
            to: 'Seattle, USA',
            departureDate: '2099-05-21T16:00:00.000Z',
        });

        await expect(new ItineraryRebookingService().rebook({
            bookingId: scenario.booking.id,
            replacements: [{
                ...replacementRequest(scenario, replacement.id).replacements[0],
                fromLegId: continuingLeg.id,
            }],
        })).rejects.toMatchObject({
            code: 'REPLACEMENT_SET_INVALID',
            message: 'Every cancelled active leg must be replaced exactly once.',
        });
    });

    it('refuses to reuse one replacement flight for two itinerary positions', async () => {
        const scenario = await createDisruptedBooking();
        const secondCancelled = await createFlight({
            suffix: 'SAME-ROUTE-SECOND',
            departureDate: '2099-05-12T16:00:00.000Z',
            status: 'CANCELLED',
        });
        const secondLeg = await addLeg(
            scenario.booking.id,
            secondCancelled.id,
            2,
            scenario.passengerIds,
        );
        const replacement = await createFlight({
            suffix: 'REUSED-REPLACEMENT',
            departureDate: '2099-05-13T16:00:00.000Z',
        });
        const seats = replacementRequest(scenario, replacement.id).replacements[0].seats;

        await expect(new ItineraryRebookingService().rebook({
            bookingId: scenario.booking.id,
            replacements: [
                replacementRequest(scenario, replacement.id).replacements[0],
                {
                    fromLegId: secondLeg.id,
                    replacementFlightId: replacement.id,
                    seats,
                },
            ],
        })).rejects.toMatchObject({
            code: 'REPLACEMENT_SET_INVALID',
            message: 'Each replacement leg must use a distinct flight.',
        });
    });

    it('refuses to replace one cancelled leg more than once', async () => {
        const scenario = await createDisruptedBooking();
        const [first, second] = await Promise.all([
            createFlight({
                suffix: 'DUPLICATE-LEG-A',
                departureDate: '2099-05-11T16:00:00.000Z',
            }),
            createFlight({
                suffix: 'DUPLICATE-LEG-B',
                departureDate: '2099-05-12T16:00:00.000Z',
            }),
        ]);

        await expect(new ItineraryRebookingService().rebook({
            bookingId: scenario.booking.id,
            replacements: [
                replacementRequest(scenario, first.id).replacements[0],
                replacementRequest(scenario, second.id).replacements[0],
            ],
        })).rejects.toMatchObject({
            code: 'REPLACEMENT_SET_INVALID',
            message: 'Every cancelled active leg must be replaced exactly once.',
        });
    });

    it('refuses a booking whose disruption has already been resolved', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'TOO-LATE',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        await prisma.booking.update({
            where: { id: scenario.booking.id },
            data: { status: 'CONFIRMED' },
        });

        await expect(new ItineraryRebookingService().rebook(
            replacementRequest(scenario, replacement.id),
        )).rejects.toEqual(new ItineraryRebookingError(
            'BOOKING_NOT_DISRUPTED',
            'Only a disrupted booking can be rebooked.',
        ));
    });

    it('refuses a replacement on a different route', async () => {
        const scenario = await createDisruptedBooking();
        const wrongRoute = await createFlight({
            suffix: 'WRONG-ROUTE',
            from: 'Seattle, USA',
            to: 'Paris, France',
            departureDate: '2099-05-11T16:00:00.000Z',
        });

        await expect(new ItineraryRebookingService().rebook(
            replacementRequest(scenario, wrongRoute.id),
        )).rejects.toMatchObject({ code: 'REPLACEMENT_FLIGHT_INVALID' });
    });

    it('refuses a replacement with the wrong origin and the same destination', async () => {
        const scenario = await createDisruptedBooking();
        const wrongOrigin = await createFlight({
            suffix: 'WRONG-ORIGIN',
            from: 'Miami, USA',
            to: 'Detroit, USA',
            departureDate: '2099-05-11T16:00:00.000Z',
        });

        await expect(new ItineraryRebookingService().rebook(
            replacementRequest(scenario, wrongOrigin.id),
        )).rejects.toMatchObject({
            code: 'REPLACEMENT_FLIGHT_INVALID',
            message: 'The replacement flight must be a future operating flight on the same route.',
        });
    });

    it('refuses a replacement flight that does not exist', async () => {
        const scenario = await createDisruptedBooking();

        await expect(new ItineraryRebookingService().rebook(
            replacementRequest(scenario, 2_147_483_647),
        )).rejects.toMatchObject({ code: 'REPLACEMENT_FLIGHT_INVALID' });
    });

    it('refuses a cancelled replacement flight', async () => {
        const scenario = await createDisruptedBooking();
        const cancelled = await createFlight({
            suffix: 'STILL-CANCELLED',
            departureDate: '2099-05-11T16:00:00.000Z',
            status: 'CANCELLED',
        });

        await expect(new ItineraryRebookingService().rebook(
            replacementRequest(scenario, cancelled.id),
        )).rejects.toMatchObject({ code: 'REPLACEMENT_FLIGHT_INVALID' });
    });

    it('refuses a replacement flight that has already departed', async () => {
        const scenario = await createDisruptedBooking();
        const departed = await createFlight({
            suffix: 'DEPARTED',
            departureDate: '2000-01-01T16:00:00.000Z',
        });

        await expect(new ItineraryRebookingService().rebook(
            replacementRequest(scenario, departed.id),
        )).rejects.toMatchObject({ code: 'REPLACEMENT_FLIGHT_INVALID' });
    });

    it('requires one replacement seat for every passenger', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'MISSING-SEAT',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        const request = replacementRequest(scenario, replacement.id);
        request.replacements[0].seats.pop();

        await expect(new ItineraryRebookingService().rebook(request)).rejects.toMatchObject({
            code: 'SEAT_SELECTION_INVALID',
            message: 'Select one replacement seat for every passenger.',
        });
    });

    it('refuses to select the same passenger twice', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'DUPLICATE-PASSENGER',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        const request = replacementRequest(scenario, replacement.id);
        request.replacements[0].seats[1] = {
            passengerId: scenario.passengerIds[0],
            seatNumber: '14D',
        };

        await expect(new ItineraryRebookingService().rebook(request)).rejects.toMatchObject({
            code: 'SEAT_SELECTION_INVALID',
            message: 'Select one replacement seat for every passenger.',
        });
    });

    it('refuses a passenger from another booking in the seat selection', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'FOREIGN-PASSENGER',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        const request = replacementRequest(scenario, replacement.id);
        request.replacements[0].seats[1].passengerId = randomUUID();

        await expect(new ItineraryRebookingService().rebook(request)).rejects.toMatchObject({
            code: 'SEAT_SELECTION_INVALID',
            message: 'Select one replacement seat for every passenger.',
        });
    });

    it('preserves each passenger cabin instead of trusting a seat in another cabin', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'WRONG-CABIN',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        const request = replacementRequest(scenario, replacement.id);
        request.replacements[0].seats[1].seatNumber = '14D';

        await expect(new ItineraryRebookingService().rebook(request)).rejects.toMatchObject({
            code: 'SEAT_SELECTION_INVALID',
            message: "Seat 14D is not available in the passenger's booked cabin.",
        });
    });

    it('refuses to assign the same replacement seat to two passengers', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'DUPLICATE-SEAT',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        await prisma.seatAssignment.updateMany({
            where: {
                legId: scenario.oldLeg.id,
                passengerId: scenario.passengerIds[1],
            },
            data: { cabinClass: 'ECONOMY' },
        });
        const request = replacementRequest(scenario, replacement.id);
        request.replacements[0].seats[1].seatNumber = '14C';

        await expect(new ItineraryRebookingService().rebook(request)).rejects.toMatchObject({
            code: 'SEAT_SELECTION_INVALID',
            message: 'Each passenger needs a different seat on the replacement flight.',
        });
    });

    it('refuses a disrupted leg that no longer holds one seat per passenger', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'MISSING-OLD-SEAT',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        await prisma.seatAssignment.updateMany({
            where: {
                legId: scenario.oldLeg.id,
                passengerId: scenario.passengerIds[1],
            },
            data: { releasedAt: new Date() },
        });

        await expect(new ItineraryRebookingService().rebook(
            replacementRequest(scenario, replacement.id),
        )).rejects.toMatchObject({
            code: 'SEAT_SELECTION_INVALID',
            message: 'Select one replacement seat for every passenger.',
        });
    });

    it('does not take a replacement seat assigned to another booking', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'OCCUPIED',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        await occupySeat(replacement.id, '14C');

        await expect(new ItineraryRebookingService().rebook(
            replacementRequest(scenario, replacement.id),
        )).rejects.toMatchObject({ code: 'SEAT_UNAVAILABLE' });
    });

    it('does not take a replacement seat held by an active checkout', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'HELD',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        await prisma.seatHold.create({
            data: {
                id: randomUUID(),
                flightId: replacement.id,
                seatNumber: '14C',
                holderKey: `other-user:${randomUUID()}`,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            },
        });

        await expect(new ItineraryRebookingService().rebook(
            replacementRequest(scenario, replacement.id),
        )).rejects.toMatchObject({ code: 'SEAT_UNAVAILABLE' });
    });

    it('ignores an expired checkout hold on the replacement seat', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'EXPIRED-HOLD',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        await prisma.seatHold.create({
            data: {
                id: randomUUID(),
                flightId: replacement.id,
                seatNumber: '14C',
                holderKey: `expired-user:${randomUUID()}`,
                createdAt: new Date('1999-12-31T23:50:00.000Z'),
                expiresAt: new Date('2000-01-01T00:00:00.000Z'),
            },
        });

        await expect(new ItineraryRebookingService().rebook(
            replacementRequest(scenario, replacement.id),
        )).resolves.toMatchObject({ status: 'CONFIRMED' });
    });

    it('rolls every leg and seat write back when the status audit cannot be recorded', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'ROLLBACK',
            departureDate: '2099-05-11T16:00:00.000Z',
        });

        await expect(new ItineraryRebookingService().rebook({
            ...replacementRequest(scenario, replacement.id),
            actorUserId: randomUUID(),
        })).rejects.toThrow();

        const saved = await prisma.booking.findUniqueOrThrow({
            where: { id: scenario.booking.id },
            include: {
                rebookings: true,
                legs: { include: { seatAssignments: true } },
            },
        });
        expect(saved.status).toBe('DISRUPTED');
        expect(saved.rebookings).toEqual([]);
        expect(saved.legs).toEqual([
            expect.objectContaining({
                id: scenario.oldLeg.id,
                supersededAt: null,
                seatAssignments: expect.arrayContaining([
                    expect.objectContaining({ releasedAt: null }),
                    expect.objectContaining({ releasedAt: null }),
                ]),
            }),
        ]);
    });

    it('surfaces a deferred missing-mapping failure before reporting success', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'DEFERRED-MAPPING',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        const realTransaction = prisma.$transaction.bind(prisma);
        const transactionSpy = jest.spyOn(prisma, '$transaction');
        transactionSpy.mockImplementationOnce((async (
            callback: (tx: object) => Promise<unknown>,
            options?: object,
        ) => realTransaction(async realTx => {
            const mappingDelegate = new Proxy(realTx.bookingRebookingLeg, {
                get(target, property) {
                    if (property === 'createMany') {
                        return async ({ data }: { data: unknown[] }) => ({ count: data.length });
                    }
                    const value = Reflect.get(target, property, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
            const sabotagedTx = new Proxy(realTx, {
                get(target, property) {
                    if (property === 'bookingRebookingLeg') return mappingDelegate;
                    const value = Reflect.get(target, property, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
            return callback(sabotagedTx);
        }, options)) as typeof prisma.$transaction);

        try {
            await expect(new ItineraryRebookingService().rebook(
                replacementRequest(scenario, replacement.id),
            )).rejects.toThrow(/must be recorded by a BookingRebookingLeg/);
        } finally {
            transactionSpy.mockRestore();
        }

        expect(await prisma.booking.findUniqueOrThrow({
            where: { id: scenario.booking.id },
            select: { status: true, rebookings: true },
        })).toEqual({ status: 'DISRUPTED', rebookings: [] });
    });

    it('records the verified server actor on the disruption resolution', async () => {
        const scenario = await createDisruptedBooking();
        const replacement = await createFlight({
            suffix: 'ACTOR',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        const actor = await prisma.user.create({
            data: {
                name: 'Verified Staff',
                email: `rebooking-actor-${randomUUID()}@example.com`,
                password: 'not-used',
                emailVerified: new Date(),
            },
        });
        created.userIds.push(actor.id);

        await new ItineraryRebookingService().rebook({
            ...replacementRequest(scenario, replacement.id),
            actorUserId: actor.id,
        });

        expect(await prisma.bookingStatusChange.findFirstOrThrow({
            where: {
                bookingId: scenario.booking.id,
                from: 'DISRUPTED',
                to: 'CONFIRMED',
            },
            orderBy: { sequence: 'desc' },
            select: { actorUserId: true },
        })).toEqual({ actorUserId: actor.id });
    });

    it('lets exactly one of two racing rebookings resolve the disruption', async () => {
        const scenario = await createDisruptedBooking();
        const firstReplacement = await createFlight({
            suffix: 'RACE-A',
            departureDate: '2099-05-11T16:00:00.000Z',
        });
        const secondReplacement = await createFlight({
            suffix: 'RACE-B',
            departureDate: '2099-05-12T16:00:00.000Z',
        });
        const service = new ItineraryRebookingService();

        const outcomes = await Promise.allSettled([
            service.rebook(replacementRequest(scenario, firstReplacement.id)),
            service.rebook(replacementRequest(scenario, secondReplacement.id)),
        ]);

        expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter(outcome => outcome.status === 'rejected')).toEqual([
            expect.objectContaining({
                reason: expect.objectContaining({ code: 'BOOKING_NOT_DISRUPTED' }),
            }),
        ]);
        expect(await prisma.itineraryLeg.count({
            where: { bookingId: scenario.booking.id, supersededAt: null },
        })).toBe(1);
        expect(await prisma.bookingRebooking.count({
            where: { bookingId: scenario.booking.id },
        })).toBe(1);
    });
});
