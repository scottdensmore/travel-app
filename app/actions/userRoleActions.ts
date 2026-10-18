'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Role, PointsTransactionType } from '@prisma/client';
import { StaffPermission } from '@/lib/staffPermissions';
import { assertPrivilegedStaffOperation, StaffStepUpRequiredError } from '@/lib/staffMfa';
import { recordStaffAudit } from '@/lib/staffAuditService';
import {
    createPointsLedgerEntry,
    getUserSpendablePointsBalance,
    InsufficientPointsError,
} from '@/lib/pointsLedgerService';
import { parseInput, updateUserRoleSchema, adjustUserPointsSchema } from '@/lib/validation';
import { revalidatePath } from 'next/cache';

export async function updateUserRoleAction(input: {
    userId: string;
    newRole: Role;
    reason: string;
    stepUpCode?: string;
}) {
    let validated;
    try {
        validated = parseInput(updateUserRoleSchema, input);
    } catch (error) {
        return { success: false as const, error: (error as Error).message || 'Invalid input.' };
    }

    const session = await getServerSession(authOptions);

    let actor;
    try {
        actor = await assertPrivilegedStaffOperation({
            session,
            permission: StaffPermission.USERS_MANAGE_ROLES,
            stepUpCode: validated.stepUpCode,
        });
    } catch (error) {
        if (error instanceof StaffStepUpRequiredError) {
            return { success: false as const, requiresStepUp: true as const, error: error.message };
        }
        return { success: false as const, error: (error as Error).message || 'Unauthorized' };
    }

    try {
        const targetUser = await prisma.user.findUnique({
            where: { id: validated.userId },
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
                    role: validated.newRole,
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
                afterState: { role: validated.newRole, email: targetUser.email },
                reason: validated.reason,
            }, tx);
        });

        revalidatePath('/admin/users');
        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: (error as Error).message || 'Failed to update user role.' };
    }
}

export async function adjustUserPointsAction(input: {
    userId: string;
    amount: number;
    reason: string;
    stepUpCode?: string;
}) {
    let validated;
    try {
        validated = parseInput(adjustUserPointsSchema, input);
    } catch (error) {
        return { success: false as const, error: (error as Error).message || 'Invalid input.' };
    }

    const session = await getServerSession(authOptions);

    let actor;
    try {
        actor = await assertPrivilegedStaffOperation({
            session,
            permission: StaffPermission.USERS_MANAGE_POINTS,
            stepUpCode: validated.stepUpCode,
        });
    } catch (error) {
        if (error instanceof StaffStepUpRequiredError) {
            return { success: false as const, requiresStepUp: true as const, error: error.message };
        }
        return { success: false as const, error: (error as Error).message || 'Unauthorized' };
    }

    try {
        const targetUser = await prisma.user.findUnique({
            where: { id: validated.userId },
            select: { id: true, email: true },
        });

        if (!targetUser) {
            return { success: false as const, error: 'User not found.' };
        }

        const balanceAfter = await prisma.$transaction(async (tx) => {
            const previousBalance = await getUserSpendablePointsBalance(targetUser.id, tx);

            const entry = await createPointsLedgerEntry(
                {
                    userId: targetUser.id,
                    type: PointsTransactionType.ADMIN_ADJUSTMENT,
                    amount: validated.amount,
                    description: `Admin adjustment: ${validated.reason}`,
                },
                tx
            );

            await recordStaffAudit(
                {
                    actorId: actor.actorId,
                    actorEmail: actor.actorEmail,
                    actorRole: actor.actorRole,
                    action: 'USER_POINTS_ADJUSTMENT',
                    targetType: 'User',
                    targetId: targetUser.id,
                    beforeState: { spendablePoints: previousBalance, email: targetUser.email },
                    afterState: {
                        spendablePoints: entry.balanceAfter,
                        delta: validated.amount,
                        email: targetUser.email,
                    },
                    reason: validated.reason,
                },
                tx
            );

            return entry.balanceAfter;
        });

        revalidatePath('/admin/users');
        revalidatePath('/profile');
        return { success: true as const, balanceAfter };
    } catch (error) {
        if (error instanceof InsufficientPointsError) {
            return { success: false as const, error: error.message };
        }
        return { success: false as const, error: (error as Error).message || 'Failed to adjust user points.' };
    }
}

