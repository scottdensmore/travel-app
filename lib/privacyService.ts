import { prisma } from '@/lib/prisma';
import { flightRouteInclude, withLegRouteLabels } from '@/lib/flightRoute';
import { safePassengerSelect } from '@/lib/passengerDataAccess';
import { activeItineraryLegWhere, orderedLegs } from '@/lib/bookingItinerary';
import PointsActivityService from '@/lib/PointsActivityService';
import { purgePassengerDataForUser } from '@/lib/passengerDataRetention';
import {
    DEFAULT_ACCOUNT_TIME_ZONE,
    normalizeAccountTimeZone,
} from '@/lib/accountTimeZone';
import bcrypt from 'bcryptjs';

export interface ExportedUserData {
    user: {
        id: string;
        name: string | null;
        email: string | null;
        emailVerified: Date | null;
        image: string | null;
        role: string;
        timeZone: string;
    };
    bookings: Array<{
        id: number;
        reference: string;
        createdAt: Date;
        status: string;
        totalPriceCents: number | null;
        currency: string;
        legs: Array<{
            sequence: number;
            flight: {
                flightNumber: string;
                airline: string;
                from: string;
                to: string;
                departureDate: Date;
                durationMinutes: number | null;
                priceCents: number;
                status: string;
            } | null;
            seatAssignments: Array<{
                seatNumber: string;
                cabinClass: string;
                releasedAt: Date | null;
                checkedInAt: Date | null;
            }>;
        }>;
        passengers: Array<{
            id: string;
            firstName: string;
            lastName: string;
            gender: string;
            documentsConfirmedAt: Date | null;
            ancillaries: Array<{
                type: string;
                priceCents: number;
            }>;
        }>;
        statusChanges: Array<{
            from: string | null;
            to: string;
            reason: string | null;
            refundCents: number | null;
            createdAt: Date;
        }>;
    }>;
    reviews: Array<{
        id: string;
        content: string;
        rating: number;
        createdAt: Date;
        cityGuide: {
            city: string;
            country: string;
            description: string;
        };
    }>;
    notifications: Array<{
        id: string;
        title: string;
        message: string;
        type: string;
        isRead: boolean;
        createdAt: Date;
    }>;
    favorites: Array<{
        id: string;
        createdAt: Date;
        cityGuide: {
            city: string;
            country: string;
            description: string;
        };
    }>;
    pointsActivity: {
        currentPoints: number;
        currentStatus: string;
        activity: Array<{
            description: string;
            date: string;
            points: number;
        }>;
    };
    metadata: {
        exportedAt: string;
        formatVersion: string;
        userId: string;
    };
}

const SENSITIVE_KEY_PATTERNS = [
    /password/i,
    /secret/i,
    /salt/i,
    /totp/i,
    /encrypted/i,
    /encryptionkey/i,
    /privatekey/i,
    /keyring/i,
    /hash/i,
];

/**
 * Asserts that no sensitive field names exist anywhere in the export data tree.
 * Strictly excludes passwords, hashes, TOTP secrets, encrypted passport/DOB, salts, or encryption keys.
 */
export function assertNoSensitiveExportData(value: unknown, path = ''): void {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
        value.forEach((item, i) => assertNoSensitiveExportData(item, `${path}[${i}]`));
        return;
    }

    const record = value as Record<string, unknown>;
    for (const [key, val] of Object.entries(record)) {
        for (const pattern of SENSITIVE_KEY_PATTERNS) {
            if (pattern.test(key)) {
                throw new Error(`Sensitive field detected in export data: ${path ? `${path}.${key}` : key}`);
            }
        }
        assertNoSensitiveExportData(val, path ? `${path}.${key}` : key);
    }
}

/**
 * Gathers user data for export while strictly omitting security credentials,
 * password hashes, encryption keys, and raw sensitive encrypted columns.
 */
