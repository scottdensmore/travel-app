/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
    prisma: {
        booking: { findFirst: jest.fn() },
        flight: { findMany: jest.fn() },
        $queryRaw: jest.fn(),
    },
}));
jest.mock('@/lib/airports', () => ({ airportTimeZoneFor: jest.fn(() => 'UTC') }));
jest.mock('@/lib/dates', () => ({ addDaysToIsoDate: jest.fn((date: string) => date) }));
jest.mock('@/lib/flightRoute', () => ({
    flightRouteInclude: {
        fromAirport: { select: { label: true } },
        toAirport: { select: { label: true } },
    },
    withRouteLabels: jest.fn(flight => ({ ...flight, from: 'Seattle, USA', to: 'Detroit, USA' })),
}));
jest.mock('@/lib/flightTime', () => ({
    airportDayBounds: jest.fn(() => ({
        start: new Date('2099-06-12T00:00:00Z'),
        end: new Date('2099-06-19T00:00:00Z'),
    })),
    flightDeparture: jest.fn(() => ({ date: '2099-06-15' })),
}));
jest.mock('@/lib/seatOccupancy', () => ({ heldSeats: jest.fn(() => ({ releasedAt: null })) }));

import { ItineraryReplacementSearch } from '@/lib/itineraryReplacementSearch';
import { prisma } from '@/lib/prisma';

const bookingFindFirst = prisma.booking.findFirst as unknown as jest.Mock;
const flightFindMany = prisma.flight.findMany as unknown as jest.Mock;
const queryRaw = prisma.$queryRaw as unknown as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    bookingFindFirst.mockResolvedValue({
        passengers: [{ id: 'passenger-1' }],
        legs: [{
            id: 11,
            flight: {
                id: 21,
                flightNumber: 'MA100',
                departureDate: new Date('2099-06-15T20:00:00Z'),
                fromAirportCode: 'SEA',
                toAirportCode: 'DTW',
            },
            seatAssignments: [{ cabinClass: 'ECONOMY' }],
        }],
    });
    queryRaw.mockResolvedValue([{ now: new Date('2099-01-01T00:00:00Z') }]);
    flightFindMany.mockResolvedValue([]);
});

describe('ItineraryReplacementSearch query contract', () => {
    it('requests replacement candidates in chronological order', async () => {
        await new ItineraryReplacementSearch().forBooking({
            bookingId: 7,
            userId: 'traveller-1',
        });

        expect(flightFindMany).toHaveBeenCalledWith(expect.objectContaining({
            orderBy: { departureDate: 'asc' },
        }));
    });

    it('requests cancelled booking legs in itinerary sequence order', async () => {
        await new ItineraryReplacementSearch().forBooking({
            bookingId: 7,
            userId: 'traveller-1',
        });

        expect(bookingFindFirst).toHaveBeenCalledWith(expect.objectContaining({
            select: expect.objectContaining({
                legs: expect.objectContaining({ orderBy: { sequence: 'asc' } }),
            }),
        }));
    });

    it('excludes the original flight even if its status changes during the search', async () => {
        await new ItineraryReplacementSearch().forBooking({
            bookingId: 7,
            userId: 'traveller-1',
        });

        expect(flightFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: { not: 21 } }),
        }));
    });

    it('projects only the fields the browser replacement preview consumes', async () => {
        const departureDate = new Date('2099-06-16T20:00:00Z');
        flightFindMany.mockResolvedValue([{
            id: 22,
            flightNumber: 'MA101',
            airline: 'Mona Airways',
            departureDate,
            durationMinutes: 240,
            status: 'ON_TIME',
            firstClassRows: 1,
            businessRows: 2,
            premiumEconomyRows: 3,
            economyRows: 20,
            seatPattern: 'ABC_DEF',
            fromAirportCode: 'SEA',
            toAirportCode: 'DTW',
            priceCents: 999_999,
            createdAt: new Date('2099-01-01T00:00:00Z'),
            updatedAt: new Date('2099-01-01T00:00:00Z'),
            fromAirport: { label: 'Seattle, USA' },
            toAirport: { label: 'Detroit, USA' },
        }]);

        const [group] = await new ItineraryReplacementSearch().forBooking({
            bookingId: 7,
            userId: 'traveller-1',
        });

        expect(flightFindMany).toHaveBeenCalledWith(expect.objectContaining({
            select: {
                id: true,
                flightNumber: true,
                airline: true,
                departureDate: true,
                durationMinutes: true,
                status: true,
                firstClassRows: true,
                businessRows: true,
                premiumEconomyRows: true,
                economyRows: true,
                seatPattern: true,
                fromAirport: { select: { label: true } },
                toAirport: { select: { label: true } },
            },
        }));
        expect(group.flights).toEqual([{
            id: 22,
            flightNumber: 'MA101',
            airline: 'Mona Airways',
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            departureDate,
            durationMinutes: 240,
            status: 'ON_TIME',
            firstClassRows: 1,
            businessRows: 2,
            premiumEconomyRows: 3,
            economyRows: 20,
            seatPattern: 'ABC_DEF',
        }]);
    });
});
