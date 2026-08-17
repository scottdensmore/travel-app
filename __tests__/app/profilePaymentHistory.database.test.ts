/** @jest-environment node */

import React from 'react';
import { randomUUID } from 'node:crypto';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { airportCodesForRoute } from '@/lib/airports';
import { formatAccountDateTime } from '@/lib/accountTimeZone';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

import ProfilePage from '@/app/profile/page';

const mockedGetServerSession = getServerSession as unknown as jest.Mock;
const created = {
    bookingIds: [] as number[],
    flightIds: [] as number[],
    paymentAttemptIds: [] as string[],
    userIds: [] as string[],
};

let bookingId: number;
let bookingCreatedAt: Date;
let paymentAttemptId: string;
let providerIntentId: string;
let checkoutId: string;
let bookingIdempotencyKey: string;
let capturedAt: Date;
let userId: string;

beforeAll(async () => {
    userId = `receipt-user-${randomUUID()}`;
    const user = await prisma.user.create({
        data: {
            id: userId,
            email: `receipt-${randomUUID()}@example.com`,
            timeZone: 'America/Los_Angeles',
        },
    });
    created.userIds.push(user.id);

    const flight = await prisma.flight.create({
        data: {
            flightNumber: `RCT-${randomUUID().slice(0, 8)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            priceCents: 66_000,
        },
    });
    created.flightIds.push(flight.id);

    paymentAttemptId = randomUUID();
    providerIntentId = `pi_receipt_${randomUUID().replaceAll('-', '')}`;
    checkoutId = randomUUID();
    const paymentAttempt = await prisma.paymentAttempt.create({
        data: {
            id: paymentAttemptId,
            checkoutId,
            userId,
            requestFingerprint: 'a'.repeat(64),
            amountCents: 66_000,
            currency: 'USD',
            providerIntentId,
            status: 'CAPTURED',
            createdAt: new Date('2026-06-01T10:00:00Z'),
        },
    });
    capturedAt = paymentAttempt.capturedAt!;
    created.paymentAttemptIds.push(paymentAttemptId);

    bookingIdempotencyKey = `booking-${randomUUID()}`;
    const booking = await prisma.booking.create({
        data: {
            userId,
            paymentIntentId: providerIntentId,
            totalPriceCents: 66_000,
            currency: 'USD',
            idempotencyKey: bookingIdempotencyKey,
            legs: { create: [{ sequence: 1, flightId: flight.id }] },
        },
    });
    bookingId = booking.id;
    bookingCreatedAt = booking.createdAt;
    created.bookingIds.push(booking.id);
});

afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
    await prisma.paymentAttempt.deleteMany({ where: { id: { in: created.paymentAttemptIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

beforeEach(() => {
    mockedGetServerSession.mockResolvedValue({ user: { id: userId, name: 'Receipt Traveller' } });
});

async function profileProps() {
    const page = await ProfilePage();
    expect(React.isValidElement(page)).toBe(true);
    return (page as React.ReactElement<{
        accountTimeZone: string;
        accountTimeZoneChoices: string[];
        activityData: Array<{ date: string; description: string; points: number }>;
        bookings: Array<Record<string, unknown>>;
    }>).props;
}

async function profileBookings() {
    return (await profileProps()).bookings;
}

describe('customer-safe profile payment history', () => {
    it('hands the saved account timezone and the complete choice boundary to the client', async () => {
        const props = await profileProps();

        expect(props.accountTimeZone).toBe('America/Los_Angeles');
        expect(props.accountTimeZoneChoices[0]).toBe('UTC');
        expect(props.accountTimeZoneChoices).toContain('America/Los_Angeles');
        expect(props.activityData[0].date)
            .toBe(formatAccountDateTime(bookingCreatedAt, 'America/Los_Angeles'));
    });

    it('hands the client a truthful UTC fallback for an unknown saved zone', async () => {
        await prisma.user.update({
            where: { id: userId },
            data: { timeZone: 'Not/AZone' },
        });

        try {
            const props = await profileProps();
            expect(props.accountTimeZone).toBe('UTC');
            expect(props.activityData[0].date)
                .toBe(formatAccountDateTime(bookingCreatedAt, 'UTC'));
        } finally {
            await prisma.user.update({
                where: { id: userId },
                data: { timeZone: 'America/Los_Angeles' },
            });
        }
    });

    it('projects only receipt fields for a captured booking', async () => {
        const booking = (await profileBookings()).find(row => row.id === bookingId);

        expect(booking).toMatchObject({
            id: bookingId,
            paymentReceipt: {
                amountCents: 66_000,
                currency: 'USD',
                paidAt: capturedAt,
            },
        });
        expect(capturedAt).not.toEqual(new Date('2026-06-01T10:00:00Z'));
        expect(Object.keys(booking?.paymentReceipt as object).sort())
            .toEqual(['amountCents', 'currency', 'paidAt']);
        expect(booking).not.toHaveProperty('paymentIntentId');
        expect(booking).not.toHaveProperty('idempotencyKey');
        expect(booking).not.toHaveProperty('userId');
        const serialized = JSON.stringify(booking);
        expect(serialized).not.toContain(providerIntentId);
        expect(serialized).not.toContain(paymentAttemptId);
        expect(serialized).not.toContain(checkoutId);
        expect(serialized).not.toContain(bookingIdempotencyKey);
        expect(serialized).not.toContain('a'.repeat(64));
    });

    it('does not call an unsettled authorization a payment receipt', async () => {
        const authorizedAttemptId = randomUUID();
        const authorizedProviderIntentId = `pi_receipt_${randomUUID().replaceAll('-', '')}`;
        await prisma.paymentAttempt.create({
            data: {
                id: authorizedAttemptId,
                checkoutId: randomUUID(),
                userId,
                requestFingerprint: 'b'.repeat(64),
                amountCents: 66_000,
                providerIntentId: authorizedProviderIntentId,
                status: 'AUTHORIZED',
            },
        });
        created.paymentAttemptIds.push(authorizedAttemptId);
        const booking = await prisma.booking.create({
            data: {
                userId,
                paymentIntentId: authorizedProviderIntentId,
                totalPriceCents: 66_000,
                currency: 'USD',
                idempotencyKey: `booking-${randomUUID()}`,
                legs: { create: [{ sequence: 1, flightId: created.flightIds[0] }] },
            },
        });
        created.bookingIds.push(booking.id);

        const projected = (await profileBookings()).find(row => row.id === booking.id);
        expect(projected).toMatchObject({ id: booking.id, paymentReceipt: null });
    });
});
