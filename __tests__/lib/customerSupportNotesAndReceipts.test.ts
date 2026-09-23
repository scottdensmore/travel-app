import { getBookingNotes, addInternalNote, resendReceiptEmail, resendConfirmationEmail } from '@/lib/customerSupportService';
import { prisma } from '@/lib/prisma';
import { generateInvoicePDF } from '@/lib/documents/pdfGenerator';
import { sendTravelDocumentsEmail } from '@/lib/travelDocumentEmail';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        bookingNote: {
            findMany: jest.fn(),
            create: jest.fn(),
        },
        booking: {
            findUniqueOrThrow: jest.fn(),
        },
    },
}));

jest.mock('@/lib/documents/pdfGenerator', () => ({
    generateInvoicePDF: jest.fn(),
}));

jest.mock('@/lib/travelDocumentEmail', () => ({
    sendTravelDocumentsEmail: jest.fn(),
}));

describe('customerSupportService notes & documents', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('retrieves internal notes with staff author metadata ordered by createdAt desc', async () => {
        const mockNotes = [
            {
                id: 'n1',
                bookingId: 101,
                actorUserId: 'staff-1',
                text: 'Customer requested aisle seat',
                createdAt: new Date('2026-09-20T10:00:00Z'),
                actor: { id: 'staff-1', name: 'Agent Smith', email: 'agent@example.com', role: 'SUPPORT' },
            },
        ];
        (prisma.bookingNote.findMany as jest.Mock).mockResolvedValue(mockNotes);

        const notes = await getBookingNotes(101);
        expect(notes).toEqual(mockNotes);
        expect(prisma.bookingNote.findMany).toHaveBeenCalledWith({
            where: { bookingId: 101 },
            include: { actor: { select: { id: true, name: true, email: true, role: true } } },
            orderBy: { createdAt: 'desc' },
        });
    });

    it('generates tax invoice PDF and resends receipt email', async () => {
        const mockBooking = {
            id: 101,
            reference: 'MA-ABC123',
            user: { email: 'customer@example.com' },
            legs: [],
            passengers: [],
        };
        (prisma.booking.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockBooking);
        (generateInvoicePDF as jest.Mock).mockResolvedValue(Buffer.from('mock-pdf'));

        const result = await resendReceiptEmail(101);
        expect(result).toEqual({ success: true, sentTo: 'customer@example.com' });
        expect(generateInvoicePDF).toHaveBeenCalledWith(mockBooking);
    });

    it('throws error when booking has no customer email address in resendReceiptEmail', async () => {
        const mockBooking = {
            id: 101,
            reference: 'MA-ABC123',
            user: null,
            legs: [],
            passengers: [],
        };
        (prisma.booking.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockBooking);

        await expect(resendReceiptEmail(101)).rejects.toThrow('Booking has no customer email address.');
    });

    it('resends confirmation email with travel documents', async () => {
        const mockBooking = {
            id: 101,
            reference: 'MA-ABC123',
            user: { email: 'customer@example.com' },
            legs: [
                {
                    flight: {
                        airline: 'Mona Airways',
                        flightNumber: 'MA001',
                        fromAirportCode: 'SFO',
                        toAirportCode: 'JFK',
                        departureDate: new Date('2026-10-01T12:00:00Z'),
                    },
                },
            ],
            passengers: [
                {
                    firstName: 'Alice',
                    lastName: 'Smith',
                    seatAssignments: [{ seatNumber: '12A', cabinClass: 'ECONOMY' }],
                },
            ],
        };
        (prisma.booking.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockBooking);

        const result = await resendConfirmationEmail(101);
        expect(result).toEqual({ success: true, sentTo: 'customer@example.com' });
        expect(sendTravelDocumentsEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'customer@example.com',
                bookingReference: 'MA-ABC123',
                flightNumber: 'MA001',
            })
        );
    });

    it('throws error when booking has no customer email address in resendConfirmationEmail', async () => {
        const mockBooking = {
            id: 101,
            reference: 'MA-ABC123',
            user: null,
            legs: [],
            passengers: [],
        };
        (prisma.booking.findUniqueOrThrow as jest.Mock).mockResolvedValue(mockBooking);

        await expect(resendConfirmationEmail(101)).rejects.toThrow('Booking has no customer email address.');
    });

    it('creates an internal note for a booking', async () => {
        const mockCreatedNote = {
            id: 'n2',
            bookingId: 101,
            actorUserId: 'staff-1',
            text: 'VIP traveler',
            createdAt: new Date(),
        };
        (prisma.bookingNote.create as jest.Mock).mockResolvedValue(mockCreatedNote);

        const result = await addInternalNote(101, 'staff-1', 'VIP traveler');
        expect(result).toEqual(mockCreatedNote);
        expect(prisma.bookingNote.create).toHaveBeenCalledWith({
            data: {
                bookingId: 101,
                actorUserId: 'staff-1',
                text: 'VIP traveler',
            },
        });
    });
});
