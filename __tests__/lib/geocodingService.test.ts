import { GeocodingService, geocodingService } from '@/lib/geocodingService';

describe('GeocodingService', () => {
    let service: GeocodingService;
    const originalFetch = global.fetch;

    beforeEach(() => {
        service = new GeocodingService({ minRequestIntervalMs: 50, cacheTtlMs: 5000, negativeTtlMs: 2000 });
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('queries Nominatim with User-Agent and returns formatted coordinates with attribution', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => [{ lat: '47.6062', lon: '-122.3321' }],
        } as Response);

        const result = await service.lookup('Seattle', 'USA');

        expect(result).toEqual({
            latitude: 47.6062,
            longitude: -122.3321,
            attribution: 'Data © OpenStreetMap contributors, ODbL 1.0',
            source: 'nominatim',
        });

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('q=Seattle%2CUSA'),
            expect.objectContaining({
                headers: expect.objectContaining({
                    'User-Agent': expect.stringContaining('MonaAirways-TravelApp'),
                }),
            })
        );
    });

    it('returns cached coordinates on repeated queries', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => [{ lat: '47.6062', lon: '-122.3321' }],
        } as Response);

        const first = await service.lookup('Seattle', 'USA');
        const second = await service.lookup('seattle ', 'usa');

        expect(first.source).toBe('nominatim');
        expect(second.source).toBe('cache');
        expect(second.latitude).toBe(47.6062);
        expect(second.longitude).toBe(-122.3321);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent in-flight requests for the same location', async () => {
        global.fetch = jest.fn().mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return {
                ok: true,
                status: 200,
                json: async () => [{ lat: '47.6062', lon: '-122.3321' }],
            } as Response;
        });

        const [first, second] = await Promise.all([
            service.lookup('Seattle', 'USA'),
            service.lookup('Seattle', 'USA'),
        ]);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(first.latitude).toBe(47.6062);
        expect(second.latitude).toBe(47.6062);
        expect(first.source).toBe('nominatim');
        expect(second.source).toBe('cache');
    });

    it('throttles rapid sequential requests to enforce rate limits', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => [{ lat: '10.0', lon: '20.0' }],
        } as Response);

        const start = Date.now();
        await Promise.all([
            service.lookup('CityA', 'CountryA'),
            service.lookup('CityB', 'CountryB'),
        ]);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeGreaterThanOrEqual(45);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('falls back gracefully to seeded airport coordinates when Nominatim fails', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

        const result = await service.lookup('Detroit', 'USA');

        expect(result.source).toBe('fallback');
        expect(result.latitude).toBeCloseTo(42.2124, 2);
        expect(result.longitude).toBeCloseTo(-83.3534, 2);
        expect(result.attribution).toContain('OpenStreetMap');
    });

    it('falls back gracefully to seeded airport coordinates when Nominatim returns non-200 status', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            json: async () => ({}),
        } as Response);

        const result = await service.lookup('Detroit', 'USA');

        expect(result.source).toBe('fallback');
        expect(result.latitude).toBeCloseTo(42.2124, 2);
        expect(result.longitude).toBeCloseTo(-83.3534, 2);
        expect(result.attribution).toContain('OpenStreetMap');
    });

    it('throws a clean error if location is not found and no fallback exists', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => [],
        } as Response);

        await expect(service.lookup('UnknownCity', 'UnknownCountry')).rejects.toThrow(
            'Location not found: UnknownCity, UnknownCountry'
        );
    });

    it('throws a clean error if upstream fails and no fallback exists', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

        await expect(service.lookup('UnknownCity', 'UnknownCountry')).rejects.toThrow(
            'Failed to geocode location: UnknownCity, UnknownCountry'
        );
    });

    it('caches negative lookups so subsequent attempts within negativeTtl do not call fetch', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => [],
        } as Response);

        await expect(service.lookup('MissingCity', 'MissingCountry')).rejects.toThrow(
            'Location not found: MissingCity, MissingCountry'
        );
        await expect(service.lookup('missingcity ', 'missingcountry')).rejects.toThrow(
            'Location not found: MissingCity, MissingCountry'
        );
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('clears cache when clearCache is called', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => [{ lat: '47.6062', lon: '-122.3321' }],
        } as Response);

        await service.lookup('Seattle', 'USA');
        service.clearCache();
        await service.lookup('Seattle', 'USA');

        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('rejects with error when city or country is blank', async () => {
        await expect(service.lookup('', 'USA')).rejects.toThrow('City and country are required');
        await expect(service.lookup('Seattle', '   ')).rejects.toThrow('City and country are required');
    });

    it('exports a default singleton instance', () => {
        expect(geocodingService).toBeInstanceOf(GeocodingService);
    });
});
