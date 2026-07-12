import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const sanitizer = path.resolve(__dirname, '../../scripts/sanitize-standalone.mjs');

describe('standalone environment-file sanitizer', () => {
    let temporaryDirectory: string;

    beforeEach(() => {
        temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-app-standalone-'));
        fs.mkdirSync(path.join(temporaryDirectory, 'nested'));
        fs.writeFileSync(path.join(temporaryDirectory, '.env'), 'SECRET=local');
        fs.writeFileSync(path.join(temporaryDirectory, '.env.production'), 'SECRET=production');
        fs.writeFileSync(path.join(temporaryDirectory, 'nested/.env.local'), 'SECRET=nested');
        fs.writeFileSync(path.join(temporaryDirectory, 'server.js'), 'console.log("server");');
    });

    afterEach(() => {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    it('removes environment files without changing application files', () => {
        const result = spawnSync('node', [sanitizer, temporaryDirectory], {
            encoding: 'utf8',
        });

        expect(result.status).toBe(0);
        expect(fs.existsSync(path.join(temporaryDirectory, '.env'))).toBe(false);
        expect(fs.existsSync(path.join(temporaryDirectory, '.env.production'))).toBe(false);
        expect(fs.existsSync(path.join(temporaryDirectory, 'nested/.env.local'))).toBe(false);
        expect(fs.existsSync(path.join(temporaryDirectory, 'server.js'))).toBe(true);
        expect(result.stdout).toContain('Removed 3 environment files from standalone output.');
    });

    it('fails clearly when the standalone directory does not exist', () => {
        const missingDirectory = path.join(temporaryDirectory, 'missing');
        const result = spawnSync('node', [sanitizer, missingDirectory], {
            encoding: 'utf8',
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`Standalone output not found: ${missingDirectory}`);
    });
});
