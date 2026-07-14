import { prisma } from '@/lib/prisma';
import {
    decryptPassengerData,
    encryptPassengerData,
    getConfiguredPassengerDataEncryptionKeys,
} from '@/lib/passengerDataProtection';

export async function rotatePassengerDataEncryptionBatch(batchSize = 100): Promise<number> {
    const keyRing = getConfiguredPassengerDataEncryptionKeys();
    const activePrefix = `v1:${keyRing.activeKeyId}:`;
    const passengers = await prisma.passenger.findMany({
        where: {
            sensitiveDataDeletedAt: null,
            dateOfBirthEncrypted: { not: null },
            passportNumberEncrypted: { not: null },
            OR: [
                { dateOfBirthEncrypted: { not: { startsWith: activePrefix } } },
                { passportNumberEncrypted: { not: { startsWith: activePrefix } } },
            ],
        },
        select: {
            id: true,
            dateOfBirthEncrypted: true,
            passportNumberEncrypted: true,
        },
        take: batchSize,
        orderBy: { id: 'asc' },
    });

    const results = await prisma.$transaction(passengers.map(passenger => {
        if (!passenger.dateOfBirthEncrypted || !passenger.passportNumberEncrypted) {
            throw new Error('Passenger identity data is incomplete.');
        }
        const dateOfBirth = decryptPassengerData(passenger.dateOfBirthEncrypted, {
            passengerId: passenger.id,
            field: 'dateOfBirth',
        }, keyRing);
        const passportNumber = decryptPassengerData(passenger.passportNumberEncrypted, {
            passengerId: passenger.id,
            field: 'passportNumber',
        }, keyRing);
        return prisma.passenger.updateMany({
            where: {
                id: passenger.id,
                sensitiveDataDeletedAt: null,
            },
            data: {
                dateOfBirthEncrypted: encryptPassengerData(dateOfBirth, {
                    passengerId: passenger.id,
                    field: 'dateOfBirth',
                }, keyRing),
                passportNumberEncrypted: encryptPassengerData(passportNumber, {
                    passengerId: passenger.id,
                    field: 'passportNumber',
                }, keyRing),
            },
        });
    }));

    return results.reduce((count, result) => count + result.count, 0);
}
