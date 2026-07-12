export const DEFAULT_SEATING_LAYOUT = {
    firstClassRows: 3,
    businessRows: 3,
    premiumEconomyRows: 4,
    economyRows: 20,
    seatPattern: 'ABC-DEF'
} as const;
export const MAX_TOTAL_SEATING_ROWS = 100;
export const MAX_SEATS_PER_ROW = 12;

export type CabinClass = 'FIRST' | 'BUSINESS' | 'PREMIUM_ECONOMY' | 'ECONOMY';

export interface SeatingLayout {
    firstClassRows?: number | null;
    businessRows?: number | null;
    premiumEconomyRows?: number | null;
    economyRows?: number | null;
    seatPattern?: string | null;
}

export function validateSeatingLayout(
    firstClassRows: number,
    businessRows: number,
    premiumEconomyRows: number,
    economyRows: number,
    seatPattern: string
): string {
    const rowCounts = [firstClassRows, businessRows, premiumEconomyRows, economyRows];
    if (rowCounts.some(rowCount => !Number.isInteger(rowCount) || rowCount < 0)) {
        throw new Error('Row configurations must be non-negative integers.');
    }
    const totalRows = rowCounts.reduce((total, rowCount) => total + rowCount, 0);
    if (totalRows === 0) throw new Error('At least one seating row is required.');
    if (totalRows > MAX_TOTAL_SEATING_ROWS) {
        throw new Error(`Seating layouts cannot exceed ${MAX_TOTAL_SEATING_ROWS} total rows.`);
    }

    const normalizedPattern = seatPattern.trim().toUpperCase();
    if (!normalizedPattern) throw new Error('Seat pattern is required.');
    if (!/^[A-Z-]+$/.test(normalizedPattern)) {
        throw new Error('Seat pattern must only contain uppercase letters and hyphens.');
    }
    const letters = normalizedPattern.replace(/[^A-Z]/g, '');
    if (!letters) throw new Error('Seat pattern must contain at least one seat letter.');
    if (!/^[A-Z]+(?:-[A-Z]+)*$/.test(normalizedPattern)) {
        throw new Error('Seat pattern must contain seat-letter groups separated by single hyphens.');
    }
    if (new Set(letters).size !== letters.length) {
        throw new Error('Seat pattern letters must be unique.');
    }
    if (letters.length > MAX_SEATS_PER_ROW) {
        throw new Error(`Seat patterns cannot exceed ${MAX_SEATS_PER_ROW} seats per row.`);
    }
    return normalizedPattern;
}

function rowCount(value: number | null | undefined, fallback: number): number {
    return value ?? fallback;
}

export function isSeatAvailableForCabin(
    seatNumber: string,
    cabinClass: string,
    layout: SeatingLayout
): boolean {
    const match = /^(\d+)([A-Z])$/.exec(seatNumber);
    if (!match) return false;

    const firstClassRows = rowCount(layout.firstClassRows, DEFAULT_SEATING_LAYOUT.firstClassRows);
    const businessRows = rowCount(layout.businessRows, DEFAULT_SEATING_LAYOUT.businessRows);
    const premiumEconomyRows = rowCount(
        layout.premiumEconomyRows,
        DEFAULT_SEATING_LAYOUT.premiumEconomyRows
    );
    const economyRows = rowCount(layout.economyRows, DEFAULT_SEATING_LAYOUT.economyRows);
    const cabinRanges: Record<CabinClass, [number, number]> = {
        FIRST: [1, firstClassRows],
        BUSINESS: [firstClassRows + 1, firstClassRows + businessRows],
        PREMIUM_ECONOMY: [
            firstClassRows + businessRows + 1,
            firstClassRows + businessRows + premiumEconomyRows
        ],
        ECONOMY: [
            firstClassRows + businessRows + premiumEconomyRows + 1,
            firstClassRows + businessRows + premiumEconomyRows + economyRows
        ]
    };
    const range = cabinRanges[cabinClass as CabinClass];
    if (!range) return false;

    const row = Number(match[1]);
    const seatLetters = (layout.seatPattern ?? DEFAULT_SEATING_LAYOUT.seatPattern)
        .replace(/[^A-Z]/g, '');

    return row >= range[0] && row <= range[1] && seatLetters.includes(match[2]);
}

export function assertSeatAvailableForCabin(
    seatNumber: string,
    cabinClass: string,
    layout: SeatingLayout
): void {
    if (!isSeatAvailableForCabin(seatNumber, cabinClass, layout)) {
        throw new Error(`Seat ${seatNumber} is not available for ${cabinClass} on this flight.`);
    }
}
