/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '@/lib/brand';

/**
 * One product identity.
 *
 * The application called itself Mona Airways while every seeded flight was
 * operated by "Gemini Airways", so the site and its own inventory disagreed
 * about who the customer was buying from (#72).
 *
 * These scan the source rather than a rendered tree: the point is that no such
 * wording exists anywhere, including in views no test renders.
 */
function sourceFiles(dir: string, extensions: string[]): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return entry.name === 'node_modules' || entry.name.startsWith('.')
                ? []
                : sourceFiles(full, extensions);
        }
        return extensions.some((ext) => entry.name.endsWith(ext)) ? [full] : [];
    });
}

/**
 * Files allowed to name the old carrier, and why.
 *
 * A legitimate match belongs here rather than being reworded out of the way —
 * see the failure message below.
 */
const ALLOWED = [
    // The brand module names the wording it replaced, in order to explain
    // itself; that is documentation, not a second identity.
    path.join('lib', 'brand.ts'),
];

describe('product identity', () => {
    const shipped = ['app', 'components', 'lib', 'prisma']
        // `.prisma` too: the schema is shipped source in a scanned directory
        // and can carry the name in a `@default`, where nothing else would see
        // it. Without this, `prisma` contributed only `seed.ts`.
        .flatMap((dir) => sourceFiles(path.join(process.cwd(), dir), ['.ts', '.tsx', '.prisma']))
        .filter((file) => !ALLOWED.some((allowed) => file.endsWith(allowed)));

    it('scans the source it claims to scan', () => {
        expect(shipped.length).toBeGreaterThan(20);
        expect(shipped.some((f) => f.endsWith('FlightData.ts'))).toBe(true);
        expect(shipped.some((f) => f.endsWith('titlebar.tsx'))).toBe(true);
        expect(shipped.some((f) => f.endsWith('schema.prisma'))).toBe(true);
    });

    it('carries no carrier name other than the product', () => {
        // Bare and case-insensitive. `/Gemini Airways/` missed the boarding
        // pass, which shouted it as `GEMINI AIRWAYS` and gave the logo an
        // `alt="Gemini"` — so the guard passed while the string shipped on the
        // e-ticket handed to every customer (#158).
        //
        // Assets are not reachable from here: `public/img/gemini-background.jpg`
        // has the old name painted on the aircraft, which is a picture problem
        // rather than a string one, and belongs to #140.
        const offenders = shipped
            .filter((file) => /gemini/i.test(fs.readFileSync(file, 'utf8')))
            .map((f) => path.relative(process.cwd(), f));

        // The pattern is bare on purpose — `alt="Gemini"` was half of #158, so
        // requiring "airways" would reintroduce the hole. The cost is that a
        // legitimate match is possible: the word is a constellation, a NASA
        // programme an Orlando city guide might mention, and the name of a
        // model family. Say so here, so whoever hits it exempts the file rather
        // than rewriting prose that was never the problem.
        const failure = offenders.length === 0 ? '' : [
            `Old carrier name found in: ${offenders.join(', ')}.`,
            'If this is the product identity leaking, use BRAND from lib/brand.ts.',
            'If the match is legitimate, add the file to ALLOWED at the top of this test.',
        ].join(' ');

        expect(failure).toBe('');
    });

    it('gives every public route a title and a description', () => {
        const publicRoutes = sourceFiles(path.join(process.cwd(), 'app'), ['page.tsx'])
            // Admin sits behind staff MFA and is not a public route.
            .filter((file) => !file.includes(`${path.sep}admin${path.sep}`))
            // Dynamic segments that only redirect have nothing of their own.
            .filter((file) => !file.includes('['));

        const missing = publicRoutes.filter((file) => {
            const source = fs.readFileSync(file, 'utf8');
            return !source.includes('export const metadata')
                || !source.includes('description:');
        });

        expect(missing.map((f) => path.relative(process.cwd(), f))).toEqual([]);
    });

    it('names the product in the root title, and templates the rest', () => {
        // Next applies a title template to child segments only, so the page
        // sharing the root segment has to spell the name out itself.
        const layout = fs.readFileSync(path.join(process.cwd(), 'app/layout.tsx'), 'utf8');
        expect(layout).toContain('template:');
        const home = fs.readFileSync(path.join(process.cwd(), 'app/page.tsx'), 'utf8');
        expect(home).toContain('pageTitle(');
    });

    it('states the airline code as the prefix its flight numbers use', () => {
        // A flight number that did not start with the designator would make the
        // code decorative.
        const seed = fs.readFileSync(path.join(process.cwd(), 'lib/data/FlightData.ts'), 'utf8');
        expect(seed).toContain('${BRAND.airlineCode}');
        expect(BRAND.airlineCode).toMatch(/^[A-Z0-9]{2}$/);
    });
});
