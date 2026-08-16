/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';
import {
    captureRowSnapshot,
    describeLeakedRows,
    rowsAddedDuringRun,
    TRACKED_TABLES as TRACKED_BY_THE_SNAPSHOT,
} from '@/e2e/helpers/rowSnapshot';
import { recordRunBaseline } from '@/e2e/helpers/runBaseline';
import globalTeardown, { describeRunProblem } from '@/e2e/global-teardown';

/**
 * What the snapshot actually looks at, and what the teardown does with it.
 *
 * `rowsAddedDuringRun` is pinned by its own unit tests, but the arithmetic is
 * only as good as the tables fed into it: a leak in a table `TRACKED` does not
 * name is invisible, and invisible in exactly the way that let three specs leak
 * for months (#213). So this creates a row in each and asserts the snapshot
 * catches it -- dropping any entry from `TRACKED` fails here.
 */
const created = {
    userIds: [] as string[],
    identifiers: [] as string[],
    flightIds: [] as number[],
    scheduleIds: [] as number[],
    paymentAttemptIds: [] as string[],
    bookingIds: [] as number[],
};

async function leaveARowInEveryTrackedTable(): Promise<string> {
    const email = `snapshot-${randomUUID()}@example.com`;
    const user = await prisma.user.create({ data: { email } });
    created.userIds.push(user.id);

    const paymentAttempt = await prisma.paymentAttempt.create({
        data: {
            id: randomUUID(),
            checkoutId: randomUUID(),
            userId: user.id,
            requestFingerprint: 'a'.repeat(64),
            amountCents: 35_000,
        },
    });
    created.paymentAttemptIds.push(paymentAttempt.id);
    await prisma.paymentWebhookEvent.create({
        data: {
            id: `evt_${randomUUID().replaceAll('-', '')}`,
            eventType: 'payment_intent.processing',
            providerIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            paymentAttemptId: paymentAttempt.id,
        },
    });

    const booking = await prisma.booking.create({
        data: {
            userId: user.id,
            status: 'CANCELLED',
            paymentIntentId: `pi_${randomUUID().replaceAll('-', '')}`,
            totalPriceCents: 35_000,
        },
    });
    created.bookingIds.push(booking.id);
    const change = await prisma.bookingStatusChange.findFirstOrThrow({
        where: { bookingId: booking.id },
    });
    const refund = await prisma.paymentRefund.create({
        data: {
            bookingStatusChangeId: change.id,
            providerIntentId: booking.paymentIntentId!,
            amountCents: 28_000,
        },
    });
    await prisma.paymentRefundAttempt.create({
        data: { id: randomUUID(), paymentRefundId: refund.id },
    });

    const guide = await prisma.cityGuide.findFirst({ select: { id: true } });
    if (!guide) throw new Error('This test needs a seeded city guide; run `npx prisma db seed`.');

    await prisma.review.create({
        data: { content: 'Left behind', rating: 5, userId: user.id, cityGuideId: guide.id },
    });
    await prisma.userFavorite.create({ data: { userId: user.id, cityGuideId: guide.id } });
    await prisma.notification.create({
        data: { userId: user.id, title: 'Left behind', message: 'Left behind', type: 'SYSTEM' },
    });

    const identifier = `verify-email:${email}`;
    created.identifiers.push(identifier);
    await prisma.verificationToken.create({
        data: { identifier, token: randomUUID(), expires: new Date(Date.now() + 60_000) },
    });

    const route = airportCodesForRoute('Seattle, USA', 'Detroit, USA');
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `LEAK-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            ...route,
            departureDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
            priceCents: 35_000,
        },
    });
    created.flightIds.push(flight.id);

    // A hold outlives the account that took it -- `holderKey` is not a foreign
    // key -- so deleting a run's users does not remove it, and the seat stays
    // greyed out for whatever runs next (#74). Cascades with the flight above.
    await prisma.seatHold.create({
        data: {
            id: randomUUID(),
            flightId: flight.id,
            seatNumber: '9F',
            holderKey: user.id,
            expiresAt: new Date(Date.now() + 10 * 60_000),
        },
    });

    const schedule = await prisma.flightSchedule.create({
        data: {
            flightNumber: `LEAK-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureTime: '09:00',
            durationMinutes: 245,
            daysOfWeek: [1],
            priceCents: 35_000,
        },
    });
    created.scheduleIds.push(schedule.id);

    return email;
}

