/** @jest-environment node */
import {
    decryptPassengerData,
    encryptPassengerData,
    getPassengerDataRetentionDeadline,
    parsePassengerDataEncryptionKeys,
} from '@/lib/passengerDataProtection';

const ACTIVE_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const OLD_KEY = Buffer.from('abcdef0123456789abcdef0123456789').toString('base64');

describe('passenger data protection', () => {
    it('encrypts with AES-GCM and decrypts with authenticated passenger context', () => {
        const keys = parsePassengerDataEncryptionKeys(`active:${ACTIVE_KEY}`);
        const context = { passengerId: 'passenger-1', field: 'passportNumber' as const };

        const encrypted = encryptPassengerData('US123456', context, keys);

        expect(encrypted).toMatch(/^v1:active:/);
        expect(encrypted).not.toContain('US123456');
        expect(decryptPassengerData(encrypted, context, keys)).toBe('US123456');
        expect(() => decryptPassengerData(encrypted, {
            passengerId: 'passenger-2',
            field: 'passportNumber',
        }, keys)).toThrow('Unable to decrypt passenger data');
    });

    it('uses a fresh IV for every encrypted value', () => {
        const keys = parsePassengerDataEncryptionKeys(`active:${ACTIVE_KEY}`);
        const context = { passengerId: 'passenger-1', field: 'dateOfBirth' as const };

        expect(encryptPassengerData('1990-01-01', context, keys))
            .not.toBe(encryptPassengerData('1990-01-01', context, keys));
    });

    it('rejects tampered ciphertext', () => {
        const keys = parsePassengerDataEncryptionKeys(`active:${ACTIVE_KEY}`);
        const context = { passengerId: 'passenger-1', field: 'passportNumber' as const };
        const encrypted = encryptPassengerData('US123456', context, keys);
        const parts = encrypted.split(':');
        parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith('A') ? 'B' : 'A'}`;

        expect(() => decryptPassengerData(parts.join(':'), context, keys))
            .toThrow('Unable to decrypt passenger data');
    });

    it('writes with the active key and reads values written by retained rotation keys', () => {
        const oldOnly = parsePassengerDataEncryptionKeys(`old:${OLD_KEY}`);
        const rotated = parsePassengerDataEncryptionKeys(`active:${ACTIVE_KEY},old:${OLD_KEY}`);
        const context = { passengerId: 'passenger-1', field: 'passportNumber' as const };
        const oldCiphertext = encryptPassengerData('US123456', context, oldOnly);

        expect(encryptPassengerData('US123456', context, rotated)).toMatch(/^v1:active:/);
        expect(decryptPassengerData(oldCiphertext, context, rotated)).toBe('US123456');
    });

    it.each([
        '',
        'missing-separator',
        `bad id:${ACTIVE_KEY}`,
        `wildcard_key:${ACTIVE_KEY}`,
        'short:c2hvcnQ=',
        `duplicate:${ACTIVE_KEY},duplicate:${OLD_KEY}`,
    ])('rejects an invalid key ring: %s', (value) => {
        expect(() => parsePassengerDataEncryptionKeys(value)).toThrow();
    });

    it('expires sensitive data thirty days after departure', () => {
        expect(getPassengerDataRetentionDeadline(new Date('2026-08-01T10:00:00.000Z')))
            .toEqual(new Date('2026-08-31T10:00:00.000Z'));
    });
});
