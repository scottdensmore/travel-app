export type FlightPhase = 'UPCOMING' | 'DEPARTED' | 'ARRIVED' | 'DELAYED' | 'CANCELLED';

interface FlightPhaseInput {
    departureDate: Date | string;
    durationMinutes?: number | null;
    status: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
}

/**
 * The phase a status-board row may truthfully derive from its schedule.
 *
 * Delayed and cancelled are airline-set facts, so the clock never overwrites
 * them. An ordinary occurrence advances through its scheduled instants. A
 * flight with no stated duration can pass departure, but cannot be called
 * arrived without inventing an arrival instant (#84).
 */
export function flightPhaseAt(flight: FlightPhaseInput, renderedAt: number): FlightPhase {
    if (flight.status === 'CANCELLED') return 'CANCELLED';
    if (flight.status === 'DELAYED') return 'DELAYED';

    const departureAt = new Date(flight.departureDate).getTime();
    if (renderedAt < departureAt) return 'UPCOMING';
    if (flight.durationMinutes === null || flight.durationMinutes === undefined) {
        return 'DEPARTED';
    }

    const arrivalAt = departureAt + flight.durationMinutes * 60_000;
    return renderedAt < arrivalAt ? 'DEPARTED' : 'ARRIVED';
}
