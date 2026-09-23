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
});
