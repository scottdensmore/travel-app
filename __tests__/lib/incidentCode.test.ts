import { generateIncidentCode } from '@/lib/incidentCode';

describe('generateIncidentCode', () => {
    it('uses and sanitizes Next.js error digest deterministically', () => {
        const errorWithDigest = Object.assign(new Error('Server Error'), {
            digest: '1234567890',
        });
        expect(generateIncidentCode(errorWithDigest)).toBe('ERR-1234567890');
    });

    it('sanitizes non-alphanumeric characters from digest', () => {
        const errorWithDigest = Object.assign(new Error('Server Error'), {
            digest: 'srv-err-994821',
        });
        expect(generateIncidentCode(errorWithDigest)).toBe('ERR-SRVERR9948');
    });

    it('pads short digests to at least 6 characters', () => {
        const errorWithDigest = Object.assign(new Error('Server Error'), {
            digest: 'abc',
        });
        expect(generateIncidentCode(errorWithDigest)).toBe('ERR-ABC000');
    });

    it('generates deterministic uppercase hex code when digest is absent', () => {
        const err1 = new Error('Database query timed out');
        const code1 = generateIncidentCode(err1);
        expect(code1).toMatch(/^ERR-[A-F0-9]{8}$/);

        // Same error produces same deterministic code
        const code2 = generateIncidentCode(err1);
        expect(code2).toBe(code1);
    });

    it('never leaks raw sensitive strings into the incident reference code', () => {
        const sensitiveErr = new Error('SELECT * FROM credit_cards WHERE cvv = "123" at /var/secrets.key');
        const code = generateIncidentCode(sensitiveErr);

        expect(code).toMatch(/^ERR-[A-F0-9]{8}$/);
        expect(code).not.toContain('SELECT');
        expect(code).not.toContain('cvv');
        expect(code).not.toContain('secrets');
    });

    it('handles null/undefined gracefully', () => {
        expect(generateIncidentCode(null)).toMatch(/^ERR-[A-F0-9]{8}$/);
        expect(generateIncidentCode(undefined)).toMatch(/^ERR-[A-F0-9]{8}$/);
    });
});
