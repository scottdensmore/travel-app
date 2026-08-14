/** @jest-environment node */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';
import {
    HOLD_MINUTES, holdSeat, holdSeats, releaseHold, releaseHoldsExcept, seatsHeldByOthers,
} from '@/lib/seatHolds';

/**
 * A seat someone is part-way through choosing is not offered to anyone else.
 *
 * Until now a seat only became unavailable when a booking existed, so between
 * picking 12A and paying for it the seat was still on every other customer's
 * map. The loser of that race got as far as the payment step and was then told
 * the seat had gone (#74).
 *
 * The hold expires rather than being cleaned up, so an abandoned checkout costs
 * the airline nothing: nothing has to notice the customer left, and there is no
 * job whose failure would permanently reduce inventory.
 */
const created = { flightIds: [] as number[], holderKeys: [] as string[] };

afterAll(async () => {
    await prisma.seatHold.deleteMany({ where: { holderKey: { in: created.holderKeys } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.$disconnect();
});

async function aFlight() {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `HLD-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            priceCents: 30_000,
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

function aHolder() {
    const key = `holder-${randomUUID()}`;
    created.holderKeys.push(key);
    return key;
}

/**
 * Age a hold until it has expired, the way an abandoned checkout does.
 *
 * Both timestamps move. Backdating only `expiresAt` produces a hold that
 * expired before it was made, which the `SeatHold_expires_after_it_is_made`
 * check rejects -- correctly, since that state means a caller wrote a hold that
 * was dead on arrival and would occupy the seat's one row while being invisible
 * to every read.
 */
async function abandon(flightId: number, seatNumber: string) {
    await prisma.seatHold.updateMany({
        where: { flightId, seatNumber },
        data: {
            createdAt: new Date(Date.now() - (HOLD_MINUTES + 1) * 60_000),
            expiresAt: new Date(Date.now() - 60_000),
        },
    });
}

describe('holding a seat while the customer chooses', () => {
    it('gives the seat to exactly one of two simultaneous customers', async () => {
        // The whole point. Both calls start before either finishes, which is
        // the interleaving a check-then-write loses: each reads the seat as
        // free, and both write.
        const flight = await aFlight();
        const [first, second] = [aHolder(), aHolder()];

        const results = await Promise.all([
            holdSeat({ flightId: flight.id, seatNumber: '12A', holderKey: first }),
            holdSeat({ flightId: flight.id, seatNumber: '12A', holderKey: second }),
        ]);

        expect(results.filter(held => held).length).toBe(1);

        const rows = await prisma.seatHold.findMany({
            where: { flightId: flight.id, seatNumber: '12A' },
        });
        expect(rows).toHaveLength(1);
        expect([first, second]).toContain(rows[0].holderKey);
    });

    it('serializes opposite-order multi-seat claims without a partial winner', async () => {
        // Row locks alone deadlock here: each checkout takes its first seat and
        // waits for the other checkout's row on its second. The shared Flight
        // lock must make one checkout finish its complete set before the other
        // starts, regardless of the order received from the browser.
        const flight = await aFlight();
        const [first, second] = [aHolder(), aHolder()];
        const claims = [
            { flightId: flight.id, seatNumber: '12B' },
            { flightId: flight.id, seatNumber: '12C' },
        ];

        const results = await Promise.all([
            holdSeats(claims.map(claim => ({ ...claim, holderKey: first }))),
            holdSeats([...claims].reverse().map(claim => ({ ...claim, holderKey: second }))),
        ]);

        expect(results.map(result => result.taken.length).sort()).toEqual([0, 2]);
        const rows = await prisma.seatHold.findMany({
            where: { flightId: flight.id, seatNumber: { in: ['12B', '12C'] } },
        });
        expect(rows).toHaveLength(2);
        expect(new Set(rows.map(row => row.holderKey))).toHaveProperty('size', 1);
    });

    it('lets the holder take the same seat again without losing it', async () => {
        // Re-picking a seat you already hold, or a page that re-renders, must
        // not read as a competing customer and fail.
        const flight = await aFlight();
        const holder = aHolder();

        expect(await holdSeat({ flightId: flight.id, seatNumber: '3C', holderKey: holder })).toBe(true);
        expect(await holdSeat({ flightId: flight.id, seatNumber: '3C', holderKey: holder })).toBe(true);

        const rows = await prisma.seatHold.findMany({ where: { flightId: flight.id } });
        expect(rows).toHaveLength(1);
    });

    it('refuses a seat another customer is still holding', async () => {
        const flight = await aFlight();
        const [mine, theirs] = [aHolder(), aHolder()];

        expect(await holdSeat({ flightId: flight.id, seatNumber: '4D', holderKey: mine })).toBe(true);
        expect(await holdSeat({ flightId: flight.id, seatNumber: '4D', holderKey: theirs })).toBe(false);
    });

    it('hands an abandoned seat to the next customer once it expires', async () => {
        // No job releases these. An abandoned checkout stops mattering because
        // the hold stops being live, which is why a failed cleanup cannot
        // permanently reduce inventory.
        const flight = await aFlight();
        const [abandoned, next] = [aHolder(), aHolder()];

        await holdSeat({ flightId: flight.id, seatNumber: '5A', holderKey: abandoned });
        await abandon(flight.id, '5A');

        expect(await holdSeat({ flightId: flight.id, seatNumber: '5A', holderKey: next })).toBe(true);

        const rows = await prisma.seatHold.findMany({ where: { flightId: flight.id } });
        expect(rows).toHaveLength(1);
        expect(rows[0].holderKey).toBe(next);
    });

    it('hands over a hold that expires while the next customer waits for the flight lock', async () => {
        const flight = await aFlight();
        const [abandoned, next] = [aHolder(), aHolder()];
        await holdSeat({ flightId: flight.id, seatNumber: '5B', holderKey: abandoned });
        await prisma.$executeRaw`
            UPDATE "SeatHold"
            SET "createdAt" = statement_timestamp(),
                "expiresAt" = statement_timestamp() + interval '500 milliseconds'
            WHERE "flightId" = ${flight.id} AND "seatNumber" = '5B'
        `;

        let waitingClaim: Promise<boolean> | null = null;
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`
                SELECT "id" FROM "Flight" WHERE "id" = ${flight.id} FOR UPDATE
            `;
            // This transaction starts while the old claim is live, then waits
            // here until the Flight lock is released after it has expired.
            waitingClaim = holdSeat({ flightId: flight.id, seatNumber: '5B', holderKey: next });
            await tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.75)`;
        });

        expect(waitingClaim).not.toBeNull();
        await expect(waitingClaim!).resolves.toBe(true);
        await expect(prisma.seatHold.findFirstOrThrow({
            where: { flightId: flight.id, seatNumber: '5B' },
        })).resolves.toMatchObject({ holderKey: next });
    });

    it('holds for the stated number of minutes, not some other number', async () => {
        // The countdown a customer is shown comes from this, so a silent change
        // here is a promise broken on screen.
        const flight = await aFlight();
        const holder = aHolder();

        const before = Date.now();
        await holdSeat({ flightId: flight.id, seatNumber: '6B', holderKey: holder });
        const [row] = await prisma.seatHold.findMany({ where: { flightId: flight.id } });

        const held = row.expiresAt.getTime() - before;
        expect(held).toBeGreaterThan((HOLD_MINUTES - 1) * 60_000);
        expect(held).toBeLessThanOrEqual(HOLD_MINUTES * 60_000 + 5_000);
    });

    it('reports the earliest database expiry for the complete held set', async () => {
        const flights = await Promise.all([aFlight(), aFlight()]);
        const unrelatedFlight = await aFlight();
        const holderKey = aHolder();
        await holdSeat({ flightId: unrelatedFlight.id, seatNumber: '5A', holderKey });
        await abandon(unrelatedFlight.id, '5A');
        const claims = flights.flatMap((flight, legIndex) => ['C', 'D'].map(letter => ({
            flightId: flight.id,
            seatNumber: `${6 + legIndex}${letter}`,
            holderKey,
        })));

        const result = await holdSeats(claims);
        const rows = await prisma.seatHold.findMany({
            where: { flightId: { in: flights.map(flight => flight.id) }, holderKey },
            orderBy: { expiresAt: 'asc' },
        });

        expect(result.taken).toEqual([]);
        expect(rows).toHaveLength(4);
        expect(result.expiresAt).toEqual(rows[0].expiresAt);
        expect(result.expiresInMilliseconds).toBeGreaterThan((HOLD_MINUTES - 1) * 60_000);
        expect(result.expiresInMilliseconds).toBeLessThanOrEqual(HOLD_MINUTES * 60_000);
    });
});

