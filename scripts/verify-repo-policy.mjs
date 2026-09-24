import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SENSITIVE_VARIABLES = [
    'NEXTAUTH_SECRET',
    'PASSENGER_DATA_ENCRYPTION_KEYS',
    'STAFF_MFA_ENCRYPTION_KEYS',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'AUTH_EMAIL_API_TOKEN',
];

const BINARY_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.gif',
    '.webp',
    '.pdf',
    '.zip',
    '.tar',
    '.gz',
]);

const ALLOWED_FILES = new Set([
    '.github/workflows/ci.yml',
    '.env.example',
    'scripts/verify-repo-policy.mjs',
]);

const ALLOWED_DIRECTORIES = [
    '__tests__/',
    'tests/',
];

const HISTORICAL_EXPOSED_VALUE = ['super', 'secret', 'jwt', 'passphrase', '12345'].join('');

const UNENCRYPTED_CREDENTIAL_PATTERNS = [
    { name: 'Private Key', regex: /BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY/ },
    { name: 'Google API Key', regex: /AIza[0-9A-Za-z-_]{35}/ },
    { name: 'Live Stripe Secret Key', regex: /sk_live_[0-9a-zA-Z]{24,}/ },
    { name: 'Live Stripe Webhook Secret', regex: /whsec_[0-9a-zA-Z]{32,}/ },
];

/**
 * Checks if a relative path is allowed to contain test values or fixtures.
 * @param {string} filePath
 * @returns {boolean}
 */
function isPathAllowedForSecrets(filePath) {
    if (ALLOWED_FILES.has(filePath)) return true;
    return ALLOWED_DIRECTORIES.some((dir) => filePath.startsWith(dir));
}

/**
 * Checks if a file is an environment configuration file that should never be tracked.
 * @param {string} filePath
 * @returns {boolean}
 */
function isDisallowedEnvFile(filePath) {
    const base = path.basename(filePath);
    return base === '.env' || (base.startsWith('.env.') && base !== '.env.example');
}

/**
 * Returns line number of a character index in text.
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
function getLineNumber(text, index) {
    return text.slice(0, index).split('\n').length;
}

/**
 * Check 1: Verify .npmrc enforces engine-strict.
 */
function checkNpmrc(repoRoot, violations) {
    const npmrcPath = path.join(repoRoot, '.npmrc');
    if (!fs.existsSync(npmrcPath)) {
        violations.push('.npmrc: file is missing; engine-strict=true must be configured.');
        return;
    }
    const content = fs.readFileSync(npmrcPath, 'utf8');
    if (!/^engine-strict\s*=\s*true$/m.test(content)) {
        violations.push(".npmrc: must contain 'engine-strict=true' to enforce supported Node engine baseline at install.");
    }
}

/**
 * Check 2: Verify package.json engines specifies Node 22.
 */
function checkEngines(packageJson, violations) {
    const nodeEngine = packageJson.engines?.node;
    if (nodeEngine !== '>=22 <23') {
        violations.push(`package.json: 'engines.node' must be '>=22 <23' (found: '${nodeEngine ?? 'none'}').`);
    }
}

/**
 * Check 3: Verify dev/build/test tooling stays out of dependencies.
 */
function checkDependencySeparation(packageJson, violations) {
    const dependencies = packageJson.dependencies || {};
    const devDependencies = packageJson.devDependencies || {};

    const isDevOnlyPackage = (name) => {
        if (name.startsWith('@babel/')) return true;
        if (name.startsWith('@playwright/')) return true;
        if (name.startsWith('@testing-library/')) return true;
        if (name.startsWith('@types/')) return true;
        if (name.startsWith('eslint') || name.startsWith('@eslint/')) return true;
        if (name.startsWith('jest') || name.startsWith('@jest/')) return true;
        if (name === 'prisma') return true; // Prisma CLI belongs in devDependencies; @prisma/client is runtime
        if (name === 'tailwindcss' || name.startsWith('tailwindcss-') || name.startsWith('@tailwindcss/')) return true;
        if (name === 'ts-node' || name === 'typescript') return true;
        if (name === 'prettier' || name.startsWith('prettier-')) return true;
        if (name === 'vitest' || name === 'cypress') return true;
        if (name === 'webpack' || name === 'rollup' || name === 'vite' || name === 'esbuild') return true;
        if (name.startsWith('@swc/')) return true;
        if (name === 'postcss') return true;
        return false;
    };

    for (const dep of Object.keys(dependencies)) {
        if (isDevOnlyPackage(dep)) {
            violations.push(`package.json: dev/build/test dependency '${dep}' found in 'dependencies'; move it to 'devDependencies'.`);
        }
        if (Object.prototype.hasOwnProperty.call(devDependencies, dep)) {
            violations.push(`package.json: dependency '${dep}' is declared in both 'dependencies' and 'devDependencies'.`);
        }
    }
}

