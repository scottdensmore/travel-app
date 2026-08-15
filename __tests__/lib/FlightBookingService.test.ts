/** @jest-environment node */
import FlightBookingService, { PassengerInput } from '@/lib/FlightBookingService';
import { prisma } from '@/lib/prisma';
import { safePassengerSelect } from '@/lib/passengerDataAccess';
import { encryptPassengerData } from '@/lib/passengerDataProtection';

const mockTx = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    booking: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
    },
    seatAssignment: {
        createMany: jest.fn(),
        findMany: jest.fn(),
    },
    flight: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
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
        mockTx.flight.findMany.mockReset();
        mockTx.seatAssignment.findMany.mockReset();
        mockTx.seatAssignment.findMany.mockResolvedValue([]);
        mockTx.$queryRaw.mockReset();
        mockTx.$executeRaw.mockReset();
        mockTx.$executeRaw.mockResolvedValue(1);
    });

    it('rejects a booking without passengers before starting a transaction', async () => {
        await expect(new FlightBookingService().bookFlight({ flightIds: [7], userId: 'u1' } as any))
            .rejects.toThrow('At least one passenger is required.');

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('gives each traveller their own seats when the created rows come back reordered', async () => {
        // booking.create's include carries no orderBy, so the relation may come
        // back in any order. Pairing it with the request array by position put
        // one traveller's seats and cabin under another traveller's name.
        mockTx.flight.findMany.mockResolvedValue([{
            id: 7,
            priceCents: 35000,
            status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z'),
            firstClassRows: 2,
            businessRows: 4,
            premiumEconomyRows: 4,
            economyRows: 20,
            seatPattern: 'ABC-DEF'
        }]);
        mockTx.booking.findFirst.mockResolvedValue(null);
        mockTx.seatAssignment.findMany.mockResolvedValue([]);

        const createdIds: string[] = [];
        mockTx.booking.create.mockImplementation(({ data }: any) => {
            for (const passenger of data.passengers.create) createdIds.push(passenger.id);
            return Promise.resolve({
                id: 2,
                userId: 'u1',
                totalPriceCents: 120000,
                legs: [{ id: 55, sequence: 1, flightId: 7 }],
                // Reversed: the database is under no obligation to hand these
                // back in the order they were written.
                passengers: [
                    { id: createdIds[1], firstName: 'Grace', lastName: 'Hopper', gender: 'Female' },
                    { id: createdIds[0], firstName: 'Ada', lastName: 'Lovelace', gender: 'Female' },
                ],
            });
        });

        const result = await new FlightBookingService().bookFlight({
            flightIds: [7],
            userId: 'u1',
            passengers: [
                {
                    firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01',
                    passportNumber: 'US1111111', gender: 'Female',
                    seatNumbers: ['4C'], cabinClass: 'BUSINESS'
                },
                {
                    firstName: 'Grace', lastName: 'Hopper', dateOfBirth: '1985-05-05',
                    passportNumber: 'US2222222', gender: 'Female',
                    seatNumbers: ['20A'], cabinClass: 'ECONOMY'
                }
            ],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        });

        expect(result.passengers).toEqual([
            expect.objectContaining({
                firstName: 'Grace', seatNumbers: ['20A'], cabinClass: 'ECONOMY'
            }),
            expect.objectContaining({
                firstName: 'Ada', seatNumbers: ['4C'], cabinClass: 'BUSINESS'
            }),
        ]);
    });

    it('calculates price from the locked flight and selected cabins', async () => {
        mockTx.flight.findMany.mockResolvedValue([{
            id: 7,
            priceCents: 35000,
            status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z'),
            firstClassRows: 2,
            businessRows: 4,
            premiumEconomyRows: 4,
            economyRows: 20,
            seatPattern: 'ABC-DEF'
        }]);
        mockTx.booking.findFirst.mockResolvedValue(null);
        // Occupancy comes from the seat assignments, which cover every leg.
        mockTx.seatAssignment.findMany.mockResolvedValue([
            { seatNumber: '12A' },
            { seatNumber: '12B' },
        ]);

        mockTx.booking.create.mockResolvedValue({
            id: 2,
            flightIds: [7],
            userId: 'u1',
            totalPriceCents: 70000,
            paymentIntentId: null,
            legs: [{ id: 55, sequence: 1, flightId: 7 }],
            passengers: [
                {
                    id: 'passenger-1',
                    firstName: 'Alice',
                    lastName: 'Smith',
                    gender: 'Female'
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
                seatNumbers: ['4C'],
                cabinClass: 'BUSINESS'
            }
        ];

        const result = await new FlightBookingService().bookFlight({
            flightIds: [7],
            userId: 'u1',
            passengers: passengersList,
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            paymentIntentId: 'pi_authorized',
        });

        expect(mockTx.booking.findFirst).toHaveBeenCalledWith({
            where: {
                userId: 'u1',
                idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
            },
            include: {
                legs: {
                    include: { flight: true },
                    orderBy: { sequence: 'asc' },
                },
                passengers: {
                    select: {
                        ...safePassengerSelect,
                        dateOfBirthEncrypted: true,
                        passportNumberEncrypted: true,
                        seatAssignments: {
                            select: {
                                seatNumber: true,
                                // The cabin is recorded per leg now that the
                                // traveller row no longer carries one (#137),
                                // and the retry signature compares it.
                                cabinClass: true,
                                leg: { select: { sequence: true } },
                            },
                        },
                    }
                }
            }
        });

        // Occupancy is read from the seat assignments, which cover every leg;
        // Passenger can only describe the outbound.
        expect(mockTx.seatAssignment.findMany).toHaveBeenCalledWith({
            where: {
                flightId: 7,
                releasedAt: null,
            },
            select: { seatNumber: true },
        });

        expect(mockTx.booking.create).toHaveBeenCalledWith({
            data: {
                userId: 'u1',
                totalPriceCents: 70000,
                legs: {
                    create: [{ sequence: 1, flightId: 7 }],
                },
                paymentIntentId: 'pi_authorized',
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
                        }
                    ]
                }
            },
            include: {
                passengers: { select: safePassengerSelect },
                legs: { orderBy: { sequence: 'asc' } }
            }
        });

        // The seat is recorded against the leg, from the same passenger array
        // the booking was created from. This is now the only record of where
        // the traveller sits, so it carries the cabin too (#137).
        expect(mockTx.seatAssignment.createMany).toHaveBeenCalledWith({
            data: [{
                passengerId: expect.any(String),
                legId: 55,
                flightId: 7,
                seatNumber: '4C',
                cabinClass: 'BUSINESS',
            }],
        });

        // Booking consumes the checkout's live claim in the same transaction
        // as the assignment. A later best-effort cleanup is not conversion:
        // another checkout can take the row between the purchase and delete.
        expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);

        expect(result).toMatchObject({ id: 2, totalPriceCents: 70000 });
    });

    it('refuses to book a seat this checkout no longer holds', async () => {
        mockTx.flight.findMany.mockResolvedValue([{
            id: 7,
            priceCents: 35000,
            status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z'),
            firstClassRows: 0,
            businessRows: 0,
            premiumEconomyRows: 0,
            economyRows: 20,
            seatPattern: 'ABC-DEF',
        }]);
        mockTx.booking.findFirst.mockResolvedValue(null);
        mockTx.seatAssignment.findMany.mockResolvedValue([]);
        mockTx.$executeRaw.mockResolvedValue(0);

        await expect(new FlightBookingService().bookFlight({
            flightIds: [7],
            userId: 'u1',
            passengers: [{
                firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1995-05-15',
                passportNumber: 'US123456', gender: 'Female', seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
        })).rejects.toThrow('Seat 11A is no longer held for this checkout.');

        expect(mockTx.booking.create).not.toHaveBeenCalled();
        expect(mockTx.seatAssignment.createMany).not.toHaveBeenCalled();
    });

    it('returns the existing booking when an idempotency key is retried', async () => {
        const passengerId = 'passenger-1';
        const existing = {
            id: 12,
            userId: 'u1',
            legs: [{ sequence: 1, flight: { id: 7 } }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            totalPriceCents: 35000,
            paymentIntentId: 'pi_authorized',
            passengers: [{
                id: passengerId,
                firstName: 'Alice', lastName: 'Smith',
                dateOfBirthEncrypted: encryptPassengerData('1995-05-15', { passengerId, field: 'dateOfBirth' }),
                passportNumberEncrypted: encryptPassengerData('US123456', { passengerId, field: 'passportNumber' }),
                gender: 'Female',
                // Persisted seats live on the assignments, one per leg, and
                // carry the cabin with them: the traveller row holds neither.
                seatAssignments: [{ seatNumber: '11A', cabinClass: 'ECONOMY', leg: { sequence: 1 } }]
            }]
        };
        mockTx.flight.findMany.mockResolvedValue([{
            id: 7,
            priceCents: 35000,
            status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z')
        }]);
        mockTx.booking.findFirst.mockResolvedValue(existing);

        const result = await new FlightBookingService().bookFlight({
            flightIds: [7],
            userId: 'u1',
            passengers: [{
                firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1995-05-15',
                passportNumber: 'US123456', gender: 'Female', seatNumbers: ['11A'],
                cabinClass: 'ECONOMY'
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            paymentIntentId: 'pi_authorized',
        });

        expect(result).toEqual({
            ...existing,
            passengers: [{
                id: passengerId,
                firstName: 'Alice',
                lastName: 'Smith',
                gender: 'Female',
                // One seat per leg, in leg order, so a retried round trip
                // reports both legs rather than the outbound twice.
                seatNumbers: ['11A'],
                // Carried on the response so no caller pairs it back up with
                // their own request array by position.
                cabinClass: 'ECONOMY',
            }],
            wasCreated: false,
        });
        expect(mockTx.booking.create).not.toHaveBeenCalled();
        expect(mockTx.booking.findMany).not.toHaveBeenCalled();
        expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it('rejects an idempotent retry linked to a different payment', async () => {
        const passengerId = 'passenger-payment-mismatch';
        mockTx.flight.findMany.mockResolvedValue([{
            id: 7,
            priceCents: 35000,
            status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z'),
        }]);
        mockTx.booking.findFirst.mockResolvedValue({
            id: 12,
            userId: 'u1',
            legs: [{ sequence: 1, flight: { id: 7 } }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            paymentIntentId: 'pi_first',
            passengers: [{
                id: passengerId,
                firstName: 'Alice', lastName: 'Smith',
                dateOfBirthEncrypted: encryptPassengerData('1995-05-15', { passengerId, field: 'dateOfBirth' }),
                passportNumberEncrypted: encryptPassengerData('US123456', { passengerId, field: 'passportNumber' }),
                gender: 'Female',
                seatAssignments: [{ seatNumber: '11A', cabinClass: 'ECONOMY', leg: { sequence: 1 } }],
            }],
        });

        await expect(new FlightBookingService().bookFlight({
            flightIds: [7],
            userId: 'u1',
            passengers: [{
                firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1995-05-15',
                passportNumber: 'US123456', gender: 'Female', seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            paymentIntentId: 'pi_second',
        })).rejects.toThrow('Booking request ID was already used with a different payment.');
    });

    it('rejects reuse of an idempotency key for a different flight or passenger request', async () => {
        const passengerId = 'passenger-2';
        const existing = {
            id: 12,
            userId: 'u1',
            legs: [{ sequence: 1, flight: { id: 8 } }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            totalPriceCents: 35000,
            paymentIntentId: null,
            passengers: [{
                id: passengerId,
                firstName: 'Alice', lastName: 'Smith',
                dateOfBirthEncrypted: encryptPassengerData('1995-05-15', { passengerId, field: 'dateOfBirth' }),
                passportNumberEncrypted: encryptPassengerData('US123456', { passengerId, field: 'passportNumber' }),
                gender: 'Female',
                // Persisted seats live on the assignments, one per leg, and
                // carry the cabin with them: the traveller row holds neither.
                seatAssignments: [{ seatNumber: '11A', cabinClass: 'ECONOMY', leg: { sequence: 1 } }]
            }]
        };
        mockTx.flight.findMany.mockResolvedValue([{
            id: 7, priceCents: 35000, status: 'ON_TIME', departureDate: new Date('2099-01-01T10:00:00Z')
        }]);
        mockTx.booking.findFirst.mockResolvedValue(existing);
        const request = {
            flightIds: [7],
            userId: 'u1',
            passengers: [{
                firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1995-05-15',
                passportNumber: 'US123456', gender: 'Female', seatNumbers: ['11A'], cabinClass: 'ECONOMY'
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        };

        await expect(new FlightBookingService().bookFlight(request))
            .rejects.toThrow('Booking request ID was already used for a different booking.');

        // Match the requested flight so only the passenger difference remains.
        existing.legs[0].flight.id = 7;
        request.passengers[0].seatNumbers = ['11B'];
        await expect(new FlightBookingService().bookFlight(request))
            .rejects.toThrow('Booking request ID was already used for a different booking.');
        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('rejects cancelled and departed flight inventory', async () => {
        const request = {
            flightIds: [7],
            userId: 'u1',
            passengers: [{
                firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1995-05-15',
                passportNumber: 'US123456', gender: 'Female', seatNumbers: ['11A'],
                cabinClass: 'ECONOMY'
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        };
        mockTx.booking.findFirst.mockResolvedValue(null);
        mockTx.flight.findMany.mockResolvedValue([{
            id: 7, priceCents: 35000, status: 'CANCELLED', departureDate: new Date('2099-01-01T10:00:00Z')
        }]);
        await expect(new FlightBookingService().bookFlight(request))
            .rejects.toThrow('Flight is not available for booking.');

        mockTx.flight.findMany.mockResolvedValue([{
            id: 7, priceCents: 35000, status: 'ON_TIME', departureDate: new Date('2020-01-01T10:00:00Z')
        }]);
        await expect(new FlightBookingService().bookFlight(request))
            .rejects.toThrow('Flight is not available for booking.');
        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('rejects seats outside the configured cabin layout', async () => {
        mockTx.flight.findMany.mockResolvedValue([{
            id: 7,
            priceCents: 35000,
            status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z'),
            firstClassRows: 1,
            businessRows: 1,
            premiumEconomyRows: 1,
            economyRows: 5,
            seatPattern: 'AB-CD'
        }]);
        mockTx.booking.findMany.mockResolvedValue([]);

        const passenger: PassengerInput = {
            firstName: 'Alice',
            lastName: 'Smith',
            dateOfBirth: '1995-05-15',
            passportNumber: 'US123456',
            gender: 'Female',
            seatNumbers: ['1A'],
            cabinClass: 'ECONOMY'
        };

        await expect(new FlightBookingService().bookFlight({
            flightIds: [7],
            userId: 'u1',
            passengers: [passenger],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        })).rejects.toThrow('Seat 1A is not available for ECONOMY on this flight.');

        passenger.seatNumbers = ['8F'];
        await expect(new FlightBookingService().bookFlight({
            flightIds: [7],
            userId: 'u1',
            passengers: [passenger],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        })).rejects.toThrow('Seat 8F is not available for ECONOMY on this flight.');
        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate seats within one booking request', async () => {
        mockTx.flight.findMany.mockResolvedValue([{
            id: 7, priceCents: 35000, status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z')
        }]);
        mockTx.booking.findFirst.mockResolvedValue(null);
        mockTx.booking.findMany.mockResolvedValue([]);
        const passenger = {
            firstName: 'Alice',
            lastName: 'Smith',
            dateOfBirth: '1995-05-15',
            passportNumber: 'US123456',
            gender: 'Female',
            seatNumbers: ['11A'],
            cabinClass: 'ECONOMY'
        };

        await expect(new FlightBookingService().bookFlight({
            flightIds: [7],
            userId: 'u1',
            passengers: [passenger, { ...passenger, firstName: 'Bob' }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        })).rejects.toThrow('Duplicate seats selected in request.');
        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('throws an error if a requested seat is already occupied', async () => {
        mockTx.flight.findMany.mockResolvedValue([{
            id: 7, priceCents: 35000, status: 'ON_TIME',
            departureDate: new Date('2099-01-01T10:00:00Z')
        }]);
        mockTx.booking.findFirst.mockResolvedValue(null);
        // Occupancy comes from the seat assignments, which cover every leg.
        mockTx.seatAssignment.findMany.mockResolvedValue([
            { seatNumber: '12A' },
            { seatNumber: '12B' },
        ]);

        const passengersList: PassengerInput[] = [
            {
                firstName: 'Alice',
                lastName: 'Smith',
                dateOfBirth: '1995-05-15',
                passportNumber: 'US123456',
                gender: 'Female',
                seatNumbers: ['12A'],
                cabinClass: 'ECONOMY'
            }
        ];

        await expect(new FlightBookingService().bookFlight({
            flightIds: [7],
            userId: 'u1',
            passengers: passengersList,
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        })).rejects.toThrow('Seat 12A is already occupied on this flight.');

        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('rejects client-supplied prices', async () => {
        await expect(new FlightBookingService().bookFlight({
            flightIds: [7],
            userId: 'u1',
            passengers: [{
                firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1995-05-15',
                passportNumber: 'US123456', gender: 'Female', seatNumbers: ['11A'],
                cabinClass: 'ECONOMY'
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            totalPriceCents: 1,
        } as any)).rejects.toThrow('Unrecognized');

        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
