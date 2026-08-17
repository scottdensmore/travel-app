import {
    saveCityGuideAction,
    searchFlightsAction,
    getFlightRoutesAction,
    deleteCityGuideAction,
    bookFlightAction,
    toggleFavoriteCityGuideAction,
    submitCityGuideReviewAction,
    cancelBookingAction,
    deleteReviewAction,
    saveFlightScheduleAction,
    deleteFlightScheduleAction,
    updateFlightStatusAction,
    changeBookingSeatsAction,
    getUserNotificationsAction,
    markNotificationAsReadAction,
    markAllNotificationsAsReadAction,
    generateFlightOccurrencesAction,
    getOccupiedSeatsAction,
    holdChosenSeatsAction,
    startCheckoutPaymentAction,
    retryBookingRefundAction,
    reconcilePaymentAttemptAction,
    rebookItineraryAction,
    updateFlightScheduleTermsAction,
    setFlightScheduleActiveAction,
} from '@/app/actions';
import { getServerSession } from 'next-auth';
import TravelGuideService from '@/lib/TravelGuideService';
import FlightBookingService from '@/lib/FlightBookingService';
import FlightScheduleService from '@/lib/FlightScheduleService';
import { prisma } from '@/lib/prisma';
import { checkoutHolderKey, SeatHoldUnavailableError } from '@/lib/seatHolds';
import {
    CheckoutPaymentService,
} from '@/lib/checkoutPaymentService';
import { createStripePaymentProvider, getStripePublishableKey } from '@/lib/stripePaymentProvider';
import { PaymentRefundService } from '@/lib/paymentRefundService';
import { PaymentAttemptReconciliationService } from '@/lib/paymentWebhookService';
import {
    ItineraryRebookingError,
    ItineraryRebookingService,
} from '@/lib/itineraryRebookingService';
import {
    FlightScheduleTermsError,
    FlightScheduleTermsService,
} from '@/lib/flightScheduleTermsService';
import {
    FlightScheduleActivationError,
    FlightScheduleActivationService,
} from '@/lib/flightScheduleActivationService';
import {
    FlightScheduleDeletionError,
    FlightScheduleDeletionService,
} from '@/lib/flightScheduleDeletionService';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

// Keep these heavy/server-only modules out of the unit test.
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

jest.mock('@/lib/FlightBookingService', () => {
    const bookFlight = jest.fn();
    return jest.fn().mockImplementation(() => ({ bookFlight }));
});

jest.mock('@/lib/FlightScheduleService', () => {
    const generateFlightsForDate = jest.fn();
    return jest.fn().mockImplementation(() => ({ generateFlightsForDate }));
});

jest.mock('@/lib/TravelGuideService', () => {
    const saveCityGuide = jest.fn();
    return jest.fn().mockImplementation(() => ({ saveCityGuide }));
});

jest.mock('@/lib/checkoutPaymentService', () => {
    const startPayment = jest.fn();
    const capturePayment = jest.fn();
    const cancelPayment = jest.fn();
    class PaymentCaptureIncompleteError extends Error {}
    return {
        CheckoutPaymentService: jest.fn().mockImplementation(() => ({
            startPayment,
            capturePayment,
            cancelPayment,
        })),
        PaymentCaptureIncompleteError,
    };
});

jest.mock('@/lib/paymentRefundService', () => {
    const settleRefund = jest.fn();
    return {
        PaymentRefundService: jest.fn().mockImplementation(() => ({ settleRefund })),
    };
});

jest.mock('@/lib/paymentWebhookService', () => {
    const reconcileAttempt = jest.fn();
    return {
        PaymentAttemptReconciliationService: jest.fn().mockImplementation(() => ({
            reconcileAttempt,
        })),
    };
});

jest.mock('@/lib/itineraryRebookingService', () => {
    const rebook = jest.fn();
    class ItineraryRebookingError extends Error {
        constructor(readonly code: string, message: string) {
            super(message);
            this.name = 'ItineraryRebookingError';
        }
    }
    return {
        ItineraryRebookingService: jest.fn().mockImplementation(() => ({ rebook })),
        ItineraryRebookingError,
    };
});

jest.mock('@/lib/flightScheduleTermsService', () => {
    const update = jest.fn();
    class FlightScheduleTermsError extends Error {
        constructor(readonly code: string, message: string) {
            super(message);
            this.name = 'FlightScheduleTermsError';
        }
    }
    return {
        FlightScheduleTermsService: jest.fn().mockImplementation(() => ({ update })),
        FlightScheduleTermsError,
    };
});

jest.mock('@/lib/flightScheduleActivationService', () => {
    const setActive = jest.fn();
    class FlightScheduleActivationError extends Error {
        constructor(readonly code: string, message: string) {
            super(message);
            this.name = 'FlightScheduleActivationError';
        }
    }
    return {
        FlightScheduleActivationService: jest.fn().mockImplementation(() => ({ setActive })),
        FlightScheduleActivationError,
    };
});

jest.mock('@/lib/flightScheduleDeletionService', () => {
    const deleteSchedule = jest.fn();
    class FlightScheduleDeletionError extends Error {
        constructor(readonly code: string, message: string) {
            super(message);
            this.name = 'FlightScheduleDeletionError';
        }
    }
    return {
        FlightScheduleDeletionService: jest.fn().mockImplementation(() => ({ delete: deleteSchedule })),
        FlightScheduleDeletionError,
    };
});

jest.mock('@/lib/stripePaymentProvider', () => ({
    createStripePaymentProvider: jest.fn().mockReturnValue({}),
    getStripePublishableKey: jest.fn().mockReturnValue('pk_test_public'),
}));

const mockTx = {
    $queryRaw: jest.fn(),
    // `set_config` for the reason and refund the status-change trigger reads.
    $executeRaw: jest.fn(),
    passenger: {
        findMany: jest.fn(),
        update: jest.fn(),
    },
    booking: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    bookingStatusChange: { findFirstOrThrow: jest.fn() },
    paymentRefund: { create: jest.fn() },
    flight: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
    },
    seatAssignment: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
    }
};

jest.mock('@/lib/prisma', () => ({
    prisma: {
        cityGuide: { create: jest.fn(), delete: jest.fn() },
        flight: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
        flightSchedule: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), findUnique: jest.fn() },
        userFavorite: { findUnique: jest.fn(), delete: jest.fn(), create: jest.fn() },
        review: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
        booking: { findUnique: jest.fn(), delete: jest.fn(), update: jest.fn(), findMany: jest.fn() },
        seatAssignment: { findMany: jest.fn() },
        $executeRaw: jest.fn(),
        $queryRaw: jest.fn().mockResolvedValue([]),
        notification: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), createMany: jest.fn() },
        $transaction: jest.fn((callback) => callback(mockTx)),
    },
}));

const mockedGetServerSession = getServerSession as unknown as jest.Mock;

/**
 * A row as Prisma returns it once the search reads the route from the airports
 * the flight references, and the same row as the action hands it on — the
 * relation is resolved to `from`/`to` at the boundary rather than shipped (#73).
 */
function routed<T extends { from: string; to: string }>(flight: T) {
    return { ...flight, fromAirport: { label: flight.from }, toAirport: { label: flight.to } };
}

const mockSaveCityGuide = new (TravelGuideService as any)().saveCityGuide as jest.Mock;
const mockBookFlight = new (FlightBookingService as any)().bookFlight as jest.Mock;
const mockGenerateFlightsForDate = new (FlightScheduleService as any)().generateFlightsForDate as jest.Mock;
const mockStartPayment = new (CheckoutPaymentService as any)().startPayment as jest.Mock;
const mockCapturePayment = new (CheckoutPaymentService as any)().capturePayment as jest.Mock;
const mockCancelPayment = new (CheckoutPaymentService as any)().cancelPayment as jest.Mock;
const mockSettleRefund = new (PaymentRefundService as any)({}).settleRefund as jest.Mock;
const mockReconcilePaymentAttempt = new (PaymentAttemptReconciliationService as any)({})
    .reconcileAttempt as jest.Mock;
const mockRebookItinerary = new (ItineraryRebookingService as any)().rebook as jest.Mock;
const mockUpdateFlightScheduleTerms = new (FlightScheduleTermsService as any)().update as jest.Mock;
const mockSetFlightScheduleActive = new (FlightScheduleActivationService as any)().setActive as jest.Mock;
const mockDeleteFlightSchedule = new (FlightScheduleDeletionService as any)().delete as jest.Mock;
const mockedCreateStripePaymentProvider = createStripePaymentProvider as jest.Mock;
const mockedRevalidatePath = revalidatePath as jest.Mock;
const mockedRedirect = redirect as unknown as jest.Mock;
const mockedGetStripePublishableKey = getStripePublishableKey as jest.Mock;
const mockedFlightFindMany = (prisma as any).flight.findMany as jest.Mock;
const mockedFlightFindFirst = (prisma as any).flight.findFirst as jest.Mock;
const mockedFlightCreate = (prisma as any).flight.create as jest.Mock;
const mockedFlightUpdate = (prisma as any).flight.update as jest.Mock;
const mockedFlightFindUnique = (prisma as any).flight.findUnique as jest.Mock;
const mockedFlightScheduleFindMany = (prisma as any).flightSchedule.findMany as jest.Mock;
const mockedFlightScheduleCreate = (prisma as any).flightSchedule.create as jest.Mock;
const mockedFlightScheduleUpdate = (prisma as any).flightSchedule.update as jest.Mock;
const mockedFlightScheduleFindUnique = (prisma as any).flightSchedule.findUnique as jest.Mock;
const mockedCityGuideDelete = (prisma as any).cityGuide.delete as jest.Mock;
const mockedUserFavoriteFindUnique = (prisma as any).userFavorite.findUnique as jest.Mock;
const mockedUserFavoriteDelete = (prisma as any).userFavorite.delete as jest.Mock;
const mockedUserFavoriteCreate = (prisma as any).userFavorite.create as jest.Mock;
const mockedReviewCreate = (prisma as any).review.create as jest.Mock;
const mockedReviewFindUnique = (prisma as any).review.findUnique as jest.Mock;
const mockedReviewDelete = (prisma as any).review.delete as jest.Mock;
const mockedBookingFindUnique = (prisma as any).booking.findUnique as jest.Mock;
const mockedBookingUpdate = (prisma as any).booking.update as jest.Mock;
const mockedBookingFindMany = (prisma as any).booking.findMany as jest.Mock;
const mockedNotificationCreate = (prisma as any).notification.create as jest.Mock;
const mockedNotificationFindMany = (prisma as any).notification.findMany as jest.Mock;
const mockedNotificationUpdate = (prisma as any).notification.update as jest.Mock;
const mockedNotificationUpdateMany = (prisma as any).notification.updateMany as jest.Mock;
const mockedNotificationFindUnique = (prisma as any).notification.findUnique as jest.Mock;
const mockedNotificationCreateMany = (prisma as any).notification.createMany as jest.Mock;

const sampleGuide: any = {
    city: 'Paris',
    country: 'France',
    latlong: [48.85, 2.35],
    description: 'City of light',
    highlights: ['Eiffel Tower'],
    coverImage: null,
};

describe('saveCityGuideAction authorization', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rejects an unauthenticated user', async () => {
        mockedGetServerSession.mockResolvedValue(null);
        await expect(saveCityGuideAction(sampleGuide)).rejects.toThrow('Unauthorized');
        expect(mockSaveCityGuide).not.toHaveBeenCalled();
    });

    it('rejects a non-admin user', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { role: 'USER' } });
        await expect(saveCityGuideAction(sampleGuide)).rejects.toThrow('Unauthorized');
        expect(mockSaveCityGuide).not.toHaveBeenCalled();
    });

    it('rejects an admin whose staff factor has not been verified', async () => {
        mockedGetServerSession.mockResolvedValue({
            user: { role: 'ADMIN', staffMfaVerified: false },
        });
        await expect(saveCityGuideAction(sampleGuide)).rejects.toThrow('Unauthorized');
        expect(mockSaveCityGuide).not.toHaveBeenCalled();
    });

    it('allows an admin user and saves the guide', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
        mockSaveCityGuide.mockResolvedValue({ ...sampleGuide, id: 1 });

        const result = await saveCityGuideAction(sampleGuide);

        expect(mockSaveCityGuide).toHaveBeenCalledWith(sampleGuide);
        expect(result).toHaveProperty('id', 1);
    });

    it('normalizes guide text before saving', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
        mockSaveCityGuide.mockResolvedValue({ id: 1 });

        await saveCityGuideAction({
            ...sampleGuide,
            city: '  Paris ',
            highlights: [' Eiffel Tower ']
        });

        expect(mockSaveCityGuide).toHaveBeenCalledWith(expect.objectContaining({
            city: 'Paris',
            highlights: ['Eiffel Tower']
        }));
    });
});

describe('deleteCityGuideAction authorization and execution', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rejects an unauthenticated user', async () => {
        mockedGetServerSession.mockResolvedValue(null);
        await expect(deleteCityGuideAction(1)).rejects.toThrow('Unauthorized');
        expect(mockedCityGuideDelete).not.toHaveBeenCalled();
    });

    it('rejects a non-admin user', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { role: 'USER' } });
        await expect(deleteCityGuideAction(1)).rejects.toThrow('Unauthorized');
        expect(mockedCityGuideDelete).not.toHaveBeenCalled();
    });

    it('allows an admin user and deletes the guide', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
        mockedCityGuideDelete.mockResolvedValue({});

        await deleteCityGuideAction(1);

        expect(mockedCityGuideDelete).toHaveBeenCalledWith({
            where: { id: 1 }
        });
    });
});

