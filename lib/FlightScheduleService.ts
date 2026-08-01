import type { Flight } from '@prisma/client';
import { addDaysToIsoDate, todayIsoDate } from './dates';
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
            const departureDate = new Date(`${dateStr}T${schedule.departureTime}:00Z`);

            let returnDate = null;
            if (schedule.returnTime) {
                const retDate = new Date(date);
                // Use UTC methods for return leg date calculations.
                // The fixed seven-day offset is the round-trip modelling gap
                // tracked in #69; this generator preserves existing behaviour.
                retDate.setUTCDate(date.getUTCDate() + 7);
                const retDateStr = retDate.toISOString().split('T')[0];
                returnDate = new Date(`${retDateStr}T${schedule.returnTime}:00Z`);
            }

            // Check if flight instance already exists
            let flight = await prisma.flight.findFirst({
                where: {
                    flightNumber: schedule.flightNumber,
                    departureDate: departureDate
                }
            });
            let created = false;

            if (!flight) {
                try {
                    flight = await prisma.flight.create({
                        data: {
                            flightNumber: schedule.flightNumber,
                            airline: schedule.airline,
                            from: schedule.from,
                            to: schedule.to,
                            departureDate,
                            returnDate,
                            price: schedule.price,
                            status: 'ON_TIME',
                            firstClassRows: schedule.firstClassRows ?? 3,
                            businessRows: schedule.businessRows ?? 3,
                            premiumEconomyRows: schedule.premiumEconomyRows ?? 4,
                            economyRows: schedule.economyRows ?? 20,
                            seatPattern: schedule.seatPattern ?? 'ABC-DEF'
                        }
                    });
                    created = true;
                } catch (error) {
                    // Gracefully handle concurrent insertion race condition (Prisma unique constraint error P2002)
                    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
                        flight = await prisma.flight.findFirst({
                            where: {
                                flightNumber: schedule.flightNumber,
                                departureDate: departureDate
                            }
                        });
                    } else {
                        throw error;
                    }
                }
            }

            if (flight) {
                ensured.push({ flight, created });
            }
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
}
