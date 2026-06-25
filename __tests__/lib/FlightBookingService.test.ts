/** @jest-environment node */
import FlightBookingService, { PassengerInput } from '@/lib/FlightBookingService';
import { prisma } from '@/lib/prisma';

const mockTx = {
    booking: {
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
        mockTx.booking.create.mockReset();
        mockTx.flight.findUnique.mockReset();
    });

    it('creates a simple booking when no passengers list is provided (backwards compatibility)', async () => {
        mockTx.flight.findUnique.mockResolvedValue({ id: 7, price: '$350' });
        mockTx.booking.create.mockResolvedValue({
            id: 1,
            flightId: 7,
            userId: 'u1',
            totalPrice: '$350',
            createdAt: new Date('2026-03-01'),
        });

        const result = await new FlightBookingService().bookFlight({ flightId: 7, userId: 'u1' });

        expect(mockTx.flight.findUnique).toHaveBeenCalledWith({ where: { id: 7 } });
        expect(mockTx.booking.create).toHaveBeenCalledWith({
            data: { flightId: 7, userId: 'u1', totalPrice: '$350', paymentIntentId: expect.stringContaining('mock_tx_') },
        });
        expect(result).toMatchObject({ id: 1, flightId: 7, userId: 'u1', totalPrice: '$350' });
    });

    it('creates a detailed booking with passengers and validates seat selections', async () => {
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
            totalPrice: '$525',
            passengers: [
                {
                    firstName: 'Alice',
                    lastName: 'Smith',
                    seatNumber: '12C',
                    cabinClass: 'PREMIUM_ECONOMY'
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
                seatNumber: '12C',
                cabinClass: 'PREMIUM_ECONOMY'
            }
        ];

        const result = await new FlightBookingService().bookFlight({
            flightId: 7,
            userId: 'u1',
            totalPrice: '$525',
            passengers: passengersList,
            paymentIntentId: 'mock_intent_123'
        });

        expect(mockTx.booking.findMany).toHaveBeenCalledWith({
            where: { flightId: 7, status: { not: "CANCELLED" } },
            include: { passengers: true }
        });

        expect(mockTx.booking.create).toHaveBeenCalledWith({
            data: {
                flightId: 7,
                userId: 'u1',
                totalPrice: '$525',
                paymentIntentId: 'mock_intent_123',
                passengers: {
                    create: [
                        {
                            firstName: 'Alice',
                            lastName: 'Smith',
                            dateOfBirth: new Date('1995-05-15'),
                            passportNumber: 'US123456',
                            gender: 'Female',
                            seatNumber: '12C',
                            cabinClass: 'PREMIUM_ECONOMY',
                            flightId: 7
                        }
                    ]
                }
            },
            include: { passengers: true }
        });

        expect(result).toMatchObject({ id: 2, totalPrice: '$525' });
    });

    it('throws an error if a requested seat is already occupied', async () => {
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
            totalPrice: '$350',
            passengers: passengersList
        })).rejects.toThrow('Seat 12A is already occupied on this flight.');

        expect(mockTx.booking.create).not.toHaveBeenCalled();
    });
});
