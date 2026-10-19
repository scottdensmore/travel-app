import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { verifyRepoPolicy } from '../../scripts/verify-repo-policy.mjs';

const REPO_ROOT = path.resolve(__dirname, '../..');

function createCompliantFixtureRepo(): string {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-app-repo-policy-'));
    execFileSync('git', ['init', '-q'], { cwd: tempDir });

    fs.copyFileSync(path.join(REPO_ROOT, '.npmrc'), path.join(tempDir, '.npmrc'));
    fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(tempDir, 'package.json'));
    fs.copyFileSync(path.join(REPO_ROOT, 'Dockerfile'), path.join(tempDir, 'Dockerfile'));

    execFileSync('git', ['add', '.npmrc', 'package.json', 'Dockerfile'], { cwd: tempDir });
    return tempDir;
}

describe('verifyRepoPolicy Node 22 baseline and Dockerfile guard', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = createCompliantFixtureRepo();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('passes when Dockerfile uses FROM node:22 AS base', () => {
        const output = { log: jest.fn(), error: jest.fn() };
        const result = verifyRepoPolicy({ repoRoot: tempDir, output: output as unknown as Console });

        expect(result.success).toBe(true);
        expect(result.violations).toEqual([]);
    });

    it('flags a Dockerfile whose base image is FROM node:26 AS base', () => {
        const dockerfilePath = path.join(tempDir, 'Dockerfile');
        const original = fs.readFileSync(dockerfilePath, 'utf8');
        fs.writeFileSync(
            dockerfilePath,
            original.replace(/^FROM\s+node:22\s+AS\s+base/m, 'FROM node:26 AS base')
        );

        const output = { log: jest.fn(), error: jest.fn() };
        const result = verifyRepoPolicy({ repoRoot: tempDir, output: output as unknown as Console });

        expect(result.success).toBe(false);
        expect(result.violations).toContain(
            'Dockerfile base image must use the Node 22 LTS line (FROM node:22) to match package.json engines.node (>=22 <23).'
        );
    });

    it('passes when Dockerfile is absent in a synthetic fixture directory', () => {
        fs.rmSync(path.join(tempDir, 'Dockerfile'));

        const output = { log: jest.fn(), error: jest.fn() };
        const result = verifyRepoPolicy({ repoRoot: tempDir, output: output as unknown as Console });

        expect(result.success).toBe(true);
        expect(result.violations).toEqual([]);
    });

    it.each(['^22.19.17', '~22.0.0', '22.19.17', '22'])(
        'passes when devDependencies["@types/node"] targets Node 22 (%s)',
        (versionRange) => {
            const pkgPath = path.join(tempDir, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            pkg.devDependencies['@types/node'] = versionRange;
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

            const output = { log: jest.fn(), error: jest.fn() };
            const result = verifyRepoPolicy({ repoRoot: tempDir, output: output as unknown as Console });

            expect(result.success).toBe(true);
            expect(result.violations).toEqual([]);
        }
    );

    it.each(['^25.0.0', '^20.11.0', '24.0.0'])(
        'flags devDependencies["@types/node"] when it drifts from the Node 22 major line (%s)',
        (versionRange) => {
            const pkgPath = path.join(tempDir, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            pkg.devDependencies['@types/node'] = versionRange;
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

            const output = { log: jest.fn(), error: jest.fn() };
            const result = verifyRepoPolicy({ repoRoot: tempDir, output: output as unknown as Console });

            expect(result.success).toBe(false);
            expect(result.violations).toContain(
                `package.json: devDependencies["@types/node"] must target the Node 22 major line (found: '${versionRange}').`
            );
        }
    );

    it('flags when devDependencies["@types/node"] is missing', () => {
        const pkgPath = path.join(tempDir, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        delete pkg.devDependencies['@types/node'];
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

        const output = { log: jest.fn(), error: jest.fn() };
        const result = verifyRepoPolicy({ repoRoot: tempDir, output: output as unknown as Console });

        expect(result.success).toBe(false);
        expect(result.violations).toContain(
            `package.json: devDependencies["@types/node"] must target the Node 22 major line (found: 'none').`
        );
    });
});

