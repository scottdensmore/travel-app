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

    it('renders TSA PreCheck badge on e-ticket when passenger has KTN', async () => {
      const bookingWithKtn = {
        ...mockBooking,
        passengers: [
          {
            id: 'p1',
            firstName: 'John',
            lastName: 'Doe',
            ktnEncrypted: 'v1:active:iv:ciphertext:tag',
          }
        ]
      };
      await generateETicketPDF(bookingWithKtn as any);
      const PDFDocumentMock = jest.requireMock('pdfkit');
      const instances = PDFDocumentMock.mock.results;
      const latestInstance = instances[instances.length - 1].value;
      expect(latestInstance.text).toHaveBeenCalledWith(expect.stringContaining('TSA PreCheck'));
    });

    it('renders reward redemption and points redeemed on e-ticket when isRewardBooking is true', async () => {
      const rewardBooking = {
        ...mockBooking,
        isRewardBooking: true,
        pointsRedeemed: 40000,
      };
      await generateETicketPDF(rewardBooking as any);
      const PDFDocumentMock = jest.requireMock('pdfkit');
      const instances = PDFDocumentMock.mock.results;
      const latestInstance = instances[instances.length - 1].value;
      expect(latestInstance.text).toHaveBeenCalledWith('Ticket Type: Reward Redemption');
      expect(latestInstance.text).toHaveBeenCalledWith('Points Redeemed: 40,000 pts');
    });

    it('does not render reward redemption lines on cash e-ticket', async () => {
      await generateETicketPDF(mockBooking as any);
      const PDFDocumentMock = jest.requireMock('pdfkit');
      const instances = PDFDocumentMock.mock.results;
      const latestInstance = instances[instances.length - 1].value;
      expect(latestInstance.text).not.toHaveBeenCalledWith('Ticket Type: Reward Redemption');
    });
  });

  describe('generateInvoicePDF', () => {
    it('generates an invoice PDF buffer', async () => {
      const buffer = await generateInvoicePDF(mockBooking as any);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('renders reward redemption breakdown, points redeemed, and mandatory taxes & fees on invoice when isRewardBooking is true', async () => {
      const rewardBooking = {
        ...mockBooking,
        isRewardBooking: true,
        pointsRedeemed: 40000,
        totalPriceCents: 560,
        currency: 'USD',
      };
      await generateInvoicePDF(rewardBooking as any);
      const PDFDocumentMock = jest.requireMock('pdfkit');
      const instances = PDFDocumentMock.mock.results;
      const latestInstance = instances[instances.length - 1].value;
      expect(latestInstance.text).toHaveBeenCalledWith('Fare Type: Reward Redemption');
      expect(latestInstance.text).toHaveBeenCalledWith('Points Redeemed: 40,000 pts');
      expect(latestInstance.text).toHaveBeenCalledWith('Mandatory Taxes & Fees: USD 5.60');
      expect(latestInstance.text).toHaveBeenCalledWith('Total Amount: USD 5.60');
    });

    it('preserves cash invoice output without reward breakdown when isRewardBooking is false', async () => {
      await generateInvoicePDF(mockBooking as any);
      const PDFDocumentMock = jest.requireMock('pdfkit');
      const instances = PDFDocumentMock.mock.results;
      const latestInstance = instances[instances.length - 1].value;
      expect(latestInstance.text).toHaveBeenCalledWith('Total Amount: USD 1500.00');
      expect(latestInstance.text).not.toHaveBeenCalledWith('Fare Type: Reward Redemption');
    });
  });
});

