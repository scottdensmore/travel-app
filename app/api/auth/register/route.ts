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

export async function POST(req: Request) {
    try {
        const { name, email, password } = await parseJsonRequest(
            req,
            registrationSchema,
            MAX_REGISTRATION_BYTES
        );

        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return NextResponse.json({
                error: {
                    code: 'ACCOUNT_EXISTS',
                    message: 'An account already exists for that email address.',
                    fields: { email: ['Use a different email address or sign in.'] }
                }
            }, { status: 409 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
            },
        });

        // Never return the password hash (or any other sensitive field) to the client.
        const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };

        return NextResponse.json(
            { message: 'User registered successfully', user: safeUser },
            { status: 201 }
        );
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
