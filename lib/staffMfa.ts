import {
    createCipheriv,
    createDecipheriv,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';
import { prisma } from '@/lib/prisma';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const TOTP_STEP_MS = 30_000;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const STAFF_MFA_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1_000;

export interface StaffMfaEncryptionKeys {
    activeKeyId: string;
    keys: ReadonlyMap<string, Buffer>;
}

function configurationError(message: string): Error {
    return new Error(`STAFF_MFA_ENCRYPTION_KEYS ${message}`);
}

export function parseStaffMfaEncryptionKeys(value: string): StaffMfaEncryptionKeys {
    const entries = value.trim().split(',').map(entry => entry.trim()).filter(Boolean);
    if (entries.length === 0) throw configurationError('must contain at least one key');

    const keys = new Map<string, Buffer>();
    for (const entry of entries) {
        const separator = entry.indexOf(':');
        if (separator <= 0 || separator === entry.length - 1) {
            throw configurationError('must use key-id:base64-key entries');
        }
        const keyId = entry.slice(0, separator);
        const encodedKey = entry.slice(separator + 1);
        if (!KEY_ID_PATTERN.test(keyId)) {
            throw configurationError('contains an invalid key identifier');
        }
        if (keys.has(keyId)) {
            throw configurationError(`contains duplicate key identifier ${keyId}`);
        }
        if (!BASE64_PATTERN.test(encodedKey)) {
            throw configurationError(`contains invalid base64 for key ${keyId}`);
        }
        const key = Buffer.from(encodedKey, 'base64');
        if (key.length !== 32) {
            throw configurationError(`key ${keyId} must decode to exactly 32 bytes`);
        }
        keys.set(keyId, key);
    }

    return { activeKeyId: entries[0].slice(0, entries[0].indexOf(':')), keys };
}

function configuredKeys(): StaffMfaEncryptionKeys {
    return parseStaffMfaEncryptionKeys(process.env.STAFF_MFA_ENCRYPTION_KEYS ?? '');
}

function encodeBase32(value: Buffer): string {
    let bits = 0;
    let accumulator = 0;
    let output = '';
    for (const byte of value) {
        accumulator = (accumulator << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(accumulator >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
    return output;
}

function decodeBase32(value: string): Buffer {
    const normalized = value.trim().replace(/\s+/g, '').toUpperCase().replace(/=+$/g, '');
    if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) throw new Error('Invalid TOTP secret');

    let bits = 0;
    let accumulator = 0;
    const output: number[] = [];
    for (const character of normalized) {
        accumulator = (accumulator << 5) | BASE32_ALPHABET.indexOf(character);
        bits += 5;
        if (bits >= 8) {
            output.push((accumulator >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(output);
}

export function generateStaffMfaSecret(): string {
    return encodeBase32(randomBytes(20));
}

function codeForStep(secret: string, step: number, digits: number): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = (
        ((digest[offset] & 0x7f) << 24)
        | ((digest[offset + 1] & 0xff) << 16)
        | ((digest[offset + 2] & 0xff) << 8)
        | (digest[offset + 3] & 0xff)
    ) >>> 0;
    return String(binary % (10 ** digits)).padStart(digits, '0');
}

export function createStaffTotpCode(secret: string, now = new Date(), digits = 6): string {
    if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
        throw new Error('TOTP digits must be between 6 and 8.');
    }
    return codeForStep(secret, Math.floor(now.getTime() / TOTP_STEP_MS), digits);
}

export function verifyStaffTotpCode(secret: string, code: string, now = new Date()): number | null {
    const normalizedCode = code.trim();
    if (!/^\d{6}$/.test(normalizedCode)) return null;

    const currentStep = Math.floor(now.getTime() / TOTP_STEP_MS);
    for (const step of [currentStep, currentStep - 1, currentStep + 1]) {
        const expected = Buffer.from(codeForStep(secret, step, 6));
        const supplied = Buffer.from(normalizedCode);
        if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return step;
    }
    return null;
}

function authenticatedContext(userId: string): Buffer {
    return Buffer.from(`travel-app:staff-mfa:${userId}`, 'utf8');
}

export function encryptStaffMfaSecret(
    secret: string,
    userId: string,
    keyRing = configuredKeys(),
): string {
    const key = keyRing.keys.get(keyRing.activeKeyId);
    if (!key) throw configurationError('does not contain its active key');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(authenticatedContext(userId));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [
        ENVELOPE_VERSION,
        keyRing.activeKeyId,
        iv.toString('base64url'),
        ciphertext.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
    ].join(':');
}

export function decryptStaffMfaSecret(
    envelope: string,
    userId: string,
    keyRing = configuredKeys(),
): string {
    try {
        const [version, keyId, encodedIv, encodedCiphertext, encodedTag, ...extra] = envelope.split(':');
        if (version !== ENVELOPE_VERSION || extra.length > 0) throw new Error('Invalid envelope');
        const key = keyRing.keys.get(keyId);
        if (!key) throw new Error('Unknown key');
        const iv = Buffer.from(encodedIv, 'base64url');
        const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
        const tag = Buffer.from(encodedTag, 'base64url');
        if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) throw new Error('Invalid envelope');
        const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
        decipher.setAAD(authenticatedContext(userId));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
        throw new Error('Unable to decrypt staff MFA secret');
    }
}

export function createStaffMfaOtpAuthUri(secret: string, email: string): string {
    const issuer = 'Mona Airways';
    const label = `${issuer}:${email}`;
    const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
    return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export async function verifyAndConsumeStaffTotp(
    userId: string,
    encryptedSecret: string,
    code: string,
): Promise<boolean> {
    try {
        const keyRing = configuredKeys();
        const secret = decryptStaffMfaSecret(encryptedSecret, userId, keyRing);
        const matchedStep = verifyStaffTotpCode(secret, code);
        if (matchedStep === null) return false;

        const result = await prisma.user.updateMany({
            where: {
                id: userId,
                staffMfaSecretEncrypted: encryptedSecret,
                staffMfaEnrolledAt: { not: null },
                OR: [
                    { staffMfaLastUsedStep: null },
                    { staffMfaLastUsedStep: { lt: matchedStep } },
                ],
            },
            data: {
                staffMfaLastUsedStep: matchedStep,
                staffMfaSecretEncrypted: encryptStaffMfaSecret(secret, userId, keyRing),
            },
        });
        return result.count === 1;
    } catch {
        return false;
    }
}
