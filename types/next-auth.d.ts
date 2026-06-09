// Module augmentation for NextAuth so `session.user.id` / `session.user.role`
// and the JWT equivalents are strongly typed across the app — no `as any`.
import { Role } from '@prisma/client';
import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
    interface Session {
        user: {
            id: string;
            role: Role;
        } & NonNullable<DefaultSession['user']>;
    }

    // Shape returned by the credentials `authorize` callback and passed into `jwt`.
    interface User {
        role: Role;
    }
}

declare module 'next-auth/jwt' {
    interface JWT {
        id: string;
        role: Role;
    }
}
