import React from 'react';
import Link from 'next/link';
import PaymentRecoveryQueue from '@/components/ui/PaymentRecoveryQueue';
import { listStalePaymentAttempts } from '@/lib/paymentRecovery';

export const dynamic = 'force-dynamic';

export default async function AdminPaymentsPage() {
    const attempts = await listStalePaymentAttempts();

    return (
        <main
            className="page-container admin"
            style={{
                marginTop: '100px',
                padding: '2rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.5rem',
            }}
        >
            <div>
                <Link href="/admin" style={{ color: '#c4b5fd' }}>
                    ← Admin control center
                </Link>
                <h1 style={{ color: '#fff', margin: '0.75rem 0 0' }}>
                    Payment recovery
                </h1>
            </div>
            <PaymentRecoveryQueue
                initialAttempts={attempts.map(attempt => ({
                    ...attempt,
                    updatedAt: attempt.updatedAt.toISOString(),
                }))}
            />
        </main>
    );
}
