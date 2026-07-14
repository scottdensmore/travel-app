import { prisma } from '@/lib/prisma';

const purgeValues = (now: Date) => ({
    dateOfBirthEncrypted: null,
    passportNumberEncrypted: null,
    sensitiveDataDeletedAt: now,
});

export async function purgeExpiredPassengerData(now = new Date()): Promise<number> {
    const result = await prisma.passenger.updateMany({
        where: {
            sensitiveDataDeletedAt: null,
            sensitiveDataExpiresAt: { lte: now },
        },
        data: purgeValues(now),
    });
    return result.count;
}

export async function purgePassengerDataForUser(userId: string, now = new Date()): Promise<number> {
    const result = await prisma.passenger.updateMany({
        where: {
            booking: { userId },
            sensitiveDataDeletedAt: null,
        },
        data: purgeValues(now),
    });
    return result.count;
}
