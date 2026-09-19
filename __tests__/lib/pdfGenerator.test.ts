/**
 * @jest-environment node
 */
import { generateETicketPDF, generateInvoicePDF } from '../../lib/documents/pdfGenerator';
import { BookingStatus } from '@prisma/client';

jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn((event, callback) => {
        if (event === 'data') callback(Buffer.from('chunk'));
        if (event === 'end') callback();
      }),
      fontSize: jest.fn().mockReturnThis(),
      text: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
      end: jest.fn()
    };
  });
});

describe('pdfGenerator', () => {
  const mockBooking = {
    id: 1,
    reference: 'MA-12345',
    createdAt: new Date('2026-09-19T10:00:00Z'),
    status: BookingStatus.CONFIRMED,
    totalPriceCents: 150000,
    currency: 'USD',
    userId: 'user1',
    passengers: [
      {
        id: 'p1',
        firstName: 'John',
        lastName: 'Doe',
      }
    ],
    legs: [
      {
        id: 1,
        sequence: 1,
        flight: {
          flightNumber: 'MA101',
          departureTime: new Date('2026-09-20T10:00:00Z'),
          origin: undefined,
          destination: undefined,
          fromAirport: {
            iataCode: 'SFO',
            city: 'San Francisco',
            country: 'USA'
          },
          toAirport: {
            iataCode: 'JFK',
            city: 'New York',
            country: 'USA'
          }
        },
        seatAssignments: [
          {
            passengerId: 'p1',
            seatNumber: '12A',
            cabinClass: 'ECONOMY'
          }
        ]
      }
    ]
  };

  describe('generateETicketPDF', () => {
    it('generates an e-ticket PDF buffer', async () => {
      const buffer = await generateETicketPDF(mockBooking as any);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('generateInvoicePDF', () => {
    it('generates an invoice PDF buffer', async () => {
      const buffer = await generateInvoicePDF(mockBooking as any);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });
});
