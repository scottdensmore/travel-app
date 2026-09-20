import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'pretty';

export interface LogRecord {
    timestamp: string;
    level: LogLevel;
    message: string;
    requestId?: string;
    [key: string]: unknown;
}

export interface CorrelationContext {
    correlationId: string;
    [key: string]: unknown;
}

export interface ILogger {
    debug(message: string, meta?: unknown): void;
    info(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
    error(message: string, meta?: unknown): void;
    child(defaultMeta: Record<string, unknown>): ILogger;
    isDebugEnabled(): boolean;
    isInfoEnabled(): boolean;
    isWarnEnabled(): boolean;
    isErrorEnabled(): boolean;
}

const asyncLocalStorage = new AsyncLocalStorage<CorrelationContext>();

export const CORRELATION_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADERS = ['x-request-id', 'x-correlation-id'] as const;

export function generateCorrelationId(): string {
    return randomUUID();
}

export function runWithCorrelationId<T>(
    correlationId: string,
    fn: () => T,
    extraContext?: Record<string, unknown>
): T {
    const context: CorrelationContext = {
        correlationId,
        ...extraContext,
    };
    return asyncLocalStorage.run(context, fn);
}

export function getCorrelationId(): string | undefined {
    return asyncLocalStorage.getStore()?.correlationId;
}

export function getCorrelationContext(): CorrelationContext | undefined {
    return asyncLocalStorage.getStore();
}

export function getCorrelationIdFromHeaders(
    headers: Headers | Record<string, string | string[] | undefined> | null | undefined
): string | undefined {
    if (!headers) return undefined;

    if (typeof (headers as Headers).get === 'function') {
        const h = headers as Headers;
        for (const name of CORRELATION_ID_HEADERS) {
            const val = h.get(name);
            if (val && val.trim().length > 0) {
                return val.trim();
            }
        }
        return undefined;
    }

    const rec = headers as Record<string, string | string[] | undefined>;
    for (const name of CORRELATION_ID_HEADERS) {
        const matchingKey = Object.keys(rec).find((k) => k.toLowerCase() === name);
        if (matchingKey) {
            const val = rec[matchingKey];
            if (typeof val === 'string' && val.trim().length > 0) {
                return val.trim();
            }
            if (Array.isArray(val) && val[0] && val[0].trim().length > 0) {
                return val[0].trim();
            }
        }
    }

    return undefined;
}

export function getOrGenerateCorrelationId(
    headers?: Headers | Record<string, string | string[] | undefined> | null
): string {
    return getCorrelationIdFromHeaders(headers) ?? generateCorrelationId();
}

const SENSITIVE_KEY_SUBSTRINGS = [
    'password',
    'passwd',
    'passphrase',
    'secret',
    'token',
    'credential',
    'apikey',
    'cookie',
    'sessiontoken',
    'sessioncookie',
    'cardnumber',
    'creditcard',
    'privatekey',
    'encryptionkey',
    'paymentintent',
];

const SENSITIVE_EXACT_KEYS = new Set([
    'authorization',
    'proxyauthorization',
    'cvv',
    'cvc',
    'card',
    'keys',
    'rawkey',
    'cryptokey',
    'secretkey',
    'signingkey',
    'securitycode',
]);

export function isSensitiveKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_EXACT_KEYS.has(normalized)) return true;
    return SENSITIVE_KEY_SUBSTRINGS.some((sub) => normalized.includes(sub));
}

export function redactSensitiveString(str: string): string {
    return str
        .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
        .replace(/((?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:@/\s]+:)([^@/\s]+)(@)/gi, '$1[REDACTED]$3')
        .replace(/([?&](?:token|password|secret|key|api_key|client_secret|access_token)=)[^&\s]*/gi, '$1[REDACTED]');
}