describe('searchFlightsAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedFlightScheduleFindMany.mockResolvedValue([]);
    });
    afterEach(() => jest.useRealTimers());

    it('filters flights by the selected origin and destination without date', async () => {
        const flights = [
            { id: 1, flightNumber: 'CA101', from: 'Seattle, USA', to: 'Detroit, USA' },
        ];
        mockedFlightFindMany.mockResolvedValue(flights.map(routed));

        const result = await searchFlightsAction('Seattle, USA', 'Detroit, USA');

        expect(mockedFlightFindMany).toHaveBeenCalledWith(
            // Narrowed by the airports the flight references, not by two
            // flights spelling a place the same way (#73).
            expect.objectContaining({ where: { fromAirportCode: 'SEA', toAirportCode: 'DTW' } })
        );
        expect(result).toEqual({
            flights: flights.map(flight => ({ ...flight, cabinAvailable: true })),
            nearbyDates: [],
            inbound: null,
        });
        expect(mockedFlightScheduleFindMany).not.toHaveBeenCalled();
    });

    it('queries by date without generating inventory', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-24T12:00:00.000Z'));
        const flights = [
            { id: 1, flightNumber: 'CA101', from: 'Seattle, USA', to: 'Detroit, USA', departureDate: new Date('2026-06-25T12:00:00Z') },
        ];
        mockedFlightFindMany.mockResolvedValue(flights.map(routed));

        const result = await searchFlightsAction('Seattle, USA', 'Detroit, USA', '2026-06-25');

        // Searching is read-only. Inventory is produced ahead of demand by the
        // seed and the scheduler, never by a customer request (#71).
        expect(mockGenerateFlightsForDate).not.toHaveBeenCalled();
        expect(mockedFlightFindMany).toHaveBeenCalledWith({
            where: {
                fromAirportCode: 'SEA',
                toAirportCode: 'DTW',
                status: { not: 'CANCELLED' },
                departureDate: {
                    // Seattle's calendar day, not UTC's: a customer searching
                    // the 25th means the 25th where they are standing (#84).
                    gte: new Date('2026-06-25T07:00:00.000Z'),
                    lt: new Date('2026-06-26T07:00:00.000Z')
                }
            },
            orderBy: { departureDate: 'asc' },
            // The route rendered comes from the referenced airports (#73).
            include: {
                fromAirport: { select: { label: true } },
                toAirport: { select: { label: true } },
            },
        });
        expect(result).toEqual({
            flights: flights.map(flight => ({ ...flight, cabinAvailable: true })),
            nearbyDates: [],
            inbound: null,
        });
    });

    it('searches the inbound direction on its own route and date', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-24T12:00:00.000Z'));
        const outbound = [{ id: 1, from: 'Seattle, USA', to: 'Detroit, USA' }];
        const inbound = [{ id: 2, from: 'Detroit, USA', to: 'Seattle, USA' }];
        mockedFlightFindMany
            .mockResolvedValueOnce(outbound.map(routed))
            .mockResolvedValueOnce(inbound.map(routed));

        const result = await searchFlightsAction(
            'Seattle, USA', 'Detroit, USA', '2026-06-25', '2026-07-02',
        );

        // The inbound is a real search of the reversed route on the return
        // date, not a fixed offset from the outbound (#69).
        expect(mockedFlightFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({
                fromAirportCode: 'DTW',
                toAirportCode: 'SEA',
                departureDate: {
                    // Detroit's day for the inbound leg: the bound follows the
                    // origin of the direction being searched.
                    gte: new Date('2026-07-02T04:00:00.000Z'),
                    lt: new Date('2026-07-03T04:00:00.000Z'),
                },
            }),
        }));
        expect(result).toMatchObject({
            flights: outbound,
            inbound: { flights: inbound, nearbyDates: [] },
        });
        jest.useRealTimers();
    });

    it('keeps the outbound results when the return search fails', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-24T12:00:00.000Z'));
        const outbound = [{ id: 1, from: 'Seattle, USA', to: 'Detroit, USA' }];
        mockedFlightFindMany
            .mockResolvedValueOnce(outbound.map(routed))
            .mockRejectedValueOnce(new Error('connection reset'));

        const result = await searchFlightsAction(
            'Seattle, USA', 'Detroit, USA', '2026-06-25', '2026-07-02',
        );

        // Two legs are two dependencies. Losing one is not losing the search:
        // the outbound results still stand, and the return says so (#68).
        expect(result).toMatchObject({
            flights: outbound,
            inbound: { status: 'unavailable' },
        });
        jest.useRealTimers();
    });

    it('fails the whole search when the outbound fails', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-24T12:00:00.000Z'));
        mockedFlightFindMany
            .mockRejectedValueOnce(new Error('connection reset'))
            .mockResolvedValueOnce([{ id: 2 }]);

        // There is nothing to degrade to: a return leg on its own is not a
        // trip anyone can book.
        await expect(searchFlightsAction(
            'Seattle, USA', 'Detroit, USA', '2026-06-25', '2026-07-02',
        )).rejects.toThrow('connection reset');
        jest.useRealTimers();
    });

    it('prices results at the cabin that was searched', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-24T12:00:00.000Z'));
        mockedFlightFindMany.mockResolvedValue([
            routed({ id: 1, priceCents: 35_000, economyRows: 20, businessRows: 3, from: 'Seattle, USA', to: 'Detroit, USA' }),
        ]);

        const result = await searchFlightsAction(
            'Seattle, USA', 'Detroit, USA', '2026-06-25', undefined, 'BUSINESS',
        );

        // Business is 200% of the base fare. Showing the Economy price against
        // a Business search is a different number from the one checkout will
        // charge (#70).
        // The integer moves with the string. Sorting or filtering on a base
        // fare while the screen shows a cabin fare would disagree with itself.
        expect(result).toMatchObject({
            flights: [{ priceCents: 70_000, cabinAvailable: true }],
        });
        jest.useRealTimers();
    });

    it('marks flights the searched cabin does not operate, and keeps them', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-24T12:00:00.000Z'));
        mockedFlightFindMany.mockResolvedValue([
            routed({ id: 1, priceCents: 35_000, economyRows: 20, businessRows: 0, from: 'Seattle, USA', to: 'Detroit, USA' }),
            routed({ id: 2, priceCents: 40_000, economyRows: 20, businessRows: 3, from: 'Seattle, USA', to: 'Detroit, USA' }),
        ]);

        const result = await searchFlightsAction(
            'Seattle, USA', 'Detroit, USA', '2026-06-25', undefined, 'BUSINESS',
        );

        // Hiding the first would report no flights on a route that has plenty
        // of seats, which reads as "we do not fly there".
        expect(result).toMatchObject({
            flights: [
                // Quoted at the fare it can actually be booked at.
                { id: 1, cabinAvailable: false, priceCents: 35_000 },
                { id: 2, cabinAvailable: true, priceCents: 80_000 },
            ],
        });
        jest.useRealTimers();
    });

    it('defaults to economy when no cabin is given', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-24T12:00:00.000Z'));
        mockedFlightFindMany.mockResolvedValue([
            routed({ id: 1, priceCents: 35_000, economyRows: 20, businessRows: 0, from: 'Seattle, USA', to: 'Detroit, USA' }),
        ]);

        const result = await searchFlightsAction('Seattle, USA', 'Detroit, USA', '2026-06-25');

        expect(result).toMatchObject({ flights: [expect.objectContaining({ priceCents: 35000 })] });
        jest.useRealTimers();
    });

    it('rejects a cabin it does not sell', async () => {
        await expect(searchFlightsAction(
            'Seattle, USA', 'Detroit, USA', '2026-06-25', undefined, 'SLEEPER' as never,
        )).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    });

    it('reports no inbound for a one-way search', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-24T12:00:00.000Z'));
        mockedFlightFindMany.mockResolvedValue([routed({ id: 1, from: 'Seattle, USA', to: 'Detroit, USA' })]);

        const result = await searchFlightsAction('Seattle, USA', 'Detroit, USA', '2026-06-25');

        expect(result).toMatchObject({ inbound: null });
        expect(mockedFlightFindMany).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });

    it('suggests the nearest operating dates when the exact date has no flights', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
        mockedFlightFindMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    // As stored: the instant a Seattle 08:00 departure names,
                    // not that wall clock with a Z on it. With the old value
                    // the cancelled-flight key could never match a real row, so
                    // a cancelled date was offered as a suggestion (#84).
                    flightNumber: 'CA101',
                    departureDate: new Date('2026-07-15T15:00:00.000Z'),
                },
            ]);
        mockedFlightScheduleFindMany.mockResolvedValue([
            { flightNumber: 'CA101', departureTime: '08:00', daysOfWeek: [1, 3, 5] },
        ]);
        mockGenerateFlightsForDate.mockResolvedValue([]);

        const result = await searchFlightsAction(
            'Seattle, USA',
            'Detroit, USA',
            '2026-07-16',
        );

        expect(mockedFlightScheduleFindMany).toHaveBeenCalledWith({
            where: {
                isActive: true,
                from: 'Seattle, USA',
                to: 'Detroit, USA',
            },
            select: {
                flightNumber: true,
                departureTime: true,
                daysOfWeek: true,
            },
        });
        expect(mockedFlightFindMany).toHaveBeenNthCalledWith(2, {
            where: {
                fromAirportCode: 'SEA',
                toAirportCode: 'DTW',
                status: 'CANCELLED',
                departureDate: {
                    gte: new Date('2026-07-14T07:00:00.000Z'),
                    lt: new Date('2027-07-15T07:00:00.000Z'),
                },
            },
            select: {
                flightNumber: true,
                departureDate: true,
            },
        });
        expect(result).toEqual({
            flights: [],
            nearbyDates: ['2026-07-17'],
            inbound: null,
        });
    });

    it('excludes already-departed flights when searching today', async () => {
        const now = new Date('2026-07-14T12:00:00.000Z');
        jest.useFakeTimers().setSystemTime(now);
        mockedFlightFindMany.mockResolvedValue([]);
        mockGenerateFlightsForDate.mockResolvedValue([]);

        await searchFlightsAction('Seattle, USA', 'Detroit, USA', '2026-07-14');

        expect(mockedFlightFindMany).toHaveBeenCalledWith({
            where: {
                fromAirportCode: 'SEA',
                toAirportCode: 'DTW',
                status: { not: 'CANCELLED' },
                departureDate: {
                    gt: now,
                    lt: new Date('2026-07-15T07:00:00.000Z'),
                },
            },
            orderBy: { departureDate: 'asc' },
            // The route rendered in the results comes from the airports the
            // flight references, so the search has to ask for them (#73).
            include: {
                fromAirport: { select: { label: true } },
                toAirport: { select: { label: true } },
            },
        });
    });

    it('rejects malformed and oversized searches before generation or database access', async () => {
        await expect(searchFlightsAction('Seattle, USA', 'Detroit, USA', '06/25/2026'))
            .resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
        await expect(searchFlightsAction('x'.repeat(121), 'Detroit, USA', '2026-06-25'))
            .resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
        await expect(searchFlightsAction('Seattle, USA', 'Detroit, USA', false as any))
            .resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

        expect(mockGenerateFlightsForDate).not.toHaveBeenCalled();
        expect(mockedFlightFindMany).not.toHaveBeenCalled();
    });

    it('rejects invalid trip dates before generation or database access', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

        await expect(searchFlightsAction(
            'Seattle, USA',
            'Detroit, USA',
            '2026-07-13',
            '2026-07-20',
        )).resolves.toMatchObject({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                fields: { departureDate: ['Departure date cannot be in the past.'] },
            },
        });
        await expect(searchFlightsAction(
            'Seattle, USA',
            'Detroit, USA',
            '2026-07-15',
            '2026-07-14',
        )).resolves.toMatchObject({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                fields: { returnDate: ['Return date cannot be before departure date.'] },
            },
        });

        expect(mockGenerateFlightsForDate).not.toHaveBeenCalled();
        expect(mockedFlightFindMany).not.toHaveBeenCalled();
    });

    it('rejects travel beyond the booking window before database access', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

        await expect(searchFlightsAction(
            'Seattle, USA',
            'Detroit, USA',
            '2027-07-15',
        )).resolves.toMatchObject({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                fields: {
                    departureDate: ['Departure date cannot be more than 365 days in advance.'],
                },
            },
        });
        await expect(searchFlightsAction(
            'Seattle, USA',
            'Detroit, USA',
            '2027-07-14',
            '2027-07-15',
        )).resolves.toMatchObject({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                fields: {
                    returnDate: ['Return date cannot be more than 365 days in advance.'],
                },
            },
        });

        expect(mockGenerateFlightsForDate).not.toHaveBeenCalled();
        expect(mockedFlightFindMany).not.toHaveBeenCalled();
    });
});

describe('getFlightRoutesAction', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.useRealTimers());

    it('returns active routes with their next operating dates', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
        const schedules = [
            {
                from: 'Chicago, USA',
                to: 'Paris, France',
                departureTime: '17:45',
                durationMinutes: 245,
                daysOfWeek: [2],
            },
            {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '08:00',
                durationMinutes: 245,
                daysOfWeek: [1, 3, 5],
            },
        ];
        mockedFlightScheduleFindMany.mockResolvedValue(schedules);

        const result = await getFlightRoutesAction();

        expect(result).toEqual([
            { from: 'Chicago, USA', to: 'Paris, France', nextOperatingDate: '2026-07-14' },
            { from: 'Seattle, USA', to: 'Detroit, USA', nextOperatingDate: '2026-07-15' },
        ]);
        expect(mockedFlightScheduleFindMany).toHaveBeenCalledWith({
            where: { isActive: true },
            select: {
                from: true,
                to: true,
                departureTime: true,
                daysOfWeek: true,
            },
            orderBy: [{ from: 'asc' }, { to: 'asc' }, { departureTime: 'asc' }],
        });
    });
});

