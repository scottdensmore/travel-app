"use client"

import { BRAND } from '@/lib/brand';
import { formatPrice } from '@/lib/bookingPricing';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveFlightScheduleAction } from '@/app/actions';
import { validateSeatingLayout } from '@/lib/seatLayout';
import { isActionValidationFailure } from '@/lib/actionResult';

interface FlightSchedule {
    id?: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureTime: string;
    durationMinutes: number;
    daysOfWeek: number[];
    priceCents: number | null;
    firstClassRows?: number | null;
    businessRows?: number | null;
    premiumEconomyRows?: number | null;
    economyRows?: number | null;
    seatPattern?: string | null;
}

export default function FlightScheduleForm({ initialSchedule }: { initialSchedule?: FlightSchedule }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [flightNumber, setFlightNumber] = useState(initialSchedule?.flightNumber ?? '');
    const [airline, setAirline] = useState(initialSchedule?.airline ?? '');
    const [from, setFrom] = useState(initialSchedule?.from ?? '');
    const [to, setTo] = useState(initialSchedule?.to ?? '');
    const [departureTime, setDepartureTime] = useState(initialSchedule?.departureTime ?? '');
    // Minutes gate to gate. Stated rather than inferred: an arrival time cannot
    // be had by subtracting local times across a timezone (#84).
    const [durationMinutes, setDurationMinutes] = useState(
        initialSchedule?.durationMinutes ? String(initialSchedule.durationMinutes) : '',
    );
    const [price, setPrice] = useState(
        initialSchedule?.priceCents === undefined || initialSchedule?.priceCents === null
            ? ''
            : formatPrice(initialSchedule.priceCents)
    );
    const [daysOfWeek, setDaysOfWeek] = useState<number[]>(initialSchedule?.daysOfWeek ?? []);

    const [firstClassRows, setFirstClassRows] = useState(initialSchedule?.firstClassRows?.toString() ?? '3');
    const [businessRows, setBusinessRows] = useState(initialSchedule?.businessRows?.toString() ?? '3');
    const [premiumEconomyRows, setPremiumEconomyRows] = useState(initialSchedule?.premiumEconomyRows?.toString() ?? '4');
    const [economyRows, setEconomyRows] = useState(initialSchedule?.economyRows?.toString() ?? '20');
    const [seatPattern, setSeatPattern] = useState(initialSchedule?.seatPattern ?? 'ABC-DEF');
    const [showSeatingConfig, setShowSeatingConfig] = useState(false);
    
    const [error, setError] = useState<string | null>(null);
    /**
     * Per-field messages from the server, so a rejected place is reported on the
     * input that holds it. The action returns these; the form used to keep only
     * the summary, which left the offending field looking untouched and the
     * explanation in a box that is often scrolled off the top of the page.
     */
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [success, setSuccess] = useState<string | null>(null);

    const weekdays = [
        { label: 'Sun', value: 0 },
        { label: 'Mon', value: 1 },
        { label: 'Tue', value: 2 },
        { label: 'Wed', value: 3 },
        { label: 'Thu', value: 4 },
        { label: 'Fri', value: 5 },
        { label: 'Sat', value: 6 },
    ];

    const handleDayToggle = (day: number) => {
        if (daysOfWeek.includes(day)) {
            setDaysOfWeek(daysOfWeek.filter(d => d !== day));
        } else {
            setDaysOfWeek([...daysOfWeek, day].sort());
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        // Validation
        if (!flightNumber || !airline || !from || !to || !departureTime || !durationMinutes || !price) {
            setError('Please fill in all required fields.');
            return;
        }

        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(departureTime)) {
            setError('Departure time must be in HH:MM format (24-hour).');
            return;
        }

        if (daysOfWeek.length === 0) {
            setError('Please select at least one day of the week.');
            return;
        }

        const fRows = firstClassRows === '' ? 3 : Number(firstClassRows);
        const bRows = businessRows === '' ? 3 : Number(businessRows);
        const peRows = premiumEconomyRows === '' ? 4 : Number(premiumEconomyRows);
        const eRows = economyRows === '' ? 20 : Number(economyRows);
        let normalizedSeatPattern: string;
        try {
            normalizedSeatPattern = validateSeatingLayout(fRows, bRows, peRows, eRows, seatPattern);
        } catch (validationError) {
            setError(validationError instanceof Error ? validationError.message : 'Invalid seating layout.');
            return;
        }

        let formattedPrice = price;
        if (!price.startsWith('$')) {
            formattedPrice = `$${price}`;
        }

        startTransition(async () => {
            try {
                const result = await saveFlightScheduleAction({
                    id: initialSchedule?.id,
                    flightNumber,
                    airline,
                    from,
                    to,
                    departureTime,
                    durationMinutes: Number(durationMinutes),
                    daysOfWeek,
                    price: formattedPrice,
                    firstClassRows: fRows,
                    businessRows: bRows,
                    premiumEconomyRows: peRows,
                    economyRows: eRows,
                    seatPattern: normalizedSeatPattern
                });
                if (isActionValidationFailure(result)) {
                    setError(result.error.message);
                    const fields = Object.fromEntries(
                        Object.entries(result.error.fields)
                            .filter(([field]) => field !== '_root')
                            .map(([field, messages]) => [field, messages[0]]),
                    );
                    setFieldErrors(fields);
                    // Take the caller to the first thing they have to change.
                    // Leaving focus on a disabled submit button drops it to the
                    // body, from where Tab walks forward out of the form.
                    const firstField = Object.keys(fields)[0];
                    if (firstField) {
                        requestAnimationFrame(() => {
                            const input = document.getElementById(firstField);
                            input?.focus();
                            // Optional: not every environment implements it, and focus alone
                            // already brings the field into view in a browser.
                            input?.scrollIntoView?.({ block: 'center' });
                        });
                    }
                    return;
                }
                setFieldErrors({});

                setSuccess(initialSchedule ? 'Schedule updated successfully!' : 'New schedule created successfully!');
                if (!initialSchedule) {
                    setFlightNumber('');
                    setAirline('');
                    setFrom('');
                    setTo('');
                    setDepartureTime('');
                    setDurationMinutes('');
                    setPrice('');
                    setDaysOfWeek([]);
                    setFirstClassRows('3');
                    setBusinessRows('3');
                    setPremiumEconomyRows('4');
                    setEconomyRows('20');
                    setSeatPattern('ABC-DEF');
                    setShowSeatingConfig(false);
                }
                router.refresh();
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
                setError(message);
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} noValidate className="admin-card" aria-describedby={error ? 'schedule-feedback' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h2 style={{ fontSize: '1.5rem', margin: 0, color: '#c084fc', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                {initialSchedule ? 'Edit Flight Schedule' : 'Create Flight Schedule'}
            </h2>

            {error && (
                <div id="schedule-feedback" role="alert" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '12px', borderRadius: '8px', fontSize: '0.9rem' }}>
                    ⚠️ {error}
                </div>
            )}

            {success && (
                <div role="status" style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', padding: '12px', borderRadius: '8px', fontSize: '0.9rem' }}>
                    ✅ {success}
                </div>
            )}

            <div className="admin-form-grid admin-form-grid--two">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="flightNumber" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>Flight Number *</label>
                    <input 
                        id="flightNumber"
                        type="text" 
                        value={flightNumber} 
                        onChange={e => setFlightNumber(e.target.value)} 
                        placeholder="e.g. CA101"
                        disabled={isPending}
                        required
                    />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="airline" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>Airline Name *</label>
                    <input 
                        id="airline"
                        type="text" 
                        value={airline} 
                        onChange={e => setAirline(e.target.value)} 
                        placeholder={`e.g. ${BRAND.name}`}
                        disabled={isPending}
                        required
                    />
                </div>
            </div>

            <div className="admin-form-grid admin-form-grid--two">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="from" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>From (Origin) *</label>
                    <input 
                        id="from"
                        type="text" 
                        value={from} 
                        onChange={e => { setFrom(e.target.value); setFieldErrors(previous => ({ ...previous, from: '' })); }} 
                        placeholder="e.g. Seattle, USA"
                        disabled={isPending}
                        required
                        aria-invalid={Boolean(fieldErrors.from) || undefined}
                        aria-describedby={fieldErrors.from ? 'from-error' : undefined}
                    />
                    {fieldErrors.from && (
                        <p id="from-error" style={{ margin: 0, fontSize: '0.8rem', color: '#f87171' }}>
                            {fieldErrors.from}
                        </p>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="to" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>To (Destination) *</label>
                    <input 
                        id="to"
                        type="text" 
                        value={to} 
                        onChange={e => { setTo(e.target.value); setFieldErrors(previous => ({ ...previous, to: '' })); }} 
                        placeholder="e.g. Detroit, USA"
                        disabled={isPending}
                        required
                        aria-invalid={Boolean(fieldErrors.to) || undefined}
                        aria-describedby={fieldErrors.to ? 'to-error' : undefined}
                    />
                    {fieldErrors.to && (
                        <p id="to-error" style={{ margin: 0, fontSize: '0.8rem', color: '#f87171' }}>
                            {fieldErrors.to}
                        </p>
                    )}
                </div>
            </div>

            <div className="admin-form-grid admin-form-grid--three">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="departureTime" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>Departure (HH:MM) *</label>
                    <input 
                        id="departureTime"
                        type="text" 
                        value={departureTime} 
                        onChange={e => setDepartureTime(e.target.value)} 
                        placeholder="e.g. 08:00"
                        disabled={isPending}
                        required
                    />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="durationMinutes" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>Duration (minutes) *</label>
                    <input
                        id="durationMinutes"
                        type="number"
                        min={1}
                        max={3 * 24 * 60}
                        step={1}
                        inputMode="numeric"
                        value={durationMinutes}
                        onChange={e => setDurationMinutes(e.target.value)}
                        placeholder="e.g. 245"
                        disabled={isPending}
                        required
                        aria-invalid={Boolean(fieldErrors.durationMinutes) || undefined}
                        aria-describedby={fieldErrors.durationMinutes ? 'durationMinutes-error' : undefined}
                    />
                    {fieldErrors.durationMinutes && (
                        <p id="durationMinutes-error" style={{ color: '#f87171', fontSize: '0.8rem', margin: 0 }}>
                            {fieldErrors.durationMinutes}
                        </p>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="price" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>Price ($) *</label>
                    <input 
                        id="price"
                        type="text" 
                        value={price} 
                        onChange={e => setPrice(e.target.value)} 
                        placeholder="e.g. 350"
                        disabled={isPending}
                        required
                    />
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>Days of Week *</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                    {weekdays.map(day => {
                        const checked = daysOfWeek.includes(day.value);
                        return (
                            <label key={day.value} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.9rem', color: '#fff' }}>
                                <input 
                                    type="checkbox" 
                                    checked={checked} 
                                    onChange={() => handleDayToggle(day.value)} 
                                    disabled={isPending}
                                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                                />
                                {day.label}
                            </label>
                        );
                    })}
                </div>
            </div>

            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '12px' }}>
                <button
                    type="button"
                    onClick={() => setShowSeatingConfig(!showSeatingConfig)}
                    aria-expanded={showSeatingConfig}
                    aria-controls="schedule-seating-config"
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#c084fc',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: 0,
                        fontSize: '0.9rem',
                        fontWeight: '600'
                    }}
                >
                    {showSeatingConfig ? '▼ Hide Seating Configuration' : '▶ Customize Seating Configuration (Optional)'}
                </button>

                {showSeatingConfig && (
                    <div id="schedule-seating-config" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="admin-form-grid admin-form-grid--two">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label htmlFor="firstClassRows" style={{ fontSize: '0.8rem', color: '#a78bfa' }}>First Class Rows</label>
                                <input
                                    id="firstClassRows"
                                    type="number"
                                    min="0"
                                    value={firstClassRows}
                                    onChange={e => setFirstClassRows(e.target.value)}
                                    placeholder="e.g. 2"
                                    disabled={isPending}
                                    style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label htmlFor="businessRows" style={{ fontSize: '0.8rem', color: '#a78bfa' }}>Business Class Rows</label>
                                <input
                                    id="businessRows"
                                    type="number"
                                    min="0"
                                    value={businessRows}
                                    onChange={e => setBusinessRows(e.target.value)}
                                    placeholder="e.g. 4"
                                    disabled={isPending}
                                    style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                                />
                            </div>
                        </div>

                        <div className="admin-form-grid admin-form-grid--two">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label htmlFor="premiumEconomyRows" style={{ fontSize: '0.8rem', color: '#a78bfa' }}>Premium Economy Rows</label>
                                <input
                                    id="premiumEconomyRows"
                                    type="number"
                                    min="0"
                                    value={premiumEconomyRows}
                                    onChange={e => setPremiumEconomyRows(e.target.value)}
                                    placeholder="e.g. 4"
                                    disabled={isPending}
                                    style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label htmlFor="economyRows" style={{ fontSize: '0.8rem', color: '#a78bfa' }}>Economy Class Rows</label>
                                <input
                                    id="economyRows"
                                    type="number"
                                    min="0"
                                    value={economyRows}
                                    onChange={e => setEconomyRows(e.target.value)}
                                    placeholder="e.g. 20"
                                    disabled={isPending}
                                    style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label htmlFor="seatPattern" style={{ fontSize: '0.8rem', color: '#a78bfa' }}>Seat Pattern (use &apos;-&apos; for aisle)</label>
                            <input
                                id="seatPattern"
                                type="text"
                                value={seatPattern}
                                onChange={e => setSeatPattern(e.target.value.toUpperCase())}
                                placeholder="e.g. ABC-DEF"
                                disabled={isPending}
                                style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                        </div>
                    </div>
                )}
            </div>

            <button 
                type="submit" 
                disabled={isPending}
                style={{ 
                    backgroundColor: '#8b5cf6', 
                    color: '#fff', 
                    border: 'none', 
                    padding: '12px', 
                    borderRadius: '8px', 
                    cursor: 'pointer', 
                    fontWeight: 'bold', 
                    fontSize: '1rem',
                    marginTop: '8px',
                    transition: 'background-color 0.2s'
                }}
            >
                {isPending ? 'Saving...' : initialSchedule ? 'Update Schedule' : 'Create Schedule'}
            </button>
        </form>
    );
}
