/** @jest-environment node */

import {
    CORRELATION_ID_HEADER,
    formatJson,
    formatLogRecord,
    formatReadable,
    generateCorrelationId,
    getCorrelationId,
    getCorrelationIdFromHeaders,
    getLogger,
    getOrGenerateCorrelationId,
    isLevelEnabled,
    isSensitiveKey,
    logger,
    redactSensitiveData,
    redactSensitiveString,
    runWithCorrelationId,
    withApiLogging,
    withServerActionLogging,
} from '@/lib/logger';

describe('Correlation Context & Helper', () => {
    it('generates a valid UUID correlation ID', () => {
        const id1 = generateCorrelationId();
        const id2 = generateCorrelationId();

        expect(typeof id1).toBe('string');
        expect(id1).toHaveLength(36);
        expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(id1).not.toBe(id2);
    });

    it('returns undefined when no correlation context is active', () => {
        expect(getCorrelationId()).toBeUndefined();
    });

    it('runs synchronous function with correlation ID', () => {
        const testId = 'corr-sync-123';
        const result = runWithCorrelationId(testId, () => {
            expect(getCorrelationId()).toBe(testId);
            return 42;
        });

        expect(result).toBe(42);
        expect(getCorrelationId()).toBeUndefined();
    });

    it('propagates correlation ID across asynchronous boundaries', async () => {
        const testId = 'corr-async-456';

        await runWithCorrelationId(testId, async () => {
            expect(getCorrelationId()).toBe(testId);

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(getCorrelationId()).toBe(testId);

            await Promise.resolve();
            expect(getCorrelationId()).toBe(testId);
        });

        expect(getCorrelationId()).toBeUndefined();
    });

    it('maintains isolation between concurrent asynchronous operations', async () => {
        const taskA = async () => {
            return runWithCorrelationId('task-A', async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
                return getCorrelationId();
            });
        };

        const taskB = async () => {
            return runWithCorrelationId('task-B', async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return getCorrelationId();
            });
        };

        const [resA, resB] = await Promise.all([taskA(), taskB()]);
        expect(resA).toBe('task-A');
        expect(resB).toBe('task-B');
    });

    it('handles nested correlation contexts correctly', () => {
        runWithCorrelationId('outer-id', () => {
            expect(getCorrelationId()).toBe('outer-id');

            runWithCorrelationId('inner-id', () => {
                expect(getCorrelationId()).toBe('inner-id');
            });

            expect(getCorrelationId()).toBe('outer-id');
        });
    });

    it('extracts correlation ID from Headers instance', () => {
        const headers = new Headers();
        headers.set('x-request-id', 'req-header-123');
        expect(getCorrelationIdFromHeaders(headers)).toBe('req-header-123');

        const fallbackHeaders = new Headers();
        fallbackHeaders.set('x-correlation-id', 'corr-fallback-456');
        expect(getCorrelationIdFromHeaders(fallbackHeaders)).toBe('corr-fallback-456');
    });

    it('extracts correlation ID case-insensitively from plain object', () => {
        expect(getCorrelationIdFromHeaders({ 'X-Request-Id': 'custom-id' })).toBe('custom-id');
        expect(getCorrelationIdFromHeaders({ 'x-correlation-id': 'fallback-id' })).toBe('fallback-id');
        expect(getCorrelationIdFromHeaders({ 'x-request-id': ['array-id'] })).toBe('array-id');
        expect(getCorrelationIdFromHeaders(undefined)).toBeUndefined();
        expect(getCorrelationIdFromHeaders(null)).toBeUndefined();
        expect(getCorrelationIdFromHeaders({})).toBeUndefined();
    });

    it('getOrGenerateCorrelationId returns existing header or generates a new one', () => {
        const headers = new Headers({ 'x-request-id': 'existing-req-id' });
        expect(getOrGenerateCorrelationId(headers)).toBe('existing-req-id');

        const generated = getOrGenerateCorrelationId();
        expect(generated).toHaveLength(36);
        expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
});

