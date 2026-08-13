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
        // e-ticket handed to every customer (#158). The assets are covered
        // separately below.
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

    describe('identity assets', () => {
        // #140 asked for this once a replacement mark existed. A source scan
        // cannot see a picture, but it can see a filename, and an SVG is text —
        // which is what let `alt="Gemini"` and a `gemini-background.jpg` both
        // survive a scan that read neither.
        const publicFiles = (dir: string): string[] => {
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
                const full = path.join(dir, entry.name);
                return entry.isDirectory() ? publicFiles(full) : [full];
            });
        };
        const shippedAssets = publicFiles(path.join(process.cwd(), 'public'));

        const REQUIRED = [
            path.join('public', 'img', 'logo.svg'),
            path.join('public', 'img', 'og-image.jpg'),
            path.join('public', 'img', 'hero-routes.svg'),
            // These three are wired by filename convention rather than by an
            // import, so nothing else would break if they vanished.
            path.join('app', 'icon.svg'),
            path.join('app', 'apple-icon.png'),
            path.join('app', 'favicon.ico'),
        ];

        it('ships every mark the interface asks for', () => {
            // Reported as a list so a failure names what is missing rather than
            // just saying false.
            const missing = REQUIRED.filter((asset) => !fs.existsSync(path.join(process.cwd(), asset)));

            expect(missing).toEqual([]);
        });

        it('ships a favicon a browser can actually decode', () => {
            // Hand-packed: a 22-byte ICO header wrapping a PNG. Getting the
            // colour type wrong shipped an RGB payload that Next's decoder
            // rejected, which failed the build — and existence alone is happy
            // with a text file called `favicon.ico`.
            const ico = fs.readFileSync(path.join(process.cwd(), 'app', 'favicon.ico'));

            expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]);
            const offset = ico.readUInt32LE(18);
            const payload = ico.subarray(offset);
            expect([...payload.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            // Byte 25 of a PNG is the IHDR colour type; 6 is RGBA.
            expect(payload[25]).toBe(6);
        });

        it('names no asset after the carrier it replaced', () => {
            // `app/` too, not just `public/`: the icons Next serves by filename
            // convention live there, so a `gemini-mark.png` beside them would
            // otherwise ship unseen.
            const iconFiles = fs.readdirSync(path.join(process.cwd(), 'app'), { withFileTypes: true })
                .filter((entry) => entry.isFile())
                .map((entry) => path.join(process.cwd(), 'app', entry.name));

            const named = [...shippedAssets, ...iconFiles]
                .filter((file) => /gemini/i.test(path.basename(file)))
                .map((f) => path.relative(process.cwd(), f));

            expect(named).toEqual([]);
        });

        it('points the hero at the artwork, and spares a phone the wide version', () => {
            const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');

            expect(css).toContain('/img/hero-routes.svg');
            // Bounded to one viewport: `.home` is the whole search page, so
            // `cover` grew the art with the results list.
            expect(css).toContain('background-size: 100% 100vh');
            // The narrow variant paints gradients instead, so the arcs are not
            // magnified across the search controls.
            expect(css).toMatch(/@media \(max-width: 900px\) \{\s*\.home \{[^}]*radial-gradient/);
        });

        it('declares the social card where it can resolve its own address', () => {
            // `metadataBase` resolves at render, so a card in the root layout
            // baked the build machine's URL into every prerendered auth page.
            // The home page renders per request; the auth pages do not.
            const layout = fs.readFileSync(path.join(process.cwd(), 'app/layout.tsx'), 'utf8');
            const home = fs.readFileSync(path.join(process.cwd(), 'app/page.tsx'), 'utf8');

            expect(layout).toContain('metadataBase');
            expect(layout).not.toContain('openGraph');
            expect(home).toContain('openGraph');
            expect(home).toContain('/img/og-image.jpg');
            expect(home).toContain("dynamic = 'force-dynamic'");
        });

        it('carries no old identity inside a vector asset', () => {
            // Vectors are text, so unlike the photograph this replaced, they
            // are genuinely reachable from here.
            const offenders = [...shippedAssets, path.join(process.cwd(), 'app', 'icon.svg')]
                .filter((file) => file.endsWith('.svg'))
                .filter((file) => /gemini/i.test(fs.readFileSync(file, 'utf8')))
                .map((f) => path.relative(process.cwd(), f));

            expect(offenders).toEqual([]);
        });
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
