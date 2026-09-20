import { NextResponse } from 'next/server';
import packageJson from '@/package.json';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json(
        {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            version: process.env.APP_VERSION || packageJson.version || '0.1.0',
        },
        {
            status: 200,
            headers: {
                'Cache-Control': 'no-store, max-age=0',
            },
        }
    );
}