describe('what the seat map counts as taken', () => {
    it("reports another customer's live hold and not your own", async () => {
        // Your own hold must not grey out the seat you just picked.
        const flight = await aFlight();
        const [mine, theirs] = [aHolder(), aHolder()];

        await holdSeat({ flightId: flight.id, seatNumber: '7A', holderKey: mine });
        await holdSeat({ flightId: flight.id, seatNumber: '7B', holderKey: theirs });

        expect(await seatsHeldByOthers(flight.id, mine)).toEqual(['7B']);
        expect(await seatsHeldByOthers(flight.id, theirs)).toEqual(['7A']);
    });

    it('stops reporting a hold the moment it expires', async () => {
        const flight = await aFlight();
        const [mine, theirs] = [aHolder(), aHolder()];

        await holdSeat({ flightId: flight.id, seatNumber: '8C', holderKey: theirs });
        expect(await seatsHeldByOthers(flight.id, mine)).toEqual(['8C']);

        await abandon(flight.id, '8C');
        expect(await seatsHeldByOthers(flight.id, mine)).toEqual([]);
    });

    it('frees the seat when the customer gives it up', async () => {
        const flight = await aFlight();
        const [mine, theirs] = [aHolder(), aHolder()];

        await holdSeat({ flightId: flight.id, seatNumber: '9D', holderKey: mine });
        await releaseHold({ flightId: flight.id, seatNumber: '9D', holderKey: mine });

        expect(await seatsHeldByOthers(flight.id, theirs)).toEqual([]);
    });

    it("will not let one customer release another's hold", async () => {
        const flight = await aFlight();
        const [mine, theirs] = [aHolder(), aHolder()];

        await holdSeat({ flightId: flight.id, seatNumber: '10A', holderKey: theirs });
        await releaseHold({ flightId: flight.id, seatNumber: '10A', holderKey: mine });

        expect(await seatsHeldByOthers(flight.id, mine)).toEqual(['10A']);
    });
});

