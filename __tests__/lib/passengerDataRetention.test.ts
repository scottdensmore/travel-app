/** @jest-environment node */
import { prisma } from '@/lib/prisma';
import {
    purgeExpiredPassengerData,
    purgePassengerDataForUser,
} from '@/lib/passengerDataRetention';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        passenger: { updateMany: jest.fn() },
    },
}));

const updateMany = prisma.passenger.updateMany as jest.Mock;

describe('passenger data retention', () => {
    beforeEach(() => updateMany.mockReset());

    it('purges expired encrypted fields without deleting the booking record', async () => {
        updateMany.mockResolvedValue({ count: 2 });
        const now = new Date('2026-09-01T00:00:00.000Z');

        await expect(purgeExpiredPassengerData(now)).resolves.toBe(2);
        expect(updateMany).toHaveBeenCalledWith({
            where: {
                sensitiveDataDeletedAt: null,
                sensitiveDataExpiresAt: { lte: now },
            },
            data: {
                dateOfBirthEncrypted: null,
                passportNumberEncrypted: null,
                sensitiveDataDeletedAt: now,
            },
        });
    });

    it('supports immediate erasure for a customer deletion request', async () => {
        updateMany.mockResolvedValue({ count: 1 });
        const now = new Date('2026-07-14T00:00:00.000Z');

        await expect(purgePassengerDataForUser('user-1', now)).resolves.toBe(1);
        expect(updateMany).toHaveBeenCalledWith({
            where: {
                booking: { userId: 'user-1' },
                sensitiveDataDeletedAt: null,
            },
            data: {
                dateOfBirthEncrypted: null,
                passportNumberEncrypted: null,
                sensitiveDataDeletedAt: now,
            },
        });
    });
});
