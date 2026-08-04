import type { Prisma } from '@prisma/client';

export const safePassengerSelect = {
    id: true,
    firstName: true,
    lastName: true,
    gender: true,
} satisfies Prisma.PassengerSelect;
