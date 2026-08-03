/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * No control may point at `#`.
 *
 * A link to `#` looks like navigation and does nothing: it either sits inert or
 * jumps to the top of the page. #70 asks that every visible control work, and
 * the ones that could not -- reward search, multicity, check-in -- were removed
 * rather than left as promises the app could not keep.
 *
 * This scans the source rather than a rendered tree, because the point is that
 * no such control exists anywhere, including in views no test renders.
 */
function sourceFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return entry.name === 'node_modules' || entry.name.startsWith('.')
                ? []
                : sourceFiles(full);
        }
        return entry.name.endsWith('.tsx') ? [full] : [];
    });
}

describe('every visible control goes somewhere', () => {
    const files = ['app', 'components'].flatMap((dir) =>
        sourceFiles(path.join(process.cwd(), dir))
    );

    it('scans the components it claims to scan', () => {
        // Guards the guard: a broken walk would pass everything silently.
        expect(files.length).toBeGreaterThan(10);
        expect(files.some((file) => file.endsWith('titlebar.tsx'))).toBe(true);
        expect(files.some((file) => file.endsWith('flightBookingForm.tsx'))).toBe(true);
    });

    it.each([['href="#"'], ["href='#'"], ['href={"#"}']])(
        'has no %s anywhere in app or components',
        (pattern) => {
            const offenders = files.filter((file) =>
                fs.readFileSync(file, 'utf8').includes(pattern)
            );
            expect(offenders.map((file) => path.relative(process.cwd(), file))).toEqual([]);
        }
    );
});
