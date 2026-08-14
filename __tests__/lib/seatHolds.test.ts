/** @jest-environment node */
import { holdSeats, releaseHold, releaseHoldsExcept } from '@/lib/seatHolds';
import { prisma } from '@/lib/prisma';

const events: string[] = [];
const mockTx = {
    $queryRaw: jest.fn((_query: unknown, ...values: unknown[]) => {
        events.push(`lock:${values[0]}`);
        return Promise.resolve([]);
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
        jest.clearAllMocks();
    });

    it('locks every flight before releasing or claiming seats in stable order', async () => {
        const holderKey = '["user","checkout"]';

        await expect(holdSeats([
            { flightId: 9, seatNumber: '12B', holderKey },
            { flightId: 5, seatNumber: '12C', holderKey },
            { flightId: 5, seatNumber: '12A', holderKey },
        ])).resolves.toEqual([]);

        expect(events).toEqual([
            'lock:5',
            'lock:9',
            'release',
            'occupancy:5',
            'occupancy:9',
            'claim:5:12A',
            'claim:5:12C',
            'claim:9:12B',
        ]);
    });

    it('rejects claims from more than one checkout before opening a transaction', async () => {
        await expect(holdSeats([
            { flightId: 5, seatNumber: '12A', holderKey: 'first' },
            { flightId: 5, seatNumber: '12B', holderKey: 'second' },
        ])).rejects.toThrow('Seat claims must belong to one checkout.');

        expect(prisma.$transaction).not.toHaveBeenCalled();
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
