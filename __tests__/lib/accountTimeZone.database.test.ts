/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';

const userIds: string[] = [];

afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
});

describe('stored account timezone integrity', () => {
    it('gives an existing-style account the explicit UTC fallback', async () => {
        const id = `timezone-default-${randomUUID()}`;
        userIds.push(id);
        await prisma.$executeRaw`
            INSERT INTO "User" ("id", "email")
            VALUES (${id}, ${`${id}@example.com`})
        `;

        const rows = await prisma.$queryRaw<Array<{ timeZone: string }>>`
            SELECT "timeZone" FROM "User" WHERE "id" = ${id}
        `;
        expect(rows).toEqual([{ timeZone: 'UTC' }]);
    });

    it('stores a canonical IANA name and rejects malformed persisted values', async () => {
        const id = `timezone-guard-${randomUUID()}`;
        userIds.push(id);
        await prisma.$executeRaw`
            INSERT INTO "User" ("id", "email", "timeZone")
            VALUES (${id}, ${`${id}@example.com`}, 'America/Los_Angeles')
        `;

        await expect(prisma.$executeRaw`
            UPDATE "User" SET "timeZone" = ' UTC ' WHERE "id" = ${id}
        `).rejects.toThrow();
        await expect(prisma.$executeRaw`
            UPDATE "User" SET "timeZone" = ${'x'.repeat(101)} WHERE "id" = ${id}
        `).rejects.toThrow();

        const rows = await prisma.$queryRaw<Array<{ timeZone: string }>>`
            SELECT "timeZone" FROM "User" WHERE "id" = ${id}
        `;
        expect(rows).toEqual([{ timeZone: 'America/Los_Angeles' }]);
    });
});
