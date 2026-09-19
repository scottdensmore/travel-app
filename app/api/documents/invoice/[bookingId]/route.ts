import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '../../../../../lib/prisma';
import { generateInvoicePDF } from '../../../../../lib/documents/pdfGenerator';
import { authOptions } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { bookingId: string } }
) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const bookingId = parseInt(params.bookingId, 10);
  if (isNaN(bookingId)) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      passengers: true,
      legs: {
        include: {
          flight: {
            include: {
              fromAirport: true,
              toAirport: true
            }
          },
          seatAssignments: true
        }
      }
    }
  });

  if (!booking) {
    return new NextResponse('Not Found', { status: 404 });
  }

  if (booking.userId !== session.user.id && session.user.role !== 'ADMIN') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const pdfBuffer = await generateInvoicePDF(booking);

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${booking.reference}.pdf"`
    }
  });
}
