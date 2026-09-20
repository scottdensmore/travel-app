/** @jest-environment node */
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
    it('returns HTTP 200 with ok status, timestamp, uptimeSeconds, and version', async () => {
        const response = await GET();

        expect(response.status).toBe(200);
        const data = await response.json();

        expect(data).toMatchObject({
            status: 'ok',
            timestamp: expect.any(String),
            uptimeSeconds: expect.any(Number),
            version: expect.any(String),
        });
        expect(Number.isFinite(data.uptimeSeconds)).toBe(true);
        expect(data.uptimeSeconds).toBeGreaterThanOrEqual(0);
        expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
    });

    it('sets Cache-Control: no-store, max-age=0 header', async () => {
        const response = await GET();

        expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    });

    it('uses APP_VERSION environment variable if provided', async () => {
        const originalEnv = process.env.APP_VERSION;
        process.env.APP_VERSION = '1.2.3-custom';

        try {
            const response = await GET();
            const data = await response.json();
            expect(data.version).toBe('1.2.3-custom');
        } finally {
            if (originalEnv !== undefined) {
                process.env.APP_VERSION = originalEnv;
            } else {
                delete process.env.APP_VERSION;
            }
        }
    });
});
