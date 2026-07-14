/** @jest-environment node */
import { prisma } from '@/lib/prisma';
import { encryptPassengerData, parsePassengerDataEncryptionKeys } from '@/lib/passengerDataProtection';
import { rotatePassengerDataEncryptionBatch } from '@/lib/passengerDataRotation';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        passenger: {
            findMany: jest.fn(),
            updateMany: jest.fn(),
        },
        $transaction: jest.fn(callbacks => Promise.all(callbacks)),
    },
}));

const findMany = prisma.passenger.findMany as jest.Mock;
const updateMany = prisma.passenger.updateMany as jest.Mock;
const ACTIVE_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const OLD_KEY = Buffer.from('abcdef0123456789abcdef0123456789').toString('base64');

describe('passenger data key rotation', () => {
    const originalKeys = process.env.PASSENGER_DATA_ENCRYPTION_KEYS;

    afterAll(() => {
        process.env.PASSENGER_DATA_ENCRYPTION_KEYS = originalKeys;
    });

    it('re-encrypts retained ciphertext with the active key in bounded batches', async () => {
        process.env.PASSENGER_DATA_ENCRYPTION_KEYS = `active:${ACTIVE_KEY},old:${OLD_KEY}`;
        const oldKeys = parsePassengerDataEncryptionKeys(`old:${OLD_KEY}`);
        const passengerId = 'passenger-1';
        findMany.mockResolvedValue([{
            id: passengerId,
            dateOfBirthEncrypted: encryptPassengerData('1990-01-01', {
                passengerId,
                field: 'dateOfBirth',
            }, oldKeys),
            passportNumberEncrypted: encryptPassengerData('US123456', {
                passengerId,
                field: 'passportNumber',
            }, oldKeys),
        }]);
        updateMany.mockResolvedValue({ count: 1 });

        await expect(rotatePassengerDataEncryptionBatch(25)).resolves.toBe(1);
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
        expect(updateMany).toHaveBeenCalledWith({
            where: { id: passengerId, sensitiveDataDeletedAt: null },
            data: {
                dateOfBirthEncrypted: expect.stringMatching(/^v1:active:/),
                passportNumberEncrypted: expect.stringMatching(/^v1:active:/),
            },
        });
    });
});
