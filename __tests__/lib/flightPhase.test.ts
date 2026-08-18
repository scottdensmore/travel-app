/** @jest-environment node */
import { flightPhaseAt } from '@/lib/flightPhase';

const renderedAt = Date.parse('2026-08-17T12:00:00.000Z');

const flight = (
    departureDate: string,
    durationMinutes: number | null = 60,
    status: 'ON_TIME' | 'DELAYED' | 'CANCELLED' = 'ON_TIME',
) => ({ departureDate, durationMinutes, status });

describe('scheduled flight phase', () => {
    it('moves from upcoming to departed at the departure instant', () => {
        expect(flightPhaseAt(
            flight('2026-08-17T12:00:00.001Z'),
            renderedAt,
        )).toBe('UPCOMING');
        expect(flightPhaseAt(
            flight('2026-08-17T12:00:00.000Z'),
            renderedAt,
        )).toBe('DEPARTED');
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
});
