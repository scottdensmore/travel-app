/** @jest-environment node */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const repositoryRoot = path.resolve(__dirname, '../..');

/**
 * Variables whose values are true secrets. Every one of these is required by
 * validateServerEnvironment and must be injected at runtime, never committed.
 */
const secretVariables = [
    'NEXTAUTH_SECRET',
    'PASSENGER_DATA_ENCRYPTION_KEYS',
    'STAFF_MFA_ENCRYPTION_KEYS',
    'AUTH_EMAIL_API_TOKEN',
];

/**
 * Files permitted to carry throwaway literals. CI values are disposable and
 * scoped to an ephemeral runner; test fixtures never reach a running service.
 */
const filesAllowedToCarryTestValues = ['.github/workflows/ci.yml'];
const directoriesAllowedToCarryTestValues = ['__tests__/'];

const binaryExtensions = ['.png', '.jpg', '.jpeg', '.ico', '.woff', '.woff2', '.ttf', '.gif', '.webp'];

function trackedTextFiles(): string[] {
    return execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean)
        .filter((filePath) => !binaryExtensions.includes(path.extname(filePath).toLowerCase()));
}

function isAllowed(filePath: string): boolean {
    return filesAllowedToCarryTestValues.includes(filePath)
        || directoriesAllowedToCarryTestValues.some((directory) => filePath.startsWith(directory));
}

/**
 * Matches an assignment of a secret variable to a quoted literal, including the
 * escaped quotes produced when a command is embedded in a JSON string. Values
 * that are unquoted are references rather than literals: shell and Compose
 * interpolation (${NEXTAUTH_SECRET:?...}), YAML scalars, and TypeScript
 * expressions such as `const NEXTAUTH_SECRET = requireValue(...)`.
 */
function committedLiterals(contents: string, variable: string): string[] {
    const pattern = new RegExp(String.raw`${variable}\s*[:=]\s*\\?["']([^"'\\]+)`, 'g');
    return Array.from(contents.matchAll(pattern), (match) => match[1].trim()).filter(Boolean);
}

describe('committed secret protection', () => {
    const trackedFiles = trackedTextFiles();

    it('tracks files to scan', () => {
        expect(trackedFiles.length).toBeGreaterThan(50);
        expect(trackedFiles).toContain('.agents/agents/verify/agent.json');
    });

    it.each(secretVariables)('never assigns %s to a literal in a tracked file', (variable) => {
        const offenders = trackedFiles
            .filter((filePath) => !isAllowed(filePath))
            .flatMap((filePath) => {
                const contents = fs.readFileSync(path.join(repositoryRoot, filePath), 'utf8');
                return committedLiterals(contents, variable).map((value) => `${filePath}: ${value}`);
            });

        expect(offenders).toEqual([]);
    });

    it('detects a secret embedded in a JSON-escaped command', () => {
        const embedded = String.raw`Run \"NEXTAUTH_SECRET=\"a-committed-value\" npx playwright test\"`;

        expect(committedLiterals(embedded, 'NEXTAUTH_SECRET')).toEqual(['a-committed-value']);
    });

    it('accepts runtime references rather than literals', () => {
        const compose = 'NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:?NEXTAUTH_SECRET is required}';
        const source = "const NEXTAUTH_SECRET = requireValue(environment, 'NEXTAUTH_SECRET');";
        const template = 'NEXTAUTH_SECRET=';

        expect(committedLiterals(compose, 'NEXTAUTH_SECRET')).toEqual([]);
        expect(committedLiterals(source, 'NEXTAUTH_SECRET')).toEqual([]);
        expect(committedLiterals(template, 'NEXTAUTH_SECRET')).toEqual([]);
    });

    it('keeps agent instructions free of the value exposed in ff161ca', () => {
        const exposedValue = ['super', 'secret', 'jwt', 'passphrase', '12345'].join('');
        const offenders = trackedFiles.filter((filePath) => fs
            .readFileSync(path.join(repositoryRoot, filePath), 'utf8')
            .includes(exposedValue));

        expect(offenders).toEqual([]);
    });
});
