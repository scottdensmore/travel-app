import { withAuth } from 'next-auth/middleware';

export default withAuth({
    callbacks: {
        authorized: ({ req, token }) => {
            // Protect admin routes to only users with 'ADMIN' role
            if (req.nextUrl.pathname.startsWith('/admin')) {
                return token?.role === 'ADMIN';
            }
            // Require authentication for other protected routes
            return !!token;
        },
    },
});

export const config = {
    matcher: ['/profile/:path*', '/book/:path*', '/admin/:path*'],
};
