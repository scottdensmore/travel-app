import nextConfig from '../../next.config.mjs';

describe('Security Headers & Content Security Policy (Issue #89)', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        Object.defineProperty(process.env, 'NODE_ENV', {
            value: originalEnv,
            configurable: true,
        });
    });

    it('defines an async headers function on nextConfig', () => {
        expect(typeof nextConfig.headers).toBe('function');
    });

    it('applies headers to /:path*', async () => {
        const headerRoutes = await nextConfig.headers!();
        const rootRoute = headerRoutes.find((route) => route.source === '/:path*');
        expect(rootRoute).toBeDefined();
    });

    it('includes all required security headers with expected values', async () => {
        const headerRoutes = await nextConfig.headers!();
        const rootRoute = headerRoutes.find((route) => route.source === '/:path*');
        expect(rootRoute).toBeDefined();

        const headersMap = new Map(
            rootRoute!.headers.map((h) => [h.key, h.value])
        );

        expect(headersMap.get('Strict-Transport-Security')).toBe(
            'max-age=63072000; includeSubDomains; preload'
        );
        expect(headersMap.get('X-Frame-Options')).toBe('DENY');
        expect(headersMap.get('X-Content-Type-Options')).toBe('nosniff');
        expect(headersMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        expect(headersMap.get('Permissions-Policy')).toBe(
            'camera=(), microphone=(), geolocation=(), browsing-topics=()'
        );
        expect(headersMap.get('X-DNS-Prefetch-Control')).toBe('on');
        expect(headersMap.has('Content-Security-Policy')).toBe(true);
    });

    it('configures all required Content-Security-Policy directives', async () => {
        const headerRoutes = await nextConfig.headers!();
        const rootRoute = headerRoutes.find((route) => route.source === '/:path*');
        expect(rootRoute).toBeDefined();

        const headersMap = new Map(
            rootRoute!.headers.map((h) => [h.key, h.value])
        );

        const csp = headersMap.get('Content-Security-Policy') || '';
        const directives = new Map<string, string[]>();

        csp.split(';').map((part) => part.trim()).filter(Boolean).forEach((part) => {
            const [directive, ...sources] = part.split(/\s+/);
            directives.set(directive, sources);
        });

        expect(directives.get('default-src')).toEqual(["'self'"]);
        expect(directives.get('script-src')).toEqual(["'self'", "'unsafe-eval'", "'unsafe-inline'"]);
        expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
        expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:']);
        expect(directives.get('font-src')).toEqual(["'self'"]);
        expect(directives.get('connect-src')).toEqual([
            "'self'",
            'https://api.stripe.com',
        ]);
        expect(directives.get('connect-src')).not.toContain(
            'https://nominatim.openstreetmap.org'
        );
        expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
        expect(directives.get('form-action')).toEqual(["'self'"]);
        expect(directives.get('base-uri')).toEqual(["'self'"]);
        expect(directives.get('object-src')).toEqual(["'none'"]);
    });

    it('enables upgrade-insecure-requests only in production', async () => {
        // Non-production (e.g. test / development)
        Object.defineProperty(process.env, 'NODE_ENV', {
            value: 'development',
            configurable: true,
        });
        let headerRoutes = await nextConfig.headers!();
        let rootRoute = headerRoutes.find((route) => route.source === '/:path*');
        let headersMap = new Map(rootRoute!.headers.map((h) => [h.key, h.value]));
        let csp = headersMap.get('Content-Security-Policy') || '';
        expect(csp).not.toContain('upgrade-insecure-requests');

        // Production
        Object.defineProperty(process.env, 'NODE_ENV', {
            value: 'production',
            configurable: true,
        });
        headerRoutes = await nextConfig.headers!();
        rootRoute = headerRoutes.find((route) => route.source === '/:path*');
        headersMap = new Map(rootRoute!.headers.map((h) => [h.key, h.value]));
        csp = headersMap.get('Content-Security-Policy') || '';
        expect(csp).toContain('upgrade-insecure-requests');
    });
});
