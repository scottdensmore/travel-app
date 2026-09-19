/** @jest-environment node */
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';
import { FlightStatusService } from '@/lib/flightStatusService';

describe('FlightStatusService', () => {
    const flightNumber = `FS-TEST-${Date.now()}`;

    beforeAll(async () => {
        const route = airportCodesForRoute('Seattle, USA', 'Detroit, USA');
        await prisma.flight.create({
            data: {
                flightNumber,
                airline: 'Mona Airways',
                ...route,
                departureDate: new Date('2026-08-10T15:00:00.000Z'),
                durationMinutes: 240,
                priceCents: 30000,
                status: 'ON_TIME',
            },
        });
    });

    afterAll(async () => {
        await prisma.flight.deleteMany({ where: { flightNumber } });
    });

    it('finds flight status by flight number and date', async () => {
        const results = await FlightStatusService.searchFlightStatus({
            mode: 'flightNumber',
            flightNumber,
            date: '2026-08-10',
        }, Date.parse('2026-08-10T12:00:00.000Z'));

        expect(results).toHaveLength(1);
        expect(results[0].flightNumber).toBe(flightNumber);
        expect(results[0].gates.departureGate).toBeDefined();
        expect(results[0].gates.departureTerminal).toBeDefined();
        expect(results[0].phase).toBe('UPCOMING');
        expect(results[0].durationFormatted).toBe('4h 00m');
        expect(results[0].departure.readableDate).toBeDefined();
        expect(results[0].arrival?.readableDate).toBeDefined();
    });

    it('finds flight status by flight number without date within 72-hour window', async () => {
        const results = await FlightStatusService.searchFlightStatus({
            mode: 'flightNumber',
            flightNumber,
        }, Date.parse('2026-08-10T12:00:00.000Z'));

        expect(results.some(r => r.flightNumber === flightNumber)).toBe(true);
    });

    it('matches flight number case-insensitively and ignores whitespace', async () => {
        const results = await FlightStatusService.searchFlightStatus({
            mode: 'flightNumber',
            flightNumber: `  ${flightNumber.toLowerCase()}  `,
            date: '2026-08-10',
        }, Date.parse('2026-08-10T12:00:00.000Z'));

        expect(results).toHaveLength(1);
        expect(results[0].flightNumber).toBe(flightNumber);
    });

    it('finds flight status by route', async () => {
        const results = await FlightStatusService.searchFlightStatus({
            mode: 'route',
            from: 'SEA',
            to: 'DTW',
            date: '2026-08-10',
        }, Date.parse('2026-08-10T12:00:00.000Z'));

        const match = results.find(r => r.flightNumber === flightNumber);
        expect(match).toBeDefined();
        expect(match?.from).toBe('Seattle, USA');
        expect(match?.to).toBe('Detroit, USA');
    });

    it('derives boarding phase within 45-minute window', async () => {
        // departure is 15:00:00Z. 30 minutes prior is 14:30:00Z.
        const results = await FlightStatusService.searchFlightStatus({
            mode: 'flightNumber',
            flightNumber,
            date: '2026-08-10',
        }, Date.parse('2026-08-10T14:30:00.000Z'));

        expect(results).toHaveLength(1);
        expect(results[0].phase).toBe('BOARDING');
    });
});
