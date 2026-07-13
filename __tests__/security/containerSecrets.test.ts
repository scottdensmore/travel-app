import fs from 'fs';
import path from 'path';

const repositoryRoot = path.resolve(__dirname, '../..');

function readRepositoryFile(filePath: string): string {
    return fs.readFileSync(path.join(repositoryRoot, filePath), 'utf8');
}

describe('container secret protection', () => {
    it('excludes local environment files from the Docker build context', () => {
        const ignoredEntries = readRepositoryFile('.dockerignore')
            .split(/\r?\n/)
            .map((entry) => entry.trim());

        expect(ignoredEntries).toEqual(expect.arrayContaining([
            '.env',
            '.env.*',
            '.agents',
            '.claude',
            '.codex',
            '.cursor',
            '.github',
        ]));
    });

    it('fails the image build if standalone output contains an environment file', () => {
        const dockerfile = readRepositoryFile('Dockerfile');
        const packageJson = readRepositoryFile('package.json');

        expect(dockerfile).toContain(
            `RUN test -z "$(find .next/standalone -type f -name '.env*' -print -quit)"`
        );
        expect(dockerfile).toContain('ENTRYPOINT ["/app/scripts/container-entrypoint.sh"]');
        expect(packageJson).toContain('next build && node scripts/sanitize-standalone.mjs');
    });

    it('injects authentication configuration into the app container at runtime', () => {
        const composeFile = readRepositoryFile('docker-compose.yml');
        const appService = composeFile.slice(
            composeFile.indexOf('  app:'),
            composeFile.indexOf('\n  proxy:')
        );

        expect(composeFile).toContain('NEXTAUTH_URL: ${NEXTAUTH_URL:?NEXTAUTH_URL is required}');
        expect(composeFile).toContain('NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:?NEXTAUTH_SECRET is required}');
        expect(appService).toContain('AUTH_TRUSTED_PROXY_HOPS: "1"');
        expect(appService).toContain('AUTH_EMAIL_FROM:');
        expect(appService).toContain('AUTH_EMAIL_PROVIDER: mailpit');
        expect(appService).toContain('AUTH_EMAIL_API_URL: http://mailpit:8025/api/v1/send');
        expect(appService).toContain('expose:');
        expect(appService).not.toContain('ports:');
    });

    it('provides a loopback-only local test inbox on a pinned security-fixed release', () => {
        const composeFile = readRepositoryFile('docker-compose.yml');

        expect(composeFile).toContain('image: axllent/mailpit:v1.30.0');
        expect(composeFile).toContain('"127.0.0.1:8025:8025"');
    });

    it('publishes the app only through a proxy that replaces forwarded client addresses', () => {
        const composeFile = readRepositoryFile('docker-compose.yml');
        const proxyConfiguration = readRepositoryFile('deploy/nginx.conf');

        expect(composeFile).toContain('proxy:');
        expect(composeFile).toContain('- "3000:8080"');
        expect(composeFile).toContain('./deploy/nginx.conf:/etc/nginx/nginx.conf:ro');
        expect(proxyConfiguration).toContain('proxy_pass http://app:3000;');
        expect(proxyConfiguration).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
        expect(proxyConfiguration).not.toContain('$proxy_add_x_forwarded_for');
        expect(proxyConfiguration).toContain('log_format no_query');
        expect(proxyConfiguration).toContain('$request_method $uri $server_protocol');
        expect(proxyConfiguration).not.toContain('$request_uri');
        expect(proxyConfiguration).not.toContain('$http_referer');
    });

    it('prevents authentication fragments from leaking through referrers', () => {
        const nextConfiguration = readRepositoryFile('next.config.mjs');

        expect(nextConfiguration).toContain("key: 'Referrer-Policy'");
        expect(nextConfiguration).toContain("value: 'no-referrer'");
    });

    it('checks the final container image in CI', () => {
        const workflow = readRepositoryFile('.github/workflows/ci.yml');
        const verificationScript = readRepositoryFile('scripts/verify-container-secrets.sh');

        expect(workflow).toContain('.env.secret-scan');
        expect(workflow).toContain('SECRET_SCAN_SENTINEL="$sentinel"');
        expect(workflow).toContain('docker build --tag travel-app:ci .');
        expect(workflow).toContain('npm audit --omit=dev --audit-level=high');
        expect(workflow).toContain('travel-app:secret-probe');
        expect(workflow).toContain('travel-app:env-layer-probe');
        expect(workflow).toContain('./scripts/verify-container-secrets.sh travel-app:ci');
        expect(verificationScript).toContain('image inspect');
        expect(verificationScript).toContain('export --output');
        expect(verificationScript).toContain('save --output');
        expect(verificationScript).toContain('scan-image-layers.sh');
        expect(verificationScript).toContain('SECRET_SCAN_SENTINEL');
        expect(verificationScript).toContain('AUTH_EMAIL_API_TOKEN');
    });

    it('provides safe configuration and secret-rotation guidance', () => {
        const exampleEnvironment = readRepositoryFile('.env.example');
        const securityGuide = readRepositoryFile('SECURITY.md');

        expect(exampleEnvironment).toContain('DATABASE_URL=');
        expect(exampleEnvironment).toContain('NEXTAUTH_URL=');
        expect(exampleEnvironment).toContain('NEXTAUTH_SECRET=');
        expect(exampleEnvironment.match(/^NEXTAUTH_SECRET=(.*)$/m)?.[1]).toBe('');
        expect(exampleEnvironment).toContain('AUTH_TRUSTED_PROXY_HOPS=0');
        expect(exampleEnvironment).toContain('AUTH_EMAIL_FROM=');
        expect(exampleEnvironment).toContain('AUTH_EMAIL_PROVIDER=mailpit');
        expect(exampleEnvironment).toContain('AUTH_EMAIL_API_URL=http://localhost:8025/api/v1/send');
        expect(securityGuide).toContain('Rotate exposed secrets');
        expect(securityGuide).toContain('Rebuild and redeploy');
    });
});