/**
 * Check 4: Verify critical overrides for vulnerable legacy chains.
 */
function checkOverrides(packageJson, violations) {
    const overrides = packageJson.overrides;
    if (!overrides || typeof overrides !== 'object') {
        violations.push("package.json: 'overrides' section is missing or invalid.");
        return;
    }

    // @auth/core
    const authCore = overrides['next-auth']?.['@auth/core'];
    if (authCore !== '0.41.3') {
        violations.push(`package.json overrides: 'next-auth' -> '@auth/core' must be pinned to '0.41.3' (found: '${authCore ?? 'none'}').`);
    }

    // uuid
    const uuid = overrides['next-auth']?.['uuid'];
    if (!uuid) {
        violations.push("package.json overrides: 'next-auth' -> 'uuid' pin is missing.");
    }

    // sharp
    const sharp = overrides['next']?.['sharp'];
    if (!sharp) {
        violations.push("package.json overrides: 'next' -> 'sharp' pin is missing.");
    }

    // postcss
    const postcss = overrides['postcss'];
    if (!postcss) {
        violations.push("package.json overrides: 'postcss' pin is missing.");
    }

    // nanoid
    const nanoid = overrides['nanoid'];
    if (!nanoid) {
        violations.push("package.json overrides: 'nanoid' pin is missing.");
    }

    // react-simple-maps d3 overrides
    const rsmD3Geo = overrides['react-simple-maps']?.['d3-geo'];
    const rsmD3Selection = overrides['react-simple-maps']?.['d3-selection'];
    const rsmD3Zoom = overrides['react-simple-maps']?.['d3-zoom'];
    if (!rsmD3Geo || !rsmD3Selection || !rsmD3Zoom) {
        violations.push("package.json overrides: 'react-simple-maps' d3 pins (d3-geo, d3-selection, d3-zoom) must be present.");
    }

    // d3-color
    if (!overrides['d3-color']) {
        violations.push("package.json overrides: 'd3-color' pin is missing.");
    }

    // d3-transition
    if (!overrides['d3-transition']) {
        violations.push("package.json overrides: 'd3-transition' pin is missing.");
    }
}

/**
 * Check 5: Scan git-tracked files for committed secrets and literal values.
 */
