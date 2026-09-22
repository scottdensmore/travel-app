/** @jest-environment node */
import { sendNotificationEmail, NotificationEmailInput } from '@/lib/notificationEmail';

describe('notification email delivery', () => {
    const sampleInput: NotificationEmailInput = {
        to: 'traveler@example.com',
        title: 'Flight Delay Alert',
        message: 'Your flight MO-123 is delayed by 45 minutes.',
    };

    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: jest.fn().mockResolvedValue('OK'),
        });
        process.env.AUTH_EMAIL_FROM = 'Mona Airways <no-reply@travel.example.com>';
        process.env.AUTH_EMAIL_PROVIDER = 'mailpit';
        process.env.AUTH_EMAIL_API_URL = 'http://127.0.0.1:8025/api/v1/send';
        process.env.NEXTAUTH_URL = 'http://localhost:3000';
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('sends notification email via Mailpit with correct payload, subject, and body', async () => {
        await sendNotificationEmail(sampleInput);

        expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:8025/api/v1/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: expect.any(String),
            signal: expect.any(AbortSignal),
        });

        const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(payload).toEqual({
            From: { Email: 'no-reply@travel.example.com', Name: 'Mona Airways' },
            To: [{ Email: 'traveler@example.com' }],
            Subject: 'Mona Airways: Flight Delay Alert',
            Text: expect.stringContaining('Flight Delay Alert\n\nYour flight MO-123 is delayed by 45 minutes.\n\n---\nManage your notification preferences at: http://localhost:3000/profile/notifications'),
        });
    });

    it('normalizes NEXTAUTH_URL with trailing slash without duplicating slashes', async () => {
        process.env.NEXTAUTH_URL = 'http://localhost:3000/';
        await sendNotificationEmail(sampleInput);

        const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(payload.Text).toContain('http://localhost:3000/profile/notifications');
        expect(payload.Text).not.toContain('http://localhost:3000//profile/notifications');
    });

    it('handles simple email address without display name in AUTH_EMAIL_FROM for Mailpit', async () => {
        process.env.AUTH_EMAIL_FROM = 'no-reply@travel.example.com';
        await sendNotificationEmail(sampleInput);

        const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(payload.From).toEqual({ Email: 'no-reply@travel.example.com' });
    });

    it('throws error when Mailpit HTTP response is not ok', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 500,
        });

        await expect(sendNotificationEmail(sampleInput)).rejects.toThrow(
            'Mailpit delivery failed with HTTP 500'
        );
    });

    it('sends notification email via Postmark with token and outbound stream', async () => {
        process.env.AUTH_EMAIL_PROVIDER = 'postmark';
        process.env.AUTH_EMAIL_API_URL = 'https://api.postmarkapp.com/email';
        process.env.AUTH_EMAIL_POSTMARK_SERVER_TOKEN = 'pm-server-token-123';

        await sendNotificationEmail(sampleInput);

        expect(global.fetch).toHaveBeenCalledWith('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Postmark-Server-Token': 'pm-server-token-123',
            },
            body: expect.any(String),
            signal: expect.any(AbortSignal),
        });

        const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(payload).toEqual({
            From: 'Mona Airways <no-reply@travel.example.com>',
            To: 'traveler@example.com',
            Subject: 'Mona Airways: Flight Delay Alert',
            TextBody: expect.stringContaining('Flight Delay Alert\n\nYour flight MO-123 is delayed by 45 minutes.'),
            MessageStream: 'outbound',
        });
    });

    it('throws error when Postmark HTTP response is not ok with error body', async () => {
        process.env.AUTH_EMAIL_PROVIDER = 'postmark';
        process.env.AUTH_EMAIL_API_URL = 'https://api.postmarkapp.com/email';
        process.env.AUTH_EMAIL_POSTMARK_SERVER_TOKEN = 'pm-server-token-123';

        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 422,
            text: jest.fn().mockResolvedValue('Invalid recipient address'),
        });

        await expect(sendNotificationEmail(sampleInput)).rejects.toThrow(
            'Postmark delivery failed with HTTP 422: Invalid recipient address'
        );
    });

    it('throws when AUTH_EMAIL_API_URL is missing', async () => {
        delete process.env.AUTH_EMAIL_API_URL;

        await expect(sendNotificationEmail(sampleInput)).rejects.toThrow(
            'Missing email setting: AUTH_EMAIL_API_URL'
        );
    });

    it('throws when AUTH_EMAIL_PROVIDER is invalid', async () => {
        process.env.AUTH_EMAIL_PROVIDER = 'sendgrid';

        await expect(sendNotificationEmail(sampleInput)).rejects.toThrow(
            'AUTH_EMAIL_PROVIDER must be mailpit or postmark'
        );
    });
});
