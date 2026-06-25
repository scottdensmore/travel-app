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
    updateFlightStatusAction
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

// The service mock shares a single saveCityGuide fn across all instances,
// so the instance created inside app/actions.ts uses the same spy we assert on.
jest.mock('@/lib/TravelGuideService', () => {
    const saveCityGuide = jest.fn();
    return jest.fn().mockImplementation(() => ({ saveCityGuide }));
});

jest.mock('@/lib/prisma', () => ({
    prisma: {
        cityGuide: { create: jest.fn(), delete: jest.fn() },
        flight: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        flightSchedule: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        userFavorite: { findUnique: jest.fn(), delete: jest.fn(), create: jest.fn() },
        review: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
        booking: { findUnique: jest.fn(), delete: jest.fn() },
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
const mockedFlightScheduleFindMany = (prisma as any).flightSchedule.findMany as jest.Mock;
const mockedFlightScheduleCreate = (prisma as any).flightSchedule.create as jest.Mock;
const mockedFlightScheduleUpdate = (prisma as any).flightSchedule.update as jest.Mock;
const mockedFlightScheduleDelete = (prisma as any).flightSchedule.delete as jest.Mock;
const mockedCityGuideDelete = (prisma as any).cityGuide.delete as jest.Mock;
const mockedUserFavoriteFindUnique = (prisma as any).userFavorite.findUnique as jest.Mock;
const mockedUserFavoriteDelete = (prisma as any).userFavorite.delete as jest.Mock;
const mockedUserFavoriteCreate = (prisma as any).userFavorite.create as jest.Mock;
const mockedReviewCreate = (prisma as any).review.create as jest.Mock;
const mockedReviewFindUnique = (prisma as any).review.findUnique as jest.Mock;
const mockedReviewDelete = (prisma as any).review.delete as jest.Mock;
const mockedBookingFindUnique = (prisma as any).booking.findUnique as jest.Mock;
const mockedBookingDelete = (prisma as any).booking.delete as jest.Mock;

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

    it('allows an admin user and saves the guide', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN' } });
        mockSaveCityGuide.mockResolvedValue({ ...sampleGuide, id: 1 });

        const result = await saveCityGuideAction(sampleGuide);

        expect(mockSaveCityGuide).toHaveBeenCalledWith(sampleGuide);
        expect(result).toHaveProperty('id', 1);
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
        mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN' } });
        mockedCityGuideDelete.mockResolvedValue({});

        await deleteCityGuideAction(1);

        expect(mockedCityGuideDelete).toHaveBeenCalledWith({
            where: { id: 1 }
        });
    });
});

describe('searchFlightsAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('filters flights by the selected origin and destination without date', async () => {
        const flights = [
            { id: 1, flightNumber: 'CA101', from: 'Seattle, USA', to: 'Detroit, USA' },
        ];
        mockedFlightFindMany.mockResolvedValue(flights);

        const result = await searchFlightsAction('Seattle, USA', 'Detroit, USA');

        expect(mockedFlightFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { from: 'Seattle, USA', to: 'Detroit, USA' } })
        );
        expect(result).toBe(flights);
    });

    it('triggers lazy generation and queries by date when departureDateStr is provided', async () => {
        const flights = [
            { id: 1, flightNumber: 'CA101', from: 'Seattle, USA', to: 'Detroit, USA', departureDate: new Date('2026-06-25T08:00:00Z') },
        ];
        mockedFlightFindMany.mockResolvedValue(flights);
        mockGenerateFlightsForDate.mockResolvedValue([]);

        const result = await searchFlightsAction('Seattle, USA', 'Detroit, USA', '2026-06-25');

        expect(mockGenerateFlightsForDate).toHaveBeenCalledWith(new Date('2026-06-25'));
        expect(mockedFlightFindMany).toHaveBeenCalledWith({
            where: {
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureDate: {
                    gte: new Date('2026-06-25T00:00:00.000Z'),
                    lte: new Date('2026-06-25T23:59:59.999Z')
                }
            },
            orderBy: { departureDate: 'asc' }
        });
        expect(result).toBe(flights);
    });
});

