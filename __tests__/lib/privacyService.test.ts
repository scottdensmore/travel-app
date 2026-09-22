/**
 * @jest-environment node
 */
import {
    exportUserData,
    assertNoSensitiveExportData,
    checkAccountDeletionEligibility,
    deleteUserAccount,
    verifyUserPassword,
} from '@/lib/privacyService';
import { prisma } from '@/lib/prisma';
import { purgePassengerDataForUser } from '@/lib/passengerDataRetention';
import bcrypt from 'bcryptjs';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findUniqueOrThrow: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        booking: {
            findMany: jest.fn(),
        },
        passenger: {
            updateMany: jest.fn(),
        },
        passengerAncillary: {
            findMany: jest.fn(),
        },
        review: {
            findMany: jest.fn(),
        },
        notification: {
            findMany: jest.fn(),
            deleteMany: jest.fn(),
        },
        notificationPreference: {
            findMany: jest.fn(),
            deleteMany: jest.fn(),
        },
        userFavorite: {
            findMany: jest.fn(),
            deleteMany: jest.fn(),
        },
        session: {
            deleteMany: jest.fn(),
        },
        account: {
            deleteMany: jest.fn(),
        },
    },
}));

jest.mock('@/lib/passengerDataRetention', () => ({
    purgePassengerDataForUser: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
    compare: jest.fn(),
    hash: jest.fn(),
}));

