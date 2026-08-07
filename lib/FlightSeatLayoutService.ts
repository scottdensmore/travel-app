import { heldSeats } from '@/lib/seatOccupancy';
import { prisma } from '@/lib/prisma';
import { lockFlightForUpdate } from '@/lib/flightLock';
import {
    assertSeatAvailableForCabin,
    SeatingLayout,
    validateSeatingLayout
} from '@/lib/seatLayout';

export interface FlightSeatingLayout extends SeatingLayout {
    firstClassRows: number;
    businessRows: number;
    premiumEconomyRows: number;
    economyRows: number;
    seatPattern: string;
}

export async function updateFlightSeatingLayout(
    flightId: number,
    layout: FlightSeatingLayout
) {
    const normalizedLayout = {
        ...layout,
        seatPattern: validateSeatingLayout(
            layout.firstClassRows,
            layout.businessRows,
            layout.premiumEconomyRows,
            layout.economyRows,
            layout.seatPattern
        )
    };
    return prisma.$transaction(async (tx) => {
        await lockFlightForUpdate(tx, flightId);
        const flight = await tx.flight.findUnique({
            where: { id: flightId },
            include: {
                // Seats held on this flight, whichever leg of whichever
                // itinerary they belong to. Passenger.flightId points at the
                // outbound flight, so a return leg's seats were invisible here
                // and a layout change could strand them.
                seatAssignments: {
                    where: heldSeats(),
                    select: { seatNumber: true, cabinClass: true }
                }
            }
        });
        if (!flight) throw new Error('Flight not found');

        for (const held of flight.seatAssignments) {
            try {
                assertSeatAvailableForCabin(
                    held.seatNumber,
                    held.cabinClass,
                    normalizedLayout
                );
            } catch {
                throw new Error(
                    `Occupied seat ${held.seatNumber} is not available for ` +
                    `${held.cabinClass} in the requested layout.`
                );
            }
        }

        return tx.flight.update({ where: { id: flightId }, data: normalizedLayout });
    });
}
