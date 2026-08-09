/** @jest-environment node */
import fs from 'fs';
import path from 'path';

const testsRoot = path.resolve(__dirname, '..');

/**
 * Every database test file releases its client.
 *
 * It mattered less when each file ran in its own worker and the process exited
 * after it. The database project runs `--runInBand` now, so all of them share
 * one process and a file that never disconnects holds its connections for the
 * rest of the run (#165).
 *
 * Two files were missing it and nothing noticed, which is the reason this is a
 * test rather than a note: the cost only shows up once the project is big
 * enough for it to matter, by which point it is several files to fix.
 */
/**
 * The same extensions the database project runs, from `jest.config.js`. Matching
 * only `.ts` would let a `.database.test.tsx` run serially and skip this guard —
 * which is the shape of hole `DATABASE_TESTS` exists to close on the other side.
 */
const DATABASE_TEST = /\.database\.test\.[jt]sx?$/;

function databaseTestFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return databaseTestFiles(entryPath);
        return DATABASE_TEST.test(entry.name) ? [entryPath] : [];
    });
}

describe('database test files', () => {
    const files = databaseTestFiles(testsRoot);

    it('finds the suites it claims to check', () => {
        // A recursive scan that matched nothing would assert nothing, quietly
        // (#155).
        expect(files.length).toBeGreaterThan(5);
    });

    it.each(files.map((file) => [path.relative(testsRoot, file), file]))(
        '%s disconnects its Prisma client',
        (_name, file) => {
            expect(fs.readFileSync(file, 'utf8')).toContain('prisma.$disconnect()');
        },
    );
});