describe('letting go of the seats a customer no longer wants', () => {
    it('keeps what is still chosen and drops what was abandoned', async () => {
        // A customer who goes back and swaps 3A for 3B would otherwise strand
        // 3A for the rest of its ten minutes, every time they change their
        // mind.
        const flight = await aFlight();
        const holder = aHolder();

        await holdSeat({ flightId: flight.id, seatNumber: '3A', holderKey: holder });
        await holdSeat({ flightId: flight.id, seatNumber: '3B', holderKey: holder });

        await releaseHoldsExcept([flight.id], holder, [
            { flightId: flight.id, seatNumber: '3B' },
        ]);

        const rows = await prisma.seatHold.findMany({ where: { flightId: flight.id } });
        expect(rows.map(row => row.seatNumber)).toEqual(['3B']);
    });

    it("never touches another customer's hold", async () => {
        // Scoped to the holder, or one customer's swap releases another's seat.
        const flight = await aFlight();
        const [mine, theirs] = [aHolder(), aHolder()];

        await holdSeat({ flightId: flight.id, seatNumber: '4A', holderKey: mine });
        await holdSeat({ flightId: flight.id, seatNumber: '4B', holderKey: theirs });

        await releaseHoldsExcept([flight.id], mine, []);

        const rows = await prisma.seatHold.findMany({ where: { flightId: flight.id } });
        expect(rows.map(row => row.seatNumber)).toEqual(['4B']);
        expect(rows[0].holderKey).toBe(theirs);
    });

    it('leaves the same customer alone on a flight it was not asked about', async () => {
        // A round trip releases per leg. Without the flight scope, advancing on
        // one leg would drop the seat held on the other.
        const [outbound, inbound] = [await aFlight(), await aFlight()];
        const holder = aHolder();

        await holdSeat({ flightId: outbound.id, seatNumber: '5A', holderKey: holder });
        await holdSeat({ flightId: inbound.id, seatNumber: '5A', holderKey: holder });

        await releaseHoldsExcept([outbound.id], holder, []);

        const left = await prisma.seatHold.findMany({ where: { holderKey: holder } });
        expect(left).toHaveLength(1);
        expect(left[0].flightId).toBe(inbound.id);
    });

    it('releases the same seat on the right leg only', async () => {
        // The seat number alone is ambiguous on a round trip -- the mistake
        // that told a customer their granted outbound seat had gone (#74).
        const [outbound, inbound] = [await aFlight(), await aFlight()];
        const holder = aHolder();

        await holdSeat({ flightId: outbound.id, seatNumber: '6A', holderKey: holder });
        await holdSeat({ flightId: inbound.id, seatNumber: '6A', holderKey: holder });

        await releaseHoldsExcept([outbound.id, inbound.id], holder, [
            { flightId: inbound.id, seatNumber: '6A' },
        ]);

        const left = await prisma.seatHold.findMany({ where: { holderKey: holder } });
        expect(left).toHaveLength(1);
        expect(left[0].flightId).toBe(inbound.id);
    });
});