export function redactSensitiveData(data: unknown, seen = new WeakSet<object>()): unknown {
    if (data === null || data === undefined) {
        return data;
    }

    if (typeof data === 'string') {
        return redactSensitiveString(data);
    }

    if (typeof data === 'number' || typeof data === 'boolean' || typeof data === 'symbol' || typeof data === 'bigint') {
        return data;
    }

    if (data instanceof Date) {
        return data;
    }

    if (data instanceof RegExp) {
        return data.toString();
    }

    if (typeof data === 'function') {
        return '[Function]';
    }

    if (typeof data === 'object') {
        if (seen.has(data)) {
            return '[Circular]';
        }
        seen.add(data);

        if (data instanceof Error) {
            const errorObj: Record<string, unknown> = {
                name: data.name,
                message: redactSensitiveString(data.message),
            };
            if (data.stack) {
                errorObj.stack = redactSensitiveString(data.stack);
            }
            for (const key of Object.keys(data)) {
                if (isSensitiveKey(key)) {
                    errorObj[key] = '[REDACTED]';
                } else {
                    errorObj[key] = redactSensitiveData((data as unknown as Record<string, unknown>)[key], seen);
                }
            }
            return errorObj;
        }

        if (Array.isArray(data)) {
            return data.map((item) => redactSensitiveData(item, seen));
        }

        if (data instanceof Set) {
            return Array.from(data).map((item) => redactSensitiveData(item, seen));
        }

        if (data instanceof Map) {
            const obj: Record<string, unknown> = {};
            for (const [key, value] of data.entries()) {
                const keyStr = String(key);
                if (isSensitiveKey(keyStr)) {
                    obj[keyStr] = '[REDACTED]';
                } else {
                    obj[keyStr] = redactSensitiveData(value, seen);
                }
            }
            return obj;
        }

        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
            if (isSensitiveKey(key)) {
                result[key] = '[REDACTED]';
            } else {
                result[key] = redactSensitiveData(value, seen);
            }
        }
        return result;
    }

    return String(data);
}

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

export function parseLogLevel(levelStr: string | undefined): LogLevel | 'silent' {
    if (!levelStr) {
        return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
    }
    const normalized = levelStr.trim().toLowerCase();
    if (normalized === 'debug') return 'debug';
    if (normalized === 'info') return 'info';
    if (normalized === 'warn' || normalized === 'warning') return 'warn';
    if (normalized === 'error') return 'error';
    if (normalized === 'silent' || normalized === 'none' || normalized === 'off') return 'silent';
    return 'info';
}

export function isLevelEnabled(level: LogLevel): boolean {
    const currentLevel = parseLogLevel(process.env.LOG_LEVEL);
    if (currentLevel === 'silent') return false;
    return LOG_LEVEL_SEVERITY[level] >= LOG_LEVEL_SEVERITY[currentLevel];
}

export function getLogFormat(): LogFormat {
    if (process.env.LOG_FORMAT === 'json') return 'json';
    if (process.env.LOG_FORMAT === 'pretty' || process.env.LOG_FORMAT === 'text') return 'pretty';
    const env = process.env.NODE_ENV;
    if (env === 'development' || env === 'test') {
        return 'pretty';
    }
    return 'json';
}

export function formatJson(record: LogRecord): string {
    return JSON.stringify(record);
}

export function formatReadable(record: LogRecord): string {
    const { timestamp, level, message, requestId, error, ...meta } = record;
    const reqStr = requestId ? ` [${requestId}]` : '';
    const levelStr = `[${level.toUpperCase()}]`;

    const cleanMeta = { ...meta };
    if (error !== undefined) {
        cleanMeta.error = error;
    }

    const metaKeys = Object.keys(cleanMeta);
    let metaStr = '';
    if (metaKeys.length > 0) {
        metaStr = ` ${JSON.stringify(cleanMeta)}`;
    }

    let stackStr = '';
    if (error && typeof error === 'object' && 'stack' in (error as Record<string, unknown>)) {
        const err = error as { stack?: string };
        if (err.stack) {
            stackStr = `\n${err.stack}`;
        }
    }

    return `[${timestamp}] ${levelStr}${reqStr} ${message}${metaStr}${stackStr}`;
}

export function formatLogRecord(record: LogRecord, format?: LogFormat): string {
    const activeFormat = format ?? getLogFormat();
    return activeFormat === 'json' ? formatJson(record) : formatReadable(record);
}

function buildRecord(level: LogLevel, message: string, meta?: unknown): LogRecord {
    const timestamp = new Date().toISOString();
    const correlationId = getCorrelationId();

    const record: LogRecord = {
        timestamp,
        level,
        message: String(message),
    };

    if (correlationId) {
        record.requestId = correlationId;
    }

    if (meta !== undefined && meta !== null) {
        if (meta instanceof Error) {
            record.error = redactSensitiveData(meta);
        } else if (typeof meta === 'object') {
            const redacted = redactSensitiveData(meta) as Record<string, unknown>;
            if (typeof redacted.requestId === 'string') {
                record.requestId = redacted.requestId;
            }
            for (const [key, value] of Object.entries(redacted)) {
                if (key !== 'level' && key !== 'timestamp') {
                    record[key] = value;
                }
            }
        } else {
            record.data = redactSensitiveData(meta);
        }
    }

    return record;
}

