import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

/**
 * Prisma's `query` log writes each statement's bind parameters, which include
 * customer email addresses and token digests. Keep it for local development,
 * where the visibility is useful and the data is seeded, and keep it out of
 * every other environment. Warnings and errors are always reported.
 */
const logLevels: Prisma.LogLevel[] =
    process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'];

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: logLevels,
    });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
