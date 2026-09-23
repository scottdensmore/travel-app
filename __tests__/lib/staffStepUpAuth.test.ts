import {
    assertPrivilegedStaffOperation,
    PRIVILEGED_PERMISSIONS,
    StaffStepUpRequiredError,
    StaffUnauthorizedError,
} from '@/lib/staffMfa';
import { StaffPermission } from '@/lib/staffPermissions';
import { prisma } from '@/lib/prisma';
import * as staffMfaModule from '@/lib/staffMfa';
import { stepUpCodeSchema } from '@/lib/validation';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
        },
    },
}));

jest.mock('@/lib/staffMfa', () => {
    const actual = jest.requireActual('@/lib/staffMfa');
    return {
        ...actual,
        verifyAndConsumeStaffTotp: jest.fn(actual.verifyAndConsumeStaffTotp),
    };
});

describe('Step-Up TOTP Authentication', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('PRIVILEGED_PERMISSIONS constant', () => {
        it('defines the expected list of privileged permissions', () => {
            expect(PRIVILEGED_PERMISSIONS).toEqual([
                StaffPermission.USERS_MANAGE_ROLES,
                StaffPermission.SCHEDULES_DELETE,
                StaffPermission.AUDIT_LOGS_PURGE,
                StaffPermission.BOOKINGS_REFUND,
            ]);
        });
    });

    describe('assertPrivilegedStaffOperation', () => {
        it('throws StaffUnauthorizedError when session is null', async () => {
            await expect(
                assertPrivilegedStaffOperation({
                    session: null,
                    permission: StaffPermission.BOOKINGS_READ,
                })
            ).rejects.toThrow(StaffUnauthorizedError);
        });

        it('throws StaffUnauthorizedError when user lacks the required permission', async () => {
            const session = {
                user: { id: 'u1', email: 'support@example.com', role: 'SUPPORT', staffMfaVerified: true },
            } as never;

            await expect(
                assertPrivilegedStaffOperation({
                    session,
                    permission: StaffPermission.SCHEDULES_DELETE,
                })
            ).rejects.toThrow(StaffUnauthorizedError);
        });

        it('throws StaffUnauthorizedError when user is non-staff USER', async () => {
            const session = {
                user: { id: 'u1', email: 'user@example.com', role: 'USER', staffMfaVerified: true },
            } as never;

            await expect(
                assertPrivilegedStaffOperation({
                    session,
                    permission: StaffPermission.BOOKINGS_READ,
                })
            ).rejects.toThrow(StaffUnauthorizedError);
        });

        it('permits non-privileged operations without step-up code', async () => {
            const session = {
                user: { id: 'u1', email: 'support@example.com', role: 'SUPPORT', staffMfaVerified: true },
            } as never;

            const result = await assertPrivilegedStaffOperation({
                session,
                permission: StaffPermission.BOOKINGS_READ,
            });

            expect(result.actorId).toBe('u1');
            expect(result.actorEmail).toBe('support@example.com');
            expect(result.actorRole).toBe('SUPPORT');
        });

        it('throws StaffStepUpRequiredError when privileged operation lacks recent step-up and no code provided', async () => {
            const session = {
                user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
            } as never;

            const errorPromise = assertPrivilegedStaffOperation({
                session,
                permission: StaffPermission.USERS_MANAGE_ROLES,
            });

            await expect(errorPromise).rejects.toThrow(StaffStepUpRequiredError);
            try {
                await errorPromise;
            } catch (err) {
                expect(err).toBeInstanceOf(StaffStepUpRequiredError);
                expect((err as StaffStepUpRequiredError).permission).toBe(StaffPermission.USERS_MANAGE_ROLES);
            }
        });

        it('permits privileged operation without step-up code when within step-up window', async () => {
            const session = {
                user: {
                    id: 'admin1',
                    email: 'admin@example.com',
                    role: 'ADMIN',
                    staffMfaVerified: true,
                    staffMfaStepUpVerifiedAt: Date.now() - 60_000, // 1 minute ago
                },
            } as never;

            const result = await assertPrivilegedStaffOperation({
                session,
                permission: StaffPermission.USERS_MANAGE_ROLES,
            });

            expect(result.actorId).toBe('admin1');
            expect(result.actorEmail).toBe('admin@example.com');
            expect(result.actorRole).toBe('ADMIN');
        });

        it('requires step-up code when step-up window has expired', async () => {
            const session = {
                user: {
                    id: 'admin1',
                    email: 'admin@example.com',
                    role: 'ADMIN',
                    staffMfaVerified: true,
                    staffMfaStepUpVerifiedAt: Date.now() - 16 * 60 * 1000, // 16 minutes ago (exceeds 15m default)
                },
            } as never;

            await expect(
                assertPrivilegedStaffOperation({
                    session,
                    permission: StaffPermission.USERS_MANAGE_ROLES,
                })
            ).rejects.toThrow(StaffStepUpRequiredError);
        });

        it('verifies step-up TOTP code successfully when valid code is provided', async () => {
            const session = {
                user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
            } as never;

            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'admin1',
                staffMfaSecretEncrypted: 'encrypted-secret',
            });

            jest.spyOn(staffMfaModule, 'verifyAndConsumeStaffTotp').mockResolvedValue(true);

            const result = await assertPrivilegedStaffOperation({
                session,
                permission: StaffPermission.USERS_MANAGE_ROLES,
                stepUpCode: '123456',
            });

            expect(result.actorId).toBe('admin1');
            expect(result.actorEmail).toBe('admin@example.com');
            expect(result.actorRole).toBe('ADMIN');
        });

        it('throws StaffStepUpRequiredError when step-up TOTP code is invalid', async () => {
            const session = {
                user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
            } as never;

            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'admin1',
                staffMfaSecretEncrypted: 'encrypted-secret',
            });

            jest.spyOn(staffMfaModule, 'verifyAndConsumeStaffTotp').mockResolvedValue(false);

            await expect(
                assertPrivilegedStaffOperation({
                    session,
                    permission: StaffPermission.USERS_MANAGE_ROLES,
                    stepUpCode: '999999',
                })
            ).rejects.toThrow('Invalid security code. Please check your authenticator.');
        });

        it('throws StaffUnauthorizedError when user has no staff MFA configured', async () => {
            const session = {
                user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
            } as never;

            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'admin1',
                staffMfaSecretEncrypted: null,
            });

            await expect(
                assertPrivilegedStaffOperation({
                    session,
                    permission: StaffPermission.USERS_MANAGE_ROLES,
                    stepUpCode: '123456',
                })
            ).rejects.toThrow('Staff MFA is not configured.');
        });

        it('throws StaffStepUpRequiredError when step-up code format is not 6 digits', async () => {
            const session = {
                user: { id: 'admin1', email: 'admin@example.com', role: 'ADMIN', staffMfaVerified: true },
            } as never;

            await expect(
                assertPrivilegedStaffOperation({
                    session,
                    permission: StaffPermission.USERS_MANAGE_ROLES,
                    stepUpCode: '12345',
                })
            ).rejects.toThrow(StaffStepUpRequiredError);
        });
    });

    describe('stepUpCodeSchema', () => {
        it('accepts valid 6-digit numeric strings', () => {
            expect(stepUpCodeSchema.parse('123456')).toBe('123456');
            expect(stepUpCodeSchema.parse(' 654321 ')).toBe('654321');
        });

        it('rejects non-6-digit strings', () => {
            expect(() => stepUpCodeSchema.parse('12345')).toThrow();
            expect(() => stepUpCodeSchema.parse('1234567')).toThrow();
            expect(() => stepUpCodeSchema.parse('abcdef')).toThrow();
            expect(() => stepUpCodeSchema.parse('')).toThrow();
        });
    });
});
