/** @jest-environment node */

// The shared singleton — the service should route ALL queries through this.
jest.mock('@/lib/prisma', () => ({
    prisma: { cityGuide: { findMany: jest.fn(), create: jest.fn() } },
}));

// Guard: if the service still instantiates its own client, this stub keeps the
// test from opening a real DB connection — and its calls won't be observed on
// the shared singleton mock above, so the assertions below will fail (red).
jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn().mockImplementation(() => ({
        cityGuide: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({}),
        },
    })),
}));

import TravelGuideService from '@/lib/TravelGuideService';
import { prisma } from '@/lib/prisma';

const mockedPrisma = prisma as unknown as {
    cityGuide: { findMany: jest.Mock; create: jest.Mock };
};

const sampleRow = {
    id: 1,
    city: 'Paris',
    country: 'France',
    latlong: [48.85, 2.35],
    description: 'City of light',
    highlights: ['Eiffel Tower'],
    coverImage: null,
};

describe('TravelGuideService', () => {
    beforeEach(() => jest.clearAllMocks());

    it('reads city guides through the shared prisma singleton', async () => {
        mockedPrisma.cityGuide.findMany.mockResolvedValue([sampleRow]);

        const data = await new TravelGuideService().getCityGuideData();

        expect(mockedPrisma.cityGuide.findMany).toHaveBeenCalledTimes(1);
        expect(data[0].latlong).toEqual([48.85, 2.35]);
    });

    it('saves city guides through the shared prisma singleton', async () => {
        mockedPrisma.cityGuide.create.mockResolvedValue({ ...sampleRow, id: 2 });

        const saved = await new TravelGuideService().saveCityGuide(sampleRow as any);

        expect(mockedPrisma.cityGuide.create).toHaveBeenCalledTimes(1);
        expect(saved).toMatchObject({ id: 2, city: 'Paris' });
    });
});
