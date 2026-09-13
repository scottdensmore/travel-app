/** @jest-environment node */
import {
    flightRouteInclude,
    flightRouteWhere,
    resolveFlightRouteWhere,
    withLegRouteLabels,
    withRouteLabels,
} from '@/lib/flightRoute';

describe('resolveFlightRouteWhere', () => {
    it('resolves airport codes from the client query when both airports match', async () => {
        const mockClient = {
            airport: {
                findMany: jest.fn().mockResolvedValue([
                    { label: 'Custom Origin', iataCode: 'CUS' },
                    { label: 'Custom Dest', iataCode: 'DST' },
                ]),
            },
        };

        const result = await resolveFlightRouteWhere('Custom Origin', 'Custom Dest', mockClient as any);

        expect(mockClient.airport.findMany).toHaveBeenCalledWith({
            where: { label: { in: ['Custom Origin', 'Custom Dest'] } },
            select: { label: true, iataCode: true },
        });
        expect(result).toEqual({ fromAirportCode: 'CUS', toAirportCode: 'DST' });
    });

    it('resolves correctly when from and to are the same airport', async () => {
        const mockClient = {
            airport: {
                findMany: jest.fn().mockResolvedValue([
                    { label: 'Loop City', iataCode: 'LPC' },
                ]),
            },
        };

        const result = await resolveFlightRouteWhere('Loop City', 'Loop City', mockClient as any);

        expect(result).toEqual({ fromAirportCode: 'LPC', toAirportCode: 'LPC' });
    });

    it('falls back to static flightRouteWhere when an airport is not found in database', async () => {
        const mockClient = {
            airport: {
                findMany: jest.fn().mockResolvedValue([
                    { label: 'Seattle, USA', iataCode: 'SEA' },
                    // Detroit not returned in database response
                ]),
            },
        };

        // Static lookup knows Seattle and Detroit
        const result = await resolveFlightRouteWhere('Seattle, USA', 'Detroit, USA', mockClient as any);

        expect(result).toEqual({ fromAirportCode: 'SEA', toAirportCode: 'DTW' });
    });

    it('falls back to static flightRouteWhere when client query throws an error', async () => {
        const mockClient = {
            airport: {
                findMany: jest.fn().mockRejectedValue(new Error('DB connection refused')),
            },
        };

        const result = await resolveFlightRouteWhere('Seattle, USA', 'Detroit, USA', mockClient as any);

        expect(result).toEqual({ fromAirportCode: 'SEA', toAirportCode: 'DTW' });
    });

    it('falls back to static flightRouteWhere when client airport is undefined or malformed', async () => {
        const mockClient = {} as any;

        const result = await resolveFlightRouteWhere('Seattle, USA', 'Detroit, USA', mockClient);

        expect(result).toEqual({ fromAirportCode: 'SEA', toAirportCode: 'DTW' });
    });

    it('returns null when neither client query nor static lookup recognizes the airports', async () => {
        const mockClient = {
            airport: {
                findMany: jest.fn().mockResolvedValue([]),
            },
        };

        const result = await resolveFlightRouteWhere('Atlantis', 'Nowhere', mockClient as any);

        expect(result).toBeNull();
    });

    it('uses default prisma client if client is not provided and falls back appropriately', async () => {
        const result = await resolveFlightRouteWhere('Nowhere, Unknown', 'Nowhere, Unknown');
        expect(result).toBeNull();
    });
});

describe('flightRouteWhere', () => {
    it('maps known airport labels to IATA codes', () => {
        expect(flightRouteWhere('Seattle, USA', 'Detroit, USA')).toEqual({
            fromAirportCode: 'SEA',
            toAirportCode: 'DTW',
        });
    });

    it('returns null if either airport label is unknown', () => {
        expect(flightRouteWhere('Atlantis', 'Detroit, USA')).toBeNull();
        expect(flightRouteWhere('Seattle, USA', 'Atlantis')).toBeNull();
        expect(flightRouteWhere('Atlantis', 'Nowhere')).toBeNull();
    });
});

describe('withRouteLabels', () => {
    it('attaches from and to labels from fromAirport and toAirport', () => {
        const flight = {
            id: 1,
            fromAirport: { label: 'Seattle, USA' },
            toAirport: { label: 'Detroit, USA' },
            priceCents: 35000,
        };

        expect(withRouteLabels(flight)).toEqual({
            id: 1,
            from: 'Seattle, USA',
            to: 'Detroit, USA',
            priceCents: 35000,
        });
    });
});

describe('withLegRouteLabels', () => {
    it('handles leg with null flight', () => {
        expect(withLegRouteLabels({ id: 1, flight: null })).toEqual({ id: 1, flight: null });
    });

    it('attaches route labels to leg flight', () => {
        const leg = {
            id: 1,
            flight: {
                id: 10,
                fromAirport: { label: 'Seattle, USA' },
                toAirport: { label: 'Detroit, USA' },
            },
        };

        expect(withLegRouteLabels(leg)).toEqual({
            id: 1,
            flight: {
                id: 10,
                from: 'Seattle, USA',
                to: 'Detroit, USA',
            },
        });
    });
});

describe('flightRouteInclude', () => {
    it('specifies the relation select structure', () => {
        expect(flightRouteInclude).toEqual({
            fromAirport: { select: { label: true } },
            toAirport: { select: { label: true } },
        });
    });
});