describe('bookFlightAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStartPayment.mockResolvedValue({
            amountCents: 20_000,
            currency: 'USD',
            clientSecret: 'pi_secret_for_elements',
            providerIntentId: 'pi_authorized',
            status: 'AUTHORIZED',
        });
        mockCapturePayment.mockResolvedValue({ status: 'CAPTURED', wasCaptured: true });
        mockCancelPayment.mockResolvedValue({ status: 'CANCELLED', wasCancelled: true });
    });

    it('refuses to create a booking until Stripe reports an authorized payment', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockStartPayment.mockResolvedValue({
            amountCents: 20_000,
            currency: 'USD',
            clientSecret: 'pi_secret_for_elements',
            status: 'PROCESSING',
        });

        const outcome = await bookFlightAction({
            flightIds: [42],
            passengers: [{
                firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01',
                passportNumber: 'AB123456', gender: 'Female', seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
        });
        expect(outcome).toEqual({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Payment authorization is required before booking.',
                fields: { _root: ['Payment authorization is required before booking.'] },
            },
        });
        expect(mockBookFlight).not.toHaveBeenCalled();
    });

    it('calls FlightBookingService with flightId and userId from session and creates a notification', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockStartPayment.mockResolvedValue({
            amountCents: 20_000,
            currency: 'USD',
            clientSecret: 'pi_secret_for_elements',
            providerIntentId: 'pi_authorized',
            status: 'CAPTURED',
        });
        mockBookFlight.mockResolvedValue({
            id: 1,
            flightIds: [42],
            userId: 'user-123',
            totalPriceCents: 20000,
            wasCreated: true
        });
        mockedFlightFindUnique.mockResolvedValue({
            id: 42,
            airline: 'Gemini Airways',
            flightNumber: 'GA101',
            priceCents: 20000,
            // Deliberately not what the airports say, so the message asserted
            // below can only be right if it reads the references (#73). With
            // both saying 'A' the assertion passed either way.
            from: 'somewhere',
            to: 'somewhere else',
            fromAirport: { label: 'A' },
            toAirport: { label: 'B' },
        });

        const passengers = [{
            firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01',
            passportNumber: 'AB123456', gender: 'Female', seatNumbers: ['11A'],
            cabinClass: 'ECONOMY'
        }];
        const result = await bookFlightAction({
            flightIds: [42],
            passengers,
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        });

        expect(mockBookFlight).toHaveBeenCalledWith(expect.objectContaining({
            flightIds: [42],
            userId: 'user-123',
            passengers,
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            paymentIntentId: 'pi_authorized',
        }));
        expect(mockCapturePayment).toHaveBeenCalledWith({
            userId: 'user-123',
            checkoutId: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            bookingId: 1,
        });
        expect(result).toEqual({
            id: 1,
            flightIds: [42],
            userId: 'user-123',
            totalPriceCents: 20000,
            wasCreated: true
        });

        expect(mockedNotificationCreate).toHaveBeenCalledWith({
            data: {
                userId: 'user-123',
                title: 'Booking Confirmed: Gemini Airways GA101',
                message: 'Successfully booked flight GA101 from A to B. Earned +200 status points.',
                type: 'POINTS'
            }
        });
    });

    it('rejects oversized passenger arrays before calling the booking service', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        const passenger = {
            firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01',
            passportNumber: 'AB123456', gender: 'Female', seatNumbers: ['11A'],
            cabinClass: 'ECONOMY'
        };

        await expect(bookFlightAction({
            flightIds: [42],
            passengers: Array.from({ length: 10 }, () => passenger),
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
        expect(mockBookFlight).not.toHaveBeenCalled();
    });

    it('returns a recoverable seat error when checkout no longer owns its hold', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        const idempotencyKey = '8ea59a65-9251-45b3-95d0-3920c49f5735';
        mockCancelPayment.mockRejectedValueOnce(new Error('provider response included sensitive data'));
        mockBookFlight.mockRejectedValue(new SeatHoldUnavailableError({
            flightId: 42,
            seatNumber: '11A',
            holderKey: checkoutHolderKey('user-123', idempotencyKey),
        }));

        const outcome = await bookFlightAction({
            flightIds: [42],
            passengers: [{
                firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01',
                passportNumber: 'AB123456', gender: 'Female', seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey,
        });
        expect(outcome).toEqual({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Seat 11A is no longer held for this checkout. Please choose a seat again.',
                fields: {
                    'passengers.0.seatNumbers.0': [
                        'Seat 11A is no longer held for this checkout. Please choose a seat again.',
                    ],
                },
            },
        });
        expect(mockedNotificationCreate).not.toHaveBeenCalled();
        expect(JSON.stringify(outcome)).not.toContain('sensitive data');
        expect(mockCancelPayment).toHaveBeenCalledWith({
            userId: 'user-123',
            checkoutId: idempotencyKey,
        });
    });

    it('maps a lost hold to the passenger and leg named by the claim', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        const idempotencyKey = '8ea59a65-9251-45b3-95d0-3920c49f5735';
        mockBookFlight.mockRejectedValue(new SeatHoldUnavailableError({
            flightId: 43,
            seatNumber: '22B',
            holderKey: checkoutHolderKey('user-123', idempotencyKey),
        }));

        await expect(bookFlightAction({
            flightIds: [42, 43],
            passengers: [{
                firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01',
                passportNumber: 'AB123456', gender: 'Female', seatNumbers: ['11A', '11B'],
                cabinClass: 'ECONOMY',
            }, {
                firstName: 'Grace', lastName: 'Hopper', dateOfBirth: '1990-01-01',
                passportNumber: 'CD123456', gender: 'Female', seatNumbers: ['22A', '22B'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey,
        })).resolves.toMatchObject({
            ok: false,
            error: { fields: { 'passengers.1.seatNumbers.1': expect.any(Array) } },
        });
    });

    it('does not turn an unexpected booking failure into validation feedback', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockBookFlight.mockRejectedValue(new Error('database unavailable'));

        await expect(bookFlightAction({
            flightIds: [42],
            passengers: [{
                firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01',
                passportNumber: 'AB123456', gender: 'Female', seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
        })).rejects.toThrow('database unavailable');
    });

    it('returns truthful retry feedback when booking succeeds before capture is confirmed', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockBookFlight.mockResolvedValue({ id: 9, wasCreated: true });
        mockCapturePayment.mockRejectedValue(
            new Error('provider response included a sensitive capture value'),
        );

        const outcome = await bookFlightAction({
            flightIds: [42],
            passengers: [{
                firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01',
                passportNumber: 'AB123456', gender: 'Female', seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
        });
        expect(outcome).toEqual({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Your booking and seats are secured, but payment capture is still being confirmed. Try again to finish payment.',
                fields: {
                    'payment.capture': [
                        'Your booking and seats are secured, but payment capture is still being confirmed. Try again to finish payment.',
                    ],
                },
            },
        });
        expect(JSON.stringify(outcome)).not.toContain('sensitive capture value');
    });

    it('rejects bookings without passengers before calling the booking service', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });

        await expect(bookFlightAction({ flightId: 42 } as any)).resolves.toMatchObject({
            ok: false,
            error: { code: 'VALIDATION_ERROR', fields: { passengers: expect.any(Array) } }
        });
        expect(mockBookFlight).not.toHaveBeenCalled();
    });

    it('rejects client prices and payment identifiers before calling the booking service', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        const passenger = {
            firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01',
            passportNumber: 'AB123456', gender: 'Female', seatNumbers: ['11A'],
            cabinClass: 'ECONOMY'
        };

        await expect(bookFlightAction({
            flightIds: [42],
            passengers: [passenger],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            totalPriceCents: 1,
            paymentIntentId: 'forged-payment'
        } as any)).resolves.toMatchObject({
            ok: false,
            error: { code: 'VALIDATION_ERROR' }
        });
        expect(mockBookFlight).not.toHaveBeenCalled();
    });

    it('does not duplicate booking notifications for an idempotent retry', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockCapturePayment.mockResolvedValue({ status: 'CAPTURED', wasCaptured: false });
        mockBookFlight.mockResolvedValue({
            id: 1,
            flightIds: [42],
            userId: 'user-123',
            totalPriceCents: 20000,
            wasCreated: false
        });
        mockedFlightFindUnique.mockResolvedValue({
            id: 42,
            airline: 'Gemini Airways',
            flightNumber: 'GA101',
            priceCents: 20_000,
            fromAirport: { label: 'A' },
            toAirport: { label: 'B' },
        });

        await bookFlightAction({
            flightIds: [42],
            passengers: [{
                firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01',
                passportNumber: 'AB123456', gender: 'Female', seatNumbers: ['11A'],
                cabinClass: 'ECONOMY'
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        });

        expect(mockedNotificationCreate).not.toHaveBeenCalled();
    });

    it('creates the confirmation notification when a retry recovers payment capture', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockBookFlight.mockResolvedValue({
            id: 1,
            totalPriceCents: 20_000,
            wasCreated: false,
        });
        mockCapturePayment.mockResolvedValue({ status: 'CAPTURED', wasCaptured: true });
        mockedFlightFindUnique.mockResolvedValue({
            id: 42,
            airline: 'Gemini Airways',
            flightNumber: 'GA101',
            priceCents: 20_000,
            fromAirport: { label: 'A' },
            toAirport: { label: 'B' },
        });

        await bookFlightAction({
            flightIds: [42],
            passengers: [{
                firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01',
                passportNumber: 'AB123456', gender: 'Female', seatNumbers: ['11A'],
                cabinClass: 'ECONOMY',
            }],
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735',
        });

        expect(mockedNotificationCreate).toHaveBeenCalledTimes(1);
    });
});

describe('startCheckoutPaymentAction', () => {
    beforeEach(() => jest.clearAllMocks());

    const input = {
        checkoutId: '8ea59a65-9251-45b3-95d0-3920c49f5735',
        flightIds: [42],
        passengers: [{ seatNumbers: ['2a'], cabinClass: 'BUSINESS' as const }],
    };

    it('starts a server-owned payment for the authenticated checkout', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockStartPayment.mockResolvedValue({
            amountCents: 60_000,
            currency: 'USD',
            clientSecret: 'pi_secret_for_elements',
            providerIntentId: 'pi_server_only',
            status: 'REQUIRES_PAYMENT_METHOD',
        });

        await expect(startCheckoutPaymentAction(input)).resolves.toEqual({
            amountCents: 60_000,
            currency: 'USD',
            clientSecret: 'pi_secret_for_elements',
            publishableKey: 'pk_test_public',
            status: 'REQUIRES_PAYMENT_METHOD',
        });
        expect(mockedCreateStripePaymentProvider).toHaveBeenCalledTimes(1);
        expect(mockedGetStripePublishableKey).toHaveBeenCalledTimes(1);
        expect(mockStartPayment).toHaveBeenCalledWith({
            ...input,
            userId: 'user-123',
            passengers: [{ seatNumbers: ['2A'], cabinClass: 'BUSINESS' }],
        });
    });

    it('rejects card data and client prices before constructing a provider', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });

        await expect(startCheckoutPaymentAction({
            ...input,
            cardNumber: '4242424242424242',
            cvc: '123',
            totalPriceCents: 1,
            paymentIntentId: 'pi_forged',
        } as never)).resolves.toMatchObject({
            ok: false,
            error: { code: 'VALIDATION_ERROR' },
        });
        expect(mockedCreateStripePaymentProvider).not.toHaveBeenCalled();
        expect(mockStartPayment).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated caller before constructing a provider', async () => {
        mockedGetServerSession.mockResolvedValue(null);

        await expect(startCheckoutPaymentAction(input)).rejects.toThrow('Unauthorized');
        expect(mockedCreateStripePaymentProvider).not.toHaveBeenCalled();
        expect(mockStartPayment).not.toHaveBeenCalled();
    });

    it('returns recoverable field feedback when a payment checkout loses its hold', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        const paymentInput = {
            checkoutId: input.checkoutId,
            flightIds: [42, 43],
            passengers: [
                { seatNumbers: ['2A', '2A'], cabinClass: 'BUSINESS' as const },
                { seatNumbers: ['2B', '2B'], cabinClass: 'BUSINESS' as const },
            ],
        };
        mockStartPayment.mockRejectedValue(new SeatHoldUnavailableError({
            flightId: 43,
            seatNumber: '2B',
            holderKey: checkoutHolderKey('user-123', input.checkoutId),
        }));

        await expect(startCheckoutPaymentAction(paymentInput)).resolves.toEqual({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Seat 2B is no longer held for this checkout. Please choose a seat again.',
                fields: {
                    'passengers.1.seatNumbers.1': [
                        'Seat 2B is no longer held for this checkout. Please choose a seat again.',
                    ],
                },
            },
        });
    });
});

