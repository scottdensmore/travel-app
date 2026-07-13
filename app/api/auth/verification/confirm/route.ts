import { NextResponse } from 'next/server';
import { verifyEmail } from '@/lib/authAccountFlows';
import {
    authTokenSchema,
    InputValidationError,
    MAX_REGISTRATION_BYTES,
    parseJsonRequest,
    validationErrorPayload,
} from '@/lib/validation';

export async function POST(request: Request) {
    try {
        const { token } = await parseJsonRequest(
            request,
            authTokenSchema,
            MAX_REGISTRATION_BYTES
        );
        if (!await verifyEmail(token)) {
            return NextResponse.json({
                error: {
                    code: 'INVALID_OR_EXPIRED_TOKEN',
                    message: 'This verification link is invalid or expired.',
                    fields: {},
                }
            }, { status: 400 });
        }
        return NextResponse.json({ message: 'Your email has been verified.' });
    } catch (error) {
        if (error instanceof InputValidationError) {
            return NextResponse.json(validationErrorPayload(error), { status: 400 });
        }
        console.error('Unable to confirm email verification.');
        return NextResponse.json({
            error: { code: 'INTERNAL_ERROR', message: 'Unable to verify this email right now.', fields: {} }
        }, { status: 500 });
    }
}
