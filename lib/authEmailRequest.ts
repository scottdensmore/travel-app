import { NextResponse } from 'next/server';
import { consumeAuthRateLimit } from '@/lib/authRateLimit';
import {
    getTrustedClientAddressFromHeaders,
    hasTrustedProxyConfiguration,
} from '@/lib/clientAddress';
import {
    authEmailRequestSchema,
    InputValidationError,
    MAX_REGISTRATION_BYTES,
    parseJsonRequest,
    validationErrorPayload,
} from '@/lib/validation';
import { scheduleAfterResponse } from '@/lib/afterResponse';

const ACCEPTED_RESPONSE = {
    message: 'If the account is eligible, an email will be sent shortly.'
};

export async function handleAuthEmailRequest(
    request: Request,
    action: 'verify-request' | 'reset-request',
    operation: (email: string) => Promise<void>
) {
    try {
        const { email } = await parseJsonRequest(
            request,
            authEmailRequestSchema,
            MAX_REGISTRATION_BYTES
        );
        const clientAddress = getTrustedClientAddressFromHeaders(request.headers);
        if (hasTrustedProxyConfiguration() && !clientAddress) {
            return NextResponse.json({
                error: {
                    code: 'INVALID_CLIENT_SOURCE',
                    message: 'Unable to process this account request.',
                    fields: {},
                }
            }, { status: 400 });
        }

        const emailLimit = await consumeAuthRateLimit(`${action}-email`, email, {
            limit: 3,
            windowSeconds: 60 * 60,
        });
        const sourceLimit = clientAddress
            ? await consumeAuthRateLimit(`${action}-source`, clientAddress, {
                limit: 20,
                windowSeconds: 60 * 60,
            })
            : { allowed: true, retryAfterSeconds: 0 };
        if (!emailLimit.allowed || !sourceLimit.allowed) {
            const retryAfterSeconds = Math.max(
                emailLimit.retryAfterSeconds,
                sourceLimit.retryAfterSeconds
            );
            return NextResponse.json({
                error: {
                    code: 'RATE_LIMITED',
                    message: 'Too many account requests. Please try again later.',
                    fields: {},
                }
            }, {
                status: 429,
                headers: { 'Retry-After': String(retryAfterSeconds) },
            });
        }

        scheduleAfterResponse(async () => {
            try {
                await operation(email);
            } catch {
                // The response remains generic so delivery and account state cannot
                // become an enumeration oracle. Users can safely retry later.
                console.error('Unable to deliver requested authentication email.');
            }
        });
        return NextResponse.json(ACCEPTED_RESPONSE, { status: 202 });
    } catch (error) {
        if (error instanceof InputValidationError) {
            return NextResponse.json(validationErrorPayload(error), {
                status: error.message === 'Request is too large.' ? 413 : 400,
            });
        }
        console.error('Unable to process authentication email request.');
        return NextResponse.json({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Unable to process this account request right now.',
                fields: {},
            }
        }, { status: 500 });
    }
}
