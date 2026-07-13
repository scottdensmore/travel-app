type AuthEmailProvider = 'mailpit' | 'postmark';

function requireSetting(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing authentication email setting: ${name}`);
    return value;
}

function provider(): AuthEmailProvider {
    const value = requireSetting('AUTH_EMAIL_PROVIDER');
    if (value !== 'mailpit' && value !== 'postmark') {
        throw new Error('AUTH_EMAIL_PROVIDER must be mailpit or postmark');
    }
    return value;
}

function authLink(pathname: string, token: string): string {
    const link = new URL(pathname, requireSetting('NEXTAUTH_URL'));
    if (process.env.AUTH_EMAIL_PROVIDER?.trim() === 'postmark' && link.protocol !== 'https:') {
        throw new Error('Postmark recovery links require an HTTPS application URL.');
    }
    link.hash = new URLSearchParams({ token }).toString();
    return link.toString();
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

async function sendAuthEmail(input: {
    to: string;
    subject: string;
    introduction: string;
    action: string;
    link: string;
    expiry: string;
}) {
    const text = [
        input.introduction,
        '',
        `${input.action}: ${input.link}`,
        '',
        input.expiry,
        'If you did not request this, you can ignore this email.',
    ].join('\n');
    const selectedProvider = provider();
    const endpoint = requireSetting('AUTH_EMAIL_API_URL');
    const endpointUrl = new URL(endpoint);
    if (selectedProvider === 'postmark' && endpointUrl.protocol !== 'https:') {
        throw new Error('Postmark delivery requires HTTPS.');
    }
    if (selectedProvider === 'postmark'
        && (endpointUrl.hostname !== 'api.postmarkapp.com' || endpointUrl.pathname !== '/email')) {
        throw new Error('Postmark delivery requires the official email API endpoint.');
    }
    const from = requireSetting('AUTH_EMAIL_FROM');
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
    const body = selectedProvider === 'postmark'
        ? {
            From: from,
            To: input.to,
            Subject: input.subject,
            TextBody: text,
            MessageStream: 'outbound',
        }
        : {
            From: mailpitSender(from),
            To: [{ Email: input.to }],
            Subject: input.subject,
            Text: text,
        };

    if (selectedProvider === 'postmark') {
        headers['X-Postmark-Server-Token'] = requireSetting('AUTH_EMAIL_API_TOKEN');
    }
    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
        throw new Error(`Authentication email provider rejected delivery (${response.status}).`);
    }
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
    await sendAuthEmail({
        to: email,
        subject: 'Verify your Mona Airways email',
        introduction: 'Confirm your email before signing in to Mona Airways.',
        action: 'Verify email',
        link: authLink('/verify-email', token),
        expiry: 'This link expires in 24 hours.',
    });
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
    await sendAuthEmail({
        to: email,
        subject: 'Reset your Mona Airways password',
        introduction: 'A password reset was requested for your Mona Airways account.',
        action: 'Reset password',
        link: authLink('/reset-password', token),
        expiry: 'This link expires in 1 hour and can be used once.',
    });
}
