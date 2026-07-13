/** @jest-environment node */
import { getTrustedClientAddress, hasTrustedProxyConfiguration } from '@/lib/clientAddress';

describe('trusted client address resolution', () => {
    it('ignores forwarding input when no trusted proxy contract is configured', () => {
        expect(getTrustedClientAddress('198.51.100.1', '0')).toBeNull();
        expect(hasTrustedProxyConfiguration('0')).toBe(false);
    });

    it('selects from the trusted right side of the forwarding chain', () => {
        expect(getTrustedClientAddress('spoofed, 203.0.113.9', '1')).toBe('203.0.113.9');
        expect(getTrustedClientAddress('client, proxy-one, proxy-two', '2')).toBe('proxy-one');
    });

    it('rejects malformed configuration and incomplete chains', () => {
        expect(getTrustedClientAddress('203.0.113.9', 'many')).toBeNull();
        expect(getTrustedClientAddress('203.0.113.9', '2')).toBeNull();
        expect(hasTrustedProxyConfiguration('6')).toBe(false);
    });
});
