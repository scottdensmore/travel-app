/** @jest-environment node */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';

/**
 * What state a booking is in, and how it got there.
 *
 * `Booking.status` was a bare `TEXT` column. Unlike `Flight.status` there was
 * not even a schema at the request boundary: the whole definition was a string
 * literal in `lib/seatOccupancy.ts`, and that literal decides whether a seat is
 * held. A status written any other way sells a seat somebody is sitting in.
 *
 * These are the guarantees the database now makes on its own, so they are
 * asserted against it rather than through the application: a repair script, a
 * psql session or a service added later reaches this table without passing
 * through any code this repository owns, and the point of moving the rule into
 * the schema is that it holds for them too (#76).
 */
const created = { bookingIds: [] as number[], userIds: [] as string[], flightIds: [] as number[] };

async function aBooking(status?: 'CONFIRMED' | 'CANCELLED' | 'DISRUPTED') {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `BST-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
            priceCents: 35_000,
        },
    });
    created.flightIds.push(flight.id);

    const user = await prisma.user.create({
        data: { email: `booking-status-${randomUUID()}@example.com` },
    });
    created.userIds.push(user.id);

    const booking = await prisma.booking.create({
        data: {
            userId: user.id,
            ...(status ? { status } : {}),
            legs: { create: [{ sequence: 1, flightId: flight.id }] },
        },
    });
    created.bookingIds.push(booking.id);
    return booking;
}

afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.flightSchedule.deleteMany({ where: { flightNumber: { startsWith: 'DUR-' } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('the status column', () => {
    it('defaults to CONFIRMED', async () => {
        const booking = await aBooking();

        expect(booking.status).toBe('CONFIRMED');
    });

    it('accepts each of the three states', async () => {
        for (const status of ['CONFIRMED', 'CANCELLED', 'DISRUPTED'] as const) {
            expect((await aBooking(status)).status).toBe(status);
        }
    });

    it('refuses a state outside them, in the database rather than in Zod', async () => {
        // Raw, because the generated client would not let this compile -- and a
        // rule that only the client enforces is not a rule the column has. This
        // is the shape of write the old TEXT column accepted silently.
        const booking = await aBooking();

        await expect(
            prisma.$executeRaw(
                Prisma.sql`UPDATE "Booking" SET "status" = 'REFUNDED' WHERE "id" = ${booking.id}`,
            ),
        ).rejects.toThrow(/invalid input value for enum "BookingStatus"/);

        expect((await prisma.booking.findUnique({ where: { id: booking.id } }))!.status)
            .toBe('CONFIRMED');
    });
});

describe('the status history', () => {
    it('records the booking coming into existence, with nothing before it', async () => {
        const booking = await aBooking();

        const history = await prisma.bookingStatusChange.findMany({
            where: { bookingId: booking.id },
        });

        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ from: null, to: 'CONFIRMED' });
    });

    it('cannot be rewritten', async () => {
        // The whole value of an audit trail is that it does not depend on every
        // future caller choosing to respect it.
        const booking = await aBooking();
        const [entry] = await prisma.bookingStatusChange.findMany({
            where: { bookingId: booking.id },
        });

        await expect(
            prisma.bookingStatusChange.update({
                where: { id: entry.id },
                data: { to: 'CANCELLED' },
            }),
        ).rejects.toThrow(/append-only/);

        const after = await prisma.bookingStatusChange.findUnique({ where: { id: entry.id } });
        expect(after!.to).toBe('CONFIRMED');
    });

    it('names the row and its booking when it refuses', async () => {
        // Whoever hits this is holding a script that was about to rewrite
        // history and needs to know which row it meant.
        const booking = await aBooking();
        const [entry] = await prisma.bookingStatusChange.findMany({
            where: { bookingId: booking.id },
        });

        await expect(
            prisma.bookingStatusChange.update({
                where: { id: entry.id },
                data: { reason: 'tidying up' },
            }),
        ).rejects.toThrow(`row ${entry.id} belongs to booking ${booking.id}`);
    });

    it('goes when its booking goes, rather than making the booking undeletable', async () => {
        // Deletes are left to the cascade on purpose: the e2e harness clears
        // every booking before a run, and deleting a flight takes its bookings
        // with it. A rule that blocked deletes would block both.
        const booking = await aBooking();

        await prisma.booking.delete({ where: { id: booking.id } });

        expect(await prisma.bookingStatusChange.count({ where: { bookingId: booking.id } }))
            .toBe(0);
    });

    it('refuses to swap one actor for another, or to name one after the fact', async () => {
        // The carve-out below is exactly one transition wide. Attribution can be
        // forgotten, because the alternative is a user who cannot be deleted --
        // it cannot be invented or reassigned.
        const booking = await aBooking();
        const staff = await prisma.user.create({
            data: { email: `booking-actor-${randomUUID()}@example.com` },
        });
        created.userIds.push(staff.id);
        const [entry] = await prisma.bookingStatusChange.findMany({
            where: { bookingId: booking.id },
        });

        await expect(
            prisma.bookingStatusChange.update({
                where: { id: entry.id },
                data: { actorUserId: staff.id },
            }),
        ).rejects.toThrow(/append-only/);
    });

    it('refuses a rewrite that nulls the actor on its way past', async () => {
        // The carve-out compares the whole row rather than listing the columns
        // that must not change, and this is the difference between the two: a
        // check that only asks "did the actor go to null?" would let everything
        // in the same statement through with it.
        const booking = await aBooking();
        const staff = await prisma.user.create({
            data: { email: `booking-actor-${randomUUID()}@example.com` },
        });
        created.userIds.push(staff.id);
        const entry = await prisma.bookingStatusChange.create({
            data: { bookingId: booking.id, from: 'CONFIRMED', to: 'DISRUPTED', actorUserId: staff.id },
        });

        await expect(
            prisma.$executeRaw(Prisma.sql`
                UPDATE "BookingStatusChange"
                SET "actorUserId" = NULL, "to" = 'CONFIRMED', "reason" = 'tidying up'
                WHERE "id" = ${entry.id}
            `),
        ).rejects.toThrow(/append-only/);

        const after = await prisma.bookingStatusChange.findUnique({ where: { id: entry.id } });
        expect(after).toMatchObject({ to: 'DISRUPTED', reason: null, actorUserId: staff.id });
    });

    it('leaves the record when the actor is deleted, minus the name', async () => {
        const booking = await aBooking();
        const staff = await prisma.user.create({
            data: { email: `booking-actor-${randomUUID()}@example.com` },
        });
        const entry = await prisma.bookingStatusChange.create({
            data: { bookingId: booking.id, from: 'CONFIRMED', to: 'DISRUPTED', actorUserId: staff.id },
        });

        await prisma.user.delete({ where: { id: staff.id } });

        const after = await prisma.bookingStatusChange.findUnique({ where: { id: entry.id } });
        expect(after).not.toBeNull();
        expect(after!.actorUserId).toBeNull();
        expect(after!.to).toBe('DISRUPTED');
    });

    it('records a change of status, and nothing else', async () => {
        const booking = await aBooking();
        const entries = () => prisma.bookingStatusChange.count({ where: { bookingId: booking.id } });

        // An update that never mentions status: the trigger is `UPDATE OF
        // "status"`, so it should not fire at all.
        await prisma.booking.update({
            where: { id: booking.id },
            data: { paymentIntentId: 'pi_test' },
        });
        expect(await entries()).toBe(1);

        // Mentions it, sets it to what it already was: fires, and the
        // `IS DISTINCT FROM` drops it.
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } });
        expect(await entries()).toBe(1);

        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
        expect(await entries()).toBe(2);
    });

    it('takes a reason and an actor from the transaction that made the change', async () => {
        // The parts a trigger cannot know. Transaction-local on purpose: a
        // session-scoped setting would survive the commit and attribute the
        // next booking on that pooled connection to whoever set it last.
        const booking = await aBooking();
        const staff = await prisma.user.create({
            data: { email: `booking-actor-${randomUUID()}@example.com` },
        });
        created.userIds.push(staff.id);

        await prisma.$transaction(async (tx) => {
            await tx.$executeRaw(
                Prisma.sql`SELECT set_config('app.booking_status_reason', 'Flight cancelled', true)`,
            );
            await tx.$executeRaw(
                Prisma.sql`SELECT set_config('app.booking_status_actor', ${staff.id}, true)`,
            );
            await tx.booking.update({ where: { id: booking.id }, data: { status: 'DISRUPTED' } });
        });

        const disruption = await prisma.bookingStatusChange.findFirst({
            where: { bookingId: booking.id, to: 'DISRUPTED' },
        });
        expect(disruption).toMatchObject({
            from: 'CONFIRMED',
            reason: 'Flight cancelled',
            actorUserId: staff.id,
        });

        // The next change, on the same client and so possibly the same pooled
        // connection, must not inherit either.
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });

        const cancellation = await prisma.bookingStatusChange.findFirst({
            where: { bookingId: booking.id, to: 'CANCELLED' },
        });
        expect(cancellation).toMatchObject({ reason: null, actorUserId: null });
    });

    it('records what a change refunded, including a refund of nothing', async () => {
        // Zero is a real answer and a different one from "did not refund": a
        // cancellation inside the cut-off owes nothing, and the row has to say
        // so rather than leaving it null (#76).
        const booking = await aBooking();

        await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.booking_refund_cents', '0', true)`;
            await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
        });

        const change = await prisma.bookingStatusChange.findFirst({
            where: { bookingId: booking.id, to: 'CANCELLED' },
        });
        expect(change!.refundCents).toBe(0);

        // The row for the booking coming into existence refunded nothing at
        // all, and stays null rather than reading as a refund of zero.
        const created = await prisma.bookingStatusChange.findFirst({
            where: { bookingId: booking.id, from: null },
        });
        expect(created!.refundCents).toBeNull();
    });

    it('orders two changes made in one transaction', async () => {
        // `createdAt` is transaction start time, so both of these carry the
        // same instant and a random uuid each. Without the sequence, "the
        // latest status change" is unanswerable by ORDER BY.
        const booking = await aBooking();

        await prisma.$transaction(async (tx) => {
            await tx.booking.update({ where: { id: booking.id }, data: { status: 'DISRUPTED' } });
            await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
        });

        const history = await prisma.bookingStatusChange.findMany({
            where: { bookingId: booking.id },
            orderBy: { sequence: 'asc' },
        });

        expect(history.map(entry => entry.to)).toEqual(['CONFIRMED', 'DISRUPTED', 'CANCELLED']);
        // The premise: the timestamps cannot separate the last two.
        expect(history[1].createdAt).toEqual(history[2].createdAt);
        expect(history[1].sequence < history[2].sequence).toBe(true);
    });

    it('has an entry for every booking in the database', async () => {
        // The invariant the backfill exists to make true. Asserted over the
        // whole table rather than the fixtures above, because a reader that has
        // to cope with a booking having no history is a reader with a fallback,
        // which is the second source of truth this removes.
        await aBooking();

        const orphans = await prisma.booking.findMany({
            where: { statusChanges: { none: {} } },
            select: { id: true, createdAt: true },
        });

        expect(orphans).toEqual([]);
    });
});

