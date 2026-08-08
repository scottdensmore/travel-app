/** @jest-environment node */
import { airportCodesForRoute } from '@/lib/airports';
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
                ...airportCodesForRoute('Seattle, USA', 'San Francisco, USA'),
                departureDate: new Date('2099-01-01T10:00:00.000Z'),
                priceCents: 10000,
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
            flightIds: [flightId],
            userId,
            idempotencyKey: crypto.randomUUID(),
            passengers: [{
                firstName: 'Ada',
                lastName: 'Lovelace',
                dateOfBirth: '1990-01-01',
                passportNumber: 'SECRET123',
                gender: 'Female',
                seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
        });
        bookingId = result.id;
        // Identity and nothing more, plus the seats held on each leg and the
        // cabin they were bought in. No encrypted field, and no date of birth
        // or passport number in any form.
        expect(result.passengers[0]).toEqual({
            id: expect.any(String),
            firstName: 'Ada',
            lastName: 'Lovelace',
            gender: 'Female',
            seatNumbers: ['11A'],
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
        // Deliberately not asserting on the return value. It counts every row
        // the sweep touched across the whole table, so it is both fragile --
        // anything else purging concurrently claims this row and the count
        // comes back 0 -- and weak, since an unrelated expired row would
        // satisfy it while this one stayed intact (#149). What matters is what
        // happened to this passenger, which is asserted below.
        await purgeExpiredPassengerData(new Date('2026-01-02T00:00:00.000Z'));
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