describe('Structured JSON Logging and Formatting', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('formats log record as valid structured JSON in json mode', () => {
        const record = {
            timestamp: '2026-09-19T18:00:00.000Z',
            level: 'info' as const,
            message: 'Booking confirmed',
            requestId: 'req-abc-123',
            bookingId: 'book-789',
            userId: 'user-001',
            durationMs: 125,
        };

        const jsonStr = formatJson(record);
        const parsed = JSON.parse(jsonStr);

        expect(parsed).toEqual({
            timestamp: '2026-09-19T18:00:00.000Z',
            level: 'info',
            message: 'Booking confirmed',
            requestId: 'req-abc-123',
            bookingId: 'book-789',
            userId: 'user-001',
            durationMs: 125,
        });
    });

    it('formats log record as readable string in pretty mode', () => {
        const record = {
            timestamp: '2026-09-19T18:00:00.000Z',
            level: 'info' as const,
            message: 'Payment received',
            requestId: 'req-xyz',
            bookingId: 'book-123',
        };

        const prettyStr = formatReadable(record);
        expect(prettyStr).toContain('[2026-09-19T18:00:00.000Z]');
        expect(prettyStr).toContain('[INFO]');
        expect(prettyStr).toContain('[req-xyz]');
        expect(prettyStr).toContain('Payment received');
        expect(prettyStr).toContain('"bookingId":"book-123"');
    });

    it('includes error stack on new line in pretty format', () => {
        const err = new Error('Database connection timeout');
        const record = {
            timestamp: '2026-09-19T18:00:00.000Z',
            level: 'error' as const,
            message: 'Database failure',
            error: {
                name: err.name,
                message: err.message,
                stack: err.stack,
            },
        };

        const prettyStr = formatReadable(record);
        expect(prettyStr).toContain('[ERROR]');
        expect(prettyStr).toContain('Database failure');
        expect(prettyStr).toContain('Database connection timeout');
        expect(prettyStr).toContain('\nError: Database connection timeout');
    });

    it('outputs structured JSON when NODE_ENV is production', () => {
        Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
        process.env.LOG_LEVEL = 'debug';
        delete process.env.LOG_FORMAT;

        const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

        try {
            runWithCorrelationId('prod-req-1', () => {
                logger.info('Production test log', { userId: 'usr-prod', bookingId: 'b-prod' });
            });

            expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
            const rawOutput = consoleInfoSpy.mock.calls[0][0];
            const parsed = JSON.parse(rawOutput);

            expect(parsed).toMatchObject({
                level: 'info',
                message: 'Production test log',
                requestId: 'prod-req-1',
                userId: 'usr-prod',
                bookingId: 'b-prod',
            });
            expect(parsed.timestamp).toBeDefined();
        } finally {
            consoleInfoSpy.mockRestore();
        }
    });

    it('outputs formatted readable output in development', () => {
        Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', configurable: true });
        delete process.env.LOG_FORMAT;

        const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

        try {
            runWithCorrelationId('dev-req-1', () => {
                logger.info('Dev test log', { itineraryId: 'itin-123' });
            });

            expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
            const rawOutput = consoleInfoSpy.mock.calls[0][0];

            expect(rawOutput).toContain('[INFO]');
            expect(rawOutput).toContain('[dev-req-1]');
            expect(rawOutput).toContain('Dev test log');
            expect(rawOutput).toContain('"itineraryId":"itin-123"');
        } finally {
            consoleInfoSpy.mockRestore();
        }
    });
});

