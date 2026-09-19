/** @jest-environment node */
import { flightPhaseAt } from '@/lib/flightPhase';

const renderedAt = Date.parse('2026-08-17T12:00:00.000Z');

const flight = (
    departureDate: string,
    durationMinutes: number | null = 60,
    status: 'ON_TIME' | 'DELAYED' | 'CANCELLED' = 'ON_TIME',
) => ({ departureDate, durationMinutes, status });

describe('scheduled flight phase', () => {
    it('moves from boarding to departed at the departure instant', () => {
        expect(flightPhaseAt(
            flight('2026-08-17T12:00:00.001Z'),
            renderedAt,
        )).toBe('BOARDING');
        expect(flightPhaseAt(
            flight('2026-08-17T12:00:00.000Z'),
            renderedAt,
        )).toBe('DEPARTED');
    });

    it('moves from upcoming to boarding 45 minutes before departure', () => {
        expect(flightPhaseAt(
            flight('2026-08-17T12:45:00.001Z'),
            renderedAt,
        )).toBe('UPCOMING');
        expect(flightPhaseAt(
            flight('2026-08-17T12:45:00.000Z'),
            renderedAt,
        )).toBe('BOARDING');
    });

    it('derives BOARDING phase when within 45 minutes of scheduled departure', () => {
        const now = Date.now();
        const flightData = {
            departureDate: new Date(now + 20 * 60_000), // 20 minutes from now
            durationMinutes: 120,
            status: 'ON_TIME' as const,
        };
        expect(flightPhaseAt(flightData, now)).toBe('BOARDING');
    });

    it('derives BOARDING phase for delayed flight with estimated departure in 20 minutes', () => {
        const now = Date.now();
        const flightData = {
            departureDate: new Date(now - 10 * 60_000),
            estimatedDeparture: new Date(now + 20 * 60_000),
            durationMinutes: 120,
            status: 'DELAYED' as const,
        };
        expect(flightPhaseAt(flightData, now)).toBe('BOARDING');
    });

    it('keeps DELAYED phase for delayed flight with estimated departure outside boarding window', () => {
        const now = Date.now();
        const flightData = {
            departureDate: new Date(now - 10 * 60_000),
            estimatedDeparture: new Date(now + 60 * 60_000), // 60 minutes from now
            durationMinutes: 120,
            status: 'DELAYED' as const,
        };
        expect(flightPhaseAt(flightData, now)).toBe('DELAYED');
    });

    it('derives DEPARTED phase for delayed flight past estimated departure', () => {
        const now = Date.now();
        const flightData = {
            departureDate: new Date(now - 120 * 60_000),
            estimatedDeparture: new Date(now - 10 * 60_000), // departed 10m ago
            durationMinutes: 120,
            status: 'DELAYED' as const,
        };
        expect(flightPhaseAt(flightData, now)).toBe('DEPARTED');
    });

    it('moves from departed to arrived at the derived arrival instant', () => {
        expect(flightPhaseAt(
            flight('2026-08-17T11:00:00.001Z'),
            renderedAt,
        )).toBe('DEPARTED');
        expect(flightPhaseAt(
            flight('2026-08-17T11:00:00.000Z'),
            renderedAt,
        )).toBe('ARRIVED');
    });

    it('never invents an arrival without a stated duration', () => {
        expect(flightPhaseAt(
            flight('2026-08-17T10:00:00.000Z', null),
            renderedAt,
        )).toBe('DEPARTED');
    });

    it('keeps airline-set disruption states instead of overwriting them with the clock', () => {
        expect(flightPhaseAt(
            flight('2026-08-17T10:00:00.000Z', 60, 'DELAYED'),
            renderedAt,
        )).toBe('DELAYED');
        expect(flightPhaseAt(
            flight('2026-08-17T13:00:00.000Z', 60, 'DELAYED'),
            renderedAt,
        )).toBe('DELAYED');
        expect(flightPhaseAt(
            flight('2026-08-17T13:00:00.000Z', 60, 'CANCELLED'),
            renderedAt,
        )).toBe('CANCELLED');
        expect(flightPhaseAt(
            flight('2026-08-17T10:00:00.000Z', 60, 'CANCELLED'),
            renderedAt,
        )).toBe('CANCELLED');
    });

    it('honors actualArrival immediately regardless of clock or status', () => {
        const flightData = {
            departureDate: new Date(renderedAt + 60 * 60_000),
            durationMinutes: 120,
            status: 'ON_TIME' as const,
            actualArrival: new Date(renderedAt - 5 * 60_000),
        };
        expect(flightPhaseAt(flightData, renderedAt)).toBe('ARRIVED');
    });

    it('honors actualDeparture: returns DEPARTED until durationMinutes elapses, then ARRIVED', () => {
        const flightData = {
            departureDate: '2026-08-17T14:00:00.000Z',
            actualDeparture: '2026-08-17T11:00:00.000Z',
            durationMinutes: 60,
            status: 'ON_TIME' as const,
        };
        // renderedAt is 12:00:00.000Z, which is exactly actualDeparture (11:00) + 60min
        expect(flightPhaseAt(flightData, renderedAt)).toBe('ARRIVED');

        // renderedAt 11:30:00.000Z is before actualDeparture + 60min
        expect(flightPhaseAt(flightData, Date.parse('2026-08-17T11:30:00.000Z'))).toBe('DEPARTED');
    });

    it('returns DEPARTED when actualDeparture is present but durationMinutes is null', () => {
        const flightData = {
            departureDate: '2026-08-17T14:00:00.000Z',
            actualDeparture: '2026-08-17T10:00:00.000Z',
            durationMinutes: null,
            status: 'ON_TIME' as const,
        };
        expect(flightPhaseAt(flightData, renderedAt)).toBe('DEPARTED');
    });
});
