/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
    prisma: {
        $transaction: jest.fn(),
        flightScheduleTermsChange: { findUnique: jest.fn() },
    },
}));

import {
    FlightScheduleTermsError,
    FlightScheduleTermsService,
} from '@/lib/flightScheduleTermsService';
import { prisma } from '@/lib/prisma';

const transaction = prisma.$transaction as jest.Mock;
const findExistingChange = prisma.flightScheduleTermsChange.findUnique as jest.Mock;
const createdAt = new Date('2026-08-17T15:00:00.000Z');
const asOf = new Date('2026-08-17T12:00:00.000Z');

function audit(overrides: Record<string, unknown> = {}) {
    return {
        id: 'change-17',
        requestId: '8ea59a65-9251-45b3-95d0-3920c49f5735',
        flightScheduleId: 17,
        actorUserId: 'staff-1',
        fromDurationMinutes: 245,
        toDurationMinutes: 255,
        fromPriceCents: 35_000,
        toPriceCents: 37_500,
        updatedOccurrenceCount: 1,
        protectedOccurrenceCount: 4,
        createdAt,
        ...overrides,
    };
}

function transactionClient() {
    return {
        $queryRaw: jest.fn()
            .mockResolvedValueOnce([{ id: 17 }])
            .mockResolvedValueOnce([{ id: 71 }, { id: 72 }, { id: 73 }, { id: 74 }, { id: 75 }])
            .mockResolvedValueOnce([{ now: asOf }]),
        flightScheduleTermsChange: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(audit()),
        },
        flightSchedule: {
            findUnique: jest.fn().mockResolvedValue({
                id: 17,
                durationMinutes: 245,
                priceCents: 35_000,
            }),
            update: jest.fn().mockResolvedValue({ id: 17 }),
        },
        flight: {
            findMany: jest.fn().mockResolvedValue([
                occurrence(71, '2026-08-16T12:00:00.000Z'),
                occurrence(72, '2026-08-18T12:00:00.000Z', [91]),
                occurrence(73, '2026-08-19T12:00:00.000Z', [], true),
                occurrence(74, '2026-08-20T12:00:00.000Z', [], false, 'DELAYED'),
                occurrence(75, '2026-08-21T12:00:00.000Z'),
            ]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    };
}

const input = {
    requestId: '8ea59a65-9251-45b3-95d0-3920c49f5735',
    flightScheduleId: 17,
    actorUserId: 'staff-1',
    durationMinutes: 255,
    priceCents: 37_500,
};

describe('FlightScheduleTermsService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        transaction.mockReset();
        findExistingChange.mockReset();
    });

    it('atomically updates only freshly classified safe occurrences and records the audit', async () => {
        const tx = transactionClient();
        transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

        await expect(new FlightScheduleTermsService().update(input)).resolves.toEqual({
            changeId: 'change-17',
            flightScheduleId: 17,
            durationMinutes: 255,
            priceCents: 37_500,
            updatedOccurrenceCount: 1,
            protectedOccurrenceCount: 4,
            createdAt,
            wasApplied: true,
        });

        expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
        expect(sql(tx.$queryRaw.mock.calls[0])).toContain('FROM "FlightSchedule"');
        expect(sql(tx.$queryRaw.mock.calls[0])).toContain('FOR UPDATE');
        expect(sql(tx.$queryRaw.mock.calls[1])).toContain('ORDER BY "id"');
        expect(sql(tx.$queryRaw.mock.calls[1])).toContain('FOR UPDATE');
        expect(sql(tx.$queryRaw.mock.calls[2])).toContain('statement_timestamp()');
        expect(tx.flight.findMany).toHaveBeenCalledWith({
            where: { flightScheduleId: 17 },
            orderBy: { id: 'asc' },
            select: {
                id: true,
                departureDate: true,
                status: true,
                itineraryLegs: { select: { bookingId: true } },
                seatHolds: {
                    where: { expiresAt: { gt: asOf } },
                    select: { id: true },
                    take: 1,
                },
            },
        });
        expect(tx.flightSchedule.update).toHaveBeenCalledWith({
            where: { id: 17 },
            data: { durationMinutes: 255, priceCents: 37_500 },
        });
        expect(tx.flight.updateMany).toHaveBeenCalledWith({
            where: { id: { in: [75] } },
            data: { durationMinutes: 255, priceCents: 37_500 },
        });
        expect(tx.flightScheduleTermsChange.create).toHaveBeenCalledWith({
            data: {
                requestId: input.requestId,
                flightScheduleId: 17,
                actorUserId: 'staff-1',
                fromDurationMinutes: 245,
                toDurationMinutes: 255,
                fromPriceCents: 35_000,
                toPriceCents: 37_500,
                updatedOccurrenceCount: 1,
                protectedOccurrenceCount: 4,
            },
        });
    });

    it('returns the durable result when a lost response is retried', async () => {
        const tx = transactionClient();
        tx.flightScheduleTermsChange.findUnique.mockResolvedValue(audit());
        transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

        await expect(new FlightScheduleTermsService().update(input)).resolves.toMatchObject({
            changeId: 'change-17',
            wasApplied: false,
            updatedOccurrenceCount: 1,
            protectedOccurrenceCount: 4,
        });
        expect(tx.$queryRaw).not.toHaveBeenCalled();
        expect(tx.flightSchedule.update).not.toHaveBeenCalled();
        expect(tx.flight.updateMany).not.toHaveBeenCalled();
        expect(tx.flightScheduleTermsChange.create).not.toHaveBeenCalled();
    });

    it('re-reads an update that committed while the retry waited for the schedule lock', async () => {
        const tx = transactionClient();
        tx.flightScheduleTermsChange.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(audit());
        transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

        await expect(new FlightScheduleTermsService().update(input)).resolves.toMatchObject({
            changeId: 'change-17',
            wasApplied: false,
        });
        expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
        expect(tx.flightSchedule.update).not.toHaveBeenCalled();
        expect(tx.flight.updateMany).not.toHaveBeenCalled();
    });

    it('recovers the durable winner of a cross-schedule request-key race', async () => {
        transaction.mockRejectedValue({ code: 'P2002' });
        findExistingChange.mockResolvedValue(audit());

        await expect(new FlightScheduleTermsService().update(input)).resolves.toMatchObject({
            changeId: 'change-17',
            wasApplied: false,
        });
        expect(findExistingChange).toHaveBeenCalledWith({
            where: { requestId: input.requestId },
        });
    });

    it('refuses to reuse a request key for different terms', async () => {
        const tx = transactionClient();
        tx.flightScheduleTermsChange.findUnique.mockResolvedValue(audit({ toPriceCents: 99_999 }));
        transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

        await expect(new FlightScheduleTermsService().update(input)).rejects.toMatchObject({
            name: 'FlightScheduleTermsError',
            code: 'REQUEST_REUSED',
        });
        expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it.each([
        ['schedule', { flightScheduleId: 18 }],
        ['duration', { durationMinutes: 260 }],
    ])('refuses to reuse a request key for a different %s', async (_label, changedInput) => {
        const tx = transactionClient();
        tx.flightScheduleTermsChange.findUnique.mockResolvedValue(audit());
        transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

        await expect(new FlightScheduleTermsService().update({
            ...input,
            ...changedInput,
        })).rejects.toMatchObject({ code: 'REQUEST_REUSED' });
        expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('refuses to reuse another staff member\'s request key', async () => {
        const tx = transactionClient();
        tx.flightScheduleTermsChange.findUnique.mockResolvedValue(audit());
        transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

        await expect(new FlightScheduleTermsService().update({
            ...input,
            actorUserId: 'staff-2',
        })).rejects.toMatchObject({ code: 'REQUEST_REUSED' });
    });

    it('refuses a no-op rather than writing misleading audit history', async () => {
        const tx = transactionClient();
        tx.flightSchedule.findUnique.mockResolvedValue({
            id: 17,
            durationMinutes: 255,
            priceCents: 37_500,
        });
        transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

        await expect(new FlightScheduleTermsService().update(input)).rejects.toEqual(
            expect.objectContaining<Partial<FlightScheduleTermsError>>({
                code: 'NO_CHANGES',
            }),
        );
        expect(tx.flightSchedule.update).not.toHaveBeenCalled();
        expect(tx.flightScheduleTermsChange.create).not.toHaveBeenCalled();
    });

    it.each([
        ['duration only', { durationMinutes: 255, priceCents: 35_000 }],
        ['fare only', { durationMinutes: 245, priceCents: 37_500 }],
    ])('applies a %s change', async (_label, changedInput) => {
        const tx = transactionClient();
        transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

        await expect(new FlightScheduleTermsService().update({
            ...input,
            ...changedInput,
        })).resolves.toMatchObject({ wasApplied: true });
        expect(tx.flightSchedule.update).toHaveBeenCalledWith({
            where: { id: 17 },
            data: changedInput,
        });
    });

    it('reports a deleted schedule without attempting any writes', async () => {
        const tx = transactionClient();
        tx.$queryRaw.mockReset().mockResolvedValueOnce([]);
        transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

        await expect(new FlightScheduleTermsService().update(input)).rejects.toMatchObject({
            code: 'NOT_FOUND',
        });
        expect(tx.flightSchedule.update).not.toHaveBeenCalled();
        expect(tx.flightScheduleTermsChange.create).not.toHaveBeenCalled();
    });

    it('aborts rather than auditing a partial safe-occurrence update', async () => {
        const tx = transactionClient();
        tx.flight.updateMany.mockResolvedValue({ count: 0 });
        transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

        await expect(new FlightScheduleTermsService().update(input)).rejects.toThrow(
            'The safe schedule occurrence set changed during the update.',
        );
        expect(tx.flightScheduleTermsChange.create).not.toHaveBeenCalled();
    });
});

function occurrence(
    id: number,
    departureDate: string,
    bookingIds: number[] = [],
    hasActiveCheckout = false,
    status: 'ON_TIME' | 'DELAYED' = 'ON_TIME',
) {
    return {
        id,
        departureDate: new Date(departureDate),
        status,
        itineraryLegs: bookingIds.map(bookingId => ({ bookingId })),
        seatHolds: hasActiveCheckout ? [{ id: `hold-${id}` }] : [],
    };
}

function sql(call: unknown[]) {
    const [parts] = call as [TemplateStringsArray];
    return parts.join('?');
}