describe('Sensitive Data Redaction', () => {
    it('detects sensitive keys correctly', () => {
        expect(isSensitiveKey('password')).toBe(true);
        expect(isSensitiveKey('currentPassword')).toBe(true);
        expect(isSensitiveKey('confirmPassword')).toBe(true);
        expect(isSensitiveKey('hashedPassword')).toBe(true);
        expect(isSensitiveKey('token')).toBe(true);
        expect(isSensitiveKey('accessToken')).toBe(true);
        expect(isSensitiveKey('refreshToken')).toBe(true);
        expect(isSensitiveKey('verificationToken')).toBe(true);
        expect(isSensitiveKey('csrfToken')).toBe(true);
        expect(isSensitiveKey('sessionToken')).toBe(true);
        expect(isSensitiveKey('apiKey')).toBe(true);
        expect(isSensitiveKey('api_key')).toBe(true);
        expect(isSensitiveKey('authorization')).toBe(true);
        expect(isSensitiveKey('proxy-authorization')).toBe(true);
        expect(isSensitiveKey('cookie')).toBe(true);
        expect(isSensitiveKey('set-cookie')).toBe(true);
        expect(isSensitiveKey('cardNumber')).toBe(true);
        expect(isSensitiveKey('creditCard')).toBe(true);
        expect(isSensitiveKey('cvv')).toBe(true);
        expect(isSensitiveKey('cvc')).toBe(true);
        expect(isSensitiveKey('clientSecret')).toBe(true);
        expect(isSensitiveKey('paymentIntentSecret')).toBe(true);
        expect(isSensitiveKey('privateKey')).toBe(true);
        expect(isSensitiveKey('encryptionKey')).toBe(true);
        expect(isSensitiveKey('passengerDataEncryptionKeys')).toBe(true);
        expect(isSensitiveKey('staffMfaEncryptionKeys')).toBe(true);

        // Safe business fields should NOT be flagged as sensitive
        expect(isSensitiveKey('bookingId')).toBe(false);
        expect(isSensitiveKey('userId')).toBe(false);
        expect(isSensitiveKey('itineraryId')).toBe(false);
        expect(isSensitiveKey('flightId')).toBe(false);
        expect(isSensitiveKey('durationMs')).toBe(false);
        expect(isSensitiveKey('status')).toBe(false);
        expect(isSensitiveKey('code')).toBe(false);
        expect(isSensitiveKey('relation')).toBe(false);
        expect(isSensitiveKey('constraint')).toBe(false);
    });

    it('redacts sensitive fields recursively in objects', () => {
        const input = {
            userId: 'u_123',
            bookingId: 'b_456',
            password: 'superSecretPassword',
            credentials: {
                apiKey: 'api-key-value',
                tokens: ['token-1', 'token-2'],
            },
            auth: {
                authorization: 'Bearer secret-bearer-token',
                sessionToken: 'session-jwt',
                cookie: 'session_id=secret_cookie_val',
            },
            payment: {
                cardNumber: '4242424242424242',
                cvv: '123',
                clientSecret: 'pi_secret_999',
            },
            crypto: {
                privateKey: '-----BEGIN PRIVATE KEY-----...',
                encryptionKey: '0123456789abcdef',
                passengerDataEncryptionKeys: '{"primaryKeyId":"1"}',
            },
        };

        const redacted = redactSensitiveData(input) as Record<string, unknown>;

        expect(redacted.userId).toBe('u_123');
        expect(redacted.bookingId).toBe('b_456');
        expect(redacted.password).toBe('[REDACTED]');
        expect(redacted.credentials).toBe('[REDACTED]');

        const auth = redacted.auth as Record<string, unknown>;
        expect(auth.authorization).toBe('[REDACTED]');
        expect(auth.sessionToken).toBe('[REDACTED]');
        expect(auth.cookie).toBe('[REDACTED]');

        const payment = redacted.payment as Record<string, unknown>;
        expect(payment.cardNumber).toBe('[REDACTED]');
        expect(payment.cvv).toBe('[REDACTED]');
        expect(payment.clientSecret).toBe('[REDACTED]');

        const crypto = redacted.crypto as Record<string, unknown>;
        expect(crypto.privateKey).toBe('[REDACTED]');
        expect(crypto.encryptionKey).toBe('[REDACTED]');
        expect(crypto.passengerDataEncryptionKeys).toBe('[REDACTED]');
    });

    it('redacts sensitive strings such as Bearer tokens, DB credentials, and URL params', () => {
        expect(redactSensitiveString('Authorization: Bearer mySecretToken123456')).toBe(
            'Authorization: Bearer [REDACTED]'
        );
        expect(
            redactSensitiveString('postgres://dbuser:supersecretpass@localhost:5432/travelapp')
        ).toBe('postgres://dbuser:[REDACTED]@localhost:5432/travelapp');
        expect(
            redactSensitiveString('postgresql://dbuser:supersecretpass@localhost:5432/travelapp')
        ).toBe('postgresql://dbuser:[REDACTED]@localhost:5432/travelapp');
        expect(
            redactSensitiveString('https://api.example.com/callback?token=secret123&user=42')
        ).toBe('https://api.example.com/callback?token=[REDACTED]&user=42');
    });

    it('handles circular references without throwing or infinite recursion', () => {
        const circularObj: Record<string, unknown> = {
            name: 'root',
            bookingId: 'b-circle',
        };
        circularObj.self = circularObj;

        expect(() => redactSensitiveData(circularObj)).not.toThrow();
        const result = redactSensitiveData(circularObj) as Record<string, unknown>;
        expect(result.name).toBe('root');
        expect(result.bookingId).toBe('b-circle');
        expect(result.self).toBe('[Circular]');
    });

    it('redacts sensitive fields on Error instances', () => {
        const error = new Error('Auth failed with token Bearer secret-tok-123') as Error & {
            apiKey?: string;
        };
        error.apiKey = 'key-987';

        const result = redactSensitiveData(error) as Record<string, unknown>;
        expect(result.name).toBe('Error');
        expect(result.message).toBe('Auth failed with token Bearer [REDACTED]');
        expect(result.apiKey).toBe('[REDACTED]');
    });
});

