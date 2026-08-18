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
    // Already on file by default, so the existing tests stay about check-in
    // rather than about the attestation. The attestation has its own block below.
    documentsConfirmed: true,
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

        expect(mockedCheckIn).toHaveBeenCalledWith({
            bookingId: 7,
            legId: 11,
            documentsConfirmed: true,
        });
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
        expect(mockedCheckIn).toHaveBeenCalledWith({
            bookingId: 7,
            legId: 12,
            documentsConfirmed: true,
        });
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

describe('confirming traveller and document details', () => {
    it('asks for the attestation before it will check anyone in', async () => {
        render(<CheckInPanel legs={[leg({ documentsConfirmed: false })]} />);

        const box = screen.getByRole('checkbox');
        expect(box).not.toBeChecked();
        // The label carries the state, not just a shade of purple: `aria-disabled`
        // is assistive-tech only and `cursor: not-allowed` never happens on touch,
        // so a sighted mouse or touch user had no signal at all and the button
        // read as ready.
        const blocked = screen.getByRole('button', { name: 'Confirm details to check in' });
        expect(blocked).toHaveAttribute('aria-disabled', 'true');

        // `aria-disabled` does not stop a click, so pressing it must be refused
        // in the handler -- and refused out loud, not silently.
        await act(async () => { fireEvent.click(blocked); });
        expect(mockedCheckIn).not.toHaveBeenCalled();
        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Confirm the traveller and document details');
    });

    it('clears the refusal the moment the customer complies', async () => {
        render(<CheckInPanel legs={[leg({ documentsConfirmed: false })]} />);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Confirm details to check in' }));
        });
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        // Focus is already on the remedy, so the customer can act without hunting.
        expect(screen.getByRole('checkbox')).toHaveFocus();

        await act(async () => { fireEvent.click(screen.getByRole('checkbox')); });

        // A red alert saying "confirm the details" under a button that has just
        // gone live tells a customer to do the thing they have just done, and
        // nothing announces that the blocker lifted.
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Check in' }))
            .toHaveAttribute('aria-disabled', 'false');
    });

    it('offers a way out to the customer who cannot honestly confirm', () => {
        render(<CheckInPanel legs={[leg({ documentsConfirmed: false })]} />);

        // On screen from the start. It used to appear only in the refusal, so the
        // only customer who learned there was a route out was one who had already
        // pressed the button without ticking -- never the one who needs it.
        expect(screen.getByText(/If any of them are wrong, contact us/))
            .toBeInTheDocument();
    });

    it('says the attestation is on file rather than merely not asking', () => {
        render(<CheckInPanel legs={[leg({ documentsConfirmed: true })]} />);

        // A vanished checkbox is an absence, not an answer: a customer returning
        // for the return leg could not tell whether they had confirmed.
        expect(screen.getByText('Traveller and document details confirmed.'))
            .toBeInTheDocument();
    });

    it('still says so on the legs where the customer most needs to know', () => {
        // Both of these are `allowed: false`, and gating the line on `allowed`
        // hid it on exactly the two cards it exists for: the leg just checked in,
        // and the return whose window has not opened.
        const checkedIn = leg({
            legId: 31,
            documentsConfirmed: true,
            allowed: false,
            reason: 'ALREADY_CHECKED_IN',
            statusLabel: 'Checked in',
        });
        const notYetOpen = leg({
            legId: 32,
            documentsConfirmed: true,
            allowed: false,
            reason: 'NOT_YET_OPEN',
            statusLabel: 'Check-in not open yet',
            hasOpened: false,
        });
        render(<CheckInPanel legs={[checkedIn, notYetOpen]} />);

        expect(screen.getAllByText('Traveller and document details confirmed.'))
            .toHaveLength(2);
    });

    it('does not state it beside a booking that is over', () => {
        render(<CheckInPanel legs={[leg({
            documentsConfirmed: true,
            allowed: false,
            reason: 'BOOKING_CANCELLED',
            statusLabel: 'Booking cancelled',
        })]} />);

        // True, but noise beside "Booking cancelled" -- there is no check-in for
        // the confirmation to be a step towards.
        expect(screen.queryByText('Traveller and document details confirmed.'))
            .not.toBeInTheDocument();
    });

    it('checks in once the box is ticked, and says the customer confirmed', async () => {
        render(<CheckInPanel legs={[leg({ documentsConfirmed: false })]} />);

        await act(async () => { fireEvent.click(screen.getByRole('checkbox')); });
        expect(screen.getByRole('button', { name: 'Check in' }))
            .toHaveAttribute('aria-disabled', 'false');

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });

        expect(mockedCheckIn).toHaveBeenCalledWith({
            bookingId: 7,
            legId: 11,
            documentsConfirmed: true,
        });
    });

    it('does not ask again once the attestation is on file', () => {
        render(<CheckInPanel legs={[leg({ documentsConfirmed: true })]} />);

        // A passport does not change between the legs of one trip, so a second
        // ask is a question the customer has already answered.
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Check in' }))
            .toHaveAttribute('aria-disabled', 'false');
    });

    it('still confirms for a leg whose party attested earlier', async () => {
        render(<CheckInPanel legs={[leg({ documentsConfirmed: true })]} />);

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });

        // The action is idempotent about the attestation, and sending true for a
        // party already on file keeps the client from having to model the
        // difference.
        expect(mockedCheckIn).toHaveBeenCalledWith({
            bookingId: 7,
            legId: 11,
            documentsConfirmed: true,
        });
    });

    it('asks a booking whose two legs are both open exactly once', async () => {
        // A same-day round trip has both legs inside the window. Sharing the
        // ANSWER across them was only half the fix: the question was still
        // rendered on each card, so the customer read the same three-line sentence
        // twice and ticking one silently moved a control on the other.
        const outbound = leg({ documentsConfirmed: false });
        const inbound = leg({
            legId: 12,
            directionLabel: 'Returning',
            flightNumber: 'GA-101',
            documentsConfirmed: false,
        });
        render(<CheckInPanel legs={[outbound, inbound]} />);

        expect(screen.getAllByRole('checkbox')).toHaveLength(1);

        await act(async () => { fireEvent.click(screen.getByRole('checkbox')); });

        // One answer arms both legs, which is right -- it is one attestation.
        for (const button of screen.getAllByRole('button', { name: 'Check in' })) {
            expect(button).toHaveAttribute('aria-disabled', 'false');
        }
    });

    it('sends a refusal on one leg to the attestation living on another', async () => {
        // The remedy sits above the button, and the feedback paragraph is the last
        // node in the card, so focusing the message puts the fix behind the focus:
        // the keyboard user tabs forward and lands on the next card. For a
        // booking's second open leg the control is on a different card entirely.
        const outbound = leg({ documentsConfirmed: false });
        const inbound = leg({
            legId: 12,
            directionLabel: 'Returning',
            flightNumber: 'GA-101',
            documentsConfirmed: false,
        });
        render(<CheckInPanel legs={[outbound, inbound]} />);

        const returning = screen.getByRole('region', { name: /Returning/ });
        await act(async () => {
            fireEvent.click(within(returning).getByRole('button', {
                name: 'Confirm details to check in',
            }));
        });

        expect(screen.getByRole('checkbox')).toHaveFocus();
    });

    it('points the checkbox at the way out, for a reader moving by control', () => {
        render(<CheckInPanel legs={[leg({ documentsConfirmed: false })]} />);

        const box = screen.getByRole('checkbox');
        const describedBy = box.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy!))
            .toHaveTextContent(/If any of them are wrong, contact us/);
    });

    it('names a route out rather than the word "contact"', () => {
        render(<CheckInPanel legs={[leg({ documentsConfirmed: false })]} />);

        // Deliberately non-routable example details, marked as examples the way the
        // footer marks them (#72) -- but a route, not an instruction to find one.
        expect(screen.getByRole('link', { name: 'support@example.com' }))
            .toHaveAttribute('href', 'mailto:support@example.com');
        expect(screen.getByRole('link', { name: '+1 (555) 0100' }))
            .toHaveAttribute('href', 'tel:+15550100');
        expect(screen.getByText('(example)')).toBeInTheDocument();
    });

    it('keeps one booking\'s answer off another booking', async () => {
        const mine = leg({ documentsConfirmed: false });
        const other = leg({
            bookingId: 8,
            legId: 21,
            reference: 'MA-9876543210FEDCBA9876',
            flightNumber: 'GA-200',
            documentsConfirmed: false,
        });
        render(<CheckInPanel legs={[mine, other]} />);

        const [first] = screen.getAllByRole('checkbox');
        await act(async () => { fireEvent.click(first); });

        // Different travellers, different documents. This is the boundary the
        // per-booking key exists to hold, and it was only ever verified by hand.
        const boxes = screen.getAllByRole('checkbox');
        expect(boxes[0]).toBeChecked();
        expect(boxes[1]).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Check in' }))
            .toHaveAttribute('aria-disabled', 'false');
        expect(screen.getByRole('button', { name: 'Confirm details to check in' }))
            .toHaveAttribute('aria-disabled', 'true');
    });

    it('names what is being confirmed without showing any of it', () => {
        render(<CheckInPanel legs={[leg({ documentsConfirmed: false })]} />);

        const label = screen.getByText(/I confirm that each traveller/);
        // The categories are named; no value is shown. The policy forbids a
        // passport number or a date of birth reaching a customer surface at all,
        // which is why this is an attestation rather than a review screen.
        expect(label).toHaveTextContent('passport details');
        expect(label).toHaveTextContent('date of birth');
        expect(screen.queryByText(/\d{2}\/\d{2}\/\d{4}/)).not.toBeInTheDocument();
    });
});
