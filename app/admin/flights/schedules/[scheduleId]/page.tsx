import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatPrice } from '@/lib/bookingPricing';
import { FlightScheduleImpactService } from '@/lib/flightScheduleImpact';
import { durationLabel } from '@/lib/flightTime';
import FlightScheduleTermsForm from '@/components/ui/FlightScheduleTermsForm';
import FlightScheduleActivationForm from '@/components/ui/FlightScheduleActivationForm';
import FlightScheduleDeletionForm from '@/components/ui/FlightScheduleDeletionForm';
import ScheduleOccurrencesTableClient from '@/components/admin/ScheduleOccurrencesTableClient';

export const dynamic = 'force-dynamic';

function countLabel(count: number, singular: string, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

export default async function ScheduleImpactPage({
    params,
}: {
    params: Promise<{ scheduleId: string }>;
}) {
    const { scheduleId: rawScheduleId } = await params;
    if (!/^[1-9]\d*$/.test(rawScheduleId)) notFound();
    const scheduleId = Number(rawScheduleId);
    if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0) notFound();

    const impact = await new FlightScheduleImpactService().forSchedule(scheduleId);
    if (!impact) notFound();

    return (
        <main
            className="page-container admin p-8"
            style={{ marginTop: '100px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h1 style={{ color: '#fff', margin: 0, fontSize: '2rem' }}>Schedule impact preview</h1>
                    <p style={{ color: '#c4b5fd', margin: '8px 0 0', fontSize: '1.1rem', fontWeight: 700 }}>
                        {impact.schedule.airline} {impact.schedule.flightNumber}
                    </p>
                    <p style={{ color: 'rgba(255, 255, 255, 0.72)', margin: '4px 0 0' }}>
                        {impact.schedule.from} → {impact.schedule.to} · {durationLabel(impact.schedule.durationMinutes)} · {formatPrice(impact.schedule.priceCents)}
                    </p>
                    <p style={{ color: 'rgba(255, 255, 255, 0.58)', margin: '4px 0 0', fontSize: '0.85rem' }}>
                        {`Award quotas: ${impact.schedule.awardSeatsFirst ?? 1}F / ${impact.schedule.awardSeatsBusiness ?? 2}J / ${impact.schedule.awardSeatsPremiumEconomy ?? 2}W / ${impact.schedule.awardSeatsEconomy ?? 4}Y`}
                    </p>
                    <p style={{ color: impact.schedule.isActive ? '#86efac' : '#fbbf24', margin: '4px 0 0', fontWeight: 700 }}>
                        {impact.schedule.isActive ? 'Active template' : 'Inactive template'}
                    </p>
                </div>
                <Link href="/admin/flights" style={{ color: '#7dd3fc', fontWeight: 700 }}>
                    ← Back to flight schedules
                </Link>
            </div>

            <section
                aria-labelledby="preview-safety-heading"
                className="admin-card"
                style={{ borderColor: 'rgba(125, 211, 252, 0.45)', marginBottom: 0 }}
            >
                <h2 id="preview-safety-heading" style={{ color: '#7dd3fc', margin: '0 0 8px', fontSize: '1.15rem' }}>
                    Impact preview
                </h2>
                <p style={{ color: '#e5e7eb', margin: 0 }}>
                    Nothing changes until you confirm an action below. The preview defines which linked occurrences must remain protected.
                </p>
                <p style={{ color: 'rgba(255, 255, 255, 0.65)', margin: '8px 0 0', fontSize: '0.9rem' }}>
                    Only occurrences with durable provenance for this template are included. Unlinked or ambiguous history is never guessed into this preview.
                </p>
            </section>

            <section aria-labelledby="impact-summary-heading" className="admin-card" style={{ marginBottom: 0 }}>
                <h2 id="impact-summary-heading" style={{ color: '#c084fc', margin: '0 0 1rem', fontSize: '1.35rem' }}>
                    Impact summary
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
                    <SummaryCard value={countLabel(impact.summary.safeFuture, 'safe future occurrence')} label="Eligible by this preview policy" color="#4ade80" />
                    <SummaryCard value={countLabel(impact.summary.protected, 'protected', 'protected')} label="Will require preservation" color="#fbbf24" />
                    <SummaryCard value={countLabel(impact.summary.total, 'linked occurrence')} label="Included in this preview" color="#7dd3fc" />
                </div>
                <p style={{ color: 'rgba(255, 255, 255, 0.7)', margin: '14px 0 0', lineHeight: 1.6 }}>
                    {countLabel(impact.summary.historical, 'historical', 'historical')} ·{' '}
                    {countLabel(impact.summary.bookingHistory, 'with booking history', 'with booking history')} ·{' '}
                    {countLabel(impact.summary.activeCheckout, 'in an active checkout', 'in active checkouts')} ·{' '}
                    {countLabel(impact.summary.operationalOverride, 'with an operational override', 'with operational overrides')}
                </p>
                <p style={{ color: 'rgba(255, 255, 255, 0.5)', margin: '6px 0 0', fontSize: '0.8rem' }}>
                    Preview time: {impact.asOf.toISOString()}
                </p>
            </section>

            <FlightScheduleTermsForm
                flightScheduleId={impact.schedule.id}
                durationMinutes={impact.schedule.durationMinutes}
                priceCents={impact.schedule.priceCents}
                safeFutureCount={impact.summary.safeFuture}
                protectedCount={impact.summary.protected}
                initialAwardSeatsFirst={impact.schedule.awardSeatsFirst}
                initialAwardSeatsBusiness={impact.schedule.awardSeatsBusiness}
                initialAwardSeatsPremiumEconomy={impact.schedule.awardSeatsPremiumEconomy}
                initialAwardSeatsEconomy={impact.schedule.awardSeatsEconomy}
            />

            <FlightScheduleActivationForm
                flightScheduleId={impact.schedule.id}
                isActive={impact.schedule.isActive}
                occurrenceCount={impact.summary.total}
            />

            {!impact.schedule.isActive && (
                <FlightScheduleDeletionForm
                    flightScheduleId={impact.schedule.id}
                    occurrenceCount={impact.summary.total}
                    protectedOccurrenceCount={impact.summary.protected}
                />
            )}

            <section aria-labelledby="linked-occurrences-heading" className="admin-card" style={{ marginBottom: 0 }}>
                <h2 id="linked-occurrences-heading" style={{ color: '#c084fc', margin: '0 0 1rem', fontSize: '1.35rem' }}>
                    Linked occurrences
                </h2>
                <ScheduleOccurrencesTableClient occurrences={impact.occurrences} />
            </section>
        </main>
    );
}

function SummaryCard({ value, label, color }: { value: string; label: string; color: string }) {
    return (
        <div style={{ border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '10px', padding: '14px', background: 'rgba(255, 255, 255, 0.025)' }}>
            <strong style={{ color, display: 'block', fontSize: '1.35rem' }}>{value}</strong>
            <span style={{ color: 'rgba(255, 255, 255, 0.65)', fontSize: '0.82rem' }}>{label}</span>
        </div>
    );
}
