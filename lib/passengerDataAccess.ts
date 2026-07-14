import type { Prisma } from '@prisma/client';

export const safePassengerSelect = {
    id: true,
    firstName: true,
    lastName: true,
    gender: true,
    seatNumber: true,
    cabinClass: true,
} satisfies Prisma.PassengerSelect;
