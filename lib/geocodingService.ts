import AirportData from './data/AirportData';
import CityGuideData from './data/CityGuideData';

export interface GeocodeResult {
    latitude: number;
    longitude: number;
    attribution: string;
    source: 'nominatim' | 'cache' | 'fallback';
}

export interface GeocodingServiceOptions {
    minRequestIntervalMs?: number;
    cacheTtlMs?: number;
    negativeTtlMs?: number;
    timeoutMs?: number;
    maxEntries?: number;
}

interface CacheEntry {
    result?: GeocodeResult;
    error?: Error;
    expiresAt: number;
}

const USER_AGENT = 'MonaAirways-TravelApp/1.0 (+https://github.com/scottdensmore/travel-app; support@monaairways.com)';
const ATTRIBUTION = 'Data © OpenStreetMap contributors, ODbL 1.0';
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org/search';

const SEEDED_AIRPORT_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
    DTW: { latitude: 42.2124, longitude: -83.3534 },
    SEA: { latitude: 47.4502, longitude: -122.3088 },
    JFK: { latitude: 40.6413, longitude: -73.7781 },
    LHR: { latitude: 51.4700, longitude: -0.4543 },
    SFO: { latitude: 37.6213, longitude: -122.3790 },
    HND: { latitude: 35.5494, longitude: 139.7798 },
    ORD: { latitude: 41.9742, longitude: -87.9073 },
    CDG: { latitude: 49.0097, longitude: 2.5479 },
    MIA: { latitude: 25.7959, longitude: -80.2870 },
    GIG: { latitude: -22.8134, longitude: -43.2494 },
};

function findFallbackCoordinates(city: string, country: string): { latitude: number; longitude: number } | null {
    const cleanCity = city.trim().toLowerCase();
    const cleanCountry = country.trim().toLowerCase();

    // 1. Check seeded airport records
    for (const airport of AirportData) {
        const airportCity = airport.city.trim().toLowerCase();
        const airportCountry = airport.country.trim().toLowerCase();
        const airportLabel = airport.label.trim().toLowerCase();

        const cityMatches = airportCity === cleanCity;
        const countryMatches =
            airportCountry === cleanCountry ||
            airportLabel.includes(cleanCountry) ||
            ((cleanCountry === 'usa' || cleanCountry === 'us') && (airportCountry === 'united states' || airportLabel.includes('usa'))) ||
            ((cleanCountry === 'uk' || cleanCountry === 'gb') && (airportCountry === 'united kingdom' || airportLabel.includes('uk')));

        if (cityMatches && countryMatches) {
            const coords = SEEDED_AIRPORT_COORDINATES[airport.iataCode];
            if (coords) {
                return coords;
            }
        }
    }

    // 2. Check seeded city guide records
    for (const guide of CityGuideData) {
        const guideCity = guide.city.trim().toLowerCase();
        const guideCountry = guide.country.trim().toLowerCase();

        const cityMatches = guideCity === cleanCity;
        const countryMatches =
            guideCountry === cleanCountry ||
            ((cleanCountry === 'usa' || cleanCountry === 'us') && (guideCountry === 'usa' || guideCountry === 'united states')) ||
            ((cleanCountry === 'uk' || cleanCountry === 'gb') && (guideCountry === 'uk' || guideCountry === 'united kingdom'));

        if (cityMatches && countryMatches && guide.latlong && guide.latlong.length >= 2) {
            return {
                latitude: guide.latlong[0],
                longitude: guide.latlong[1],
            };
        }
    }

    return null;
}

export class GeocodingService {
    private minRequestIntervalMs: number;
    private cacheTtlMs: number;
    private negativeTtlMs: number;
    private timeoutMs: number;
    private maxEntries: number;

    private cache = new Map<string, CacheEntry>();
    private inFlight = new Map<string, Promise<GeocodeResult>>();
    private lastRequestTime = 0;
    private queue: Promise<void> = Promise.resolve();

    constructor(options?: GeocodingServiceOptions) {
        this.minRequestIntervalMs = options?.minRequestIntervalMs ?? 1000;
        this.cacheTtlMs = options?.cacheTtlMs ?? 24 * 60 * 60 * 1000; // 24 hours
        this.negativeTtlMs = options?.negativeTtlMs ?? 5 * 60 * 1000; // 5 minutes
        this.timeoutMs = options?.timeoutMs ?? 4000; // 4 seconds
        this.maxEntries = options?.maxEntries ?? 1000;
    }

    public clearCache(): void {
        this.cache.clear();
        this.inFlight.clear();
    }

    private setCache(cacheKey: string, entry: CacheEntry): void {
        if (this.cache.has(cacheKey)) {
            this.cache.delete(cacheKey);
        } else if (this.cache.size >= this.maxEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }
        this.cache.set(cacheKey, entry);
    }

