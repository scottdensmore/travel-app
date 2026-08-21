'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { checkInLegAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';
import { SUPPORT } from '@/lib/brand';
import BoardingPass from '@/components/ui/BoardingPass';
import {
    CHECK_IN_CLOSES_MINUTES,
    CHECK_IN_OPENS_HOURS,
    DOCUMENT_ATTESTATION_CONFIRMED,
    DOCUMENT_ATTESTATION_LABEL,
    DOCUMENT_ATTESTATION_RECOURSE,
    DOCUMENT_ATTESTATION_REQUIRED,
    type CheckInReason,
} from '@/lib/checkInPolicy';

/**
 * One leg of one booking, as the check-in page shows it.
 *
 * Every time and every decision on it was settled on the server. The browser's
 * clock is not consulted: it can differ from the server's by more than the hour
 * the window closes in, which would offer check-in the server then refuses, or
 * withhold it while the server would allow it.
 */
export interface CheckInLegView {
    bookingId: number;
    legId: number;
    reference: string;
    directionLabel: string;
    airline: string;
    flightNumber: string;
    from: string;
    to: string;
    departureReadable: string;
    opensAtReadable: string;
    closesAtReadable: string;
    allowed: boolean;
    reason: CheckInReason;
    statusLabel: string;
    nextStep: string;
    /** How many travellers on this leg have still to check in. */
    awaiting: number;
    /**
     * Whether the check-in window has opened, decided on the server against the
     * same instant every time on the card was rendered from.
     */
    hasOpened: boolean;
    /**
     * Whether this booking's travellers have already confirmed their document
     * details. False means the attestation is still to be made, which is a
     * precondition of checking in rather than a reason the window is shut.
     */
    documentsConfirmed: boolean;
    travellers: Array<{
        id: string;
        name: string;
        seat: string;
        cabin: string;
        checkedIn: boolean;
    }>;
}

/**
 * The states in which saying "details confirmed" is worth saying.
 *
 * Not gated on `allowed`, which was the first attempt and defeated the purpose:
 * a leg goes un-allowed the moment it is checked in, and a return leg is
 * un-allowed until its window opens -- the two cards where a customer most wants
 * to know the attestation is already on file. Excluded instead are the states
 * where check-in is over or moot, and where the line would be true but noise
 * beside "Booking cancelled".
 */
const ATTESTATION_WORTH_STATING: readonly CheckInReason[] = [
    'OPEN',
    'NOT_YET_OPEN',
    'CLOSED',
    'ALREADY_CHECKED_IN',
];

/** A checked-in stamp survives disruption, but its boarding pass does not. */
const BOARDING_PASS_WITHDRAWN_REASONS = new Set<CheckInReason>([
    'FLIGHT_CANCELLED',
    'BOOKING_CANCELLED',
    'BOOKING_DISRUPTED',
]);

