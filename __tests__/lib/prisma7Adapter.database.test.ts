/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { createPrismaAdapter } from '@/lib/prismaAdapter';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

describe('Prisma 7 PostgreSQL adapter regressions', () => {
    const ids: string[] = [];
    const clients: PrismaClient[] = [];

    function independentClient() {
        const client = new PrismaClient({ adapter: createPrismaAdapter() });
        clients.push(client);
        return client;
    }

    afterEach(async () => {
        await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
        await prisma.user.deleteMany({ where: { id: { in: ids.splice(0) } } });
        jest.restoreAllMocks();
    });

    it('keeps uncommitted writes isolated and does not close another client pool', async () => {
        const user = await prisma.user.create({ data: { name: 'before' } });
        ids.push(user.id);
        const writer = independentClient();
        const reader = independentClient();

        await writer.$transaction(async (tx) => {
            await tx.user.update({ where: { id: user.id }, data: { name: 'committed' } });
            expect((await reader.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe('before');
        });
        await writer.$disconnect();
        expect((await reader.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe('committed');
    });

    it('rolls back an interactive transaction without leaking a write to another client', async () => {
        const id = randomUUID();
        ids.push(id);
        const writer = independentClient();
        const reader = independentClient();
        const rollback = new Error('intentional test rollback');

        await expect(writer.$transaction(async (tx) => {
            await tx.user.create({ data: { id, name: 'must roll back' } });
            expect(await reader.user.findUnique({ where: { id } })).toBeNull();
            throw rollback;
        })).rejects.toThrow(rollback);
        expect(await reader.user.findUnique({ where: { id } })).toBeNull();
    });

    it('keeps real PostgreSQL constraint failures from exposing customer values in logs or messages', async () => {
        const marker = `private-${randomUUID()}`;
        const email = `${marker}@example.test`;
        const user = await prisma.user.create({ data: { email } });
        ids.push(user.id);
        const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => {});
        const warnLog = jest.spyOn(logger, 'warn').mockImplementation(() => {});

        await expect(prisma.user.create({ data: { email } })).rejects.toMatchObject({ code: 'P2002' });
        const error = await prisma.user.create({ data: { email: email.toUpperCase(), name: marker } })
            .then(() => null, (failure: unknown) => failure);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(marker);
        expect((error as Error).message).not.toContain(email.toUpperCase());
        expect(errorLog).toHaveBeenCalled();
        expect(JSON.stringify([...errorLog.mock.calls, ...warnLog.mock.calls])).not.toContain(marker);
    });

    it('lets a completed CLI process exit naturally after its last query', async () => {
        const script = [
            "const { PrismaClient } = require('@prisma/client');",
            "const { createPrismaAdapter } = require('./lib/prismaAdapter');",
            'const client = new PrismaClient({ adapter: createPrismaAdapter() });',
            "client.user.count().then(() => console.log('query completed')).catch(() => { process.exitCode = 1; });",
        ].join('\n');
        // Intentionally no $disconnect/process.exit: this detects an idle pool
        // keeping a completed process alive, without concealing active work.
        const { stdout } = await promisify(execFile)(process.execPath, [
            '-r', 'ts-node/register', '-e', script,
        ], {
            cwd: process.cwd(),
            env: { ...process.env, TS_NODE_PROJECT: 'tsconfig.seed.json' },
            timeout: 10_000,
        });
        expect(stdout).toContain('query completed');
    }, 15_000);
});