    private getCached(cacheKey: string): GeocodeResult | null {
        const cached = this.cache.get(cacheKey);
        if (!cached) {
            return null;
        }

        if (Date.now() < cached.expiresAt) {
            // Refresh LRU order on access
            this.cache.delete(cacheKey);
            this.cache.set(cacheKey, cached);

            if (cached.error) {
                throw cached.error;
            }
            if (cached.result) {
                return {
                    ...cached.result,
                    source: 'cache',
                };
            }
        } else {
            this.cache.delete(cacheKey);
        }

        return null;
    }

    public async lookup(city: string, country: string): Promise<GeocodeResult> {
        const cleanCity = city?.trim();
        const cleanCountry = country?.trim();

        if (!cleanCity || !cleanCountry) {
            throw new Error('City and country are required');
        }

        const cacheKey = `${cleanCity.toLowerCase()}:${cleanCountry.toLowerCase()}`;
        const cached = this.getCached(cacheKey);

        if (cached) {
            return cached;
        }

        const inFlightPromise = this.inFlight.get(cacheKey);
        if (inFlightPromise) {
            const result = await inFlightPromise;
            return {
                ...result,
                source: 'cache',
            };
        }

        const lookupPromise = this.executeLookup(cleanCity, cleanCountry, cacheKey);
        this.inFlight.set(cacheKey, lookupPromise);

        try {
            return await lookupPromise;
        } finally {
            this.inFlight.delete(cacheKey);
        }
    }

    private async fetchNominatim(cleanCity: string, cleanCountry: string): Promise<GeocodeResult | null> {
        const query = `${cleanCity},${cleanCountry}`;
        const url = `${NOMINATIM_BASE_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;

        let signal: AbortSignal | undefined;
        let timeoutId: NodeJS.Timeout | undefined;

        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            signal = AbortSignal.timeout(this.timeoutMs);
        } else {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
            signal = controller.signal;
        }

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'application/json',
                },
                cache: 'no-store',
                signal,
            });

            if (!response.ok) {
                throw new Error(`Nominatim HTTP ${response.status}: ${response.statusText}`);
            }

            const data = (await response.json()) as Array<{ lat: string; lon: string }>;
            if (!Array.isArray(data) || data.length === 0) {
                return null;
            }

            const latitude = parseFloat(data[0].lat);
            const longitude = parseFloat(data[0].lon);

            if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
                return null;
            }

            return {
                latitude,
                longitude,
                attribution: ATTRIBUTION,
                source: 'nominatim' as const,
            };
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    private async executeLookup(cleanCity: string, cleanCountry: string, cacheKey: string): Promise<GeocodeResult> {
        let upstreamError: Error | null = null;
        let upstreamNotFound = false;
        let upstreamResult: GeocodeResult | null = null;

        try {
            upstreamResult = await this.throttledFetch(async () => {
                const cachedInsideQueue = this.getCached(cacheKey);
                if (cachedInsideQueue) {
                    return cachedInsideQueue;
                }

                return await this.fetchNominatim(cleanCity, cleanCountry);
            });
            if (upstreamResult === null) {
                upstreamNotFound = true;
            }
        } catch (err) {
            upstreamError = err instanceof Error ? err : new Error(String(err));
        }

        if (upstreamResult) {
            if (upstreamResult.source !== 'cache') {
                this.setCache(cacheKey, {
                    result: upstreamResult,
                    expiresAt: Date.now() + this.cacheTtlMs,
                });
            }
            return upstreamResult;
        }

        // Fallback inspection
        const fallback = findFallbackCoordinates(cleanCity, cleanCountry);
        if (fallback) {
            const fallbackResult: GeocodeResult = {
                latitude: fallback.latitude,
                longitude: fallback.longitude,
                attribution: ATTRIBUTION,
                source: 'fallback',
            };
            this.setCache(cacheKey, {
                result: fallbackResult,
                expiresAt: Date.now() + this.cacheTtlMs,
            });
            return fallbackResult;
        }

        if (upstreamNotFound) {
            const notFoundError = new Error(`Location not found: ${cleanCity}, ${cleanCountry}`);
            this.setCache(cacheKey, {
                error: notFoundError,
                expiresAt: Date.now() + this.negativeTtlMs,
            });
            throw notFoundError;
        }

        const failureError = new Error(`Failed to geocode location: ${cleanCity}, ${cleanCountry}`, {
            cause: upstreamError ?? undefined,
        });
        throw failureError;
    }

    private async throttledFetch<T>(fn: () => Promise<T>): Promise<T> {
        const previous = this.queue;
        let resolveQueue!: () => void;
        this.queue = new Promise<void>((resolve) => {
            resolveQueue = resolve;
        });

        await previous;
        try {
            const now = Date.now();
            const elapsed = now - this.lastRequestTime;
            if (elapsed < this.minRequestIntervalMs) {
                await new Promise((resolve) => setTimeout(resolve, this.minRequestIntervalMs - elapsed));
            }
            this.lastRequestTime = Date.now();
            return await fn();
        } finally {
            resolveQueue();
        }
    }
}

export const geocodingService = new GeocodingService();
