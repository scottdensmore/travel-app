/* eslint-disable @typescript-eslint/no-explicit-any */
import PDFDocument from 'pdfkit';

export async function generateETicketPDF(booking: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // Header branding
      doc.fontSize(24).text('Mona Airways', { align: 'center' });
      doc.moveDown();
      doc.fontSize(16).text('E-Ticket', { align: 'center' });
      doc.moveDown();

      // Booking Details
      doc.fontSize(12).text(`Booking Reference: ${booking.reference}`);
      doc.text(`Booking Date: ${new Date(booking.createdAt).toLocaleDateString()}`);
      doc.moveDown();

      // Passenger Manifest
      doc.fontSize(14).text('Passengers', { underline: true });
      booking.passengers?.forEach((p: any) => {
        doc.fontSize(12).text(`${p.firstName} ${p.lastName}`);
      });
      doc.moveDown();

      // Flight Segments
      doc.fontSize(14).text('Itinerary', { underline: true });
      booking.legs?.forEach((leg: any) => {
        const flight = leg.flight;
        doc.fontSize(12).text(`Flight: ${flight?.flightNumber}`);
      });
      
      doc.moveDown();
      doc.fontSize(10).text('Verification Block', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export async function generateInvoicePDF(booking: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // Header branding
      doc.fontSize(24).text('Mona Airways Inc.', { align: 'center' });
      doc.fontSize(10).text('Tax ID: MA-123456789', { align: 'center' });
      doc.moveDown();
      doc.fontSize(16).text('Tax Invoice & Receipt', { align: 'center' });
      doc.moveDown();

      // Booking Details
      doc.fontSize(12).text(`Booking Reference: ${booking.reference}`);
      doc.text(`Billing Date: ${new Date(booking.createdAt).toLocaleDateString()}`);
      doc.moveDown();

      // Billing Breakdown
      doc.fontSize(14).text('Itemized Breakdown', { underline: true });
      const total = booking.totalPriceCents ? (booking.totalPriceCents / 100).toFixed(2) : '0.00';
      doc.fontSize(12).text(`Total Amount: ${booking.currency} ${total}`);
      doc.moveDown();

      doc.fontSize(14).text('Payment Summary', { underline: true });
      doc.fontSize(12).text(`Payment Intent: ${booking.paymentIntentId || 'N/A'}`);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
