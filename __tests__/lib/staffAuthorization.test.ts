/** @jest-environment node */
import { hasVerifiedStaffAccess } from '@/lib/staffAuthorization';

describe('staff authorization', () => {
    it('requires both the ADMIN role and a verified second factor', () => {
        expect(hasVerifiedStaffAccess(null)).toBe(false);
        expect(hasVerifiedStaffAccess({ user: { role: 'USER', staffMfaVerified: true } } as never)).toBe(false);
        expect(hasVerifiedStaffAccess({ user: { role: 'ADMIN', staffMfaVerified: false } } as never)).toBe(false);
        expect(hasVerifiedStaffAccess({ user: { role: 'ADMIN', staffMfaVerified: true } } as never)).toBe(true);
    });
});
