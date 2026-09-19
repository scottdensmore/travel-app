export interface EffectiveFlightGates {
    departureTerminal: string;
    departureGate: string;
    arrivalTerminal: string;
    arrivalGate: string;
}

export interface FlightGateInput {
    flightNumber: string;
    fromAirportCode: string;
    toAirportCode: string;
    departureTerminal?: string | null;
    departureGate?: string | null;
    arrivalTerminal?: string | null;
    arrivalGate?: string | null;
}

function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return hash >>> 0;
}

const AIRPORT_TERMINAL_CONFIG: Record<string, { terminals: string[]; concourses: string[] }> = {
    SEA: { terminals: ['Main'], concourses: ['A', 'B', 'C', 'D', 'S', 'N'] },
    DTW: { terminals: ['McNamara', 'Evans'], concourses: ['A', 'B', 'C', 'D'] },
    JFK: { terminals: ['Terminal 4', 'Terminal 8', 'Terminal 1'], concourses: ['A', 'B', 'C'] },
    LHR: { terminals: ['Terminal 2', 'Terminal 3', 'Terminal 5'], concourses: ['A', 'B', 'C'] },
    HND: { terminals: ['Terminal 3', 'Terminal 2'], concourses: ['A', 'B'] },
    ORD: { terminals: ['Terminal 1', 'Terminal 2', 'Terminal 3'], concourses: ['B', 'C', 'E', 'F'] },
    SFO: { terminals: ['Terminal 2', 'Terminal 3', 'International'], concourses: ['D', 'E', 'F', 'G'] },
    LAX: { terminals: ['Terminal 4', 'Terminal 5', 'Tom Bradley'], concourses: ['A', 'B'] },
};

function fallbackGate(flightNumber: string, airportCode: string): { terminal: string; gate: string } {
    const normalizedCode = airportCode.trim().toUpperCase();
    const config = AIRPORT_TERMINAL_CONFIG[normalizedCode] || {
        terminals: ['Terminal 1', 'Terminal 2'],
        concourses: ['A', 'B', 'C'],
    };

    const hash = hashString(`${flightNumber}-${normalizedCode}`);
    const terminal = config.terminals[hash % config.terminals.length];
    const concourse = config.concourses[(hash >>> 2) % config.concourses.length];
    const gateNumber = ((hash >>> 4) % 24) + 1;

    return {
        terminal,
        gate: `${concourse}${gateNumber}`,
    };
}

export function getEffectiveFlightGates(flight: FlightGateInput): EffectiveFlightGates {
    const depFallback = fallbackGate(flight.flightNumber, flight.fromAirportCode);
    const arrFallback = fallbackGate(flight.flightNumber, flight.toAirportCode);

    return {
        departureTerminal: flight.departureTerminal?.trim() || depFallback.terminal,
        departureGate: flight.departureGate?.trim() || depFallback.gate,
        arrivalTerminal: flight.arrivalTerminal?.trim() || arrFallback.terminal,
        arrivalGate: flight.arrivalGate?.trim() || arrFallback.gate,
    };
}
