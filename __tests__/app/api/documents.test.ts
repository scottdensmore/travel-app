/**
 * @jest-environment node
 */
import { GET as getETicket } from '../../../app/api/documents/e-ticket/[bookingId]/route';
import { GET as getInvoice } from '../../../app/api/documents/invoice/[bookingId]/route';

// Mock dependencies
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
        get: (key: string) => lower[key.toLowerCase()] || null
      };
    }
  }
}));

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  authOptions: {}
}));

jest.mock('../../../lib/documents/pdfGenerator', () => ({
  generateETicketPDF: jest.fn().mockResolvedValue(Buffer.from('eticket')),
  generateInvoicePDF: jest.fn().mockResolvedValue(Buffer.from('invoice')),
}));

jest.mock('../../../lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: jest.fn(),
    }
  }
}));

import { getServerSession } from 'next-auth';
import { prisma } from '../../../lib/prisma';

describe('Documents API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/documents/e-ticket/[bookingId]', () => {
    it('returns 401 if unauthorized', async () => {
      (getServerSession as jest.Mock).mockResolvedValue(null);
      const req = { url: 'http://localhost/api/documents/e-ticket/1' } as any;
      const res = await getETicket(req, { params: { bookingId: '1' } });
      expect(res.status).toBe(401);
    });

    it('returns 404 if booking not found', async () => {
      (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user1' } });
      (prisma.booking.findUnique as jest.Mock).mockResolvedValue(null);
      const req = { url: 'http://localhost/api/documents/e-ticket/1' } as any;
      const res = await getETicket(req, { params: { bookingId: '1' } });
      expect(res.status).toBe(404);
    });

    it('returns 403 if user is not owner or admin', async () => {
      (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user2', role: 'USER' } });
      (prisma.booking.findUnique as jest.Mock).mockResolvedValue({ userId: 'user1' });
      const req = { url: 'http://localhost/api/documents/e-ticket/1' } as any;
      const res = await getETicket(req, { params: { bookingId: '1' } });
      expect(res.status).toBe(403);
    });

    it('returns 200 with PDF if user is owner', async () => {
      (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user1', role: 'USER' } });
      (prisma.booking.findUnique as jest.Mock).mockResolvedValue({ userId: 'user1' });
      const req = { url: 'http://localhost/api/documents/e-ticket/1' } as any;
      const res = await getETicket(req, { params: { bookingId: '1' } });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
    });
  });

  describe('GET /api/documents/invoice/[bookingId]', () => {
    it('returns 200 with PDF if user is owner', async () => {
      (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user1', role: 'USER' } });
      (prisma.booking.findUnique as jest.Mock).mockResolvedValue({ userId: 'user1' });
      const req = { url: 'http://localhost/api/documents/invoice/1' } as any;
      const res = await getInvoice(req, { params: { bookingId: '1' } });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
    });
  });
});
