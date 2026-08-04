"use client"

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PassengerInput } from '@/lib/FlightBookingService';
import { bookFlightAction } from '@/app/actions';
import { isActionValidationFailure } from '@/lib/actionResult';
import { CABIN_FARE_PERCENT, calculatePassengerFareCents, flightFareCents, formatPrice } from '@/lib/bookingPricing';

interface Flight {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureDate: Date | string;
    priceCents: number;
    firstClassRows?: number | null;
    businessRows?: number | null;
    premiumEconomyRows?: number | null;
    economyRows?: number | null;
    seatPattern?: string | null;
}

interface BookingCheckoutWizardProps {
    /// The itinerary, in leg order: one flight one-way, two for a round trip.
    flights: Flight[];
    /// Seats already taken on each leg, in the same order as `flights`.
    occupiedSeats: string[][];
    /// The cabin the customer shopped, so the fare they were quoted is the one
    /// offered here. Ignored when a leg does not operate it.
    cabinClass?: PassengerFormState['cabinClass'];
}

interface PassengerFormState {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    passportNumber: string;
    gender: string;
    cabinClass: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
    /// One seat per leg, in the same order as the itinerary's flights.
    seatNumbers: string[];
}

interface ConfirmedPassenger {
    firstName: string;
    lastName: string;
    /// One seat per leg, in itinerary order.
    seatNumbers: string[];
    cabinClass: string;
}

const CABIN_LABELS = {
    ECONOMY: 'Economy',
    PREMIUM_ECONOMY: 'Premium Economy (+50%)',
    BUSINESS: 'Business (+100%)',
    FIRST: 'First Class (+200%)'
};

