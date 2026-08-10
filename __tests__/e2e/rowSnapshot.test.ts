/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import { describeLeakedRows, rowsAddedDuringRun } from '@/e2e/helpers/rowSnapshot';

const repositoryRoot = path.resolve(__dirname, '../..');

/**
 * The comparison a Playwright run is judged by.
 *
 * `global-setup` cannot delete accounts, because it cannot tell a run's account
 * from a developer's (#173). Two snapshots can, and only this arithmetic stands
 * between "the suite cleans up after itself" and three specs that did not
 * (#213). Its edges are worth pinning, because every one of them fails the same
 * way: silently, by reporting nothing.
 */
describe('rows added during a run', () => {
    it('reports a row that appeared and stayed', () => {
        const added = rowsAddedDuringRun(
            { User: ['before'] },
            { User: ['before', 'during'] },
        );

        expect(added).toEqual({ User: ['during'] });
    });

    it('ignores rows that were already there', () => {
        // The database a developer runs against is not empty, and none of it is
        // the suite's to answer for.
        expect(rowsAddedDuringRun({ User: ['a', 'b'] }, { User: ['b', 'a'] })).toEqual({});
    });

    it('ignores a row that appeared and was cleaned up', () => {
        expect(rowsAddedDuringRun({ User: ['a'] }, { User: [] })).toEqual({});
    });

    it('omits tables with nothing to report rather than listing them empty', () => {
        const added = rowsAddedDuringRun(
            { User: [], Review: [] },
            { User: ['new'], Review: [] },
        );

        expect(Object.keys(added)).toEqual(['User']);
    });

    it('counts every row when a table is missing from the baseline', () => {
        // A snapshot that failed to record a table has to read as loud rather
        // than as clean: treating absent as "nothing was there" is the one
        // wrong answer that looks like success.
        expect(rowsAddedDuringRun({}, { User: ['a', 'b'] })).toEqual({ User: ['a', 'b'] });
    });
});

describe('the report', () => {
    it('is null when the run left nothing behind', () => {
        expect(describeLeakedRows({})).toBeNull();
        expect(describeLeakedRows({ User: [] })).toBeNull();
    });

    it('names the rows, because the identifier says which spec to fix', () => {
        const message = describeLeakedRows({ User: ['guidetest-1@example.com'] });

        expect(message).toContain('guidetest-1@example.com');
        expect(message).toContain('User (1)');
        expect(message).toContain('test.afterAll');
    });

    it('caps a long list but still says how many there were', () => {
        const message = describeLeakedRows({ User: Array.from({ length: 9 }, (_, i) => `u${i}`) })!;

        expect(message).toContain('User (9)');
        expect(message).toContain('u0, u1, u2, u3, u4');
        expect(message).toContain('and 4 more');
        expect(message).not.toContain('u8');
    });

    it('says an interrupted run can explain it', () => {
        // Whoever reads this mid-failure needs to know a broken test can
        // produce it, or they go looking for a leak that is not there.
        expect(describeLeakedRows({ User: ['a'] })).toMatch(/interrupted/);
    });
});

describe('the guard is wired into a run', () => {
    /**
     * Read as code, with the comments taken out.
     *
     * A plain text search is satisfied by the call it is looking for sitting in
     * a comment, which is what commenting one out leaves behind -- so the
     * check that is supposed to notice the removal passes on the wreckage of
     * it. Behaviour is what actually holds this: `global-teardown` fails a run
     * whose baseline was never recorded, so a Playwright run catches it too.
     * This is the faster half of the same answer.
     */
    const readE2eCode = (file: string) =>
        fs.readFileSync(path.join(repositoryRoot, 'e2e', file), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');

    it('has global-setup record the baseline', () => {
        expect(readE2eCode('global-setup.ts'))
            .toContain('recordRunBaseline(await captureRowSnapshot())');
    });

    it('has global-teardown compare against it and fail the run', () => {
        const teardown = readE2eCode('global-teardown.ts');

        expect(teardown).toContain('rowsAddedDuringRun');
        expect(teardown).toContain('throw new Error(problem)');
    });
});
