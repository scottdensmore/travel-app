import {
    FlightScheduleActivationError,
    FlightScheduleActivationService,
} from '@/lib/flightScheduleActivationService';
import { prisma } from '@/lib/prisma';

const tx = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    flightSchedule: {
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    flight: { count: jest.fn() },
};

jest.mock('@/lib/prisma', () => ({
    prisma: {
        $transaction: jest.fn(callback => callback(tx)),
    },
}));

describe('FlightScheduleActivationService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        tx.$queryRaw.mockResolvedValue([{ id: 17 }]);
        tx.flightSchedule.findUnique.mockResolvedValue({ id: 17, isActive: true });
        tx.flightSchedule.update.mockResolvedValue({ id: 17, isActive: false });
        tx.flight.count.mockResolvedValue(4);
    });

    it('deactivates only the template and reports preserved linked occurrences', async () => {
        const result = await new FlightScheduleActivationService().setActive(17, false);

        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        const [advisorySql, namespace, scheduleId] = tx.$executeRaw.mock.calls[0];
        expect(advisorySql.join('?')).toContain('pg_advisory_xact_lock');
        expect(namespace).toBe(834_206);
        expect(scheduleId).toBe(17);
        expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
        const [rowLockSql, rowLockId] = tx.$queryRaw.mock.calls[0];
        expect(rowLockSql.join('?')).toContain('FOR UPDATE');
        expect(rowLockId).toBe(17);
        expect(tx.flightSchedule.update).toHaveBeenCalledWith({
            where: { id: 17 },
            data: { isActive: false },
        });
        expect(tx.flight.count).toHaveBeenCalledWith({ where: { flightScheduleId: 17 } });
        expect(result).toEqual({
            flightScheduleId: 17,
            isActive: false,
            changed: true,
            preservedOccurrenceCount: 4,
        });
    });

    it('makes a lost-response retry idempotent without another write', async () => {
        tx.flightSchedule.findUnique.mockResolvedValue({ id: 17, isActive: false });

        await expect(new FlightScheduleActivationService().setActive(17, false)).resolves.toEqual({
            flightScheduleId: 17,
            isActive: false,
            changed: false,
            preservedOccurrenceCount: 4,
        });
        expect(tx.flightSchedule.update).not.toHaveBeenCalled();
    });

    it('reports a missing schedule after taking the schedule lock', async () => {
        tx.$queryRaw.mockResolvedValueOnce([]);

        await expect(new FlightScheduleActivationService().setActive(404, false))
            .rejects.toEqual(expect.objectContaining<Partial<FlightScheduleActivationError>>({
                code: 'NOT_FOUND',
                message: 'This flight schedule no longer exists.',
            }));
        expect(tx.flightSchedule.update).not.toHaveBeenCalled();
    });

    it('runs through the product transaction boundary', async () => {
        await new FlightScheduleActivationService().setActive(17, true);

        expect(prisma.$transaction).toHaveBeenCalledWith(
            expect.any(Function),
            { timeout: 60_000 },
        );
    });
});