describe('rebookItineraryAction', () => {
    beforeEach(() => jest.clearAllMocks());

    const input = {
        bookingId: 42,
        replacements: [{
            fromLegId: 501,
            replacementFlightId: 901,
            seats: [{ passengerId: 'passenger-a', seatNumber: ' 14a ' }],
        }],
    };

    it('rebooks only as the authenticated owner and refreshes both booking views', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockRebookItinerary.mockResolvedValue({
            bookingId: 42,
            rebookingId: 'rebooking-1',
            status: 'CONFIRMED',
            replacements: [{
                fromLegId: 501,
                toLegId: 601,
                replacementFlightId: 901,
            }],
        });

        await expect(rebookItineraryAction(input)).resolves.toMatchObject({
            bookingId: 42,
            status: 'CONFIRMED',
        });
        expect(mockRebookItinerary).toHaveBeenCalledWith({
            bookingId: 42,
            replacements: [{
                fromLegId: 501,
                replacementFlightId: 901,
                seats: [{ passengerId: 'passenger-a', seatNumber: '14A' }],
            }],
            actorUserId: 'user-123',
            ownerUserId: 'user-123',
        });
        expect(mockedRevalidatePath.mock.calls).toEqual([
            ['/profile'],
            ['/admin'],
        ]);
    });

    it('rejects unauthenticated and malformed calls before invoking the service', async () => {
        mockedGetServerSession.mockResolvedValue(null);
        await expect(rebookItineraryAction(input)).rejects.toThrow('Unauthorized');

        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        await expect(rebookItineraryAction({ ...input, actorUserId: 'forged' } as never))
            .resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
        expect(mockRebookItinerary).not.toHaveBeenCalled();
    });

    it.each([
        ['BOOKING_NOT_FOUND', 'Booking not found.'],
        ['BOOKING_NOT_DISRUPTED', 'Only a disrupted booking can be rebooked.'],
        ['REPLACEMENT_SET_INVALID', 'Every cancelled active leg must be replaced exactly once.'],
        ['REPLACEMENT_FLIGHT_INVALID', 'The replacement flight must be a future operating flight on the same route.'],
        ['SEAT_SELECTION_INVALID', 'Select one replacement seat for every passenger.'],
        ['SEAT_UNAVAILABLE', 'A selected replacement seat is no longer available.'],
    ])('returns safe recoverable feedback for %s', async (code, message) => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockRebookItinerary.mockRejectedValue(new ItineraryRebookingError(code as never, message));

        await expect(rebookItineraryAction(input)).resolves.toEqual({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message,
                fields: { _root: [message] },
            },
        });
        expect(mockedRevalidatePath).not.toHaveBeenCalled();
    });

    it('rethrows unexpected service failures unchanged', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        const unexpected = new Error('private database failure');
        mockRebookItinerary.mockRejectedValue(unexpected);

        await expect(rebookItineraryAction(input)).rejects.toBe(unexpected);
        expect(mockedRevalidatePath).not.toHaveBeenCalled();
    });
});

describe('reconcilePaymentAttemptAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('lets verified staff refresh one payment attempt and revalidates the queue', async () => {
        mockedGetServerSession.mockResolvedValue({
            user: { id: 'admin-123', role: 'ADMIN', staffMfaVerified: true },
        });
        mockReconcilePaymentAttempt.mockResolvedValue({
            attemptId: 'attempt-123',
            previousStatus: 'PROCESSING',
            status: 'CAPTURED',
            changed: true,
            updatedAt: new Date('2026-08-15T10:15:00.000Z'),
        });

        await expect(reconcilePaymentAttemptAction(' attempt-123 ')).resolves.toEqual({
            ok: true,
            attemptId: 'attempt-123',
            previousStatus: 'PROCESSING',
            status: 'CAPTURED',
            changed: true,
            updatedAt: '2026-08-15T10:15:00.000Z',
        });
        expect(mockedCreateStripePaymentProvider).toHaveBeenCalledTimes(1);
        expect(mockReconcilePaymentAttempt).toHaveBeenCalledWith('attempt-123');
        expect(mockedRevalidatePath).toHaveBeenCalledWith('/admin/payments');
    });

    it('rejects callers without verified staff access before constructing Stripe', async () => {
        mockedGetServerSession.mockResolvedValue({
            user: { id: 'admin-123', role: 'ADMIN', staffMfaVerified: false },
        });

        await expect(reconcilePaymentAttemptAction('attempt-123')).rejects.toThrow('Unauthorized');
        expect(mockedCreateStripePaymentProvider).not.toHaveBeenCalled();
        expect(mockReconcilePaymentAttempt).not.toHaveBeenCalled();
    });

    it('rejects an invalid attempt ID before constructing Stripe', async () => {
        mockedGetServerSession.mockResolvedValue({
            user: { id: 'admin-123', role: 'ADMIN', staffMfaVerified: true },
        });

        await expect(reconcilePaymentAttemptAction('   ')).resolves.toMatchObject({
            ok: false,
            error: { code: 'VALIDATION_ERROR' },
        });
        expect(mockedCreateStripePaymentProvider).not.toHaveBeenCalled();
        expect(mockReconcilePaymentAttempt).not.toHaveBeenCalled();
    });

    it('returns safe recoverable feedback when Stripe reconciliation fails', async () => {
        mockedGetServerSession.mockResolvedValue({
            user: { id: 'admin-123', role: 'ADMIN', staffMfaVerified: true },
        });
        mockReconcilePaymentAttempt.mockRejectedValue(
            new Error('provider response included client_secret_sensitive'),
        );
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(reconcilePaymentAttemptAction('attempt-123')).resolves.toEqual({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Payment status could not be refreshed. Try again later.',
                fields: {
                    paymentAttemptId: ['Payment status could not be refreshed. Try again later.'],
                },
            },
        });
        expect(consoleError).toHaveBeenCalledWith({
            message: 'Staff payment reconciliation failed.',
            paymentAttemptId: 'attempt-123',
        });
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain('client_secret_sensitive');
        consoleError.mockRestore();
    });
});

describe('toggleFavoriteCityGuideAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('throws unauthorized if not logged in', async () => {
        mockedGetServerSession.mockResolvedValue(null);
        await expect(toggleFavoriteCityGuideAction(5)).rejects.toThrow('Unauthorized');
    });

    it('removes favorite if it already exists', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockedUserFavoriteFindUnique.mockResolvedValue({ id: 10, userId: 'user-123', cityGuideId: 5 });

        const result = await toggleFavoriteCityGuideAction(5);

        expect(mockedUserFavoriteFindUnique).toHaveBeenCalledWith({
            where: { userId_cityGuideId: { userId: 'user-123', cityGuideId: 5 } }
        });
        expect(mockedUserFavoriteDelete).toHaveBeenCalledWith({
            where: { id: 10 }
        });
        expect(result).toEqual({ isFavorite: false });
    });

    it('creates favorite if it does not exist', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockedUserFavoriteFindUnique.mockResolvedValue(null);

        const result = await toggleFavoriteCityGuideAction(5);

        expect(mockedUserFavoriteFindUnique).toHaveBeenCalledWith({
            where: { userId_cityGuideId: { userId: 'user-123', cityGuideId: 5 } }
        });
        expect(mockedUserFavoriteCreate).toHaveBeenCalledWith({
            data: { userId: 'user-123', cityGuideId: 5 }
        });
        expect(result).toEqual({ isFavorite: true });
    });

    it('rejects malformed favorite identifiers before database access', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });

        await expect(toggleFavoriteCityGuideAction(-1)).resolves.toMatchObject({
            ok: false, error: { code: 'VALIDATION_ERROR' }
        });
        expect(mockedUserFavoriteFindUnique).not.toHaveBeenCalled();
    });
});

describe('submitCityGuideReviewAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('throws unauthorized if not logged in', async () => {
        mockedGetServerSession.mockResolvedValue(null);
        await expect(submitCityGuideReviewAction(5, 5, 'Great!')).rejects.toThrow('Unauthorized');
    });

    it('creates a new review if logged in', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockedReviewCreate.mockResolvedValue({ id: 99, userId: 'user-123', cityGuideId: 5, rating: 5, content: 'Great!' });

        const result = await submitCityGuideReviewAction(5, 5, 'Great!');

        expect(mockedReviewCreate).toHaveBeenCalledWith({
            data: {
                userId: 'user-123',
                cityGuideId: 5,
                rating: 5,
                content: 'Great!'
            }
        });
        expect(result).toEqual({ id: 99, userId: 'user-123', cityGuideId: 5, rating: 5, content: 'Great!' });
    });

    it('rejects oversized review content before database access', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });

        await expect(submitCityGuideReviewAction(5, 5, 'x'.repeat(2_001)))
            .resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
        expect(mockedReviewCreate).not.toHaveBeenCalled();
    });
});

