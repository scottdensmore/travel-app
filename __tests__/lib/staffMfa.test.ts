/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
    prisma: { user: { updateMany: jest.fn() } },
}));

import {
    createStaffTotpCode,
    decryptStaffMfaSecret,
    encryptStaffMfaSecret,
    generateStaffMfaSecret,
    parseStaffMfaEncryptionKeys,
    verifyAndConsumeStaffTotp,
    verifyStaffTotpCode,
} from '@/lib/staffMfa';
import { prisma } from '@/lib/prisma';

const ACTIVE_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const OLD_KEY = Buffer.from('abcdef0123456789abcdef0123456789').toString('base64');

describe('staff TOTP protection', () => {
    const originalEnvironment = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = {
            ...originalEnvironment,
            STAFF_MFA_ENCRYPTION_KEYS: `active:${ACTIVE_KEY}`,
        };
    });

    afterAll(() => {
        process.env = originalEnvironment;
    });

    it('matches the RFC 6238 SHA-1 test vector', () => {
        const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

        expect(createStaffTotpCode(secret, new Date(59_000), 8)).toBe('94287082');
    });

    it('accepts a current or adjacent TOTP step and rejects malformed codes', () => {
        const secret = generateStaffMfaSecret();
        const now = new Date('2026-07-14T18:00:00.000Z');
        const code = createStaffTotpCode(secret, now);

        expect(verifyStaffTotpCode(secret, code, now)).toBe(Math.floor(now.getTime() / 30_000));
        expect(verifyStaffTotpCode(secret, code, new Date(now.getTime() + 30_000))).not.toBeNull();
        expect(verifyStaffTotpCode(secret, '12345', now)).toBeNull();
        expect(verifyStaffTotpCode(secret, 'abcdef', now)).toBeNull();
    });

    it('encrypts authenticator secrets with user-bound authenticated context', () => {
        const keys = parseStaffMfaEncryptionKeys(`active:${ACTIVE_KEY}`);
        const secret = generateStaffMfaSecret();
        const encrypted = encryptStaffMfaSecret(secret, 'admin-1', keys);

        expect(encrypted).toMatch(/^v1:active:/);
        expect(encrypted).not.toContain(secret);
        expect(decryptStaffMfaSecret(encrypted, 'admin-1', keys)).toBe(secret);
        expect(() => decryptStaffMfaSecret(encrypted, 'admin-2', keys))
            .toThrow('Unable to decrypt staff MFA secret');
    });

    it('reads retained keys while writing with the active key', () => {
        const oldOnly = parseStaffMfaEncryptionKeys(`old:${OLD_KEY}`);
        const rotated = parseStaffMfaEncryptionKeys(`active:${ACTIVE_KEY},old:${OLD_KEY}`);
        const secret = generateStaffMfaSecret();
        const oldCiphertext = encryptStaffMfaSecret(secret, 'admin-1', oldOnly);

        expect(decryptStaffMfaSecret(oldCiphertext, 'admin-1', rotated)).toBe(secret);
        expect(encryptStaffMfaSecret(secret, 'admin-1', rotated)).toMatch(/^v1:active:/);
    });

    it.each([
        '',
        'missing-separator',
        `bad id:${ACTIVE_KEY}`,
        `wildcard_key:${ACTIVE_KEY}`,
        'short:c2hvcnQ=',
        `duplicate:${ACTIVE_KEY},duplicate:${OLD_KEY}`,
    ])('rejects an unsafe MFA key ring: %s', value => {
        expect(() => parseStaffMfaEncryptionKeys(value)).toThrow();
    });

    it('atomically consumes a valid step and refuses a replay', async () => {
        const now = new Date();
        const step = Math.floor(now.getTime() / 30_000);
        const secret = generateStaffMfaSecret();
        const encrypted = encryptStaffMfaSecret(secret, 'admin-1');
        const code = createStaffTotpCode(secret, now);
        const updateMany = prisma.user.updateMany as jest.Mock;
        updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

        await expect(verifyAndConsumeStaffTotp('admin-1', encrypted, code)).resolves.toBe(true);
        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: 'admin-1',
                OR: [
                    { staffMfaLastUsedStep: null },
                    { staffMfaLastUsedStep: { lt: step } },
                ],
            }),
            data: expect.objectContaining({ staffMfaLastUsedStep: step }),
        }));

        await expect(verifyAndConsumeStaffTotp('admin-1', encrypted, code)).resolves.toBe(false);
    });
});
