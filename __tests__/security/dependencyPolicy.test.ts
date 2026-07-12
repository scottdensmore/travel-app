import fs from 'fs';
import path from 'path';

const repositoryRoot = path.resolve(__dirname, '../..');
const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
);
const packageLock = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8')
);

function dependencyMajor(name: string): number {
    const version = packageJson.dependencies[name] ?? packageJson.devDependencies[name];
    const major = Number(version?.match(/\d+/)?.[0]);

    if (!Number.isInteger(major)) {
        throw new Error(`Unable to determine dependency major for ${name}`);
    }

    return major;
}

function versionAtLeast(version: string, minimum: string): boolean {
    const stableVersion = /^\d+\.\d+\.\d+$/;
    if (!stableVersion.test(version) || !stableVersion.test(minimum)) return false;

    const actualParts = version.split('.').map(Number);
    const minimumParts = minimum.split('.').map(Number);

    for (let index = 0; index < Math.max(actualParts.length, minimumParts.length); index++) {
        const actual = actualParts[index] ?? 0;
        const required = minimumParts[index] ?? 0;
        if (actual !== required) return actual > required;
    }

    return true;
}

describe('production dependency policy', () => {
    it('uses a supported Next.js and Node.js baseline', () => {
        const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');

        expect(dependencyMajor('next')).toBeGreaterThanOrEqual(16);
        expect(dependencyMajor('eslint-config-next')).toBeGreaterThanOrEqual(16);
        expect(dependencyMajor('eslint')).toBeGreaterThanOrEqual(9);
        expect(packageJson.engines?.node).toBe('>=20.9.0');
        expect(packageJson.scripts?.lint).toBe('eslint app components lib');
        expect(dockerfile).toContain('FROM node:22');
    });

    it('uses the Next.js 16 proxy file convention', () => {
        expect(fs.existsSync(path.join(repositoryRoot, 'proxy.ts'))).toBe(true);
        expect(fs.existsSync(path.join(repositoryRoot, 'middleware.ts'))).toBe(false);
    });

    it('pins reviewed compatibility overrides for vulnerable legacy chains', () => {
        expect(packageJson.overrides?.['next-auth']?.uuid).toBe('^11.1.1');
        expect(packageJson.overrides?.['react-simple-maps']).toEqual({
            'd3-geo': '^3.1.1',
            'd3-selection': '^3.0.0',
            'd3-zoom': '^3.0.0',
        });
        expect(packageJson.overrides?.['d3-color']).toBe('^3.1.0');
        expect(packageJson.overrides?.['d3-transition']).toBe('^3.0.1');
        expect(packageJson.overrides?.postcss).toBe('^8.5.15');
    });

    it('keeps test and build tooling out of production dependencies', () => {
        const developmentOnlyDependencies = [
            '@testing-library/jest-dom',
            '@testing-library/react',
            'jest-environment-jsdom',
            'tailwindcss-animate',
        ];

        for (const dependency of developmentOnlyDependencies) {
            expect(packageJson.dependencies).not.toHaveProperty(dependency);
            expect(packageJson.devDependencies).toHaveProperty(dependency);
        }
    });

    it('locks a patched form-data release used by test tooling', () => {
        const version = packageLock.packages?.['node_modules/form-data']?.version;

        expect(typeof version).toBe('string');
        expect(versionAtLeast(version, '4.0.6')).toBe(true);
    });

    it('declares and locks a patched Babel core release', () => {
        const declaredVersion = packageJson.devDependencies?.['@babel/core']?.match(
            /\d+\.\d+\.\d+/
        )?.[0];
        const lockedVersion = packageLock.packages?.['node_modules/@babel/core']?.version;

        expect(typeof declaredVersion).toBe('string');
        expect(typeof lockedVersion).toBe('string');
        expect(versionAtLeast(declaredVersion, '7.29.6')).toBe(true);
        expect(versionAtLeast(lockedVersion, '7.29.6')).toBe(true);
    });

    it('fails closed when comparing malformed or prerelease versions', () => {
        expect(versionAtLeast('5.invalid', '4.0.6')).toBe(false);
        expect(versionAtLeast('4.1.bad', '4.0.6')).toBe(false);
        expect(versionAtLeast('4.0.7-beta.1', '4.0.6')).toBe(false);
        expect(versionAtLeast('4.0.5', '4.0.6')).toBe(false);
        expect(versionAtLeast('4.0.6', '4.0.6')).toBe(true);
        expect(versionAtLeast('4.0.7', '4.0.6')).toBe(true);
    });

    it('requires a high-severity production audit in CI', () => {
        const workflow = fs.readFileSync(
            path.join(repositoryRoot, '.github/workflows/ci.yml'),
            'utf8'
        );

        expect(workflow).toContain('npm audit --omit=dev --audit-level=high');
    });
});
