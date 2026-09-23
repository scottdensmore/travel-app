'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BookingStatus } from '@prisma/client';
import StepUpModal from './StepUpModal';

export interface SupportBookingLeg {
    id: number;
    sequence?: number;
    flight?: {
        id?: string;
        flightNumber: string;
        airline?: string;
        fromAirportCode?: string;
        toAirportCode?: string;
        departureDate?: Date | string;
        status?: string;
    };
}

export interface SupportBookingSeatAssignment {
    id?: string;
    flightId?: string;
    seatNumber: string;
    cabinClass?: string;
    releasedAt?: Date | string | null;
}

export interface SupportBookingPassenger {
    id: string;
    firstName: string;
    lastName: string;
    seatAssignments?: SupportBookingSeatAssignment[];
}

export interface SupportBookingUser {
    id?: string;
    name?: string | null;
    email?: string | null;
}

export interface SupportBookingItem {
    id: number;
    reference: string;
    status: BookingStatus;
    totalPriceCents?: number;
    currency?: string;
    createdAt?: Date | string;
    user?: SupportBookingUser | null;
    legs?: SupportBookingLeg[];
    passengers?: SupportBookingPassenger[];
    notesCount?: number;
    notes?: Array<{ text: string; actorUserId?: string }>;
}

export interface SupportSearchResultData {
    bookings?: SupportBookingItem[];
    totalCount?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
    [index: number]: SupportBookingItem;
    length?: number;
}

export interface BookingNoteItem {
    id: string;
    bookingId: number;
    actorUserId: string;
    text: string;
    createdAt: Date | string;
    actor?: {
        id?: string;
        name?: string | null;
        email?: string | null;
        role?: string;
    } | null;
}

export interface BookingManagementPortalProps {
    initialData?: SupportSearchResultData | SupportBookingItem[];
    initialBookings?: SupportBookingItem[];
    searchAction: (query: {
        reference?: string;
        emailOrName?: string;
        flightNumber?: string;
        status?: BookingStatus;
        dateFrom?: string;
        dateTo?: string;
        page?: number;
        pageSize?: number;
    }) => Promise<SupportSearchResultData | SupportBookingItem[]>;
    cancelAction: (bookingId: number, reason: string, stepUpCode?: string) => Promise<unknown>;
    addNoteAction?: (bookingId: number, note: string) => Promise<void>;
    noteAction?: (bookingId: number, note: string) => Promise<void>;
    getNotesAction?: (bookingId: number) => Promise<BookingNoteItem[]>;
    emailAction?: (bookingId: number) => Promise<unknown>;
    resendEmailAction?: (bookingId: number) => Promise<unknown>;
    receiptAction?: (bookingId: number) => Promise<unknown>;
    resendReceiptEmailAction?: (bookingId: number) => Promise<unknown>;
    seatChangeAction?: (
        bookingId: number,
        seatChanges: Array<{ passengerId: string; legId: number; seatNumber: string }>,
        reason: string
    ) => Promise<void>;
    staffChangeBookingSeatsAction?: (
        bookingId: number,
        seatChanges: Array<{ passengerId: string; legId: number; seatNumber: string }>,
        reason: string
    ) => Promise<void>;
    rebookAction?: (bookingId: number, request: Record<string, unknown>, reason: string) => Promise<unknown>;
    staffRebookItineraryAction?: (bookingId: number, request: Record<string, unknown>, reason: string) => Promise<unknown>;
}

