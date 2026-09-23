/** @jest-environment node */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { Role } from '@prisma/client';

describe('Staff Permissions and Audit Schema Database Integration', () => {
    const createdUserIds: string[] = [];
    const createdAuditIds: string[] = [];

    afterAll(async () => {
        if (createdAuditIds.length > 0) {
            await prisma.staffAuditLog.deleteMany({
                where: { id: { in: createdAuditIds } },
            });
        }
        if (createdUserIds.length > 0) {
            await prisma.user.deleteMany({
                where: { id: { in: createdUserIds } },
            });
        }
        await prisma.$disconnect();
    });

    it('supports all scoped staff roles on User model', async () => {
        const roles: Role[] = ['USER', 'ADMIN', 'SUPPORT', 'OPERATIONS', 'MODERATOR'];
        for (const role of roles) {
            const user = await prisma.user.create({
                data: {
                    email: `role-test-${role.toLowerCase()}-${randomUUID()}@example.com`,
                    name: `${role} User`,
                    role,
                    emailVerified: new Date(),
                },
            });
            createdUserIds.push(user.id);
            expect(user.role).toBe(role);
        }
    });

    it('persists StaffAuditLog with beforeState and afterState and preserves log on user deletion (SetNull)', async () => {
        const staffUser = await prisma.user.create({
            data: {
                email: `staff-actor-${randomUUID()}@example.com`,
                name: 'Audited Staff',
                role: 'ADMIN',
                emailVerified: new Date(),
            },
        });
        createdUserIds.push(staffUser.id);

        const audit = await prisma.staffAuditLog.create({
            data: {
                actorId: staffUser.id,
                actorEmail: staffUser.email!,
                actorRole: staffUser.role,
                action: 'SCHEDULE_TERMS_UPDATE',
                targetType: 'FlightSchedule',
                targetId: '42',
                beforeState: { terms: 'Original terms', active: true },
                afterState: { terms: 'Updated terms', active: false },
                reason: 'Operational schedule review',
                metadata: { clientIp: '127.0.0.1', userAgent: 'Jest-Test' },
                ipAddress: '127.0.0.1',
            },
        });
        createdAuditIds.push(audit.id);

        expect(audit.actorId).toBe(staffUser.id);
        expect(audit.actorEmail).toBe(staffUser.email);
        expect(audit.beforeState).toEqual({ terms: 'Original terms', active: true });
        expect(audit.afterState).toEqual({ terms: 'Updated terms', active: false });

        // Delete the staff user and verify onDelete: SetNull leaves audit log intact
        await prisma.user.delete({ where: { id: staffUser.id } });
        const remainingAudit = await prisma.staffAuditLog.findUnique({
            where: { id: audit.id },
        });

        expect(remainingAudit).not.toBeNull();
        expect(remainingAudit?.actorId).toBeNull();
        expect(remainingAudit?.actorEmail).toBe(staffUser.email);
        expect(remainingAudit?.actorRole).toBe('ADMIN');
    });
});
