import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingManagementPortal from '@/components/admin/BookingManagementPortal';
import { BookingStatus } from '@prisma/client';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: jest.fn() }),
}));

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
        notesCount: 2,
    },
];

const mockInitialResult = {
    bookings: mockBookings,
    totalCount: 42,
    page: 1,
    pageSize: 25,
    totalPages: 2,
};

describe('BookingManagementPortal', () => {
    const mockSearchAction = jest.fn();
    const mockCancelAction = jest.fn();
    const mockAddNoteAction = jest.fn();
    const mockGetNotesAction = jest.fn().mockResolvedValue([
        {
            id: 'n1',
            bookingId: 101,
            actorUserId: 'u-agent',
            text: 'Customer requested window seat',
            createdAt: new Date('2026-09-02T10:00:00Z'),
            actor: { id: 'u-agent', name: 'Agent Smith', email: 'smith@mona.internal', role: 'SUPPORT' },
        },
    ]);
    const mockEmailAction = jest.fn();
    const mockReceiptAction = jest.fn();
    const mockSeatChangeAction = jest.fn();
    const mockRebookAction = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders search filter inputs, booking rows, and pagination controls', () => {
        render(
            <BookingManagementPortal
                initialData={mockInitialResult}
                searchAction={mockSearchAction}
                cancelAction={mockCancelAction}
                getNotesAction={mockGetNotesAction}
                addNoteAction={mockAddNoteAction}
                emailAction={mockEmailAction}
                receiptAction={mockReceiptAction}
                seatChangeAction={mockSeatChangeAction}
                rebookAction={mockRebookAction}
            />
        );

        expect(screen.getByPlaceholderText(/search by reference/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/customer email or name/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/flight number/i)).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: /status/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/date from/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/date to/i)).toBeInTheDocument();

        expect(screen.getByText('MA-ABC123')).toBeInTheDocument();
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText(/showing 1–25 of 42 bookings/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
        expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
    });

    it('submits search filter values when Search button is clicked', async () => {
        mockSearchAction.mockResolvedValueOnce({
            bookings: [],
            totalCount: 0,
            page: 1,
            pageSize: 25,
            totalPages: 1,
        });

        render(
            <BookingManagementPortal
                initialData={mockInitialResult}
                searchAction={mockSearchAction}
                cancelAction={mockCancelAction}
                getNotesAction={mockGetNotesAction}
                addNoteAction={mockAddNoteAction}
                emailAction={mockEmailAction}
                receiptAction={mockReceiptAction}
                seatChangeAction={mockSeatChangeAction}
            />
        );

        fireEvent.change(screen.getByPlaceholderText(/search by reference/i), {
            target: { value: 'MA-ABC' },
        });
        fireEvent.change(screen.getByPlaceholderText(/flight number/i), {
            target: { value: 'MA101' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: /status/i }), {
            target: { value: 'CONFIRMED' },
        });
        fireEvent.change(screen.getByLabelText(/date from/i), {
            target: { value: '2026-10-01' },
        });
        fireEvent.change(screen.getByLabelText(/date to/i), {
            target: { value: '2026-10-31' },
        });

        fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

        await waitFor(() => {
            expect(mockSearchAction).toHaveBeenCalledWith(
                expect.objectContaining({
                    reference: 'MA-ABC',
                    flightNumber: 'MA101',
                    status: BookingStatus.CONFIRMED,
                    dateFrom: '2026-10-01',
                    dateTo: '2026-10-31',
                    page: 1,
                })
            );
        });
    });

    it('handles pagination navigation when Next button is clicked', async () => {
        mockSearchAction.mockResolvedValueOnce({
            bookings: mockBookings,
            totalCount: 42,
            page: 2,
            pageSize: 25,
            totalPages: 2,
        });

        render(
            <BookingManagementPortal
                initialData={mockInitialResult}
                searchAction={mockSearchAction}
                cancelAction={mockCancelAction}
                getNotesAction={mockGetNotesAction}
                addNoteAction={mockAddNoteAction}
                emailAction={mockEmailAction}
                receiptAction={mockReceiptAction}
                seatChangeAction={mockSeatChangeAction}
            />
        );

        const nextButton = screen.getByRole('button', { name: /next/i });
        fireEvent.click(nextButton);

        await waitFor(() => {
            expect(mockSearchAction).toHaveBeenCalledWith(
                expect.objectContaining({
                    page: 2,
                })
            );
        });
    });

    it('opens notes modal when clicking notes count badge', async () => {
        render(
            <BookingManagementPortal
                initialData={mockInitialResult}
                searchAction={mockSearchAction}
                cancelAction={mockCancelAction}
                getNotesAction={mockGetNotesAction}
                addNoteAction={mockAddNoteAction}
                emailAction={mockEmailAction}
                receiptAction={mockReceiptAction}
                seatChangeAction={mockSeatChangeAction}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /view 2 notes/i }));

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(screen.getByText(/internal support notes/i)).toBeInTheDocument();
        });

        expect(mockGetNotesAction).toHaveBeenCalledWith(101);
        expect(await screen.findByText('Customer requested window seat')).toBeInTheDocument();

        // Add a note
        const noteInput = screen.getByPlaceholderText(/add an internal support note/i);
        fireEvent.change(noteInput, { target: { value: 'Followed up with guest' } });
        fireEvent.click(screen.getByRole('button', { name: /add note/i }));

        await waitFor(() => {
            expect(mockAddNoteAction).toHaveBeenCalledWith(101, 'Followed up with guest');
        });
    });

    it('opens seat change modal, fills justification reason, and submits change', async () => {
        mockSeatChangeAction.mockResolvedValueOnce(undefined);

        render(
            <BookingManagementPortal
                initialData={mockInitialResult}
                searchAction={mockSearchAction}
                cancelAction={mockCancelAction}
                getNotesAction={mockGetNotesAction}
                addNoteAction={mockAddNoteAction}
                emailAction={mockEmailAction}
                receiptAction={mockReceiptAction}
                seatChangeAction={mockSeatChangeAction}
            />
        );

        // Open seat change modal
        fireEvent.click(screen.getByRole('button', { name: /reassign seats/i }));

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(screen.getByRole('heading', { name: /reassign seats/i })).toBeInTheDocument();
        });

        const seatInput = screen.getByDisplayValue('12A');
        fireEvent.change(seatInput, { target: { value: '14B' } });

        const reasonInput = screen.getByPlaceholderText(/reason for seat change/i);
        fireEvent.change(reasonInput, { target: { value: 'Customer medical accommodation' } });

        fireEvent.click(screen.getByRole('button', { name: /confirm seat change/i }));

        await waitFor(() => {
            expect(mockSeatChangeAction).toHaveBeenCalledWith(
                101,
                [{ passengerId: 'p1', legId: 1, seatNumber: '14B' }],
                'Customer medical accommodation'
            );
        });
    });

    it('opens rebooking modal, fills flight and justification reason, and submits rebooking', async () => {
        mockRebookAction.mockResolvedValueOnce({ status: 'REBOOKED' });

        render(
            <BookingManagementPortal
                initialData={mockInitialResult}
                searchAction={mockSearchAction}
                cancelAction={mockCancelAction}
                getNotesAction={mockGetNotesAction}
                addNoteAction={mockAddNoteAction}
                emailAction={mockEmailAction}
                receiptAction={mockReceiptAction}
                seatChangeAction={mockSeatChangeAction}
                rebookAction={mockRebookAction}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /rebook itinerary/i }));

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(screen.getByRole('heading', { name: /rebook itinerary/i })).toBeInTheDocument();
        });

        const flightInput = screen.getByPlaceholderText(/new flight id or number/i);
        fireEvent.change(flightInput, { target: { value: 'MA102' } });

        const reasonInput = screen.getByPlaceholderText(/reason for rebooking/i);
        fireEvent.change(reasonInput, { target: { value: 'Flight schedule change request' } });

        fireEvent.click(screen.getByRole('button', { name: /confirm rebooking/i }));

        await waitFor(() => {
            expect(mockRebookAction).toHaveBeenCalledWith(
                101,
                expect.objectContaining({ newFlightId: 'MA102' }),
                'Flight schedule change request'
            );
        });
    });

    it('opens cancellation dialog, prompts for justification reason and stepUpCode when required', async () => {
        // First cancellation attempt prompts or triggers step up code
        mockCancelAction.mockResolvedValueOnce({ success: true });

        render(
            <BookingManagementPortal
                initialData={mockInitialResult}
                searchAction={mockSearchAction}
                cancelAction={mockCancelAction}
                getNotesAction={mockGetNotesAction}
                addNoteAction={mockAddNoteAction}
                emailAction={mockEmailAction}
                receiptAction={mockReceiptAction}
                seatChangeAction={mockSeatChangeAction}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /cancel & refund/i }));

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(screen.getByText(/cancel & refund booking/i)).toBeInTheDocument();
        });

        const reasonInput = screen.getByPlaceholderText(/justification reason for cancellation/i);
        fireEvent.change(reasonInput, { target: { value: 'Traveler cancelled due to illness' } });

        const stepUpInput = screen.getByPlaceholderText(/security code \(optional or required\)/i);
        fireEvent.change(stepUpInput, { target: { value: '123456' } });

        fireEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));

        await waitFor(() => {
            expect(mockCancelAction).toHaveBeenCalledWith(
                101,
                'Traveler cancelled due to illness',
                '123456'
            );
        });
    });

    it('renders document actions: resend confirmation, resend receipt, and download tax invoice link', async () => {
        mockEmailAction.mockResolvedValueOnce({ success: true });
        mockReceiptAction.mockResolvedValueOnce({ success: true });

        render(
            <BookingManagementPortal
                initialData={mockInitialResult}
                searchAction={mockSearchAction}
                cancelAction={mockCancelAction}
                getNotesAction={mockGetNotesAction}
                addNoteAction={mockAddNoteAction}
                emailAction={mockEmailAction}
                receiptAction={mockReceiptAction}
                seatChangeAction={mockSeatChangeAction}
            />
        );

        const confirmationBtn = screen.getByRole('button', { name: /resend confirmation/i });
        fireEvent.click(confirmationBtn);
        await waitFor(() => {
            expect(mockEmailAction).toHaveBeenCalledWith(101);
        });

        const receiptBtn = screen.getByRole('button', { name: /resend receipt/i });
        fireEvent.click(receiptBtn);
        await waitFor(() => {
            expect(mockReceiptAction).toHaveBeenCalledWith(101);
        });

        const invoiceLink = screen.getByRole('link', { name: /download tax invoice/i });
        expect(invoiceLink).toHaveAttribute('href', '/api/documents/invoice/101');
    });

    it('supports backward compatibility with initialBookings and noteAction props', () => {
        render(
            <BookingManagementPortal
                initialBookings={mockBookings}
                searchAction={mockSearchAction}
                cancelAction={mockCancelAction}
                noteAction={mockAddNoteAction}
                emailAction={mockEmailAction}
            />
        );

        expect(screen.getByText('MA-ABC123')).toBeInTheDocument();
    });
});