export default function BookingManagementPortal({
    initialData,
    initialBookings,
    searchAction,
    cancelAction,
    addNoteAction,
    noteAction,
    getNotesAction,
    emailAction,
    resendEmailAction,
    receiptAction,
    resendReceiptEmailAction,
    seatChangeAction,
    staffChangeBookingSeatsAction,
    rebookAction,
    staffRebookItineraryAction,
}: BookingManagementPortalProps) {
    // Resolve initial list
    const parseInitialBookings = (): SupportBookingItem[] => {
        if (Array.isArray(initialData)) {
            return initialData;
        }
        if (initialData && Array.isArray(initialData.bookings)) {
            return initialData.bookings;
        }
        if (Array.isArray(initialBookings)) {
            return initialBookings;
        }
        return [];
    };

    const initialList = parseInitialBookings();
    const initialTotal =
        initialData && !Array.isArray(initialData) && typeof initialData.totalCount === 'number'
            ? initialData.totalCount
            : initialList.length;
    const initialPage =
        initialData && !Array.isArray(initialData) && typeof initialData.page === 'number'
            ? initialData.page
            : 1;
    const initialPageSize =
        initialData && !Array.isArray(initialData) && typeof initialData.pageSize === 'number'
            ? initialData.pageSize
            : 25;
    const initialTotalPages =
        initialData && !Array.isArray(initialData) && typeof initialData.totalPages === 'number'
            ? initialData.totalPages
            : Math.ceil(initialTotal / initialPageSize) || 1;

    // State
    const [bookings, setBookings] = useState<SupportBookingItem[]>(initialList);
    const [totalCount, setTotalCount] = useState<number>(initialTotal);
    const [page, setPage] = useState<number>(initialPage);
    const [pageSize] = useState<number>(initialPageSize);
    const [totalPages, setTotalPages] = useState<number>(initialTotalPages);
    const [loading, setLoading] = useState<boolean>(false);
    const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

    // Search filters
    const [reference, setReference] = useState<string>('');
    const [emailOrName, setEmailOrName] = useState<string>('');
    const [flightNumber, setFlightNumber] = useState<string>('');
    const [status, setStatus] = useState<BookingStatus | ''>('');
    const [dateFrom, setDateFrom] = useState<string>('');
    const [dateTo, setDateTo] = useState<string>('');

    // Modals state
    const [activeNotesBooking, setActiveNotesBooking] = useState<SupportBookingItem | null>(null);
    const [notesList, setNotesList] = useState<BookingNoteItem[]>([]);
    const [newNoteText, setNewNoteText] = useState<string>('');
    const [isNotesLoading, setIsNotesLoading] = useState<boolean>(false);
    const [isAddingNote, setIsAddingNote] = useState<boolean>(false);

    const [activeSeatBooking, setActiveSeatBooking] = useState<SupportBookingItem | null>(null);
    const [seatChanges, setSeatChanges] = useState<{ [key: string]: string }>({});
    const [seatReason, setSeatReason] = useState<string>('');
    const [isSavingSeats, setIsSavingSeats] = useState<boolean>(false);

    const [activeRebookBooking, setActiveRebookBooking] = useState<SupportBookingItem | null>(null);
    const [rebookFlight, setRebookFlight] = useState<string>('');
    const [rebookReason, setRebookReason] = useState<string>('');
    const [isRebooking, setIsRebooking] = useState<boolean>(false);

    const [activeCancelBooking, setActiveCancelBooking] = useState<SupportBookingItem | null>(null);
    const [cancelReason, setCancelReason] = useState<string>('');
    const [cancelStepUpCode, setCancelStepUpCode] = useState<string>('');
    const [isCancelling, setIsCancelling] = useState<boolean>(false);

    // StepUp modal state
    const [isStepUpOpen, setIsStepUpOpen] = useState<boolean>(false);
    const [stepUpError, setStepUpError] = useState<string | null>(null);

    // Effective actions
    const doAddNote = addNoteAction || noteAction;
    const doSendEmail = emailAction || resendEmailAction;
    const doSendReceipt = receiptAction || resendReceiptEmailAction;
    const doChangeSeats = seatChangeAction || staffChangeBookingSeatsAction;
    const doRebook = rebookAction || staffRebookItineraryAction;

    // Focus ref for modals
    const modalInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

    // Escape listener for modals
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (activeNotesBooking) setActiveNotesBooking(null);
                if (activeSeatBooking) setActiveSeatBooking(null);
                if (activeRebookBooking) setActiveRebookBooking(null);
                if (activeCancelBooking) setActiveCancelBooking(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeNotesBooking, activeSeatBooking, activeRebookBooking, activeCancelBooking]);

    // Focus first input on modal open
    useEffect(() => {
        if (activeNotesBooking || activeSeatBooking || activeRebookBooking || activeCancelBooking) {
            setTimeout(() => {
                modalInputRef.current?.focus();
            }, 50);
        }
    }, [activeNotesBooking, activeSeatBooking, activeRebookBooking, activeCancelBooking]);

    const executeSearch = async (targetPage: number) => {
        setLoading(true);
        setFeedback(null);
        try {
            const query = {
                reference: reference.trim() || undefined,
                emailOrName: emailOrName.trim() || undefined,
                flightNumber: flightNumber.trim() || undefined,
                status: (status as BookingStatus) || undefined,
                dateFrom: dateFrom || undefined,
                dateTo: dateTo || undefined,
                page: targetPage,
                pageSize,
            };

            const result = await searchAction(query);

            if (result && !Array.isArray(result) && Array.isArray(result.bookings)) {
                setBookings(result.bookings);
                setTotalCount(typeof result.totalCount === 'number' ? result.totalCount : result.bookings.length);
                setPage(typeof result.page === 'number' ? result.page : targetPage);
                setTotalPages(
                    typeof result.totalPages === 'number'
                        ? result.totalPages
                        : Math.ceil((result.totalCount || result.bookings.length) / pageSize) || 1
                );
            } else if (Array.isArray(result)) {
                setBookings(result);
                setTotalCount(result.length);
                setPage(targetPage);
                setTotalPages(Math.ceil(result.length / pageSize) || 1);
            }
        } catch (err: unknown) {
            setFeedback({
                message: err instanceof Error ? err.message : 'Failed to search bookings',
                isError: true,
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        executeSearch(1);
    };

    const handleResetFilters = () => {
        setReference('');
        setEmailOrName('');
        setFlightNumber('');
        setStatus('');
        setDateFrom('');
        setDateTo('');
        executeSearch(1);
    };

    // Notes Handlers
    const handleOpenNotes = async (booking: SupportBookingItem) => {
        setActiveNotesBooking(booking);
        setNewNoteText('');
        setNotesList([]);
        if (getNotesAction) {
            setIsNotesLoading(true);
            try {
                const notes = await getNotesAction(booking.id);
                setNotesList(notes);
            } catch (err: unknown) {
                setFeedback({
                    message: err instanceof Error ? err.message : 'Failed to load booking notes',
                    isError: true,
                });
            } finally {
                setIsNotesLoading(false);
            }
        }
    };

    const handleAddNote = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeNotesBooking || !doAddNote || !newNoteText.trim()) return;

        setIsAddingNote(true);
        try {
            await doAddNote(activeNotesBooking.id, newNoteText.trim());

            // Update local note count
            setBookings((prev) =>
                prev.map((b) =>
                    b.id === activeNotesBooking.id
                        ? { ...b, notesCount: (b.notesCount || 0) + 1 }
                        : b
                )
            );

            // Reload notes list if action is available
            if (getNotesAction) {
                const updatedNotes = await getNotesAction(activeNotesBooking.id);
                setNotesList(updatedNotes);
            }
            setNewNoteText('');
        } catch (err: unknown) {
            setFeedback({
                message: err instanceof Error ? err.message : 'Failed to add note',
                isError: true,
            });
        } finally {
            setIsAddingNote(false);
        }
    };

    // Seat Change Handlers
    const handleOpenSeatChange = (booking: SupportBookingItem) => {
        setActiveSeatBooking(booking);
        setSeatReason('');
        const initialSeatsMap: { [key: string]: string } = {};

        if (booking.passengers && booking.passengers.length > 0) {
            booking.passengers.forEach((p) => {
                p.seatAssignments?.forEach((sa) => {
                    const leg = booking.legs?.find((l) => String(l.flight?.id) === String(sa.flightId)) || booking.legs?.[0];
                    const legId = leg?.id ?? 1;
                    const key = `${p.id}_${legId}`;
                    initialSeatsMap[key] = sa.seatNumber;
                });
            });
        }
        setSeatChanges(initialSeatsMap);
    };

    const handleConfirmSeatChange = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeSeatBooking || !doChangeSeats) return;

        const changesList: Array<{ passengerId: string; legId: number; seatNumber: string }> = [];

        if (activeSeatBooking.passengers && activeSeatBooking.passengers.length > 0) {
            activeSeatBooking.passengers.forEach((p) => {
                const leg = activeSeatBooking.legs?.[0];
                const legId = leg?.id ?? 1;
                const key = `${p.id}_${legId}`;
                const seatNumber = seatChanges[key] || p.seatAssignments?.[0]?.seatNumber || '12A';
                changesList.push({
                    passengerId: p.id,
                    legId,
                    seatNumber,
                });
            });
        }

        setIsSavingSeats(true);
        try {
            await doChangeSeats(activeSeatBooking.id, changesList, seatReason.trim());
            setFeedback({ message: 'Seats updated successfully.', isError: false });
            setActiveSeatBooking(null);
            executeSearch(page);
        } catch (err: unknown) {
            setFeedback({
                message: err instanceof Error ? err.message : 'Failed to change seats',
                isError: true,
            });
        } finally {
            setIsSavingSeats(false);
        }
    };

    // Rebooking Handlers
    const handleOpenRebook = (booking: SupportBookingItem) => {
        setActiveRebookBooking(booking);
        setRebookFlight('');
        setRebookReason('');
    };

    const handleConfirmRebooking = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeRebookBooking || !doRebook) return;

        setIsRebooking(true);
        try {
            await doRebook(
                activeRebookBooking.id,
                { newFlightId: rebookFlight.trim() },
                rebookReason.trim()
            );
            setFeedback({ message: 'Itinerary rebooked successfully.', isError: false });
            setActiveRebookBooking(null);
            executeSearch(page);
        } catch (err: unknown) {
            setFeedback({
                message: err instanceof Error ? err.message : 'Failed to rebook itinerary',
                isError: true,
            });
        } finally {
            setIsRebooking(false);
        }
    };

    // Cancel Handlers
    const handleOpenCancel = (booking: SupportBookingItem) => {
        setActiveCancelBooking(booking);
        setCancelReason('');
        setCancelStepUpCode('');
        setStepUpError(null);
    };

    const handleConfirmCancel = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeCancelBooking) return;

        setIsCancelling(true);
        try {
            await cancelAction(
                activeCancelBooking.id,
                cancelReason.trim(),
                cancelStepUpCode.trim() || undefined
            );
            setFeedback({ message: `Booking ${activeCancelBooking.reference} cancelled and refunded.`, isError: false });
            setBookings((prev) =>
                prev.map((b) =>
                    b.id === activeCancelBooking.id ? { ...b, status: BookingStatus.CANCELLED } : b
                )
            );
            setActiveCancelBooking(null);
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.toLowerCase().includes('step') || errMsg.toLowerCase().includes('mfa') || errMsg.toLowerCase().includes('totp')) {
                // Open StepUpModal
                setIsStepUpOpen(true);
                setStepUpError(errMsg);
            } else {
                setFeedback({ message: errMsg, isError: true });
            }
        } finally {
            setIsCancelling(false);
        }
    };

    const handleStepUpSubmit = async (code: string) => {
        if (!activeCancelBooking) return;
        setIsCancelling(true);
        setStepUpError(null);
        try {
            await cancelAction(activeCancelBooking.id, cancelReason.trim(), code);
            setIsStepUpOpen(false);
            setFeedback({ message: `Booking ${activeCancelBooking.reference} cancelled and refunded.`, isError: false });
            setBookings((prev) =>
                prev.map((b) =>
                    b.id === activeCancelBooking.id ? { ...b, status: BookingStatus.CANCELLED } : b
                )
            );
            setActiveCancelBooking(null);
        } catch (err: unknown) {
            setStepUpError(err instanceof Error ? err.message : 'Failed to authorize cancellation');
        } finally {
            setIsCancelling(false);
        }
    };

    // Email Resend Handlers
    const handleResendConfirmation = async (bookingId: number) => {
        if (!doSendEmail) return;
        try {
            await doSendEmail(bookingId);
            setFeedback({ message: 'Confirmation email sent successfully.', isError: false });
        } catch (err: unknown) {
            setFeedback({
                message: err instanceof Error ? err.message : 'Failed to resend confirmation email',
                isError: true,
            });
        }
    };

    const handleResendReceipt = async (bookingId: number) => {
        if (!doSendReceipt) return;
        try {
            await doSendReceipt(bookingId);
            setFeedback({ message: 'Receipt email sent successfully.', isError: false });
        } catch (err: unknown) {
            setFeedback({
                message: err instanceof Error ? err.message : 'Failed to resend receipt email',
                isError: true,
            });
        }
    };

    const showingStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
    const showingEnd = Math.min(page * pageSize, totalCount);

    return (
        <div className="space-y-6">
            {feedback && (
                <div
                    role="alert"
                    className={`p-4 rounded border text-sm ${
                        feedback.isError
                            ? 'bg-red-950 border-red-700 text-red-200'
                            : 'bg-green-950 border-green-700 text-green-200'
                    }`}
                >
                    {feedback.message}
                </div>
            )}

            {/* Filter Bar */}
            <div
                style={{
                    background: '#17142d',
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    borderRadius: '12px',
                    padding: '20px',
                }}
            >
                <form onSubmit={handleSearchSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        <div>
                            <label htmlFor="filter-reference" className="block text-xs font-semibold text-purple-300 mb-1">
                                Reference
                            </label>
                            <input
                                id="filter-reference"
                                type="text"
                                placeholder="Search by Reference (MA-...)"
                                value={reference}
                                onChange={(e) => setReference(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-400"
                            />
                        </div>

                        <div>
                            <label htmlFor="filter-customer" className="block text-xs font-semibold text-purple-300 mb-1">
                                Customer
                            </label>
                            <input
                                id="filter-customer"
                                type="text"
                                placeholder="Customer Email or Name"
                                value={emailOrName}
                                onChange={(e) => setEmailOrName(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-400"
                            />
                        </div>

                        <div>
                            <label htmlFor="filter-flight" className="block text-xs font-semibold text-purple-300 mb-1">
                                Flight Number
                            </label>
                            <input
                                id="filter-flight"
                                type="text"
                                placeholder="Flight Number"
                                value={flightNumber}
                                onChange={(e) => setFlightNumber(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-400"
                            />
                        </div>

                        <div>
                            <label htmlFor="filter-status" className="block text-xs font-semibold text-purple-300 mb-1">
                                Status
                            </label>
                            <select
                                id="filter-status"
                                aria-label="Status"
                                value={status}
                                onChange={(e) => setStatus(e.target.value as BookingStatus)}
                                className="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-white text-sm focus:outline-none focus:border-purple-400"
                            >
                                <option value="">Any Status</option>
                                <option value={BookingStatus.CONFIRMED}>Confirmed</option>
                                <option value={BookingStatus.CANCELLED}>Cancelled</option>
                                <option value={BookingStatus.DISRUPTED}>Disrupted</option>
                            </select>
                        </div>

                        <div>
                            <label htmlFor="dateFrom" className="block text-xs font-semibold text-purple-300 mb-1">
                                Date From
                            </label>
                            <input
                                id="dateFrom"
                                aria-label="Date From"
                                type="date"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-white text-sm focus:outline-none focus:border-purple-400"
                            />
                        </div>

                        <div>
                            <label htmlFor="dateTo" className="block text-xs font-semibold text-purple-300 mb-1">
                                Date To
                            </label>
                            <input
                                id="dateTo"
                                aria-label="Date To"
                                type="date"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-white text-sm focus:outline-none focus:border-purple-400"
                            />
                        </div>
                    </div>

                    <div className="flex gap-3 justify-end items-center">
                        <button
                            type="button"
                            onClick={handleResetFilters}
                            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-gray-300 text-sm font-semibold border border-gray-700 transition"
                        >
                            Reset Filters
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded text-white font-bold text-sm transition"
                        >
                            {loading ? 'Searching...' : 'Search'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Results Table & Pagination */}
            <div
                style={{
                    background: '#17142d',
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    borderRadius: '12px',
                    padding: '20px',
                }}
            >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                    <h2 className="text-xl font-bold text-purple-400">Bookings</h2>
                    <span className="text-sm font-medium text-gray-300">
                        {totalCount === 0
                            ? 'Showing 0 of 0 bookings'
                            : `Showing ${showingStart}–${showingEnd} of ${totalCount} bookings`}
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-gray-800 text-gray-400 text-sm">
                                <th className="p-3">Reference</th>
                                <th className="p-3">Customer</th>
                                <th className="p-3">Itinerary</th>
                                <th className="p-3">Status</th>
                                <th className="p-3">Internal Notes</th>
                                <th className="p-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/60">
                            {bookings.map((booking) => {
                                const notesCount = booking.notesCount ?? booking.notes?.length ?? 0;
                                const customerName = booking.user?.name || booking.user?.email || 'Guest';

                                return (
                                    <tr key={booking.id} className="hover:bg-gray-900/40 text-sm">
                                        <td className="p-3 font-mono font-bold text-purple-300">
                                            {booking.reference}
                                        </td>
                                        <td className="p-3">
                                            <div className="font-semibold text-white">{customerName}</div>
                                            {booking.user?.email && booking.user.name && (
                                                <div className="text-xs text-gray-400">{booking.user.email}</div>
                                            )}
                                        </td>
                                        <td className="p-3">
                                            {booking.legs && booking.legs.length > 0 ? (
                                                <div className="space-y-1">
                                                    {booking.legs.map((leg) => (
                                                        <div key={leg.id || leg.flight?.flightNumber} className="text-xs">
                                                            <span className="font-semibold text-purple-200">
                                                                {leg.flight?.flightNumber || 'FLIGHT'}
                                                            </span>{' '}
                                                            <span className="text-gray-400">
                                                                ({leg.flight?.fromAirportCode} → {leg.flight?.toAirportCode})
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-500">No legs</span>
                                            )}
                                        </td>
                                        <td className="p-3">
                                            <span
                                                className={`px-2.5 py-1 rounded text-xs font-bold ${
                                                    booking.status === BookingStatus.CONFIRMED
                                                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                                        : booking.status === BookingStatus.CANCELLED
                                                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                                        : 'bg-amber-950 text-amber-300 border border-amber-800'
                                                }`}
                                            >
                                                {booking.status}
                                            </span>
                                        </td>
                                        <td className="p-3">
                                            <button
                                                type="button"
                                                onClick={() => handleOpenNotes(booking)}
                                                aria-label={`View ${notesCount} Notes`}
                                                className="px-2.5 py-1 bg-purple-950/60 hover:bg-purple-900 border border-purple-800 text-purple-300 rounded text-xs font-semibold transition"
                                            >
                                                View {notesCount} Notes
                                            </button>
                                        </td>
                                        <td className="p-3">
                                            <div className="flex flex-wrap gap-2 items-center">
                                                {doChangeSeats && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenSeatChange(booking)}
                                                        className="text-xs text-indigo-300 hover:text-indigo-200 hover:underline"
                                                    >
                                                        Reassign Seats
                                                    </button>
                                                )}
                                                {doRebook && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenRebook(booking)}
                                                        className="text-xs text-indigo-300 hover:text-indigo-200 hover:underline"
                                                    >
                                                        Rebook Itinerary
                                                    </button>
                                                )}
                                                {doSendEmail && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleResendConfirmation(booking.id)}
                                                        className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                                                    >
                                                        Resend Confirmation
                                                    </button>
                                                )}
                                                {doSendReceipt && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleResendReceipt(booking.id)}
                                                        className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                                                    >
                                                        Resend Receipt
                                                    </button>
                                                )}
                                                <a
                                                    href={`/api/documents/invoice/${booking.id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-teal-400 hover:text-teal-300 hover:underline"
                                                >
                                                    Download Tax Invoice
                                                </a>
                                                {booking.status !== BookingStatus.CANCELLED && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenCancel(booking)}
                                                        className="text-xs text-rose-400 hover:text-rose-300 hover:underline"
                                                    >
                                                        Cancel & Refund
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {bookings.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-gray-500">
                                        No bookings found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-6 pt-4 border-t border-gray-800">
                    <span className="text-xs text-gray-400">
                        Page {page} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => executeSearch(page - 1)}
                            disabled={page <= 1 || loading}
                            className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white border border-gray-700 transition"
                        >
                            Previous
                        </button>
                        <button
                            type="button"
                            onClick={() => executeSearch(page + 1)}
                            disabled={page >= totalPages || loading}
                            className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white border border-gray-700 transition"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>

            {/* Notes Modal */}
            {activeNotesBooking && (
                <div
                    role="presentation"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setActiveNotesBooking(null);
                    }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.75)',
                        backdropFilter: 'blur(8px)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '16px',
                        boxSizing: 'border-box',
                    }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="notes-modal-title"
                        style={{
                            background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                            border: '1px solid rgba(255, 255, 255, 0.16)',
                            borderRadius: '16px',
                            padding: '24px',
                            maxWidth: '560px',
                            width: '100%',
                            boxSizing: 'border-box',
                            color: '#fff',
                            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                        }}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 id="notes-modal-title" className="text-lg font-bold text-purple-300">
                                    Internal Support Notes
                                </h3>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Booking Reference: <span className="font-mono text-purple-200">{activeNotesBooking.reference}</span>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveNotesBooking(null)}
                                className="text-gray-400 hover:text-white text-lg px-2"
                                aria-label="Close dialog"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Existing Notes List */}
                        <div className="max-h-60 overflow-y-auto space-y-3 mb-4 pr-1">
                            {isNotesLoading ? (
                                <p className="text-xs text-gray-400">Loading notes...</p>
                            ) : notesList.length === 0 ? (
                                <p className="text-xs text-gray-500 italic">No internal notes yet.</p>
                            ) : (
                                notesList.map((note) => (
                                    <div
                                        key={note.id}
                                        className="p-3 rounded bg-gray-900/70 border border-gray-800 text-xs space-y-1"
                                    >
                                        <div className="flex justify-between text-gray-400">
                                            <span className="font-semibold text-purple-300">
                                                {note.actor?.name || note.actor?.email || 'Staff'}{' '}
                                                {note.actor?.role && `(${note.actor.role})`}
                                            </span>
                                            <span>{new Date(note.createdAt).toLocaleString()}</span>
                                        </div>
                                        <p className="text-gray-200">{note.text}</p>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Add Note Form */}
                        {doAddNote && (
                            <form onSubmit={handleAddNote} className="space-y-3">
                                <textarea
                                    ref={modalInputRef as React.RefObject<HTMLTextAreaElement>}
                                    rows={3}
                                    placeholder="Add an internal support note..."
                                    value={newNoteText}
                                    onChange={(e) => setNewNoteText(e.target.value)}
                                    className="w-full p-2.5 bg-gray-900 rounded border border-gray-700 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-purple-400"
                                />
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setActiveNotesBooking(null)}
                                        className="px-3 py-1.5 rounded bg-gray-800 text-xs text-gray-300 hover:bg-gray-700 border border-gray-700"
                                    >
                                        Close
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isAddingNote || !newNoteText.trim()}
                                        className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-xs font-bold text-white"
                                    >
                                        {isAddingNote ? 'Adding...' : 'Add Note'}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* Seat Reassignment Modal */}
            {activeSeatBooking && (
                <div
                    role="presentation"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setActiveSeatBooking(null);
                    }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.75)',
                        backdropFilter: 'blur(8px)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '16px',
                        boxSizing: 'border-box',
                    }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="seat-modal-title"
                        style={{
                            background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                            border: '1px solid rgba(255, 255, 255, 0.16)',
                            borderRadius: '16px',
                            padding: '24px',
                            maxWidth: '520px',
                            width: '100%',
                            boxSizing: 'border-box',
                            color: '#fff',
                            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                        }}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 id="seat-modal-title" className="text-lg font-bold text-purple-300">
                                    Reassign Seats
                                </h3>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Booking Reference: <span className="font-mono text-purple-200">{activeSeatBooking.reference}</span>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveSeatBooking(null)}
                                className="text-gray-400 hover:text-white text-lg px-2"
                                aria-label="Close dialog"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleConfirmSeatChange} className="space-y-4">
                            <div className="space-y-3">
                                {activeSeatBooking.passengers?.map((p) => {
                                    const leg = activeSeatBooking.legs?.[0];
                                    const legId = leg?.id ?? 1;
                                    const key = `${p.id}_${legId}`;
                                    const currentSeat = seatChanges[key] || p.seatAssignments?.[0]?.seatNumber || '';

                                    return (
                                        <div key={p.id} className="p-3 bg-gray-900/60 rounded border border-gray-800 text-xs">
                                            <div className="font-semibold text-purple-200 mb-1">
                                                Passenger: {p.firstName} {p.lastName}
                                            </div>
                                            <div className="flex items-center gap-3 mt-2">
                                                <label htmlFor={`seat-${p.id}`} className="text-gray-400">
                                                    Assigned Seat:
                                                </label>
                                                <input
                                                    id={`seat-${p.id}`}
                                                    type="text"
                                                    value={currentSeat}
                                                    onChange={(e) =>
                                                        setSeatChanges((prev) => ({
                                                            ...prev,
                                                            [key]: e.target.value.toUpperCase(),
                                                        }))
                                                    }
                                                    className="w-24 px-2 py-1 bg-gray-900 rounded border border-gray-700 text-white font-mono text-center font-bold"
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div>
                                <label htmlFor="seat-reason" className="block text-xs font-semibold text-purple-300 mb-1">
                                    Justification Reason (Required)
                                </label>
                                <textarea
                                    id="seat-reason"
                                    ref={modalInputRef as React.RefObject<HTMLTextAreaElement>}
                                    required
                                    rows={2}
                                    placeholder="Reason for seat change"
                                    value={seatReason}
                                    onChange={(e) => setSeatReason(e.target.value)}
                                    className="w-full p-2 bg-gray-900 rounded border border-gray-700 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-purple-400"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setActiveSeatBooking(null)}
                                    className="px-3 py-1.5 rounded bg-gray-800 text-xs text-gray-300 hover:bg-gray-700 border border-gray-700"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSavingSeats || !seatReason.trim()}
                                    className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-xs font-bold text-white"
                                >
                                    {isSavingSeats ? 'Updating...' : 'Confirm Seat Change'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Rebooking Modal */}
            {activeRebookBooking && (
                <div
                    role="presentation"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setActiveRebookBooking(null);
                    }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.75)',
                        backdropFilter: 'blur(8px)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '16px',
                        boxSizing: 'border-box',
                    }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="rebook-modal-title"
                        style={{
                            background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                            border: '1px solid rgba(255, 255, 255, 0.16)',
                            borderRadius: '16px',
                            padding: '24px',
                            maxWidth: '520px',
                            width: '100%',
                            boxSizing: 'border-box',
                            color: '#fff',
                            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                        }}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 id="rebook-modal-title" className="text-lg font-bold text-purple-300">
                                    Rebook Itinerary
                                </h3>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Booking Reference: <span className="font-mono text-purple-200">{activeRebookBooking.reference}</span>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveRebookBooking(null)}
                                className="text-gray-400 hover:text-white text-lg px-2"
                                aria-label="Close dialog"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleConfirmRebooking} className="space-y-4">
                            <div>
                                <label htmlFor="rebook-flight-id" className="block text-xs font-semibold text-purple-300 mb-1">
                                    New Flight ID or Number
                                </label>
                                <input
                                    id="rebook-flight-id"
                                    ref={modalInputRef as React.RefObject<HTMLInputElement>}
                                    type="text"
                                    required
                                    placeholder="New flight ID or number"
                                    value={rebookFlight}
                                    onChange={(e) => setRebookFlight(e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-purple-400 font-mono"
                                />
                            </div>

                            <div>
                                <label htmlFor="rebook-reason" className="block text-xs font-semibold text-purple-300 mb-1">
                                    Operational Justification (Required)
                                </label>
                                <textarea
                                    id="rebook-reason"
                                    required
                                    rows={2}
                                    placeholder="Reason for rebooking"
                                    value={rebookReason}
                                    onChange={(e) => setRebookReason(e.target.value)}
                                    className="w-full p-2 bg-gray-900 rounded border border-gray-700 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-purple-400"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setActiveRebookBooking(null)}
                                    className="px-3 py-1.5 rounded bg-gray-800 text-xs text-gray-300 hover:bg-gray-700 border border-gray-700"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isRebooking || !rebookFlight.trim() || !rebookReason.trim()}
                                    className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-xs font-bold text-white"
                                >
                                    {isRebooking ? 'Rebooking...' : 'Confirm Rebooking'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Cancel & Refund Dialog */}
            {activeCancelBooking && (
                <div
                    role="presentation"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setActiveCancelBooking(null);
                    }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.75)',
                        backdropFilter: 'blur(8px)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '16px',
                        boxSizing: 'border-box',
                    }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="cancel-modal-title"
                        style={{
                            background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                            border: '1px solid rgba(255, 255, 255, 0.16)',
                            borderRadius: '16px',
                            padding: '24px',
                            maxWidth: '520px',
                            width: '100%',
                            boxSizing: 'border-box',
                            color: '#fff',
                            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                        }}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 id="cancel-modal-title" className="text-lg font-bold text-rose-300">
                                    Cancel & Refund Booking
                                </h3>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Booking Reference: <span className="font-mono text-purple-200">{activeCancelBooking.reference}</span>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveCancelBooking(null)}
                                className="text-gray-400 hover:text-white text-lg px-2"
                                aria-label="Close dialog"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleConfirmCancel} className="space-y-4">
                            <div>
                                <label htmlFor="cancel-reason" className="block text-xs font-semibold text-rose-300 mb-1">
                                    Cancellation Justification (Required)
                                </label>
                                <textarea
                                    id="cancel-reason"
                                    ref={modalInputRef as React.RefObject<HTMLTextAreaElement>}
                                    required
                                    rows={2}
                                    placeholder="Justification reason for cancellation"
                                    value={cancelReason}
                                    onChange={(e) => setCancelReason(e.target.value)}
                                    className="w-full p-2 bg-gray-900 rounded border border-gray-700 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-rose-400"
                                />
                            </div>

                            <div>
                                <label htmlFor="cancel-step-up" className="block text-xs font-semibold text-purple-300 mb-1">
                                    Security Code (TOTP MFA)
                                </label>
                                <input
                                    id="cancel-step-up"
                                    type="text"
                                    maxLength={6}
                                    placeholder="Security code (optional or required)"
                                    value={cancelStepUpCode}
                                    onChange={(e) => setCancelStepUpCode(e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-purple-400 font-mono tracking-widest"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setActiveCancelBooking(null)}
                                    className="px-3 py-1.5 rounded bg-gray-800 text-xs text-gray-300 hover:bg-gray-700 border border-gray-700"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isCancelling || !cancelReason.trim()}
                                    className="px-4 py-1.5 rounded bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-xs font-bold text-white"
                                >
                                    {isCancelling ? 'Processing...' : 'Confirm Cancellation'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Step-Up Modal when elevated authorization is required */}
            <StepUpModal
                isOpen={isStepUpOpen}
                title="Elevated Authorization Required"
                description="Enter your 6-digit TOTP security code to authorize cancellation and refund."
                onClose={() => setIsStepUpOpen(false)}
                onSubmit={handleStepUpSubmit}
                error={stepUpError}
                isSubmitting={isCancelling}
            />
        </div>
    );
}