describe('Log Level Filtering', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('respects LOG_LEVEL environment variable filtering', () => {
        process.env.LOG_LEVEL = 'warn';

        expect(isLevelEnabled('debug')).toBe(false);
        expect(isLevelEnabled('info')).toBe(false);
        expect(isLevelEnabled('warn')).toBe(true);
        expect(isLevelEnabled('error')).toBe(true);

        process.env.LOG_LEVEL = 'error';
        expect(isLevelEnabled('debug')).toBe(false);
        expect(isLevelEnabled('info')).toBe(false);
        expect(isLevelEnabled('warn')).toBe(false);
        expect(isLevelEnabled('error')).toBe(true);

        process.env.LOG_LEVEL = 'debug';
        expect(isLevelEnabled('debug')).toBe(true);
        expect(isLevelEnabled('info')).toBe(true);
        expect(isLevelEnabled('warn')).toBe(true);
        expect(isLevelEnabled('error')).toBe(true);
    });

    it('filters out debug and info messages when LOG_LEVEL=warn', () => {
        process.env.LOG_LEVEL = 'warn';

        const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            logger.debug('debug message');
            logger.info('info message');
            logger.warn('warn message');
            logger.error('error message');

            expect(debugSpy).not.toHaveBeenCalled();
            expect(infoSpy).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledTimes(1);
        } finally {
            debugSpy.mockRestore();
            infoSpy.mockRestore();
            warnSpy.mockRestore();
            errorSpy.mockRestore();
        }
    });

    it('handles silent / off LOG_LEVEL', () => {
        process.env.LOG_LEVEL = 'silent';

        expect(isLevelEnabled('debug')).toBe(false);
        expect(isLevelEnabled('info')).toBe(false);
        expect(isLevelEnabled('warn')).toBe(false);
        expect(isLevelEnabled('error')).toBe(false);
    });
});