export default function CheckInPanel({ legs }: { legs: CheckInLegView[] }) {
    const router = useRouter();
    const [pendingLegId, setPendingLegId] = useState<number | null>(null);
    // Keyed by BOOKING, not by leg. The attestation is recorded per booking -- a
    // passport does not change between an outbound and a return -- so two legs of
    // one booking are one question, and keying per leg asked it twice on the same
    // screen for any itinerary with two legs inside the window. Two *different*
    // bookings stay independent, which is the distinction that matters.
    const [attested, setAttested] = useState<Record<number, boolean>>({});
    const [feedback, setFeedback] = useState<{
        legId: number;
        kind: 'success' | 'error';
        message: string;
        /**
         * Where to put focus. The message is right for an outcome the customer
         * can only read; the attestation is right for a refusal whose remedy is
         * a control on the page, because focusing the message puts that control
         * *behind* the focus -- it is the last node in the card, and the checkbox
         * is above the button.
         */
        focus: 'message' | 'attestation';
    } | null>(null);
    const feedbackRef = useRef<HTMLParagraphElement | null>(null);
    const attestationRefs = useRef<Record<number, HTMLInputElement | null>>({});

    /**
     * Which leg carries the attestation for each booking.
     *
     * One control per booking, not per leg. Sharing the answer across a booking's
     * legs was only half of it: the *question* was still rendered on every open
     * leg, so a same-day round trip showed the identical three-line sentence
     * twice, and ticking one silently moved a control hundreds of pixels away that
     * the customer was not looking at. The earliest open leg that still needs it
     * owns it; every other leg of that booking is armed by the shared answer, and
     * a refusal on one of those cards focuses this control wherever it lives.
     */
    const attestationOwner = useMemo(() => {
        const owner: Record<number, number> = {};
        for (const leg of legs) {
            if (!leg.allowed || leg.documentsConfirmed) continue;
            if (owner[leg.bookingId] === undefined) owner[leg.bookingId] = leg.legId;
        }
        return owner;
    }, [legs]);

    // Moves focus to the outcome rather than leaving it on a button whose label
    // has changed underneath it, which is what a screen reader user would
    // otherwise have to go looking for (#205's lesson about arriving focus).
    useEffect(() => {
        if (!feedback) return;
        if (feedback.focus === 'attestation') {
            // The control that clears the refusal, wherever it lives -- which for a
            // booking's second open leg is on another card entirely.
            const owner = legs.find(leg => leg.legId === feedback.legId);
            const ownerLegId = owner ? attestationOwner[owner.bookingId] : undefined;
            const box = ownerLegId === undefined ? null : attestationRefs.current[ownerLegId];
            if (box) {
                box.focus();
                return;
            }
        }
        feedbackRef.current?.focus();
    }, [feedback, legs, attestationOwner]);

    const checkIn = async (leg: CheckInLegView) => {
        if (pendingLegId !== null) return;

        // `aria-disabled` is advisory -- it styles and announces, and the click
        // still fires. So the attestation is enforced here as well, and it says
        // why rather than returning silently: a control that does nothing when
        // pressed is the dead control #70 is about, and "it looked greyed out" is
        // not feedback.
        //
        // The server enforces this independently; this is the half that keeps the
        // customer informed, not the half that keeps the rule.
        const confirmed = leg.documentsConfirmed || attested[leg.bookingId] === true;
        if (!confirmed) {
            setFeedback({
                legId: leg.legId,
                kind: 'error',
                message: DOCUMENT_ATTESTATION_REQUIRED,
                focus: 'attestation',
            });
            return;
        }

        setPendingLegId(leg.legId);
        setFeedback(null);
        try {
            const result = await checkInLegAction({
                bookingId: leg.bookingId,
                legId: leg.legId,
                documentsConfirmed: true,
            });
            if (isActionValidationFailure(result)) {
                setFeedback({
                    legId: leg.legId,
                    kind: 'error',
                    message: result.error.message,
                    focus: 'message',
                });
                // Refreshed on the refusal as well as on success. Every reason
                // the action refuses for is a server-side state change this
                // render is now stale about -- the flight was cancelled, or the
                // desk closed while the page sat open -- so without this the
                // card goes on saying "Check-in open" beside an alert saying it
                // is not, and keeps offering a button that cannot succeed.
                router.refresh();
                return;
            }
            // Says what happened and nothing more: the next-step line under the
            // card already tells them to bring identification, and repeating it
            // here read as two different instructions.
            setFeedback({
                legId: leg.legId,
                kind: 'success',
                message: `Checked in for ${leg.airline} ${leg.flightNumber}.`,
                focus: 'message',
            });
            router.refresh();
        } catch (error) {
            // Logged as well as shown. Every genuine server fault -- a superseded
            // leg, a transaction timeout while a cancellation holds the flight
            // lock, a dropped connection -- reaches the customer as the same
            // sentence, so without this there is nothing anywhere to tell a real
            // fault from a transient one. `titlebar.tsx` logs its equivalent.
            console.error('Failed to check in:', error);
            setFeedback({
                legId: leg.legId,
                kind: 'error',
                message: 'Could not check you in. Please try again.',
                focus: 'message',
            });
        } finally {
            setPendingLegId(null);
        }
    };

    return (
        <div className="page-container checkin">
            <div className="checkin-shell">
                <h1>Check in</h1>
                {/* Both numbers come from the policy. Written out as prose they
                    went on claiming 24 hours after the constant moved, with
                    nothing failing -- every other mention on this page is
                    derived. */}
                <p className="checkin-intro">
                    Check-in opens {CHECK_IN_OPENS_HOURS} hours before each flight
                    leaves and closes {CHECK_IN_CLOSES_MINUTES} minutes before it.
                    A trip with more than one flight is checked in one flight at a
                    time.
                </p>

                {legs.length === 0 ? (
                    <p className="checkin-empty">
                        You have no flights in the next month.{' '}
                        <Link href="/book">Book a flight</Link> to travel with us.
                    </p>
                ) : (
                    <ul className="checkin-leg-list">
                        {legs.map((leg) => {
                            const busy = pendingLegId === leg.legId;
                            const shown = feedback?.legId === leg.legId ? feedback : null;
                            const headingId = `checkin-leg-${leg.legId}-heading`;

                            return (
                                <li key={leg.legId}>
                                    <section
                                        className="checkin-card"
                                        aria-labelledby={headingId}
                                    >
                                        <div className="checkin-card-head">
                                            <h2 id={headingId}>
                                                {/* Empty for a booking with one
                                                    leg, which is not "Departing"
                                                    as opposed to anything. Three
                                                    interleaved bookings read as
                                                    "Departing / Departing /
                                                    Returning" otherwise, which
                                                    looks like one itinerary. */}
                                                {leg.directionLabel && `${leg.directionLabel}: `}
                                                {leg.from} to {leg.to}
                                            </h2>
                                            {/* The state is text, not a colour.
                                                A badge distinguished only by hue
                                                says nothing to a screen reader
                                                and nothing to anyone who cannot
                                                separate the two hues. */}
                                            <p
                                                className={`checkin-state checkin-state-${leg.reason.toLowerCase().replaceAll('_', '-')}`}
                                            >
                                                {leg.statusLabel}
                                            </p>
                                        </div>

                                        <dl className="checkin-facts">
                                            <div>
                                                <dt>Flight</dt>
                                                <dd>{leg.airline} {leg.flightNumber}</dd>
                                            </div>
                                            <div>
                                                <dt>Departs</dt>
                                                <dd>{leg.departureReadable}</dd>
                                            </div>
                                            <div>
                                                <dt>Confirmation</dt>
                                                <dd>{leg.reference}</dd>
                                            </div>
                                        </dl>

                                        {/* The window is its own list so its two
                                            ends cannot be split across rows by a
                                            column count that happens to be four:
                                            "opens" sat on one row and "closes"
                                            alone on the next at desktop width. */}
                                        <dl className="checkin-facts checkin-window">
                                            <div>
                                                <dt>
                                                    {/* Past tense once the instant
                                                        has passed -- not once the
                                                        reason is something other
                                                        than NOT_YET_OPEN. A
                                                        cancelled booking weeks out
                                                        is neither, and read
                                                        "opened" about a future
                                                        date. */}
                                                    {leg.hasOpened
                                                        ? 'Check-in opened'
                                                        : 'Check-in opens'}
                                                </dt>
                                                <dd>{leg.opensAtReadable}</dd>
                                            </div>
                                            <div>
                                                <dt>Check-in closes</dt>
                                                <dd>{leg.closesAtReadable}</dd>
                                            </div>
                                        </dl>

                                        {leg.travellers.length > 0 && (
                                            <ul className="checkin-travellers">
                                                {leg.travellers.map((traveller) => (
                                                    /* Keyed on the traveller, not
                                                       their name: a booking can
                                                       carry two people with the
                                                       same one, and duplicate keys
                                                       let React reconcile the two
                                                       rows into each other so a
                                                       "Checked in" state lands on
                                                       the wrong person. */
                                                    <li key={`${leg.legId}-${traveller.id}`}>
                                                        <span className="checkin-traveller-name">
                                                            {traveller.name}
                                                        </span>
                                                        <span className="checkin-traveller-seat">
                                                            {traveller.seat} · {traveller.cabin}
                                                        </span>
                                                        <span className="checkin-traveller-state">
                                                            {traveller.checkedIn ? 'Checked in' : 'Not checked in'}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}

                                        {!BOARDING_PASS_WITHDRAWN_REASONS.has(leg.reason)
                                            && leg.travellers.some(traveller => traveller.checkedIn) && (
                                            <div className="checkin-boarding-passes">
                                                {leg.travellers
                                                    .filter(traveller => traveller.checkedIn)
                                                    .map(traveller => (
                                                        <BoardingPass
                                                            key={`${leg.legId}-${traveller.id}`}
                                                            passengerName={traveller.name}
                                                            reference={leg.reference}
                                                            airline={leg.airline}
                                                            flightNumber={leg.flightNumber}
                                                            from={leg.from}
                                                            to={leg.to}
                                                            departureReadable={leg.departureReadable}
                                                            seat={traveller.seat}
                                                            cabin={traveller.cabin}
                                                        />
                                                    ))}
                                            </div>
                                        )}

                                        <p className="checkin-next-step">{leg.nextStep}</p>

                                        {attestationOwner[leg.bookingId] === leg.legId && (
                                            <div className="checkin-attestation">
                                                <input
                                                    type="checkbox"
                                                    id={`checkin-attest-${leg.legId}`}
                                                    ref={element => {
                                                        attestationRefs.current[leg.legId] = element;
                                                    }}
                                                    // The recourse is the only way
                                                    // out for a customer who cannot
                                                    // honestly tick this, and a
                                                    // screen-reader user moving by
                                                    // form control would otherwise
                                                    // never reach the paragraph
                                                    // that says so.
                                                    aria-describedby={`checkin-recourse-${leg.legId}`}
                                                    checked={attested[leg.bookingId] === true}
                                                    onChange={event => {
                                                        setAttested(current => ({
                                                            ...current,
                                                            [leg.bookingId]: event.target.checked,
                                                        }));
                                                        // Clears the refusal the
                                                        // moment they comply.
                                                        // Otherwise a red alert
                                                        // saying "confirm the
                                                        // details" sat under a
                                                        // button that had just
                                                        // gone live, and nothing
                                                        // announced that the
                                                        // blocker had lifted.
                                                        if (event.target.checked) setFeedback(null);
                                                    }}
                                                />
                                                {/* The sentence names the
                                                    categories and shows not one
                                                    value: the policy forbids
                                                    showing a passport number or a
                                                    date of birth back to a
                                                    customer, so this cannot be a
                                                    "check these are right"
                                                    display. */}
                                                <div className="checkin-attestation-text">
                                                    <label htmlFor={`checkin-attest-${leg.legId}`}>
                                                        {DOCUMENT_ATTESTATION_LABEL}
                                                    </label>
                                                    {/* Always on screen, not only
                                                        after a refusal: the
                                                        customer who cannot
                                                        honestly tick the box is
                                                        the one who needs to know
                                                        there is a way out, and
                                                        they never press the
                                                        button. */}
                                                    <p
                                                        className="checkin-attestation-recourse"
                                                        id={`checkin-recourse-${leg.legId}`}
                                                    >
                                                        {DOCUMENT_ATTESTATION_RECOURSE}{' '}
                                                        {/* An actual route, not the
                                                            word "contact". Marked as
                                                            an example the way the
                                                            footer marks it, because
                                                            these details are
                                                            deliberately
                                                            non-routable (#72). */}
                                                        <a href={`mailto:${SUPPORT.email}`}>
                                                            {SUPPORT.email}
                                                        </a>{' '}
                                                        or{' '}
                                                        <a href={`tel:${SUPPORT.phone.replace(/[^\d+]/g, '')}`}>
                                                            {SUPPORT.phone}
                                                        </a>{' '}
                                                        <span className="checkin-attestation-example">
                                                            (example)
                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Says the attestation is on file rather
                                            than merely not asking again, so a
                                            customer returning for the return leg
                                            can tell they already confirmed. A
                                            timestamp column drives this and no
                                            value it attests to is named. */}
                                        {leg.documentsConfirmed
                                            && ATTESTATION_WORTH_STATING.includes(leg.reason) && (
                                            <p className="checkin-attestation-done">
                                                {DOCUMENT_ATTESTATION_CONFIRMED}
                                            </p>
                                        )}

                                        {leg.allowed && (
                                            <button
                                                type="button"
                                                className="checkin-submit"
                                                onClick={() => checkIn(leg)}
                                                /* Every button, not just the
                                                   pressed one. The re-entry
                                                   guard drops a click on another
                                                   leg while one is in flight, so
                                                   without this that button looks
                                                   live and does nothing -- the
                                                   dead control #70 is about. */
                                                aria-disabled={
                                                    pendingLegId !== null
                                                    || !(leg.documentsConfirmed || attested[leg.bookingId] === true)
                                                }
                                                aria-busy={busy}
                                            >
                                                {busy
                                                    ? 'Checking in…'
                                                    : !(leg.documentsConfirmed || attested[leg.bookingId] === true)
                                                        ? 'Confirm details to check in'
                                                        : leg.awaiting > 1
                                                            ? `Check in ${leg.awaiting} travellers`
                                                            : 'Check in'}
                                            </button>
                                        )}

                                        {leg.reason === 'BOOKING_DISRUPTED' && (
                                            <Link className="checkin-link" href="/profile">
                                                Choose replacement flights
                                            </Link>
                                        )}

                                        {shown && (
                                            <p
                                                ref={feedbackRef}
                                                role={shown.kind === 'error' ? 'alert' : 'status'}
                                                aria-live={shown.kind === 'error' ? 'assertive' : 'polite'}
                                                tabIndex={-1}
                                                className={`checkin-feedback ${shown.kind}`}
                                            >
                                                {shown.message}
                                            </p>
                                        )}
                                    </section>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}
