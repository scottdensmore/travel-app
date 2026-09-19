/** @jest-environment node */
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';

describe('Flight operational fields', () => {
    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('persists and retrieves operational gate, terminal, and delay attributes', async () => {
        const route = airportCodesForRoute('Seattle, USA', 'Detroit, USA');
        const flight = await prisma.flight.create({
            data: {
                flightNumber: `TEST-OP-${Date.now()}`,
                airline: 'Mona Airways',
                ...route,
                departureDate: new Date('2026-08-01T14:00:00.000Z'),
                durationMinutes: 240,
                priceCents: 25000,
                status: 'DELAYED',
                departureTerminal: '1',
                departureGate: 'A8',
                arrivalTerminal: 'Evans',
                arrivalGate: 'D14',
                delayReason: 'Air Traffic Control hold at origin',
                estimatedDeparture: new Date('2026-08-01T14:45:00.000Z'),
                actualDeparture: new Date('2026-08-01T14:50:00.000Z'),
                estimatedArrival: new Date('2026-08-01T18:45:00.000Z'),
                actualArrival: new Date('2026-08-01T18:55:00.000Z'),
            },
        });

        try {
            const fetched = await prisma.flight.findUnique({
                where: { id: flight.id },
            });

            expect(fetched?.departureGate).toBe('A8');
            expect(fetched?.departureTerminal).toBe('1');
            expect(fetched?.arrivalGate).toBe('D14');
            expect(fetched?.arrivalTerminal).toBe('Evans');
            expect(fetched?.delayReason).toBe('Air Traffic Control hold at origin');
            expect(fetched?.estimatedDeparture?.toISOString()).toBe('2026-08-01T14:45:00.000Z');
            expect(fetched?.actualDeparture?.toISOString()).toBe('2026-08-01T14:50:00.000Z');
            expect(fetched?.estimatedArrival?.toISOString()).toBe('2026-08-01T18:45:00.000Z');
            expect(fetched?.actualArrival?.toISOString()).toBe('2026-08-01T18:55:00.000Z');
        } finally {
            await prisma.flight.delete({ where: { id: flight.id } });
        }
    });
});
