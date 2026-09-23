import {
    staffAuditInputSchema,
    staffAuditQuerySchema,
    auditRetentionPurgeSchema,
} from '@/lib/validation';

describe('Staff Audit Validation Schemas', () => {
    describe('staffAuditInputSchema', () => {
        const validPayload = {
            actorId: 'actor-123',
            actorEmail: 'admin@example.com',
            actorRole: 'ADMIN',
            action: 'USER_ROLE_UPDATE',
            targetType: 'User',
            targetId: 'user-456',
            beforeState: { role: 'USER' },
            afterState: { role: 'SUPPORT' },
            reason: 'Promotion to support role',
            metadata: { ip: '127.0.0.1' },
            ipAddress: '127.0.0.1',
        };

        it('accepts valid audit entry input', () => {
            const parsed = staffAuditInputSchema.parse(validPayload);
            expect(parsed.actorId).toBe('actor-123');
            expect(parsed.actorEmail).toBe('admin@example.com');
            expect(parsed.actorRole).toBe('ADMIN');
            expect(parsed.action).toBe('USER_ROLE_UPDATE');
        });

        it('accepts minimal required audit entry input', () => {
            const minimal = {
                actorId: 'actor-123',
                actorEmail: 'admin@example.com',
                actorRole: 'SUPPORT',
                action: 'SCHEDULE_VIEW',
                targetType: 'Schedule',
                targetId: 'sched-1',
            };
            const parsed = staffAuditInputSchema.parse(minimal);
            expect(parsed.actorRole).toBe('SUPPORT');
            expect(parsed.beforeState).toBeUndefined();
            expect(parsed.afterState).toBeUndefined();
        });

        it('rejects invalid email address', () => {
            expect(() => staffAuditInputSchema.parse({
                ...validPayload,
                actorEmail: 'not-an-email',
            })).toThrow();
        });

        it('rejects invalid role', () => {
            expect(() => staffAuditInputSchema.parse({
                ...validPayload,
                actorRole: 'SUPER_ADMIN_INVALID',
            })).toThrow();
        });

        it('rejects missing required fields', () => {
            const { actorId, ...missingActorId } = validPayload;
            expect(() => staffAuditInputSchema.parse(missingActorId)).toThrow();

            const { action, ...missingAction } = validPayload;
            expect(() => staffAuditInputSchema.parse(missingAction)).toThrow();

            const { targetType, ...missingTargetType } = validPayload;
            expect(() => staffAuditInputSchema.parse(missingTargetType)).toThrow();
        });

        it('rejects unrecognized extra fields in strict mode', () => {
            expect(() => staffAuditInputSchema.parse({
                ...validPayload,
                unrecognizedField: 'malicious',
            })).toThrow();
        });
    });

    describe('staffAuditQuerySchema', () => {
        it('accepts empty query and applies default limit', () => {
            const parsed = staffAuditQuerySchema.parse({});
            expect(parsed.limit).toBe(25);
        });

        it('accepts valid query filters', () => {
            const parsed = staffAuditQuerySchema.parse({
                dateFrom: '2026-01-01',
                dateTo: '2026-01-31',
                actorId: 'actor-123',
                actorEmail: 'admin@example.com',
                action: 'USER_ROLE_UPDATE',
                targetType: 'User',
                targetId: 'user-456',
                limit: '50',
                cursor: 'cursor-abc',
            });
            expect(parsed.dateFrom).toBe('2026-01-01');
            expect(parsed.limit).toBe(50);
            expect(parsed.cursor).toBe('cursor-abc');
        });

        it('normalizes empty string fields to undefined', () => {
            const parsed = staffAuditQuerySchema.parse({
                dateFrom: '',
                dateTo: '',
                actorEmail: '   ',
                action: '',
                cursor: '',
            });
            expect(parsed.dateFrom).toBeUndefined();
            expect(parsed.dateTo).toBeUndefined();
            expect(parsed.actorEmail).toBeUndefined();
            expect(parsed.action).toBeUndefined();
            expect(parsed.cursor).toBeUndefined();
        });

        it('rejects limit exceeding 100', () => {
            expect(() => staffAuditQuerySchema.parse({ limit: 101 })).toThrow();
        });

        it('rejects limit less than 1', () => {
            expect(() => staffAuditQuerySchema.parse({ limit: 0 })).toThrow();
        });

        it('rejects invalid date format strings', () => {
            expect(() => staffAuditQuerySchema.parse({ dateFrom: 'invalid-date' })).toThrow();
            expect(() => staffAuditQuerySchema.parse({ dateTo: 'not-a-date' })).toThrow();
        });
    });

    describe('auditRetentionPurgeSchema', () => {
        it('accepts valid purge request with defaults', () => {
            const parsed = auditRetentionPurgeSchema.parse({
                reason: 'Routine compliance retention purge',
            });
            expect(parsed.retentionDays).toBe(365);
            expect(parsed.dryRun).toBe(true);
            expect(parsed.reason).toBe('Routine compliance retention purge');
        });

        it('accepts custom retentionDays and dryRun false with stepUpCode', () => {
            const parsed = auditRetentionPurgeSchema.parse({
                retentionDays: 180,
                dryRun: false,
                reason: 'Half-year retention purge',
                stepUpCode: '123456',
            });
            expect(parsed.retentionDays).toBe(180);
            expect(parsed.dryRun).toBe(false);
            expect(parsed.stepUpCode).toBe('123456');
        });

        it('rejects empty or missing reason', () => {
            expect(() => auditRetentionPurgeSchema.parse({})).toThrow();
            expect(() => auditRetentionPurgeSchema.parse({ reason: '   ' })).toThrow();
        });

        it('rejects invalid stepUpCode format', () => {
            expect(() => auditRetentionPurgeSchema.parse({
                reason: 'Purge test',
                stepUpCode: '12345', // only 5 digits
            })).toThrow();

            expect(() => auditRetentionPurgeSchema.parse({
                reason: 'Purge test',
                stepUpCode: 'abcdef',
            })).toThrow();
        });

        it('rejects negative or zero retentionDays', () => {
            expect(() => auditRetentionPurgeSchema.parse({
                reason: 'Purge test',
                retentionDays: 0,
            })).toThrow();

            expect(() => auditRetentionPurgeSchema.parse({
                reason: 'Purge test',
                retentionDays: -5,
            })).toThrow();
        });
    });
});
