import React from 'react';
import { render, screen } from '@testing-library/react';
import CheckoutPage from '@/app/checkout/page';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('next/navigation', () => ({
    notFound: jest.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
    redirect: jest.fn(() => { throw new Error('NEXT_REDIRECT'); }),
}));
jest.mock('@/lib/prisma', () => ({
    prisma: {
        flight: { findMany: jest.fn() },
        user: { findUniqueOrThrow: jest.fn() },
    },
}));
jest.mock('@/app/actions', () => ({
    getOccupiedSeatsAction: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/components/ui/BookingCheckoutWizard', () => ({
    __esModule: true,
    default: ({ flights }: { flights: Array<{ flightNumber: string }> }) => (
        <div data-testid="wizard">
            {flights.map(f => <span key={f.flightNumber}>{f.flightNumber}</span>)}
        </div>
    ),
}));

describe('CheckoutPage multi-leg flight parameter parsing', () => {
    const flight10 = {
        id: 10,
        flightNumber: 'FL10',
        airline: 'Mona',
        fromAirport: { label: 'SEA' },
        toAirport: { label: 'DTW' },
        departureDate: new Date(),
        durationMinutes: 200,
        priceCents: 10000,
        firstClassRows: 2,
        businessRows: 2,
        premiumEconomyRows: 2,
        economyRows: 10,
        seatPattern: '3-3',
    };
    const flight20 = {
        id: 20,
        flightNumber: 'FL20',
        airline: 'Mona',
        fromAirport: { label: 'DTW' },
        toAirport: { label: 'JFK' },
        departureDate: new Date(),
        durationMinutes: 120,
        priceCents: 8000,
        firstClassRows: 2,
        businessRows: 2,
        premiumEconomyRows: 2,
        economyRows: 10,
        seatPattern: '3-3',
    };
    const flight30 = {
        id: 30,
        flightNumber: 'FL30',
        airline: 'Mona',
        fromAirport: { label: 'JFK' },
        toAirport: { label: 'SEA' },
        departureDate: new Date(),
        durationMinutes: 300,
        priceCents: 15000,
        firstClassRows: 2,
        businessRows: 2,
        premiumEconomyRows: 2,
        economyRows: 10,
        seatPattern: '3-3',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'user-123' },
        });
        (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({
            timeZone: 'America/New_York',
        });
    });

    it('loads 3 flights from comma-separated flights query parameter', async () => {
        (prisma.flight.findMany as jest.Mock).mockResolvedValue([
            flight10,
            flight20,
            flight30,
        ]);

        const searchParams = Promise.resolve({ flights: '10,20,30' });
        const ui = await CheckoutPage({ searchParams });
        render(ui);

        expect(screen.getByText('FL10')).toBeInTheDocument();
        expect(screen.getByText('FL20')).toBeInTheDocument();
        expect(screen.getByText('FL30')).toBeInTheDocument();
    });

    it('loads multiple flights from repeated flights query parameters (array)', async () => {
        (prisma.flight.findMany as jest.Mock).mockResolvedValue([
            flight10,
            flight20,
            flight30,
        ]);

        const searchParams = Promise.resolve({ flights: ['10', '20', '30'] });
        const ui = await CheckoutPage({ searchParams });
        render(ui);

        expect(screen.getByText('FL10')).toBeInTheDocument();
        expect(screen.getByText('FL20')).toBeInTheDocument();
        expect(screen.getByText('FL30')).toBeInTheDocument();
    });

    it('loads flights when comma-separated tokens appear within repeated array values', async () => {
        (prisma.flight.findMany as jest.Mock).mockResolvedValue([
            flight10,
            flight20,
            flight30,
        ]);

        const searchParams = Promise.resolve({ flights: ['10,20', '30'] });
        const ui = await CheckoutPage({ searchParams });
        render(ui);

        expect(screen.getByText('FL10')).toBeInTheDocument();
        expect(screen.getByText('FL20')).toBeInTheDocument();
        expect(screen.getByText('FL30')).toBeInTheDocument();
    });

    it('preserves order of flights from the flights query parameter', async () => {
        (prisma.flight.findMany as jest.Mock).mockResolvedValue([
            // DB returns out of order
            flight20,
            flight30,
            flight10,
        ]);

        const searchParams = Promise.resolve({ flights: '30,10,20' });
        const ui = await CheckoutPage({ searchParams });
        const { container } = render(ui);

        const spans = container.querySelectorAll('span');
        expect(Array.from(spans).map(s => s.textContent)).toEqual(['FL30', 'FL10', 'FL20']);
    });

    it('preserves backward compatibility with outbound and inbound query parameters', async () => {
        (prisma.flight.findMany as jest.Mock).mockResolvedValue([
            flight10,
            flight20,
        ]);

        const searchParams = Promise.resolve({ outbound: '10', inbound: '20' });
        const ui = await CheckoutPage({ searchParams });
        render(ui);

        expect(screen.getByText('FL10')).toBeInTheDocument();
        expect(screen.getByText('FL20')).toBeInTheDocument();
    });

    it('preserves backward compatibility with one-way outbound query parameter', async () => {
        (prisma.flight.findMany as jest.Mock).mockResolvedValue([
            flight10,
        ]);

        const searchParams = Promise.resolve({ outbound: '10' });
        const ui = await CheckoutPage({ searchParams });
        render(ui);

        expect(screen.getByText('FL10')).toBeInTheDocument();
    });

    it('returns notFound when flights contains duplicates', async () => {
        const searchParams = Promise.resolve({ flights: '10,20,10' });
        await expect(CheckoutPage({ searchParams })).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('returns notFound when flights contains duplicates across repeated params', async () => {
        const searchParams = Promise.resolve({ flights: ['10', '20', '10'] });
        await expect(CheckoutPage({ searchParams })).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('returns notFound when flights exceeds MAX_ITINERARY_LEGS (5)', async () => {
        const searchParams = Promise.resolve({ flights: '1,2,3,4,5,6' });
        await expect(CheckoutPage({ searchParams })).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('returns notFound when flights contains non-integers', async () => {
        const searchParams = Promise.resolve({ flights: '10,abc,30' });
        await expect(CheckoutPage({ searchParams })).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('returns notFound when flights contains non-positive numbers', async () => {
        const searchParams = Promise.resolve({ flights: '10,0,30' });
        await expect(CheckoutPage({ searchParams })).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('returns notFound when flights is empty or whitespace', async () => {
        const searchParams = Promise.resolve({ flights: '   ' });
        await expect(CheckoutPage({ searchParams })).rejects.toThrow('NEXT_NOT_FOUND');
    });
});
