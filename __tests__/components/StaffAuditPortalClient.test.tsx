import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import StaffAuditPortalClient from '@/components/admin/StaffAuditPortalClient';

jest.mock('@/app/actions/staffAuditActions', () => ({
    searchStaffAuditLogsAction: jest.fn().mockResolvedValue({ success: true, logs: [], totalCount: 0 }),
    purgeExpiredAuditLogsAction: jest.fn().mockResolvedValue({ success: true, dryRun: true, eligibleCount: 0 }),
}));

const sampleLogs = [
    {
        id: 'log-1',
        actorId: 'u1',
        actorEmail: 'admin@example.com',
        actorRole: 'ADMIN' as const,
        action: 'USER_ROLE_UPDATE',
        targetType: 'User',
        targetId: 'target-1',
        beforeState: { role: 'USER' },
        afterState: { role: 'SUPPORT' },
        reason: 'Promotion',
        metadata: null,
        ipAddress: '127.0.0.1',
        createdAt: new Date().toISOString(),
        actor: { name: 'Admin User', image: null },
    },
];

describe('StaffAuditPortalClient', () => {
    it('renders audit log rows and filters', () => {
        render(
            <StaffAuditPortalClient
                initialLogs={sampleLogs}
                initialTotalCount={1}
            />
        );

        expect(screen.getByText('Staff Audit History')).toBeInTheDocument();
        expect(screen.getByText('USER_ROLE_UPDATE')).toBeInTheDocument();
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    });

    it('opens diff inspection modal when details button is clicked', () => {
        render(
            <StaffAuditPortalClient
                initialLogs={sampleLogs}
                initialTotalCount={1}
            />
        );

        const detailsButton = screen.getByRole('button', { name: /view diff/i });
        fireEvent.click(detailsButton);

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/before state/i)).toBeInTheDocument();
        expect(screen.getByText(/after state/i)).toBeInTheDocument();
    });

    it('executes dry run retention purge preview', async () => {
        const { purgeExpiredAuditLogsAction } = require('@/app/actions/staffAuditActions');
        (purgeExpiredAuditLogsAction as jest.Mock).mockResolvedValueOnce({
            success: true,
            dryRun: true,
            eligibleCount: 5,
        });

        render(
            <StaffAuditPortalClient
                initialLogs={sampleLogs}
                initialTotalCount={1}
            />
        );

        const reasonInput = screen.getByLabelText(/compliance purge reason/i);
        fireEvent.change(reasonInput, { target: { value: 'Compliance dry run' } });

        const dryRunBtn = screen.getByRole('button', { name: /preview purge/i });
        fireEvent.click(dryRunBtn);

        expect(purgeExpiredAuditLogsAction).toHaveBeenCalledWith({
            retentionDays: 365,
            reason: 'Compliance dry run',
            dryRun: true,
        });
        expect(await screen.findByText(/Dry Run Complete: 5 log\(s\)/i)).toBeInTheDocument();
    });

    it('opens StepUpModal for live purge and submits TOTP code', async () => {
        const { purgeExpiredAuditLogsAction } = require('@/app/actions/staffAuditActions');
        (purgeExpiredAuditLogsAction as jest.Mock).mockResolvedValueOnce({
            success: true,
            dryRun: false,
            deletedCount: 5,
        });

        render(
            <StaffAuditPortalClient
                initialLogs={sampleLogs}
                initialTotalCount={1}
            />
        );

        const reasonInput = screen.getByLabelText(/compliance purge reason/i);
        fireEvent.change(reasonInput, { target: { value: 'Annual purge' } });

        const livePurgeBtn = screen.getByRole('button', { name: /purge expired logs/i });
        fireEvent.click(livePurgeBtn);

        expect(screen.getByText('Authorize Audit Purge')).toBeInTheDocument();
        const codeInput = screen.getByLabelText(/security code/i);
        fireEvent.change(codeInput, { target: { value: '654321' } });

        const confirmBtn = screen.getByRole('button', { name: /confirm & authorize/i });
        fireEvent.click(confirmBtn);

        expect(purgeExpiredAuditLogsAction).toHaveBeenCalledWith({
            retentionDays: 365,
            reason: 'Annual purge',
            dryRun: false,
            stepUpCode: '654321',
        });
        expect(await screen.findByText(/Permanently removed 5 audit record\(s\)/i)).toBeInTheDocument();
    });

    it('includes User Points Adjustment in action filter dropdown, filters via searchStaffAuditLogsAction, and renders badge in audit table', async () => {
        const { searchStaffAuditLogsAction } = require('@/app/actions/staffAuditActions');
        const pointsLog = {
            id: 'log-points-1',
            actorId: 'u2',
            actorEmail: 'support@example.com',
            actorRole: 'SUPPORT' as const,
            action: 'USER_POINTS_ADJUSTMENT',
            targetType: 'User',
            targetId: 'target-user-99',
            beforeState: { points: 1000 },
            afterState: { points: 1500 },
            reason: 'Goodwill gesture for delayed flight',
            metadata: { delta: 500 },
            ipAddress: '127.0.0.1',
            createdAt: new Date().toISOString(),
            actor: { name: 'Support Agent', image: null },
        };
        (searchStaffAuditLogsAction as jest.Mock).mockResolvedValueOnce({
            success: true,
            logs: [pointsLog],
            totalCount: 1,
        });

        render(
            <StaffAuditPortalClient
                initialLogs={sampleLogs}
                initialTotalCount={1}
            />
        );

        const actionSelect = screen.getByLabelText(/action/i) as HTMLSelectElement;
        const option = screen.getByRole('option', { name: 'User Points Adjustment' }) as HTMLOptionElement;
        expect(option).toBeInTheDocument();
        expect(option.value).toBe('USER_POINTS_ADJUSTMENT');

        fireEvent.change(actionSelect, { target: { value: 'USER_POINTS_ADJUSTMENT' } });
        expect(actionSelect.value).toBe('USER_POINTS_ADJUSTMENT');

        const applyBtn = screen.getByRole('button', { name: /apply filters/i });
        fireEvent.click(applyBtn);

        expect(searchStaffAuditLogsAction).toHaveBeenCalledWith({
            limit: 50,
            action: 'USER_POINTS_ADJUSTMENT',
        });

        const badge = await screen.findByText('USER_POINTS_ADJUSTMENT');
        expect(badge).toBeInTheDocument();
        expect(screen.getByText('Goodwill gesture for delayed flight')).toBeInTheDocument();
        expect(screen.getByText('support@example.com')).toBeInTheDocument();
    });

    it('filters displayed rows via quick filter by target ID, reason, or actor email and shows empty state when no rows match', () => {
        const multipleLogs = [
            ...sampleLogs,
            {
                id: 'log-2',
                actorId: 'u2',
                actorEmail: 'ops@example.com',
                actorRole: 'OPERATIONS' as const,
                action: 'SCHEDULE_SET_ACTIVE',
                targetType: 'FlightSchedule',
                targetId: 'sched-42',
                beforeState: { isActive: false },
                afterState: { isActive: true },
                reason: 'Seasonal route activation',
                metadata: null,
                ipAddress: '127.0.0.1',
                createdAt: new Date().toISOString(),
                actor: { name: 'Ops User', image: null },
            },
        ];

        render(
            <StaffAuditPortalClient
                initialLogs={multipleLogs}
                initialTotalCount={2}
            />
        );

        const quickFilterInput = screen.getByTestId('audit-quick-filter');
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
        expect(screen.getByText('ops@example.com')).toBeInTheDocument();

        // Filter by target ID
        fireEvent.change(quickFilterInput, { target: { value: 'sched-42' } });
        expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
        expect(screen.getByText('ops@example.com')).toBeInTheDocument();

        // Filter by reason (case-insensitive)
        fireEvent.change(quickFilterInput, { target: { value: 'promotion' } });
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
        expect(screen.queryByText('ops@example.com')).not.toBeInTheDocument();

        // Filter by actor email
        fireEvent.change(quickFilterInput, { target: { value: 'OPS@EXAMPLE.COM' } });
        expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
        expect(screen.getByText('ops@example.com')).toBeInTheDocument();

        // Non-matching filter shows empty state
        fireEvent.change(quickFilterInput, { target: { value: 'nonexistent-query-xyz' } });
        expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
        expect(screen.queryByText('ops@example.com')).not.toBeInTheDocument();
        expect(screen.getByText('No audit logs on this page match the quick filter.')).toBeInTheDocument();

        // Clearing filter restores all rows
        fireEvent.change(quickFilterInput, { target: { value: '   ' } });
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
        expect(screen.getByText('ops@example.com')).toBeInTheDocument();
    });

    it('filters displayed audit logs by actor role using audit-role-filter', () => {
        const roleLogs = [
            ...sampleLogs,
            {
                id: 'log-support',
                actorId: 'u-sup',
                actorEmail: 'support@example.com',
                actorRole: 'SUPPORT' as const,
                action: 'USER_POINTS_ADJUSTMENT',
                targetType: 'User',
                targetId: 'target-sup',
                beforeState: { points: 100 },
                afterState: { points: 200 },
                reason: 'Support credit',
                metadata: null,
                ipAddress: '127.0.0.1',
                createdAt: new Date().toISOString(),
                actor: { name: 'Support Agent', image: null },
            },
            {
                id: 'log-ops',
                actorId: 'u-ops',
                actorEmail: 'ops@example.com',
                actorRole: 'OPERATIONS' as const,
                action: 'SCHEDULE_SET_ACTIVE',
                targetType: 'FlightSchedule',
                targetId: 'sched-ops',
                beforeState: { isActive: false },
                afterState: { isActive: true },
                reason: 'Ops schedule activation',
                metadata: null,
                ipAddress: '127.0.0.1',
                createdAt: new Date().toISOString(),
                actor: { name: 'Ops Agent', image: null },
            },
            {
                id: 'log-mod',
                actorId: 'u-mod',
                actorEmail: 'mod@example.com',
                actorRole: 'MODERATOR' as const,
                action: 'REVIEW_MODERATE',
                targetType: 'Review',
                targetId: 'rev-mod',
                beforeState: { status: 'PENDING' },
                afterState: { status: 'APPROVED' },
                reason: 'Moderator approval',
                metadata: null,
                ipAddress: '127.0.0.1',
                createdAt: new Date().toISOString(),
                actor: { name: 'Mod Agent', image: null },
            },
        ];

        render(
            <StaffAuditPortalClient
                initialLogs={roleLogs}
                initialTotalCount={4}
            />
        );

        const roleFilterSelect = screen.getByTestId('audit-role-filter') as HTMLSelectElement;
        expect(roleFilterSelect.value).toBe('ALL');

        // Filter by ADMIN
        fireEvent.change(roleFilterSelect, { target: { value: 'ADMIN' } });
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
        expect(screen.queryByText('support@example.com')).not.toBeInTheDocument();
        expect(screen.queryByText('ops@example.com')).not.toBeInTheDocument();
        expect(screen.queryByText('mod@example.com')).not.toBeInTheDocument();

        // Filter by SUPPORT
        fireEvent.change(roleFilterSelect, { target: { value: 'SUPPORT' } });
        expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
        expect(screen.getByText('support@example.com')).toBeInTheDocument();
        expect(screen.queryByText('ops@example.com')).not.toBeInTheDocument();
        expect(screen.queryByText('mod@example.com')).not.toBeInTheDocument();

        // Filter by OPERATIONS
        fireEvent.change(roleFilterSelect, { target: { value: 'OPERATIONS' } });
        expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
        expect(screen.queryByText('support@example.com')).not.toBeInTheDocument();
        expect(screen.getByText('ops@example.com')).toBeInTheDocument();
        expect(screen.queryByText('mod@example.com')).not.toBeInTheDocument();

        // Filter by MODERATOR
        fireEvent.change(roleFilterSelect, { target: { value: 'MODERATOR' } });
        expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
        expect(screen.queryByText('support@example.com')).not.toBeInTheDocument();
        expect(screen.queryByText('ops@example.com')).not.toBeInTheDocument();
        expect(screen.getByText('mod@example.com')).toBeInTheDocument();

        // Restore ALL
        fireEvent.change(roleFilterSelect, { target: { value: 'ALL' } });
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
        expect(screen.getByText('support@example.com')).toBeInTheDocument();
        expect(screen.getByText('ops@example.com')).toBeInTheDocument();
        expect(screen.getByText('mod@example.com')).toBeInTheDocument();
    });

    it('clears both audit-quick-filter and audit-role-filter back to all initial logs when Reset is clicked', () => {
        const multipleLogs = [
            ...sampleLogs,
            {
                id: 'log-2',
                actorId: 'u2',
                actorEmail: 'ops@example.com',
                actorRole: 'OPERATIONS' as const,
                action: 'SCHEDULE_SET_ACTIVE',
                targetType: 'FlightSchedule',
                targetId: 'sched-42',
                beforeState: { isActive: false },
                afterState: { isActive: true },
                reason: 'Seasonal route activation',
                metadata: null,
                ipAddress: '127.0.0.1',
                createdAt: new Date().toISOString(),
                actor: { name: 'Ops User', image: null },
            },
        ];

        render(
            <StaffAuditPortalClient
                initialLogs={multipleLogs}
                initialTotalCount={2}
            />
        );

        const quickFilterInput = screen.getByTestId('audit-quick-filter') as HTMLInputElement;
        const roleFilterSelect = screen.getByTestId('audit-role-filter') as HTMLSelectElement;

        fireEvent.change(roleFilterSelect, { target: { value: 'MODERATOR' } });
        expect(screen.getByText('No audit logs on this page match the quick filter.')).toBeInTheDocument();

        fireEvent.change(quickFilterInput, { target: { value: 'sched-42' } });
        expect(quickFilterInput.value).toBe('sched-42');
        expect(roleFilterSelect.value).toBe('MODERATOR');

        const resetBtn = screen.getByRole('button', { name: /reset/i });
        fireEvent.click(resetBtn);

        expect(quickFilterInput.value).toBe('');
        expect(roleFilterSelect.value).toBe('ALL');
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
        expect(screen.getByText('ops@example.com')).toBeInTheDocument();
    });
});



