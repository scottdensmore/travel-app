export type FlightPhase = 'UPCOMING' | 'BOARDING' | 'DEPARTED' | 'ARRIVED' | 'DELAYED' | 'CANCELLED';

export interface FlightPhaseInput {
    departureDate: Date | string;
    durationMinutes?: number | null;
    status: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
    estimatedDeparture?: Date | string | null;
    actualDeparture?: Date | string | null;
    actualArrival?: Date | string | null;
}

/**
 * The phase a status-board row or tracker view derives from its schedule and operational times.
 *
 * Delayed and cancelled are airline-set facts, so the clock never overwrites
 * them unless an estimated departure moves a delayed flight into boarding or departed.
 * A flight with no stated duration can pass departure, but cannot be called
 * arrived without inventing an arrival instant (#84).
 */
export function flightPhaseAt(flight: FlightPhaseInput, renderedAt: number): FlightPhase {
    if (flight.status === 'CANCELLED') return 'CANCELLED';

    const departureInstant = flight.estimatedDeparture
        ? new Date(flight.estimatedDeparture).getTime()
        : new Date(flight.departureDate).getTime();

    if (flight.actualArrival) return 'ARRIVED';

    if (flight.actualDeparture) {
        if (flight.durationMinutes === null || flight.durationMinutes === undefined) {
            return 'DEPARTED';
        }
        const actualArrivalAt = new Date(flight.actualDeparture).getTime() + flight.durationMinutes * 60_000;
        return renderedAt < actualArrivalAt ? 'DEPARTED' : 'ARRIVED';
    }

    if (flight.status === 'DELAYED' && !flight.estimatedDeparture) {
        return 'DELAYED';
    }

    // Boarding window: 45 minutes prior to departure until departure
    const boardingStart = departureInstant - 45 * 60_000;
    if (renderedAt >= boardingStart && renderedAt < departureInstant) {
        return 'BOARDING';
    }

    if (renderedAt < boardingStart) {
        return flight.status === 'DELAYED' ? 'DELAYED' : 'UPCOMING';
    }

    if (flight.durationMinutes === null || flight.durationMinutes === undefined) {
        return 'DEPARTED';
    }

    const arrivalAt = departureInstant + flight.durationMinutes * 60_000;
    return renderedAt < arrivalAt ? 'DEPARTED' : 'ARRIVED';
}
