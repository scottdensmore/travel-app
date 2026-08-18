'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { checkInLegAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';
import type { CheckInReason } from '@/lib/checkInPolicy';

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
    travellers: Array<{
        name: string;
        seat: string;
        cabin: string;
        checkedIn: boolean;
    }>;
}

export default function CheckInPanel({ legs }: { legs: CheckInLegView[] }) {
    const router = useRouter();
    const [pendingLegId, setPendingLegId] = useState<number | null>(null);
    const [feedback, setFeedback] = useState<{
        legId: number;
        kind: 'success' | 'error';
        message: string;
    } | null>(null);
    const feedbackRef = useRef<HTMLParagraphElement | null>(null);

    // Moves focus to the outcome rather than leaving it on a button whose label
    // has changed underneath it, which is what a screen reader user would
    // otherwise have to go looking for (#205's lesson about arriving focus).
    useEffect(() => {
        if (feedback) feedbackRef.current?.focus();
    }, [feedback]);

    const checkIn = async (leg: CheckInLegView) => {
        if (pendingLegId !== null) return;

        setPendingLegId(leg.legId);
        setFeedback(null);
        try {
            const result = await checkInLegAction({
                bookingId: leg.bookingId,
                legId: leg.legId,
            });
            if (isActionValidationFailure(result)) {
                setFeedback({
                    legId: leg.legId,
                    kind: 'error',
                    message: result.error.message,
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
            });
            router.refresh();
        } catch {
            setFeedback({
                legId: leg.legId,
                kind: 'error',
                message: 'Could not check you in. Please try again.',
            });
        } finally {
            setPendingLegId(null);
        }
    };

    return (
        <div className="page-container checkin">
            <div className="checkin-shell">
                <h1>Check in</h1>
                <p className="checkin-intro">
                    Check-in opens 24 hours before each flight leaves and closes
                    an hour before it. A trip with more than one flight is
                    checked in one flight at a time.
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
                                                    {/* Past tense once it has
                                                        opened. The instant is
                                                        stated either way, and
                                                        "opens" beside yesterday
                                                        read as a contradiction. */}
                                                    {leg.reason === 'NOT_YET_OPEN'
                                                        ? 'Check-in opens'
                                                        : 'Check-in opened'}
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
                                                    <li key={`${leg.legId}-${traveller.name}`}>
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

                                        <p className="checkin-next-step">{leg.nextStep}</p>

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
                                                aria-disabled={pendingLegId !== null}
                                                aria-busy={busy}
                                            >
                                                {busy
                                                    ? 'Checking in…'
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
