/** @jest-environment node */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const repositoryRoot = path.resolve(__dirname, '../..');

/**
 * CLAUDE.md must stay a pointer. Every coding agent reads AGENTS.md, so project
 * context belongs there; a second file that also carries content drifts from it.
 * The `#` shortcut appends to CLAUDE.md, which is exactly the drift this guards.
 */
const CLAUDE_MD_POINTER = `# travel-app (Mona Airways)

This file is a pointer. All project context and agent rules live in
[AGENTS.md](AGENTS.md), the file every coding agent reads.

Do not add content here. Anything appended to this file — including notes saved
with the \`#\` shortcut — belongs in AGENTS.md instead, and
\`__tests__/docs/agentInstructions.test.ts\` fails the build if this file grows
beyond this pointer.

@AGENTS.md
`;

/**
 * Step 7 splits the checks between the main agent and the `verifier` sub-agent.
 * The verifier runs only what its own definition tells it to, so a check named
 * in one file and absent from the other is owned by nobody and silently never
 * runs. That is not hypothetical: "cross-file regression sweeps" reached the
 * table having never been defined anywhere, and the verifier reported that it
 * could not say whether it had done it.
 *
 * What this catches is a check *deleted* from one side or *reassigned* to the
 * other. What it cannot catch is rewording: the patterns pin a token inside the
 * assigning passage, so "audit every mutant" downgraded to "note any mutant"
 * stays green. Do not read a pass as proof that a check is genuinely owned.
 *
 * It is also a hand-maintained list -- a check added to the table and not to
 * this array is unguarded.
 *
 * Both sides are read from the passage that actually assigns the work, never
 * from the whole file. A first version matched anywhere in either document and
 * was very nearly vacuous: `npm run build` and `npx playwright test` are both
 * named in the Commands block, in Gotchas, and -- worst -- in the verifier's
 * own sentence saying which checks the *main agent* skips. Five of its eight
 * assertions passed on prose that assigns nothing, so a verifier definition
 * that never once told it to build would still have gone green.
 */
const CHECKS_THE_VERIFIER_OWNS: ReadonlyArray<readonly [string, RegExp]> = [
    ['the production build', /npm run build/],
    ['the full Playwright run', /playwright test/],
    ['migrations against a populated database', /populated/],
    ["an audit of the main agent's mutation claims", /mutant/],
    ['a re-run of lint on the final state', /npm run lint/],
    ['a re-run of the typecheck on the final state', /tsc --noEmit/],
];

const STEP_SEVEN_ANCHOR = '**The verifier owns the slow checks';
const VERIFIER_INSTRUCTIONS_ANCHOR = '## The checks';

/**
 * The verifier column of the step 7 table -- the sentence that hands a check
 * over, rather than any mention of it. Reading the column and not the table
 * also means moving a row to the main agent's side fails, which whole-file
 * matching could never see.
 *
 * Both anchors throw rather than returning nothing when they stop matching.
 * `indexOf` returns -1 on a miss and `slice(-1)` is the last character, which
 * fails closed only by accident: every assertion goes red at once, blaming the
 * checks rather than the reworded sentence three lines above the table.
 */
function checksAssignedToTheVerifier(agents: string): string {
    const anchor = agents.indexOf(STEP_SEVEN_ANCHOR);
    if (anchor < 0) {
        throw new Error(
            `AGENTS.md no longer contains the step 7 anchor "${STEP_SEVEN_ANCHOR}". `
            + 'This reads the split from the table beneath it, so re-point the anchor '
            + 'rather than treating the failures below as checks going missing.',
        );
    }

    const rows: string[] = [];
    for (const line of agents.slice(anchor).split('\n').map(current => current.trim())) {
        if (line.startsWith('|')) rows.push(line);
        // Bounded deliberately: an unbounded scan finds the *next* table in the
        // file once this one is deleted, and reads it as the split.
        else if (rows.length > 0 || line.startsWith('#')) break;
    }

    if (rows.length < 3) {
        throw new Error(
            `Expected a table under "${STEP_SEVEN_ANCHOR}" in AGENTS.md, found `
            + `${rows.length} row(s). The split is no longer a table there.`,
        );
    }

    // Which column is which is read from position, so the header has to say so.
    // Swapping the two headings alone otherwise inverts all six assignments at
    // once and every assertion below still passes.
    if (!(rows[0].split('|')[2] ?? '').includes('Verifier')) {
        throw new Error(
            'The second column of the step 7 table in AGENTS.md is no longer the '
            + `verifier's: its header reads "${rows[0]}". Ownership here is read `
            + 'from column position.',
        );
    }

    // `| main | verifier |` splits to ['', ' main ', ' verifier ', ''].
    return rows
        .slice(2) // past the header and its separator
        .map(row => row.split('|')[2] ?? '')
        .join('\n');
}

