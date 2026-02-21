import FlightBookingService from '@/lib/FlightBookingService';

// Mock the Prisma client globally in this test file
jest.mock('@prisma/client', () => {
    return {
        PrismaClient: jest.fn().mockImplementation(() => {
            return {
                booking: {
                    create: jest.fn().mockResolvedValue({
                        id: 1,
                        flightNumber: 'MA101',
                        airline: 'Mona Air',
                        from: 'SFO',
                        to: 'NYC',
                        departureDate: new Date('2026-03-01'),
                        returnDate: null,
                        price: '$350',
                        createdAt: new Date(),
                    }),
                },
            };
        }),
    };
});

describe('FlightBookingService', () => {
    it('creates a new booking record via Prisma', async () => {
        const service = new FlightBookingService();

        const bookingData = {
            flightNumber: 'MA101',
            airline: 'Mona Air',
            from: 'SFO',
            to: 'NYC',
            departureDate: new Date('2026-03-01'),
            returnDate: null,
            price: '$350'
        };

        const result = await service.bookFlight(bookingData);

        // Assert the returned value matches the mock object structure
        expect(result).toHaveProperty('id', 1);
        expect(result.flightNumber).toBe('MA101');
    });
});
