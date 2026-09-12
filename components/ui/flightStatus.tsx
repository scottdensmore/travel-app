"use client";

import type { FlightStatus } from '@prisma/client';
import React from 'react';
import { flightStatusLabel } from '@/lib/flightStatus';

export interface FlightStatusProps {
    status: FlightStatus;
    className?: string;
    style?: React.CSSProperties;
}

/**
 * Renders the formatted label for a FlightStatus.
 * The switch is exhaustive across all valid FlightStatus enum values without a default fallback.
 */
export function FlightStatusDisplay({ status, className, style }: FlightStatusProps) {
    const label = flightStatusLabel(status);

    return (
        <span className={className} style={style}>
            {label}
        </span>
    );
}

export { FlightStatusDisplay as FlightStatus };
export default FlightStatusDisplay;
