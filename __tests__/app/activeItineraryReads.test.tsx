/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
    prisma: {
        booking: { count: jest.fn(), findMany: jest.fn() },
        cityGuide: { count: jest.fn() },
        flight: { findMany: jest.fn() },
        flightSchedule: { findMany: jest.fn() },
        paymentAttempt: { findMany: jest.fn() },
        review: { findMany: jest.fn() },
        user: { count: jest.fn() },
        userFavorite: { findMany: jest.fn() },
    },
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/serverClock', () => ({ serverRenderTime: jest.fn() }));
jest.mock('@/lib/itineraryReplacementSearch', () => ({
    ItineraryReplacementSearch: jest.fn().mockImplementation(() => ({
        forBooking: mockReplacementForBooking,
    })),
}));

const mockReplacementForBooking = jest.fn();

import { getServerSession } from 'next-auth';
import AdminFlightsPage from '@/app/admin/flights/page';
import AdminDashboard from '@/app/admin/page';
import ProfilePage from '@/app/profile/page';
import { prisma } from '@/lib/prisma';
import { serverRenderTime } from '@/lib/serverClock';

const bookingCount = prisma.booking.count as unknown as jest.Mock;
const bookingFindMany = prisma.booking.findMany as unknown as jest.Mock;
const cityGuideCount = prisma.cityGuide.count as unknown as jest.Mock;
const flightFindMany = prisma.flight.findMany as unknown as jest.Mock;
const scheduleFindMany = prisma.flightSchedule.findMany as unknown as jest.Mock;
const reviewFindMany = prisma.review.findMany as unknown as jest.Mock;
const userCount = prisma.user.count as unknown as jest.Mock;
const userFavoriteFindMany = prisma.userFavorite.findMany as unknown as jest.Mock;
const mockedGetServerSession = getServerSession as unknown as jest.Mock;
const mockedServerRenderTime = serverRenderTime as unknown as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    bookingCount.mockResolvedValue(0);
    bookingFindMany.mockResolvedValue([]);
    cityGuideCount.mockResolvedValue(0);
    flightFindMany.mockResolvedValue([]);
    scheduleFindMany.mockResolvedValue([]);
    reviewFindMany.mockResolvedValue([]);
    userCount.mockResolvedValue(0);
    userFavoriteFindMany.mockResolvedValue([]);
    mockedGetServerSession.mockResolvedValue({ user: { id: 'traveller-1' } });
    mockedServerRenderTime.mockResolvedValue(Date.now());
    mockReplacementForBooking.mockResolvedValue([]);
});

describe('active itinerary page reads', () => {
    it('loads only active legs for the customer profile', async () => {
        await ProfilePage();

        expect(bookingFindMany.mock.calls[0][0].include.legs.where)
            .toEqual({ supersededAt: null });
    });

    it('loads replacement options only for the customer\'s disrupted bookings', async () => {
        const disruptedBooking = {
            id: 42,
            userId: 'traveller-1',
            status: 'DISRUPTED',
            createdAt: new Date('2099-01-01T00:00:00Z'),
            totalPriceCents: 42000,
            currency: 'USD',
            paymentIntentId: null,
            idempotencyKey: null,
            passengers: [],
            legs: [],
            statusChanges: [],
        };
        const confirmedBooking = { ...disruptedBooking, id: 43, status: 'CONFIRMED' };
        const groups = [{
            fromLegId: 7,
            originalFlightNumber: 'MA100',
            originalDepartureDate: new Date('2099-01-02T12:00:00Z'),
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            flights: [],
        }];
        bookingFindMany.mockResolvedValue([disruptedBooking, confirmedBooking]);
        mockReplacementForBooking.mockResolvedValue(groups);

        const page = await ProfilePage();

        expect(mockReplacementForBooking).toHaveBeenCalledTimes(1);
        expect(mockReplacementForBooking).toHaveBeenCalledWith({
            bookingId: 42,
            userId: 'traveller-1',
        });
        expect(page.props.replacementOptions).toEqual({ 42: groups });
    });

    it('loads only active legs for recent bookings on the admin dashboard', async () => {
        await AdminDashboard();

        expect(bookingFindMany.mock.calls[0][0].include.legs.where)
            .toEqual({ supersededAt: null });
    });

    it('loads only active booking legs for the admin flight manifest', async () => {
        await AdminFlightsPage();

        expect(flightFindMany.mock.calls[0][0].include.itineraryLegs.where)
            .toEqual({ supersededAt: null });
    });

    it('loads the next seven days as one rolling instant window', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-08-16T23:30:00.000Z'));
        try {
            await AdminFlightsPage();

            expect(flightFindMany.mock.calls[0][0].where.departureDate).toEqual({
                gte: new Date('2026-08-16T23:30:00.000Z'),
                lt: new Date('2026-08-23T23:30:00.000Z'),
            });
        } finally {
            jest.useRealTimers();
        }
    });
});
