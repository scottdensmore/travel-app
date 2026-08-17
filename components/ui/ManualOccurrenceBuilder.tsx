"use client"

import React, { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { generateFlightOccurrencesAction } from '@/app/actions';
import { validateSeatingLayout } from '@/lib/seatLayout';
import { isActionValidationFailure } from '@/lib/actionResult';

interface ScheduleItem {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureTime: string;
    daysOfWeek: number[];
    priceCents: number;
    firstClassRows?: number | null;
    businessRows?: number | null;
    premiumEconomyRows?: number | null;
    economyRows?: number | null;
    seatPattern?: string | null;
}

export default function ManualOccurrenceBuilder({ schedules }: { schedules: ScheduleItem[] }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [selectedScheduleId, setSelectedScheduleId] = useState<string>('');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    // Seating configuration overrides
    const [firstClassRows, setFirstClassRows] = useState<string>('3');
    const [businessRows, setBusinessRows] = useState<string>('3');
    const [premiumEconomyRows, setPremiumEconomyRows] = useState<string>('4');
    const [economyRows, setEconomyRows] = useState<string>('20');
    const [seatPattern, setSeatPattern] = useState<string>('ABC-DEF');

    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const hasSchedules = schedules.length > 0;

    // Auto-fill seating values when schedule selection changes
    useEffect(() => {
        if (!selectedScheduleId) return;
        const selected = schedules.find(s => s.id.toString() === selectedScheduleId);
        if (selected) {
            setFirstClassRows(selected.firstClassRows?.toString() ?? '3');
            setBusinessRows(selected.businessRows?.toString() ?? '3');
            setPremiumEconomyRows(selected.premiumEconomyRows?.toString() ?? '4');
            setEconomyRows(selected.economyRows?.toString() ?? '20');
            setSeatPattern(selected.seatPattern ?? 'ABC-DEF');
        }
    }, [selectedScheduleId, schedules]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (!selectedScheduleId) {
            setError('Please select a repeating flight template.');
            return;
        }

        if (!startDate || !endDate) {
            setError('Please select both start and end dates.');
            return;
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            setError('Invalid start or end date format.');
            return;
        }

        if (end < start) {
            setError('End date must be on or after start date.');
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

        startTransition(async () => {
            try {
                const result = await generateFlightOccurrencesAction(
                    Number(selectedScheduleId),
                    startDate,
                    endDate,
                    {
                        firstClassRows: fRows,
                        businessRows: bRows,
                        premiumEconomyRows: peRows,
                        economyRows: eRows,
                        seatPattern: normalizedSeatPattern
                    }
                );

                if (isActionValidationFailure(result)) {
                    setError(result.error.message);
                    return;
                }

                if (result.success) {
                    setSuccess(
                        `Successfully affected ${result.count} flight occurrence(s): ` +
                        `${result.created} created, ${result.updated} updated.`
                    );
                    setSelectedScheduleId('');
                    setStartDate('');
                    setEndDate('');
                }
                router.refresh();
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
                setError(message);
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} noValidate className="admin-card" aria-describedby={error ? 'occurrence-feedback' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1.5rem' }}>
            <h2 style={{ fontSize: '1.5rem', margin: 0, color: '#c084fc', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                Manual Occurrence Generator
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', margin: 0 }}>
                Select a repeating template to generate concrete flight occurrences for custom date ranges. Existing instances on the selected dates will have their seating configurations updated.
            </p>

            {error && (
                <div id="occurrence-feedback" role="alert" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '12px', borderRadius: '8px', fontSize: '0.9rem' }}>
                    ⚠️ {error}
                </div>
            )}

            {success && (
                <div role="status" style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', padding: '12px', borderRadius: '8px', fontSize: '0.9rem' }}>
                    ✅ {success}
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label htmlFor="selectSchedule" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>Flight Template *</label>
                <select
                    id="selectSchedule"
                    value={selectedScheduleId}
                    onChange={e => setSelectedScheduleId(e.target.value)}
                    disabled={isPending || !hasSchedules}
                    style={{
                        padding: '10px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#fff',
                        cursor: 'pointer',
                        outline: 'none'
                    }}
                >
                    <option value="" style={{ backgroundColor: '#1f2937' }}>-- Select a Flight Template --</option>
                    {schedules.map(s => (
                        <option key={s.id} value={s.id} style={{ backgroundColor: '#1f2937' }}>
                            {s.airline} {s.flightNumber} ({s.from} → {s.to})
                        </option>
                    ))}
                </select>
                {!hasSchedules && (
                    <p role="status" style={{ margin: '4px 0 0', color: '#fbbf24', fontSize: '0.85rem' }}>
                        Activate or create a repeating flight template before generating occurrences.
                    </p>
                )}
            </div>

            <div className="admin-form-grid admin-form-grid--two">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="startDate" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>Start Date *</label>
                    <input
                        id="startDate"
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        disabled={isPending}
                        required
                        style={{ padding: '8px 12px' }}
                    />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="endDate" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>End Date *</label>
                    <input
                        id="endDate"
                        type="date"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        disabled={isPending}
                        required
                        style={{ padding: '8px 12px' }}
                    />
                </div>
            </div>

            {selectedScheduleId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <h3 style={{ fontSize: '0.9rem', color: '#c084fc', margin: 0 }}>Configure Seating Layout for these Occurrences</h3>

                    <div className="admin-form-grid admin-form-grid--two">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label htmlFor="manualFirstClassRows" style={{ fontSize: '0.8rem', color: '#a78bfa' }}>First Class Rows</label>
                            <input
                                id="manualFirstClassRows"
                                type="number"
                                min="0"
                                value={firstClassRows}
                                onChange={e => setFirstClassRows(e.target.value)}
                                disabled={isPending}
                                style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label htmlFor="manualBusinessRows" style={{ fontSize: '0.8rem', color: '#a78bfa' }}>Business Class Rows</label>
                            <input
                                id="manualBusinessRows"
                                type="number"
                                min="0"
                                value={businessRows}
                                onChange={e => setBusinessRows(e.target.value)}
                                disabled={isPending}
                                style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                        </div>
                    </div>

                    <div className="admin-form-grid admin-form-grid--two">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label htmlFor="manualPremiumEconomyRows" style={{ fontSize: '0.8rem', color: '#a78bfa' }}>Premium Economy Rows</label>
                            <input
                                id="manualPremiumEconomyRows"
                                type="number"
                                min="0"
                                value={premiumEconomyRows}
                                onChange={e => setPremiumEconomyRows(e.target.value)}
                                disabled={isPending}
                                style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label htmlFor="manualEconomyRows" style={{ fontSize: '0.8rem', color: '#a78bfa' }}>Economy Class Rows</label>
                            <input
                                id="manualEconomyRows"
                                type="number"
                                min="0"
                                value={economyRows}
                                onChange={e => setEconomyRows(e.target.value)}
                                disabled={isPending}
                                style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label htmlFor="manualSeatPattern" style={{ fontSize: '0.8rem', color: '#a78bfa' }}>Seat Pattern (use &apos;-&apos; for aisle)</label>
                        <input
                            id="manualSeatPattern"
                            type="text"
                            value={seatPattern}
                            onChange={e => setSeatPattern(e.target.value.toUpperCase())}
                            disabled={isPending}
                            style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                        />
                    </div>
                </div>
            )}

            <button
                type="submit"
                disabled={isPending || !hasSchedules}
                style={{
                    backgroundColor: '#10b981',
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
                {isPending ? 'Generating...' : 'Generate Occurrences'}
            </button>
        </form>
    );
}
