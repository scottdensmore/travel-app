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
            '## Roadmap Tracking',
        ]) {
            expect(agents).toContain(section);
        }
    });
});
