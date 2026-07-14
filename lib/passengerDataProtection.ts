import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const RETENTION_DAYS = 30;
// Rotation uses the envelope prefix in a SQL LIKE-backed `startsWith` filter,
// so key IDs must not contain LIKE wildcards such as `_` or `%`.
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type PassengerSensitiveField = 'dateOfBirth' | 'passportNumber';

export interface PassengerDataContext {
    passengerId: string;
    field: PassengerSensitiveField;
}

export interface PassengerDataEncryptionKeys {
    activeKeyId: string;
    keys: ReadonlyMap<string, Buffer>;
}

function configurationError(message: string): Error {
    return new Error(`PASSENGER_DATA_ENCRYPTION_KEYS ${message}`);
}

export function parsePassengerDataEncryptionKeys(value: string): PassengerDataEncryptionKeys {
    const entries = value.trim().split(',').map(entry => entry.trim()).filter(Boolean);
    if (entries.length === 0) {
        throw configurationError('must contain at least one key');
    }

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

export function getConfiguredPassengerDataEncryptionKeys(): PassengerDataEncryptionKeys {
    return parsePassengerDataEncryptionKeys(process.env.PASSENGER_DATA_ENCRYPTION_KEYS ?? '');
}

function additionalAuthenticatedData(context: PassengerDataContext): Buffer {
    return Buffer.from(`travel-app:passenger:${context.passengerId}:${context.field}`, 'utf8');
}

export function encryptPassengerData(
    plaintext: string,
    context: PassengerDataContext,
    keyRing = getConfiguredPassengerDataEncryptionKeys(),
): string {
    const key = keyRing.keys.get(keyRing.activeKeyId);
    if (!key) throw configurationError('does not contain its active key');

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(additionalAuthenticatedData(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
        ENVELOPE_VERSION,
        keyRing.activeKeyId,
        iv.toString('base64url'),
        ciphertext.toString('base64url'),
        authTag.toString('base64url'),
    ].join(':');
}

export function decryptPassengerData(
    envelope: string,
    context: PassengerDataContext,
    keyRing = getConfiguredPassengerDataEncryptionKeys(),
): string {
    try {
        const [version, keyId, encodedIv, encodedCiphertext, encodedAuthTag, ...extra] = envelope.split(':');
        if (version !== ENVELOPE_VERSION || extra.length > 0) throw new Error('Invalid envelope');
        const key = keyRing.keys.get(keyId);
        if (!key) throw new Error('Unknown key');
        const iv = Buffer.from(encodedIv, 'base64url');
        const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
        const authTag = Buffer.from(encodedAuthTag, 'base64url');
        if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) throw new Error('Invalid envelope');

        const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
        decipher.setAAD(additionalAuthenticatedData(context));
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
        throw new Error('Unable to decrypt passenger data');
    }
}

export function getPassengerDataRetentionDeadline(departureDate: Date): Date {
    return new Date(departureDate.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1_000);
}
