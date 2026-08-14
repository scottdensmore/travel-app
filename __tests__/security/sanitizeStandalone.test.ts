import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    runStandaloneSanitizer,
    runStandaloneSanitizerCli,
} from '../../scripts/sanitize-standalone-core.mjs';

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
        const output = { log: jest.fn(), error: jest.fn() };
        const status = runStandaloneSanitizer(temporaryDirectory, output);

        expect(status).toBe(0);
        expect(fs.existsSync(path.join(temporaryDirectory, '.env'))).toBe(false);
        expect(fs.existsSync(path.join(temporaryDirectory, '.env.production'))).toBe(false);
        expect(fs.existsSync(path.join(temporaryDirectory, 'nested/.env.local'))).toBe(false);
        expect(fs.existsSync(path.join(temporaryDirectory, 'server.js'))).toBe(true);
        expect(output.log).toHaveBeenCalledWith('Removed 3 environment files from standalone output.');
        expect(output.error).not.toHaveBeenCalled();
    });

    it('fails clearly when the standalone directory does not exist', () => {
        const missingDirectory = path.join(temporaryDirectory, 'missing');
        const output = { log: jest.fn(), error: jest.fn() };
        const runtime: { exitCode?: number } = {};
        runStandaloneSanitizerCli(missingDirectory, output, runtime);

        expect(runtime.exitCode).toBe(1);
        expect(output.error).toHaveBeenCalledWith(`Standalone output not found: ${missingDirectory}`);
        expect(output.log).not.toHaveBeenCalled();
    });
});
