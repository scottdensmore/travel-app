import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string | undefined} directory
 * @param {{ log: (message: string) => void, error: (message: string) => void }} output
 */
export function runStandaloneSanitizer(directory = '.next/standalone', output = console) {
    const standaloneDirectory = path.resolve(directory);

    if (!fs.existsSync(standaloneDirectory)) {
        output.error(`Standalone output not found: ${standaloneDirectory}`);
        return 1;
    }

    let removedCount = 0;

    function removeEnvironmentFiles(currentDirectory) {
        for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
            const entryPath = path.join(currentDirectory, entry.name);

            if (entry.isDirectory()) {
                removeEnvironmentFiles(entryPath);
            } else if (entry.name === '.env' || entry.name.startsWith('.env.')) {
                fs.rmSync(entryPath);
                removedCount += 1;
            }
        }
    }

    removeEnvironmentFiles(standaloneDirectory);
    output.log(`Removed ${removedCount} environment files from standalone output.`);
    return 0;
}

/**
 * @param {string | undefined} directory
 * @param {{ log: (message: string) => void, error: (message: string) => void }} output
 * @param {{ exitCode?: number }} runtime
 */
export function runStandaloneSanitizerCli(
    directory = process.argv[2],
    output = console,
    runtime = process,
) {
    runtime.exitCode = runStandaloneSanitizer(directory, output);
}
