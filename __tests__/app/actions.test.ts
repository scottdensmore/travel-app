import { saveCityGuideAction, searchFlightsAction, getFlightRoutesAction } from '@/app/actions';
import { getServerSession } from 'next-auth';
import TravelGuideService from '@/lib/TravelGuideService';
import { prisma } from '@/lib/prisma';

// Keep these heavy/server-only modules out of the unit test.
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/FlightBookingService', () =>
    jest.fn().mockImplementation(() => ({ bookFlight: jest.fn() }))
);

// The service mock shares a single saveCityGuide fn across all instances,
// so the instance created inside app/actions.ts uses the same spy we assert on.
jest.mock('@/lib/TravelGuideService', () => {
    const saveCityGuide = jest.fn();
    return jest.fn().mockImplementation(() => ({ saveCityGuide }));
});

jest.mock('@/lib/prisma', () => ({
    prisma: {
        cityGuide: { create: jest.fn(), delete: jest.fn() },
        flight: { findMany: jest.fn() },
    },
}));

const mockedGetServerSession = getServerSession as unknown as jest.Mock;
const mockSaveCityGuide = new (TravelGuideService as any)().saveCityGuide as jest.Mock;
const mockedFlightFindMany = (prisma as any).flight.findMany as jest.Mock;

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

describe('searchFlightsAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('filters flights by the selected origin and destination', async () => {
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
});

describe('getFlightRoutesAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns the distinct origin/destination pairs that have flights', async () => {
        const routes = [
            { from: 'Chicago, USA', to: 'Paris, France' },
            { from: 'Seattle, USA', to: 'Detroit, USA' },
        ];
        mockedFlightFindMany.mockResolvedValue(routes);

        const result = await getFlightRoutesAction();

        expect(result).toBe(routes);
        expect(mockedFlightFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ distinct: ['from', 'to'], select: { from: true, to: true } })
        );
    });
});
