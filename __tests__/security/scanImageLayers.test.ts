import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const scanner = path.resolve(__dirname, '../../scripts/scan-image-layers.sh');

function createClassicImageArchive(files: Record<string, string>): {
    archive: string;
    root: string;
} {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-app-image-archive-'));
    const layerRoot = path.join(root, 'layer-root');
    const archiveRoot = path.join(root, 'archive-root');
    const layerDirectory = path.join(archiveRoot, 'layer-sha');
    const layerArchive = path.join(layerDirectory, 'layer.tar');
    const archive = path.join(root, 'image.tar');

    fs.mkdirSync(layerRoot);
    fs.mkdirSync(layerDirectory, { recursive: true });

    for (const [fileName, content] of Object.entries(files)) {
        const filePath = path.join(layerRoot, fileName);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
    }

    expect(spawnSync('tar', ['-cf', layerArchive, '-C', layerRoot, '.']).status).toBe(0);
    fs.writeFileSync(path.join(archiveRoot, 'manifest.json'), '[]');
    expect(spawnSync('tar', ['-cf', archive, '-C', archiveRoot, '.']).status).toBe(0);

    return { archive, root };
}

/**
 * A `tar` that lists an archive normally but refuses to extract its contents,
 * so the scanner meets a layer it cannot read rather than one that is clean.
 */
function createUnextractableTarShim(root: string): string {
    const realTar = spawnSync('sh', ['-c', 'command -v tar'], { encoding: 'utf8' }).stdout.trim();
    expect(realTar).not.toBe('');

    const binDirectory = path.join(root, 'shim-bin');
    const shim = path.join(binDirectory, 'tar');
    fs.mkdirSync(binDirectory, { recursive: true });
    fs.writeFileSync(shim, [
        '#!/bin/sh',
        'for arg in "$@"; do',
        '  if [ "$arg" = "-xOf" ]; then',
        '    echo "simulated extraction failure" >&2',
        '    exit 2',
        '  fi',
        'done',
        `exec ${realTar} "$@"`,
        '',
    ].join('\n'));
    fs.chmodSync(shim, 0o755);

    return binDirectory;
}

describe('image layer archive scanner', () => {
    const temporaryDirectories: string[] = [];

    afterEach(() => {
        for (const directory of temporaryDirectories.splice(0)) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('rejects an environment file in a classic Docker archive layer', () => {
        const fixture = createClassicImageArchive({ '.env.secret': 'not-a-real-secret' });
        temporaryDirectories.push(fixture.root);

        const result = spawnSync('sh', [scanner, fixture.archive], { encoding: 'utf8' });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Environment file found in an image layer.');
    });

    it('accepts a clean classic archive and reports scanned layers', () => {
        const fixture = createClassicImageArchive({ 'app/server.js': 'console.log("ok");' });
        temporaryDirectories.push(fixture.root);

        const result = spawnSync('sh', [scanner, fixture.archive], { encoding: 'utf8' });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Scanned 1 image layer.');
    });

    it('rejects sentinel content in a classic archive layer', () => {
        const sentinel = 'classic-archive-secret-sentinel';
        const fixture = createClassicImageArchive({ 'app/bundle.js': sentinel });
        temporaryDirectories.push(fixture.root);

        const result = spawnSync('sh', [scanner, fixture.archive, sentinel], {
            encoding: 'utf8',
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Secret-scan sentinel found in an image layer.');
    });

    it('fails closed when a layer cannot be read for sentinel scanning', () => {
        // A layer whose contents cannot be read has not been shown to be clean.
        // Reporting success here would let an unscanned layer ship.
        const sentinel = 'unreadable-layer-sentinel';
        const fixture = createClassicImageArchive({ 'app/bundle.js': 'console.log("ok");' });
        temporaryDirectories.push(fixture.root);
        const binDirectory = createUnextractableTarShim(fixture.root);

        const result = spawnSync('sh', [scanner, fixture.archive, sentinel], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` },
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Unable to read layer contents');
    });

    it('fails closed when an archive contains no readable layers', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-app-empty-archive-'));
        const archiveRoot = path.join(root, 'archive-root');
        const archive = path.join(root, 'image.tar');
        temporaryDirectories.push(root);
        fs.mkdirSync(archiveRoot);
        fs.writeFileSync(path.join(archiveRoot, 'manifest.json'), '[]');
        expect(spawnSync('tar', ['-cf', archive, '-C', archiveRoot, '.']).status).toBe(0);

        const result = spawnSync('sh', [scanner, archive], { encoding: 'utf8' });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('No readable image layers found in archive.');
    });
});
