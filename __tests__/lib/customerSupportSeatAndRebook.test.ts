import { staffChangeBookingSeats, staffRebookItinerary } from '@/lib/customerSupportService';
import { prisma } from '@/lib/prisma';
import { ItineraryRebookingService } from '@/lib/itineraryRebookingService';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        booking: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        seatAssignment: {
            updateMany: jest.fn(),
            create: jest.fn(),
        },
        $transaction: jest.fn((callback) => callback(prisma)),
    },
}));

jest.mock('@/lib/itineraryRebookingService');

describe('staffChangeBookingSeats & staffRebookItinerary', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects seat changes without justification reason', async () => {
        await expect(
            staffChangeBookingSeats(101, [{ passengerId: 'p1', legId: 1, seatNumber: '14B' }], 'staff-1', '   ')
        ).rejects.toThrow('A justification reason is required for staff seat changes.');
    });

    it('rejects rebooking without justification reason', async () => {
        await expect(
            staffRebookItinerary(101, { bookingId: 101 }, 'staff-1', '')
        ).rejects.toThrow('A justification reason is required for staff rebooking.');
    });

    it('rejects seat changes if booking not found', async () => {
        (prisma.booking.findUnique as jest.Mock).mockResolvedValue(null);

        await expect(
            staffChangeBookingSeats(999, [{ passengerId: 'p1', legId: 1, seatNumber: '14B' }], 'staff-1', 'Moved')
        ).rejects.toThrow('Booking 999 not found.');
    });

    it('rejects rebooking if booking not found', async () => {
        (prisma.booking.findUnique as jest.Mock).mockResolvedValue(null);

        await expect(
            staffRebookItinerary(999, { bookingId: 999 }, 'staff-1', 'Recovery')
        ).rejects.toThrow('Booking 999 not found.');
    });

    it('rejects seat changes on cancelled flights', async () => {
        (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
            id: 101,
            legs: [
                { id: 1, flight: { id: 10, status: 'CANCELLED' } },
            ],
            passengers: [{ id: 'p1' }],
        });

        await expect(
            staffChangeBookingSeats(101, [{ passengerId: 'p1', legId: 1, seatNumber: '14B' }], 'staff-1', 'Moved passenger')
        ).rejects.toThrow(/flight has been cancelled/i);
    });

    it('rejects seat changes if leg does not belong to booking', async () => {
        (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
            id: 101,
            legs: [
                { id: 1, flight: { id: 10, status: 'SCHEDULED' } },
            ],
            passengers: [{ id: 'p1' }],
        });

        await expect(
            staffChangeBookingSeats(101, [{ passengerId: 'p1', legId: 99, seatNumber: '14B' }], 'staff-1', 'Moved')
        ).rejects.toThrow('Leg 99 does not belong to booking 101');
    });

    it('successfully releases previous seat and creates new seat assignment', async () => {
        (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
            id: 101,
            legs: [
                { id: 1, flight: { id: 10, status: 'SCHEDULED' } },
            ],
            passengers: [{ id: 'p1' }],
        });

        await staffChangeBookingSeats(
            101,
            [{ passengerId: 'p1', legId: 1, seatNumber: '14B' }],
            'staff-1',
            'Customer request'
        );

        expect(prisma.seatAssignment.updateMany).toHaveBeenCalledWith({
            where: {
                passengerId: 'p1',
                flightId: 10,
                releasedAt: null,
            },
            data: { releasedAt: expect.any(Date) },
        });

        expect(prisma.seatAssignment.create).toHaveBeenCalledWith({
            data: {
                passengerId: 'p1',
                legId: 1,
                flightId: 10,
                seatNumber: '14B',
                cabinClass: 'ECONOMY',
            },
        });
    });

    it('delegates staff rebooking to ItineraryRebookingService with actorUserId', async () => {
        const mockRebookResult = { bookingId: 101, status: 'REBOOKED' };
        (ItineraryRebookingService.prototype.rebook as jest.Mock).mockResolvedValue(mockRebookResult);
        (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
            id: 101,
            userId: 'cust-123',
        });

        const rebookRequest = {
            bookingId: 101,
            selectedFlights: [{ legIndex: 0, flightId: 'flight-new' }],
        };

        const result = await staffRebookItinerary(101, rebookRequest, 'staff-1', 'Weather disruption recovery');
        expect(result).toEqual(mockRebookResult);
        expect(ItineraryRebookingService.prototype.rebook).toHaveBeenCalledWith(expect.objectContaining({
            bookingId: 101,
            ownerUserId: 'cust-123',
            actorUserId: 'staff-1',
        }));
    });
});
