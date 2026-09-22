type EmailProvider = 'mailpit' | 'postmark';

function requireSetting(name: string): string {
    const value = (name === 'AUTH_EMAIL_POSTMARK_SERVER_TOKEN'
        ? (process.env.AUTH_EMAIL_POSTMARK_SERVER_TOKEN || process.env.AUTH_EMAIL_API_TOKEN)
        : process.env[name])?.trim();
    if (!value) throw new Error(`Missing email setting: ${name}`);
    return value;
}

function provider(): EmailProvider {
    const value = process.env.AUTH_EMAIL_PROVIDER?.trim() || 'mailpit';
    if (value !== 'mailpit' && value !== 'postmark') {
        throw new Error('AUTH_EMAIL_PROVIDER must be mailpit or postmark');
    }
    return value;
}

function mailpitSender(value: string): { Email: string; Name?: string } {
    const namedAddress = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
    if (namedAddress) {
        return {
            Email: namedAddress[2].trim(),
            ...(namedAddress[1].trim() ? { Name: namedAddress[1].trim() } : {}),
        };
    }
    return { Email: value };
}

export interface NotificationEmailInput {
    to: string;
    title: string;
    message: string;
}

export async function sendNotificationEmail(input: NotificationEmailInput): Promise<void> {
    const selectedProvider = provider();
    const endpoint = requireSetting('AUTH_EMAIL_API_URL');
    const sender = process.env.AUTH_EMAIL_FROM?.trim() || 'Mona Airways <no-reply@localhost>';
    const appUrl = process.env.NEXTAUTH_URL?.trim() || 'http://localhost:3000';
    const notificationsUrl = new URL('/profile/notifications', appUrl).toString();

    const subject = `Mona Airways: ${input.title}`;
    const textBody = [
        input.title,
        '',
        input.message,
        '',
        '---',
        `Manage your notification preferences at: ${notificationsUrl}`,
    ].join('\n');

    if (selectedProvider === 'mailpit') {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                From: mailpitSender(sender),
                To: [{ Email: input.to }],
                Subject: subject,
                Text: textBody,
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            throw new Error(`Mailpit delivery failed with HTTP ${response.status}`);
        }
        return;
    }

    if (selectedProvider === 'postmark') {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Postmark-Server-Token': requireSetting('AUTH_EMAIL_POSTMARK_SERVER_TOKEN'),
            },
            body: JSON.stringify({
                From: sender,
                To: input.to,
                Subject: subject,
                TextBody: textBody,
                MessageStream: 'outbound',
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Postmark delivery failed with HTTP ${response.status}: ${body}`);
        }
    }
}
