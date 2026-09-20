import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const DEFAULT_TIMEOUT_MS = 5000;
const CRITICAL_ENV_VARS = ['DATABASE_URL', 'NEXTAUTH_SECRET'] as const;

function getTimeoutMs(): number {
    const configured = process.env.READY_PROBE_TIMEOUT_MS || process.env.DATABASE_QUERY_TIMEOUT_MS;
    if (configured) {
        const parsed = parseInt(configured, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return DEFAULT_TIMEOUT_MS;
}

async function checkDatabase(timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Database probe timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timeoutId.unref?.();
    });

    try {
        await Promise.race([prisma.$queryRaw`SELECT 1`, timeoutPromise]);
        return { ok: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Database query failed';
        return { ok: false, error: message };
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

function checkEnvironment(): { ok: boolean; missing: string[] } {
    const missing: string[] = [];
    for (const key of CRITICAL_ENV_VARS) {
        if (!process.env[key]?.trim()) {
            missing.push(key);
        }
    }
    return {
        ok: missing.length === 0,
        missing,
    };
}

export async function GET() {
    const startTime = Date.now();
    const timeoutMs = getTimeoutMs();

    const [dbResult, envResult] = await Promise.all([
        checkDatabase(timeoutMs),
        Promise.resolve(checkEnvironment()),
    ]);

    const latencyMs = Math.max(0, Date.now() - startTime);
    const isReady = dbResult.ok && envResult.ok;

    const errors: string[] = [];
    if (!dbResult.ok && dbResult.error) {
        errors.push(dbResult.error);
    }
    if (!envResult.ok && envResult.missing.length > 0) {
        errors.push(`Missing critical configuration: ${envResult.missing.join(', ')}`);
    }

    const checks: {
        database: 'ok' | 'error';
        environment: 'ok' | 'error';
        error?: string;
    } = {
        database: dbResult.ok ? 'ok' : 'error',
        environment: envResult.ok ? 'ok' : 'error',
    };

    if (!isReady && errors.length > 0) {
        checks.error = errors.join('; ');
    }

    const headers = {
        'Cache-Control': 'no-store, max-age=0',
    };

    if (isReady) {
        return NextResponse.json(
            {
                status: 'ready',
                checks,
                latencyMs,
            },
            {
                status: 200,
                headers,
            }
        );
    }

    return NextResponse.json(
        {
            status: 'unhealthy',
            checks,
            latencyMs,
        },
        {
            status: 503,
            headers,
        }
    );
}
