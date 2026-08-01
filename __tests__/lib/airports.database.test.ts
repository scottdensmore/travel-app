/** @jest-environment node */
import AirportData from '@/lib/data/AirportData';
import { findAirportTimeZone } from '@/lib/airports';
import { prisma } from '@/lib/prisma';

describe('airport lookup in PostgreSQL', () => {
    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('resolves the timezone for every seeded route origin', async () => {
        for (const { label, timeZone } of AirportData) {
            await expect(findAirportTimeZone(label)).resolves.toBe(timeZone);
        }
    });

    it('returns null for a place with no airport record', async () => {
        // Callers fall back to UTC rather than failing a customer search.
        await expect(findAirportTimeZone('Atlantis, Nowhere')).resolves.toBeNull();
    });
});
