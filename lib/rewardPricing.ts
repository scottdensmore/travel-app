import type { CabinClass } from '@prisma/client';
import { formatPrice } from '@/lib/bookingPricing';

export const CABIN_AWARD_POINTS: Record<CabinClass, number> = {
    ECONOMY: 15000,
    PREMIUM_ECONOMY: 25000,
    BUSINESS: 40000,
    FIRST: 60000,
};

export const AWARD_PFC_TAX_CENTS_PER_LEG = 450;
export const AWARD_SECURITY_FEE_CENTS_PER_LEG = 560;
export const MANDATORY_AWARD_TAX_CENTS_PER_LEG = 1010;

export const DEFAULT_AWARD_SEATS: Record<CabinClass, number> = {
    ECONOMY: 4,
    PREMIUM_ECONOMY: 2,
    BUSINESS: 2,
    FIRST: 1,
};

const CABIN_AWARD_SEAT_KEYS: Record<
    CabinClass,
    'awardSeatsEconomy' | 'awardSeatsPremiumEconomy' | 'awardSeatsBusiness' | 'awardSeatsFirst'
> = {
    ECONOMY: 'awardSeatsEconomy',
    PREMIUM_ECONOMY: 'awardSeatsPremiumEconomy',
    BUSINESS: 'awardSeatsBusiness',
    FIRST: 'awardSeatsFirst',
};

export interface AwardFareQuote {
    cabinClass: CabinClass;
    legCount: number;
    passengerCount: number;
    pointsPerPassengerLeg: number;
    totalPointsRequired: number;
    taxesPerPassengerLegCents: number;
    totalTaxesCents: number;
    formattedPoints: string;
    formattedTaxes: string;
}

export function calculateAwardFareQuote(options: {
    cabinClass: CabinClass;
    legCount: number;
    passengerCount: number;
}): AwardFareQuote {
    const { cabinClass, legCount, passengerCount } = options;
    if (
        !Number.isInteger(legCount)
        || legCount <= 0
        || !Number.isInteger(passengerCount)
        || passengerCount <= 0
    ) {
        throw new RangeError('legCount and passengerCount must be positive integers');
    }

    const pointsPerPassengerLeg = CABIN_AWARD_POINTS[cabinClass] ?? CABIN_AWARD_POINTS.ECONOMY;
    const taxesPerPassengerLegCents = MANDATORY_AWARD_TAX_CENTS_PER_LEG;

    const totalPointsRequired = pointsPerPassengerLeg * legCount * passengerCount;
    const totalTaxesCents = taxesPerPassengerLegCents * legCount * passengerCount;

    return {
        cabinClass,
        legCount,
        passengerCount,
        pointsPerPassengerLeg,
        totalPointsRequired,
        taxesPerPassengerLegCents,
        totalTaxesCents,
        formattedPoints: `${totalPointsRequired.toLocaleString('en-US')} pts`,
        formattedTaxes: formatPrice(totalTaxesCents),
    };
}

export interface FlightAwardInventory {
    awardSeatsEconomy?: number | null;
    awardSeatsPremiumEconomy?: number | null;
    awardSeatsBusiness?: number | null;
    awardSeatsFirst?: number | null;
}

export function getAwardSeatsAvailableForCabin(
    flight: FlightAwardInventory,
    cabin: CabinClass,
): number {
    const key = CABIN_AWARD_SEAT_KEYS[cabin];
    const seats = flight[key];
    if (seats !== undefined && seats !== null && Number.isFinite(seats)) {
        return Math.max(0, seats);
    }
    return DEFAULT_AWARD_SEATS[cabin] ?? 0;
}

export function isAwardAvailableForFlight(
    flight: FlightAwardInventory,
    cabin: CabinClass,
    passengerCount: number = 1,
): boolean {
    if (passengerCount <= 0) {
        return false;
    }
    return getAwardSeatsAvailableForCabin(flight, cabin) >= passengerCount;
}
