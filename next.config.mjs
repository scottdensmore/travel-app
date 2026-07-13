/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    async headers() {
        return [{
            source: '/:path*',
            headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
        }];
    },
};

export default nextConfig;
