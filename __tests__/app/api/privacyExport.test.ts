/**
 * @jest-environment node
 */
import { GET as getExport } from '../../../app/api/privacy/export/route';
import { getServerSession } from 'next-auth';
import { exportUserData } from '@/lib/privacyService';

jest.mock('next/server', () => ({
    NextRequest: jest.fn(),
    NextResponse: class {
        body: any;
        status: number;
        headers: { get: (k: string) => string | null };
        constructor(body: any, init: any) {
            this.body = body;
            this.status = init?.status || 200;
            const h = init?.headers || {};
            const lower = Object.keys(h).reduce((acc: any, k: string) => {
                acc[k.toLowerCase()] = h[k];
                return acc;
            }, {});
            this.headers = {
                get: (key: string) => lower[key.toLowerCase()] || null,
            };
        }
    },
}));

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

jest.mock('@/lib/privacyService', () => ({
    exportUserData: jest.fn(),
}));

describe('Privacy Export API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns 401 Unauthorized if no active session', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        const req = { url: 'http://localhost/api/privacy/export' } as any;

        const res = await getExport(req);
        expect(res.status).toBe(401);
    });

    it('returns 200 with JSON attachment named travel-app-data-export-[userId].json', async () => {
        const userId = 'usr-export-test';
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: userId, email: 'test@example.com' },
        });

        const mockExportData = {
            user: { id: userId, name: 'Test User', email: 'test@example.com' },
            bookings: [],
            reviews: [],
            notifications: [],
            favorites: [],
            pointsActivity: { currentPoints: 100, currentStatus: 'Bronze', activity: [] },
            metadata: { exportedAt: '2026-09-19T00:00:00.000Z', formatVersion: '1.0.0', userId },
        };
        (exportUserData as jest.Mock).mockResolvedValue(mockExportData);

        const req = { url: 'http://localhost/api/privacy/export' } as any;
        const res = await getExport(req);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/json');
        expect(res.headers.get('content-disposition')).toBe(
            `attachment; filename="travel-app-data-export-${userId}.json"`
        );
        expect(JSON.parse((res as any).body)).toEqual(mockExportData);
    });

    it('returns 500 if exportUserData throws an error', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'usr-error' },
        });
        (exportUserData as jest.Mock).mockRejectedValue(new Error('Database error'));

        const req = { url: 'http://localhost/api/privacy/export' } as any;
        const res = await getExport(req);

        expect(res.status).toBe(500);
    });
});