describe('privacyService', () => {
    const mockPrisma = prisma as unknown as {
        user: {
            findUniqueOrThrow: jest.Mock;
            findUnique: jest.Mock;
            update: jest.Mock;
        };
        booking: {
            findMany: jest.Mock;
        };
        passenger: {
            updateMany: jest.Mock;
        };
        passengerAncillary: {
            findMany: jest.Mock;
        };
        review: {
            findMany: jest.Mock;
        };
        notification: {
            findMany: jest.Mock;
            deleteMany: jest.Mock;
        };
        notificationPreference: {
            findMany: jest.Mock;
            deleteMany: jest.Mock;
        };
        userFavorite: {
            findMany: jest.Mock;
            deleteMany: jest.Mock;
        };
        session: {
            deleteMany: jest.Mock;
        };
        account: {
            deleteMany: jest.Mock;
        };
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('assertNoSensitiveExportData', () => {
        it('passes for clean export data without sensitive keys', () => {
            const cleanData = {
                user: {
                    id: 'usr_123',
                    name: 'Jane Doe',
                    email: 'jane@example.com',
                },
                bookings: [
                    {
                        id: 1,
                        reference: 'MA-ABCDEF',
                        passengers: [{ firstName: 'Jane', lastName: 'Doe' }],
                    },
                ],
            };
            expect(() => assertNoSensitiveExportData(cleanData)).not.toThrow();
        });

        it('throws an error if a password or passwordHash field is present', () => {
            const dirtyData = {
                user: {
                    id: 'usr_123',
                    password: 'supersecretpassword',
                },
            };
            expect(() => assertNoSensitiveExportData(dirtyData)).toThrow(
                /Sensitive field detected in export data: user\.password/
            );

            const dirtyDataHash = {
                user: {
                    id: 'usr_123',
                    passwordHash: '$2b$10$abcdef...',
                },
            };
            expect(() => assertNoSensitiveExportData(dirtyDataHash)).toThrow(
                /Sensitive field detected in export data: user\.passwordHash/
            );
        });

        it('throws an error if TOTP or staff MFA secret is present', () => {
            const dirtyMfa = {
                user: {
                    id: 'usr_123',
                    staffMfaSecretEncrypted: 'ciphertext==',
                },
            };
            expect(() => assertNoSensitiveExportData(dirtyMfa)).toThrow(
                /Sensitive field detected in export data/
            );
        });

        it('throws an error if encrypted passport or DOB is present', () => {
            const dirtyPassenger = {
                bookings: [
                    {
                        passengers: [
                            {
                                firstName: 'Jane',
                                passportNumberEncrypted: 'aes256cipher',
                            },
                        ],
                    },
                ],
            };
            expect(() => assertNoSensitiveExportData(dirtyPassenger)).toThrow(
                /Sensitive field detected in export data/
            );
        });

        it('throws an error if encryption keys, salts, or secrets are present', () => {
            const dirtyKeys = {
                internalSalt: 'saltvalue',
            };
            expect(() => assertNoSensitiveExportData(dirtyKeys)).toThrow(
                /Sensitive field detected in export data: internalSalt/
            );
        });
    });

    describe('exportUserData', () => {
        it('gathers all personal data and strictly excludes sensitive security fields', async () => {
            const userId = 'user-test-1';
            mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
                id: userId,
                name: 'Jane Doe',
                email: 'jane@example.com',
                emailVerified: new Date('2026-01-01T00:00:00Z'),
                image: '/avatar.jpg',
                role: 'USER',
                timeZone: 'America/New_York',
            });

            mockPrisma.booking.findMany.mockResolvedValue([
                {
                    id: 10,
                    reference: 'MA-999999',
                    createdAt: new Date('2026-02-01T12:00:00Z'),
                    status: 'CONFIRMED',
                    totalPriceCents: 45000,
                    currency: 'USD',
                    legs: [
                        {
                            sequence: 1,
                            flight: {
                                flightNumber: 'MA101',
                                airline: 'Mona Airways',
                                priceCents: 45000,
                                departureDate: new Date('2026-03-01T10:00:00Z'),
                                durationMinutes: 180,
                                status: 'ON_TIME',
                                fromAirport: { label: 'Seattle, USA' },
                                toAirport: { label: 'New York, USA' },
                            },
                            seatAssignments: [
                                {
                                    passengerId: 'p-1',
                                    seatNumber: '14B',
                                    cabinClass: 'ECONOMY',
                                    releasedAt: null,
                                    checkedInAt: null,
                                },
                            ],
                        },
                    ],
                    passengers: [
                        {
                            id: 'p-1',
                            firstName: 'Jane',
                            lastName: 'Doe',
                            gender: 'Female',
                            documentsConfirmedAt: null,
                        },
                    ],
                    statusChanges: [],
                },
            ]);

            mockPrisma.passengerAncillary.findMany.mockResolvedValue([
                { passengerId: 'p-1', type: 'CHECKED_BAG_1', priceCents: 3500 },
            ]);

            mockPrisma.review.findMany.mockResolvedValue([
                {
                    id: 'rev-1',
                    content: 'Great trip!',
                    rating: 5,
                    createdAt: new Date('2026-02-15T00:00:00Z'),
                    cityGuide: { city: 'New York', country: 'USA', description: 'Big Apple' },
                },
            ]);

            mockPrisma.notificationPreference.findMany.mockResolvedValue([
                {
                    category: 'FLIGHT_STATUS',
                    channel: 'EMAIL',
                    enabled: true,
                    createdAt: new Date('2026-01-15T08:00:00Z'),
                    updatedAt: new Date('2026-01-15T08:00:00Z'),
                },
            ]);

            mockPrisma.notification.findMany.mockResolvedValue([
                {
                    id: 'notif-1',
                    title: 'Flight Confirmed',
                    message: 'Flight MA101 is booked.',
                    type: 'FLIGHT_STATUS',
                    category: 'FLIGHT_STATUS',
                    isRead: true,
                    createdAt: new Date('2026-02-01T12:05:00Z'),
                    deliveries: [
                        {
                            id: 'del-1',
                            channel: 'EMAIL',
                            status: 'SENT',
                            recipient: 'jane@example.com',
                            attempts: 1,
                            lastAttemptAt: new Date('2026-02-01T12:05:05Z'),
                            error: null,
                            createdAt: new Date('2026-02-01T12:05:00Z'),
                        },
                    ],
                },
            ]);

            mockPrisma.userFavorite.findMany.mockResolvedValue([
                {
                    id: 'fav-1',
                    createdAt: new Date('2026-02-10T00:00:00Z'),
                    cityGuide: { city: 'New York', country: 'USA', description: 'Big Apple' },
                },
            ]);

            const exportResult = await exportUserData(userId);

            // Assert metadata
            expect(exportResult.metadata.userId).toBe(userId);
            expect(exportResult.metadata.formatVersion).toBe('1.0.0');
            expect(exportResult.metadata.exportedAt).toBeDefined();

            // Assert user profile
            expect(exportResult.user.id).toBe(userId);
            expect(exportResult.user.name).toBe('Jane Doe');
            expect(exportResult.user.email).toBe('jane@example.com');
            expect(exportResult.user.timeZone).toBe('America/New_York');

            // Assert bookings and passengers
            expect(exportResult.bookings).toHaveLength(1);
            expect(exportResult.bookings[0].reference).toBe('MA-999999');
            expect(exportResult.bookings[0].legs[0].flight?.flightNumber).toBe('MA101');
            expect(exportResult.bookings[0].passengers[0].firstName).toBe('Jane');
            expect(exportResult.bookings[0].passengers[0].ancillaries).toEqual([
                { type: 'CHECKED_BAG_1', priceCents: 3500 },
            ]);

            // Assert reviews, notifications, favorites, points, notification preferences
            expect(exportResult.reviews).toHaveLength(1);
            expect(exportResult.notifications).toHaveLength(1);
            expect(exportResult.notifications[0].category).toBe('FLIGHT_STATUS');
            expect(exportResult.notifications[0].deliveries).toEqual([
                {
                    id: 'del-1',
                    channel: 'EMAIL',
                    status: 'SENT',
                    recipient: 'jane@example.com',
                    attempts: 1,
                    lastAttemptAt: new Date('2026-02-01T12:05:05Z'),
                    error: null,
                    createdAt: new Date('2026-02-01T12:05:00Z'),
                },
            ]);
            expect(exportResult.favorites).toHaveLength(1);
            expect(exportResult.notificationPreferences).toEqual([
                {
                    category: 'FLIGHT_STATUS',
                    channel: 'EMAIL',
                    enabled: true,
                    createdAt: new Date('2026-01-15T08:00:00Z'),
                    updatedAt: new Date('2026-01-15T08:00:00Z'),
                },
            ]);
            expect(exportResult.pointsActivity.currentPoints).toBeGreaterThanOrEqual(0);

            // Assert Prisma queries
            expect(mockPrisma.notificationPreference.findMany).toHaveBeenCalledWith({
                where: { userId },
                orderBy: [{ category: 'asc' }, { channel: 'asc' }],
                select: {
                    category: true,
                    channel: true,
                    enabled: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
            expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    title: true,
                    message: true,
                    type: true,
                    category: true,
                    isRead: true,
                    createdAt: true,
                    deliveries: {
                        orderBy: { createdAt: 'desc' },
                        select: {
                            id: true,
                            channel: true,
                            status: true,
                            recipient: true,
                            attempts: true,
                            lastAttemptAt: true,
                            error: true,
                            createdAt: true,
                        },
                    },
                },
            });

            // Verify sanitization: no forbidden properties
            expect(() => assertNoSensitiveExportData(exportResult)).not.toThrow();
            const rawJson = JSON.stringify(exportResult);
            expect(rawJson).not.toContain('password');
            expect(rawJson).not.toContain('staffMfaSecret');
            expect(rawJson).not.toContain('dateOfBirthEncrypted');
            expect(rawJson).not.toContain('passportNumberEncrypted');
        });
    });

    describe('checkAccountDeletionEligibility', () => {
        const userId = 'user-del-1';
        const referenceTime = new Date('2026-06-01T12:00:00Z');

        it('blocks deletion when user has active upcoming flights', async () => {
            mockPrisma.booking.findMany.mockResolvedValue([
                {
                    id: 1,
                    status: 'CONFIRMED',
                    legs: [
                        {
                            flight: {
                                flightNumber: 'MA200',
                                departureDate: new Date('2026-06-15T08:00:00Z'), // in future
                            },
                        },
                    ],
                },
            ]);

            const result = await checkAccountDeletionEligibility(userId, referenceTime);
            expect(result.eligible).toBe(false);
            expect(result.reason).toBe('UPCOMING_FLIGHTS');
            expect(result.upcomingBookingsCount).toBe(1);
            expect(result.message).toContain('Account deletion cannot proceed because you have 1 upcoming active booking');
            expect(result.message).toContain('You must complete or cancel your upcoming trips first');
        });

        it('blocks deletion when user has disrupted upcoming flights', async () => {
            mockPrisma.booking.findMany.mockResolvedValue([
                {
                    id: 2,
                    status: 'DISRUPTED',
                    legs: [
                        {
                            flight: {
                                flightNumber: 'MA300',
                                departureDate: new Date('2026-06-20T10:00:00Z'), // in future
                            },
                        },
                    ],
                },
            ]);

            const result = await checkAccountDeletionEligibility(userId, referenceTime);
            expect(result.eligible).toBe(false);
            expect(result.reason).toBe('UPCOMING_FLIGHTS');
        });

        it('allows deletion when all flights have already departed in the past', async () => {
            mockPrisma.booking.findMany.mockResolvedValue([
                {
                    id: 3,
                    status: 'CONFIRMED',
                    legs: [
                        {
                            flight: {
                                flightNumber: 'MA100',
                                departureDate: new Date('2026-05-01T08:00:00Z'), // in past
                            },
                        },
                    ],
                },
            ]);

            const result = await checkAccountDeletionEligibility(userId, referenceTime);
            expect(result.eligible).toBe(true);
            expect(result.reason).toBeNull();
            expect(result.upcomingBookingsCount).toBe(0);
        });

        it('allows deletion when user has no bookings', async () => {
            mockPrisma.booking.findMany.mockResolvedValue([]);

            const result = await checkAccountDeletionEligibility(userId, referenceTime);
            expect(result.eligible).toBe(true);
            expect(result.reason).toBeNull();
            expect(result.upcomingBookingsCount).toBe(0);
        });
    });

    describe('deleteUserAccount', () => {
        const userId = 'user-to-delete';
        const referenceTime = new Date('2026-06-01T12:00:00Z');

        it('throws an error if user has upcoming flights', async () => {
            mockPrisma.booking.findMany.mockResolvedValue([
                {
                    id: 1,
                    status: 'CONFIRMED',
                    legs: [
                        {
                            flight: {
                                flightNumber: 'MA200',
                                departureDate: new Date('2026-06-15T08:00:00Z'),
                            },
                        },
                    ],
                },
            ]);

            await expect(deleteUserAccount(userId, referenceTime)).rejects.toThrow(
                /Account deletion cannot proceed/
            );
        });

        it('anonymizes user, purges restricted passenger data, and terminates sessions upon successful deletion', async () => {
            mockPrisma.booking.findMany.mockResolvedValue([]);
            mockPrisma.user.findUnique.mockResolvedValue({
                id: userId,
                authVersion: 2,
            });

            const result = await deleteUserAccount(userId, referenceTime);

            expect(result.success).toBe(true);
            expect(result.anonymizedUserId).toBe(userId);

            // 1. Purged restricted passenger identity data according to PASSENGER_DATA_POLICY.md
            expect(purgePassengerDataForUser).toHaveBeenCalledWith(userId, referenceTime);

            // 2. Anonymized passenger rows on bookings
            expect(mockPrisma.passenger.updateMany).toHaveBeenCalledWith({
                where: { booking: { userId } },
                data: {
                    firstName: 'Anonymized',
                    lastName: 'Passenger',
                },
            });

            // 3. User identifiers scrambled/nullified and authVersion incremented
            expect(mockPrisma.user.update).toHaveBeenCalledWith({
                where: { id: userId },
                data: {
                    name: 'Deleted User',
                    email: `deleted-${userId}@privacy.invalid`,
                    emailVerified: null,
                    image: null,
                    password: null,
                    staffMfaSecretEncrypted: null,
                    staffMfaEnrolledAt: null,
                    staffMfaLastUsedStep: null,
                    authVersion: 3,
                },
            });

            // 4. Terminated database sessions and OAuth accounts
            expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId } });
            expect(mockPrisma.account.deleteMany).toHaveBeenCalledWith({ where: { userId } });

            // 5. Cleaned up personal favorites, notifications, and notification preferences
            expect(mockPrisma.userFavorite.deleteMany).toHaveBeenCalledWith({ where: { userId } });
            expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({ where: { userId } });
            expect(mockPrisma.notificationPreference.deleteMany).toHaveBeenCalledWith({ where: { userId } });
        });
    });

    describe('verifyUserPassword', () => {
        const userId = 'usr-pwd-test';

        it('returns valid true if user has no password (e.g. OAuth)', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ id: userId, password: null });
            const result = await verifyUserPassword(userId, '');
            expect(result.valid).toBe(true);
        });

        it('returns false if password is missing when user has a password', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ id: userId, password: '$2b$10$hash' });
            const result = await verifyUserPassword(userId, '');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('Password is required');
        });

        it('returns false if password comparison fails', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ id: userId, password: '$2b$10$hash' });
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);

            const result = await verifyUserPassword(userId, 'wrongpassword');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('password you entered is incorrect');
        });

        it('returns true if password matches', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ id: userId, password: '$2b$10$hash' });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);

            const result = await verifyUserPassword(userId, 'correctpassword');
            expect(result.valid).toBe(true);
        });
    });
});
