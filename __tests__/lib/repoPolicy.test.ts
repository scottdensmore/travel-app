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
});
