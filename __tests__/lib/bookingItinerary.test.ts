/** @jest-environment node */
import {
    bookingFlights,
    cabinLabel,
    legDirectionLabel,
    outboundFlight,
    passengersSeatedOnLeg,
} from '@/lib/bookingItinerary';

const seattle = { id: 1, flightNumber: 'GA101', from: 'Seattle, USA', to: 'Detroit, USA' };
const detroit = { id: 2, flightNumber: 'GA102', from: 'Detroit, USA', to: 'Seattle, USA' };

describe('booking itinerary', () => {
    it('reads the flights of a booking in leg order', () => {
        // Deliberately out of order, because Prisma only sorts when asked.
        const booking = {
            legs: [
                { sequence: 2, flight: detroit },
                { sequence: 1, flight: seattle },
            ],
        };

        expect(bookingFlights(booking)).toEqual([seattle, detroit]);
    });

    it('treats the first leg as the outbound flight', () => {
        const booking = {
            legs: [
                { sequence: 2, flight: detroit },
                { sequence: 1, flight: seattle },
            ],
        };

        expect(outboundFlight(booking)).toEqual(seattle);
    });

    it('reads a one-leg booking as a single flight', () => {
        const booking = { legs: [{ sequence: 1, flight: seattle }] };

        expect(bookingFlights(booking)).toEqual([seattle]);
        expect(outboundFlight(booking)).toEqual(seattle);
    });

    it('yields nothing for a booking with no legs', () => {
        // A booking whose flight was removed, or one read without its legs.
        expect(bookingFlights({ legs: [] })).toEqual([]);
        expect(outboundFlight({ legs: [] })).toBeNull();
    });

    it('skips a leg whose flight was not loaded rather than yielding a hole', () => {
        const booking = {
            legs: [
                { sequence: 1, flight: null },
                { sequence: 2, flight: detroit },
            ],
        };

        expect(bookingFlights(booking)).toEqual([detroit]);
        expect(outboundFlight(booking)).toEqual(detroit);
    });

    describe('passengersSeatedOnLeg', () => {
        const ada = { id: 'p-1', firstName: 'Ada', seatNumber: '11A', cabinClass: 'ECONOMY' };
        const grace = { id: 'p-2', firstName: 'Grace', seatNumber: '11B', cabinClass: 'ECONOMY' };

        it('describes each traveller by the seat held on that leg', () => {
            const inbound = {
                seatAssignments: [
                    { passengerId: 'p-1', seatNumber: '20F', cabinClass: 'BUSINESS' },
                    { passengerId: 'p-2', seatNumber: '20E', cabinClass: 'BUSINESS' },
                ],
            };

            expect(passengersSeatedOnLeg(inbound, [ada, grace])).toEqual([
                { id: 'p-1', firstName: 'Ada', seatNumber: '20F', cabinClass: 'BUSINESS' },
                { id: 'p-2', firstName: 'Grace', seatNumber: '20E', cabinClass: 'BUSINESS' },
            ]);
        });

        it('reports a missing assignment rather than borrowing another seat', () => {
            // Every traveller holds one on every leg, asserted against the whole
            // table by seatAssignmentCoverage.database.test.ts. If one is absent
            // that is a defect, so it must not be papered over with a seat from
            // somewhere else (#137).
            const leg = { seatAssignments: [] };
            expect(passengersSeatedOnLeg(leg, [ada])).toEqual([
                { ...ada, seatNumber: 'Not assigned', cabinClass: 'ECONOMY' },
            ]);
        });

        it('does not let one traveller\'s assignment describe another', () => {
            const leg = {
                seatAssignments: [{ passengerId: 'p-1', seatNumber: '20F', cabinClass: 'BUSINESS' }],
            };

            const [first, second] = passengersSeatedOnLeg(leg, [ada, grace]);
            expect(first.seatNumber).toBe('20F');
            expect(first.cabinClass).toBe('BUSINESS');
            // Grace has no assignment on this leg, so she is reported as
            // unseated rather than inheriting Ada's.
            expect(second.seatNumber).toBe('Not assigned');
        });
    });

    describe('legDirectionLabel', () => {
        // Checkout and the profile both name a leg by direction. They held
        // separate copies of the rule, which agreed only because
        // MAX_ITINERARY_LEGS is 2 — connecting itineraries (#131) would have
        // had the two screens calling one flight different things (#160).
        it('names the two legs of a there-and-back trip', () => {
            expect(legDirectionLabel(0, 2)).toBe('Departing');
            expect(legDirectionLabel(1, 2)).toBe('Returning');
        });

        it('calls the only leg of a one-way trip the departure', () => {
            expect(legDirectionLabel(0, 1)).toBe('Departing');
        });

        it('numbers a middle leg, which is neither out nor back', () => {
            expect(legDirectionLabel(0, 3)).toBe('Departing');
            expect(legDirectionLabel(1, 3)).toBe('Leg 2');
            expect(legDirectionLabel(2, 3)).toBe('Returning');
        });

        it('numbers every leg between the first and last of a longer trip', () => {
            expect([0, 1, 2, 3, 4].map((index) => legDirectionLabel(index, 5))).toEqual([
                'Departing', 'Leg 2', 'Leg 3', 'Leg 4', 'Returning',
            ]);
        });
    });

    describe('cabinLabel', () => {
        // The raw enum was printed on the boarding pass, so a customer's
        // e-ticket read PREMIUM_ECONOMY, underscore and all (#169).
        it('names each cabin the way a customer would', () => {
            expect(cabinLabel('ECONOMY')).toBe('Economy');
            expect(cabinLabel('PREMIUM_ECONOMY')).toBe('Premium Economy');
            expect(cabinLabel('BUSINESS')).toBe('Business');
            expect(cabinLabel('FIRST')).toBe('First Class');
        });

        it('makes an unknown cabin readable rather than printing it raw', () => {
            // A cabin added to the schema before this map catches up should
            // still not reach a ticket shouting in snake case.
            expect(cabinLabel('PREMIUM_BUSINESS')).toBe('Premium Business');
        });

        it('says nothing for a missing cabin', () => {
            expect(cabinLabel(undefined)).toBe('');
            expect(cabinLabel('')).toBe('');
        });
    });
});
