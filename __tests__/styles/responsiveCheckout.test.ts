import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BookingCheckoutWizard from '@/components/ui/BookingCheckoutWizard';

// Mock server actions required by BookingCheckoutWizard
jest.mock('@/app/actions', () => ({
    bookFlightAction: jest.fn(),
    holdChosenSeatsAction: jest.fn().mockResolvedValue({
        ok: true,
        holdExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        holdExpiresInMilliseconds: 600_000,
    }),
    startCheckoutPaymentAction: jest.fn(),
}));

const sampleFlight = {
    id: 101,
    flightNumber: 'GA101',
    airline: 'Global Airways',
    from: 'Seattle, USA',
    to: 'Detroit, USA',
    departureDate: '2026-07-01T08:00:00Z',
    durationMinutes: 240,
    priceCents: 15000,
};

describe('Responsive Checkout Layout (Issue #79)', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');
    const wizardSource = fs.readFileSync(
        path.join(process.cwd(), 'components/ui/BookingCheckoutWizard.tsx'),
        'utf8'
    );

    describe('1. Travel Class Select Responsive Stacking & Overflow Guards', () => {
        it('defines .booking-traveler-selects with grid layout and box-sizing guards', () => {
            expect(css).toContain('.booking-traveler-selects {');
            expect(css).toMatch(/\.booking-traveler-selects\s*\{[^}]*display:\s*grid;/);
            expect(css).toMatch(/\.booking-traveler-selects\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(200px,\s*1fr\)\);/);
            expect(css).toMatch(/\.booking-traveler-selects\s*\{[^}]*box-sizing:\s*border-box;/);
            expect(css).toMatch(/\.booking-traveler-selects\s*\{[^}]*min-width:\s*0;/);
            expect(css).toMatch(/\.booking-traveler-selects\s*\{[^}]*width:\s*100%;/);
        });

        it('ensures selects inside .booking-traveler-selects fit full width with box-sizing border-box', () => {
            expect(css).toContain('.booking-traveler-selects select {');
            expect(css).toMatch(/\.booking-traveler-selects select\s*\{[^}]*box-sizing:\s*border-box;/);
            expect(css).toMatch(/\.booking-traveler-selects select\s*\{[^}]*width:\s*100%;/);
            expect(css).toMatch(/\.booking-traveler-selects select\s*\{[^}]*min-width:\s*0;/);
        });

        it('stacks traveler selects to 100% full width (1fr) on narrow screens (max-width: 480px)', () => {
            // Narrow screens below 480px must stack gender and cabin class selects into a single column
            // so "Premium Economy (+50%)" is never clipped against the caret
            expect(css).toMatch(
                /@media\s*\(max-width:\s*480px\)[\s\S]*?\.booking-traveler-selects\s*\{[\s\S]*?grid-template-columns:\s*1fr/
            );
        });

        it('guards checkout containers with box-sizing border-box and responsive padding on small viewports', () => {
            expect(css).toContain('.booking-wizard-container,');
            expect(css).toContain('.booking-wizard-card,');
            expect(css).toContain('.booking-passenger-card {');
            expect(css).toMatch(/\.booking-wizard-container,\s*\.booking-wizard-card,\s*\.booking-passenger-card\s*\{[^}]*box-sizing:\s*border-box;/);
            expect(css).toMatch(/\.booking-wizard-container,\s*\.booking-wizard-card,\s*\.booking-passenger-card\s*\{[^}]*min-width:\s*0;/);

            // Responsive padding reductions on mobile prevents horizontal overflow at 320px
            expect(css).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*?\.booking-wizard-container\s*\{[^}]*padding:/);
            expect(css).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*?\.booking-wizard-card\s*\{[^}]*padding:/);
            expect(css).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*?\.booking-passenger-card\s*\{[^}]*padding:/);
        });

        it('applies responsive checkout classes in BookingCheckoutWizard markup', () => {
            expect(wizardSource).toContain('className="booking-traveler-selects"');
            expect(wizardSource).toContain('className="booking-wizard-container"');
            expect(wizardSource).toContain('className="booking-wizard-card"');
            expect(wizardSource).toContain('className="booking-passenger-card"');
        });

        it('renders the selects container with booking-traveler-selects class in step 1', () => {
            const { container } = render(
                React.createElement(BookingCheckoutWizard, {
                    flights: [sampleFlight],
                    occupiedSeats: [[]],
                })
            );

            const travelerSelectsDiv = container.querySelector('.booking-traveler-selects');
            expect(travelerSelectsDiv).toBeInTheDocument();

            const selects = travelerSelectsDiv?.querySelectorAll('select');
            expect(selects).toHaveLength(2); // Gender & Travel Class

            const travelClassSelect = selects?.[1];
            expect(travelClassSelect).toBeInTheDocument();
            const optionTexts = Array.from(travelClassSelect?.querySelectorAll('option') || []).map(
                (opt) => opt.textContent
            );
            expect(optionTexts).toContain('Premium Economy (+50%)');
        });
    });

    describe('2. Passenger Card Wrapping Mid-Value in Seat Step', () => {
        it('defines subtitle and segment styling in globals.css to prevent mid-value wrapping', () => {
            expect(css).toContain('.booking-passenger-card-subtitle {');
            expect(css).toMatch(/\.booking-passenger-card-subtitle\s*\{[^}]*display:\s*flex;/);
            expect(css).toMatch(/\.booking-passenger-card-subtitle\s*\{[^}]*flex-wrap:\s*wrap;/);
            expect(css).toMatch(/\.booking-passenger-card-subtitle\s*\{[^}]*gap:\s*0\.25rem\s+0\.5rem;/);

            expect(css).toContain('.booking-passenger-card-segment {');
            expect(css).toMatch(/\.booking-passenger-card-segment\s*\{[^}]*white-space:\s*nowrap;/);
        });

        it('renders discrete nowrap segments in the passenger card subtitle in step 2', () => {
            const { container } = render(
                React.createElement(BookingCheckoutWizard, {
                    flights: [sampleFlight],
                    occupiedSeats: [[]],
                })
            );

            // Fill passenger form to advance to Step 2
            fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: 'Ada' } });
            fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: 'Lovelace' } });
            fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1990-01-01' } });
            fireEvent.change(screen.getByPlaceholderText('A00000000'), { target: { value: 'US12345678' } });

            // Upgrade to Premium Economy to test the exact label that overflows 248px
            const classSelect = container.querySelectorAll('.booking-traveler-selects select')[1];
            fireEvent.change(classSelect, { target: { value: 'PREMIUM_ECONOMY' } });

            // Advance to Seats (Step 2)
            fireEvent.click(screen.getByRole('button', { name: /select seats/i }));

            expect(screen.getByText('Select Your Seats')).toBeInTheDocument();

            // Locate subtitle container
            const subtitle = container.querySelector('.booking-passenger-card-subtitle');
            expect(subtitle).toBeInTheDocument();

            // Verify discrete segments with whiteSpace: nowrap
            const segments = subtitle?.querySelectorAll('.booking-passenger-card-segment');
            expect(segments?.length).toBeGreaterThanOrEqual(2);

            const classSegment = segments?.[0] as HTMLElement;
            const seatSegment = segments?.[1] as HTMLElement;

            expect(classSegment.textContent).toContain('Class: Premium Economy');
            expect(classSegment.style.whiteSpace).toBe('nowrap');

            expect(seatSegment.textContent).toContain('Seat: Not Chosen');
            expect(seatSegment.style.whiteSpace).toBe('nowrap');

            // Discrete segments ensure neither "Premium Economy" nor "Not Chosen" splits mid-value
            expect(seatSegment.textContent).toMatch(/Seat:\s*Not Chosen/);
        });
    });
});
