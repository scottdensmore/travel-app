/** @jest-environment node */
import { bookingFlights, outboundFlight } from '@/lib/bookingItinerary';

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
});
