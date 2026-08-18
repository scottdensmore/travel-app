import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import CheckInPanel, { type CheckInLegView } from '@/components/ui/CheckInPanel';
import { checkInLegAction } from '@/app/actions';

jest.mock('@/app/actions', () => ({ checkInLegAction: jest.fn() }));

const refresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const mockedCheckIn = checkInLegAction as jest.Mock;

const leg = (overrides: Partial<CheckInLegView> = {}): CheckInLegView => ({
    bookingId: 7,
    legId: 11,
    reference: 'MA-0123456789ABCDEF0123',
    directionLabel: 'Departing',
    airline: 'Gemini Airways',
    flightNumber: 'GA-100',
    from: 'Seattle, USA',
    to: 'Tokyo, Japan',
    departureReadable: 'Aug 19, 2026 at 08:00 PDT',
    opensAtReadable: 'Aug 18, 2026 at 08:00 PDT',
    closesAtReadable: 'Aug 19, 2026 at 07:00 PDT',
    allowed: true,
    reason: 'OPEN',
    statusLabel: 'Check-in open',
    nextStep: 'Confirm your seat to check in for this flight.',
    awaiting: 1,
    hasOpened: true,
    travellers: [
        { id: 'p1', name: 'Ada Lovelace', seat: 'Seat 11A', cabin: 'Economy', checkedIn: false },
    ],
    ...overrides,
});

beforeEach(() => {
    mockedCheckIn.mockReset();
    refresh.mockReset();
    mockedCheckIn.mockResolvedValue(undefined);
});

describe('the check-in page', () => {
    it('says which flight each card is for, not just the route', async () => {
        // A card naming one flight while listing another leg's data is the
        // defect class this application has shipped before, so the flight
        // number, the route and the direction all have to be on the card.
        render(<CheckInPanel legs={[leg()]} />);

        const card = screen.getByRole('region', { name: /Departing: Seattle, USA to Tokyo, Japan/ });
        expect(within(card).getByText('Gemini Airways GA-100')).toBeInTheDocument();
        expect(within(card).getByText('Aug 19, 2026 at 08:00 PDT')).toBeInTheDocument();
        expect(within(card).getByText('MA-0123456789ABCDEF0123')).toBeInTheDocument();
    });

    it('offers no check-in control when the window is shut, and says why', () => {
        render(<CheckInPanel legs={[leg({
            allowed: false,
            reason: 'NOT_YET_OPEN',
            statusLabel: 'Check-in not open yet',
            hasOpened: false,
            nextStep: 'Check-in opens 24 hours before departure. Come back then, or set a reminder.',
        })]} />);

        // A control that does nothing is the failure #70 removed the original
        // check-in link for: a refusal must not render a dead button.
        expect(screen.queryByRole('button', { name: /Check in/ })).not.toBeInTheDocument();
        expect(screen.getByText(/Check-in opens 24 hours before departure/)).toBeInTheDocument();
    });

    it('names the number of travellers it will check in', () => {
        render(<CheckInPanel legs={[leg({
            awaiting: 2,
            travellers: [
                { id: 'p1', name: 'Ada Lovelace', seat: 'Seat 11A', cabin: 'Economy', checkedIn: false },
                { id: 'p2', name: 'Grace Hopper', seat: 'Seat 11B', cabin: 'Economy', checkedIn: false },
            ],
        })]} />);

        expect(screen.getByRole('button', { name: 'Check in 2 travellers' })).toBeInTheDocument();
    });

    it('checks in, reports it, and refreshes the server state', async () => {
        render(<CheckInPanel legs={[leg()]} />);

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });

        expect(mockedCheckIn).toHaveBeenCalledWith({ bookingId: 7, legId: 11 });
        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent('Checked in for Gemini Airways GA-100.');
        // The next-step line under the card already says this; saying it twice
        // read as two different instructions.
        expect(status).not.toHaveTextContent('photo identification');
        // Without this the card keeps saying "Check in" until a manual reload,
        // so the customer cannot tell whether it worked.
        await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('shows the action refusal rather than a generic failure', async () => {
        mockedCheckIn.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Online check-in closed 60 minutes before departure. Speak to an agent at the airport.',
                fields: { _root: ['Online check-in closed 60 minutes before departure.'] },
            },
        });
        render(<CheckInPanel legs={[leg()]} />);

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Speak to an agent at the airport');
        // The refusal is a server-side state change this render is stale about.
        // Without the refresh the card goes on saying "Check-in open" beside an
        // alert saying it is not, and keeps offering a button that cannot work.
        await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('says something usable when the action throws', async () => {
        mockedCheckIn.mockRejectedValue(new Error('network'));
        render(<CheckInPanel legs={[leg()]} />);

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Could not check you in. Please try again.');
    });

    it('moves focus to the outcome so it is announced and reachable', async () => {
        render(<CheckInPanel legs={[leg()]} />);

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });

        const status = await screen.findByRole('status');
        expect(status).toHaveFocus();
    });

    it('shows each traveller as checked in or not, in text', () => {
        render(<CheckInPanel legs={[leg({
            travellers: [
                { id: 'p1', name: 'Ada Lovelace', seat: 'Seat 11A', cabin: 'Economy', checkedIn: true },
                { id: 'p2', name: 'Grace Hopper', seat: 'Seat 11B', cabin: 'Economy', checkedIn: false },
            ],
        })]} />);

        // Text rather than colour, so the state survives a screen reader and a
        // reader who cannot separate the two hues.
        expect(screen.getByText('Checked in')).toBeInTheDocument();
        expect(screen.getByText('Not checked in')).toBeInTheDocument();
    });

    it('sends a disrupted booking to the rebooking it needs', () => {
        render(<CheckInPanel legs={[leg({
            allowed: false,
            reason: 'BOOKING_DISRUPTED',
            statusLabel: 'Flights changed',
            nextStep: 'Your flights changed. Choose replacement flights in your profile to rebook, then check in.',
        })]} />);

        expect(screen.getByRole('link', { name: 'Choose replacement flights' }))
            .toHaveAttribute('href', '/profile');
    });

    it('offers a way forward when there is nothing to check in for', () => {
        render(<CheckInPanel legs={[]} />);

        expect(screen.getByText(/no flights in the next month/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Book a flight' })).toHaveAttribute('href', '/book');
    });

    it('marks every check-in control busy while one request is in flight', async () => {
        // The re-entry guard drops a click on another leg while one is pending,
        // so a button that still looks live would do nothing when pressed --
        // the dead control #70 removed the original check-in link for.
        let release: (() => void) | undefined;
        mockedCheckIn.mockImplementation(() => new Promise<void>(resolve => {
            release = () => resolve();
        }));
        const outbound = leg();
        const inbound = leg({ legId: 12, directionLabel: 'Returning', flightNumber: 'GA-101' });
        render(<CheckInPanel legs={[outbound, inbound]} />);

        const buttons = screen.getAllByRole('button', { name: /Check in/ });
        await act(async () => { fireEvent.click(buttons[0]); });

        for (const button of screen.getAllByRole('button', { name: /Check in/ })) {
            expect(button).toHaveAttribute('aria-disabled', 'true');
        }
        // Only the pressed one claims to be working.
        expect(screen.getByRole('button', { name: 'Checking in…' })).toBeInTheDocument();

        await act(async () => { release?.(); });
    });

    it('acts on the card that was pressed, not the first one', async () => {
        const outbound = leg();
        const inbound = leg({
            legId: 12,
            directionLabel: 'Returning',
            from: 'Tokyo, Japan',
            to: 'Seattle, USA',
            flightNumber: 'GA-101',
        });
        render(<CheckInPanel legs={[outbound, inbound]} />);

        const returning = screen.getByRole('region', { name: /Returning/ });
        await act(async () => { fireEvent.click(within(returning).getByRole('button', { name: 'Check in' })); });

        // A round trip is two check-ins. Sending the outbound's leg id for the
        // return would check in the wrong flight and report the right one.
        expect(mockedCheckIn).toHaveBeenCalledWith({ bookingId: 7, legId: 12 });
        expect(await within(returning).findByRole('status'))
            .toHaveTextContent('Gemini Airways GA-101');
    });
});

