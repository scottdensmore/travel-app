/**
 * Fill flight inventory ahead of customer demand.
 *
 * Run from a scheduler so that searching never has to create inventory (#71).
 * Idempotent and safe to run concurrently with itself, so a missed or repeated
 * run needs no recovery.
 *
 *   npm run inventory:generate           # default horizon
 *   npm run inventory:generate -- 90     # 90 days
 *   INVENTORY_HORIZON_DAYS=90 npm run inventory:generate
 */
import { loadEnvConfig } from '@next/env';
import FlightScheduleService, { MAX_HORIZON_DAYS } from '../lib/FlightScheduleService';
import { prisma } from '../lib/prisma';

/** Covers the common booking window without generating a year of inventory nightly. */
const DEFAULT_HORIZON_DAYS = 30;

function requestedHorizonDays(): number {
    const raw = process.argv[2] ?? process.env.INVENTORY_HORIZON_DAYS ?? String(DEFAULT_HORIZON_DAYS);
    const days = Number(raw);

    if (!Number.isInteger(days) || days < 1 || days > MAX_HORIZON_DAYS) {
        throw new Error(
            `Horizon must be a whole number of days from 1 to ${MAX_HORIZON_DAYS}; received "${raw}".`
        );
    }

    return days;
}

async function main() {
    loadEnvConfig(process.cwd());

    const days = requestedHorizonDays();
    const summary = await new FlightScheduleService().generateFlightsForHorizon(new Date(), days);

    // Single-line JSON so a scheduler's log collector can parse the run.
    console.log(JSON.stringify({ event: 'inventory.horizon.generated', ...summary }));
}

main()
    .catch((error: unknown) => {
        console.error(JSON.stringify({
            event: 'inventory.horizon.failed',
            error: error instanceof Error ? error.message : String(error),
        }));
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
