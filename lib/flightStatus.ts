import type { FlightStatus } from '@prisma/client';
import { flightStatusSchema } from '@/lib/validation';

/**
 * Runtime array of flight status options derived from the validated schema.
 * Client components must NOT import `FlightStatus` as a runtime value from `@prisma/client`.
 */
export const FLIGHT_STATUSES = flightStatusSchema.options;

/**
 * Format a FlightStatus enum value into a customer-facing readable label.
 * Switch is exhaustive across all valid FlightStatus values with no default fallback.
 */
export function flightStatusLabel(status: FlightStatus): string {
    switch (status) {
        case 'ON_TIME':
            return 'On Time';
        case 'DELAYED':
            return 'Delayed';
        case 'CANCELLED':
            return 'Cancelled';
    }
}

export interface FlightStatusStyle {
    backgroundColor: string;
    color: string;
    border: string;
}

/**
 * Returns inline styling for badges or status indicators corresponding to each flight status.
 * Switch is exhaustive across all valid FlightStatus values with no default fallback.
 */
export function flightStatusStyle(status: FlightStatus): FlightStatusStyle {
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