describe('API Route and Server Action Integration Wrappers', () => {
    it('withApiLogging wraps handler, sets correlation ID, logs start/complete, and adds response header', async () => {
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

        try {
            const mockHandler = jest.fn().mockImplementation(async (req: Request) => {
                expect(getCorrelationId()).toBe('custom-req-id');
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            });

            const wrapped = withApiLogging(mockHandler);
            const req = new Request('https://example.com/api/bookings', {
                method: 'POST',
                headers: { 'x-request-id': 'custom-req-id' },
            });

            const res = await wrapped(req);

            expect(mockHandler).toHaveBeenCalledTimes(1);
            expect(res.status).toBe(200);
            expect(res.headers.get(CORRELATION_ID_HEADER)).toBe('custom-req-id');

            // Two logs: start and complete
            expect(infoSpy).toHaveBeenCalledTimes(2);
            const startLog = infoSpy.mock.calls[0][0];
            const endLog = infoSpy.mock.calls[1][0];

            expect(startLog).toContain('HTTP request started: POST /api/bookings');
            expect(startLog).toContain('custom-req-id');
            expect(endLog).toContain('HTTP request completed: POST /api/bookings');
            expect(endLog).toContain('custom-req-id');
        } finally {
            infoSpy.mockRestore();
        }
    });

    it('withApiLogging logs error and rethrows when handler fails', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

        try {
            const mockHandler = jest.fn().mockImplementation(async () => {
                throw new Error('API processing failure');
            });

            const wrapped = withApiLogging(mockHandler);
            const req = new Request('https://example.com/api/flights/search', {
                method: 'GET',
                headers: { 'x-request-id': 'err-req-id' },
            });

            await expect(wrapped(req)).rejects.toThrow('API processing failure');
            expect(errorSpy).toHaveBeenCalledTimes(1);
            const errLog = errorSpy.mock.calls[0][0];
            expect(errLog).toContain('HTTP request failed: GET /api/flights/search');
            expect(errLog).toContain('err-req-id');
        } finally {
            errorSpy.mockRestore();
            infoSpy.mockRestore();
        }
    });

    it('withServerActionLogging wraps server actions and tracks correlation ID and duration', async () => {
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

        try {
            const sampleAction = async (bookingId: string) => {
                const corrId = getCorrelationId();
                expect(corrId).toBeDefined();
                return { success: true, bookingId, corrId };
            };

            const wrapped = withServerActionLogging('confirmBookingAction', sampleAction);
            const result = await wrapped('book-abc-999');

            expect(result.success).toBe(true);
            expect(result.bookingId).toBe('book-abc-999');
            expect(infoSpy).toHaveBeenCalledTimes(2);

            const startLog = infoSpy.mock.calls[0][0];
            const endLog = infoSpy.mock.calls[1][0];
            expect(startLog).toContain('Server action started: confirmBookingAction');
            expect(endLog).toContain('Server action completed: confirmBookingAction');
        } finally {
            infoSpy.mockRestore();
        }
    });

    it('withServerActionLogging logs error and rethrows when action fails', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

        try {
            const failingAction = async () => {
                throw new Error('Action failed intentionally');
            };

            const wrapped = withServerActionLogging('failingAction', failingAction);
            await expect(wrapped()).rejects.toThrow('Action failed intentionally');

            expect(errorSpy).toHaveBeenCalledTimes(1);
            const errLog = errorSpy.mock.calls[0][0];
            expect(errLog).toContain('Server action failed: failingAction');
        } finally {
            errorSpy.mockRestore();
            infoSpy.mockRestore();
        }
    });

    it('child logger appends default context to all log calls', () => {
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

        try {
            const scoped = getLogger({ service: 'CheckoutService', environment: 'test' });
            scoped.info('Checkout initialized', { step: 1 });

            expect(infoSpy).toHaveBeenCalledTimes(1);
            const logContent = infoSpy.mock.calls[0][0];
            expect(logContent).toContain('CheckoutService');
            expect(logContent).toContain('"step":1');
        } finally {
            infoSpy.mockRestore();
        }
    });
});
