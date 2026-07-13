/** @jest-environment node */
jest.mock('@/lib/authAccountFlows', () => ({
    verifyEmail: jest.fn(),
    resetPassword: jest.fn(),
}));

import { POST as confirmEmail } from '@/app/api/auth/verification/confirm/route';
import { POST as confirmReset } from '@/app/api/auth/password/reset/route';
import { resetPassword, verifyEmail } from '@/lib/authAccountFlows';

const requestFor = (path: string, body: unknown) => new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
});

describe('authentication token confirmation routes', () => {
    beforeEach(() => jest.clearAllMocks());

    it('confirms a verification token only once', async () => {
        (verifyEmail as jest.Mock).mockResolvedValue(true);
        const token = 'a'.repeat(43);

        const response = await confirmEmail(requestFor('/api/auth/verification/confirm', { token }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ message: 'Your email has been verified.' });
        expect(verifyEmail).toHaveBeenCalledWith(token);
    });

    it('uses a safe error for an invalid or expired verification token', async () => {
        (verifyEmail as jest.Mock).mockResolvedValue(false);
        const response = await confirmEmail(requestFor(
            '/api/auth/verification/confirm',
            { token: 'a'.repeat(43) }
        ));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            error: { code: 'INVALID_OR_EXPIRED_TOKEN' }
        });
    });

    it('resets a password with a valid one-time token', async () => {
        (resetPassword as jest.Mock).mockResolvedValue(true);
        const token = 'b'.repeat(43);

        const response = await confirmReset(requestFor('/api/auth/password/reset', {
            token,
            password: 'NewPassword123!',
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ message: 'Your password has been reset.' });
        expect(resetPassword).toHaveBeenCalledWith(token, 'NewPassword123!');
    });

    it('validates reset passwords before consuming a token', async () => {
        const response = await confirmReset(requestFor('/api/auth/password/reset', {
            token: 'b'.repeat(43),
            password: 'short',
        }));

        expect(response.status).toBe(400);
        expect(resetPassword).not.toHaveBeenCalled();
    });
});