function createBookingRequestId(): string {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function BookingCheckoutWizard({ flights, occupiedSeats: initialOccupiedSeats, cabinClass: searchedCabin }: BookingCheckoutWizardProps) {
    // Seats are chosen one leg at a time: each flight has its own cabin layout,
    // its own seat pattern, and its own occupancy.
    const [activeLegIndex, setActiveLegIndex] = useState<number>(0);
    const flight = flights[activeLegIndex];
    const activeLegTabRef = useRef<HTMLButtonElement | null>(null);
    // Only an arrow key should pull focus onto the tab; clicking a tab or being
    // sent to a leg by validation must leave focus where the user put it.
    const legTabFocusPendingRef = useRef(false);

    /** Arrow/Home/End move between legs, as the tab pattern expects. */
    const handleLegTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const lastIndex = flights.length - 1;
        let nextIndex: number | null = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            nextIndex = activeLegIndex === lastIndex ? 0 : activeLegIndex + 1;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            nextIndex = activeLegIndex === 0 ? lastIndex : activeLegIndex - 1;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = lastIndex;
        }
        if (nextIndex === null) return;
        event.preventDefault();
        legTabFocusPendingRef.current = true;
        setActiveLegIndex(nextIndex);
    };

    useEffect(() => {
        if (!legTabFocusPendingRef.current) return;
        legTabFocusPendingRef.current = false;
        activeLegTabRef.current?.focus();
    }, [activeLegIndex]);
    const cabinRowCounts: Record<PassengerFormState['cabinClass'], number> = {
        ECONOMY: flight.economyRows ?? 20,
        PREMIUM_ECONOMY: flight.premiumEconomyRows ?? 4,
        BUSINESS: flight.businessRows ?? 3,
        FIRST: flight.firstClassRows ?? 3
    };
    const availableCabins = (Object.keys(CABIN_FARE_PERCENT) as PassengerFormState['cabinClass'][])
        .filter(cabin => cabinRowCounts[cabin] > 0);
    // The cabin the customer shopped, when this leg operates it. Falling back
    // rather than failing: a leg without that cabin still has to be bookable.
    const defaultCabin = searchedCabin && availableCabins.includes(searchedCabin)
        ? searchedCabin
        : availableCabins[0];

    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
    const [passengers, setPassengers] = useState<PassengerFormState[]>([
        {
            firstName: '',
            lastName: '',
            dateOfBirth: '',
            passportNumber: '',
            gender: 'Male',
            cabinClass: defaultCabin,
            seatNumbers: flights.map(() => '')
        }
    ]);
    const [activePassengerIndex, setActivePassengerIndex] = useState<number>(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string[]>>({});
    const [bookingResult, setBookingResult] = useState<{
        id: number;
        totalPriceCents: number | null;
        passengers: ConfirmedPassenger[];
    } | null>(null);
    const idempotencyKeyRef = useRef<string | null>(null);
    const [autoAllocateGroup, setAutoAllocateGroup] = useState<boolean>(true);
    const [hoveredSuggestedSeats, setHoveredSuggestedSeats] = useState<string[]>([]);

    // Calculate total price
    const calculatePassengerPrice = (cabin: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST') =>
        flights.reduce(
            (total, leg) => total + calculatePassengerFareCents(flightFareCents(leg), cabin),
            0
        );

    const totalPriceCents = passengers.reduce((sum, p) => sum + calculatePassengerPrice(p.cabinClass), 0);
    const totalPriceDisplay = formatPrice(totalPriceCents);

    const handleAddPassenger = () => {
        setPassengers([
            ...passengers,
            {
                firstName: '',
                lastName: '',
                dateOfBirth: '',
                passportNumber: '',
                gender: 'Male',
                cabinClass: defaultCabin,
                seatNumbers: flights.map(() => '')
            }
        ]);
    };

    const handleRemovePassenger = (index: number) => {
        if (passengers.length === 1) return;
        const updated = passengers.filter((_, i) => i !== index);
        setPassengers(updated);
        setActivePassengerIndex(Math.max(0, index - 1));
    };

    const handlePassengerChange = <K extends keyof PassengerFormState>(
        index: number,
        field: K,
        value: PassengerFormState[K]
    ) => {
        const updated = passengers.map(passenger => ({ ...passenger, seatNumbers: [...passenger.seatNumbers] }));
        updated[index] = { ...updated[index], [field]: value };

        // Reset every leg's seat if the cabin changes: the row ranges differ per
        // cabin, so a seat chosen for the old one may not exist in the new.
        if (field === 'cabinClass') {
            updated[index].seatNumbers = flights.map(() => '');
        }
        setPassengers(updated);
        const fieldPath = `passengers.${index}.${field}`;
        setServerFieldErrors(current => {
            if (!current[fieldPath]) return current;
            const next = { ...current };
            delete next[fieldPath];
            return next;
        });
    };

    const getPassengerFieldError = (index: number, field: keyof PassengerFormState) =>
        serverFieldErrors[`passengers.${index}.${field}`]?.[0];

    /**
     * Seat errors name the leg they belong to, so the path may be either
     * `passengers.0.seatNumbers` or `passengers.0.seatNumbers.1`.
     */
    const getPassengerSeatError = (index: number) => {
        const prefix = `passengers.${index}.seatNumbers`;
        const field = Object.keys(serverFieldErrors)
            .find(key => key === prefix || key.startsWith(`${prefix}.`));
        return field ? serverFieldErrors[field]?.[0] : undefined;
    };

    const validateStep1 = () => {
        for (let i = 0; i < passengers.length; i++) {
            const p = passengers[i];
            if (!p.firstName.trim() || !p.lastName.trim() || !p.dateOfBirth || !p.passportNumber.trim()) {
                setErrorMessage(`Please fill out all details for Passenger ${i + 1}.`);
                return false;
            }
        }
        setErrorMessage(null);
        return true;
    };

    const validateStep2 = () => {
        for (let i = 0; i < passengers.length; i++) {
            const missingLeg = passengers[i].seatNumbers.findIndex(seat => !seat);
            if (missingLeg !== -1) {
                setActiveLegIndex(missingLeg);
                setErrorMessage(flights.length > 1
                    ? `Please select a ${missingLeg === 0 ? 'departing' : 'returning'} seat for Passenger ${i + 1}.`
                    : `Please select a seat for Passenger ${i + 1}.`);
                return false;
            }
        }
        setErrorMessage(null);
        return true;
    };

    const handleNextStep = () => {
        if (step === 1 && validateStep1()) setStep(2);
        else if (step === 2 && validateStep2()) setStep(3);
    };

    const handlePrevStep = () => {
        if (step === 2) setStep(1);
        else if (step === 3) setStep(2);
    };

    // Seat Map Definitions
    const getRowsForClass = (cabinClass: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST') => {
        const firstClassCount = flight.firstClassRows !== undefined && flight.firstClassRows !== null ? Number(flight.firstClassRows) : 3;
        const businessCount = flight.businessRows !== undefined && flight.businessRows !== null ? Number(flight.businessRows) : 3;
        const premiumEconomyCount = flight.premiumEconomyRows !== undefined && flight.premiumEconomyRows !== null ? Number(flight.premiumEconomyRows) : 4;
        const economyCount = flight.economyRows !== undefined && flight.economyRows !== null ? Number(flight.economyRows) : 20;

        let currentOffset = 1;

        if (cabinClass === 'FIRST') {
            return Array.from({ length: firstClassCount }, (_, i) => currentOffset + i);
        }
        currentOffset += firstClassCount;

        if (cabinClass === 'BUSINESS') {
            return Array.from({ length: businessCount }, (_, i) => currentOffset + i);
        }
        currentOffset += businessCount;

        if (cabinClass === 'PREMIUM_ECONOMY') {
            return Array.from({ length: premiumEconomyCount }, (_, i) => currentOffset + i);
        }
        currentOffset += premiumEconomyCount;

        if (cabinClass === 'ECONOMY') {
            return Array.from({ length: economyCount }, (_, i) => currentOffset + i);
        }
        return [];
    };

    const parsedPattern = flight.seatPattern || "ABC-DEF";
    const seatLetters = parsedPattern.replace(/[^A-Z]/g, "").split("");
    const activeRows = getRowsForClass(passengers[activePassengerIndex]?.cabinClass || 'ECONOMY');

    const isSeatOccupied = (seat: string) => {
        return (initialOccupiedSeats[activeLegIndex] ?? []).includes(seat);
    };

    const getGroupPassengerForSeat = (seat: string) => {
        return passengers.findIndex(p => p.seatNumbers[activeLegIndex] === seat);
    };

    const getAdjacentSuggestedSeats = (startSeatId: string, count: number): string[] => {
        if (count <= 1) return [startSeatId];

        const row = parseInt(startSeatId.slice(0, -1), 10);
        const letter = startSeatId.slice(-1);
        const cabinClass = passengers[activePassengerIndex]?.cabinClass || 'ECONOMY';
        const rows = getRowsForClass(cabinClass);

        const currentOccupied = new Set(initialOccupiedSeats[activeLegIndex] ?? []);
        const suggested: string[] = [startSeatId];

        const startIdx = seatLetters.indexOf(letter);
        if (startIdx === -1) return suggested;

        const blocks = parsedPattern.split("-");
        const block = blocks.find(b => b.includes(letter));
        if (!block) return suggested;

        const sideLetters = block.split("");
        const sideIdx = sideLetters.indexOf(letter);

        // Fill seats on the same side of the aisle first
        for (let i = sideIdx + 1; i < sideLetters.length; i++) {
            const testSeat = `${row}${sideLetters[i]}`;
            if (!currentOccupied.has(testSeat) && !suggested.includes(testSeat)) {
                suggested.push(testSeat);
                if (suggested.length === count) return suggested;
            }
        }
        for (let i = sideIdx - 1; i >= 0; i--) {
            const testSeat = `${row}${sideLetters[i]}`;
            if (!currentOccupied.has(testSeat) && !suggested.includes(testSeat)) {
                suggested.push(testSeat);
                if (suggested.length === count) return suggested;
            }
        }

        // If we still need seats, look at other side of the aisle in the same row
        const otherBlocks = blocks.filter(b => b !== block);
        const otherSideLetters = otherBlocks.flatMap(b => b.split(""));
        for (const testLetter of otherSideLetters) {
            const testSeat = `${row}${testLetter}`;
            if (!currentOccupied.has(testSeat) && !suggested.includes(testSeat)) {
                suggested.push(testSeat);
                if (suggested.length === count) return suggested;
            }
        }

        // If we still need seats, look at consecutive rows (row + 1, row - 1, etc.)
        for (const nextRow of rows) {
            if (nextRow === row) continue;
            // Prefer the same side of aisle in the next row
            for (const testLetter of sideLetters) {
                const testSeat = `${nextRow}${testLetter}`;
                if (!currentOccupied.has(testSeat) && !suggested.includes(testSeat)) {
                    suggested.push(testSeat);
                    if (suggested.length === count) return suggested;
                }
            }
            // Then other side of aisle in next row
            for (const testLetter of otherSideLetters) {
                const testSeat = `${nextRow}${testLetter}`;
                if (!currentOccupied.has(testSeat) && !suggested.includes(testSeat)) {
                    suggested.push(testSeat);
                    if (suggested.length === count) return suggested;
                }
            }
        }

        return suggested;
    };

    const autoAssignAdjacentSeats = () => {
        const updatedPassengers = [...passengers];
        const currentOccupied = new Set(initialOccupiedSeats[activeLegIndex] ?? []);
        const classes: PassengerFormState['cabinClass'][] = ['FIRST', 'BUSINESS', 'PREMIUM_ECONOMY', 'ECONOMY'];

        for (const cabinClass of classes) {
            const classPassengers = updatedPassengers.map((p, idx) => ({ p, idx })).filter(item => item.p.cabinClass === cabinClass);
            if (classPassengers.length === 0) continue;

            const rows = getRowsForClass(cabinClass);
            const passengerIndicesToAssign = classPassengers.map(cp => cp.idx);
            const count = passengerIndicesToAssign.length;

            let bestAssignment: string[] | null = null;

            const seatBlocks = parsedPattern
                .split('-')
                .map(block => block.replace(/[^A-Z]/g, '').split(''))
                .filter(block => block.length > 0);

            if (seatBlocks.some(block => count <= block.length)) {
                for (const row of rows) {
                    for (const seatBlock of seatBlocks) {
                        for (let start = 0; start <= seatBlock.length - count; start++) {
                            const block = seatBlock
                                .slice(start, start + count)
                                .map(letter => `${row}${letter}`);
                            if (block.every(seat => !currentOccupied.has(seat))) {
                                bestAssignment = block;
                                break;
                            }
                        }
                        if (bestAssignment) break;
                    }
                    if (bestAssignment) break;
                }
            }

            if (!bestAssignment) {
                for (const row of rows) {
                    const seats = seatLetters.map(letter => `${row}${letter}`);
                    const freeInRow = seats.filter(seat => !currentOccupied.has(seat));
                    if (freeInRow.length >= count) {
                        bestAssignment = freeInRow.slice(0, count);
                        break;
                    }
                }
            }

            if (!bestAssignment) {
                const freeSeats: string[] = [];
                for (const row of rows) {
                    const seats = seatLetters.map(letter => `${row}${letter}`);
                    for (const seat of seats) {
                        if (!currentOccupied.has(seat)) {
                            freeSeats.push(seat);
                            if (freeSeats.length === count) {
                                bestAssignment = freeSeats;
                                break;
                            }
                        }
                    }
                    if (bestAssignment) break;
                }
            }

            if (bestAssignment && bestAssignment.length === count) {
                for (let i = 0; i < count; i++) {
                    const pIdx = passengerIndicesToAssign[i];
                    updatedPassengers[pIdx].seatNumbers[activeLegIndex] = bestAssignment[i];
                    currentOccupied.add(bestAssignment[i]);
                }
            } else {
                let seatIdx = 0;
                const allFree: string[] = [];
                for (const row of rows) {
                    const seats = seatLetters.map(letter => `${row}${letter}`);
                    for (const seat of seats) {
                        if (!currentOccupied.has(seat)) {
                            allFree.push(seat);
                        }
                    }
                }
                for (let i = 0; i < count; i++) {
                    const pIdx = passengerIndicesToAssign[i];
                    if (seatIdx < allFree.length) {
                        updatedPassengers[pIdx].seatNumbers[activeLegIndex] = allFree[seatIdx];
                        currentOccupied.add(allFree[seatIdx]);
                        seatIdx++;
                    }
                }
            }
        }

        setPassengers(updatedPassengers);
        setErrorMessage(null);
    };

    const handleSeatClick = (seat: string) => {
        const cabinClass = passengers[activePassengerIndex]?.cabinClass || 'ECONOMY';
        setServerFieldErrors(current => Object.fromEntries(
            Object.entries(current).filter(([field]) => !/^passengers\.\d+\.seatNumbers(\.\d+)?$/.test(field))
        ));

        if (autoAllocateGroup && passengers.length > 1) {
            const sameClassPassengerIndices = passengers
                .map((p, i) => ({ p, i }))
                .filter(item => item.p.cabinClass === cabinClass)
                .map(item => item.i);
            const count = sameClassPassengerIndices.length;
            const suggestions = getAdjacentSuggestedSeats(seat, count);

            const updated = [...passengers];
            let suggestionIdx = 0;

            updated[activePassengerIndex].seatNumbers[activeLegIndex] = suggestions[0] || seat;
            suggestionIdx++;

            for (const pIdx of sameClassPassengerIndices) {
                if (pIdx === activePassengerIndex) continue;
                if (suggestionIdx < suggestions.length) {
                    updated[pIdx].seatNumbers[activeLegIndex] = suggestions[suggestionIdx];
                    suggestionIdx++;
                }
            }

            setPassengers(updated);
            setErrorMessage(null);
        } else {
            const passengerIndexAtSeat = passengers.findIndex(p => p.seatNumbers[activeLegIndex] === seat);
            const updated = [...passengers];

            if (passengerIndexAtSeat >= 0 && passengerIndexAtSeat !== activePassengerIndex) {
                const prevActiveSeat = updated[activePassengerIndex].seatNumbers[activeLegIndex];
                updated[activePassengerIndex].seatNumbers[activeLegIndex] = seat;
                updated[passengerIndexAtSeat].seatNumbers[activeLegIndex] = prevActiveSeat;
            } else {
                updated[activePassengerIndex].seatNumbers[activeLegIndex] = seat;
            }
            setPassengers(updated);
            setErrorMessage(null);
        }
    };

    const handleSeatMouseEnter = (seatId: string) => {
        if (!autoAllocateGroup || passengers.length <= 1) return;
        const sameClassPassengerIndices = passengers
            .map((p, i) => ({ p, i }))
            .filter(item => item.p.cabinClass === passengers[activePassengerIndex]?.cabinClass)
            .map(item => item.i);
        const count = sameClassPassengerIndices.length;
        const suggestions = getAdjacentSuggestedSeats(seatId, count);
        setHoveredSuggestedSeats(suggestions);
    };

    const handleSeatMouseLeave = () => {
        setHoveredSuggestedSeats([]);
    };

    const handleSubmitBooking = async () => {
        setIsSubmitting(true);
        setErrorMessage(null);
        setServerFieldErrors({});

        try {
            const formattedPassengers: PassengerInput[] = passengers.map(p => ({
                firstName: p.firstName,
                lastName: p.lastName,
                dateOfBirth: new Date(p.dateOfBirth).toISOString(),
                passportNumber: p.passportNumber,
                gender: p.gender,
                // One seat per leg, in itinerary order.
                seatNumbers: p.seatNumbers,
                cabinClass: p.cabinClass
            }));

            idempotencyKeyRef.current ??= createBookingRequestId();
            const result = await bookFlightAction({
                flightIds: flights.map(leg => leg.id),
                passengers: formattedPassengers,
                idempotencyKey: idempotencyKeyRef.current
            });

            if (isActionValidationFailure(result)) {
                setErrorMessage(result.error.message);
                setServerFieldErrors(result.error.fields);
                const firstFieldPath = Object.keys(result.error.fields)[0];
                const passengerMatch = /^passengers\.(\d+)\.(\w+)(?:\.\d+)?$/.exec(firstFieldPath || '');
                if (passengerMatch) {
                    const passengerIndex = Number(passengerMatch[1]);
                    setActivePassengerIndex(passengerIndex);
                    setStep(passengerMatch[2] === 'seatNumbers' ? 2 : 1);
                    // The trailing index names the leg, so show the map the
                    // error is about rather than whichever leg was open.
                    const legMatch = /^passengers\.\d+\.seatNumbers\.(\d+)$/.exec(firstFieldPath);
                    if (legMatch) {
                        setActiveLegIndex(Number(legMatch[1]));
                    }
                    setTimeout(() => {
                        // A seat error names its leg, so the path carries a
                        // trailing index the target element does not.
                        const targetPath = firstFieldPath.replace(
                            /^(passengers\.\d+\.seatNumbers)(?:\.\d+)?$/,
                            'passengers.$#.seatNumber',
                        ).replace('$#', String(passengerIndex));
                        const field = document.querySelector<HTMLElement>(
                            `[data-validation-path="${targetPath}"]`
                        );
                        field?.focus();
                    }, 0);
                }
                return;
            }

            setBookingResult({
                id: result.id,
                totalPriceCents: result.totalPriceCents,
                // The confirmation prints the seat held on each leg, in leg
                // order, rather than one seat for the whole trip (#137).
                passengers: result.passengers.map((passenger: {
                    firstName: string; lastName: string; seatNumbers: string[];
                }, index: number) => ({
                    firstName: passenger.firstName,
                    lastName: passenger.lastName,
                    seatNumbers: passenger.seatNumbers,
                    cabinClass: passengers[index]?.cabinClass ?? 'ECONOMY',
                }))
            });
            setStep(4);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'We couldn’t confirm your booking. Please try again.';
            setErrorMessage(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div style={{ maxWidth: '900px', width: '100%', margin: '100px auto 4rem', color: '#fff', padding: '0 1rem' }}>
            {/* Steps Header indicator */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2.5rem', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '15px', left: 0, right: 0, height: '2px', background: 'rgba(255, 255, 255, 0.1)', zIndex: 1 }} />
                {[
                    { s: 1, label: 'Travelers' },
                    { s: 2, label: 'Seats' },
                    { s: 3, label: 'Review' },
                    { s: 4, label: 'E-Ticket' }
                ].map((item) => (
                    <div key={item.s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, flex: 1 }}>
                        <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: step === item.s ? '#8b5cf6' : step > item.s ? '#10b981' : '#1e1b4b',
                            border: '2px solid rgba(255,255,255,0.15)',
                            fontWeight: 'bold',
                            fontSize: '0.85rem'
                        }}>
                            {step > item.s ? '✓' : item.s}
                        </div>
                        <span style={{ fontSize: '0.8rem', marginTop: '6px', color: step >= item.s ? '#fff' : 'rgba(255,255,255,0.4)', fontWeight: step === item.s ? 'bold' : 'normal' }}>
                            {item.label}
                        </span>
                    </div>
                ))}
            </div>

            {errorMessage && (
                <div role="alert" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '12px', borderRadius: '8px', marginBottom: '1.5rem' }}>
                    ⚠️ {errorMessage}
                </div>
            )}

            {/* Glassmorphic Container Card */}
            <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                padding: '2.5rem',
                borderRadius: '24px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                backdropFilter: 'blur(20px)',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)'
            }}>

                {/* STEP 1: PASSENGERS FORM */}
                {step === 1 && (
                    <div>
                        <h2 style={{ fontSize: '1.8rem', color: '#c084fc', marginBottom: '0.5rem', fontWeight: 'bold' }}>Traveler Information</h2>
                        <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '2rem' }}>Please enter details exactly as they appear on passenger passports.</p>

                        {passengers.map((passenger, index) => (
                            <div key={index} style={{ border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.01)', position: 'relative' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#a78bfa' }}>Passenger #{index + 1}</h3>
                                    {passengers.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => handleRemovePassenger(index)}
                                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' }}>
                                            ✕ Remove
                                        </button>
                                    )}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>First Name</label>
                                        <input
                                            type="text"
                                            value={passenger.firstName}
                                            onChange={(e) => handlePassengerChange(index, 'firstName', e.target.value)}
                                            placeholder="John"
                                            data-validation-path={`passengers.${index}.firstName`}
                                            aria-invalid={Boolean(getPassengerFieldError(index, 'firstName'))}
                                            aria-describedby={getPassengerFieldError(index, 'firstName') ? `passenger-${index}-firstName-error` : undefined}
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                                        />
                                        {getPassengerFieldError(index, 'firstName') && <div id={`passenger-${index}-firstName-error`} style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '4px' }}>{getPassengerFieldError(index, 'firstName')}</div>}
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>Last Name</label>
                                        <input
                                            type="text"
                                            value={passenger.lastName}
                                            onChange={(e) => handlePassengerChange(index, 'lastName', e.target.value)}
                                            placeholder="Doe"
                                            data-validation-path={`passengers.${index}.lastName`}
                                            aria-invalid={Boolean(getPassengerFieldError(index, 'lastName'))}
                                            aria-describedby={getPassengerFieldError(index, 'lastName') ? `passenger-${index}-lastName-error` : undefined}
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                                        />
                                        {getPassengerFieldError(index, 'lastName') && <div id={`passenger-${index}-lastName-error`} style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '4px' }}>{getPassengerFieldError(index, 'lastName')}</div>}
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>Date of Birth</label>
                                        <input
                                            type="date"
                                            value={passenger.dateOfBirth}
                                            onChange={(e) => handlePassengerChange(index, 'dateOfBirth', e.target.value)}
                                            data-validation-path={`passengers.${index}.dateOfBirth`}
                                            aria-invalid={Boolean(getPassengerFieldError(index, 'dateOfBirth'))}
                                            aria-describedby={getPassengerFieldError(index, 'dateOfBirth') ? `passenger-${index}-dateOfBirth-error` : undefined}
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                                        />
                                        {getPassengerFieldError(index, 'dateOfBirth') && <div id={`passenger-${index}-dateOfBirth-error`} style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '4px' }}>{getPassengerFieldError(index, 'dateOfBirth')}</div>}
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>Passport Number</label>
                                        <input
                                            type="text"
                                            value={passenger.passportNumber}
                                            onChange={(e) => handlePassengerChange(index, 'passportNumber', e.target.value)}
                                            placeholder="A00000000"
                                            data-validation-path={`passengers.${index}.passportNumber`}
                                            aria-invalid={Boolean(getPassengerFieldError(index, 'passportNumber'))}
                                            aria-describedby={getPassengerFieldError(index, 'passportNumber') ? `passenger-${index}-passportNumber-error` : undefined}
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                                        />
                                        {getPassengerFieldError(index, 'passportNumber') && <div id={`passenger-${index}-passportNumber-error`} style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '4px' }}>{getPassengerFieldError(index, 'passportNumber')}</div>}
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>Gender</label>
                                        <select
                                            value={passenger.gender}
                                            onChange={(e) => handlePassengerChange(index, 'gender', e.target.value)}
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: '#181720', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>
                                            <option>Male</option>
                                            <option>Female</option>
                                            <option>Other</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>Travel Class</label>
                                        <select
                                            value={passenger.cabinClass}
                                            onChange={(e) => handlePassengerChange(index, 'cabinClass', e.target.value as PassengerFormState['cabinClass'])}
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: '#181720', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>
                                            {availableCabins.map((cabin) => (
                                                <option key={cabin} value={cabin}>{CABIN_LABELS[cabin]}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        ))}

                        <div className="booking-wizard-actions booking-traveler-actions">
                            <button
                                type="button"
                                onClick={handleAddPassenger}
                                style={{ background: 'none', border: '1px dashed #8b5cf6', color: '#c084fc', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                                + Add Traveler
                            </button>

                            <div className="booking-traveler-primary-actions">
                                <span style={{ fontSize: '1.1rem', color: '#34d399', fontWeight: 'bold' }}>Estimated total: {totalPriceDisplay}</span>
                                <button
                                    type="button"
                                    onClick={handleNextStep}
                                    style={{ backgroundColor: '#8b5cf6', color: '#fff', border: 'none', padding: '10px 28px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    Select Seats →
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 2: SEAT SELECTION */}
                {step === 2 && (
                    <div>
                        <h2 style={{ fontSize: '1.8rem', color: '#c084fc', marginBottom: '0.5rem', fontWeight: 'bold' }}>Select Your Seats</h2>
                        <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '2rem' }}>Choose seats for each traveler. Highlighted rows correspond to each passenger&apos;s cabin class.</p>

                        {/*
                          * Each leg has its own cabin layout and occupancy, so
                          * seats are chosen one leg at a time.
                          */}
                        {flights.length > 1 && (
                            <div role="tablist" aria-label="Itinerary leg" data-testid="leg-switcher" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
                                {flights.map((leg, legIndex) => {
                                    const isActive = legIndex === activeLegIndex;
                                    const unseated = passengers.some(passenger => !passenger.seatNumbers[legIndex]);
                                    return (
                                        <button
                                            key={leg.id}
                                            type="button"
                                            role="tab"
                                            id={`leg-tab-${legIndex}`}
                                            aria-selected={isActive}
                                            aria-controls={`leg-panel-${legIndex}`}
                                            // Roving tabindex: the tablist is one
                                            // tab stop and arrows move within it.
                                            tabIndex={isActive ? 0 : -1}
                                            ref={isActive ? activeLegTabRef : undefined}
                                            onKeyDown={handleLegTabKeyDown}
                                            onClick={() => setActiveLegIndex(legIndex)}
                                            style={{
                                                // globals.css pins every button to
                                                // 52px and full width; a two-line
                                                // label needs to grow instead.
                                                height: 'auto',
                                                minHeight: '52px',
                                                width: 'auto',
                                                flex: '1 1 14rem',
                                                padding: '10px 16px',
                                                borderRadius: '8px',
                                                border: `2px solid ${isActive ? '#8b5cf6' : 'rgba(255,255,255,0.15)'}`,
                                                background: isActive ? 'rgba(139, 92, 246, 0.12)' : 'transparent',
                                                color: '#fff',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <span style={{ display: 'block', fontWeight: 'bold', fontSize: '0.9rem' }}>
                                                {legIndex === 0 ? 'Departing' : 'Returning'}
                                            </span>
                                            <span style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
                                                {leg.from} → {leg.to}{unseated ? ' · seat needed' : ''}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {passengers.length > 1 && (
                            <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '1rem',
                                background: 'rgba(255, 255, 255, 0.03)',
                                padding: '1rem 1.5rem',
                                borderRadius: '12px',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                marginBottom: '1.5rem',
                                backdropFilter: 'blur(10px)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <input
                                        type="checkbox"
                                        id="autoAllocateGroup"
                                        checked={autoAllocateGroup}
                                        onChange={(e) => setAutoAllocateGroup(e.target.checked)}
                                        style={{ width: '18px', height: '18px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                                    />
                                    <label htmlFor="autoAllocateGroup" style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.9)', cursor: 'pointer', userSelect: 'none' }}>
                                        Auto-allocate adjacent seats on map click
                                    </label>
                                </div>

                                <button
                                    type="button"
                                    onClick={autoAssignAdjacentSeats}
                                    style={{
                                        background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                                        color: '#fff',
                                        border: 'none',
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        cursor: 'pointer',
                                        fontWeight: 'bold',
                                        fontSize: '0.85rem',
                                        boxShadow: '0 4px 12px rgba(109, 40, 217, 0.3)',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    ✨ Auto-Assign Adjacent Seats
                                </button>
                            </div>
                        )}

                        <div
                            {...(flights.length > 1
                                ? {
                                    role: 'tabpanel',
                                    id: `leg-panel-${activeLegIndex}`,
                                    'aria-labelledby': `leg-tab-${activeLegIndex}`,
                                }
                                : {})}
                            style={{ display: 'flex', flexWrap: 'wrap', gap: '2.5rem' }}
                        >
                            {/* Left panel: Passenger selector */}
                            <div style={{ flex: '1 1 250px' }}>
                                <h3 style={{ fontSize: '1rem', color: '#a78bfa', marginBottom: '1rem' }}>Passengers</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {passengers.map((p, idx) => (
                                        <React.Fragment key={idx}>
                                        <button
                                            type="button"
                                            onClick={() => setActivePassengerIndex(idx)}
                                            data-validation-path={`passengers.${idx}.seatNumber`}
                                            aria-label={`${p.firstName || 'Passenger'} ${p.lastName || `#${idx + 1}`}, Class: ${p.cabinClass}, Seat: ${p.seatNumbers[activeLegIndex] || 'Not Chosen'}`}
                                            aria-pressed={activePassengerIndex === idx}
                                            data-invalid={Boolean(getPassengerSeatError(idx)) || undefined}
                                            aria-describedby={getPassengerSeatError(idx) ? `passenger-${idx}-seatNumber-error` : undefined}
                                            style={{
                                                width: '100%',
                                                // Two lines, and "Seats: 11A, 12C"
                                                // on a round trip, do not fit the
                                                // global 52px button height.
                                                height: 'auto',
                                                minHeight: '52px',
                                                color: 'inherit',
                                                textAlign: 'left',
                                                padding: '12px',
                                                borderRadius: '8px',
                                                border: activePassengerIndex === idx ? '2px solid #8b5cf6' : '1px solid rgba(255,255,255,0.08)',
                                                background: activePassengerIndex === idx ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255,255,255,0.01)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}>
                                            <span style={{ display: 'block', fontWeight: 'bold', fontSize: '0.9rem' }}>{p.firstName || 'Passenger'} {p.lastName || `#${idx + 1}`}</span>
                                            <span style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                                                Class: {p.cabinClass} | Seat: <span style={{ color: '#34d399', fontWeight: 'bold' }}>{p.seatNumbers[activeLegIndex] || 'Not Chosen'}</span>
                                            </span>
                                        </button>
                                        {getPassengerSeatError(idx) && (
                                            <div id={`passenger-${idx}-seatNumber-error`} style={{ color: '#f87171', fontSize: '0.8rem' }}>
                                                {getPassengerSeatError(idx)}
                                            </div>
                                        )}
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>

                            {/* Right panel: Cabin Grid */}
                            <div style={{ flex: '2 1 400px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <div style={{
                                    border: '2px solid rgba(255,255,255,0.1)',
                                    borderRadius: '100px 100px 24px 24px',
                                    padding: '3rem 2rem 2rem',
                                    width: 'min(100%, 320px)',
                                    background: 'rgba(0,0,0,0.3)',
                                    maxHeight: '400px',
                                    overflow: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center'
                                }}>
                                    <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.2)', marginBottom: '1rem', borderRadius: '2px' }} />
                                                             {/* Column Labels */}
                                    <div style={{
                                        display: 'flex',
                                        gap: '8px',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: `${Math.max(260, parsedPattern.length * 42)}px`,
                                        flexShrink: 0,
                                        paddingLeft: '24px',
                                        marginBottom: '8px',
                                        fontSize: '0.7rem',
                                        color: 'rgba(255,255,255,0.4)',
                                        fontWeight: 'bold'
                                    }}>
                                        {parsedPattern.split("").map((char, charIdx) => {
                                            if (char === '-') {
                                                return (
                                                    <span
                                                        key={`aisle-header-${charIdx}`}
                                                        style={{ width: '12px' }}
                                                    />
                                                );
                                            }
                                            return (
                                                <span
                                                    key={`seat-header-${charIdx}`}
                                                    style={{ width: '26px', textAlign: 'center' }}
                                                >
                                                    {char}
                                                </span>
                                            );
                                        })}
                                    </div>

                                    {/* Rows */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: `${Math.max(260, parsedPattern.length * 42)}px`, flexShrink: 0 }}>
                                        {activeRows.map((row) => (
                                            <div key={row} style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
                                                <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', width: '16px', textAlign: 'right', marginRight: '4px' }}>{row}</span>

                                                {parsedPattern.split("").map((char, charIdx) => {
                                                    if (char === '-') {
                                                        return (
                                                            <span
                                                                key={`aisle-${charIdx}`}
                                                                style={{
                                                                    width: '12px',
                                                                    textAlign: 'center',
                                                                    fontSize: '0.6rem',
                                                                    color: 'rgba(255,255,255,0.1)',
                                                                    userSelect: 'none'
                                                                }}
                                                            >
                                                                |
                                                            </span>
                                                        );
                                                    }

                                                    const letter = char;
                                                    const seatId = `${row}${letter}`;
                                                    const occupied = isSeatOccupied(seatId);
                                                    const selected = passengers[activePassengerIndex]?.seatNumbers[activeLegIndex] === seatId;
                                                    const groupPassengerIdx = getGroupPassengerForSeat(seatId);
                                                    const selectedByGroupMember = groupPassengerIdx >= 0 && groupPassengerIdx !== activePassengerIndex;
                                                    const isSuggested = hoveredSuggestedSeats.includes(seatId);

                                                    let bg = 'rgba(255, 255, 255, 0.05)';
                                                    let border = '1px solid rgba(255, 255, 255, 0.15)';
                                                    let color = '#fff';
                                                    let cursor = 'pointer';
                                                    let isDisabled = false;

                                                    if (occupied) {
                                                        bg = 'rgba(239, 68, 68, 0.2)';
                                                        border = '1px solid rgba(239, 68, 68, 0.3)';
                                                        color = '#ef4444';
                                                        cursor = 'not-allowed';
                                                        isDisabled = true;
                                                    } else if (selected) {
                                                        bg = '#8b5cf6';
                                                        border = '1px solid #c084fc';
                                                        color = '#fff';
                                                    } else if (selectedByGroupMember) {
                                                        bg = 'rgba(139, 92, 246, 0.35)';
                                                        border = '1px dashed #c084fc';
                                                        color = '#fff';
                                                    } else if (isSuggested) {
                                                        bg = 'rgba(16, 185, 129, 0.25)';
                                                        border = '1px dashed #10b981';
                                                        color = '#34d399';
                                                    }

                                                    let displayChar = letter;
                                                    if (selectedByGroupMember) {
                                                        displayChar = `#${groupPassengerIdx + 1}`;
                                                    }

                                                    return (
                                                        <button
                                                            key={letter}
                                                            type="button"
                                                            disabled={isDisabled}
                                                            onClick={() => handleSeatClick(seatId)}
                                                            onMouseEnter={() => handleSeatMouseEnter(seatId)}
                                                            onMouseLeave={handleSeatMouseLeave}
                                                            onFocus={() => handleSeatMouseEnter(seatId)}
                                                            onBlur={handleSeatMouseLeave}
                                                            style={{
                                                                width: '26px',
                                                                height: '26px',
                                                                borderRadius: '4px',
                                                                border,
                                                                background: bg,
                                                                cursor,
                                                                fontSize: '0.65rem',
                                                                fontWeight: 'bold',
                                                                color,
                                                                padding: 0
                                                            }}
                                                            title={
                                                                occupied
                                                                    ? `Seat ${seatId} Occupied`
                                                                    : selected
                                                                    ? `Seat ${seatId} Selected`
                                                                    : selectedByGroupMember
                                                                    ? `Seat ${seatId} chosen by Passenger #${groupPassengerIdx + 1}`
                                                                    : `Select Seat ${seatId}`
                                                            }
                                                        >
                                                            {displayChar}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Legend */}
                                <div style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    justifyContent: 'center',
                                    gap: '12px',
                                    marginTop: '1.5rem',
                                    fontSize: '0.75rem',
                                    color: 'rgba(255,255,255,0.6)'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)' }} />
                                        <span>Available</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#8b5cf6' }} />
                                        <span>Me</span>
                                    </div>
                                    {passengers.length > 1 && (
                                        <>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'rgba(139, 92, 246, 0.35)', border: '1px dashed #c084fc' }} />
                                                <span>Group Member</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'rgba(16, 185, 129, 0.25)', border: '1px dashed #10b981' }} />
                                                <span>Suggested</span>
                                            </div>
                                        </>
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.3)' }} />
                                        <span>Occupied</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="booking-wizard-actions booking-seat-actions">
                            <button
                                type="button"
                                onClick={handlePrevStep}
                                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                                ← Back
                            </button>
                            <button
                                type="button"
                                onClick={handleNextStep}
                                style={{ backgroundColor: '#8b5cf6', color: '#fff', border: 'none', padding: '10px 28px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                                Review Booking →
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 3: BOOKING REVIEW */}
                {step === 3 && (
                    <div>
                        <h2 style={{ fontSize: '1.8rem', color: '#c084fc', marginBottom: '0.5rem', fontWeight: 'bold' }}>Review Booking</h2>
                        <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '2rem' }}>Verify the itinerary and traveler details before confirming.</p>

                        <div style={{ marginBottom: '2rem' }}>
                            {/* Summary list */}
                            <div style={{ border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.5rem', background: 'rgba(0,0,0,0.15)' }}>
                                <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', color: '#a78bfa' }}>Trip Summary</h3>
                                <div style={{ marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: '#c084fc' }}>{flight.airline} {flight.flightNumber}</div>
                                    <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', marginTop: '4px' }}>
                                        {flight.from} → {flight.to}
                                    </div>
                                    <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', marginTop: '4px' }}>
                                        Departure: {new Date(flight.departureDate).toLocaleDateString()}
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {passengers.map((p, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                            <div>
                                                <strong>{p.firstName} {p.lastName}</strong>
                                                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>Class: {p.cabinClass} | Seat{p.seatNumbers.length > 1 ? 's' : ''}: {p.seatNumbers.join(', ')}</div>
                                            </div>
                                            <span style={{ fontWeight: 'bold' }}>{formatPrice(calculatePassengerPrice(p.cabinClass))}</span>
                                        </div>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 'bold', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '1.25rem', paddingTop: '1rem', color: '#34d399' }}>
                                    <span>Estimated Total</span>
                                    <span>{totalPriceDisplay}</span>
                                </div>
                            </div>
                            <p role="note" style={{ color: 'rgba(255,255,255,0.65)', margin: '1rem 0 0', fontSize: '0.9rem' }}>
                                Payment is not collected in this demo. The server will confirm the current fare and seat availability when you book.
                            </p>
                        </div>

                        {isSubmitting && (
                            <p role="status" aria-live="polite" style={{ color: '#a7f3d0', margin: '0 0 1rem', fontWeight: 600 }}>
                                Confirming booking and checking availability.
                            </p>
                        )}
                        <div className="booking-wizard-actions booking-review-actions">
                            <button
                                type="button"
                                onClick={handlePrevStep}
                                disabled={isSubmitting}
                                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                                ← Back
                            </button>
                            <button
                                type="button"
                                onClick={handleSubmitBooking}
                                disabled={isSubmitting}
                                aria-busy={isSubmitting}
                                style={{ backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '12px 32px', borderRadius: '8px', cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.65 : 1, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                {isSubmitting ? 'Confirming Booking...' : `Confirm ${totalPriceDisplay} booking`}
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 4: SUCCESS / E-TICKET BOARDING PASS */}
                {step === 4 && bookingResult && (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{
                            width: '64px',
                            height: '64px',
                            borderRadius: '50%',
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: '#10b981',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 1.5rem',
                            fontSize: '2rem',
                            border: '2px solid rgba(16, 185, 129, 0.3)'
                        }}>
                            ✓
                        </div>
                        <h2 style={{ fontSize: '2rem', color: '#34d399', fontWeight: 'bold', marginBottom: '0.5rem' }}>Booking Confirmed!</h2>
                        <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '0.5rem' }}>Your booking is confirmed. Payment is not collected in this demo.</p>
                        <p style={{ color: '#34d399', marginBottom: '2rem', fontWeight: 'bold' }}>Confirmed total: {bookingResult.totalPriceCents !== null ? formatPrice(bookingResult.totalPriceCents) : totalPriceDisplay}</p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center', marginBottom: '2.5rem' }}>
                            {/*
                              * One boarding pass per traveller per leg. A seat
                              * belongs to a leg, so a card naming one flight can
                              * only carry that flight's seat: printing the whole
                              * itinerary's seats on a single card was the same
                              * defect in a different shape (#137).
                              */}
                            {bookingResult.passengers.flatMap((p, idx) => flights.map((legFlight, legIndex) => (
                                /* Boarding Pass Card View Overlay */
                                <div key={`${idx}:${legIndex}`} style={{
                                    width: '100%',
                                    maxWidth: '600px',
                                    borderRadius: '16px',
                                    background: 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    textAlign: 'left',
                                    overflow: 'hidden',
                                    boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
                                }}>
                                    {/* Ticket header banner */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', background: 'rgba(0,0,0,0.2)', borderBottom: '1px dashed rgba(255,255,255,0.15)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <img src="/img/logo.svg" alt="Gemini" width="20" height="20" />
                                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', letterSpacing: '1px' }}>GEMINI AIRWAYS</span>
                                        </div>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#c084fc', border: '1px solid #c084fc', padding: '2px 8px', borderRadius: '4px' }}>
                                            {p.cabinClass}
                                        </span>
                                    </div>

                                    {/* Ticket content */}
                                    <div style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem' }}>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Passenger</div>
                                            <div style={{ fontSize: '0.95rem', fontWeight: 'bold', marginTop: '3px' }}>{p.firstName} {p.lastName}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Flight</div>
                                            <div style={{ fontSize: '0.95rem', fontWeight: 'bold', marginTop: '3px', color: '#a78bfa' }}>{legFlight.flightNumber}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Seat</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 'bold', marginTop: '3px', color: '#34d399' }}>
                                                {p.seatNumbers[legIndex]}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Date</div>
                                            <div style={{ fontSize: '0.95rem', fontWeight: 'bold', marginTop: '3px' }}>{new Date(legFlight.departureDate).toLocaleDateString()}</div>
                                        </div>
                                    </div>

                                    {/* Ticket bottom strip */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div>
                                            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)' }}>ROUTE</div>
                                            <div style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{legFlight.from.split(',')[0]} to {legFlight.to.split(',')[0]}</div>
                                        </div>
                                        {/* Fake barcode block */}
                                        <div style={{ display: 'flex', gap: '2px', background: '#fff', padding: '4px', borderRadius: '2px', height: '24px' }}>
                                            {Array.from({ length: 28 }).map((_, i) => (
                                                <div
                                                    key={i}
                                                    style={{
                                                        width: i % 3 === 0 ? '1px' : i % 5 === 0 ? '3px' : '2px',
                                                        height: '100%',
                                                        background: '#000'
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )))}
                        </div>

                        <div className="booking-success-actions">
                            <Link href="/profile" style={{ display: 'inline-block', backgroundColor: '#8b5cf6', color: '#fff', textDecoration: 'none', padding: '10px 24px', borderRadius: '8px', fontWeight: 'bold' }}>
                                View Profile Bookings
                            </Link>
                            <Link href="/" style={{ display: 'inline-block', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', textDecoration: 'none', padding: '10px 24px', borderRadius: '8px', fontWeight: 'bold' }}>
                                Book Another Flight
                            </Link>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
