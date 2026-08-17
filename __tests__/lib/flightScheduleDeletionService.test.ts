import {
    FlightScheduleDeletionError,
    FlightScheduleDeletionService,
} from '@/lib/flightScheduleDeletionService';
import { prisma } from '@/lib/prisma';

const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    flightScheduleDeletion: { findUnique: jest.fn(), create: jest.fn() },
    flightSchedule: { findUnique: jest.fn(), delete: jest.fn() },
    flight: { findMany: jest.fn() },
};

jest.mock('@/lib/prisma', () => ({
    prisma: {
        $transaction: jest.fn(callback => callback(tx)),
        flightScheduleDeletion: { findUnique: jest.fn() },
    },
}));

describe('FlightScheduleDeletionService', () => {
    const input = {
        requestId: '8ea59a65-9251-45b3-95d0-3920c49f5735',
        flightScheduleId: 17,
        actorUserId: 'staff-1',
    };
    const storedDeletion = {
        id: 'delete-1',
        requestId: input.requestId,
        flightScheduleId: input.flightScheduleId,
        actorUserId: input.actorUserId,
        occurrenceCount: 1,
        protectedOccurrenceCount: 1,
        deletedAt: new Date('2026-08-17T12:00:00Z'),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));
        (prisma.flightScheduleDeletion.findUnique as jest.Mock).mockResolvedValue(null);
        tx.flightScheduleDeletion.findUnique.mockResolvedValue(null);
        tx.$queryRaw
            .mockResolvedValueOnce([{ id: 17 }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ now: new Date('2026-08-17T12:00:00Z') }]);
        tx.flightSchedule.findUnique.mockResolvedValue({
            id: 17,
            flightNumber: 'MA237',
            airline: 'Mona Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureTime: '08:00',
            durationMinutes: 245,
            daysOfWeek: [1, 3, 5],
            priceCents: 35_000,
            isActive: false,
            firstClassRows: 3,
            businessRows: 3,
            premiumEconomyRows: 4,
            economyRows: 20,
            seatPattern: 'ABC-DEF',
        });
        tx.flight.findMany.mockResolvedValue([{
            departureDate: new Date('2027-01-11T16:00:00Z'),
            status: 'ON_TIME',
            itineraryLegs: [{ bookingId: 9 }],
            seatHolds: [],
        }]);
        tx.flightScheduleDeletion.create.mockImplementation(({ data }) => Promise.resolve({
            ...storedDeletion,
            ...data,
        }));
    });

    it('deletes only an inactive template and records its preserved impact', async () => {
        await expect(new FlightScheduleDeletionService().delete(input)).resolves.toMatchObject({
            deletionId: 'delete-1',
            flightScheduleId: 17,
            occurrenceCount: 1,
            protectedOccurrenceCount: 1,
            wasDeleted: true,
        });
        expect(tx.flightScheduleDeletion.create).toHaveBeenCalledWith({
            data: {
                requestId: input.requestId,
                flightScheduleId: 17,
                actorUserId: 'staff-1',
                flightNumber: 'MA237',
                airline: 'Mona Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '08:00',
                durationMinutes: 245,
                daysOfWeek: [1, 3, 5],
                priceCents: 35_000,
                firstClassRows: 3,
                businessRows: 3,
                premiumEconomyRows: 4,
                economyRows: 20,
                seatPattern: 'ABC-DEF',
                occurrenceCount: 1,
                protectedOccurrenceCount: 1,
            },
        });
        expect(tx.flightSchedule.delete).toHaveBeenCalledWith({ where: { id: 17 } });
        const [lockSql, namespace, lockedScheduleId] = tx.$executeRaw.mock.calls[0];
        expect(lockSql.join('?')).toContain('pg_advisory_xact_lock');
        expect(namespace).toBe(834_206);
        expect(lockedScheduleId).toBe(17);
        expect(tx.$executeRaw.mock.invocationCallOrder[0])
            .toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
        const [scheduleLockSql, scheduleId] = tx.$queryRaw.mock.calls[0];
        expect(scheduleLockSql.join('?')).toContain('FOR UPDATE');
        expect(scheduleId).toBe(17);
        const [flightLockSql, linkedScheduleId] = tx.$queryRaw.mock.calls[1];
        expect(flightLockSql.join('?')).toContain('ORDER BY "id" FOR UPDATE');
        expect(linkedScheduleId).toBe(17);
        expect(tx.flight.findMany).toHaveBeenCalledWith({
            where: { flightScheduleId: 17 },
            orderBy: { id: 'asc' },
            select: {
                departureDate: true,
                status: true,
                itineraryLegs: { select: { bookingId: true } },
                seatHolds: {
                    where: { expiresAt: { gt: new Date('2026-08-17T12:00:00Z') } },
                    select: { id: true },
                    take: 1,
                },
            },
        });
        expect(tx.flightScheduleDeletion.create.mock.invocationCallOrder[0])
            .toBeLessThan(tx.flightSchedule.delete.mock.invocationCallOrder[0]);
    });

    it('requires reversible deactivation before permanent deletion', async () => {
        tx.flightSchedule.findUnique.mockResolvedValue({ id: 17, isActive: true });

        await expect(new FlightScheduleDeletionService().delete(input)).rejects.toEqual(
            expect.objectContaining<Partial<FlightScheduleDeletionError>>({ code: 'ACTIVE' }),
        );
        expect(tx.flightScheduleDeletion.create).not.toHaveBeenCalled();
        expect(tx.flightSchedule.delete).not.toHaveBeenCalled();
    });

    it('returns an exact prior result before reading a schedule on a same-request retry', async () => {
        tx.flightScheduleDeletion.findUnique.mockResolvedValue(storedDeletion);

        await expect(new FlightScheduleDeletionService().delete(input)).resolves.toEqual({
            deletionId: 'delete-1',
            flightScheduleId: 17,
            occurrenceCount: 1,
            protectedOccurrenceCount: 1,
            deletedAt: storedDeletion.deletedAt,
            wasDeleted: false,
        });
        expect(tx.$queryRaw).not.toHaveBeenCalled();
        expect(tx.flightSchedule.delete).not.toHaveBeenCalled();
    });

    it.each([
        ['schedule', { ...input, flightScheduleId: 18 }],
        ['actor', { ...input, actorUserId: 'staff-2' }],
    ])('rejects a retry key rebound to a different %s', async (_field, reboundInput) => {
        tx.flightScheduleDeletion.findUnique.mockResolvedValue(storedDeletion);

        await expect(new FlightScheduleDeletionService().delete(reboundInput))
            .rejects.toEqual(expect.objectContaining<Partial<FlightScheduleDeletionError>>({
                code: 'REQUEST_REUSED',
            }));
        expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('fails safely when the locked schedule no longer exists', async () => {
        tx.$queryRaw.mockReset().mockResolvedValueOnce([]);

        await expect(new FlightScheduleDeletionService().delete(input))
            .rejects.toEqual(expect.objectContaining<Partial<FlightScheduleDeletionError>>({
                code: 'NOT_FOUND',
            }));
        expect(tx.flightScheduleDeletion.create).not.toHaveBeenCalled();
        expect(tx.flightSchedule.delete).not.toHaveBeenCalled();
    });

    it('recovers the committed receipt after a lost-response unique conflict', async () => {
        (prisma.$transaction as jest.Mock).mockRejectedValueOnce({ code: 'P2002' });
        (prisma.flightScheduleDeletion.findUnique as jest.Mock).mockResolvedValue(storedDeletion);

        await expect(new FlightScheduleDeletionService().delete(input)).resolves.toEqual({
            deletionId: 'delete-1',
            flightScheduleId: 17,
            occurrenceCount: 1,
            protectedOccurrenceCount: 1,
            deletedAt: storedDeletion.deletedAt,
            wasDeleted: false,
        });
        expect(prisma.flightScheduleDeletion.findUnique).toHaveBeenCalledWith({
            where: { requestId: input.requestId },
        });
    });

    it('rethrows a unique conflict when no committed same-request winner exists', async () => {
        const conflict = { code: 'P2002', meta: { target: ['flightScheduleId'] } };
        (prisma.$transaction as jest.Mock).mockRejectedValueOnce(conflict);

        await expect(new FlightScheduleDeletionService().delete(input)).rejects.toBe(conflict);
    });
});
