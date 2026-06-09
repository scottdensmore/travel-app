/** @jest-environment node */
import FlightBookingService from '@/lib/FlightBookingService';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: { booking: { create: jest.fn() } },
}));

const mockedPrisma = prisma as unknown as { booking: { create: jest.Mock } };

describe('FlightBookingService', () => {
    beforeEach(() => jest.clearAllMocks());

    it('creates a booking linked to a flight and user (normalized)', async () => {
        mockedPrisma.booking.create.mockResolvedValue({
            id: 1,
            flightId: 7,
            userId: 'u1',
            createdAt: new Date('2026-03-01'),
        });

        const result = await new FlightBookingService().bookFlight({ flightId: 7, userId: 'u1' });

        // Only the foreign keys are persisted — flight details live on the Flight row.
        expect(mockedPrisma.booking.create).toHaveBeenCalledWith({
            data: { flightId: 7, userId: 'u1' },
        });
        expect(result).toMatchObject({ id: 1, flightId: 7, userId: 'u1' });
    });
});
