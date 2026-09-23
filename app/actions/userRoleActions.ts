'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Role } from '@prisma/client';
import { StaffPermission } from '@/lib/staffPermissions';
import { assertPrivilegedStaffOperation, StaffStepUpRequiredError } from '@/lib/staffMfa';
import { recordStaffAudit } from '@/lib/staffAuditService';
import { revalidatePath } from 'next/cache';

export async function updateUserRoleAction(input: {
    userId: string;
    newRole: Role;
    reason: string;
    stepUpCode?: string;
}) {
    const session = await getServerSession(authOptions);

    let actor;
    try {
        actor = await assertPrivilegedStaffOperation({
            session,
            permission: StaffPermission.USERS_MANAGE_ROLES,
            stepUpCode: input.stepUpCode,
        });
    } catch (error) {
        if (error instanceof StaffStepUpRequiredError) {
            return { success: false as const, requiresStepUp: true as const, error: error.message };
        }
        return { success: false as const, error: (error as Error).message || 'Unauthorized' };
    }

    const targetUser = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, role: true },
    });

    if (!targetUser) {
        return { success: false as const, error: 'User not found.' };
    }

    const previousRole = targetUser.role;

    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id: targetUser.id },
            data: {
                role: input.newRole,
                authVersion: { increment: 1 }, // Invalidate target user's active sessions
            },
        });

        await recordStaffAudit({
            actorId: actor.actorId,
            actorEmail: actor.actorEmail,
            actorRole: actor.actorRole,
            action: 'USER_ROLE_UPDATE',
            targetType: 'User',
            targetId: targetUser.id,
            beforeState: { role: previousRole, email: targetUser.email },
            afterState: { role: input.newRole, email: targetUser.email },
            reason: input.reason,
        }, tx);
    });

    revalidatePath('/admin/users');
    return { success: true as const };
}
