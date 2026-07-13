import { NextResponse } from 'next/server';
import { resetPassword } from '@/lib/authAccountFlows';
import {
    InputValidationError,
    MAX_REGISTRATION_BYTES,
    parseJsonRequest,
    passwordResetSchema,
    validationErrorPayload,
} from '@/lib/validation';

export async function POST(request: Request) {
    try {
        const { token, password } = await parseJsonRequest(
            request,
            passwordResetSchema,
            MAX_REGISTRATION_BYTES
        );
        if (!await resetPassword(token, password)) {
            return NextResponse.json({
                error: {
                    code: 'INVALID_OR_EXPIRED_TOKEN',
                    message: 'This password reset link is invalid or expired.',
                    fields: {},
                }
            }, { status: 400 });
        }
        return NextResponse.json({ message: 'Your password has been reset.' });
    } catch (error) {
        if (error instanceof InputValidationError) {
            return NextResponse.json(validationErrorPayload(error), { status: 400 });
        }
        console.error('Unable to reset account password.');
        return NextResponse.json({
            error: { code: 'INTERNAL_ERROR', message: 'Unable to reset this password right now.', fields: {} }
        }, { status: 500 });
    }
}
