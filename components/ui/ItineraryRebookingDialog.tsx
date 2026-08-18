'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    getOccupiedSeatsAction,
    rebookItineraryAction,
} from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';
import type { ReplacementFlightGroup } from '@/lib/itineraryReplacementSearch';
import { cabinLabel } from '@/lib/bookingItinerary';
import { flightDeparture } from '@/lib/flightTime';
import { seatsForCabin, type CabinClass } from '@/lib/seatLayout';

interface RebookingPassenger {
    id: string;
    firstName: string;
    lastName: string;
}

interface CancelledLeg {
    id: number;
    seatAssignments?: Array<{
        passengerId: string;
        cabinClass: string;
    }>;
}

interface ItineraryRebookingDialogProps {
    bookingId: number;
    bookingReference: string;
    passengers: RebookingPassenger[];
    cancelledLegs: CancelledLeg[];
    groups: ReplacementFlightGroup[];
    onSuccess: () => void;
}

const seatKey = (legId: number, passengerId: string) => `${legId}:${passengerId}`;

export default function ItineraryRebookingDialog({
    bookingId,
    bookingReference,
    passengers,
    cancelledLegs,
    groups,
    onSuccess,
}: ItineraryRebookingDialogProps) {
    const router = useRouter();
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const dialogRef = useRef<HTMLElement | null>(null);
    const firstFlightRef = useRef<HTMLSelectElement | null>(null);
    const errorRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [selectedFlights, setSelectedFlights] = useState<Record<number, number>>({});
    const [selectedSeats, setSelectedSeats] = useState<Record<string, string>>({});
    const [occupiedByFlight, setOccupiedByFlight] = useState<Record<number, string[]>>({});
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    const legsById = useMemo(
        () => new Map(cancelledLegs.map(leg => [leg.id, leg])),
        [cancelledLegs],
    );
    const selectedFlightFor = (group: ReplacementFlightGroup) => group.flights.find(
        flight => flight.id === selectedFlights[group.fromLegId],
    );
    const cabinFor = (legId: number, passengerId: string): CabinClass => (
        legsById.get(legId)?.seatAssignments?.find(
            assignment => assignment.passengerId === passengerId,
        )?.cabinClass as CabinClass | undefined
    ) ?? 'ECONOMY';

    useEffect(() => {
        if (open) firstFlightRef.current?.focus();
    }, [open]);

    useEffect(() => {
        if (error) errorRef.current?.focus();
    }, [error]);

    const loadOccupied = async (flightId: number) => {
        try {
            const occupied = await getOccupiedSeatsAction(flightId);
            setOccupiedByFlight(current => ({ ...current, [flightId]: occupied }));
        } catch {
            setError('Seat availability could not be refreshed. Please try again.');
        }
    };

    const chooseFlight = (legId: number, flightId: number) => {
        setSelectedFlights(current => ({ ...current, [legId]: flightId }));
        setSelectedSeats(current => Object.fromEntries(
            Object.entries(current).filter(([key]) => !key.startsWith(`${legId}:`)),
        ));
        setError(null);
        if (flightId) void loadOccupied(flightId);
    };

    const close = () => {
        triggerRef.current?.focus();
        setOpen(false);
        setError(null);
    };

    const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Escape' && !pending) {
            close();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? []);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    };

    const complete = groups.length > 0 && groups.every(group => {
        if (!selectedFlightFor(group)) return false;
        return passengers.every(passenger => selectedSeats[seatKey(group.fromLegId, passenger.id)]);
    });

    const submit = async () => {
        if (!complete || pending) return;
        setPending(true);
        setError(null);
        const replacements = groups.map(group => ({
            fromLegId: group.fromLegId,
            replacementFlightId: selectedFlights[group.fromLegId],
            seats: passengers.map(passenger => ({
                passengerId: passenger.id,
                seatNumber: selectedSeats[seatKey(group.fromLegId, passenger.id)],
            })),
        }));

        try {
            const result = await rebookItineraryAction({ bookingId, replacements });
            if (isActionValidationFailure(result)) {
                setError(result.error.message);
                await Promise.all(Object.values(selectedFlights).map(loadOccupied));
                return;
            }
            setOpen(false);
            onSuccess();
            router.refresh();
        } catch {
            setError('Your booking could not be rebooked. Please try again.');
        } finally {
            setPending(false);
        }
    };

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className="replacement-booking-trigger"
                onClick={() => {
                    setOpen(true);
                }}
            >
                Select replacement seats
            </button>
            {open && (
                <div className="rebooking-dialog-backdrop">
                    <section
                        ref={dialogRef}
                        className="rebooking-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={`rebooking-title-${bookingId}`}
                        onKeyDown={handleDialogKeyDown}
                    >
                        <div className="rebooking-dialog-heading">
                            <h2 id={`rebooking-title-${bookingId}`}>
                                Rebook confirmation {bookingReference}
                            </h2>
                            <button
                                type="button"
                                aria-label="Close replacement selection"
                                onClick={close}
                                disabled={pending}
                            >
                                ×
                            </button>
                        </div>
                        <p>
                            Choose one replacement flight and one seat for every traveller.
                            Your original fare is protected.
                        </p>
                        {error && (
                            <div ref={errorRef} className="rebooking-error" role="alert" tabIndex={-1}>
                                {error}
                            </div>
                        )}
                        <div className="rebooking-leg-list">
                            {groups.map((group, groupIndex) => {
                                const flight = selectedFlightFor(group);
                                const locallyChosen = new Set(passengers.flatMap(passenger => {
                                    const seat = selectedSeats[seatKey(group.fromLegId, passenger.id)];
                                    return seat ? [seat] : [];
                                }));
                                return (
                                    <fieldset className="rebooking-leg" key={group.fromLegId}>
                                        <legend>{group.originalFlightNumber}: {group.from} → {group.to}</legend>
                                        <label>
                                            Replacement flight for {group.originalFlightNumber}
                                            <select
                                                ref={groupIndex === 0 ? firstFlightRef : undefined}
                                                value={selectedFlights[group.fromLegId] ?? ''}
                                                onChange={event => chooseFlight(
                                                    group.fromLegId,
                                                    Number(event.target.value),
                                                )}
                                                disabled={pending}
                                            >
                                                <option value="">Choose a flight</option>
                                                {group.flights.map(option => {
                                                    const departure = flightDeparture(option);
                                                    return (
                                                        <option key={option.id} value={option.id}>
                                                            {option.airline} {option.flightNumber} — {departure.readableDate} at {departure.time} {departure.zoneLabel}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </label>
                                        {flight && passengers.map(passenger => {
                                            const cabin = cabinFor(group.fromLegId, passenger.id);
                                            const currentSeat = selectedSeats[seatKey(group.fromLegId, passenger.id)] ?? '';
                                            const occupied = new Set(occupiedByFlight[flight.id] ?? []);
                                            const selectId = `replacement-seat-${bookingId}-${group.fromLegId}-${passenger.id}`;
                                            return (
                                                <div className="rebooking-seat-choice" key={passenger.id}>
                                                    <label htmlFor={selectId}>
                                                        Replacement seat for {passenger.firstName} {passenger.lastName} on {flight.flightNumber}
                                                    </label>
                                                    <span>{cabinLabel(cabin)}</span>
                                                    <select
                                                        id={selectId}
                                                        value={currentSeat}
                                                        onChange={event => setSelectedSeats(current => ({
                                                            ...current,
                                                            [seatKey(group.fromLegId, passenger.id)]: event.target.value,
                                                        }))}
                                                        disabled={pending}
                                                    >
                                                        <option value="">Choose a seat</option>
                                                        {seatsForCabin(cabin, flight).map(seat => {
                                                            const unavailable = occupied.has(seat)
                                                                || (locallyChosen.has(seat) && seat !== currentSeat);
                                                            return (
                                                                <option key={seat} value={seat} disabled={unavailable}>
                                                                    {seat}{occupied.has(seat) ? ' — occupied' : ''}
                                                                </option>
                                                            );
                                                        })}
                                                    </select>
                                                </div>
                                            );
                                        })}
                                    </fieldset>
                                );
                            })}
                        </div>
                        <div className="rebooking-dialog-actions">
                            <button type="button" onClick={close} disabled={pending}>Keep current booking</button>
                            <button
                                type="button"
                                onClick={() => void submit()}
                                disabled={!complete || pending}
                                aria-busy={pending}
                            >
                                {pending ? 'Confirming replacement flights…' : 'Confirm replacement flights'}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </>
    );
}
