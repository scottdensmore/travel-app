/** @jest-environment node */
import { bookingFlights, outboundFlight, passengersSeatedOnLeg } from '@/lib/bookingItinerary';

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

        it('keeps the passenger seat when the leg has no assignment for them', () => {
            // Bookings taken before seats were held per leg.
            const leg = { seatAssignments: [] };
            expect(passengersSeatedOnLeg(leg, [ada])).toEqual([ada]);
        });

        it('does not let one traveller\'s assignment describe another', () => {
            const leg = {
                seatAssignments: [{ passengerId: 'p-1', seatNumber: '20F', cabinClass: 'BUSINESS' }],
            };

            const [first, second] = passengersSeatedOnLeg(leg, [ada, grace]);
            expect(first.seatNumber).toBe('20F');
            expect(second.seatNumber).toBe('11B');
            expect(second.cabinClass).toBe('ECONOMY');
        });
    });
});
