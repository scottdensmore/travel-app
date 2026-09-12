"use client";

import type { FlightStatus } from '@prisma/client';
import React from 'react';
import { flightStatusLabel } from '@/lib/flightStatus';

export interface FlightStatusBadgeProps {
    status: FlightStatus;
    className?: string;
    style?: React.CSSProperties;
}

/**
 * Map status to badge style using an exhaustive switch across all valid FlightStatus enum values.
 * No default fallback so missing enum cases are caught at compile time.
 */
function getBadgeStyle(status: FlightStatus): React.CSSProperties {
    switch (status) {
        case 'ON_TIME':
            return {
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.3)',
            };
        case 'DELAYED':
            return {
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.3)',
            };
        case 'CANCELLED':
            return {
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.3)',
            };
    }
}

export function FlightStatusBadge({ status, className, style }: FlightStatusBadgeProps) {
    return (
        <span
            className={className}
            style={{
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.875rem',
                fontWeight: '600',
                display: 'inline-block',
                ...getBadgeStyle(status),
                ...style,
            }}
        >
            {flightStatusLabel(status)}
        </span>
    );
}

export default FlightStatusBadge;
