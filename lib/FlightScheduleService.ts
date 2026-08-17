import type { Flight } from '@prisma/client';
import { airportCodesForRoute, airportTimeZoneFor } from './airports';
import { addDaysToIsoDate, todayIsoDate } from './dates';
import { airportLocalInstant } from './flightTime';
import { withFlightScheduleGenerationLock } from './flightScheduleGenerationLock';
import { prisma } from './prisma';

/** A flight instance for one schedule on one date, and whether this call created it. */
export interface EnsuredFlight {
    flight: Flight;
    created: boolean;
}

export interface InventoryHorizonSummary {
    /** First UTC day covered, inclusive. */
    fromDate: string;
    /** Last UTC day covered, inclusive. */
    throughDate: string;
    days: number;
    created: number;
    alreadyPresent: number;
}

/**
 * One day beyond the 365-day booking window, so inventory can always cover the
 * furthest date a customer is allowed to book.
 */
export const MAX_HORIZON_DAYS = 366;

/** How far ahead one schedule currently has flight instances. */
export interface ScheduleCoverage {
    flightNumber: string;
    /** Furthest date with an instance, or null when the schedule has none. */
    coveredThroughDate: string | null;
    /** Whole days from today through that date. Zero once it falls behind today. */
    daysCovered: number;
}

export interface InventoryCoverage {
    asOfDate: string;
    requiredDays: number;
    schedules: ScheduleCoverage[];
    /** The weakest schedule, which is what determines whether searches degrade. */
    shortestDaysCovered: number;
    isSufficient: boolean;
}

function isoDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function wholeDaysBetween(fromIsoDate: string, toIsoDate: string): number {
    const from = Date.parse(`${fromIsoDate}T00:00:00.000Z`);
    const to = Date.parse(`${toIsoDate}T00:00:00.000Z`);
    return Math.round((to - from) / 86_400_000);
}

export default class FlightScheduleService {
    async generateFlightsForDate(date: Date) {
        const ensured = await this.ensureFlightsForDate(date);
        return ensured.map(({ flight }) => flight);
    }

    /**
     * Ensure every active schedule that operates on `date` has a flight instance,
     * reporting which instances this call created.
     *
     * Idempotent: an existing instance is returned untouched, so administrative
     * overrides such as a DELAYED status survive regeneration.
     */
    async ensureFlightsForDate(date: Date): Promise<EnsuredFlight[]> {
        // Use getUTCDay() to avoid local timezone shifting
        const dayOfWeek = date.getUTCDay();

        // Find active schedules that run on this day of the week
        const schedules = await prisma.flightSchedule.findMany({
            where: {
                isActive: true,
                daysOfWeek: {
                    has: dayOfWeek
                }
            }
        });

        const ensured: EnsuredFlight[] = [];

        for (const schedule of schedules) {
            const dateStr = date.toISOString().split('T')[0];
            // The schedule's time is a wall clock at the origin. Stapling a `Z`
            // on it stored a Tokyo 08:00 departure as 08:00Z -- nine hours late,
            // and on the wrong day for anything near midnight (#84).
            const originZone = airportTimeZoneFor(schedule.from);
            const departureDate = originZone
                ? airportLocalInstant(dateStr, schedule.departureTime, originZone)
                : new Date(`${dateStr}T${schedule.departureTime}:00Z`);

            let result: EnsuredFlight | null;
            try {
                result = await withFlightScheduleGenerationLock(schedule.id, async tx => {
                    // The active-list query is only an efficient candidate scan.
                    // Re-read after the shared generation-state lock so a
                    // deactivation that won the lock cannot be followed by a
                    // stale generator create.
                    const currentState = await tx.flightSchedule.findUnique({
                        where: { id: schedule.id },
                        select: { isActive: true, daysOfWeek: true },
                    });
                    if (!currentState?.isActive || !currentState.daysOfWeek.includes(dayOfWeek)) {
                        return null;
                    }

                    // Check if flight instance already exists
                    let flight = await tx.flight.findFirst({
                        where: {
                            flightNumber: schedule.flightNumber,
                            departureDate: departureDate
                        }
                    });
                    let created = false;

                    if (!flight) {
                        flight = await tx.flight.create({
                            data: {
                                flightScheduleId: schedule.id,
                                flightNumber: schedule.flightNumber,
                                airline: schedule.airline,
                                ...airportCodesForRoute(schedule.from, schedule.to),
                                departureDate,
                                priceCents: schedule.priceCents,
                                durationMinutes: schedule.durationMinutes,
                                status: 'ON_TIME',
                                firstClassRows: schedule.firstClassRows ?? 3,
                                businessRows: schedule.businessRows ?? 3,
                                premiumEconomyRows: schedule.premiumEconomyRows ?? 4,
                                economyRows: schedule.economyRows ?? 20,
                                seatPattern: schedule.seatPattern ?? 'ABC-DEF'
                            }
                        });
                        created = true;
                    }

                    return flight ? { flight, created } : null;
                });
            } catch (error) {
                // PostgreSQL aborts a transaction after a unique violation, so
                // the row inserted by the winner must be read after the failed
                // generation transaction has rolled back.
                if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) {
                    throw error;
                }
                const flight = await prisma.flight.findFirst({
                    where: {
                        flightNumber: schedule.flightNumber,
                        departureDate,
                    },
                });
                if (!flight) throw error;
                result = { flight, created: false };
            }

            if (result) ensured.push(result);
        }