describe('cancelBookingAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTx.passenger.findMany.mockResolvedValue([]);
        // The action re-reads and re-decides under the flight locks, so the
        // locked row needs the same shape the policy reads (#76).
        mockTx.booking.findUnique.mockResolvedValue({
            status: 'CONFIRMED', totalPriceCents: 20000, legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101',
                    airline: 'Gemini Airways',
                    priceCents: 20000,
                    departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }],
        });
        mockTx.booking.update.mockReset();
        mockTx.bookingStatusChange.findFirstOrThrow.mockResolvedValue({ id: 'change-1' });
        mockTx.paymentRefund.create.mockResolvedValue({ id: 'refund-1' });
        mockSettleRefund.mockResolvedValue({ status: 'SUCCEEDED', wasSubmitted: true });
    });

    it('rejects an unauthenticated user', async () => {
        mockedGetServerSession.mockResolvedValue(null);
        await expect(cancelBookingAction(1)).rejects.toThrow('Unauthorized');
    });

    it('rejects a user trying to cancel another user\'s booking', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({ id: 1, userId: 'other-user' });

        await expect(cancelBookingAction(1)).rejects.toThrow('Unauthorized');
        expect(mockTx.booking.update).not.toHaveBeenCalled();
    });

    it('allows a user to cancel their own booking', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            id: 1,
            userId: 'user-123',
            totalPriceCents: 6997,
            status: 'CONFIRMED',
            flightId: 10,
            legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101',
                    airline: 'Gemini Airways',
                    priceCents: 20000,
                    // Comfortably past the refund cut-off, so this exercises
                    // the ordinary path rather than an edge of the policy.
                    departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }]
        });
        mockTx.booking.update.mockResolvedValue({ id: 1 });

        const result = await cancelBookingAction(1);

        expect(mockedBookingFindUnique).toHaveBeenCalledWith({
            where: { id: 1 },
            include: {
                legs: {
                    where: { supersededAt: null },
                    include: {
                        flight: true,
                        seatAssignments: { select: { cabinClass: true } },
                    },
                    orderBy: { sequence: 'asc' },
                },
            }
        });
        expect(mockTx.booking.findUnique).toHaveBeenCalledWith({
            where: { id: 1 },
            include: {
                legs: {
                    where: { supersededAt: null },
                    include: {
                        flight: true,
                        seatAssignments: { select: { cabinClass: true } },
                    },
                    orderBy: { sequence: 'asc' },
                },
            },
        });
        expect(mockTx.booking.update).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { status: 'CANCELLED' }
        });
        expect(result).toEqual({ id: 1 });
        expect(mockTx.$queryRaw).toHaveBeenCalled();
        expect(mockedNotificationCreate).toHaveBeenCalledWith({
            data: {
                userId: 'user-123',
                title: 'Booking Cancelled: Gemini Airways GA101',
                message: 'Booking for flight GA101 has been cancelled. Deducted -69 status points.',
                type: 'POINTS'
            }
        });
    });

    it('leaves the seat assignment alone, because the database releases it', async () => {
        // The assignment's unique index is the only thing holding the seat now
        // that the traveller row no longer carries one (#137), so releasing it
        // there releases it outright.
        mockedGetServerSession.mockResolvedValue({ user: { id: 'u1', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            id: 1,
            userId: 'u1',
            status: 'CONFIRMED',
            totalPriceCents: 20000,
            flightId: 7,
            // A real future leg: with none, the policy reads the booking as
            // already departed and refuses before the transaction opens, and
            // every assertion below about what the transaction did holds
            // trivially (#76).
            legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101',
                    airline: 'Gemini Airways',
                    priceCents: 20000,
                    departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }],
        });
        mockTx.booking.findUnique.mockResolvedValue({
            id: 1, status: 'CONFIRMED', flightId: 7, totalPriceCents: 20000,
            legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101',
                    airline: 'Gemini Airways',
                    priceCents: 20000,
                    departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }],
        });
        mockTx.passenger.findMany.mockResolvedValue([{ id: 'p-9' }]);
        mockTx.booking.update.mockResolvedValue({ id: 1 });

        await cancelBookingAction(1);

        // The transaction really ran, so what follows is not vacuous.
        expect(mockTx.booking.update).toHaveBeenCalled();
        // The seat is released by the status change, in the database, so this
        // action does not touch the assignment at all -- and in particular does
        // not overwrite the seat number, which is now kept. That the release
        // actually happens is asserted against Postgres in
        // `__tests__/lib/seatRelease.database.test.ts`; a mock cannot fire a
        // trigger.
        expect(mockTx.seatAssignment.updateMany).not.toHaveBeenCalled();
        // The traveller row holds no seat to release.
        expect(mockTx.passenger.update).not.toHaveBeenCalled();
    });

    it('records the refund the policy decided, on the transaction that cancels', async () => {
        // The seam between the rules and the database. Both halves were tested
        // and the join between them was not: dropping the `set_config` calls,
        // or recording a flat zero, passed the whole suite while every
        // cancellation was written down as refunding nothing (#76).
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            id: 1,
            userId: 'user-123',
            // One Economy traveller on a 10,000 fare: 20% is kept.
            totalPriceCents: 10000,
            status: 'CONFIRMED',
            legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101',
                    airline: 'Gemini Airways',
                    priceCents: 10000,
                    departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }],
        });
        mockTx.booking.update.mockResolvedValue({ id: 1 });
        // The amount comes from the read taken under the lock, not the one
        // above it, so this is the row that decides.
        mockTx.booking.findUnique.mockResolvedValue({
            id: 1,
            status: 'CONFIRMED',
            totalPriceCents: 10000,
            legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101',
                    airline: 'Gemini Airways',
                    priceCents: 10000,
                    departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }],
        });

        await cancelBookingAction(1);

        // Tagged-template calls arrive as (strings, ...values), so the amount
        // is a bound parameter rather than text in the statement.
        const settings = mockTx.$executeRaw.mock.calls.map(call => ({
            sql: (call[0] as unknown as string[]).join('?'),
            values: call.slice(1),
        }));
        const refund = settings.find(setting => setting.sql.includes('app.booking_refund_cents'));
        expect(refund).toBeDefined();
        expect(refund!.values).toContain('8000');

        const reason = settings.find(setting => setting.sql.includes('app.booking_status_reason'));
        expect(String(reason!.values[0])).toMatch(/2000 minor units of the booking currency retained/);

        // Transaction-local, or it would attach to whatever the next booking on
        // this connection does.
        for (const setting of settings) expect(setting.sql).toContain('true');
    });

    it('durably submits the recorded refund for a captured booking', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        const paidBooking = {
            id: 1,
            userId: 'user-123',
            paymentIntentId: 'pi_captured',
            currency: 'USD',
            totalPriceCents: 10_000,
            status: 'CONFIRMED',
            legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101', airline: 'Gemini Airways', priceCents: 10_000,
                    departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }],
        };
        mockedBookingFindUnique.mockResolvedValue(paidBooking);
        mockTx.booking.findUnique.mockResolvedValue(paidBooking);
        mockTx.booking.update.mockResolvedValue({ id: 1, status: 'CANCELLED' });

        await expect(cancelBookingAction(1)).resolves.toEqual({ id: 1, status: 'CANCELLED' });

        expect(mockTx.bookingStatusChange.findFirstOrThrow).toHaveBeenCalledWith({
            where: { bookingId: 1, from: 'CONFIRMED', to: 'CANCELLED' },
            orderBy: { sequence: 'desc' },
        });
        expect(mockTx.paymentRefund.create).toHaveBeenCalledWith({
            data: {
                bookingStatusChangeId: 'change-1',
                providerIntentId: 'pi_captured',
                amountCents: 8_000,
                currency: 'USD',
            },
        });
        expect(mockSettleRefund).toHaveBeenCalledWith('refund-1');
    });

    it('keeps a committed cancellation truthful when refund submission is unavailable', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        const paidBooking = {
            id: 1, userId: 'user-123', paymentIntentId: 'pi_captured', currency: 'USD',
            totalPriceCents: 10_000, status: 'CONFIRMED',
            legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101', airline: 'Gemini Airways', priceCents: 10_000,
                    departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }],
        };
        mockedBookingFindUnique.mockResolvedValue(paidBooking);
        mockTx.booking.findUnique.mockResolvedValue(paidBooking);
        mockTx.booking.update.mockResolvedValue({ id: 1, status: 'CANCELLED' });
        mockSettleRefund.mockRejectedValueOnce(new Error('secret provider payload'));
        const error = jest.spyOn(console, 'error').mockImplementation();

        await expect(cancelBookingAction(1)).resolves.toEqual({ id: 1, status: 'CANCELLED' });

        expect(JSON.stringify(error.mock.calls)).not.toContain('secret provider payload');
        expect(error).toHaveBeenCalledWith({
            message: 'Booking refund submission is still pending.',
            refundId: 'refund-1',
        });
        error.mockRestore();
    });

    it('does not create a provider refund when the cancellation refunds zero', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        const paidBooking = {
            id: 1, userId: 'user-123', paymentIntentId: 'pi_captured', currency: 'USD',
            totalPriceCents: 10_000, status: 'CONFIRMED',
            legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101', airline: 'Gemini Airways', priceCents: 10_000,
                    departureDate: new Date(Date.now() + 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }],
        };
        mockedBookingFindUnique.mockResolvedValue(paidBooking);
        mockTx.booking.findUnique.mockResolvedValue(paidBooking);
        mockTx.booking.update.mockResolvedValue({ id: 1, status: 'CANCELLED' });

        await cancelBookingAction(1);

        expect(mockTx.paymentRefund.create).not.toHaveBeenCalled();
        expect(mockSettleRefund).not.toHaveBeenCalled();
    });

    it('prices the cancellation from the read taken under the lock', async () => {
        // Staff can cancel the flight between the first read and the lock,
        // which moves the booking to DISRUPTED and makes it fully refundable.
        // Deciding once, before the lock, would charge the customer the fee for
        // the airline's own cancellation (#76).
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        const leg = (status: string) => ({
            id: 1,
            userId: 'user-123',
            status,
            totalPriceCents: 10000,
            legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101',
                    airline: 'Gemini Airways',
                    priceCents: 10000,
                    departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }],
        });
        // Read before the lock: an ordinary booking, so a fifth would be kept.
        mockedBookingFindUnique.mockResolvedValue(leg('CONFIRMED'));
        // Read under it: the airline got there first.
        mockTx.booking.findUnique.mockResolvedValue(leg('DISRUPTED'));
        mockTx.booking.update.mockResolvedValue({ id: 1 });

        await cancelBookingAction(1);

        const refund = mockTx.$executeRaw.mock.calls
            .map(call => ({ sql: (call[0] as unknown as string[]).join('?'), values: call.slice(1) }))
            .find(setting => setting.sql.includes('app.booking_refund_cents'));
        expect(refund!.values).toContain('10000');
    });

    it('refuses to cancel a booking whose flight has departed', async () => {
        // One of the two defects #76 names. Cancelling a flown flight released
        // a seat that was used and deducted the status points for a trip the
        // customer actually took, and nothing stopped it.
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            id: 1,
            userId: 'user-123',
            totalPriceCents: 20000,
            status: 'CONFIRMED',
            legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101',
                    airline: 'Gemini Airways',
                    priceCents: 20000,
                    departureDate: new Date(Date.now() - 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }],
        });

        const result = await cancelBookingAction(1);

        // A refusal the customer can act on, not a thrown fault.
        expect(result).toMatchObject({
            ok: false,
            error: { code: 'VALIDATION_ERROR', message: expect.stringMatching(/already departed/i) },
        });
        expect(mockTx.booking.update).not.toHaveBeenCalled();
        expect(mockedNotificationCreate).not.toHaveBeenCalled();
    });

    it('allows an admin to cancel any booking', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'admin-123', role: 'ADMIN', staffMfaVerified: true } });
        mockedBookingFindUnique.mockResolvedValue({
            id: 1,
            userId: 'some-user',
            totalPriceCents: 20000,
            status: 'CONFIRMED',
            flightId: 10,
            legs: [{
                sequence: 1,
                flight: {
                    flightNumber: 'GA101',
                    airline: 'Gemini Airways',
                    priceCents: 20000,
                    departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
                seatAssignments: [{ cabinClass: 'ECONOMY' }],
            }]
        });
        mockTx.booking.update.mockResolvedValue({ id: 1 });

        const result = await cancelBookingAction(1);

        expect(mockTx.booking.update).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { status: 'CANCELLED' }
        });
        expect(result).toEqual({ id: 1 });

        expect(mockedNotificationCreate).toHaveBeenCalledWith({
            data: {
                userId: 'some-user',
                title: 'Booking Cancelled: Gemini Airways GA101',
                message: 'Booking for flight GA101 has been cancelled. Deducted -200 status points.',
                type: 'POINTS'
            }
        });
    });
});

describe('retryBookingRefundAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSettleRefund.mockResolvedValue({ status: 'SUCCEEDED', wasSubmitted: true });
    });

    it('lets the booking owner retry its durable refund', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            userId: 'user-123',
            statusChanges: [{ paymentRefund: { id: 'refund-1' } }],
        });

        await expect(retryBookingRefundAction(1)).resolves.toEqual({
            status: 'SUCCEEDED',
            wasSubmitted: true,
        });
        expect(mockSettleRefund).toHaveBeenCalledWith('refund-1');
    });

    it('does not reveal another customer\'s refund', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            userId: 'other-user',
            statusChanges: [{ paymentRefund: { id: 'refund-1' } }],
        });

        await expect(retryBookingRefundAction(1)).rejects.toThrow('Unauthorized');
        expect(mockSettleRefund).not.toHaveBeenCalled();
    });

    it('returns a stable validation result when the booking has no refund', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            userId: 'user-123',
            statusChanges: [],
        });

        await expect(retryBookingRefundAction(1)).resolves.toEqual({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'This booking has no refund to retry.',
                fields: { _root: ['This booking has no refund to retry.'] },
            },
        });
        expect(mockSettleRefund).not.toHaveBeenCalled();
    });

    it('maps provider failures to stable refund-safe copy', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            userId: 'user-123',
            statusChanges: [{ paymentRefund: { id: 'refund-1' } }],
        });
        mockSettleRefund.mockRejectedValue(new Error('forbidden provider detail sentinel'));

        const result = await retryBookingRefundAction(1);

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Your refund is still pending. Please try again later.',
                fields: {
                    'payment.refund': ['Your refund is still pending. Please try again later.'],
                },
            },
        });
        expect(JSON.stringify(result)).not.toContain('forbidden provider detail sentinel');
    });
});

describe('changeBookingSeatsAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTx.passenger.findMany.mockReset();
        mockTx.passenger.update.mockReset();
        mockTx.flight.findUnique.mockResolvedValue({ id: 10 });
        // The action loads every leg's flight at once now.
        mockTx.flight.findMany.mockResolvedValue([{ id: 10 }]);
        // seatAssignment.findMany serves two queries: the cabin held on each
        // leg, then the seats occupied on each flight.
        mockTx.seatAssignment.findMany.mockImplementation(({ where }: any) =>
            Promise.resolve(
                where?.legId
                    ? [{ passengerId: 'p-1', legId: 50, cabinClass: 'ECONOMY' }]
                    : []
            )
        );
        mockTx.booking.findUnique.mockResolvedValue({
            status: 'CONFIRMED',
            passengers: [
                { id: 'p-1', firstName: 'Jane' }
            ]
        });
    });

    it('rejects an unauthenticated user', async () => {
        mockedGetServerSession.mockResolvedValue(null);
        await expect(changeBookingSeatsAction(1, [])).rejects.toThrow('Unauthorized');
    });

    it('allows seat changes with valid inputs and transaction checks', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            id: 1,
            userId: 'user-123',
            flightId: 10,
            legs: [{ id: 50, sequence: 1, flightId: 10, flight: { id: 10 } }],
            passengers: [
                { id: 'p-1', firstName: 'Jane' }
            ]
        });

        mockTx.seatAssignment.findMany.mockImplementation(({ where }: any) =>
            Promise.resolve(
                where?.legId
                    ? [{ passengerId: 'p-1', legId: 50, cabinClass: 'ECONOMY' }]
                    : [{ flightId: 10, seatNumber: '11A' }, { flightId: 10, seatNumber: '11B' }]
            )
        );

        await changeBookingSeatsAction(1, [
            { passengerId: 'p-1', legId: 50, seatNumber: '12B' }
        ]);

        expect(mockedBookingFindUnique).toHaveBeenCalledWith({
            where: { id: 1 },
            include: {
                legs: {
                    where: { supersededAt: null },
                    include: { flight: true },
                    orderBy: { sequence: 'asc' },
                },
            },
        });
        expect(mockTx.seatAssignment.findMany).toHaveBeenCalled();
        // Scoped to the leg: a passenger on a round trip holds an assignment
        // per leg, so updating by passenger alone would overwrite the other.
        expect(mockTx.seatAssignment.updateMany).toHaveBeenCalledWith({
            where: { passengerId: 'p-1', legId: 50 },
            data: { seatNumber: '12B' }
        });
        // The assignment is the whole change: writing a seat onto the traveller
        // row is what made an outbound change overwrite the return seat (#126).
        expect(mockTx.passenger.update).not.toHaveBeenCalled();
    });

    it('rejects if a seat is already occupied', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            id: 1,
            userId: 'user-123',
            flightId: 10,
            legs: [{ id: 50, sequence: 1, flightId: 10, flight: { id: 10 } }],
            passengers: [
                { id: 'p-1', firstName: 'Jane' }
            ]
        });

        // 12B is occupied
        mockTx.seatAssignment.findMany.mockImplementation(({ where }: any) =>
            Promise.resolve(
                where?.legId
                    ? [{ passengerId: 'p-1', legId: 50, cabinClass: 'ECONOMY' }]
                    : [{ flightId: 10, seatNumber: '12B' }]
            )
        );

        await expect(changeBookingSeatsAction(1, [
            { passengerId: 'p-1', legId: 50, seatNumber: '12B' }
        ])).rejects.toThrow('Seat 12B is already occupied by another passenger.');

        expect(mockTx.passenger.update).not.toHaveBeenCalled();
    });

    it('rejects a seat outside the passenger cabin layout', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            id: 1,
            userId: 'user-123',
            flightId: 10,
            legs: [{
                id: 50,
                sequence: 1,
                flightId: 10,
                flight: {
                    id: 10,
                    firstClassRows: 1,
                    businessRows: 1,
                    premiumEconomyRows: 1,
                    economyRows: 5,
                    seatPattern: 'AB-CD'
                },
            }],
            passengers: [
                { id: 'p-1', firstName: 'Jane', seatNumber: '4A', cabinClass: 'ECONOMY' }
            ]
        });

        await expect(changeBookingSeatsAction(1, [
            { passengerId: 'p-1', legId: 50, seatNumber: '1A' }
        ])).rejects.toThrow('Seat 1A is not available for ECONOMY on this flight.');

        expect(mockTx.passenger.update).not.toHaveBeenCalled();
    });

    it('rejects seat changes after a booking is cancelled', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            id: 1,
            userId: 'user-123',
            flightId: 10,
            legs: [{ id: 50, sequence: 1, flightId: 10, flight: { id: 10 } }],
            passengers: []
        });
        mockTx.booking.findUnique.mockResolvedValue({ status: 'CANCELLED', passengers: [] });

        await expect(changeBookingSeatsAction(1, [
            { passengerId: 'p-1', legId: 50, seatNumber: '12A' }
        ])).rejects.toThrow(
            'Seats cannot be changed on a cancelled booking'
        );
        expect(mockTx.passenger.update).not.toHaveBeenCalled();
    });

    it('rejects malformed seat changes before starting a transaction', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });

        await expect(changeBookingSeatsAction(-1, [
            { passengerId: '', legId: 0, seatNumber: 'not-a-seat' }
        ])).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
        expect((prisma as any).$transaction).not.toHaveBeenCalled();
    });
});

