import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

// A valid bcrypt hash of a throwaway value, used only to equalize response
// timing when no matching user exists (anti-enumeration). It is never a real
// credential and never matches any user-supplied password.
const DUMMY_PASSWORD_HASH = '$2b$10$m5cSUIfLL/USdiPzCLh47OC6nV84HHx2LHbBgT2c8Kw.YOCKKxBtS';

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prisma) as any,
    providers: [
        CredentialsProvider({
            name: 'Credentials',
            credentials: {
                email: { label: 'Email', type: 'email', placeholder: 'user@example.com' },
                password: { label: 'Password', type: 'password' },
            },
            async authorize(credentials) {
                // Single generic message for every failure mode so the response
                // never reveals whether an account with this email exists.
                const INVALID = 'Invalid email or password';

                if (!credentials?.email || !credentials?.password) {
                    throw new Error(INVALID);
                }

                const user = await prisma.user.findUnique({
                    where: { email: credentials.email },
                });

                // Always run a bcrypt comparison — against the real hash when the
                // user exists, otherwise a dummy — so response time does not leak
                // account existence (timing-based enumeration).
                const passwordHash = user?.password ?? DUMMY_PASSWORD_HASH;
                const isPasswordValid = await bcrypt.compare(credentials.password, passwordHash);

                if (!user || !user.password || !isPasswordValid) {
                    throw new Error(INVALID);
                }

                // Return only non-sensitive fields (never the password hash).
                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    image: user.image,
                    role: user.role,
                };
            },
        }),
    ],
    session: {
        strategy: 'jwt',
    },
    pages: {
        signIn: '/login', // User custom login page
        newUser: '/signup' // New users directed to sign up page
    },
    callbacks: {
        async jwt({ token, user, account }) {
            if (user) {
                token.id = user.id;
                token.role = (user as any).role;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                (session.user as any).id = token.id as string;
                (session.user as any).role = token.role as string;
            }
            return session;
        },
    },
};
