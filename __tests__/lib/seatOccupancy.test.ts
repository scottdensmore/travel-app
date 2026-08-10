/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import { heldSeats } from '@/lib/seatOccupancy';

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
    it('says a seat is held until it was released', () => {
        // The rule used to be a join to the booking's status. The seat row
        // answers it now, which is what lets a released row keep the number the
        // traveller actually held (#76).
        expect(heldSeats()).toEqual({
            releasedAt: null,
        });
    });

    it('is the only place that knows the rule', () => {
        // Textual, with the limits that implies in both directions: an
        // equivalent re-inlining spelled `releasedAt: { equals: null }` slips
        // past it, and a query legitimately writing that literal will trip it.
        // It catches the copy-paste that actually happens; it is not a proof.
        //
        // The pattern tracks the rule. It used to look for the join this made
        // — `booking: { status: { not: ... } }` — which no longer exists
        // anywhere and could no longer plausibly be written, so the guard was
        // firing on nothing while the re-inlining that *is* now possible went
        // straight past it (#76).
        const inlined = ['app', 'lib', 'components']
            .flatMap(sourceFiles)
            .filter((file) => !file.endsWith(path.join('lib', 'seatOccupancy.ts')))
            .filter((file) => /releasedAt:\s*null/.test(fs.readFileSync(file, 'utf8')))
            .map((file) => path.relative(process.cwd(), file));

        const failure = inlined.length === 0 ? '' : [
            `The occupancy rule is written out again in: ${inlined.join(', ')}.`,
            'Call `heldSeats(...)` from lib/seatOccupancy on the query instead,',
            'so holds, payments and cancellation rules each change it once.',
        ].join(' ');

        expect(failure).toBe('');
    });

    it('applies the rule last, so a caller cannot drop it', () => {
        // A `releasedAt` key spread after the rule would have removed the
        // filter entirely — valid TypeScript, no inlined string for the guard
        // above to find, and released seats silently counted as held.
        expect(heldSeats({ releasedAt: { not: null } })).toEqual({
            releasedAt: null,
        });
        // A caller's own conditions are kept; only the rule wins.
        expect(heldSeats({ flightId: 1 })).toEqual({ flightId: 1, releasedAt: null });
    });

    it('is about bookings, not about cancelled flights', () => {
        // `searchFlightsAction` filters `Flight.status`, which reads almost
        // identically and answers a different question: a cancelled flight is
        // not a released seat. Nothing here should tempt the two together.
        expect(heldSeats()).not.toHaveProperty('status');
        expect(heldSeats()).not.toHaveProperty('flight');
    });
});
