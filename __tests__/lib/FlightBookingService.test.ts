/** @jest-environment node */
import FlightBookingService, { PassengerInput } from '@/lib/FlightBookingService';
import { prisma } from '@/lib/prisma';
import { safePassengerSelect } from '@/lib/passengerDataAccess';
import { encryptPassengerData } from '@/lib/passengerDataProtection';

const mockTx = {
    $queryRaw: jest.fn(),
    booking: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
    },
    flight: {
        findUnique: jest.fn(),
    }
};

jest.mock('@/lib/prisma', () => ({
    prisma: {
        $transaction: jest.fn((callback) => callback(mockTx)),
    }
}));

describe('FlightBookingService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTx.booking.findMany.mockReset();
        mockTx.booking.findFirst.mockReset();
        mockTx.booking.create.mockReset();
        mockTx.flight.findUnique.mockReset();
        mockTx.$queryRaw.mockReset();
    });

    it('rejects a booking without passengers before starting a transaction', async () => {
        await expect(new FlightBookingService().bookFlight({ flightId: 7, userId: 'u1' } as any))
            .rejects.toThrow('At least one passenger is required.');

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('calculates price from the locked flight and selected cabins', async () => {
        mockTx.flight.findUnique.mockResolvedValue({
            id: 7,
            price: '$350',
            status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z'),
            firstClassRows: 2,
            businessRows: 4,
            premiumEconomyRows: 4,
            economyRows: 20,
            seatPattern: 'ABC-DEF'
        });
        mockTx.booking.findFirst.mockResolvedValue(null);
        mockTx.booking.findMany.mockResolvedValue([
            {
                id: 10,
                passengers: [
                    { seatNumber: '12A' },
                    { seatNumber: '12B' }
                ]
            }
        ]);

        mockTx.booking.create.mockResolvedValue({
            id: 2,
            flightId: 7,
            userId: 'u1',
            totalPrice: '$700',
            totalPriceCents: 70000,
            paymentIntentId: null,
            passengers: [
                {
                    firstName: 'Alice',
                    lastName: 'Smith',
                    seatNumber: '4C',
                    cabinClass: 'BUSINESS'
                }
            ]
        });

        const passengersList: PassengerInput[] = [
            {
                firstName: 'Alice',
                lastName: 'Smith',
                dateOfBirth: '1995-05-15',
                passportNumber: 'US123456',
                gender: 'Female',
                seatNumber: '4C',
                cabinClass: 'BUSINESS'
            }
        ];

        const result = await new FlightBookingService().bookFlight({
            flightId: 7,
            userId: 'u1',
            passengers: passengersList,
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        });

        expect(mockTx.booking.findFirst).toHaveBeenCalledWith({
            where: {
                userId: 'u1',
                idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
            },
            include: {
                passengers: {
                    select: {
                        ...safePassengerSelect,
                        dateOfBirthEncrypted: true,
                        passportNumberEncrypted: true,
                    }
                }
            }
        });

        expect(mockTx.booking.findMany).toHaveBeenCalledWith({
            where: { flightId: 7, status: { not: "CANCELLED" } },
            include: { passengers: { select: { seatNumber: true } } }
        });

        expect(mockTx.booking.create).toHaveBeenCalledWith({
            data: {
                flightId: 7,
                userId: 'u1',
                totalPrice: '$700',
                totalPriceCents: 70000,
                legs: {
                    create: [{ sequence: 1, flightId: 7 }],
                },
                paymentIntentId: null,
                idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
                passengers: {
                    create: [
                        {
                            id: expect.any(String),
                            firstName: 'Alice',
                            lastName: 'Smith',
                            dateOfBirthEncrypted: expect.stringMatching(/^v1:/),
                            passportNumberEncrypted: expect.stringMatching(/^v1:/),
                            sensitiveDataExpiresAt: new Date('2099-01-31T10:00:00.000Z'),
                            gender: 'Female',
                            seatNumber: '4C',
                            cabinClass: 'BUSINESS',
                            flightId: 7
                        }
                    ]
                }
            },
            include: {
                passengers: { select: safePassengerSelect },
                legs: { orderBy: { sequence: 'asc' } }
            }
        });

        expect(result).toMatchObject({ id: 2, totalPrice: '$700' });
    });

    it('returns the existing booking when an idempotency key is retried', async () => {
        const passengerId = 'passenger-1';
        const existing = {
            id: 12,
            userId: 'u1',
            flightId: 7,
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            totalPrice: '$350',
            totalPriceCents: 35000,
            passengers: [{
                id: passengerId,
                firstName: 'Alice', lastName: 'Smith',
                dateOfBirthEncrypted: encryptPassengerData('1995-05-15', { passengerId, field: 'dateOfBirth' }),
                passportNumberEncrypted: encryptPassengerData('US123456', { passengerId, field: 'passportNumber' }),
                gender: 'Female', seatNumber: '11A', cabinClass: 'ECONOMY'
            }]
        };
        mockTx.flight.findUnique.mockResolvedValue({
            id: 7,
            price: '$350',
            status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z')
        });
        mockTx.booking.findFirst.mockResolvedValue(existing);

        const result = await new FlightBookingService().bookFlight({
            flightId: 7,
            userId: 'u1',
            passengers: [{
                firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1995-05-15',
                passportNumber: 'US123456', gender: 'Female', seatNumber: '11A',
                cabinClass: 'ECONOMY'
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        });

        expect(result).toEqual({
            ...existing,
            passengers: [{
                id: passengerId,
                firstName: 'Alice',
                lastName: 'Smith',
                gender: 'Female',
                seatNumber: '11A',
                cabinClass: 'ECONOMY',
            }],
            wasCreated: false,
        });
        expect(mockTx.booking.create).not.toHaveBeenCalled();
        expect(mockTx.booking.findMany).not.toHaveBeenCalled();
    });

    it('rejects reuse of an idempotency key for a different flight or passenger request', async () => {
        const passengerId = 'passenger-2';
        const existing = {
            id: 12,
            userId: 'u1',
            flightId: 8,
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            totalPrice: '$350',
            totalPriceCents: 35000,
            passengers: [{
                id: passengerId,
                firstName: 'Alice', lastName: 'Smith',
                dateOfBirthEncrypted: encryptPassengerData('1995-05-15', { passengerId, field: 'dateOfBirth' }),
                passportNumberEncrypted: encryptPassengerData('US123456', { passengerId, field: 'passportNumber' }),
                gender: 'Female', seatNumber: '11A', cabinClass: 'ECONOMY'
            }]
        };
        mockTx.flight.findUnique.mockResolvedValue({
            id: 7, price: '$350', status: 'ON_TIME', departureDate: new Date('2099-01-01T10:00:00Z')
        });
        mockTx.booking.findFirst.mockResolvedValue(existing);
        const request = {
            flightId: 7,
            userId: 'u1',
            passengers: [{
                firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1995-05-15',
                passportNumber: 'US123456', gender: 'Female', seatNumber: '11A', cabinClass: 'ECONOMY'
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        };

        await expect(new FlightBookingService().bookFlight(request))
            .rejects.toThrow('Booking request ID was already used for a different booking.');

        existing.flightId = 7;
        request.passengers[0].seatNumber = '11B';
        await expect(new FlightBookingService().bookFlight(request))
            .rejects.toThrow('Booking request ID was already used for a different booking.');
        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('rejects cancelled and departed flight inventory', async () => {
        const request = {
            flightId: 7,
            userId: 'u1',
            passengers: [{
                firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1995-05-15',
                passportNumber: 'US123456', gender: 'Female', seatNumber: '11A',
                cabinClass: 'ECONOMY'
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        };
        mockTx.booking.findFirst.mockResolvedValue(null);
        mockTx.flight.findUnique.mockResolvedValue({
            id: 7, price: '$350', status: 'CANCELLED', departureDate: new Date('2099-01-01T10:00:00Z')
        });
        await expect(new FlightBookingService().bookFlight(request))
            .rejects.toThrow('Flight is not available for booking.');

        mockTx.flight.findUnique.mockResolvedValue({
            id: 7, price: '$350', status: 'ON_TIME', departureDate: new Date('2020-01-01T10:00:00Z')
        });
        await expect(new FlightBookingService().bookFlight(request))
            .rejects.toThrow('Flight is not available for booking.');
        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('rejects seats outside the configured cabin layout', async () => {
        mockTx.flight.findUnique.mockResolvedValue({
            id: 7,
            price: '$350',
            status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z'),
            firstClassRows: 1,
            businessRows: 1,
            premiumEconomyRows: 1,
            economyRows: 5,
            seatPattern: 'AB-CD'
        });
        mockTx.booking.findMany.mockResolvedValue([]);

        const passenger: PassengerInput = {
            firstName: 'Alice',
            lastName: 'Smith',
            dateOfBirth: '1995-05-15',
            passportNumber: 'US123456',
            gender: 'Female',
            seatNumber: '1A',
            cabinClass: 'ECONOMY'
        };

        await expect(new FlightBookingService().bookFlight({
            flightId: 7,
            userId: 'u1',
            passengers: [passenger],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        })).rejects.toThrow('Seat 1A is not available for ECONOMY on this flight.');

        passenger.seatNumber = '8F';
        await expect(new FlightBookingService().bookFlight({
            flightId: 7,
            userId: 'u1',
            passengers: [passenger],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        })).rejects.toThrow('Seat 8F is not available for ECONOMY on this flight.');
        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate seats within one booking request', async () => {
        mockTx.flight.findUnique.mockResolvedValue({
            id: 7, price: '$350', status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z')
        });
        mockTx.booking.findFirst.mockResolvedValue(null);
        mockTx.booking.findMany.mockResolvedValue([]);
        const passenger = {
            firstName: 'Alice',
            lastName: 'Smith',
            dateOfBirth: '1995-05-15',
            passportNumber: 'US123456',
            gender: 'Female',
            seatNumber: '11A',
            cabinClass: 'ECONOMY'
        };

        await expect(new FlightBookingService().bookFlight({
            flightId: 7,
            userId: 'u1',
            passengers: [passenger, { ...passenger, firstName: 'Bob' }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        })).rejects.toThrow('Duplicate seats selected in request.');
        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('throws an error if a requested seat is already occupied', async () => {
        mockTx.flight.findUnique.mockResolvedValue({
            id: 7, price: '$350', status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z')
        });
        mockTx.booking.findFirst.mockResolvedValue(null);
        mockTx.booking.findMany.mockResolvedValue([
            {
                id: 10,
                passengers: [
                    { seatNumber: '12A' },
                    { seatNumber: '12B' }
                ]
            }
        ]);

        const passengersList: PassengerInput[] = [
            {
                firstName: 'Alice',
                lastName: 'Smith',
                dateOfBirth: '1995-05-15',
                passportNumber: 'US123456',
                gender: 'Female',
                seatNumber: '12A', // Conflict!
                cabinClass: 'ECONOMY'
            }
        ];

        await expect(new FlightBookingService().bookFlight({
            flightId: 7,
            userId: 'u1',
            passengers: passengersList,
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        })).rejects.toThrow('Seat 12A is already occupied on this flight.');

        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('rejects client-supplied prices and payment identifiers', async () => {
        await expect(new FlightBookingService().bookFlight({
            flightId: 7,
            userId: 'u1',
            passengers: [{
                firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1995-05-15',
                passportNumber: 'US123456', gender: 'Female', seatNumber: '11A',
                cabinClass: 'ECONOMY'
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            totalPrice: '$0.01',
            paymentIntentId: 'forged'
        } as any)).rejects.toThrow('Unrecognized');

        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