function checkCommittedSecrets(repoRoot, violations, output) {
    let trackedFiles;
    try {
        const rawOutput = execFileSync('git', ['ls-files', '-z'], {
            cwd: repoRoot,
            encoding: 'utf8',
        });
        trackedFiles = rawOutput.split('\0').filter(Boolean);
    } catch (error) {
        violations.push(`Git scan error: unable to list tracked files (${error.message}).`);
        return;
    }

    let scannedCount = 0;

    for (const relativePath of trackedFiles) {
        if (isDisallowedEnvFile(relativePath)) {
            violations.push(`Committed environment file found: '${relativePath}'. Local environment files with secrets must never be tracked in git.`);
            continue;
        }

        const ext = path.extname(relativePath).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
            continue;
        }

        if (isPathAllowedForSecrets(relativePath)) {
            continue;
        }

        const fullPath = path.join(repoRoot, relativePath);
        if (!fs.existsSync(fullPath)) {
            continue;
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        scannedCount += 1;

        // Check sensitive variable assignments to quoted literals
        for (const variable of SENSITIVE_VARIABLES) {
            const quotedPattern = new RegExp(String.raw`${variable}\s*[:=]\s*\\?["']([^"'\\]+)`, 'g');
            for (const match of content.matchAll(quotedPattern)) {
                const line = getLineNumber(content, match.index ?? 0);
                violations.push(`Committed secret literal in ${relativePath}:${line} - ${variable} assigned hardcoded literal.`);
            }

            // Check unquoted assignment, e.g. VAR=val (excluding shell/Compose variable expansions)
            const unquotedPattern = new RegExp(String.raw`^[ \t]*(?:export[ \t]+)?${variable}\s*=\s*([^$#\s"'\`][^\r\n]*)`, 'gm');
            for (const match of content.matchAll(unquotedPattern)) {
                const line = getLineNumber(content, match.index ?? 0);
                violations.push(`Committed secret assignment in ${relativePath}:${line} - ${variable} assigned literal value.`);
            }
        }

        // Check for historical leaked value from incident ff161ca
        if (content.includes(HISTORICAL_EXPOSED_VALUE)) {
            violations.push(`Exposed credential found in ${relativePath}: contains historical secret value from ff161ca.`);
        }

        // Check for unencrypted production credentials / keys
        for (const { name, regex } of UNENCRYPTED_CREDENTIAL_PATTERNS) {
            const match = regex.exec(content);
            if (match) {
                const line = getLineNumber(content, match.index);
                violations.push(`Unencrypted credential pattern '${name}' detected in ${relativePath}:${line}.`);
            }
        }
    }

    output.log(`✔ Committed secrets and credentials guard verified across ${scannedCount} tracked text files.`);
}

/**
 * Main verification function.
 * @param {{ repoRoot?: string, output?: typeof console }} options
 * @returns {{ success: boolean, violations: string[] }}
 */
export function verifyRepoPolicy({ repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = console } = {}) {
    const violations = [];

    // 1. .npmrc engine-strict
    checkNpmrc(repoRoot, violations);
    if (!violations.some((v) => v.startsWith('.npmrc'))) {
        output.log('✔ .npmrc engine-strict configuration verified.');
    }

    // Read package.json
    const pkgPath = path.join(repoRoot, 'package.json');
    let packageJson = {};
    if (!fs.existsSync(pkgPath)) {
        violations.push('package.json: file is missing.');
    } else {
        try {
            packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        } catch (error) {
            violations.push(`package.json: failed to parse JSON (${error.message}).`);
        }
    }

    // 2. Engines baseline
    checkEngines(packageJson, violations);
    if (!violations.some((v) => v.startsWith('package.json: \'engines.node\''))) {
        output.log('✔ package.json Node 22 engine baseline verified.');
    }

    // 3. Dependency separation
    checkDependencySeparation(packageJson, violations);
    if (!violations.some((v) => v.includes('dependency'))) {
        output.log('✔ Dependency separation verified (no dev/build/test tooling in dependencies).');
    }

    // 4. Critical overrides
    checkOverrides(packageJson, violations);
    if (!violations.some((v) => v.startsWith('package.json overrides:'))) {
        output.log('✔ Critical vulnerability override pins verified.');
    }

    // 5. Committed secrets
    checkCommittedSecrets(repoRoot, violations, output);

    return {
        success: violations.length === 0,
        violations,
    };
}

/**
 * CLI runner.
 * @param {{ repoRoot?: string, output?: typeof console }} options
 * @returns {number} Exit code (0 for success, 1 for failure)
 */
export function runCli(options = {}) {
    const output = options.output ?? console;
    output.log('Verifying repository policy...');
    const result = verifyRepoPolicy(options);

    if (result.success) {
        output.log('\n✔ All repository policy checks passed.');
        return 0;
    }

    output.error(`\n✖ Repository policy check failed with ${result.violations.length} violation(s):\n`);
    for (const violation of result.violations) {
        output.error(`  - ${violation}`);
    }
    return 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    process.exitCode = runCli();
}