export async function exportUserData(userId: string): Promise<ExportedUserData> {
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            email: true,
            emailVerified: true,
            image: true,
            role: true,
            timeZone: true,
            // Strictly exclude: password, staffMfaSecretEncrypted, staffMfaEnrolledAt, staffMfaLastUsedStep, authVersion
        },
    });

    const accountTimeZone = normalizeAccountTimeZone(user.timeZone) ?? DEFAULT_ACCOUNT_TIME_ZONE;

    const userBookings = await prisma.booking.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
            legs: {
                where: activeItineraryLegWhere,
                include: {
                    flight: { include: flightRouteInclude },
                    seatAssignments: {
                        select: {
                            passengerId: true,
                            seatNumber: true,
                            cabinClass: true,
                            releasedAt: true,
                            checkedInAt: true,
                        },
                    },
                },
                orderBy: { sequence: 'asc' },
            },
            passengers: {
                select: {
                    ...safePassengerSelect,
                    documentsConfirmedAt: true,
                    // Strictly exclude: dateOfBirthEncrypted, passportNumberEncrypted, sensitiveDataExpiresAt, sensitiveDataDeletedAt
                },
            },
            statusChanges: {
                orderBy: { sequence: 'asc' },
                select: {
                    from: true,
                    to: true,
                    reason: true,
                    refundCents: true,
                    createdAt: true,
                },
            },
        },
    });

    const allPassengerIds = userBookings.flatMap(booking => booking.passengers.map(p => p.id));
    const ancillaries = allPassengerIds.length > 0 && prisma.passengerAncillary
        ? await prisma.passengerAncillary.findMany({
            where: { passengerId: { in: allPassengerIds } },
            select: { passengerId: true, type: true, priceCents: true },
        })
        : [];
    const ancillariesByPassenger = new Map<string, Array<{ type: string; priceCents: number }>>();
    for (const a of ancillaries) {
        const list = ancillariesByPassenger.get(a.passengerId) || [];
        list.push({ type: a.type, priceCents: a.priceCents });
        ancillariesByPassenger.set(a.passengerId, list);
    }

    const bookingsWithRoute = userBookings.map(booking => ({
        ...booking,
        legs: orderedLegs(booking).map(withLegRouteLabels),
    }));

    const pointsActivityService = new PointsActivityService(
        bookingsWithRoute,
        undefined,
        accountTimeZone,
    );
    const activityData = pointsActivityService.getPointsActivity();
    const currentPoints = pointsActivityService.getCurrentPoints();
    const currentStatus = pointsActivityService.getCurrentStatus();

    const exportedBookings = bookingsWithRoute.map(booking => ({
        id: booking.id,
        reference: booking.reference,
        createdAt: booking.createdAt,
        status: booking.status,
        totalPriceCents: booking.totalPriceCents,
        currency: booking.currency,
        legs: booking.legs.map(leg => ({
            sequence: leg.sequence,
            flight: leg.flight ? {
                flightNumber: leg.flight.flightNumber,
                airline: leg.flight.airline,
                from: leg.flight.from,
                to: leg.flight.to,
                departureDate: leg.flight.departureDate,
                durationMinutes: leg.flight.durationMinutes,
                priceCents: leg.flight.priceCents,
                status: leg.flight.status,
            } : null,
            seatAssignments: (leg.seatAssignments ?? []).map(seat => ({
                seatNumber: seat.seatNumber,
                cabinClass: seat.cabinClass,
                releasedAt: seat.releasedAt,
                checkedInAt: seat.checkedInAt,
            })),
        })),
        passengers: booking.passengers.map(p => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            gender: p.gender,
            documentsConfirmedAt: p.documentsConfirmedAt ?? null,
            ancillaries: ancillariesByPassenger.get(p.id) ?? [],
        })),
        statusChanges: (booking.statusChanges ?? []).map(sc => ({
            from: sc.from,
            to: sc.to,
            reason: sc.reason,
            refundCents: sc.refundCents,
            createdAt: sc.createdAt,
        })),
    }));

    const reviews = await prisma.review.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            content: true,
            rating: true,
            createdAt: true,
            cityGuide: {
                select: {
                    city: true,
                    country: true,
                    description: true,
                },
            },
        },
    });

    const notifications = await prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            title: true,
            message: true,
            type: true,
            isRead: true,
            createdAt: true,
        },
    });

    const favorites = await prisma.userFavorite.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            createdAt: true,
            cityGuide: {
                select: {
                    city: true,
                    country: true,
                    description: true,
                },
            },
        },
    });

    const exportData: ExportedUserData = {
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
            role: user.role,
            timeZone: accountTimeZone,
        },
        bookings: exportedBookings,
        reviews,
        notifications,
        favorites,
        pointsActivity: {
            currentPoints,
            currentStatus,
            activity: activityData,
        },
        metadata: {
            exportedAt: new Date().toISOString(),
            formatVersion: '1.0.0',
            userId: user.id,
        },
    };

    assertNoSensitiveExportData(exportData);
    return exportData;
}

export interface DeletionEligibilityResult {
    eligible: boolean;
    reason: 'UPCOMING_FLIGHTS' | null;
    message: string | null;
    upcomingBookingsCount: number;
}

