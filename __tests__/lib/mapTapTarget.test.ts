// @ts-expect-error d3-geo lacks bundled type definitions
import { geoEqualEarth } from 'd3-geo';
import CityGuideData from '@/lib/data/CityGuideData';
import {
    MIN_TAP_TARGET_PX,
    VIEWBOX_WIDTH,
    VIEWBOX_HEIGHT,
    MAP_PROJECTION_CONFIG,
    tapTargetRadius,
    minPairwiseMarkerDistance,
} from '@/lib/mapTapTarget';

describe('mapTapTarget', () => {
    describe('helper calculations', () => {
        it('calculates tap target radius in viewBox units for mobile viewport width (390px)', () => {
            // (24 / 2) / (390 / 800) = 12 / 0.4875 = 24.61538...
            const radius = tapTargetRadius(390);
            expect(radius).toBeCloseTo(24.615, 3);
            expect(radius).toBe((MIN_TAP_TARGET_PX / 2) / (390 / VIEWBOX_WIDTH));
        });

        it('calculates minimum pairwise marker distance', () => {
            // tapTargetRadius(390) + 5 = ~24.615 + 5 = ~29.615
            const distance = minPairwiseMarkerDistance(390, 5);
            expect(distance).toBeCloseTo(29.615, 3);
            expect(distance).toBe(tapTargetRadius(390) + 5);
        });
    });

    describe('seed city pinning and marker separation invariants', () => {
        const PINNED_SEED_CITIES = [
            { city: 'New York', latlong: [40.7128, -74.006] },
            { city: 'Los Angeles', latlong: [34.0522, -118.2437] },
            { city: 'Chicago', latlong: [41.8781, -87.6298] },
            { city: 'Miami', latlong: [25.7617, -80.1918] },
            { city: 'Orlando', latlong: [28.5383, -81.3792] },
            { city: 'Las Vegas', latlong: [36.1699, -115.1398] },
            { city: 'Seattle', latlong: [47.6062, -122.3321] },
            { city: 'Detroit', latlong: [42.3314, -83.0458] },
            { city: 'Boston', latlong: [42.3601, -71.0589] },
            { city: 'New Orleans', latlong: [29.9511, -90.0715] },
        ];

        it('pins the seed city list so any addition or modification fails with recomputation instructions', () => {
            const actualCities = CityGuideData.map((c) => ({
                city: c.city,
                latlong: c.latlong,
            }));
            const recomputeInstruction =
                'CityGuideData seed cities have changed. Any addition or modification requires recomputing and verifying marker hit area separation.';
            try {
                expect(actualCities).toEqual(PINNED_SEED_CITIES);
            } catch (err) {
                throw new Error(
                    `${recomputeInstruction}\n${(err as Error).message}`
                );
            }
        });

        it('ensures pairwise projected distance between every pair of cities is strictly greater than minPairwiseMarkerDistance(390, 5)', () => {
            const projection = geoEqualEarth()
                .scale(MAP_PROJECTION_CONFIG.scale)
                .center(MAP_PROJECTION_CONFIG.center)
                .translate([VIEWBOX_WIDTH / 2, VIEWBOX_HEIGHT / 2]);

            const minRequiredDistance = minPairwiseMarkerDistance(390, 5);

            let closestPair: { cityA: string; cityB: string; distance: number } | null = null;
            let minObservedDistance = Infinity;

            for (let i = 0; i < CityGuideData.length; i++) {
                for (let j = i + 1; j < CityGuideData.length; j++) {
                    const cityA = CityGuideData[i];
                    const cityB = CityGuideData[j];

                    // Note: In react-simple-maps, coordinates for <Marker coordinates={[city.latlong[1], city.latlong[0]]}> are [longitude, latitude]
                    const projA = projection([cityA.latlong[1], cityA.latlong[0]]) as [number, number];
                    const projB = projection([cityB.latlong[1], cityB.latlong[0]]) as [number, number];

                    expect(projA).not.toBeNull();
                    expect(projB).not.toBeNull();

                    const distance = Math.hypot(projA[0] - projB[0], projA[1] - projB[1]);

                    if (distance < minObservedDistance) {
                        minObservedDistance = distance;
                        closestPair = { cityA: cityA.city, cityB: cityB.city, distance };
                    }

                    expect(distance).toBeGreaterThan(minRequiredDistance);
                }
            }

            // Verify known closest pair: Miami–Orlando at ~31.8u > 29.6u
            expect(closestPair).not.toBeNull();
            expect(closestPair?.cityA).toBe('Miami');
            expect(closestPair?.cityB).toBe('Orlando');
            expect(closestPair?.distance).toBeCloseTo(31.796, 2);
            expect(closestPair?.distance).toBeGreaterThan(minRequiredDistance);
        });
    });
});
