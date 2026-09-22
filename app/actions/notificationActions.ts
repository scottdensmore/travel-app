'use server';

import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasVerifiedStaffAccess } from '@/lib/staffMfa';
import { prisma } from '@/lib/prisma';
import { NotificationService, EffectivePreferences } from '@/lib/notificationService';
import {
    parseActionInput,
    updateNotificationPreferencesSchema,
    adminNotificationDeliveriesQuerySchema,
} from '@/lib/validation';
import {
    actionValidationFailure,
    ActionValidationFailure,
} from '@/lib/actionResult';
import type { Prisma, NotificationDelivery, Notification } from '@prisma/client';
import { z } from 'zod';

export type ActionResult<T, E = ActionValidationFailure> = { ok: true; data: T } | E;

export type NotificationDeliveryWithNotification = NotificationDelivery & {
    notification: Notification;
};

const retryNotificationDeliverySchema = z.union([
    z.string().trim().min(1, 'Delivery ID is required.'),
    z.object({
        deliveryId: z.string().trim().min(1, 'Delivery ID is required.'),
    }).transform(o => o.deliveryId),
]);

export async function getNotificationPreferencesAction(): Promise<ActionResult<EffectivePreferences>> {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) {
        return actionValidationFailure('Please sign in to view notification preferences.');
    }

    try {
        const service = new NotificationService();
        const preferences = await service.getEffectivePreferences(userId);
        return { ok: true, data: preferences };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to retrieve notification preferences.';
        return actionValidationFailure(message);
    }
}

export async function updateNotificationPreferencesAction(
    input: unknown
): Promise<ActionResult<{ success: true }>> {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) {
        return actionValidationFailure('Please sign in to update notification preferences.');
    }

    const parsed = parseActionInput(updateNotificationPreferencesSchema, input);
    if (!parsed.ok) {
        return parsed;
    }

    try {
        const service = new NotificationService();
        await service.updatePreferences(userId, parsed.data);
        revalidatePath('/profile/notifications');
        return { ok: true, data: { success: true } };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update notification preferences.';
        return actionValidationFailure(message);
    }
}

export async function getAdminNotificationDeliveriesAction(
    input: unknown
): Promise<ActionResult<{ deliveries: NotificationDeliveryWithNotification[]; totalCount: number }>> {
    const session = await getServerSession(authOptions);
    const isStaff = await hasVerifiedStaffAccess(session);
    if (!isStaff) {
        return actionValidationFailure('Unauthorized: Staff access with verified MFA required.');
    }

    const parsed = parseActionInput(adminNotificationDeliveriesQuerySchema, input ?? {});
    if (!parsed.ok) {
        return parsed;
    }

    const { status, channel, page, pageSize, search } = parsed.data;

    try {
        const where: Prisma.NotificationDeliveryWhereInput = {};
        if (status) {
            where.status = status;
        }
        if (channel) {
            where.channel = channel;
        }
        if (search?.trim()) {
            const query = search.trim();
            where.OR = [
                { recipient: { contains: query } },
                { error: { contains: query } },
                {
                    notification: {
                        OR: [
                            { title: { contains: query } },
                            { message: { contains: query } },
                        ],
                    },
                },
            ];
        }

        const skip = (page - 1) * pageSize;
        const [deliveries, totalCount] = await Promise.all([
            prisma.notificationDelivery.findMany({
                where,
                include: { notification: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: pageSize,
            }),
            prisma.notificationDelivery.count({ where }),
        ]);

        return {
            ok: true,
            data: {
                deliveries,
                totalCount,
            },
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to retrieve notification deliveries.';
        return actionValidationFailure(message);
    }
}

export async function retryNotificationDeliveryAction(
    input: unknown
): Promise<ActionResult<{ success: true; delivery: NotificationDeliveryWithNotification | null }>> {
    const session = await getServerSession(authOptions);
    const isStaff = await hasVerifiedStaffAccess(session);
    if (!isStaff) {
        return actionValidationFailure('Unauthorized: Staff access with verified MFA required.');
    }

    const parsed = parseActionInput(retryNotificationDeliverySchema, input);
    if (!parsed.ok) {
        return parsed;
    }

    const deliveryId = parsed.data;

    try {
        const service = new NotificationService();
        await service.retryDelivery(deliveryId);
        revalidatePath('/admin/notifications');

        const delivery = await prisma.notificationDelivery.findUnique({
            where: { id: deliveryId },
            include: { notification: true },
        });

        return {
            ok: true,
            data: {
                success: true,
                delivery,
            },
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to retry notification delivery.';
        return actionValidationFailure(message);
    }
}
