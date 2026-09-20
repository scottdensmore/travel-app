import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { exportUserData } from '@/lib/privacyService';

export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return new NextResponse(
            JSON.stringify({ error: 'Unauthorized' }),
            {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }

    try {
        const userId = session.user.id;
        const data = await exportUserData(userId);
        const jsonContent = JSON.stringify(data, null, 2);

        return new NextResponse(jsonContent, {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="travel-app-data-export-${userId}.json"`,
                'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
        });
    } catch (error) {
        console.error('Error generating personal data export:', error);
        return new NextResponse(
            JSON.stringify({ error: 'Failed to generate personal data export.' }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }
}