describe('what each card claims', () => {
    it('drops the direction from a booking that has only one flight', () => {
        render(<CheckInPanel legs={[leg({ directionLabel: '' })]} />);

        // "Departing" as opposed to what? Three interleaved bookings read as one
        // itinerary -- "Departing / Departing / Returning" -- when a single-leg
        // booking claims a direction it does not have.
        expect(screen.getByRole('region', { name: 'Seattle, USA to Tokyo, Japan' }))
            .toBeInTheDocument();
        expect(screen.queryByText(/Departing:/)).not.toBeInTheDocument();
    });

    it('keeps the direction on a booking that has more than one', () => {
        render(<CheckInPanel legs={[leg({ directionLabel: 'Returning' })]} />);

        expect(screen.getByRole('region', { name: 'Returning: Seattle, USA to Tokyo, Japan' }))
            .toBeInTheDocument();
    });

    it('says check-in opens, in the future tense, only while it has not', () => {
        render(<CheckInPanel legs={[leg({
            allowed: false,
            reason: 'NOT_YET_OPEN',
            statusLabel: 'Check-in not open yet',
            hasOpened: false,
            nextStep: 'Check-in opens 24 hours before departure.',
        })]} />);

        expect(screen.getByText('Check-in opens')).toBeInTheDocument();
    });

    it('says check-in opened, past tense, once the window is open', () => {
        // The instant is stated either way -- it is the label that read as a
        // contradiction, promising a future for a time that had passed.
        render(<CheckInPanel legs={[leg({ reason: 'OPEN' })]} />);

        expect(screen.getByText('Check-in opened')).toBeInTheDocument();
        expect(screen.queryByText('Check-in opens')).not.toBeInTheDocument();
    });

    it('states both ends of the window, whichever way the label reads', () => {
        render(<CheckInPanel legs={[leg()]} />);

        expect(screen.getByText('Aug 18, 2026 at 08:00 PDT')).toBeInTheDocument();
        expect(screen.getByText('Aug 19, 2026 at 07:00 PDT')).toBeInTheDocument();
    });
});
