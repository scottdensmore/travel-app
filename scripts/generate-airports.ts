/**
 * Generate compiled TypeScript airport reference data from a vendored snapshot (#105).
 *
 * Sourcing reference data offline from a snapshot guarantees reproducibility,
 * clean diffs on review, and zero runtime dependency on external APIs.
 *
 * Usage:
 *   npm run airports:generate     # Regenerate lib/data/AirportData.ts
 *   npm run airports:check        # Verify AirportData.ts is up to date (exits 1 if drifted)
 */
import fs from 'node:fs';
import path from 'node:path';

export interface SourceCoordinates {
    latitude: number;
    longitude: number;
}

export interface SourceAirportRecord {
    iataCode: string;
    name?: string;
    city: string;
    country: string;
    coordinates?: SourceCoordinates;
    latitude?: number;
    longitude?: number;
    timeZone: string;
    label: string;
}

export interface SourceDataset {
    $comment?: string;
    source?: string;
    snapshotDate?: string;
    airports: SourceAirportRecord[];
}

const IATA_CODE_REGEX = /^[A-Z]{3}$/;
const IANA_TIMEZONE_REGEX = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/;

export function isValidIataCode(code: unknown): code is string {
    return typeof code === 'string' && IATA_CODE_REGEX.test(code);
}

export function isValidIanaTimeZone(timeZone: unknown): timeZone is string {
    if (typeof timeZone !== 'string' || !IANA_TIMEZONE_REGEX.test(timeZone)) {
        return false;
    }
    try {
        Intl.DateTimeFormat(undefined, { timeZone });
        return true;
    } catch {
        return false;
    }
}

export function isValidCoordinate(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && !Number.isNaN(value) && value >= min && value <= max;
}

export function validateAirportRecord(airport: SourceAirportRecord, index: number): void {
    if (!airport || typeof airport !== 'object') {
        throw new Error(`Record at index ${index} must be an object.`);
    }

    if (!isValidIataCode(airport.iataCode)) {
        throw new Error(
            `Record at index ${index} has invalid IATA code "${airport.iataCode}". Must be exactly 3 uppercase letters.`
        );
    }

    if (!airport.city || typeof airport.city !== 'string' || airport.city.trim().length === 0) {
        throw new Error(`Airport ${airport.iataCode} missing required non-empty "city".`);
    }

    if (!airport.country || typeof airport.country !== 'string' || airport.country.trim().length === 0) {
        throw new Error(`Airport ${airport.iataCode} missing required non-empty "country".`);
    }

    if (!airport.label || typeof airport.label !== 'string' || airport.label.trim().length === 0) {
        throw new Error(`Airport ${airport.iataCode} missing required non-empty "label".`);
    }

    if (!isValidIanaTimeZone(airport.timeZone)) {
        throw new Error(
            `Airport ${airport.iataCode} has invalid IANA timeZone "${airport.timeZone}". Must be a valid platform-recognised timezone.`
        );
    }

    const lat = airport.coordinates?.latitude ?? airport.latitude;
    const lng = airport.coordinates?.longitude ?? airport.longitude;

    if (lat !== undefined && !isValidCoordinate(lat, -90, 90)) {
        throw new Error(`Airport ${airport.iataCode} has invalid latitude ${lat}. Must be between -90 and 90.`);
    }

    if (lng !== undefined && !isValidCoordinate(lng, -180, 180)) {
        throw new Error(`Airport ${airport.iataCode} has invalid longitude ${lng}. Must be between -180 and 180.`);
    }
}

export function validateAirportDataset(airports: SourceAirportRecord[]): void {
    if (!Array.isArray(airports) || airports.length === 0) {
        throw new Error('Airport dataset must be a non-empty array of records.');
    }

    const seenCodes = new Set<string>();
    const seenLabels = new Set<string>();

    for (let i = 0; i < airports.length; i++) {
        const airport = airports[i];
        validateAirportRecord(airport, i);

        if (seenCodes.has(airport.iataCode)) {
            throw new Error(`Duplicate IATA code detected: "${airport.iataCode}".`);
        }
        seenCodes.add(airport.iataCode);

        if (seenLabels.has(airport.label)) {
            throw new Error(`Duplicate airport label detected: "${airport.label}".`);
        }
        seenLabels.add(airport.label);
    }
}

