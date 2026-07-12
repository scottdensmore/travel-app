"use client"

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveFlightScheduleAction } from '@/app/actions';

interface FlightSchedule {
    id?: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureTime: string;
    returnTime: string | null;
    daysOfWeek: number[];
    price: string;
}

export default function FlightScheduleForm({ initialSchedule }: { initialSchedule?: FlightSchedule }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [flightNumber, setFlightNumber] = useState(initialSchedule?.flightNumber ?? '');
    const [airline, setAirline] = useState(initialSchedule?.airline ?? '');
    const [from, setFrom] = useState(initialSchedule?.from ?? '');
    const [to, setTo] = useState(initialSchedule?.to ?? '');
    const [departureTime, setDepartureTime] = useState(initialSchedule?.departureTime ?? '');
    const [returnTime, setReturnTime] = useState(initialSchedule?.returnTime ?? '');
    const [price, setPrice] = useState(initialSchedule?.price ?? '');
    const [daysOfWeek, setDaysOfWeek] = useState<number[]>(initialSchedule?.daysOfWeek ?? []);
    
    const [error, setError] = useState<string | null>(null);
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
        if (!flightNumber || !airline || !from || !to || !departureTime || !price) {
            setError('Please fill in all required fields.');
            return;
        }

        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(departureTime)) {
            setError('Departure time must be in HH:MM format (24-hour).');
            return;
        }

        if (returnTime && !timeRegex.test(returnTime)) {
            setError('Return time must be in HH:MM format (24-hour) or left empty.');
            return;
        }

        if (daysOfWeek.length === 0) {
            setError('Please select at least one day of the week.');
            return;
        }

        let formattedPrice = price;
        if (!price.startsWith('$')) {
            formattedPrice = `$${price}`;
        }

        startTransition(async () => {
            try {
                await saveFlightScheduleAction({
                    id: initialSchedule?.id,
                    flightNumber,
                    airline,
                    from,
                    to,
                    departureTime,
                    returnTime: returnTime || null,
                    daysOfWeek,
                    price: formattedPrice
                });

                setSuccess(initialSchedule ? 'Schedule updated successfully!' : 'New schedule created successfully!');
                if (!initialSchedule) {
                    setFlightNumber('');
                    setAirline('');
                    setFrom('');
                    setTo('');
                    setDepartureTime('');
                    setReturnTime('');
                    setPrice('');
                    setDaysOfWeek([]);
                }
                router.refresh();
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
                setError(message);
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} noValidate className="admin-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h2 style={{ fontSize: '1.5rem', margin: 0, color: '#c084fc', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                {initialSchedule ? 'Edit Flight Schedule' : 'Create Flight Schedule'}
            </h2>

            {error && (
                <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '12px', borderRadius: '8px', fontSize: '0.9rem' }}>
                    ⚠️ {error}
                </div>
            )}

            {success && (
                <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', padding: '12px', borderRadius: '8px', fontSize: '0.9rem' }}>
                    ✅ {success}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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
                        placeholder="e.g. Gemini Airways"
                        disabled={isPending}
                        required
                    />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="from" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>From (Origin) *</label>
                    <input 
                        id="from"
                        type="text" 
                        value={from} 
                        onChange={e => setFrom(e.target.value)} 
                        placeholder="e.g. Seattle, USA"
                        disabled={isPending}
                        required
                    />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="to" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>To (Destination) *</label>
                    <input 
                        id="to"
                        type="text" 
                        value={to} 
                        onChange={e => setTo(e.target.value)} 
                        placeholder="e.g. Detroit, USA"
                        disabled={isPending}
                        required
                    />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
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
                    <label htmlFor="returnTime" style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold' }}>Return Time (HH:MM)</label>
                    <input 
                        id="returnTime"
                        type="text" 
                        value={returnTime} 
                        onChange={e => setReturnTime(e.target.value)} 
                        placeholder="Leave blank if One-Way"
                        disabled={isPending}
                    />
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
