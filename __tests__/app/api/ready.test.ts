/** @jest-environment node */
import { GET } from '@/app/api/ready/route';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        $queryRaw: jest.fn(),
    },
}));

const mockedPrisma = prisma as unknown as {
    $queryRaw: jest.Mock;
};

describe('GET /api/ready', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/travelapp';
        process.env.NEXTAUTH_SECRET = 'supersecretkeythathasatleast32charsforsecurity';
        delete process.env.READY_PROBE_TIMEOUT_MS;
        mockedPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('returns HTTP 200 when database and configuration are healthy', async () => {
        const response = await GET();

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');

        const data = await response.json();
        expect(data).toEqual({
            status: 'ready',
            checks: {
                database: 'ok',
                environment: 'ok',
            },
            latencyMs: expect.any(Number),
        });
        expect(data.latencyMs).toBeGreaterThanOrEqual(0);
        expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('returns HTTP 503 with error details when database query fails', async () => {
        mockedPrisma.$queryRaw.mockRejectedValue(new Error('Connection terminated unexpectedly'));

        const response = await GET();

        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');

        const data = await response.json();
        expect(data.status).toBe('unhealthy');
        expect(data.checks.database).toBe('error');
        expect(data.checks.error).toContain('Connection terminated unexpectedly');
        expect(data.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns HTTP 503 when database query times out', async () => {
        process.env.READY_PROBE_TIMEOUT_MS = '50';
        mockedPrisma.$queryRaw.mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 500))
        );

        const response = await GET();

        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');

        const data = await response.json();
        expect(data.status).toBe('unhealthy');
        expect(data.checks.database).toBe('error');
        expect(data.checks.error).toMatch(/timed out/i);
    });

    it('returns HTTP 503 when critical configuration DATABASE_URL is missing', async () => {
        delete process.env.DATABASE_URL;

        const response = await GET();

        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');

        const data = await response.json();
        expect(data.status).toBe('unhealthy');
        expect(data.checks.environment).toBe('error');
        expect(data.checks.error).toContain('DATABASE_URL');
    });

    it('returns HTTP 503 when critical configuration NEXTAUTH_SECRET is missing', async () => {
        delete process.env.NEXTAUTH_SECRET;

        const response = await GET();

        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');

        const data = await response.json();
        expect(data.status).toBe('unhealthy');
        expect(data.checks.environment).toBe('error');
        expect(data.checks.error).toContain('NEXTAUTH_SECRET');
    });

    it('returns HTTP 503 when multiple configuration variables are missing', async () => {
        delete process.env.DATABASE_URL;
        delete process.env.NEXTAUTH_SECRET;

        const response = await GET();

        expect(response.status).toBe(503);
        const data = await response.json();
        expect(data.status).toBe('unhealthy');
        expect(data.checks.environment).toBe('error');
        expect(data.checks.error).toContain('DATABASE_URL');
        expect(data.checks.error).toContain('NEXTAUTH_SECRET');
    });
});