afterAll(async () => {
    await prisma.paymentAttempt.deleteMany({ where: { id: { in: created.paymentAttemptIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.verificationToken.deleteMany({ where: { identifier: { in: created.identifiers } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.flightSchedule.deleteMany({ where: { id: { in: created.scheduleIds } } });
    await prisma.$disconnect();
});

const TRACKED_TABLES = [
    'Flight',
    'FlightSchedule',
    'Notification',
    'PaymentAttempt',
    'PaymentRefund',
    'PaymentRefundAttempt',
    'PaymentWebhookEvent',
    'Review',
    'SeatHold',
    'User',
    'UserFavorite',
    'VerificationToken',
];

describe('the snapshot a Playwright run is judged by', () => {
    it('is checked against every table it tracks', () => {
        // The test below infers the tracked set from what leaked, so a table
        // added to `TRACKED` with a lookup that always returns nothing looks
        // exactly like a correctly tracked one. This is the direction that
        // cannot: the list here has to name them all.
        expect([...TRACKED_BY_THE_SNAPSHOT].sort()).toEqual(TRACKED_TABLES);
    });

    it('catches a leak in every table it tracks', async () => {
        const before = await captureRowSnapshot();
        const email = await leaveARowInEveryTrackedTable();

        const added = rowsAddedDuringRun(before, await captureRowSnapshot());

        expect(Object.keys(added).sort()).toEqual(TRACKED_TABLES);
        // One row each, so a table that reported somebody else's row would show
        // up here rather than being absorbed into a count.
        expect(Object.values(added).map(ids => ids.length)).toEqual(TRACKED_TABLES.map(() => 1));

        // Every account-owned row is traceable to the account that made it,
        // which is the part that says which spec to fix -- a bare cuid does not.
        const message = describeLeakedRows(added)!;
        expect(message).toContain(email);
        for (const table of [
            'User',
            'PaymentAttempt',
            'PaymentWebhookEvent',
            'PaymentRefund',
            'PaymentRefundAttempt',
            'Review',
            'UserFavorite',
            'Notification',
        ]) {
            expect(added[table][0]).toContain(`(${email})`);
        }
        // A flight has no owning account, so it is named by the number a spec
        // recognises as its own.
        expect(added.Flight[0]).toMatch(/\(LEAK-/);
        expect(added.FlightSchedule[0]).toMatch(/\(LEAK-/);
    });

    it('reports the row that stayed and not the one that was cleaned up', async () => {
        // Both directions in one test on purpose. Asserting only that a tidy
        // spec reports nothing is satisfied by a comparison that reports
        // nothing at all, which is the failure mode that matters here.
        const before = await captureRowSnapshot();

        const tidy = await prisma.user.create({
            data: { email: `snapshot-tidy-${randomUUID()}@example.com` },
        });
        await prisma.notification.create({
            data: { userId: tidy.id, title: 'Temporary', message: 'Temporary', type: 'SYSTEM' },
        });
        await prisma.user.delete({ where: { id: tidy.id } });

        const untidyEmail = `snapshot-untidy-${randomUUID()}@example.com`;
        const untidy = await prisma.user.create({ data: { email: untidyEmail } });
        created.userIds.push(untidy.id);

        const added = rowsAddedDuringRun(before, await captureRowSnapshot());

        expect(Object.keys(added)).toEqual(['User']);
        expect(added.User).toEqual([`${untidy.id} (${untidyEmail})`]);
    });
});

describe('what the teardown does with it', () => {
    it('refuses a run it was never given a baseline for', async () => {
        // The one state that looks like a clean run and is not: nothing to
        // compare against, so nothing to report. Loaded in isolation because
        // the baseline is module state, and the tests below set it.
        let problem: string | null = 'not run';
        await jest.isolateModulesAsync(async () => {
            const teardown = await import('@/e2e/global-teardown');
            problem = await teardown.describeRunProblem();
        });

        expect(problem).toContain('no baseline was recorded');
        expect(problem).toContain('recordRunBaseline');
    });

    it('says nothing about a run that left nothing behind', async () => {
        recordRunBaseline(await captureRowSnapshot());

        await expect(describeRunProblem()).resolves.toBeNull();
    });

    it('names what a run left behind', async () => {
        recordRunBaseline(await captureRowSnapshot());
        const email = await leaveARowInEveryTrackedTable();

        const problem = await describeRunProblem();

        expect(problem).toContain(email);
        expect(problem).toContain('left rows behind');
    });

    it('fails the run, and clears the rate limits on the way out', async () => {
        // The teardown itself, not the description it builds: reporting a leak
        // to nobody is the same as not noticing it. The ordering is load-bearing
        // too -- a counted attempt left behind fails the *next* run, inside a
        // test, so the cleanup has to survive the throw.
        recordRunBaseline(await captureRowSnapshot());
        const email = await leaveARowInEveryTrackedTable();
        await prisma.authRateLimit.create({
            data: {
                key: `teardown-probe-${randomUUID()}`,
                windowStart: new Date(),
                expiresAt: new Date(Date.now() + 60_000),
            },
        });

        await expect(globalTeardown()).rejects.toThrow(email);

        expect(await prisma.authRateLimit.count()).toBe(0);
    });

    it('lets a clean run finish, and clears the rate limits then too', async () => {
        recordRunBaseline(await captureRowSnapshot());
        await prisma.authRateLimit.create({
            data: {
                key: `teardown-probe-${randomUUID()}`,
                windowStart: new Date(),
                expiresAt: new Date(Date.now() + 60_000),
            },
        });

        await expect(globalTeardown()).resolves.toBeUndefined();

        expect(await prisma.authRateLimit.count()).toBe(0);
    });
});