export function loadSourceAirports(filePath: string): SourceAirportRecord[] {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Vendored snapshot file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as SourceDataset | SourceAirportRecord[];

    const airports = Array.isArray(parsed) ? parsed : parsed.airports;
    if (!Array.isArray(airports)) {
        throw new Error(
            `Invalid airport source dataset at ${filePath}: expected an array or an object containing an "airports" array.`
        );
    }

    validateAirportDataset(airports);
    return airports;
}

function escapeSingleQuote(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function generateAirportDataTs(airports: SourceAirportRecord[]): string {
    validateAirportDataset(airports);

    const rows = airports.map((a) => {
        const iata = escapeSingleQuote(a.iataCode);
        const label = escapeSingleQuote(a.label);
        const city = escapeSingleQuote(a.city);
        const country = escapeSingleQuote(a.country);
        const timeZone = escapeSingleQuote(a.timeZone);
        return `    { iataCode: '${iata}', label: '${label}', city: '${city}', country: '${country}', timeZone: '${timeZone}' },`;
    });

    return `/**
 * AUTO-GENERATED FILE -- DO NOT EDIT DIRECTLY.
 *
 * Generated from vendored dataset snapshot: lib/data/vendored/airports-source.json
 * Sourced from OurAirports public-domain data with curated IANA timezones.
 *
 * To regenerate or check for drift:
 *   npm run airports:generate
 *   npm run airports:check
 */

export interface AirportRecord {
    /** IATA station code, the stable identifier for the airport. */
    iataCode: string;
    /**
     * How this place is written wherever a person reads or types it: a schedule
     * names a route in these words, and so does a search. Flights reference the
     * code and render this, rather than storing it a second time (#73).
     */
    label: string;
    city: string;
    country: string;
    /** IANA zone, the single source for converting an instant to a local day. */
    timeZone: string;
}

/**
 * Reference data for every place the seeded routes fly between. A route whose
 * origin is missing here cannot resolve its local calendar day, so
 * \`__tests__/lib/airports.test.ts\` fails the build when the two drift apart.
 *
 * Where a city has several airports, the busiest international one is used.
 */
const AirportData: AirportRecord[] = [
${rows.join('\n')}
];

export default AirportData;
`;
}

export function runGenerator(options: { check?: boolean } = {}): { success: boolean; message: string } {
    const rootDir = process.cwd();
    const sourcePath = path.resolve(rootDir, 'lib/data/vendored/airports-source.json');
    const targetPath = path.resolve(rootDir, 'lib/data/AirportData.ts');

    const airports = loadSourceAirports(sourcePath);
    const expectedContent = generateAirportDataTs(airports);

    if (options.check) {
        if (!fs.existsSync(targetPath)) {
            return {
                success: false,
                message: `Target file missing: ${targetPath}. Run "npm run airports:generate" to generate it.`,
            };
        }

        const existingContent = fs.readFileSync(targetPath, 'utf-8');
        // Normalize CRLF if any
        if (existingContent.replace(/\r\n/g, '\n') !== expectedContent.replace(/\r\n/g, '\n')) {
            return {
                success: false,
                message: `Drift detected in ${targetPath} compared to ${sourcePath}.\nRun "npm run airports:generate" to update it.`,
            };
        }

        return {
            success: true,
            message: `Airport reference data is up to date with vendored snapshot (${airports.length} airports checked).`,
        };
    }

    fs.writeFileSync(targetPath, expectedContent, 'utf-8');
    return {
        success: true,
        message: `Successfully generated ${targetPath} from vendored snapshot (${airports.length} airports).`,
    };
}

if (require.main === module) {
    const isCheck = process.argv.includes('--check');
    try {
        const result = runGenerator({ check: isCheck });
        if (!result.success) {
            console.error(`[airports:check] ERROR: ${result.message}`);
            process.exit(1);
        } else {
            console.log(result.message);
            process.exit(0);
        }
    } catch (err) {
        console.error(`[airports:${isCheck ? 'check' : 'generate'}] FAILED:`, err instanceof Error ? err.message : err);
        process.exit(1);
    }
}
