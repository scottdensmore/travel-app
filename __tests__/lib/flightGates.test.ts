import { getEffectiveFlightGates } from '@/lib/flightGates';

describe('getEffectiveFlightGates', () => {
    it('returns explicit gate and terminal assignments when provided', () => {
        const result = getEffectiveFlightGates({
            flightNumber: 'MA101',
            fromAirportCode: 'SEA',
            toAirportCode: 'DTW',
            departureTerminal: 'Main',
            departureGate: 'B12',
            arrivalTerminal: 'Evans',
            arrivalGate: 'D5',
        });

        expect(result).toEqual({
            departureTerminal: 'Main',
            departureGate: 'B12',
            arrivalTerminal: 'Evans',
            arrivalGate: 'D5',
        });
    });

    it('deterministically derives realistic fallback terminals and gates when null', () => {
        const first = getEffectiveFlightGates({
            flightNumber: 'MA202',
            fromAirportCode: 'SEA',
            toAirportCode: 'DTW',
        });

        const second = getEffectiveFlightGates({
            flightNumber: 'MA202',
            fromAirportCode: 'SEA',
            toAirportCode: 'DTW',
        });

        expect(first).toEqual(second);
        expect(first.departureTerminal).toBeDefined();
        expect(first.departureGate).toBeDefined();
        expect(first.arrivalTerminal).toBeDefined();
        expect(first.arrivalGate).toBeDefined();

        // SEA terminal should be Main
        expect(first.departureTerminal).toBe('Main');
        // DTW terminals are McNamara or Evans
        expect(['McNamara', 'Evans']).toContain(first.arrivalTerminal);
    });

    it('handles partial explicit assignments and trims whitespace', () => {
        const result = getEffectiveFlightGates({
            flightNumber: 'MA303',
            fromAirportCode: 'JFK',
            toAirportCode: 'LHR',
            departureTerminal: '  Terminal 4  ',
            departureGate: null,
            arrivalTerminal: undefined,
            arrivalGate: '   ',
        });

        expect(result.departureTerminal).toBe('Terminal 4');
        expect(result.departureGate).toMatch(/^[A-C]\d+$/);
        expect(['Terminal 2', 'Terminal 3', 'Terminal 5']).toContain(result.arrivalTerminal);
        expect(result.arrivalGate).toMatch(/^[A-C]\d+$/);
    });

    it('uses fallback configuration for unknown airport codes', () => {
        const result = getEffectiveFlightGates({
            flightNumber: 'MA404',
            fromAirportCode: 'XYZ',
            toAirportCode: 'ZZZ',
        });

        expect(['Terminal 1', 'Terminal 2']).toContain(result.departureTerminal);
        expect(result.departureGate).toMatch(/^[A-C]\d+$/);
        expect(['Terminal 1', 'Terminal 2']).toContain(result.arrivalTerminal);
        expect(result.arrivalGate).toMatch(/^[A-C]\d+$/);
    });

    it('is case-insensitive for airport codes', () => {
        const uppercaseResult = getEffectiveFlightGates({
            flightNumber: 'MA505',
            fromAirportCode: 'SEA',
            toAirportCode: 'DTW',
        });

        const lowercaseResult = getEffectiveFlightGates({
            flightNumber: 'MA505',
            fromAirportCode: 'sea',
            toAirportCode: 'dtw',
        });

        expect(lowercaseResult.departureTerminal).toBe(uppercaseResult.departureTerminal);
        expect(lowercaseResult.arrivalTerminal).toBe(uppercaseResult.arrivalTerminal);
    });
});
