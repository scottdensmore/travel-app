/** @jest-environment node */
import {
    decryptEmergencyContact,
    decryptKtn,
    decryptPassengerData,
    decryptRedressNumber,
    EmergencyContact,
    encryptEmergencyContact,
    encryptKtn,
    encryptPassengerData,
    encryptRedressNumber,
    getPassengerDataRetentionDeadline,
    parsePassengerDataEncryptionKeys,
    safePassengerSelect,
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
        // Flip a bit in the decoded ciphertext rather than rewriting the final
        // base64url character. That character carries unused low bits, so
        // swapping 'A' for 'B' there can decode to identical bytes and tamper
        // with nothing, letting the decryption succeed.
        const ciphertext = Buffer.from(parts[3], 'base64url');
        ciphertext[0] ^= 0xff;
        parts[3] = ciphertext.toString('base64url');

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

    it('encrypts and decrypts KTN with authenticated passenger context', () => {
        const keys = parsePassengerDataEncryptionKeys(`active:${ACTIVE_KEY}`);
        const context = { passengerId: 'passenger-1', field: 'ktn' as const };
        const encrypted = encryptPassengerData('987654321', context, keys);

        expect(encrypted).toMatch(/^v1:active:/);
        expect(encrypted).not.toContain('987654321');
        expect(decryptPassengerData(encrypted, context, keys)).toBe('987654321');

        const helperEncrypted = encryptKtn('987654321', { passengerId: 'passenger-1' }, keys);
        expect(decryptKtn(helperEncrypted, { passengerId: 'passenger-1' }, keys)).toBe('987654321');

        expect(() => decryptPassengerData(encrypted, { passengerId: 'passenger-2', field: 'ktn' }, keys))
            .toThrow('Unable to decrypt passenger data');
    });

    it('encrypts and decrypts Redress Number with authenticated passenger context', () => {
        const keys = parsePassengerDataEncryptionKeys(`active:${ACTIVE_KEY}`);
        const context = { passengerId: 'passenger-1', field: 'redressNumber' as const };
        const encrypted = encryptPassengerData('1234567', context, keys);

        expect(encrypted).toMatch(/^v1:active:/);
        expect(encrypted).not.toContain('1234567');
        expect(decryptPassengerData(encrypted, context, keys)).toBe('1234567');

        const helperEncrypted = encryptRedressNumber('1234567', { passengerId: 'passenger-1' }, keys);
        expect(decryptRedressNumber(helperEncrypted, { passengerId: 'passenger-1' }, keys)).toBe('1234567');

        expect(() => decryptPassengerData(encrypted, { passengerId: 'passenger-2', field: 'redressNumber' }, keys))
            .toThrow('Unable to decrypt passenger data');
    });

    it('encrypts and decrypts Emergency Contact with authenticated passenger context', () => {
        const keys = parsePassengerDataEncryptionKeys(`active:${ACTIVE_KEY}`);
        const contact: EmergencyContact = {
            name: 'Jane Doe',
            relationship: 'Spouse',
            phone: '+1 555-0199',
        };
        const context = { passengerId: 'passenger-1', field: 'emergencyContact' as const };
        const encrypted = encryptPassengerData(JSON.stringify(contact), context, keys);

        expect(encrypted).toMatch(/^v1:active:/);
        expect(encrypted).not.toContain('Jane Doe');
        expect(JSON.parse(decryptPassengerData(encrypted, context, keys))).toEqual(contact);

        const helperEncrypted = encryptEmergencyContact(contact, { passengerId: 'passenger-1' }, keys);
        expect(decryptEmergencyContact(helperEncrypted, { passengerId: 'passenger-1' }, keys)).toEqual(contact);

        expect(() => decryptPassengerData(encrypted, { passengerId: 'passenger-2', field: 'emergencyContact' }, keys))
            .toThrow('Unable to decrypt passenger data');
    });

    it('excludes KTN, Redress Number, and Emergency Contact from routine projections', () => {
        expect(safePassengerSelect).toEqual({
            id: true,
            firstName: true,
            lastName: true,
            gender: true,
        });
        expect(safePassengerSelect).not.toHaveProperty('ktnEncrypted');
        expect(safePassengerSelect).not.toHaveProperty('redressNumberEncrypted');
        expect(safePassengerSelect).not.toHaveProperty('emergencyContactEncrypted');
    });
});
