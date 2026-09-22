import { prisma } from './prisma';
import { logger } from './logger';
import { sendNotificationEmail } from './notificationEmail';
import type {
    NotificationCategory,
    NotificationChannel,
} from '@prisma/client';

export type EffectivePreferences = Record<NotificationCategory, Record<NotificationChannel, boolean>>;

export const DEFAULT_NOTIFICATION_PREFERENCES: EffectivePreferences = {
    FLIGHT_STATUS: {
        IN_APP: true,
        EMAIL: true,
    },
    ACCOUNT_ACTIVITY: {
        IN_APP: true,
        EMAIL: true,
    },
    TRAVEL_GUIDES: {
        IN_APP: true,
        EMAIL: false,
    },
};

export class NotificationService {
    async getEffectivePreferences(userId: string): Promise<EffectivePreferences> {
        const stored = await prisma.notificationPreference.findMany({
            where: { userId },
        });

        const effective: EffectivePreferences = {
            FLIGHT_STATUS: { ...DEFAULT_NOTIFICATION_PREFERENCES.FLIGHT_STATUS },
            ACCOUNT_ACTIVITY: { ...DEFAULT_NOTIFICATION_PREFERENCES.ACCOUNT_ACTIVITY },
            TRAVEL_GUIDES: { ...DEFAULT_NOTIFICATION_PREFERENCES.TRAVEL_GUIDES },
        };

        for (const pref of stored) {
            if (effective[pref.category]) {
                effective[pref.category][pref.channel] = pref.enabled;
            }
        }

        return effective;
    }

    async updatePreferences(
        userId: string,
        updates: Array<{ category: NotificationCategory; channel: NotificationChannel; enabled: boolean }>
    ): Promise<void> {
        await prisma.$transaction(
            updates.map(u =>
                prisma.notificationPreference.upsert({
                    where: {
                        userId_category_channel: {
                            userId,
                            category: u.category,
                            channel: u.channel,
                        },
                    },
                    create: {
                        userId,
                        category: u.category,
                        channel: u.channel,
                        enabled: u.enabled,
                    },
                    update: {
                        enabled: u.enabled,
                    },
                })
            )
        );
    }

    async dispatchNotification(input: {
        userId: string;
        title: string;
        message: string;
        category: NotificationCategory;
        type?: string;
    }): Promise<void> {
        const [user, preferences] = await Promise.all([
            prisma.user.findUnique({
                where: { id: input.userId },
                select: { id: true, email: true },
            }),
            this.getEffectivePreferences(input.userId),
        ]);

        if (!user) return;

        const categoryPref = preferences[input.category] || DEFAULT_NOTIFICATION_PREFERENCES[input.category];
        let notificationId: string | null = null;

        // 1. In-App delivery
        if (categoryPref.IN_APP) {
            const notif = await prisma.notification.create({
                data: {
                    userId: user.id,
                    title: input.title,
                    message: input.message,
                    category: input.category,
                    type: input.type || input.category,
                },
            });
            notificationId = notif.id;

            await prisma.notificationDelivery.create({
                data: {
                    notificationId: notif.id,
                    channel: 'IN_APP',
                    status: 'SENT',
                    recipient: user.id,
                    sentAt: new Date(),
                    attempts: 1,
                },
            });
        }

        // 2. Email delivery
        if (categoryPref.EMAIL && user.email) {
            if (!notificationId) {
                const notif = await prisma.notification.create({
                    data: {
                        userId: user.id,
                        title: input.title,
                        message: input.message,
                        category: input.category,
                        type: input.type || input.category,
                        isRead: true, // If only delivered by email, mark read in drawer
                    },
                });
                notificationId = notif.id;
            }

            const delivery = await prisma.notificationDelivery.create({
                data: {
                    notificationId,
                    channel: 'EMAIL',
                    status: 'PENDING',
                    recipient: user.email,
                },
            });

            try {
                await sendNotificationEmail({
                    to: user.email,
                    title: input.title,
                    message: input.message,
                });

                await prisma.notificationDelivery.update({
                    where: { id: delivery.id },
                    data: {
                        status: 'SENT',
                        sentAt: new Date(),
                        attempts: 1,
                        lastAttemptAt: new Date(),
                    },
                });
            } catch (error) {
                const errMessage = error instanceof Error ? error.message : 'Unknown email dispatch error';
                logger.warn(`Failed to dispatch notification email to ${user.email}: ${errMessage}`, {
                    deliveryId: delivery.id,
                    error: errMessage,
                });

                await prisma.notificationDelivery.update({
                    where: { id: delivery.id },
                    data: {
                        status: 'FAILED',
                        error: errMessage,
                        attempts: 1,
                        lastAttemptAt: new Date(),
                    },
                });
            }
        }
    }

    async retryDelivery(deliveryId: string): Promise<void> {
        const delivery = await prisma.notificationDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
            include: { notification: true },
        });

        if (delivery.channel !== 'EMAIL') {
            throw new Error('Only email deliveries can be retried.');
        }

        try {
            await sendNotificationEmail({
                to: delivery.recipient,
                title: delivery.notification.title,
                message: delivery.notification.message,
            });

            await prisma.notificationDelivery.update({
                where: { id: deliveryId },
                data: {
                    status: 'SENT',
                    sentAt: new Date(),
                    attempts: { increment: 1 },
                    lastAttemptAt: new Date(),
                    error: null,
                },
            });
        } catch (error) {
            const errMessage = error instanceof Error ? error.message : 'Retry email dispatch failed';
            await prisma.notificationDelivery.update({
                where: { id: deliveryId },
                data: {
                    status: 'FAILED',
                    error: errMessage,
                    attempts: { increment: 1 },
                    lastAttemptAt: new Date(),
                },
            });
            throw error;
        }
    }
}
