/** @jest-environment node */
import {
    checkoutHolderKey,
    holdCheckoutSeats,
    holdSeats,
    releaseHold,
    releaseHoldsExcept,
    SeatHoldCheckoutLimitError,
    SeatHoldUnavailableError,
} from '@/lib/seatHolds';
import { prisma } from '@/lib/prisma';

const events: string[] = [];
const databaseNow = new Date('2026-08-14T12:00:00.000Z');
const earliestExpiry = new Date('2026-08-14T12:09:59.500Z');
let activeCheckoutRows: { holderKey: string }[] = [];
const mockTx = {
    $queryRaw: jest.fn((query: unknown, ...values: unknown[]) => {
        const sql = Array.isArray(query) ? query.join('?') : String(query);
        if (sql.includes('pg_advisory_xact_lock')) {
            events.push(`account-lock:${values[0]}`);
            return Promise.resolve([{ locked: null }]);
        }
        if (sql.includes('SELECT DISTINCT "holderKey"')) {
            events.push(`active-checkouts:${values[1]}`);
            return Promise.resolve(activeCheckoutRows);
        }
        if (values.length > 0) {
            events.push(`lock:${values[0]}`);
            return Promise.resolve([]);
        }
        events.push('clock');
        return Promise.resolve([{ now: databaseNow }]);
    }),
    $executeRaw: jest.fn((_query: unknown, ...values: unknown[]) => {
        events.push(`claim:${values[1]}:${values[2]}`);
        return Promise.resolve(1);
    }),
    seatHold: {
        deleteMany: jest.fn(() => {
            events.push('release');
            return Promise.resolve({ count: 0 });
        }),
        findMany: jest.fn(() => {
            events.push('expiry');
            return Promise.resolve([
                { expiresAt: new Date('2026-08-14T12:10:00.000Z') },
                { expiresAt: earliestExpiry },
            ]);
        }),
    },
    seatAssignment: {
        findMany: jest.fn(({ where }: { where: { flightId: number } }) => {
            events.push(`occupancy:${where.flightId}`);
            return Promise.resolve([]);
        }),
    },
};

jest.mock('@/lib/prisma', () => ({
    prisma: {
        $transaction: jest.fn((callback) => callback(mockTx)),
    },
}));

describe('multi-seat hold transaction', () => {
    beforeEach(() => {
        events.length = 0;
        activeCheckoutRows = [];
        jest.clearAllMocks();
    });

    it('locks every flight before releasing or claiming seats in stable order', async () => {
        const holderKey = '["user","checkout"]';

        await expect(holdSeats([
            { flightId: 9, seatNumber: '12B', holderKey },
            { flightId: 5, seatNumber: '12C', holderKey },
            { flightId: 5, seatNumber: '12A', holderKey },
        ])).resolves.toEqual({
            taken: [],
            expiresAt: earliestExpiry,
            expiresInMilliseconds: 599_500,
        });

        expect(events).toEqual([
            'lock:5',
            'lock:9',
            'release',
            'occupancy:5',
            'occupancy:9',
            'claim:5:12A',
            'claim:5:12C',
            'claim:9:12B',
            'expiry',
            'clock',
        ]);
    });

    it('rejects claims from more than one checkout before opening a transaction', async () => {
        await expect(holdSeats([
            { flightId: 5, seatNumber: '12A', holderKey: 'first' },
            { flightId: 5, seatNumber: '12B', holderKey: 'second' },
        ])).rejects.toThrow('Seat claims must belong to one checkout.');

        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('takes the account admission lock before inspecting or claiming inventory', async () => {
        activeCheckoutRows = [{ holderKey: checkoutHolderKey('user-1', 'first-checkout') }];

        await holdCheckoutSeats('user-1', 'second-checkout', [
            { flightId: 5, seatNumber: '12A' },
        ]);

        expect(events).toEqual([
            'account-lock:user-1',
            'active-checkouts:["user-1",',
            'lock:5',
            'release',
            'occupancy:5',
            'claim:5:12A',
            'expiry',
            'clock',
        ]);
    });

    it('allows an existing checkout at the limit but refuses a new one before flight locks', async () => {
        const current = checkoutHolderKey('user-1', 'current-checkout');
        activeCheckoutRows = [current, checkoutHolderKey('user-1', 'other-checkout')]
            .map(holderKey => ({ holderKey }));

        await expect(holdCheckoutSeats('user-1', 'current-checkout', [
            { flightId: 5, seatNumber: '12A' },
        ])).resolves.toMatchObject({ taken: [] });

        events.length = 0;
        await expect(holdCheckoutSeats('user-1', 'third-checkout', [
            { flightId: 9, seatNumber: '12B' },
        ])).rejects.toBeInstanceOf(SeatHoldCheckoutLimitError);
        expect(events).toEqual([
            'account-lock:user-1',
            'active-checkouts:["user-1",',
        ]);
    });

    it('locks the flight before releasing one hold', async () => {
        await releaseHold({ flightId: 9, seatNumber: '12A', holderKey: 'holder' });

        expect(events).toEqual(['lock:9', 'release']);
    });

    it('locks every flight in stable order before releasing abandoned holds', async () => {
        await releaseHoldsExcept([9, 5, 9], 'holder', []);

        expect(events).toEqual(['lock:5', 'lock:9', 'release']);
    });
});

describe('SeatHoldUnavailableError', () => {
    const claim = { flightId: 5, seatNumber: '12A', holderKey: 'holder' };

    it('formats error without leg clause when none is provided', () => {
        const error = new SeatHoldUnavailableError(claim);
        expect(error.message).toBe('Seat 12A is no longer held for this checkout. Please choose a seat again.');
        expect(error.claim).toBe(claim);
        expect(error.legClause).toBe('');
        expect(error.name).toBe('SeatHoldUnavailableError');
    });

    it('formats error with direction string', () => {
        const error = new SeatHoldUnavailableError(claim, 'departing');
        expect(error.message).toBe('Seat 12A on the departing flight is no longer held for this checkout. Please choose a seat again.');
        expect(error.legClause).toBe(' on the departing flight');
    });

    it('formats error with full leg clause phrase', () => {
        const error = new SeatHoldUnavailableError(claim, ' on the return flight');
        expect(error.message).toBe('Seat 12A on the return flight is no longer held for this checkout. Please choose a seat again.');
        expect(error.legClause).toBe(' on the return flight');
    });

    it('formats error with numbered leg clause phrase', () => {
        const error = new SeatHoldUnavailableError(claim, ' on leg 2');
        expect(error.message).toBe('Seat 12A on leg 2 is no longer held for this checkout. Please choose a seat again.');
        expect(error.legClause).toBe(' on leg 2');
    });
});