function logMessage(level: LogLevel, message: string, meta?: unknown): void {
    if (!isLevelEnabled(level)) return;

    const record = buildRecord(level, message, meta);
    const output = formatLogRecord(record);

    switch (level) {
        case 'debug':
            (console.debug ?? console.log)(output);
            break;
        case 'info':
            (console.info ?? console.log)(output);
            break;
        case 'warn':
            console.warn(output);
            break;
        case 'error':
            console.error(output);
            break;
    }
}

function combineMeta(parentMeta: Record<string, unknown>, childMeta?: unknown): unknown {
    if (!childMeta) return parentMeta;
    if (childMeta instanceof Error) {
        return { ...parentMeta, error: childMeta };
    }
    if (typeof childMeta === 'object') {
        return { ...parentMeta, ...childMeta };
    }
    return { ...parentMeta, data: childMeta };
}

export function createLogger(defaultMeta: Record<string, unknown> = {}): ILogger {
    return {
        debug(message: string, meta?: unknown) {
            logMessage('debug', message, combineMeta(defaultMeta, meta));
        },
        info(message: string, meta?: unknown) {
            logMessage('info', message, combineMeta(defaultMeta, meta));
        },
        warn(message: string, meta?: unknown) {
            logMessage('warn', message, combineMeta(defaultMeta, meta));
        },
        error(message: string, meta?: unknown) {
            logMessage('error', message, combineMeta(defaultMeta, meta));
        },
        child(childMeta: Record<string, unknown>) {
            return createLogger(combineMeta(defaultMeta, childMeta) as Record<string, unknown>);
        },
        isDebugEnabled() {
            return isLevelEnabled('debug');
        },
        isInfoEnabled() {
            return isLevelEnabled('info');
        },
        isWarnEnabled() {
            return isLevelEnabled('warn');
        },
        isErrorEnabled() {
            return isLevelEnabled('error');
        },
    };
}

export const logger = createLogger();

export function getLogger(defaultMeta?: Record<string, unknown>): ILogger {
    return createLogger(defaultMeta);
}

export interface ApiLoggingOptions {
    name?: string;
}

export function withApiLogging<TContext = unknown>(
    handler: (req: Request, context?: TContext) => Promise<Response> | Response,
    options?: ApiLoggingOptions
): (req: Request, context?: TContext) => Promise<Response> {
    return async (req: Request, context?: TContext): Promise<Response> => {
        const correlationId = getOrGenerateCorrelationId(req.headers);
        let path = req.url;
        try {
            path = new URL(req.url).pathname;
        } catch {
            // Keep req.url if URL parsing fails
        }

        const name = options?.name ?? `${req.method} ${path}`;

        return runWithCorrelationId(correlationId, async () => {
            const start = Date.now();
            logger.info(`HTTP request started: ${name}`, {
                method: req.method,
                url: path,
                requestId: correlationId,
            });

            try {
                const response = await handler(req, context);
                const durationMs = Date.now() - start;

                logger.info(`HTTP request completed: ${name}`, {
                    method: req.method,
                    url: path,
                    status: response.status,
                    durationMs,
                    requestId: correlationId,
                });

                try {
                    response.headers.set(CORRELATION_ID_HEADER, correlationId);
                } catch {
                    // Headers might be immutable on certain Response instances
                }

                return response;
            } catch (error) {
                const durationMs = Date.now() - start;
                logger.error(`HTTP request failed: ${name}`, {
                    method: req.method,
                    url: path,
                    durationMs,
                    requestId: correlationId,
                    error,
                });
                throw error;
            }
        });
    };
}

export function withServerActionLogging<TArgs extends unknown[], TResult>(
    actionNameOrFn: string | ((...args: TArgs) => Promise<TResult>),
    maybeActionFn?: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
    const action = typeof actionNameOrFn === 'function' ? actionNameOrFn : maybeActionFn!;
    const name = typeof actionNameOrFn === 'string'
        ? actionNameOrFn
        : (action.name || 'anonymousAction');

    if (typeof action !== 'function') {
        throw new TypeError('withServerActionLogging requires an action function');
    }

    return async (...args: TArgs): Promise<TResult> => {
        const correlationId = getCorrelationId() ?? generateCorrelationId();
        return runWithCorrelationId(correlationId, async () => {
            const start = Date.now();
            logger.info(`Server action started: ${name}`, {
                action: name,
                requestId: correlationId,
            });

            try {
                const result = await action(...args);
                const durationMs = Date.now() - start;
                logger.info(`Server action completed: ${name}`, {
                    action: name,
                    durationMs,
                    requestId: correlationId,
                });
                return result;
            } catch (error) {
                const durationMs = Date.now() - start;
                logger.error(`Server action failed: ${name}`, {
                    action: name,
                    durationMs,
                    requestId: correlationId,
                    error,
                });
                throw error;
            }
        });
    };
}
