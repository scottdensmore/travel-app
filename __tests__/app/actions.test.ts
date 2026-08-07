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
    getOccupiedSeatsAction
} from '@/app/actions';
import { getServerSession } from 'next-auth';
import TravelGuideService from '@/lib/TravelGuideService';
import FlightBookingService from '@/lib/FlightBookingService';
import FlightScheduleService from '@/lib/FlightScheduleService';
import { prisma } from '@/lib/prisma';

// Keep these heavy/server-only modules out of the unit test.
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
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

const mockTx = {
    $queryRaw: jest.fn(),
    passenger: {
        findMany: jest.fn(),
        update: jest.fn(),
    },
    booking: {
        findUnique: jest.fn(),
        update: jest.fn(),
    },
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
        notification: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), createMany: jest.fn() },
        $transaction: jest.fn((callback) => callback(mockTx)),
    },
}));

const mockedGetServerSession = getServerSession as unknown as jest.Mock;
const mockSaveCityGuide = new (TravelGuideService as any)().saveCityGuide as jest.Mock;
const mockBookFlight = new (FlightBookingService as any)().bookFlight as jest.Mock;
const mockGenerateFlightsForDate = new (FlightScheduleService as any)().generateFlightsForDate as jest.Mock;
const mockedFlightFindMany = (prisma as any).flight.findMany as jest.Mock;
const mockedFlightFindFirst = (prisma as any).flight.findFirst as jest.Mock;
const mockedFlightCreate = (prisma as any).flight.create as jest.Mock;
const mockedFlightUpdate = (prisma as any).flight.update as jest.Mock;
const mockedFlightFindUnique = (prisma as any).flight.findUnique as jest.Mock;
const mockedFlightScheduleFindMany = (prisma as any).flightSchedule.findMany as jest.Mock;
const mockedFlightScheduleCreate = (prisma as any).flightSchedule.create as jest.Mock;
const mockedFlightScheduleUpdate = (prisma as any).flightSchedule.update as jest.Mock;
const mockedFlightScheduleDelete = (prisma as any).flightSchedule.delete as jest.Mock;
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
        mockedFlightFindMany.mockResolvedValue(flights);

        const result = await searchFlightsAction('Seattle, USA', 'Detroit, USA');

        expect(mockedFlightFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { from: 'Seattle, USA', to: 'Detroit, USA' } })
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
            { id: 1, flightNumber: 'CA101', from: 'Seattle, USA', to: 'Detroit, USA', departureDate: new Date('2026-06-25T08:00:00Z') },
        ];
        mockedFlightFindMany.mockResolvedValue(flights);

        const result = await searchFlightsAction('Seattle, USA', 'Detroit, USA', '2026-06-25');

        // Searching is read-only. Inventory is produced ahead of demand by the
        // seed and the scheduler, never by a customer request (#71).
        expect(mockGenerateFlightsForDate).not.toHaveBeenCalled();
        expect(mockedFlightFindMany).toHaveBeenCalledWith({
            where: {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                status: { not: 'CANCELLED' },
                departureDate: {
                    gte: new Date('2026-06-25T00:00:00.000Z'),
                    lte: new Date('2026-06-25T23:59:59.999Z')
                }
            },
            orderBy: { departureDate: 'asc' }
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
            .mockResolvedValueOnce(outbound)
            .mockResolvedValueOnce(inbound);

        const result = await searchFlightsAction(
            'Seattle, USA', 'Detroit, USA', '2026-06-25', '2026-07-02',
        );

        // The inbound is a real search of the reversed route on the return
        // date, not a fixed offset from the outbound (#69).
        expect(mockedFlightFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({
                from: 'Detroit, USA',
                to: 'Seattle, USA',
                departureDate: {
                    gte: new Date('2026-07-02T00:00:00.000Z'),
                    lte: new Date('2026-07-02T23:59:59.999Z'),
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
            .mockResolvedValueOnce(outbound)
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
            { id: 1, priceCents: 35_000, economyRows: 20, businessRows: 3 },
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
            { id: 1, priceCents: 35_000, economyRows: 20, businessRows: 0 },
            { id: 2, priceCents: 40_000, economyRows: 20, businessRows: 3 },
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
            { id: 1, priceCents: 35_000, economyRows: 20, businessRows: 0 },
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
        mockedFlightFindMany.mockResolvedValue([{ id: 1 }]);

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
                    flightNumber: 'CA101',
                    departureDate: new Date('2026-07-15T08:00:00.000Z'),
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
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                status: 'CANCELLED',
                departureDate: {
                    gte: new Date('2026-07-14T00:00:00.000Z'),
                    lte: new Date('2027-07-14T23:59:59.999Z'),
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
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                status: { not: 'CANCELLED' },
                departureDate: {
                    gt: now,
                    lte: new Date('2026-07-14T23:59:59.999Z'),
                },
            },
            orderBy: { departureDate: 'asc' },
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
                daysOfWeek: [2],
            },
            {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '08:00',
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
    beforeEach(() => jest.clearAllMocks());

    it('calls FlightBookingService with flightId and userId from session and creates a notification', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
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
            from: 'A',
            to: 'B'
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
            idempotencyKey: '8ea59a65-9251-45b3-95d0-3920c49f5735'
        }));
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
        mockBookFlight.mockResolvedValue({
            id: 1,
            flightIds: [42],
            userId: 'user-123',
            totalPriceCents: 20000,
            wasCreated: false
        });
        mockedFlightFindUnique.mockResolvedValue({ id: 42, flightNumber: 'GA101' });

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
        mockTx.booking.findUnique.mockResolvedValue({ status: 'CONFIRMED' });
        mockTx.booking.update.mockReset();
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
            flightId: 10,
            legs: [{ sequence: 1, flight: { flightNumber: 'GA101', airline: 'Gemini Airways', priceCents: 20000 } }]
        });
        mockTx.booking.update.mockResolvedValue({ id: 1 });

        const result = await cancelBookingAction(1);

        expect(mockedBookingFindUnique).toHaveBeenCalledWith({
            where: { id: 1 },
            include: {
                legs: {
                    include: { flight: true },
                    orderBy: { sequence: 'asc' },
                },
            }
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

    it('releases the seat on the assignment so it can be booked again', async () => {
        // The assignment's unique index is the only thing holding the seat now
        // that the traveller row no longer carries one (#137), so releasing it
        // there releases it outright.
        mockedGetServerSession.mockResolvedValue({ user: { id: 'u1', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({
            id: 1, userId: 'u1', status: 'CONFIRMED', flightId: 7, legs: [],
        });
        mockTx.booking.findUnique.mockResolvedValue({ id: 1, status: 'CONFIRMED', flightId: 7 });
        mockTx.passenger.findMany.mockResolvedValue([{ id: 'p-9' }]);
        mockTx.booking.update.mockResolvedValue({ id: 1 });

        await cancelBookingAction(1);

        expect(mockTx.seatAssignment.updateMany).toHaveBeenCalledWith({
            where: { passengerId: 'p-9' },
            data: { seatNumber: 'CANCELLED-p-9' }
        });
        // The traveller row holds no seat to release.
        expect(mockTx.passenger.update).not.toHaveBeenCalled();
    });

    it('allows an admin to cancel any booking', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'admin-123', role: 'ADMIN', staffMfaVerified: true } });
        mockedBookingFindUnique.mockResolvedValue({
            id: 1,
            userId: 'some-user',
            totalPriceCents: 20000,
            flightId: 10,
            legs: [{ sequence: 1, flight: { flightNumber: 'GA101', airline: 'Gemini Airways', priceCents: 20000 } }]
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
            from: 'New York',
            to: 'London',
            departureTime: '08:00',
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

        it('allows admin to create a new flight schedule and generates flights', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
            mockedFlightScheduleCreate.mockResolvedValue({
                id: 1,
                ...sampleScheduleInput,
                // The persisted schedule carries the fare the generator copies
                // onto each occurrence.
                priceCents: 85000,
            });
            mockedFlightFindFirst.mockResolvedValue(null); // No existing flight instance
            mockedFlightCreate.mockResolvedValue({});

            const result = await saveFlightScheduleAction(sampleScheduleInput);

            expect(mockedFlightScheduleCreate).toHaveBeenCalledWith({
                data: {
                    ...sampleScheduleInput,
                    price: undefined,
                    // The fare is stored only in minor units now (#135).
                    priceCents: 85000,
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
                    flightNumber: 'AA101',
                    airline: 'American Airlines',
                    from: 'New York',
                    to: 'London',
                    departureDate: new Date('2026-06-29T08:00:00Z'),
                    priceCents: 85000,
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

            const result = await saveFlightScheduleAction(scheduleWithId);

            expect(mockedFlightScheduleUpdate).toHaveBeenCalledWith({
                where: { id: 5 },
                data: {
                    ...sampleScheduleInput,
                    price: undefined,
                    // The fare is stored only in minor units now (#135).
                    priceCents: 85000,
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
    });

    describe('deleteFlightScheduleAction', () => {
        it('rejects unauthenticated user', async () => {
            mockedGetServerSession.mockResolvedValue(null);
            await expect(deleteFlightScheduleAction(12)).rejects.toThrow('Unauthorized');
        });

        it('allows admin to delete schedule', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
            mockedFlightScheduleDelete.mockResolvedValue({});

            await deleteFlightScheduleAction(12);

            expect(mockedFlightScheduleDelete).toHaveBeenCalledWith({
                where: { id: 12 }
            });
        });
    });

    describe('updateFlightStatusAction', () => {
        it('rejects unauthenticated user', async () => {
            mockedGetServerSession.mockResolvedValue(null);
            await expect(updateFlightStatusAction(99, 'DELAYED')).rejects.toThrow('Unauthorized');
        });

        it('allows admin to update status and creates flight update notifications for affected users', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });
            mockedFlightUpdate.mockResolvedValue({
                id: 99,
                airline: 'Gemini Airways',
                flightNumber: 'GA101',
                from: 'Seattle',
                to: 'Detroit',
                status: 'DELAYED'
            });
            mockedBookingFindMany.mockResolvedValue([
                { userId: 'user-1' },
                { userId: 'user-2' },
                { userId: null },
                { userId: 'user-1' }
            ]);

            const result = await updateFlightStatusAction(99, 'DELAYED');

            expect(mockedFlightUpdate).toHaveBeenCalledWith({
                where: { id: 99 },
                data: { status: 'DELAYED' }
            });
            expect(result).toEqual(expect.objectContaining({ id: 99, status: 'DELAYED' }));

            expect(mockedBookingFindMany).toHaveBeenCalledWith({
                where: { legs: { some: { flightId: 99 } }, status: 'CONFIRMED' },
                select: { userId: true }
            });

            expect(mockedNotificationCreateMany).toHaveBeenCalledWith({
                data: [
                    {
                        userId: 'user-1',
                        title: 'Flight Update: Gemini Airways GA101',
                        message: 'Your upcoming flight GA101 from Seattle to Detroit is now DELAYED.',
                        type: 'FLIGHT_STATUS'
                    },
                    {
                        userId: 'user-2',
                        title: 'Flight Update: Gemini Airways GA101',
                        message: 'Your upcoming flight GA101 from Seattle to Detroit is now DELAYED.',
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

            it('generates flight instances and updates existing ones', async () => {
                mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN', staffMfaVerified: true } });

                mockedFlightScheduleFindUnique.mockResolvedValue({
                    id: 1,
                    flightNumber: 'AA101',
                    airline: 'American Airlines',
                    from: 'JFK',
                    to: 'LAX',
                    departureTime: '08:00',
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
                        flightNumber: 'AA101',
                        airline: 'American Airlines',
                        from: 'JFK',
                        to: 'LAX',
                        departureDate: new Date('2026-07-06T08:00:00Z'),
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
                    from: 'JFK',
                    to: 'LAX',
                    departureTime: '08:00',
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
                    from: 'JFK',
                    to: 'LAX',
                    departureTime: '08:00',
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
                    from: 'JFK',
                    to: 'LAX',
                    departureTime: '08:00',
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
                    from: 'JFK',
                    to: 'LAX',
                    departureTime: '08:00',
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
                            where: { leg: { booking: { status: { not: 'CANCELLED' } } } },
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
                    from: 'JFK',
                    to: 'LAX',
                    departureTime: '08:00',
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