describe('getFlightRoutesAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns the distinct origin/destination pairs from schedules', async () => {
        const routes = [
            { from: 'Chicago, USA', to: 'Paris, France' },
            { from: 'Seattle, USA', to: 'Detroit, USA' },
        ];
        mockedFlightScheduleFindMany.mockResolvedValue(routes);

        const result = await getFlightRoutesAction();

        expect(result).toBe(routes);
        expect(mockedFlightScheduleFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ distinct: ['from', 'to'], select: { from: true, to: true } })
        );
    });
});

describe('bookFlightAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('calls FlightBookingService with flightId and userId from session', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123' } });
        mockBookFlight.mockResolvedValue({ id: 1, flightId: 42, userId: 'user-123' });

        const result = await bookFlightAction({ flightId: 42 });

        expect(mockBookFlight).toHaveBeenCalledWith({ flightId: 42, userId: 'user-123' });
        expect(result).toEqual({ id: 1, flightId: 42, userId: 'user-123' });
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
});

describe('cancelBookingAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rejects an unauthenticated user', async () => {
        mockedGetServerSession.mockResolvedValue(null);
        await expect(cancelBookingAction(1)).rejects.toThrow('Unauthorized');
    });

    it('rejects a user trying to cancel another user\'s booking', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({ id: 1, userId: 'other-user' });

        await expect(cancelBookingAction(1)).rejects.toThrow('Unauthorized');
        expect(mockedBookingDelete).not.toHaveBeenCalled();
    });

    it('allows a user to cancel their own booking', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'user-123', role: 'USER' } });
        mockedBookingFindUnique.mockResolvedValue({ id: 1, userId: 'user-123' });
        mockedBookingDelete.mockResolvedValue({ id: 1 });

        const result = await cancelBookingAction(1);

        expect(mockedBookingFindUnique).toHaveBeenCalledWith({ where: { id: 1 } });
        expect(mockedBookingDelete).toHaveBeenCalledWith({ where: { id: 1 } });
        expect(result).toEqual({ id: 1 });
    });

    it('allows an admin to cancel any booking', async () => {
        mockedGetServerSession.mockResolvedValue({ user: { id: 'admin-123', role: 'ADMIN' } });
        mockedBookingFindUnique.mockResolvedValue({ id: 1, userId: 'some-user' });
        mockedBookingDelete.mockResolvedValue({ id: 1 });

        const result = await cancelBookingAction(1);

        expect(mockedBookingDelete).toHaveBeenCalledWith({ where: { id: 1 } });
        expect(result).toEqual({ id: 1 });
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
        mockedGetServerSession.mockResolvedValue({ user: { id: 'admin-123', role: 'ADMIN' } });
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
            returnTime: null,
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

        it('allows admin to create a new flight schedule and generates flights', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN' } });
            mockedFlightScheduleCreate.mockResolvedValue({
                id: 1,
                ...sampleScheduleInput,
            });
            mockedFlightFindFirst.mockResolvedValue(null); // No existing flight instance
            mockedFlightCreate.mockResolvedValue({});

            const result = await saveFlightScheduleAction(sampleScheduleInput);

            expect(mockedFlightScheduleCreate).toHaveBeenCalledWith({
                data: sampleScheduleInput,
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
                    returnDate: null,
                    price: '$850',
                    status: 'ON_TIME',
                }
            });
            expect(result).toHaveProperty('id', 1);
        });

        it('allows admin to update an existing flight schedule', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN' } });
            const scheduleWithId = { id: 5, ...sampleScheduleInput };
            mockedFlightScheduleUpdate.mockResolvedValue(scheduleWithId);
            mockedFlightFindFirst.mockResolvedValue({}); // existing instances, skips creating new ones

            const result = await saveFlightScheduleAction(scheduleWithId);

            expect(mockedFlightScheduleUpdate).toHaveBeenCalledWith({
                where: { id: 5 },
                data: sampleScheduleInput,
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
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN' } });
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

        it('allows admin to update status', async () => {
            mockedGetServerSession.mockResolvedValue({ user: { role: 'ADMIN' } });
            mockedFlightUpdate.mockResolvedValue({ id: 99, status: 'DELAYED' });

            const result = await updateFlightStatusAction(99, 'DELAYED');

            expect(mockedFlightUpdate).toHaveBeenCalledWith({
                where: { id: 99 },
                data: { status: 'DELAYED' }
            });
            expect(result).toEqual({ id: 99, status: 'DELAYED' });
        });
    });
});