        return ensured;
    }

    /**
     * Fill inventory for every active schedule from the UTC day of `from`
     * through `days - 1` days later, inclusive.
     *
     * Safe to run concurrently with itself and with any other generator: each
     * instance is created at most once, and a losing race resolves to the row
     * the winner inserted. Intended to be driven by a scheduler so that a
     * customer search never has to create inventory (#71).
     */
    async generateFlightsForHorizon(from: Date, days: number): Promise<InventoryHorizonSummary> {
        if (!Number.isInteger(days) || days < 1) {
            throw new Error('Horizon must cover at least one day.');
        }
        if (days > MAX_HORIZON_DAYS) {
            throw new Error(`Horizon cannot exceed ${MAX_HORIZON_DAYS} days.`);
        }

        const fromDate = todayIsoDate(from);
        let created = 0;
        let alreadyPresent = 0;

        for (let offset = 0; offset < days; offset++) {
            const isoDate = addDaysToIsoDate(fromDate, offset);
            const ensured = await this.ensureFlightsForDate(new Date(`${isoDate}T00:00:00.000Z`));

            for (const { created: wasCreated } of ensured) {
                if (wasCreated) {
                    created += 1;
                } else {
                    alreadyPresent += 1;
                }
            }
        }

        return {
            fromDate,
            throughDate: addDaysToIsoDate(fromDate, days - 1),
            days,
            created,
            alreadyPresent,
        };
    }

    /**
     * Measure how far ahead inventory actually reaches, per active schedule.
     *
     * Searching no longer generates inventory (#71), so a scheduler that has
     * stopped is invisible until the horizon shrinks into the dates customers
     * are searching. This turns that silent decay into a value that can be
     * checked and alerted on.
     *
     * Coverage is reported per schedule and reduced to the weakest one, because
     * a single starved schedule degrades its route even while others are
     * healthy.
     */
    async reportInventoryCoverage(requiredDays: number, from = new Date()): Promise<InventoryCoverage> {
        const asOfDate = todayIsoDate(from);
        const activeSchedules = await prisma.flightSchedule.findMany({
            where: { isActive: true },
            select: { flightNumber: true },
        });

        if (activeSchedules.length === 0) {
            // Nothing is scheduled, so there is no inventory to be short of.
            return { asOfDate, requiredDays, schedules: [], shortestDaysCovered: 0, isSufficient: true };
        }

        const flightNumbers = activeSchedules.map(({ flightNumber }) => flightNumber);
        const furthest = await prisma.flight.groupBy({
            by: ['flightNumber'],
            where: { flightNumber: { in: flightNumbers } },
            _max: { departureDate: true },
        });

        const furthestByFlightNumber = new Map(
            furthest.map(entry => [entry.flightNumber, entry._max?.departureDate ?? null])
        );

        const schedules: ScheduleCoverage[] = flightNumbers.map(flightNumber => {
            const departureDate = furthestByFlightNumber.get(flightNumber) ?? null;

            if (!departureDate) {
                return { flightNumber, coveredThroughDate: null, daysCovered: 0 };
            }

            const coveredThroughDate = isoDay(departureDate);
            return {
                flightNumber,
                coveredThroughDate,
                // Inventory already behind today covers nothing bookable.
                daysCovered: Math.max(0, wholeDaysBetween(asOfDate, coveredThroughDate)),
            };
        });

        const shortestDaysCovered = Math.min(...schedules.map(({ daysCovered }) => daysCovered));

        return {
            asOfDate,
            requiredDays,
            schedules,
            shortestDaysCovered,
            isSufficient: shortestDaysCovered >= requiredDays,
        };
    }
}
