import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import {
    InputValidationError,
    MAX_REGISTRATION_BYTES,
    parseJsonRequest,
    registrationSchema,
    validationErrorPayload
} from '@/lib/validation';
import { consumeAuthRateLimit } from '@/lib/authRateLimit';
import {
    getTrustedClientAddressFromHeaders,
    hasTrustedProxyConfiguration
} from '@/lib/clientAddress';

const ACCEPTED_RESPONSE = {
    message: 'If this address can be registered, the request has been accepted.'
};

export async function POST(req: Request) {
    try {
        const { name, email, password } = await parseJsonRequest(
            req,
            registrationSchema,
            MAX_REGISTRATION_BYTES
        );

        const clientAddress = getTrustedClientAddressFromHeaders(req.headers);
        if (hasTrustedProxyConfiguration() && !clientAddress) {
            return NextResponse.json({
                error: {
                    code: 'INVALID_CLIENT_SOURCE',
                    message: 'Unable to process this account request.',
                    fields: {}
                }
            }, { status: 400 });
        }

        const emailLimit = await consumeAuthRateLimit(
            'register-email', email, { limit: 3, windowSeconds: 60 * 60 }
        );
        const addressLimit = clientAddress
            ? await consumeAuthRateLimit(
                'register-address', clientAddress, { limit: 50, windowSeconds: 60 * 60 }
            )
            : { allowed: true, retryAfterSeconds: 0 };
        if (!emailLimit.allowed || !addressLimit.allowed) {
            const retryAfterSeconds = Math.max(emailLimit.retryAfterSeconds, addressLimit.retryAfterSeconds);
            return NextResponse.json({
                error: {
                    code: 'RATE_LIMITED',
                    message: 'Too many account requests. Please try again later.',
                    fields: {}
                }
            }, {
                status: 429,
                headers: { 'Retry-After': String(retryAfterSeconds) }
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return NextResponse.json(ACCEPTED_RESPONSE, { status: 202 });
        }

        try {
            await prisma.user.create({
                data: { name, email, password: hashedPassword },
            });
        } catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) {
                throw error;
            }
        }

        return NextResponse.json(ACCEPTED_RESPONSE, { status: 202 });
    } catch (error) {
        if (error instanceof InputValidationError) {
            return NextResponse.json(
                validationErrorPayload(error),
                { status: error.message === 'Request is too large.' ? 413 : 400 }
            );
        }
        // Log server-side; do not leak internal error details to the client.
        console.error('Error registering user:', error);
        return NextResponse.json({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Unable to create your account right now.',
                fields: {}
            }
        }, { status: 500 });
    }
}
