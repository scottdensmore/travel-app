import { checkoutHolderKey, holdSeats } from '@/lib/seatHolds';
import FlightBookingService from '@/lib/FlightBookingService';

interface BookingSeatRequest {
    flightIds: number[];
    userId: string;
    passengers: { seatNumbers: string[] }[];
    idempotencyKey: string;
}

/** Prepare a direct service-level booking fixture through the real hold path. */
export async function holdBookingSeats<T extends BookingSeatRequest>(request: T): Promise<T> {
    const holderKey = checkoutHolderKey(request.userId, request.idempotencyKey);
    const claims = request.flightIds.flatMap((flightId, legIndex) => (
        request.passengers.map(passenger => ({
            flightId,
            seatNumber: passenger.seatNumbers[legIndex],
            holderKey,
        }))
    ));
    const { taken } = await holdSeats(claims);
    if (taken.length > 0) {
        throw new Error('Booking fixture could not hold every requested seat.');
    }
    return request;
}

export async function bookHeldFlight(
    service: FlightBookingService,
    request: Parameters<FlightBookingService['bookFlight']>[0],
) {
    await holdBookingSeats(request);
    return service.bookFlight(request);
}
