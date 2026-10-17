/** @jest-environment node */
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { generateETicketPDF, generateInvoicePDF } from '@/lib/documents/pdfGenerator';
import { GET as getETicket } from '@/app/api/documents/e-ticket/[bookingId]/route';
import { GET as getInvoice } from '@/app/api/documents/invoice/[bookingId]/route';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({ prisma: { booking: { findUnique: jest.fn() } } }));
jest.mock('@/lib/documents/pdfGenerator', () => ({
    generateETicketPDF: jest.fn(),
    generateInvoicePDF: jest.fn(),
}));

describe.each([
    ['e-ticket', getETicket, generateETicketPDF],
    ['invoice', getInvoice, generateInvoicePDF],
] as const)('%s document route with async params', (name, get, generatePdf) => {
    const request = new NextRequest(`http://localhost/api/documents/${name}/42`);
    const context = (bookingId = '42') => ({ params: Promise.resolve({ bookingId }) });

    beforeEach(() => {
        jest.resetAllMocks();
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'owner', role: 'USER' } });
        (prisma.booking.findUnique as jest.Mock).mockResolvedValue({ id: 42, userId: 'owner', reference: 'BOOK42' });
        (generatePdf as jest.Mock).mockResolvedValue(Buffer.from('%PDF-fixture'));
    });

    it('rejects an unauthenticated request without querying the booking', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        expect((await get(request, context())).status).toBe(401);
        expect(prisma.booking.findUnique).not.toHaveBeenCalled();
    });

    it('awaits the route id and rejects an invalid id', async () => {
        expect((await get(request, context('invalid'))).status).toBe(400);
        expect(prisma.booking.findUnique).not.toHaveBeenCalled();
    });

    it('returns not found for a missing booking', async () => {
        (prisma.booking.findUnique as jest.Mock).mockResolvedValue(null);
        expect((await get(request, context())).status).toBe(404);
        expect(generatePdf).not.toHaveBeenCalled();
    });

    it('preserves ownership checks for another customer', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'other', role: 'USER' } });
        expect((await get(request, context())).status).toBe(403);
        expect(generatePdf).not.toHaveBeenCalled();
    });

    it.each(['USER', 'ADMIN'])('returns the PDF for an authorized %s', async (role) => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: role === 'ADMIN' ? 'admin' : 'owner', role } });
        const response = await get(request, context());
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/pdf');
        expect(response.headers.get('content-disposition')).toContain(`${name}-BOOK42.pdf`);
        expect(await response.text()).toBe('%PDF-fixture');
        expect(prisma.booking.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 } }));
    });
});
