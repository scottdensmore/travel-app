import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export async function POST(req: Request) {
    try {
        const { name, email, password } = await req.json();

        if (!name || !email || !password) {
            return NextResponse.json({ message: 'Missing fields' }, { status: 400 });
        }

        if (typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
            return NextResponse.json({ message: 'Invalid email address' }, { status: 400 });
        }

        if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
            return NextResponse.json(
                { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
                { status: 400 }
            );
        }

        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return NextResponse.json({ message: 'User already exists' }, { status: 400 });
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
        // Log server-side; do not leak internal error details to the client.
        console.error('Error registering user:', error);
        return NextResponse.json({ message: 'Error registering user' }, { status: 500 });
    }
}
