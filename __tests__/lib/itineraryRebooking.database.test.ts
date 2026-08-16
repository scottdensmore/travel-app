/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { airportCodesForRoute } from '@/lib/airports';
import { lockBookingsOnFlightForUpdate } from '@/lib/flightLock';
import { prisma } from '@/lib/prisma';

const created = { bookingIds: [] as number[], flightIds: [] as number[] };

async function flight(suffix: string, priceCents = 30_000) {
    const saved = await prisma.flight.create({
        data: {
            flightNumber: `RBK-${suffix}-${randomUUID().slice(0, 6)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date('2027-04-10T16:00:00.000Z'),
            priceCents,
        },
    });
    created.flightIds.push(saved.id);
    return saved;
}

async function disruptedBooking() {
    const originalFlight = await flight('OLD');
    const passengerId = randomUUID();
    const booking = await prisma.booking.create({
        data: {
            status: 'DISRUPTED',
            paymentIntentId: `pi_rebooking_${randomUUID()}`,
            totalPriceCents: 30_000,
            passengers: {
                create: [{
                    id: passengerId,
                    firstName: 'Ada',
                    lastName: 'Lovelace',
                    gender: 'Female',
                    sensitiveDataDeletedAt: new Date(),
                }],
            },
            legs: { create: [{ sequence: 1, flightId: originalFlight.id }] },
        },
        include: { legs: true },
    });
    created.bookingIds.push(booking.id);
    await prisma.seatAssignment.create({
        data: {
            passengerId,
            legId: booking.legs[0].id,
            flightId: originalFlight.id,
            seatNumber: '11A',
            cabinClass: 'ECONOMY',
        },
    });
    return { booking, oldLeg: booking.legs[0], passengerId };
}

async function resolveDisruption(
    tx: Prisma.TransactionClient,
    bookingId: number,
    rebookingId: string,
) {
    await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CONFIRMED' },
    });
    const change = await tx.bookingStatusChange.findFirstOrThrow({
        where: { bookingId, from: 'DISRUPTED', to: 'CONFIRMED' },
        orderBy: { sequence: 'desc' },
    });
    await tx.$executeRaw`
        INSERT INTO "BookingRebooking"
            ("id", "bookingId", "bookingStatusChangeId", "farePolicy")
        VALUES (${rebookingId}, ${bookingId}, ${change.id}, 'DISRUPTION_WAIVER')
    `;
}

async function recordRebooking({
    releaseOldSeat = true,
    checkSupersessionNow = false,
}: {
    releaseOldSeat?: boolean;
    checkSupersessionNow?: boolean;
} = {}) {
    const scenario = await disruptedBooking();
    const replacementFlight = await flight('NEW', 45_000);
    const rebookingId = randomUUID();

    const newLegId = await prisma.$transaction(async tx => {
        await tx.$executeRaw`
            UPDATE "ItineraryLeg"
            SET "supersededAt" = statement_timestamp()
            WHERE "id" = ${scenario.oldLeg.id}
        `;
        const [newLeg] = await tx.$queryRaw<Array<{ id: number }>>`
            INSERT INTO "ItineraryLeg" ("bookingId", "sequence", "flightId")
            VALUES (${scenario.booking.id}, 1, ${replacementFlight.id})
            RETURNING "id"
        `;
        if (releaseOldSeat) {
            await tx.seatAssignment.updateMany({
                where: { legId: scenario.oldLeg.id, releasedAt: null },
                data: { releasedAt: new Date() },
            });
        }
        await tx.seatAssignment.create({
            data: {
                passengerId: scenario.passengerId,
                legId: newLeg.id,
                flightId: replacementFlight.id,
                seatNumber: '14C',
                cabinClass: 'ECONOMY',
            },
        });
        await tx.$executeRaw`
            SELECT set_config(
                'app.booking_status_reason',
                'Rebooked after an airline cancellation.',
                true
            )
        `;
        await resolveDisruption(tx, scenario.booking.id, rebookingId);
        await tx.$executeRaw`
            INSERT INTO "BookingRebookingLeg" ("rebookingId", "fromLegId", "toLegId")
            VALUES (${rebookingId}, ${scenario.oldLeg.id}, ${newLeg.id})
        `;
        if (checkSupersessionNow) {
            await tx.$executeRaw`
                SET CONSTRAINTS "ItineraryLeg_supersession_is_recorded" IMMEDIATE
            `;
        }
        return newLeg.id;
    });

    return { ...scenario, replacementFlight, rebookingId, newLegId };
}

afterEach(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    created.bookingIds.length = 0;
    created.flightIds.length = 0;
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('immutable itinerary rebooking records', () => {
    it('keeps the original leg and released seat while one replacement becomes active', async () => {
        const saved = await recordRebooking();

        const legs = await prisma.$queryRaw<Array<{
            id: number;
            supersededAt: Date | null;
        }>>`
            SELECT "id", "supersededAt"
            FROM "ItineraryLeg"
            WHERE "bookingId" = ${saved.booking.id}
            ORDER BY "id"
        `;
        const seats = await prisma.seatAssignment.findMany({
            where: { passengerId: saved.passengerId },
            orderBy: { id: 'asc' },
        });
        const currentBooking = await prisma.booking.findUniqueOrThrow({
            where: { id: saved.booking.id },
            include: { rebookings: true },
        });

        expect(legs).toEqual([
            { id: saved.oldLeg.id, supersededAt: expect.any(Date) },
            { id: saved.newLegId, supersededAt: null },
        ]);
        expect(seats).toEqual(expect.arrayContaining([
            expect.objectContaining({ legId: saved.oldLeg.id, seatNumber: '11A', releasedAt: expect.any(Date) }),
            expect.objectContaining({ legId: saved.newLegId, seatNumber: '14C', releasedAt: null }),
        ]));
        expect(currentBooking).toMatchObject({
            status: 'CONFIRMED',
            paymentIntentId: saved.booking.paymentIntentId,
            totalPriceCents: 30_000,
            rebookings: [expect.objectContaining({
                id: saved.rebookingId,
                farePolicy: 'DISRUPTION_WAIVER',
            })],
        });
        expect(saved.replacementFlight.priceCents).toBe(45_000);
    });

    it('stops treating the superseded flight as part of the live booking', async () => {
        const saved = await recordRebooking();

        const locked = await prisma.$transaction(async tx => ({
            oldFlight: await lockBookingsOnFlightForUpdate(tx, saved.oldLeg.flightId),
            replacementFlight: await lockBookingsOnFlightForUpdate(
                tx,
                saved.replacementFlight.id,
            ),
        }));

        expect(locked).toEqual({
            oldFlight: [],
            replacementFlight: [saved.booking.id],
        });
    });

    it('allows only one active leg at an itinerary position', async () => {
        const saved = await recordRebooking();
        const anotherFlight = await flight('THIRD');

        await expect(prisma.$executeRaw`
            INSERT INTO "ItineraryLeg" ("bookingId", "sequence", "flightId")
            VALUES (${saved.booking.id}, 1, ${anotherFlight.id})
        `).rejects.toThrow(/Key \(\"bookingId\", sequence\)=\(.+, 1\) already exists/);
    });

    it('requires every new leg to start active', async () => {
        const scenario = await disruptedBooking();
        const anotherFlight = await flight('PRE-SUPERSEDED');

        await expect(prisma.$executeRaw`
            INSERT INTO "ItineraryLeg"
                ("bookingId", "sequence", "flightId", "supersededAt")
            VALUES (
                ${scenario.booking.id},
                2,
                ${anotherFlight.id},
                statement_timestamp()
            )
        `).rejects.toThrow(/new ItineraryLeg must start active/);
    });

    it('never lets a superseded leg become active again', async () => {
        const saved = await recordRebooking();

        await expect(prisma.$executeRaw`
            UPDATE "ItineraryLeg" SET "supersededAt" = NULL WHERE "id" = ${saved.oldLeg.id}
        `).rejects.toThrow(/ItineraryLeg supersession is permanent/);
    });

    it('requires a new version instead of rewriting a leg in place', async () => {
        const scenario = await disruptedBooking();
        const anotherFlight = await flight('IN-PLACE-REWRITE');

        await expect(prisma.$executeRaw`
            UPDATE "ItineraryLeg"
            SET "flightId" = ${anotherFlight.id}
            WHERE "id" = ${scenario.oldLeg.id}
        `).rejects.toThrow(/ItineraryLeg identity is immutable/);
    });

    it('refuses to delete a leg while its booking still exists', async () => {
        const scenario = await disruptedBooking();

        await expect(prisma.itineraryLeg.delete({
            where: { id: scenario.oldLeg.id },
        })).rejects.toThrow(/cannot be deleted while booking/);

        expect(await prisma.itineraryLeg.count({
            where: { id: scenario.oldLeg.id },
        })).toBe(1);
    });

    it('does not let a cascading leg delete erase its rebooking mapping', async () => {
        const saved = await recordRebooking();

        await expect(prisma.itineraryLeg.delete({
            where: { id: saved.oldLeg.id },
        })).rejects.toThrow(/cannot be deleted while booking/);

        expect(await prisma.bookingRebookingLeg.count({
            where: { rebookingId: saved.rebookingId },
        })).toBe(1);
    });

    it('does not let a cascading replacement delete erase its rebooking mapping', async () => {
        const saved = await recordRebooking();

        await expect(prisma.itineraryLeg.delete({
            where: { id: saved.newLegId },
        })).rejects.toThrow(/cannot be deleted while booking/);

        expect(await prisma.bookingRebookingLeg.count({
            where: { rebookingId: saved.rebookingId },
        })).toBe(1);
    });

    it('makes the rebooking event append-only', async () => {
        const saved = await recordRebooking();

        await expect(prisma.$executeRaw`
            UPDATE "BookingRebooking" SET "createdAt" = "createdAt"
            WHERE "id" = ${saved.rebookingId}
        `).rejects.toThrow(/BookingRebooking is append-only/);
    });

    it('makes the rebooking leg mapping append-only', async () => {
        const saved = await recordRebooking();

        await expect(prisma.$executeRaw`
            UPDATE "BookingRebookingLeg" SET "toLegId" = "toLegId"
            WHERE "rebookingId" = ${saved.rebookingId}
              AND "fromLegId" = ${saved.oldLeg.id}
        `).rejects.toThrow(/BookingRebookingLeg is append-only/);
    });

    it('refuses to delete a leg mapping while its historical leg remains', async () => {
        const saved = await recordRebooking();

        await expect(prisma.$transaction(async tx => {
            await tx.bookingRebookingLeg.delete({
                where: {
                    rebookingId_fromLegId: {
                        rebookingId: saved.rebookingId,
                        fromLegId: saved.oldLeg.id,
                    },
                },
            });
            await tx.$executeRaw`
                SET CONSTRAINTS "BookingRebookingLeg_preserves_supersession" IMMEDIATE
            `;
        })).rejects.toThrow(/cannot be deleted directly/);

        expect(await prisma.bookingRebookingLeg.count({
            where: { rebookingId: saved.rebookingId },
        })).toBe(1);
    });

    it('refuses to delete a rebooking event while its historical leg remains', async () => {
        const saved = await recordRebooking();

        await expect(prisma.$transaction(async tx => {
            await tx.bookingRebooking.delete({ where: { id: saved.rebookingId } });
            await tx.$executeRaw`
                SET CONSTRAINTS "BookingRebookingLeg_preserves_supersession" IMMEDIATE
            `;
        })).rejects.toThrow(/cannot be deleted directly/);

        expect(await prisma.bookingRebooking.count({
            where: { id: saved.rebookingId },
        })).toBe(1);
    });

    it('refuses to replace deleted audit rows with rewritten history', async () => {
        const saved = await recordRebooking();
        const original = await prisma.bookingRebooking.findUniqueOrThrow({
            where: { id: saved.rebookingId },
        });

        await expect(prisma.$transaction(async tx => {
            await tx.bookingRebooking.delete({ where: { id: saved.rebookingId } });
            await tx.$executeRaw`
                INSERT INTO "BookingRebooking"
                    ("id", "bookingId", "bookingStatusChangeId", "farePolicy", "createdAt")
                VALUES (
                    ${saved.rebookingId},
                    ${saved.booking.id},
                    ${original.bookingStatusChangeId},
                    'DISRUPTION_WAIVER',
                    ${new Date('2000-01-01T00:00:00.000Z')}
                )
            `;
            await tx.$executeRaw`
                INSERT INTO "BookingRebookingLeg" ("rebookingId", "fromLegId", "toLegId")
                VALUES (${saved.rebookingId}, ${saved.oldLeg.id}, ${saved.newLegId})
            `;
            await tx.$executeRaw`
                SET CONSTRAINTS "BookingRebookingLeg_preserves_supersession" IMMEDIATE
            `;
        })).rejects.toThrow(/cannot be deleted directly/);

        expect(await prisma.bookingRebooking.findUniqueOrThrow({
            where: { id: saved.rebookingId },
        })).toMatchObject({ createdAt: original.createdAt });
    });

    it('refuses a mapping between different itinerary positions', async () => {
        const scenario = await disruptedBooking();
        const replacementFlight = await flight('WRONG-SEQUENCE');
        const rebookingId = randomUUID();

        await expect(prisma.$transaction(async tx => {
            await tx.$executeRaw`
                UPDATE "ItineraryLeg"
                SET "supersededAt" = statement_timestamp()
                WHERE "id" = ${scenario.oldLeg.id}
            `;
            const [wrongLeg] = await tx.$queryRaw<Array<{ id: number }>>`
                INSERT INTO "ItineraryLeg" ("bookingId", "sequence", "flightId")
                VALUES (${scenario.booking.id}, 2, ${replacementFlight.id})
                RETURNING "id"
            `;
            await resolveDisruption(tx, scenario.booking.id, rebookingId);
            await tx.$executeRaw`
                INSERT INTO "BookingRebookingLeg" ("rebookingId", "fromLegId", "toLegId")
                VALUES (${rebookingId}, ${scenario.oldLeg.id}, ${wrongLeg.id})
            `;
        })).rejects.toThrow(/same itinerary position/);
    });

    it('refuses to supersede a leg without recording its replacement', async () => {
        const scenario = await disruptedBooking();

        await expect(prisma.$executeRaw`
            UPDATE "ItineraryLeg"
            SET "supersededAt" = statement_timestamp()
            WHERE "id" = ${scenario.oldLeg.id}
        `).rejects.toThrow(/must be recorded by a BookingRebookingLeg/);
    });

    it('refuses to supersede a leg while its old seat is still live', async () => {
        await expect(recordRebooking({
            releaseOldSeat: false,
            checkSupersessionNow: true,
        })).rejects.toThrow(/cannot retain live seat assignments/);
    });

    it('refuses a rebooking event with no leg replacement', async () => {
        const scenario = await disruptedBooking();
        const rebookingId = randomUUID();

        await expect(prisma.$transaction(async tx => {
            await resolveDisruption(tx, scenario.booking.id, rebookingId);
            // Prisma 5 logs a deferred-constraint failure from COMMIT but can
            // resolve the interactive-transaction promise. A product writer
            // will make all rebooking constraints immediate as its final
            // statement; do that here so the rejected write is observable to
            // the caller as well as rolled back by PostgreSQL.
            await tx.$executeRaw`SET CONSTRAINTS "BookingRebooking_has_legs" IMMEDIATE`;
        })).rejects.toThrow(/must map at least one itinerary leg/);
    });

    it('refuses a leg mapping that crosses booking references', async () => {
        const scenario = await disruptedBooking();
        const other = await disruptedBooking();
        const rebookingId = randomUUID();

        await expect(prisma.$transaction(async tx => {
            await tx.$executeRaw`
                UPDATE "ItineraryLeg"
                SET "supersededAt" = statement_timestamp()
                WHERE "id" = ${scenario.oldLeg.id}
            `;
            await resolveDisruption(tx, scenario.booking.id, rebookingId);
            await tx.$executeRaw`
                INSERT INTO "BookingRebookingLeg" ("rebookingId", "fromLegId", "toLegId")
                VALUES (${rebookingId}, ${scenario.oldLeg.id}, ${other.oldLeg.id})
            `;
        })).rejects.toThrow(/same booking and same itinerary position/);
    });

    it('refuses a leg mapping whose source and destination roles are reversed', async () => {
        const scenario = await disruptedBooking();
        const replacementFlight = await flight('REVERSED-ROLES');
        const rebookingId = randomUUID();
        let mappingError: unknown;

        await expect(prisma.$transaction(async tx => {
            await tx.$executeRaw`
                UPDATE "ItineraryLeg"
                SET "supersededAt" = statement_timestamp()
                WHERE "id" = ${scenario.oldLeg.id}
            `;
            const [newLeg] = await tx.$queryRaw<Array<{ id: number }>>`
                INSERT INTO "ItineraryLeg" ("bookingId", "sequence", "flightId")
                VALUES (${scenario.booking.id}, 1, ${replacementFlight.id})
                RETURNING "id"
            `;
            await resolveDisruption(tx, scenario.booking.id, rebookingId);
            try {
                await tx.$executeRaw`
                    INSERT INTO "BookingRebookingLeg" ("rebookingId", "fromLegId", "toLegId")
                    VALUES (${rebookingId}, ${newLeg.id}, ${scenario.oldLeg.id})
                `;
            } catch (error) {
                mappingError = error;
            }
            throw new Error('ROLL_BACK_ROLE_PROBE');
        })).rejects.toThrow('ROLL_BACK_ROLE_PROBE');

        expect(String(mappingError)).toMatch(/same booking and same itinerary position/);
    });

    it('refuses an event whose booking differs from its status change', async () => {
        const scenario = await disruptedBooking();
        const other = await disruptedBooking();

        await expect(prisma.$transaction(async tx => {
            await tx.booking.update({
                where: { id: scenario.booking.id },
                data: { status: 'CONFIRMED' },
            });
            const change = await tx.bookingStatusChange.findFirstOrThrow({
                where: {
                    bookingId: scenario.booking.id,
                    from: 'DISRUPTED',
                    to: 'CONFIRMED',
                },
                orderBy: { sequence: 'desc' },
            });
            await tx.$executeRaw`
                INSERT INTO "BookingRebooking"
                    ("id", "bookingId", "bookingStatusChangeId", "farePolicy")
                VALUES (
                    ${randomUUID()},
                    ${other.booking.id},
                    ${change.id},
                    'DISRUPTION_WAIVER'
                )
            `;
        })).rejects.toThrow(/one non-refunding DISRUPTED to CONFIRMED status change/);
    });

    it('refuses an event whose status change also records a refund', async () => {
        const scenario = await disruptedBooking();
        const rebookingId = randomUUID();

        await expect(prisma.$transaction(async tx => {
            await tx.$executeRaw`
                SELECT set_config('app.booking_refund_cents', '1', true)
            `;
            await resolveDisruption(tx, scenario.booking.id, rebookingId);
        })).rejects.toThrow(/one non-refunding DISRUPTED to CONFIRMED status change/);
    });

    it('refuses an event that is not the resolution of a disruption', async () => {
        const scenario = await disruptedBooking();
        const initialChange = await prisma.bookingStatusChange.findFirstOrThrow({
            where: { bookingId: scenario.booking.id, from: null, to: 'DISRUPTED' },
        });

        await expect(prisma.$executeRaw`
            INSERT INTO "BookingRebooking"
                ("id", "bookingId", "bookingStatusChangeId", "farePolicy")
            VALUES (
                ${randomUUID()},
                ${scenario.booking.id},
                ${initialChange.id},
                'DISRUPTION_WAIVER'
            )
        `).rejects.toThrow(/one non-refunding DISRUPTED to CONFIRMED status change/);
    });

    it('cascades the immutable history when its booking is deleted', async () => {
        const saved = await recordRebooking();

        expect(await prisma.booking.deleteMany({
            where: { id: saved.booking.id },
        })).toEqual({ count: 1 });

        expect(await prisma.bookingRebooking.count({
            where: { id: saved.rebookingId },
        })).toBe(0);
        expect(await prisma.bookingRebookingLeg.count({
            where: { rebookingId: saved.rebookingId },
        })).toBe(0);
        expect(await prisma.itineraryLeg.count({
            where: { bookingId: saved.booking.id },
        })).toBe(0);
    });
});