/**
 * Pre-flight check: Verify user has NO upcoming active flights.
 * If upcoming travel exists, deletion is blocked with a clear warning explaining
 * they must complete or cancel upcoming trips first.
 */
export async function checkAccountDeletionEligibility(
    userId: string,
    now = new Date(),
): Promise<DeletionEligibilityResult> {
    const userBookings = await prisma.booking.findMany({
        where: {
            userId,
            status: { not: 'CANCELLED' },
        },
        include: {
            legs: {
                where: { supersededAt: null },
                include: {
                    flight: { select: { departureDate: true, flightNumber: true } },
                },
            },
        },
    });

    const nowTime = now.getTime();
    let upcomingBookingsCount = 0;

    for (const booking of userBookings) {
        const hasUpcomingFlight = booking.legs.some(leg => {
            if (!leg.flight) return false;
            return new Date(leg.flight.departureDate).getTime() > nowTime;
        });
        if (hasUpcomingFlight) {
            upcomingBookingsCount++;
        }
    }

    if (upcomingBookingsCount > 0) {
        return {
            eligible: false,
            reason: 'UPCOMING_FLIGHTS',
            message: `Account deletion cannot proceed because you have ${upcomingBookingsCount} upcoming active booking${upcomingBookingsCount === 1 ? '' : 's'}. You must complete or cancel your upcoming trips first before deleting your account.`,
            upcomingBookingsCount,
        };
    }

    return {
        eligible: true,
        reason: null,
        message: null,
        upcomingBookingsCount: 0,
    };
}

export interface DeleteUserAccountResult {
    success: boolean;
    anonymizedUserId: string;
}

/**
 * Executes user account deletion:
 * - Pre-flight check: ensures no active upcoming travel.
 * - Anonymizes / purges restricted passenger identity data according to docs/PASSENGER_DATA_POLICY.md.
 * - Anonymizes passenger names on bookings.
 * - Scrambles/nullifies email, name, personal identifiers; increments authVersion to invalidate JWT sessions.
 * - Deletes active database sessions and OAuth accounts.
 * - Cleans up user favorites and notifications.
 */
export async function deleteUserAccount(
    userId: string,
    now = new Date(),
): Promise<DeleteUserAccountResult> {
    const eligibility = await checkAccountDeletionEligibility(userId, now);
    if (!eligibility.eligible) {
        throw new Error(eligibility.message ?? 'Account deletion blocked due to active upcoming flights.');
    }

    // 1. Purge restricted passenger identity data according to docs/PASSENGER_DATA_POLICY.md
    await purgePassengerDataForUser(userId, now);

    // 2. Anonymize passenger records on past/cancelled bookings
    await prisma.passenger.updateMany({
        where: {
            booking: { userId },
        },
        data: {
            firstName: 'Anonymized',
            lastName: 'Passenger',
        },
    });

    // 3. Increment authVersion to invalidate all active JWT tokens
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { authVersion: true },
    });
    const nextAuthVersion = (user?.authVersion ?? 0) + 1;
    const scrambledEmail = `deleted-${userId}@privacy.invalid`;

    // 4. Scramble / nullify user personal identifiers
    await prisma.user.update({
        where: { id: userId },
        data: {
            name: 'Deleted User',
            email: scrambledEmail,
            emailVerified: null,
            image: null,
            password: null,
            staffMfaSecretEncrypted: null,
            staffMfaEnrolledAt: null,
            staffMfaLastUsedStep: null,
            authVersion: nextAuthVersion,
        },
    });

    // 5. Terminate active database sessions and OAuth accounts
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });

    // 6. Delete personal favorites and notifications
    await prisma.userFavorite.deleteMany({ where: { userId } });
    await prisma.notification.deleteMany({ where: { userId } });

    return {
        success: true,
        anonymizedUserId: userId,
    };
}

/**
 * Re-authenticates user password before account deletion.
 */
export async function verifyUserPassword(
    userId: string,
    passwordAttempt: string,
): Promise<{ valid: boolean; message?: string }> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { password: true },
    });

    if (!user) {
        return { valid: false, message: 'User not found.' };
    }

    if (!user.password) {
        // User has no local password (e.g., OAuth-only account)
        return { valid: true };
    }

    if (!passwordAttempt) {
        return { valid: false, message: 'Password is required to confirm account deletion.' };
    }

    const isValid = await bcrypt.compare(passwordAttempt, user.password);
    if (!isValid) {
        return { valid: false, message: 'The password you entered is incorrect.' };
    }

    return { valid: true };
}