describe('deleteReviewAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rejects an unauthenticated user', async () => {
        mockedGetServerSession.mockResolvedValue(null);
        await expect(deleteReviewAction('rev-123')).rejects.toThrow('Unauthorized');
    });

    it('rejects a user trying to delete another user\'s review', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedReviewFindUnique.mockResolvedValue({ id: 'rev-123', userId: 'other-user' });

        await expect(deleteReviewAction('rev-123')).rejects.toThrow('Unauthorized');
        expect(mockedReviewDelete).not.toHaveBeenCalled();
    });

    it('allows a user to delete their own review', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedReviewFindUnique.mockResolvedValue({ id: 'rev-123', userId: 'user-123' });
        mockedReviewDelete.mockResolvedValue({ id: 'rev-123' });

        const result = await deleteReviewAction('rev-123');

        expect(mockedReviewFindUnique).toHaveBeenCalledWith({ where: { id: 'rev-123' } });
        expect(mockedReviewDelete).toHaveBeenCalledWith({ where: { id: 'rev-123' } });
        expect(result).toEqual({ id: 'rev-123' });
    });

    it('allows an admin to delete any review', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'admin-123', role: 'ADMIN', staffMfaVerified: true } });
        mockedReviewFindUnique.mockResolvedValue({ id: 'rev-123', userId: 'some-user' });
        mockedReviewDelete.mockResolvedValue({ id: 'rev-123' });

        const result = await deleteReviewAction('rev-123');

        expect(mockedReviewDelete).toHaveBeenCalledWith({ where: { id: 'rev-123' } });
        expect(result).toEqual({ id: 'rev-123' });
    });
});