/**
 * A duration is a positive number of minutes, enforced by the database.
 *
 * Zero would make a flight arrive at the moment it left and negative would make
 * it arrive before; both would print a nonsense arrival on a customer's
 * booking. The Zod bounds catch it at the form, but a repair script or a seed
 * reaches the table without passing through them -- which is the whole reason
 * the constraint is there, and it was observed by nothing (#84).
 */
describe('a flight duration is positive, in the database', () => {
    it('refuses zero and negative minutes on a schedule', async () => {
        for (const minutes of [0, -5]) {
            await expect(prisma.flightSchedule.create({
                data: {
                    flightNumber: `DUR-${randomUUID().slice(0, 6)}`,
                    airline: 'Mona Airways',
                    from: 'Seattle, USA',
                    to: 'Detroit, USA',
                    departureTime: '08:00',
                    durationMinutes: minutes,
                    daysOfWeek: [1],
                    priceCents: 35_000,
                },
            })).rejects.toThrow(/constraint|check/i);
        }
    });

    it('refuses them on a flight too, while still allowing none at all', async () => {
        const route = airportCodesForRoute('Seattle, USA', 'Detroit, USA');
        const base = {
            airline: 'Mona Airways',
            ...route,
            departureDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
            priceCents: 35_000,
        };

        await expect(prisma.flight.create({
            data: { ...base, flightNumber: `DUR-${randomUUID().slice(0, 6)}`, durationMinutes: 0 },
        })).rejects.toThrow(/constraint|check/i);

        // Null is allowed on a flight: one created outside a schedule knows no
        // duration, and shows no arrival rather than an invented one.
        const unknown = await prisma.flight.create({
            data: { ...base, flightNumber: `DUR-${randomUUID().slice(0, 6)}`, durationMinutes: null },
        });
        created.flightIds.push(unknown.id);
        expect(unknown.durationMinutes).toBeNull();
    });
});
