const AUTH_TOKEN_PRUNE_INTERVAL_MS = 60 * 60 * 1_000;
const AUTH_TOKEN_PRUNE_BATCH_SIZE = 250;
const AUTH_TOKEN_PRUNE_MAX_BATCHES = 20;
const PASSENGER_DATA_PURGE_INTERVAL_MS = 60 * 60 * 1_000;
const PASSENGER_DATA_ROTATION_BATCH_SIZE = 100;
const PASSENGER_DATA_ROTATION_MAX_BATCHES = 20;

declare global {
    // One timer per Node.js process, including during development reloads.
    var authTokenPruneTimer: NodeJS.Timeout | undefined;
    var passengerDataPurgeTimer: NodeJS.Timeout | undefined;
}

export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { validateServerEnvironment } = await import('@/lib/env');
        validateServerEnvironment(process.env);
        const { pruneExpiredAuthTokens } = await import('@/lib/authTokens');
        const { purgeExpiredPassengerData } = await import('@/lib/passengerDataRetention');
        const { rotatePassengerDataEncryptionBatch } = await import('@/lib/passengerDataRotation');
        const pruneBacklog = async () => {
            for (let batch = 0; batch < AUTH_TOKEN_PRUNE_MAX_BATCHES; batch += 1) {
                const deleted = await pruneExpiredAuthTokens(AUTH_TOKEN_PRUNE_BATCH_SIZE);
                if (deleted < AUTH_TOKEN_PRUNE_BATCH_SIZE) break;
            }
        };
        await pruneBacklog();
        await purgeExpiredPassengerData();
        const rotatePassengerDataBacklog = async () => {
            for (let batch = 0; batch < PASSENGER_DATA_ROTATION_MAX_BATCHES; batch += 1) {
                const rotated = await rotatePassengerDataEncryptionBatch(PASSENGER_DATA_ROTATION_BATCH_SIZE);
                if (rotated < PASSENGER_DATA_ROTATION_BATCH_SIZE) break;
            }
        };
        await rotatePassengerDataBacklog();
        if (!globalThis.authTokenPruneTimer) {
            globalThis.authTokenPruneTimer = setInterval(() => {
                pruneBacklog().catch(() => {
                    console.error('Unable to prune expired authentication tokens.');
                });
            }, AUTH_TOKEN_PRUNE_INTERVAL_MS);
            globalThis.authTokenPruneTimer.unref?.();
        }
        if (!globalThis.passengerDataPurgeTimer) {
            globalThis.passengerDataPurgeTimer = setInterval(() => {
                const maintainPassengerData = async () => {
                    // Purge first and rotate second so a rotation can never
                    // restore ciphertext erased by the retention job.
                    await purgeExpiredPassengerData();
                    await rotatePassengerDataBacklog();
                };
                maintainPassengerData().catch(() => {
                    console.error('Unable to maintain protected passenger identity data.');
                });
            }, PASSENGER_DATA_PURGE_INTERVAL_MS);
            globalThis.passengerDataPurgeTimer.unref?.();
        }
    }
}