describe('admin flight schedule actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-06-23T12:00:00Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('saveFlightScheduleAction', () => {
        const sampleScheduleInput = {
            flightNumber: 'AA101',
            airline: 'American Airlines',
            from: 'New York, USA',
            to: 'London, UK',
            departureTime: '08:00',
            durationMinutes: 245,
            daysOfWeek: [1], // Mondays
            price: '$850',
        };

        it('rejects unauthenticated user', async () => {
            mockedGetServerSession.mockResolvedValue(null);
            await expect(saveFlightScheduleAction(sampleScheduleInput)).rejects.toThrow('Unauthorized');
        });

        it('rejects non-admin user', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'USER' } });
            await expect(saveFlightScheduleAction(sampleScheduleInput)).rejects.toThrow('Unauthorized');
        });

        it('rejects an explicitly empty seat pattern', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });

            await expect(saveFlightScheduleAction({
                ...sampleScheduleInput,
                seatPattern: ''
            })).resolves.toMatchObject({
                ok: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    fields: { seatPattern: ['Seat pattern is required.'] }
                }
            });

            expect(mockedFlightScheduleCreate).not.toHaveBeenCalled();
        });

        it('refuses a place that is not an airport, before writing anything', async () => {
            // The occurrence loop resolves these to airports. Resolving after
            // the schedule was saved meant a typo threw, the write stood, and
            // the administrator was shown a generic failure for a save that had
            // succeeded — Next masks server-action messages in production.
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });

            const result = await saveFlightScheduleAction({
                ...sampleScheduleInput,
                from: 'New York',
            });

            expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
            // Attached to the field the administrator typed, so the form can
            // point at it rather than only summarising at the top of the page.
            expect((result as { error: { fields: Record<string, string[]> } }).error.fields.from[0])
                .toMatch(/^No airport is known for "New York"\./);
            expect(mockedFlightScheduleCreate).not.toHaveBeenCalled();
            expect(mockedFlightCreate).not.toHaveBeenCalled();
        });

        it('reports both ends at once rather than one round trip each', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });

            const result = await saveFlightScheduleAction({
                ...sampleScheduleInput,
                from: 'New York',
                to: 'Boston',
            });

            const { fields } = (result as { error: { fields: Record<string, string[]> } }).error;
            expect(Object.keys(fields).sort()).toEqual(['from', 'to']);
            expect(mockedFlightScheduleCreate).not.toHaveBeenCalled();
        });

        it('allows admin to create a new flight schedule and generates flights', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
            mockedFlightScheduleCreate.mockResolvedValue({
                id: 1,
                ...sampleScheduleInput,
                // The persisted schedule carries the fare the generator copies
                // onto each occurrence.
                priceCents: 85000,
                durationMinutes: 245,
            });
            mockedFlightFindFirst.mockResolvedValue(null); // No existing flight instance
            mockedFlightCreate.mockResolvedValue({});
            mockedFlightScheduleFindUnique.mockResolvedValue({ isActive: true });

            const result = await saveFlightScheduleAction(sampleScheduleInput);

            expect(mockedFlightScheduleCreate).toHaveBeenCalledWith({
                data: {
                    ...sampleScheduleInput,
                    price: undefined,
                    // The fare is stored only in minor units now (#135).
                    priceCents: 85000,
                    durationMinutes: 245,
                    firstClassRows: 3,
                    businessRows: 3,
                    premiumEconomyRows: 4,
                    economyRows: 20,
                    seatPattern: 'ABC-DEF',
                },
            });

            // For next 30 days starting June 23 (Tuesday), Mondays are on June 29, July 6, 13, 20.
            // 4 instances should be created.
            expect(mockedFlightCreate).toHaveBeenCalledTimes(4);
            expect(mockedFlightCreate).toHaveBeenNthCalledWith(1, {
                data: {
                    flightScheduleId: 1,
                    flightNumber: 'AA101',
                    airline: 'American Airlines',
                    fromAirportCode: 'JFK',
                    toAirportCode: 'LHR',
                    departureDate: new Date('2026-06-29T12:00:00Z'),
                    priceCents: 85000,
                    durationMinutes: 245,
                    status: 'ON_TIME',
                    firstClassRows: 3,
                    businessRows: 3,
                    premiumEconomyRows: 4,
                    economyRows: 20,
                    seatPattern: 'ABC-DEF',
                }
            });
            expect(result).toHaveProperty('id', 1);
        });

        it('normalizes schedule identifiers before persistence', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
            mockedFlightScheduleCreate.mockResolvedValue({ id: 1, daysOfWeek: [] });
            mockedFlightScheduleFindUnique.mockResolvedValue({ isActive: true });

            await saveFlightScheduleAction({
                ...sampleScheduleInput,
                flightNumber: ' aa 101 '
            });

            expect(mockedFlightScheduleCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({ flightNumber: 'AA101' })
            });
        });

        it('allows admin to update an existing flight schedule', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
            const scheduleWithId = { id: 5, ...sampleScheduleInput };
            mockedFlightScheduleUpdate.mockResolvedValue(scheduleWithId);
            mockedFlightFindFirst.mockResolvedValue({}); // existing instances, skips creating new ones
            mockedFlightScheduleFindUnique.mockResolvedValue({ isActive: true });

            const result = await saveFlightScheduleAction(scheduleWithId);

            expect(mockedFlightScheduleUpdate).toHaveBeenCalledWith({
                where: { id: 5 },
                data: {
                    ...sampleScheduleInput,
                    price: undefined,
                    // The fare is stored only in minor units now (#135).
                    priceCents: 85000,
                    durationMinutes: 245,
                    firstClassRows: 3,
                    businessRows: 3,
                    premiumEconomyRows: 4,
                    economyRows: 20,
                    seatPattern: 'ABC-DEF',
                },
            });
            expect(mockedFlightCreate).not.toHaveBeenCalled();
            expect(result).toHaveProperty('id', 5);
        });

        it('does not generate new occurrences while updating an inactive template', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
            mockedFlightScheduleUpdate.mockResolvedValue({
                id: 5,
                ...sampleScheduleInput,
                isActive: false,
                priceCents: 85_000,
            });

            await saveFlightScheduleAction({ id: 5, ...sampleScheduleInput });

            expect(mockedFlightFindFirst).not.toHaveBeenCalled();
            expect(mockedFlightCreate).not.toHaveBeenCalled();
        });

        it('rechecks activation after the generation lock before pre-generating', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
            mockedFlightScheduleUpdate.mockResolvedValue({
                id: 5,
                ...sampleScheduleInput,
                isActive: true,
                priceCents: 85_000,
            });
            mockedFlightScheduleFindUnique.mockResolvedValue({ isActive: false });

            await saveFlightScheduleAction({ id: 5, ...sampleScheduleInput });

            const [lockSql, namespace, lockedScheduleId] = mockTx.$executeRaw.mock.calls[0];
            expect(lockSql.join('?')).toContain('pg_advisory_xact_lock');
            expect(namespace).toBe(834_206);
            expect(lockedScheduleId).toBe(5);
            expect(mockTx.$executeRaw.mock.invocationCallOrder[0])
                .toBeLessThan(mockedFlightScheduleFindUnique.mock.invocationCallOrder[0]);
            expect(mockedFlightFindFirst).not.toHaveBeenCalled();
            expect(mockedFlightCreate).not.toHaveBeenCalled();
        });
    });

    describe('deleteFlightScheduleAction', () => {
        const request = {
            requestId: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            flightScheduleId: 12,
            confirmed: true,
        };

        it('rejects unauthenticated user', async () => {
            mockedGetServerSession.mockResolvedValue(null);
            await expect(deleteFlightScheduleAction(request)).rejects.toThrow('Unauthorized');
        });

        it('requires verified staff access', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'staff-1', role: 'ADMIN', staffMfaVerified: false },
            });

            await expect(deleteFlightScheduleAction(request)).rejects.toThrow('Unauthorized');
            expect(mockDeleteFlightSchedule).not.toHaveBeenCalled();
        });

        it('deletes through the retryable service and refreshes every consumer', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { id: 'staff-1', role: 'ADMIN', staffMfaVerified: true } });
            mockDeleteFlightSchedule.mockResolvedValue({ deletionId: 'delete-1', wasDeleted: true });

            await deleteFlightScheduleAction(request);

            expect(mockDeleteFlightSchedule).toHaveBeenCalledWith({
                requestId: request.requestId,
                flightScheduleId: 12,
                actorUserId: 'staff-1',
            });
            expect(mockedRevalidatePath.mock.calls.map(([path]) => path)).toEqual([
                '/',
                '/flights',
                '/admin/flights',
            ]);
            expect(mockedRedirect).toHaveBeenCalledWith('/admin/flights');
        });

        it.each([
            [{ ...request, confirmed: false }, 'Confirm permanent deletion.'],
            [{ ...request, requestId: 'not-a-uuid' }, 'Schedule deletion request ID must be a UUID.'],
            [{ ...request, flightScheduleId: 0 }, 'Schedule ID must be positive.'],
        ])('rejects invalid deletion input before calling the service', async (invalid, message) => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'staff-1', role: 'ADMIN', staffMfaVerified: true },
            });

            await expect(deleteFlightScheduleAction(invalid)).resolves.toMatchObject({
                ok: false,
                error: { message },
            });
            expect(mockDeleteFlightSchedule).not.toHaveBeenCalled();
        });

        it('returns a safe typed service refusal as validation feedback', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'staff-1', role: 'ADMIN', staffMfaVerified: true },
            });
            mockDeleteFlightSchedule.mockRejectedValue(new FlightScheduleDeletionError(
                'ACTIVE',
                'Deactivate this template before deleting it permanently.',
            ));

            await expect(deleteFlightScheduleAction(request)).resolves.toMatchObject({
                ok: false,
                error: {
                    message: 'Deactivate this template before deleting it permanently.',
                    fields: { _root: ['Deactivate this template before deleting it permanently.'] },
                },
            });
        });

        it('rethrows unexpected errors instead of exposing private details as feedback', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'staff-1', role: 'ADMIN', staffMfaVerified: true },
            });
            const internal = new Error('postgresql://private-host/schedule_delete');
            mockDeleteFlightSchedule.mockRejectedValue(internal);

            await expect(deleteFlightScheduleAction(request)).rejects.toBe(internal);
        });
    });

    describe('setFlightScheduleActiveAction', () => {
        it('requires verified staff access', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'admin-1', role: 'ADMIN', staffMfaVerified: false },
            });

            await expect(setFlightScheduleActiveAction(17, false)).rejects.toThrow('Unauthorized');
            expect(mockSetFlightScheduleActive).not.toHaveBeenCalled();
        });

        it('sets the desired state and refreshes every schedule consumer', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'admin-1', role: 'ADMIN', staffMfaVerified: true },
            });
            mockSetFlightScheduleActive.mockResolvedValue({
                flightScheduleId: 17,
                isActive: false,
                changed: true,
                preservedOccurrenceCount: 4,
            });

            await expect(setFlightScheduleActiveAction(17, false)).resolves.toMatchObject({
                isActive: false,
                preservedOccurrenceCount: 4,
            });
            expect(mockSetFlightScheduleActive).toHaveBeenCalledWith(17, false);
            expect(mockedRevalidatePath.mock.calls.map(([path]) => path)).toEqual([
                '/',
                '/flights',
                '/admin/flights',
                '/admin/flights/schedules/17',
            ]);
        });

        it('rejects invalid activation input before calling the service', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'admin-1', role: 'ADMIN', staffMfaVerified: true },
            });

            await expect(setFlightScheduleActiveAction(0, false)).resolves.toMatchObject({
                ok: false,
                error: { fields: { flightScheduleId: ['Schedule ID must be positive.'] } },
            });
            await expect((setFlightScheduleActiveAction as unknown as (
                flightScheduleId: number,
                isActive: unknown,
            ) => Promise<unknown>)(17, 'false')).resolves.toMatchObject({
                ok: false,
                error: { fields: { isActive: expect.any(Array) } },
            });
            expect(mockSetFlightScheduleActive).not.toHaveBeenCalled();
        });

        it('returns a safe validation failure for a schedule removed concurrently', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'admin-1', role: 'ADMIN', staffMfaVerified: true },
            });
            mockSetFlightScheduleActive.mockRejectedValue(new FlightScheduleActivationError(
                'NOT_FOUND',
                'This flight schedule no longer exists.',
            ));

            await expect(setFlightScheduleActiveAction(17, false)).resolves.toMatchObject({
                ok: false,
                error: { message: 'This flight schedule no longer exists.' },
            });
        });

        it('does not expose an unexpected service error as validation feedback', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'admin-1', role: 'ADMIN', staffMfaVerified: true },
            });
            const sentinel = new Error('private database sentinel');
            mockSetFlightScheduleActive.mockRejectedValue(sentinel);

            await expect(setFlightScheduleActiveAction(17, false)).rejects.toBe(sentinel);
        });
    });

    describe('updateFlightScheduleTermsAction', () => {
        const request = {
            requestId: '8ea59a65-9251-45b3-95d0-3920c49f5735',
            flightScheduleId: 17,
            durationMinutes: 255,
            price: '$375.00',
            confirmed: true,
        };

        it('requires verified staff access', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'admin-1', role: 'ADMIN', staffMfaVerified: false },
            });

            await expect(updateFlightScheduleTermsAction(request)).rejects.toThrow('Unauthorized');
            expect(mockUpdateFlightScheduleTerms).not.toHaveBeenCalled();
        });

        it('rejects an invalid retry key before reaching the service', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'admin-1', role: 'ADMIN', staffMfaVerified: true },
            });

            await expect(updateFlightScheduleTermsAction({
                ...request,
                requestId: 'not-a-uuid',
            })).resolves.toMatchObject({
                ok: false,
                error: { fields: { requestId: expect.any(Array) } },
            });
            expect(mockUpdateFlightScheduleTerms).not.toHaveBeenCalled();
        });

        it('binds the normalized terms and current actor to one service request', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'admin-1', role: 'ADMIN', staffMfaVerified: true },
            });
            mockUpdateFlightScheduleTerms.mockResolvedValue({
                changeId: 'change-17',
                flightScheduleId: 17,
                durationMinutes: 255,
                priceCents: 37_500,
                updatedOccurrenceCount: 3,
                protectedOccurrenceCount: 2,
                createdAt: new Date('2026-08-17T15:00:00.000Z'),
                wasApplied: true,
            });

            await expect(updateFlightScheduleTermsAction(request)).resolves.toMatchObject({
                changeId: 'change-17',
                updatedOccurrenceCount: 3,
                protectedOccurrenceCount: 2,
            });
            expect(mockUpdateFlightScheduleTerms).toHaveBeenCalledWith({
                requestId: request.requestId,
                flightScheduleId: 17,
                actorUserId: 'admin-1',
                durationMinutes: 255,
                priceCents: 37_500,
            });
            expect(mockedRevalidatePath).toHaveBeenCalledWith('/admin/flights');
            expect(mockedRevalidatePath).toHaveBeenCalledWith('/admin/flights/schedules/17');
        });

        it('returns safe service refusals as validation feedback', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'admin-1', role: 'ADMIN', staffMfaVerified: true },
            });
            mockUpdateFlightScheduleTerms.mockRejectedValue(new FlightScheduleTermsError(
                'NO_CHANGES',
                'Change the duration or fare before updating this schedule.',
            ));

            await expect(updateFlightScheduleTermsAction(request)).resolves.toMatchObject({
                ok: false,
                error: {
                    message: 'Change the duration or fare before updating this schedule.',
                    fields: { _root: ['Change the duration or fare before updating this schedule.'] },
                },
            });
        });

        it('marks a reused request key so the form can mint a new retry', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'admin-1', role: 'ADMIN', staffMfaVerified: true },
            });
            mockUpdateFlightScheduleTerms.mockRejectedValue(new FlightScheduleTermsError(
                'REQUEST_REUSED',
                'This retry key belongs to a different schedule update. Start a new update.',
            ));

            await expect(updateFlightScheduleTermsAction(request)).resolves.toMatchObject({
                ok: false,
                error: { fields: { requestId: expect.any(Array) } },
            });
        });

        it('rethrows unexpected service errors instead of exposing them as validation feedback', async () => {
            mockedGetServerSession.mockResolvedValue({
                user: { id: 'admin-1', role: 'ADMIN', staffMfaVerified: true },
            });
            const internal = new Error('postgresql://private-host/schedule_terms');
            mockUpdateFlightScheduleTerms.mockRejectedValue(internal);

            await expect(updateFlightScheduleTermsAction(request)).rejects.toBe(internal);
        });
    });

    describe('updateFlightStatusAction', () => {
        it('rejects unauthenticated user', async () => {
            mockedGetServerSession.mockResolvedValue(null);
            await expect(updateFlightStatusAction(99, 'DELAYED')).rejects.toThrow('Unauthorized');
        });

        it('allows admin to update status and creates flight update notifications for affected users', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
            // The status and what it does to the bookings move together under
            // the flight's lock now, so both happen on the transaction client.
            mockTx.flight.update.mockResolvedValue({
                id: 99,
                airline: 'Gemini Airways',
                flightNumber: 'GA101',
                // Deliberately not what the airports say, so the message below
                // can only be right if it reads the references (#73).
                from: 'somewhere',
                to: 'somewhere else',
                fromAirport: { label: 'Seattle, USA' },
                toAirport: { label: 'Detroit, USA' },
                status: 'DELAYED'
            });
            // The bookings are row-locked first, then read with their legs:
            // what each becomes depends on whether any leg is cancelled.
            mockTx.$queryRaw.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
            const operating = { legs: [{ flight: { status: 'DELAYED' } }], status: 'CONFIRMED' };
            mockTx.booking.findMany.mockResolvedValue([
                { id: 1, userId: 'user-1', ...operating },
                { id: 2, userId: 'user-2', ...operating },
                { id: 3, userId: null, ...operating },
                { id: 4, userId: 'user-1', ...operating },
            ]);

            const result = await updateFlightStatusAction(99, 'DELAYED');

            expect(mockTx.flight.update).toHaveBeenCalledWith({
                where: { id: 99 },
                data: { status: 'DELAYED' },
                include: {
                    fromAirport: { select: { label: true } },
                    toAirport: { select: { label: true } },
                },
            });
            expect(result).toEqual(expect.objectContaining({ id: 99, status: 'DELAYED' }));
            // The route crosses back as two strings. Leaving the relation on
            // this value would ship two more objects to a client that reads it
            // only to check for a validation failure.
            expect(result).toMatchObject({ from: 'Seattle, USA', to: 'Detroit, USA' });
            expect(result).not.toHaveProperty('fromAirport');
            expect(result).not.toHaveProperty('toAirport');

            // Everyone holding a live booking on the flight is told about a
            // delay, which is the main thing this action announces. Narrowing
            // the read to disrupted bookings silently stopped delay
            // notifications altogether (#76).
            expect(mockTx.booking.findMany).toHaveBeenCalledWith({
                where: { id: { in: [1, 2, 3, 4] } },
                select: {
                    id: true,
                    status: true,
                    userId: true,
                    legs: {
                        where: { supersededAt: null },
                        select: { flight: { select: { status: true } } },
                    },
                },
            });
            // A delay moves nobody's booking status.
            expect(mockTx.booking.update).not.toHaveBeenCalled();

            expect(mockedNotificationCreateMany).toHaveBeenCalledWith({
                data: [
                    {
                        userId: 'user-1',
                        title: 'Flight Update: Gemini Airways GA101',
                        message: 'Your upcoming flight GA101 from Seattle, USA to Detroit, USA is now DELAYED.',
                        type: 'FLIGHT_STATUS'
                    },
                    {
                        userId: 'user-2',
                        title: 'Flight Update: Gemini Airways GA101',
                        message: 'Your upcoming flight GA101 from Seattle, USA to Detroit, USA is now DELAYED.',
                        type: 'FLIGHT_STATUS'
                    }
                ]
            });
        });
    });

    describe('user notifications actions', () => {
        beforeEach(() => jest.clearAllMocks());

        describe('getUserNotificationsAction', () => {
            it('returns empty array if unauthenticated', async () => {
                mockedGetServerSession.mockResolvedValue(null);
                const result = await getUserNotificationsAction();
                expect(result).toEqual([]);
            });

            it('returns notifications for logged in user', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
                const mockNotifications = [{ id: 'notif-1', title: 'Test Notif' }];
                mockedNotificationFindMany.mockResolvedValue(mockNotifications);

                const result = await getUserNotificationsAction();

                expect(mockedNotificationFindMany).toHaveBeenCalledWith({
                    where: { userId: 'user-123' },
                    orderBy: { createdAt: 'desc' },
                    take: 50
                });
                expect(result).toEqual(mockNotifications);
            });
        });

        describe('markNotificationAsReadAction', () => {
            it('rejects if unauthenticated', async () => {
                mockedGetServerSession.mockResolvedValue(null);
                await expect(markNotificationAsReadAction('notif-1')).rejects.toThrow('Unauthorized');
            });

            it('rejects if user does not own the notification', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
                mockedNotificationFindUnique.mockResolvedValue({ id: 'notif-1', userId: 'other-user' });

                await expect(markNotificationAsReadAction('notif-1')).rejects.toThrow('Unauthorized');
            });

            it('updates notification isRead to true if owned', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
                mockedNotificationFindUnique.mockResolvedValue({ id: 'notif-1', userId: 'user-123' });
                mockedNotificationUpdate.mockResolvedValue({ id: 'notif-1', isRead: true });

                const result = await markNotificationAsReadAction('notif-1');

                expect(mockedNotificationUpdate).toHaveBeenCalledWith({
                    where: { id: 'notif-1' },
                    data: { isRead: true }
                });
                expect(result).toEqual({ id: 'notif-1', isRead: true });
            });
        });

        describe('markAllNotificationsAsReadAction', () => {
            it('rejects if unauthenticated', async () => {
                mockedGetServerSession.mockResolvedValue(null);
                await expect(markAllNotificationsAsReadAction()).rejects.toThrow('Unauthorized');
            });

            it('marks all unread notifications as read for logged in user', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
                mockedNotificationUpdateMany.mockResolvedValue({ count: 5 });

                const result = await markAllNotificationsAsReadAction();

                expect(mockedNotificationUpdateMany).toHaveBeenCalledWith({
                    where: { userId: 'user-123', isRead: false },
                    data: { isRead: true }
                });
                expect(result).toEqual({ count: 5 });
            });
        });

        describe('generateFlightOccurrencesAction', () => {
            it('rejects if unauthenticated', async () => {
                mockedGetServerSession.mockResolvedValue(null);
                await expect(generateFlightOccurrencesAction(1, '2026-07-10', '2026-07-20')).rejects.toThrow('Unauthorized');
            });

            it('rejects if non-admin', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { role: 'USER' } });
                await expect(generateFlightOccurrencesAction(1, '2026-07-10', '2026-07-20')).rejects.toThrow('Unauthorized');
            });

            it('refuses manual generation from an inactive template', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
                mockedFlightScheduleFindUnique.mockResolvedValue({
                    id: 1,
                    isActive: false,
                    daysOfWeek: [1],
                });

                await expect(
                    generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10'),
                ).resolves.toMatchObject({
                    ok: false,
                    error: {
                        message: 'Reactivate this template before generating occurrences.',
                        fields: { scheduleId: ['Reactivate this template before generating occurrences.'] },
                    },
                });
                expect(mockedFlightFindFirst).not.toHaveBeenCalled();
                expect(mockedFlightCreate).not.toHaveBeenCalled();
                const [lockSql, namespace, lockedScheduleId] = mockTx.$executeRaw.mock.calls[0];
                expect(lockSql.join('?')).toContain('pg_advisory_xact_lock');
                expect(namespace).toBe(834_206);
                expect(lockedScheduleId).toBe(1);
                expect(mockTx.$executeRaw.mock.invocationCallOrder[0])
                    .toBeLessThan(mockedFlightScheduleFindUnique.mock.invocationCallOrder[0]);
            });

            it('generates flight instances and updates existing ones', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });

                mockedFlightScheduleFindUnique.mockResolvedValue({
                    id: 1,
                    flightNumber: 'AA101',
                    airline: 'American Airlines',
                    from: 'New York, USA',
                    to: 'San Francisco, USA',
                    departureTime: '08:00',
                    durationMinutes: 245,
                    daysOfWeek: [1], // Mondays
                    priceCents: 50000,
                });

                mockedFlightFindFirst.mockResolvedValue(null);
                mockedFlightCreate.mockResolvedValue({});

                // July 6, 2026 is Monday
                const result = await generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10', {
                    firstClassRows: 3,
                    businessRows: 6,
                    premiumEconomyRows: 6,
                    economyRows: 24,
                    seatPattern: 'AC-DF'
                });

                expect(mockedFlightCreate).toHaveBeenCalledTimes(1);
                expect(mockedFlightCreate).toHaveBeenCalledWith({
                    data: {
                        flightScheduleId: 1,
                        flightNumber: 'AA101',
                        airline: 'American Airlines',
                        fromAirportCode: 'JFK',
                        toAirportCode: 'SFO',
                        departureDate: new Date('2026-07-06T12:00:00Z'),
                        // Inherited from the schedule: a flight knows how long
                        // it takes because its schedule stated it (#84).
                        durationMinutes: 245,
                        priceCents: 50000,
                        status: 'ON_TIME',
                        firstClassRows: 3,
                        businessRows: 6,
                        premiumEconomyRows: 6,
                        economyRows: 24,
                        seatPattern: 'AC-DF',
                    }
                });
                expect(result).toEqual({ success: true, count: 1, created: 1, updated: 0 });
            });

            it('rejects invalid seating configuration inputs', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });

                mockedFlightScheduleFindUnique.mockResolvedValue({
                    id: 1,
                    daysOfWeek: [1],
                });

                // Negative row count
                await expect(generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10', {
                    firstClassRows: -1
                })).resolves.toMatchObject({
                    ok: false,
                    error: { message: 'Row configurations must be non-negative integers.' }
                });

                // Fractional and empty layouts
                await expect(generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10', {
                    firstClassRows: 1.5
                })).resolves.toMatchObject({
                    ok: false,
                    error: { message: 'Row configurations must be non-negative integers.' }
                });
                await expect(generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10', {
                    firstClassRows: 0,
                    businessRows: 0,
                    premiumEconomyRows: 0,
                    economyRows: 0
                })).resolves.toMatchObject({
                    ok: false,
                    error: { message: 'At least one seating row is required.' }
                });

                // Duplicate seat letters
                await expect(generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10', {
                    seatPattern: 'ABC-ABC'
                })).resolves.toMatchObject({ ok: false, error: { message: 'Seat pattern letters must be unique.' } });

                // No seat letters (only hyphens)
                await expect(generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10', {
                    seatPattern: '---'
                })).resolves.toMatchObject({ ok: false, error: { message: 'Seat pattern must contain at least one seat letter.' } });

                // Invalid characters
                await expect(generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10', {
                    seatPattern: 'ABC_DEF'
                })).resolves.toMatchObject({ ok: false, error: { message: 'Seat pattern must only contain uppercase letters and hyphens.' } });

                await expect(generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10', {
                    seatPattern: 'ABC--DEF'
                })).resolves.toMatchObject({ ok: false, error: { message: 'Seat pattern must contain seat-letter groups separated by single hyphens.' } });
                await expect(generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10', {
                    seatPattern: ''
                })).resolves.toMatchObject({ ok: false, error: { message: 'Seat pattern is required.' } });

                await expect(generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10', {
                    economyRows: 101
                })).resolves.toMatchObject({ ok: false, error: { message: 'Seating layouts cannot exceed 100 total rows.' } });
                await expect(generateFlightOccurrencesAction(1, '2026-07-05', '2026-07-10', {
                    seatPattern: 'ABCDEFGHIJKLM'
                })).resolves.toMatchObject({ ok: false, error: { message: 'Seat patterns cannot exceed 12 seats per row.' } });
            });

            it('normalizes seat patterns before persisting occurrences', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
                mockedFlightScheduleFindUnique.mockResolvedValue({
                    id: 1,
                    flightNumber: 'AA101',
                    airline: 'American Airlines',
                    from: 'New York, USA',
                    to: 'San Francisco, USA',
                    departureTime: '08:00',
                    durationMinutes: 245,
                    daysOfWeek: [1],
                    priceCents: 50000,
                });
                mockedFlightFindFirst.mockResolvedValue(null);

                await generateFlightOccurrencesAction(1, '2026-07-06', '2026-07-06', {
                    seatPattern: ' ac-df '
                });

                expect(mockedFlightCreate).toHaveBeenCalledWith({
                    data: expect.objectContaining({ seatPattern: 'AC-DF' })
                });
            });

            it('reports existing occurrences as updated', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
                mockedFlightScheduleFindUnique.mockResolvedValue({
                    id: 1,
                    flightNumber: 'AA101',
                    airline: 'American Airlines',
                    from: 'New York, USA',
                    to: 'San Francisco, USA',
                    departureTime: '08:00',
                    durationMinutes: 245,
                    daysOfWeek: [1],
                    priceCents: 50000,
                });
                mockedFlightFindFirst.mockResolvedValue({ id: 42 });
                mockTx.flight.findUnique.mockResolvedValue({ id: 42, seatAssignments: [] });
                mockTx.flight.update.mockResolvedValue({ id: 42 });

                const result = await generateFlightOccurrencesAction(
                    1,
                    '2026-07-06',
                    '2026-07-06'
                );

                expect(result).toEqual({
                    success: true,
                    count: 1,
                    created: 0,
                    updated: 1
                });
            });

            it('applies the requested layout after a concurrent occurrence create', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
                mockedFlightScheduleFindUnique.mockResolvedValue({
                    id: 1,
                    flightNumber: 'AA101',
                    airline: 'American Airlines',
                    from: 'New York, USA',
                    to: 'San Francisco, USA',
                    departureTime: '08:00',
                    durationMinutes: 245,
                    daysOfWeek: [1],
                    priceCents: 50000,
                });
                mockedFlightFindFirst
                    .mockResolvedValueOnce(null)
                    .mockResolvedValueOnce({ id: 99 });
                const duplicateError = Object.assign(new Error('duplicate'), { code: 'P2002' });
                mockedFlightCreate.mockRejectedValueOnce(duplicateError);
                mockTx.flight.findUnique.mockResolvedValue({ id: 99, seatAssignments: [] });
                mockTx.flight.update.mockResolvedValue({ id: 99 });

                const result = await generateFlightOccurrencesAction(1, '2026-07-06', '2026-07-06', {
                    firstClassRows: 1,
                    businessRows: 2,
                    premiumEconomyRows: 3,
                    economyRows: 18,
                    seatPattern: 'AC-DF'
                });

                expect(mockTx.flight.update).toHaveBeenCalledWith({
                    where: { id: 99 },
                    data: {
                        firstClassRows: 1,
                        businessRows: 2,
                        premiumEconomyRows: 3,
                        economyRows: 18,
                        seatPattern: 'AC-DF'
                    }
                });
                expect(result).toEqual({ success: true, count: 1, created: 0, updated: 1 });
            });

            it('rejects malformed or excessive occurrence date ranges', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
                mockedFlightScheduleFindUnique.mockResolvedValue({ id: 1, daysOfWeek: [] });

                await expect(
                    generateFlightOccurrencesAction(1, '07/05/2026', '2026-07-10')
                ).resolves.toMatchObject({ ok: false, error: { message: 'Dates must use YYYY-MM-DD format.' } });
                await expect(
                    generateFlightOccurrencesAction(1, '2026-01-01', '2027-01-03')
                ).resolves.toMatchObject({ ok: false, error: { message: 'Date range cannot exceed 366 days.' } });
            });

            it('does not invalidate seats already assigned to passengers', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
                mockedFlightScheduleFindUnique.mockResolvedValue({
                    id: 1,
                    flightNumber: 'AA101',
                    airline: 'American Airlines',
                    from: 'New York, USA',
                    to: 'San Francisco, USA',
                    departureTime: '08:00',
                    durationMinutes: 245,
                    daysOfWeek: [1],
                    priceCents: 50000,
                });
                mockedFlightFindFirst.mockResolvedValue({
                    id: 42,
                    seatAssignments: [{ seatNumber: '30F', cabinClass: 'ECONOMY' }]
                });
                mockTx.flight.findUnique.mockResolvedValue({
                    id: 42,
                    seatAssignments: [{ seatNumber: '30F', cabinClass: 'ECONOMY' }]
                });

                await expect(generateFlightOccurrencesAction(1, '2026-07-06', '2026-07-06', {
                    firstClassRows: 1,
                    businessRows: 1,
                    premiumEconomyRows: 1,
                    economyRows: 5,
                    seatPattern: 'ABC-DEF'
                })).rejects.toThrow('Occupied seat 30F is not available for ECONOMY in the requested layout.');

                expect(mockTx.flight.update).not.toHaveBeenCalled();
                // Seats held on the flight, from whichever leg holds them, so a
                // return leg's seats are seen too.
                expect(mockTx.flight.findUnique).toHaveBeenCalledWith({
                    where: { id: 42 },
                    include: {
                        seatAssignments: {
                            where: { releasedAt: null, },
                            select: { seatNumber: true, cabinClass: true }
                        }
                    }
                });
            });

            it('does not move an occupied seat across cabin boundaries', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
                mockedFlightScheduleFindUnique.mockResolvedValue({
                    id: 1,
                    flightNumber: 'AA101',
                    airline: 'American Airlines',
                    from: 'New York, USA',
                    to: 'San Francisco, USA',
                    departureTime: '08:00',
                    durationMinutes: 245,
                    daysOfWeek: [1],
                    priceCents: 50000,
                });
                mockedFlightFindFirst.mockResolvedValue({ id: 42 });
                mockTx.flight.findUnique.mockResolvedValue({
                    id: 42,
                    seatAssignments: [{ seatNumber: '11A', cabinClass: 'ECONOMY' }]
                });

                await expect(generateFlightOccurrencesAction(1, '2026-07-06', '2026-07-06', {
                    firstClassRows: 4,
                    businessRows: 3,
                    premiumEconomyRows: 4,
                    economyRows: 19,
                    seatPattern: 'ABC-DEF'
                })).rejects.toThrow(
                    'Occupied seat 11A is not available for ECONOMY in the requested layout.'
                );

                expect(mockTx.flight.update).not.toHaveBeenCalled();
            });
        });
    });
});

