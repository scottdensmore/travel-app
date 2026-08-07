/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import { CANCELLED_BOOKING, heldSeats } from '@/lib/seatOccupancy';

/**
 * The rule stays in one place.
 *
 * It was written out in four queries, and the three issues queued against those
 * same call sites — holds (#74), payments (#75), cancellation rules (#76) —
 * would each have had to find all four and change them identically. This is the
 * guard that keeps the next one from quietly adding a fifth (#143).
 */
function sourceFiles(dir: string): string[] {
    const full = path.join(process.cwd(), dir);
    if (!fs.existsSync(full)) return [];
    const walk = (current: string): string[] =>
        fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
            const next = path.join(current, entry.name);
            if (entry.isDirectory()) {
                return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : walk(next);
            }
            return /\.tsx?$/.test(entry.name) ? [next] : [];
        });
    return walk(full);
}

describe('seat occupancy', () => {
    it('says a seat is held unless its booking was cancelled', () => {
        expect(CANCELLED_BOOKING).toBe('CANCELLED');
        expect(heldSeats()).toEqual({
            leg: { booking: { status: { not: 'CANCELLED' } } },
        });
    });

    it('is the only place that knows the rule', () => {
        // Textual, with the limits that implies in both directions: an
        // equivalent re-inlining spelled `NOT: { status: 'CANCELLED' }` or
        // `notIn` slips past it, and any future query legitimately filtering
        // bookings by status will trip it. It catches the copy-paste that
        // actually happens; it is not a proof.
        const inlined = ['app', 'lib', 'components']
            .flatMap(sourceFiles)
            .filter((file) => !file.endsWith(path.join('lib', 'seatOccupancy.ts')))
            .filter((file) => /booking:\s*\{\s*status:\s*\{\s*not:/.test(fs.readFileSync(file, 'utf8')))
            .map((file) => path.relative(process.cwd(), file));

        const failure = inlined.length === 0 ? '' : [
            `The occupancy rule is written out again in: ${inlined.join(', ')}.`,
            'Call `heldSeats(...)` from lib/seatOccupancy on the query instead,',
            'so holds, payments and cancellation rules each change it once.',
        ].join(' ');

        expect(failure).toBe('');
    });

    it('applies the rule last, so a caller cannot drop it', () => {
        // A `leg` key spread after the rule would have removed the booking
        // filter entirely — valid TypeScript, no inlined string for the guard
        // above to find, and cancelled seats silently counted as held.
        expect(heldSeats({ leg: { flightId: 1 } })).toEqual({
            leg: { booking: { status: { not: 'CANCELLED' } } },
        });
    });

    it('is about bookings, not about cancelled flights', () => {
        // `searchFlightsAction` filters `Flight.status`, which reads almost
        // identically and answers a different question: a cancelled flight is
        // not a released seat. Nothing here should tempt the two together.
        expect(heldSeats()).not.toHaveProperty('status');
        expect(heldSeats()).not.toHaveProperty('flight');
    });
});
