/** @jest-environment node */
import FlightBookingService from '@/lib/FlightBookingService';
import { prisma } from '@/lib/prisma';
import { decryptPassengerData } from '@/lib/passengerDataProtection';
import { purgeExpiredPassengerData } from '@/lib/passengerDataRetention';

describe('passenger identity data in PostgreSQL', () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `passenger-data-${suffix}@example.com`;
    const flightNumber = `PD${suffix.slice(-6)}`;
    let userId: string;
    let flightId: number;
    let bookingId: number;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: { email, emailVerified: new Date(), name: 'Privacy Test' },
        });
        userId = user.id;
        const flight = await prisma.flight.create({
            data: {
                flightNumber,
                airline: 'Privacy Air',
                from: 'SEA',
                to: 'SFO',
                departureDate: new Date('2099-01-01T10:00:00.000Z'),
                price: '$100',
                status: 'ON_TIME',
                economyRows: 20,
                seatPattern: 'ABC-DEF',
            },
        });
        flightId = flight.id;
    });

    afterAll(async () => {
        if (bookingId) await prisma.booking.deleteMany({ where: { id: bookingId } });
        if (flightId) await prisma.flight.deleteMany({ where: { id: flightId } });
        if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    });

    it('stores only ciphertext, returns only safe fields, and purges on expiry', async () => {
        const result = await new FlightBookingService().bookFlight({
            flightId,
            userId,
            idempotencyKey: crypto.randomUUID(),
            passengers: [{
                firstName: 'Ada',
                lastName: 'Lovelace',
                dateOfBirth: '1990-01-01',
                passportNumber: 'SECRET123',
                gender: 'Female',
                seatNumber: '11A',
                cabinClass: 'ECONOMY',
            }],
        });
        bookingId = result.id;
        expect(result.passengers[0]).toEqual({
            id: expect.any(String),
            firstName: 'Ada',
            lastName: 'Lovelace',
            gender: 'Female',
            seatNumber: '11A',
            cabinClass: 'ECONOMY',
        });

        const [stored] = await prisma.$queryRaw<Array<{
            id: string;
            dateOfBirthEncrypted: string;
            passportNumberEncrypted: string;
        }>>`
            SELECT "id", "dateOfBirthEncrypted", "passportNumberEncrypted"
            FROM "Passenger"
            WHERE "bookingId" = ${bookingId}
        `;
        expect(stored.dateOfBirthEncrypted).not.toContain('1990-01-01');
        expect(stored.passportNumberEncrypted).not.toContain('SECRET123');
        expect(decryptPassengerData(stored.dateOfBirthEncrypted, {
            passengerId: stored.id,
            field: 'dateOfBirth',
        })).toBe('1990-01-01');
        expect(decryptPassengerData(stored.passportNumberEncrypted, {
            passengerId: stored.id,
            field: 'passportNumber',
        })).toBe('SECRET123');

        const expiredAt = new Date('2026-01-01T00:00:00.000Z');
        await prisma.passenger.update({
            where: { id: stored.id },
            data: { sensitiveDataExpiresAt: expiredAt },
        });
        await expect(purgeExpiredPassengerData(new Date('2026-01-02T00:00:00.000Z')))
            .resolves.toBeGreaterThanOrEqual(1);
        await expect(prisma.passenger.findUnique({
            where: { id: stored.id },
            select: {
                dateOfBirthEncrypted: true,
                passportNumberEncrypted: true,
                sensitiveDataDeletedAt: true,
            },
        })).resolves.toMatchObject({
            dateOfBirthEncrypted: null,
            passportNumberEncrypted: null,
            sensitiveDataDeletedAt: expect.any(Date),
        });
    });
});
