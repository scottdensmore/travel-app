/**
 * Report how far ahead flight inventory reaches, and fail when it runs short.
 *
 * Searching no longer generates inventory (#71), so a scheduler that has
 * stopped is invisible until customers start seeing empty results. Run this
 * from a monitor and alert on a non-zero exit.
 *
 *   npm run inventory:check           # default requirement
 *   npm run inventory:check -- 60     # require 60 days of coverage
 *   INVENTORY_REQUIRED_DAYS=60 npm run inventory:check
 */
import { loadEnvConfig } from '@next/env';
import { MAX_BOOKING_LEAD_DAYS } from '../lib/dates';
import FlightScheduleService from '../lib/FlightScheduleService';
import { prisma } from '../lib/prisma';

/**
 * The generator targets the full booking window, so a month of remaining
 * coverage is a month of warning before any customer sees a gap.
 */
const DEFAULT_REQUIRED_DAYS = 30;

function requiredDays(): number {
    const raw = process.argv[2] ?? process.env.INVENTORY_REQUIRED_DAYS ?? String(DEFAULT_REQUIRED_DAYS);
    const days = Number(raw);

    if (!Number.isInteger(days) || days < 1 || days > MAX_BOOKING_LEAD_DAYS) {
        throw new Error(
            `Required coverage must be a whole number of days from 1 to ${MAX_BOOKING_LEAD_DAYS}; received "${raw}".`
        );
    }

    return days;
}

async function main() {
    loadEnvConfig(process.cwd());

    const coverage = await new FlightScheduleService().reportInventoryCoverage(requiredDays());

    // Single-line JSON so a monitor's log collector can parse the result.
    console.log(JSON.stringify({ event: 'inventory.coverage.checked', ...coverage }));

    if (!coverage.isSufficient) {
        const starved = coverage.schedules
            .filter(({ daysCovered }) => daysCovered < coverage.requiredDays)
            .map(({ flightNumber, coveredThroughDate }) => `${flightNumber} through ${coveredThroughDate ?? 'never'}`)
            .join(', ');

        console.error(
            `Inventory coverage is ${coverage.shortestDaysCovered} days, below the required `
            + `${coverage.requiredDays}. Short schedules: ${starved}.`
        );
        process.exitCode = 1;
    }
}

main()
    .catch((error: unknown) => {
        console.error(JSON.stringify({
            event: 'inventory.coverage.failed',
            error: error instanceof Error ? error.message : String(error),
        }));
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