/**
 * The verifier's instructions to itself, which begin at `## The checks`.
 * Everything above that heading describes the split rather than commanding
 * anything, and is exactly where the false positives above came from.
 */
function instructionsTheVerifierFollows(verifier: string): string {
    const anchor = verifier.indexOf(VERIFIER_INSTRUCTIONS_ANCHOR);
    if (anchor < 0) {
        throw new Error(
            `.claude/agents/verifier.md no longer has a "${VERIFIER_INSTRUCTIONS_ANCHOR}" `
            + 'heading. Everything above it is commentary, so this reads from it down.',
        );
    }
    return verifier.slice(anchor);
}

function readRepositoryFile(filePath: string): string {
    return fs.readFileSync(path.join(repositoryRoot, filePath), 'utf8');
}

function gitFileMode(filePath: string): string {
    return execFileSync('git', ['ls-files', '-s', '--', filePath], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    }).split(' ')[0];
}

describe('agent instruction files', () => {
    it('checks CLAUDE.md out as a plain file on every platform', () => {
        // Mode 120000 is a symlink. Windows checks those out as plain text files
        // holding the target path unless core.symlinks is enabled, which would
        // silently leave the agent reading the string "AGENTS.md".
        expect(gitFileMode('CLAUDE.md')).toBe('100644');
        expect(fs.lstatSync(path.join(repositoryRoot, 'CLAUDE.md')).isSymbolicLink()).toBe(false);
    });

    it('keeps CLAUDE.md a pointer so context is only ever added to AGENTS.md', () => {
        expect(readRepositoryFile('CLAUDE.md')).toBe(CLAUDE_MD_POINTER);
    });

    it('points at an AGENTS.md that still carries the project context', () => {
        const agents = readRepositoryFile('AGENTS.md');

        for (const section of [
            '## Commands',
            '## Environment',
            '## Architecture',
            '## Gotchas',
            '## Code Style',
            '## Development Workflow',
            '## Testing Expectations',
            '## Issue Tracking',
        ]) {
            expect(agents).toContain(section);
        }
    });

    it('names the anchor it lost rather than reporting every check as missing', () => {
        // slice(-1) on a missed indexOf is one character, which no pattern
        // matches -- fail-closed by accident, and unreadable when it happens.
        expect(() => checksAssignedToTheVerifier('# AGENTS\n\nNo split here.\n'))
            .toThrow(/step 7 anchor/);
        expect(() => instructionsTheVerifierFollows('# verifier\n\nNo checks heading.\n'))
            .toThrow(/no longer has a/);
    });

    it('refuses to read ownership from a table whose columns have been swapped', () => {
        const swapped = readRepositoryFile('AGENTS.md')
            .replace('| Main agent | Verifier |', '| Verifier | Main agent |');

        // Position is what carries ownership, so this inverts all six pairs at
        // once while leaving every token exactly where the patterns look.
        expect(() => checksAssignedToTheVerifier(swapped)).toThrow(/no longer the verifier/);
    });

    it('reads the split from step 7 rather than the next table in the file', () => {
        const withTheTableGone = readRepositoryFile('AGENTS.md')
            .replace(/\n\s*\|.*\|/g, '')
            + '\n| Something | Else |\n| --- | --- |\n| a | `npm run build` |\n';

        expect(() => checksAssignedToTheVerifier(withTheTableGone))
            .toThrow(/no longer a table/);
    });

    it.each(CHECKS_THE_VERIFIER_OWNS)(
        'gives the verifier %s in step 7 and instructs it in the verifier definition',
        (_check, pattern) => {
            expect(checksAssignedToTheVerifier(readRepositoryFile('AGENTS.md')))
                .toMatch(pattern);
            expect(instructionsTheVerifierFollows(
                readRepositoryFile('.claude/agents/verifier.md'),
            )).toMatch(pattern);
        },
    );
});