describe('getOccupiedSeatsAction authorization', () => {
    const mockedSeatFindMany = (prisma as any).seatAssignment.findMany as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockedSeatFindMany.mockResolvedValue([{ seatNumber: '11A' }, { seatNumber: '12C' }]);
    });

    /**
     * This was the one read action with no session check and no public caller.
     * Both places that render a seat map — checkout and the profile — sit behind
     * the middleware matcher, but a server action is its own endpoint: the
     * matcher guards page navigations, and the action is dispatched by header.
     * So the check belongs here rather than on the route (#154).
     */
    it('refuses an unauthenticated caller, without reaching the database', async () => {
        mockedGetServerSession.mockResolvedValue(null);

        await expect(getOccupiedSeatsAction(42)).rejects.toThrow('Unauthorized');
        expect(mockedSeatFindMany).not.toHaveBeenCalled();
    });

    it('refuses a session carrying no user id', async () => {
        mockedGetServerSession.mockResolvedValue({ user: {} });

        await expect(getOccupiedSeatsAction(42)).rejects.toThrow('Unauthorized');
        expect(mockedSeatFindMany).not.toHaveBeenCalled();
    });

    it('answers any signed-in traveller, for any flight', async () => {
        // Deliberately not scoped to flights the caller has booked: checkout
        // needs the occupancy of a flight before there is a booking to check
        // against, so that rule would refuse the case the action exists for.
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-1' } });

        await expect(getOccupiedSeatsAction(42)).resolves.toEqual(['11A', '12C']);
        expect(mockedSeatFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ flightId: 42 }),
        }));
    });

    it('still validates the flight id for a signed-in caller', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-1' } });

        await expect(getOccupiedSeatsAction(-1 as number)).rejects.toThrow();
        expect(mockedSeatFindMany).not.toHaveBeenCalled();
    });

    it('answers who is asking before what they asked for', async () => {
        // Both wrong: the refusal should say so rather than reporting the id,
        // which would tell an anonymous caller which ids are well-formed.
        mockedGetServerSession.mockResolvedValue(null);

        await expect(getOccupiedSeatsAction(-1 as number)).rejects.toThrow('Unauthorized');
        expect(mockedSeatFindMany).not.toHaveBeenCalled();
    });
});

describe('holdChosenSeatsAction input boundary', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rejects a malformed checkout identifier before writing a hold', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-1' } });

        await expect(holdChosenSeatsAction({
            checkoutId: 'not-a-uuid',
            claims: [{ flightId: 42, seatNumber: '11A' }],
        })).resolves.toMatchObject({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                fields: { checkoutId: expect.any(Array) },
            },
        });
        expect((prisma as any).$executeRaw).not.toHaveBeenCalled();
    });

    it('propagates an unexpected hold storage failure', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-1' } });
        const storageError = new Error('hold storage unavailable');
        mockTx.$queryRaw.mockRejectedValueOnce(storageError);

        await expect(holdChosenSeatsAction({
            checkoutId: '11111111-1111-4111-8111-111111111111',
            claims: [{ flightId: 42, seatNumber: '11A' }],
        })).rejects.toBe(storageError);
    });
});
