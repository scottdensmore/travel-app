/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import AirportData from '@/lib/data/AirportData';
import {
    generateAirportDataTs,
    isValidCoordinate,
    isValidIanaTimeZone,
    isValidIataCode,
    loadSourceAirports,
    runGenerator,
    validateAirportDataset,
    validateAirportRecord,
    SourceAirportRecord,
} from '@/scripts/generate-airports';

describe('vendored airports dataset snapshot', () => {
    const snapshotPath = path.resolve(process.cwd(), 'lib/data/vendored/airports-source.json');
    let sourceAirports: SourceAirportRecord[];

    beforeAll(() => {
        expect(fs.existsSync(snapshotPath)).toBe(true);
        sourceAirports = loadSourceAirports(snapshotPath);
    });

    it('contains all 10 required seeded airports', () => {
        const expectedCodes = ['SEA', 'DTW', 'JFK', 'LHR', 'SFO', 'HND', 'ORD', 'CDG', 'MIA', 'GIG'];
        const actualCodes = sourceAirports.map((a) => a.iataCode);
        expect(actualCodes).toEqual(expectedCodes);
    });

    it('validates all records in the vendored snapshot', () => {
        expect(() => validateAirportDataset(sourceAirports)).not.toThrow();
    });

    it('has valid coordinates for every seeded airport', () => {
        for (const airport of sourceAirports) {
            const lat = airport.coordinates?.latitude ?? airport.latitude;
            const lng = airport.coordinates?.longitude ?? airport.longitude;

            expect(typeof lat).toBe('number');
            expect(typeof lng).toBe('number');
            expect(isValidCoordinate(lat, -90, 90)).toBe(true);
            expect(isValidCoordinate(lng, -180, 180)).toBe(true);
        }
    });

    it('has valid platform-resolvable IANA timezones', () => {
        for (const airport of sourceAirports) {
            expect(isValidIanaTimeZone(airport.timeZone)).toBe(true);
            expect(() => {
                new Intl.DateTimeFormat('en-CA', { timeZone: airport.timeZone }).format(new Date());
            }).not.toThrow();
        }
    });

    it('has distinct IATA codes and display labels', () => {
        const codes = new Set(sourceAirports.map((a) => a.iataCode));
        const labels = new Set(sourceAirports.map((a) => a.label));
        expect(codes.size).toBe(sourceAirports.length);
        expect(labels.size).toBe(sourceAirports.length);
    });

    it('matches the compiled AirportData.ts records exactly', () => {
        expect(AirportData.length).toBe(sourceAirports.length);
        for (let i = 0; i < AirportData.length; i++) {
            const compiled = AirportData[i];
            const source = sourceAirports[i];

            expect(compiled.iataCode).toBe(source.iataCode);
            expect(compiled.label).toBe(source.label);
            expect(compiled.city).toBe(source.city);
            expect(compiled.country).toBe(source.country);
            expect(compiled.timeZone).toBe(source.timeZone);
        }
    });
});

describe('generate-airports script validation and drift detection', () => {
    const validAirport: SourceAirportRecord = {
        iataCode: 'ABC',
        city: 'City',
        country: 'Country',
        label: 'City, Country',
        timeZone: 'America/New_York',
        coordinates: { latitude: 40.0, longitude: -70.0 },
    };

    it('accepts valid IATA codes and rejects invalid ones', () => {
        expect(isValidIataCode('SEA')).toBe(true);
        expect(isValidIataCode('sea')).toBe(false);
        expect(isValidIataCode('SE')).toBe(false);
        expect(isValidIataCode('SEAA')).toBe(false);
        expect(isValidIataCode('123')).toBe(false);
        expect(isValidIataCode('')).toBe(false);
    });

    it('accepts valid IANA timezones and rejects invalid ones', () => {
        expect(isValidIanaTimeZone('America/Los_Angeles')).toBe(true);
        expect(isValidIanaTimeZone('Europe/London')).toBe(true);
        expect(isValidIanaTimeZone('Asia/Tokyo')).toBe(true);
        expect(isValidIanaTimeZone('Mars/Olympus')).toBe(false);
        expect(isValidIanaTimeZone('InvalidZone')).toBe(false);
        expect(isValidIanaTimeZone('')).toBe(false);
    });

    it('rejects airport records with missing or invalid fields', () => {
        expect(() => validateAirportRecord({ ...validAirport, iataCode: 'bad' }, 0))
            .toThrow('invalid IATA code');
        expect(() => validateAirportRecord({ ...validAirport, city: '' }, 0))
            .toThrow('missing required non-empty "city"');
        expect(() => validateAirportRecord({ ...validAirport, country: '  ' }, 0))
            .toThrow('missing required non-empty "country"');
        expect(() => validateAirportRecord({ ...validAirport, label: '' }, 0))
            .toThrow('missing required non-empty "label"');
        expect(() => validateAirportRecord({ ...validAirport, timeZone: 'Nowhere/Fantasy' }, 0))
            .toThrow('invalid IANA timeZone');
        expect(() => validateAirportRecord({ ...validAirport, coordinates: { latitude: 95, longitude: 0 } }, 0))
            .toThrow('invalid latitude');
        expect(() => validateAirportRecord({ ...validAirport, coordinates: { latitude: 0, longitude: 185 } }, 0))
            .toThrow('invalid longitude');
    });

    it('detects duplicate IATA codes or labels in dataset', () => {
        const duplicateCode = [
            validAirport,
            { ...validAirport, label: 'Different City, Country' },
        ];
        expect(() => validateAirportDataset(duplicateCode)).toThrow('Duplicate IATA code');

        const duplicateLabel = [
            validAirport,
            { ...validAirport, iataCode: 'XYZ' },
        ];
        expect(() => validateAirportDataset(duplicateLabel)).toThrow('Duplicate airport label');
    });

    it('verifies that check mode confirms AirportData.ts is in sync without drift', () => {
        const result = runGenerator({ check: true });
        expect(result.success).toBe(true);
        expect(result.message).toContain('up to date');
    });

    it('generates reproducible TypeScript output matching AirportData.ts file content', () => {
        const targetPath = path.resolve(process.cwd(), 'lib/data/AirportData.ts');
        const fileContent = fs.readFileSync(targetPath, 'utf-8');
        const snapshotPath = path.resolve(process.cwd(), 'lib/data/vendored/airports-source.json');
        const airports = loadSourceAirports(snapshotPath);
        const generated = generateAirportDataTs(airports);

        expect(fileContent.replace(/\r\n/g, '\n')).toBe(generated.replace(/\r\n/g, '\n'));
    });
});
