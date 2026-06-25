"use client"

import React, { useState } from 'react';
import Link from 'next/link';
import { PassengerInput } from '@/lib/FlightBookingService';
import { bookFlightAction } from '@/app/actions';

interface Flight {
    id: number;
    flightNumber: string;
    airline: string;
    from: string;
    to: string;
    departureDate: Date | string;
    price: string;
}

interface BookingCheckoutWizardProps {
    flight: Flight;
    occupiedSeats: string[];
}

interface PassengerFormState {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    passportNumber: string;
    gender: string;
    cabinClass: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
    seatNumber: string;
}

const CABIN_MULTIPLIERS = {
    ECONOMY: 1.0,
    PREMIUM_ECONOMY: 1.5,
    BUSINESS: 2.0,
    FIRST: 3.0
};

const CABIN_LABELS = {
    ECONOMY: 'Economy',
    PREMIUM_ECONOMY: 'Premium Economy (+50%)',
    BUSINESS: 'Business (+100%)',
    FIRST: 'First Class (+200%)'
};

export default function BookingCheckoutWizard({ flight, occupiedSeats: initialOccupiedSeats }: BookingCheckoutWizardProps) {
    const basePriceNum = parseInt(flight.price.replace(/[^0-9]/g, ""), 10) || 0;

    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
    const [passengers, setPassengers] = useState<PassengerFormState[]>([
        {
            firstName: '',
            lastName: '',
            dateOfBirth: '',
            passportNumber: '',
            gender: 'Male',
            cabinClass: 'ECONOMY',
            seatNumber: ''
        }
    ]);
    const [activePassengerIndex, setActivePassengerIndex] = useState<number>(0);
    const [paymentCard, setPaymentCard] = useState({ number: '', name: '', expiry: '', cvv: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [bookingResult, setBookingResult] = useState<{ id: number; paymentIntentId: string } | null>(null);

    // Calculate total price
    const calculatePassengerPrice = (cabin: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST') => {
        return Math.round(basePriceNum * CABIN_MULTIPLIERS[cabin]);
    };

    const totalPrice = passengers.reduce((sum, p) => sum + calculatePassengerPrice(p.cabinClass), 0);

    const handleAddPassenger = () => {
        setPassengers([
            ...passengers,
            {
                firstName: '',
                lastName: '',
                dateOfBirth: '',
                passportNumber: '',
                gender: 'Male',
                cabinClass: 'ECONOMY',
                seatNumber: ''
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
        const updated = [...passengers];
        updated[index] = { ...updated[index], [field]: value };
        
        // Reset seat if cabin class changes, to ensure correct row selection
        if (field === 'cabinClass') {
            updated[index].seatNumber = '';
        }
        setPassengers(updated);
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
            if (!passengers[i].seatNumber) {
                setErrorMessage(`Please select a seat for Passenger ${i + 1}.`);
                return false;
            }
        }
        setErrorMessage(null);
        return true;
    };

    const validateStep3 = () => {
        const { number, name, expiry, cvv } = paymentCard;
        if (!number.replace(/\s/g, '').match(/^\d{16}$/)) {
            setErrorMessage('Card number must be 16 digits.');
            return false;
        }
        if (!name.trim()) {
            setErrorMessage('Cardholder name is required.');
            return false;
        }
        if (!expiry.match(/^(0[1-9]|1[0-2])\/?([0-9]{2})$/)) {
            setErrorMessage('Expiry date must be MM/YY format.');
            return false;
        }
        if (!cvv.match(/^\d{3,4}$/)) {
            setErrorMessage('CVV must be 3 or 4 digits.');
            return false;
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
        switch (cabinClass) {
            case 'FIRST': return [1, 2, 3];
            case 'BUSINESS': return [4, 5, 6];
            case 'PREMIUM_ECONOMY': return [7, 8, 9, 10];
            case 'ECONOMY': return Array.from({ length: 20 }, (_, i) => i + 11);
        }
    };

    const seatLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const activeRows = getRowsForClass(passengers[activePassengerIndex]?.cabinClass || 'ECONOMY');

    const isSeatOccupied = (seat: string) => {
        // Also consider seats selected by other passengers in this transaction as occupied
        const selectedByOthers = passengers
            .filter((_, i) => i !== activePassengerIndex)
            .map(p => p.seatNumber);
        
        return initialOccupiedSeats.includes(seat) || selectedByOthers.includes(seat);
    };

    const handleSeatClick = (seat: string) => {
        handlePassengerChange(activePassengerIndex, 'seatNumber', seat);
        setErrorMessage(null);
    };

    const handleSubmitBooking = async () => {
        if (!validateStep3()) return;
        setIsSubmitting(true);
        setErrorMessage(null);

        try {
            const formattedPassengers: PassengerInput[] = passengers.map(p => ({
                firstName: p.firstName,
                lastName: p.lastName,
                dateOfBirth: new Date(p.dateOfBirth).toISOString(),
                passportNumber: p.passportNumber,
                gender: p.gender,
                seatNumber: p.seatNumber,
                cabinClass: p.cabinClass
            }));

            const result = await bookFlightAction({
                flightId: flight.id,
                totalPrice: `$${totalPrice}`,
                passengers: formattedPassengers,
                paymentIntentId: `ch_${Math.random().toString(36).substr(2, 9)}`
            });

            setBookingResult({
                id: result.id,
                paymentIntentId: result.paymentIntentId || ''
            });
            setStep(4);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Payment processing failed. Please try again.';
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
                    { s: 3, label: 'Payment' },
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
                <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '12px', borderRadius: '8px', marginBottom: '1.5rem' }}>
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
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} 
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>Last Name</label>
                                        <input 
                                            type="text" 
                                            value={passenger.lastName} 
                                            onChange={(e) => handlePassengerChange(index, 'lastName', e.target.value)}
                                            placeholder="Doe"
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} 
                                        />
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>Date of Birth</label>
                                        <input 
                                            type="date" 
                                            value={passenger.dateOfBirth} 
                                            onChange={(e) => handlePassengerChange(index, 'dateOfBirth', e.target.value)}
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} 
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>Passport Number</label>
                                        <input 
                                            type="text" 
                                            value={passenger.passportNumber} 
                                            onChange={(e) => handlePassengerChange(index, 'passportNumber', e.target.value)}
                                            placeholder="A00000000"
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} 
                                        />
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
                                            {Object.keys(CABIN_MULTIPLIERS).map((k) => (
                                                <option key={k} value={k}>{CABIN_LABELS[k as keyof typeof CABIN_LABELS]}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        ))}

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}>
                            <button 
                                type="button" 
                                onClick={handleAddPassenger}
                                style={{ background: 'none', border: '1px dashed #8b5cf6', color: '#c084fc', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                                + Add Traveler
                            </button>
                            
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                                <span style={{ fontSize: '1.1rem', color: '#34d399', fontWeight: 'bold' }}>Total: ${totalPrice.toLocaleString()}</span>
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

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2.5rem' }}>
                            {/* Left panel: Passenger selector */}
                            <div style={{ flex: '1 1 250px' }}>
                                <h3 style={{ fontSize: '1rem', color: '#a78bfa', marginBottom: '1rem' }}>Passengers</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {passengers.map((p, idx) => (
                                        <div 
                                            key={idx} 
                                            onClick={() => setActivePassengerIndex(idx)}
                                            style={{
                                                padding: '12px',
                                                borderRadius: '8px',
                                                border: activePassengerIndex === idx ? '2px solid #8b5cf6' : '1px solid rgba(255,255,255,0.08)',
                                                background: activePassengerIndex === idx ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255,255,255,0.01)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{p.firstName || 'Passenger'} {p.lastName || `#${idx + 1}`}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                                                Class: {p.cabinClass} | Seat: <span style={{ color: '#34d399', fontWeight: 'bold' }}>{p.seatNumber || 'Not Chosen'}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Right panel: Cabin Grid */}
                            <div style={{ flex: '2 1 400px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <div style={{
                                    border: '2px solid rgba(255,255,255,0.1)',
                                    borderRadius: '100px 100px 24px 24px',
                                    padding: '3rem 2rem 2rem',
                                    width: '320px',
                                    background: 'rgba(0,0,0,0.3)',
                                    maxHeight: '400px',
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center'
                                }}>
                                    <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.2)', marginBottom: '1rem', borderRadius: '2px' }} />
                                    
                                    {/* Column Labels */}
                                    <div style={{ display: 'flex', gap: '8px', width: '220px', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', fontWeight: 'bold' }}>
                                        <span>A</span>
                                        <span>B</span>
                                        <span>C</span>
                                        <span style={{ width: '12px' }} />
                                        <span>D</span>
                                        <span>E</span>
                                        <span>F</span>
                                    </div>

                                    {/* Rows */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {activeRows.map((row) => (
                                            <div key={row} style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '250px', justifyContent: 'space-between' }}>
                                                <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', width: '16px', textAlign: 'right' }}>{row}</span>
                                                
                                                {seatLetters.slice(0, 3).map((letter) => {
                                                    const seatId = `${row}${letter}`;
                                                    const occupied = isSeatOccupied(seatId);
                                                    const selected = passengers[activePassengerIndex]?.seatNumber === seatId;
                                                    return (
                                                        <button
                                                            key={letter}
                                                            type="button"
                                                            disabled={occupied}
                                                            onClick={() => handleSeatClick(seatId)}
                                                            style={{
                                                                width: '26px',
                                                                height: '26px',
                                                                borderRadius: '4px',
                                                                border: selected ? '1px solid #8b5cf6' : '1px solid rgba(255,255,255,0.15)',
                                                                background: selected ? '#8b5cf6' : occupied ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                                                cursor: occupied ? 'not-allowed' : 'pointer',
                                                                fontSize: '0.65rem',
                                                                fontWeight: 'bold',
                                                                color: selected ? '#fff' : occupied ? '#ef4444' : '#fff',
                                                                padding: 0
                                                            }}
                                                            title={occupied ? `Seat ${seatId} Occupied` : `Select Seat ${seatId}`}
                                                        >
                                                            {letter}
                                                        </button>
                                                    );
                                                })}

                                                {/* Aisle */}
                                                <span style={{ width: '12px', fontSize: '0.6rem', color: 'rgba(255,255,255,0.1)' }}>|</span>

                                                {seatLetters.slice(3, 6).map((letter) => {
                                                    const seatId = `${row}${letter}`;
                                                    const occupied = isSeatOccupied(seatId);
                                                    const selected = passengers[activePassengerIndex]?.seatNumber === seatId;
                                                    return (
                                                        <button
                                                            key={letter}
                                                            type="button"
                                                            disabled={occupied}
                                                            onClick={() => handleSeatClick(seatId)}
                                                            style={{
                                                                width: '26px',
                                                                height: '26px',
                                                                borderRadius: '4px',
                                                                border: selected ? '1px solid #8b5cf6' : '1px solid rgba(255,255,255,0.15)',
                                                                background: selected ? '#8b5cf6' : occupied ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                                                cursor: occupied ? 'not-allowed' : 'pointer',
                                                                fontSize: '0.65rem',
                                                                fontWeight: 'bold',
                                                                color: selected ? '#fff' : occupied ? '#ef4444' : '#fff',
                                                                padding: 0
                                                            }}
                                                            title={occupied ? `Seat ${seatId} Occupied` : `Select Seat ${seatId}`}
                                                        >
                                                            {letter}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2.5rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.5rem' }}>
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
                                Billing & Summary →
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 3: BILLING & PAYMENT */}
                {step === 3 && (
                    <div>
                        <h2 style={{ fontSize: '1.8rem', color: '#c084fc', marginBottom: '0.5rem', fontWeight: 'bold' }}>Review & Purchase</h2>
                        <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '2rem' }}>Please verify your details and enter card information to complete the booking.</p>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
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
                                                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>Class: {p.cabinClass} | Seat: {p.seatNumber}</div>
                                            </div>
                                            <span style={{ fontWeight: 'bold' }}>${calculatePassengerPrice(p.cabinClass)}</span>
                                        </div>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 'bold', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '1.25rem', paddingTop: '1rem', color: '#34d399' }}>
                                    <span>Total Price</span>
                                    <span>${totalPrice.toLocaleString()}</span>
                                </div>
                            </div>

                            {/* Payment card entry fields */}
                            <div>
                                <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', color: '#a78bfa' }}>Payment Details</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>Card Number</label>
                                        <input 
                                            type="text" 
                                            value={paymentCard.number} 
                                            onChange={(e) => setPaymentCard({ ...paymentCard, number: e.target.value.replace(/[^0-9]/g, '').replace(/(\d{4})(?=\d)/g, '$1 ') })}
                                            placeholder="4111 2222 3333 4444"
                                            maxLength={19}
                                            style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} 
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>Cardholder Name</label>
                                        <input 
                                            type="text" 
                                            value={paymentCard.name} 
                                            onChange={(e) => setPaymentCard({ ...paymentCard, name: e.target.value })}
                                            placeholder="JOHN DOE"
                                            style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} 
                                        />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>Expiry Date</label>
                                            <input 
                                                type="text" 
                                                value={paymentCard.expiry} 
                                                onChange={(e) => setPaymentCard({ ...paymentCard, expiry: e.target.value })}
                                                placeholder="MM/YY"
                                                maxLength={5}
                                                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} 
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: 'rgba(255,255,255,0.7)' }}>CVV</label>
                                            <input 
                                                type="password" 
                                                value={paymentCard.cvv} 
                                                onChange={(e) => setPaymentCard({ ...paymentCard, cvv: e.target.value.replace(/[^0-9]/g, '') })}
                                                placeholder="123"
                                                maxLength={4}
                                                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} 
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2.5rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.5rem' }}>
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
                                style={{ backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '12px 32px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {isSubmitting ? 'Processing Payment...' : `Pay $${totalPrice.toLocaleString()} & Book`}
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
                        <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '2rem' }}>Your payment was processed successfully. Thank you for flying with Gemini Airways!</p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center', marginBottom: '2.5rem' }}>
                            {passengers.map((p, idx) => (
                                /* Boarding Pass Card View Overlay */
                                <div key={idx} style={{
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
                                            <div style={{ fontSize: '0.95rem', fontWeight: 'bold', marginTop: '3px', color: '#a78bfa' }}>{flight.flightNumber}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Seat</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 'bold', marginTop: '3px', color: '#34d399' }}>{p.seatNumber}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Date</div>
                                            <div style={{ fontSize: '0.95rem', fontWeight: 'bold', marginTop: '3px' }}>{new Date(flight.departureDate).toLocaleDateString()}</div>
                                        </div>
                                    </div>

                                    {/* Ticket bottom strip */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div>
                                            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)' }}>ROUTE</div>
                                            <div style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{flight.from.split(',')[0]} to {flight.to.split(',')[0]}</div>
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
                            ))}
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
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
