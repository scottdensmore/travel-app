import { validateServerEnvironment } from '@/lib/env';

const AUTH_TOKEN_PRUNE_INTERVAL_MS = 60 * 60 * 1_000;
const AUTH_TOKEN_PRUNE_BATCH_SIZE = 250;
const AUTH_TOKEN_PRUNE_MAX_BATCHES = 20;

declare global {
    // One timer per Node.js process, including during development reloads.
    var authTokenPruneTimer: NodeJS.Timeout | undefined;
}

export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        validateServerEnvironment(process.env);
        const { pruneExpiredAuthTokens } = await import('@/lib/authTokens');
        const pruneBacklog = async () => {
            for (let batch = 0; batch < AUTH_TOKEN_PRUNE_MAX_BATCHES; batch += 1) {
                const deleted = await pruneExpiredAuthTokens(AUTH_TOKEN_PRUNE_BATCH_SIZE);
                if (deleted < AUTH_TOKEN_PRUNE_BATCH_SIZE) break;
            }
        };
        await pruneBacklog();
        if (!globalThis.authTokenPruneTimer) {
            globalThis.authTokenPruneTimer = setInterval(() => {
                pruneBacklog().catch(() => {
                    console.error('Unable to prune expired authentication tokens.');
                });
            }, AUTH_TOKEN_PRUNE_INTERVAL_MS);
            globalThis.authTokenPruneTimer.unref?.();
        }
    }
}
