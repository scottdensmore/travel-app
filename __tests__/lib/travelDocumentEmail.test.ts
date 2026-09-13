/** @jest-environment node */
import {
    formatTravelDocumentsEmailText,
    sendTravelDocumentsEmail,
    TravelDocumentEmailInput,
} from '@/lib/travelDocumentEmail';

describe('travel document email delivery', () => {
    const sampleInput: TravelDocumentEmailInput = {
        to: 'ada@example.com',
        bookingReference: 'BOOKING-123',
        airline: 'Mona Airways',
        flightNumber: 'MO-456',
        from: 'Seattle, USA',
        toDestination: 'Detroit, USA',
        departureReadable: 'Aug 19, 2026 at 08:00 PDT',
        passengers: [
            {
                name: 'Ada Lovelace',
                seat: '11A',
                cabin: 'Economy',
            },
            {
                name: 'Grace Hopper',
                seat: '11B',
                cabin: 'Economy',
            },
        ],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
        process.env.AUTH_EMAIL_FROM = 'Mona Airways <no-reply@travel.example.com>';
        process.env.AUTH_EMAIL_PROVIDER = 'postmark';
        process.env.AUTH_EMAIL_API_URL = 'https://api.postmarkapp.com/email';
        process.env.AUTH_EMAIL_API_TOKEN = 'server-token';
    });

    it('formats plain-text email with all boarding pass details', () => {
        const text = formatTravelDocumentsEmailText(sampleInput);

        expect(text).toContain('MO-456');
        expect(text).toContain('BOOKING-123');
        expect(text).toContain('Seattle, USA to Detroit, USA');
        expect(text).toContain('Aug 19, 2026 at 08:00 PDT');
        expect(text).toContain('Ada Lovelace');
        expect(text).toContain('11A');
        expect(text).toContain('Grace Hopper');
        expect(text).toContain('11B');
        expect(text).toContain('Economy');
    });

    it('sends travel documents via Postmark with correct payload structure, subject, and body', async () => {
        await sendTravelDocumentsEmail(sampleInput);

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
            Subject: 'Your Boarding Pass: Mona Airways MO-456 (BOOKING-123)',
            MessageStream: 'outbound',
        });
        expect(payload.Subject).toContain('MO-456');
        expect(payload.Subject).toContain('BOOKING-123');
        expect(payload.TextBody).toContain('MO-456');
        expect(payload.TextBody).toContain('BOOKING-123');
        expect(payload.TextBody).toContain('Seattle, USA to Detroit, USA');
        expect(payload.TextBody).toContain('11A');
        expect(payload.TextBody).toContain('11B');
    });

    it('sends travel documents via Mailpit with correct payload structure', async () => {
        process.env.AUTH_EMAIL_PROVIDER = 'mailpit';
        process.env.AUTH_EMAIL_API_URL = 'http://127.0.0.1:8025/api/v1/send';
        delete process.env.AUTH_EMAIL_API_TOKEN;

        await sendTravelDocumentsEmail(sampleInput);

        const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('http://127.0.0.1:8025/api/v1/send');
        expect(options.headers).toEqual({
            Accept: 'application/json',
            'Content-Type': 'application/json',
        });
        const payload = JSON.parse(options.body);
        expect(payload).toMatchObject({
            From: { Email: 'no-reply@travel.example.com', Name: 'Mona Airways' },
            To: [{ Email: 'ada@example.com' }],
            Subject: 'Your Boarding Pass: Mona Airways MO-456 (BOOKING-123)',
        });
        expect(payload.Text).toContain('MO-456');
        expect(payload.Text).toContain('Seattle, USA to Detroit, USA');
        expect(payload.Text).toContain('11A');
        expect(payload.Text).toContain('BOOKING-123');
    });

    it('refuses to send Postmark credentials over plaintext HTTP', async () => {
        process.env.AUTH_EMAIL_API_URL = 'http://api.postmarkapp.com/email';

        await expect(sendTravelDocumentsEmail(sampleInput)).rejects.toThrow(
            'Postmark delivery requires HTTPS',
        );
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('refuses to send Postmark credentials to a non-Postmark host', async () => {
        process.env.AUTH_EMAIL_API_URL = 'https://example.com/email';

        await expect(sendTravelDocumentsEmail(sampleInput)).rejects.toThrow(
            'official email API endpoint',
        );
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('fails when the provider rejects delivery', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 422 });

        await expect(sendTravelDocumentsEmail(sampleInput)).rejects.toThrow(
            'rejected delivery (422)',
        );
    });
});
