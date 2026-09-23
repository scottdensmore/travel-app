import { searchBookings } from '@/lib/customerSupportService';
import { prisma } from '@/lib/prisma';
import { BookingStatus } from '@prisma/client';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        booking: {
            findMany: jest.fn(),
            count: jest.fn(),
        },
    },
}));

describe('customerSupportService.searchBookings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('searches bookings with multi-parameter filters and calculates pagination metadata', async () => {
        const mockBookings = [
            {
                id: 101,
                reference: 'MA-ABC123',
                status: BookingStatus.CONFIRMED,
                totalPriceCents: 45000,
                currency: 'USD',
                createdAt: new Date('2026-09-01T12:00:00Z'),
                user: { id: 'u1', name: 'John Doe', email: 'john@example.com' },
                legs: [
                    {
                        id: 1,
                        sequence: 1,
                        flight: {
                            id: 'f1',
                            flightNumber: 'MA101',
                            airline: 'Mona Airways',
                            fromAirportCode: 'JFK',
                            toAirportCode: 'LHR',
                            departureDate: new Date('2026-10-15T08:00:00Z'),
                            status: 'SCHEDULED',
                        },
                    },
                ],
                passengers: [
                    {
                        id: 'p1',
                        firstName: 'John',
                        lastName: 'Doe',
                        seatAssignments: [
                            { id: 'sa1', flightId: 'f1', seatNumber: '12A', cabinClass: 'ECONOMY', releasedAt: null },
                        ],
                    },
                ],
                _count: { notes: 3 },
            },
        ];

        (prisma.booking.findMany as jest.Mock).mockResolvedValue(mockBookings);
        (prisma.booking.count as jest.Mock).mockResolvedValue(42);

        const result = await searchBookings({
            reference: 'ABC',
            emailOrName: 'John',
            flightNumber: 'MA101',
            status: BookingStatus.CONFIRMED,
            dateFrom: '2026-10-01',
            dateTo: '2026-10-31',
            page: 2,
            pageSize: 10,
        });

        expect(result.page).toBe(2);
        expect(result.pageSize).toBe(10);
        expect(result.totalCount).toBe(42);
        expect(result.totalPages).toBe(5);
        expect(result.bookings).toHaveLength(1);
        expect(result.bookings[0].notesCount).toBe(3);

        expect(prisma.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
            skip: 10,
            take: 10,
            orderBy: { createdAt: 'desc' },
            where: expect.objectContaining({
                reference: { contains: 'ABC', mode: 'insensitive' },
                status: BookingStatus.CONFIRMED,
                legs: expect.objectContaining({
                    some: expect.objectContaining({
                        flight: expect.objectContaining({
                            flightNumber: { contains: 'MA101', mode: 'insensitive' },
                            departureDate: {
                                gte: new Date('2026-10-01T00:00:00.000Z'),
                                lte: new Date('2026-10-31T23:59:59.999Z'),
                            },
                        }),
                    }),
                }),
            }),
        }));
    });
});
