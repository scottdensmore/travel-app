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
                passengers: {
                    where: { booking: { status: { not: 'CANCELLED' } } },
                    select: { seatNumber: true, cabinClass: true }
                }
            }
        });
        if (!flight) throw new Error('Flight not found');

        for (const passenger of flight.passengers) {
            try {
                assertSeatAvailableForCabin(
                    passenger.seatNumber,
                    passenger.cabinClass,
                    normalizedLayout
                );
            } catch {
                throw new Error(
                    `Occupied seat ${passenger.seatNumber} is not available for ` +
                    `${passenger.cabinClass} in the requested layout.`
                );
            }
        }

        return tx.flight.update({ where: { id: flightId }, data: normalizedLayout });
    });
}
