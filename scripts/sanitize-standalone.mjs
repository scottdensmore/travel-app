import fs from 'node:fs';
import path from 'node:path';

const standaloneDirectory = path.resolve(process.argv[2] ?? '.next/standalone');

if (!fs.existsSync(standaloneDirectory)) {
    console.error(`Standalone output not found: ${standaloneDirectory}`);
    process.exit(1);
}

let removedCount = 0;

function removeEnvironmentFiles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            removeEnvironmentFiles(entryPath);
        } else if (entry.name === '.env' || entry.name.startsWith('.env.')) {
            fs.rmSync(entryPath);
            removedCount += 1;
        }
    }
}

removeEnvironmentFiles(standaloneDirectory);

console.log(`Removed ${removedCount} environment files from standalone output.`);
