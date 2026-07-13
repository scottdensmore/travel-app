/** @jest-environment node */
import { sendPasswordResetEmail, sendVerificationEmail } from '@/lib/authEmail';

describe('authentication email delivery', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
        process.env.NEXTAUTH_URL = 'https://travel.example.com';
        process.env.AUTH_EMAIL_FROM = 'Mona Airways <no-reply@travel.example.com>';
        process.env.AUTH_EMAIL_PROVIDER = 'postmark';
        process.env.AUTH_EMAIL_API_URL = 'https://api.postmarkapp.com/email';
        process.env.AUTH_EMAIL_API_TOKEN = 'server-token';
    });

    it('sends a verification link through the transactional provider without putting the token in the subject', async () => {
        await sendVerificationEmail('ada@example.com', 'verification-token');

        expect(global.fetch).toHaveBeenCalledWith('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Postmark-Server-Token': 'server-token',
            },
            body: expect.any(String),
            signal: expect.any(AbortSignal),
        });
        const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(payload).toMatchObject({
            From: 'Mona Airways <no-reply@travel.example.com>',
            To: 'ada@example.com',
            Subject: 'Verify your Mona Airways email',
            TextBody: expect.stringContaining(
                'https://travel.example.com/verify-email#token=verification-token'
            ),
            MessageStream: 'outbound',
        });
        expect(payload.Subject).not.toContain('verification-token');
    });

    it('sends a time-limited password reset link', async () => {
        await sendPasswordResetEmail('ada@example.com', 'reset-token');

        const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(payload.Subject).toBe('Reset your Mona Airways password');
        expect(payload.TextBody).toContain(
            'https://travel.example.com/reset-password#token=reset-token'
        );
    });

    it('refuses to send Postmark credentials over plaintext HTTP', async () => {
        process.env.AUTH_EMAIL_API_URL = 'http://api.postmarkapp.com/email';

        await expect(sendVerificationEmail('ada@example.com', 'token'))
            .rejects.toThrow('Postmark delivery requires HTTPS');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('refuses to deliver a public Postmark recovery link over HTTP', async () => {
        process.env.NEXTAUTH_URL = 'http://travel.example.com';

        await expect(sendPasswordResetEmail('ada@example.com', 'token'))
            .rejects.toThrow('Postmark recovery links require an HTTPS application URL');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('refuses to send Postmark credentials to a non-Postmark host', async () => {
        process.env.AUTH_EMAIL_API_URL = 'https://example.com/email';

        await expect(sendVerificationEmail('ada@example.com', 'token'))
            .rejects.toThrow('official email API endpoint');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('uses Mailpit HTTP delivery for the loopback-only local inbox', async () => {
        process.env.AUTH_EMAIL_PROVIDER = 'mailpit';
        process.env.AUTH_EMAIL_API_URL = 'http://127.0.0.1:8025/api/v1/send';
        delete process.env.AUTH_EMAIL_API_TOKEN;

        await sendVerificationEmail('ada@example.com', 'token');

        const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('http://127.0.0.1:8025/api/v1/send');
        expect(options.headers).toEqual({
            Accept: 'application/json',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(options.body)).toMatchObject({
            From: { Email: 'no-reply@travel.example.com', Name: 'Mona Airways' },
            To: [{ Email: 'ada@example.com' }],
            Subject: 'Verify your Mona Airways email',
        });
    });

    it('fails when the provider rejects delivery', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 422 });

        await expect(sendVerificationEmail('ada@example.com', 'token'))
            .rejects.toThrow('Authentication email provider rejected delivery (422).');
    });
});
