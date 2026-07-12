import fs from 'fs';
import path from 'path';

const repositoryRoot = path.resolve(__dirname, '../..');
const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
);

function dependencyMajor(name: string): number {
    const version = packageJson.dependencies[name] ?? packageJson.devDependencies[name];
    const major = Number(version?.match(/\d+/)?.[0]);

    if (!Number.isInteger(major)) {
        throw new Error(`Unable to determine dependency major for ${name}`);
    }

    return major;
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

    it('requires a high-severity production audit in CI', () => {
        const workflow = fs.readFileSync(
            path.join(repositoryRoot, '.github/workflows/ci.yml'),
            'utf8'
        );

        expect(workflow).toContain('npm audit --omit=dev --audit-level=high');
    });
});
