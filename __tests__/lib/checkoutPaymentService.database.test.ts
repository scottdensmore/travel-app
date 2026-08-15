/** @jest-environment node */

import { createHash, randomUUID } from 'node:crypto';
import { airportCodesForRoute } from '@/lib/airports';
import { CheckoutPaymentService } from '@/lib/checkoutPaymentService';
import { PaymentWebhookService } from '@/lib/paymentWebhookService';
import { lockFlightForUpdate } from '@/lib/flightLock';
import { checkoutHolderKey, holdSeat, holdSeats } from '@/lib/seatHolds';
import { prisma } from '@/lib/prisma';
import type { PaymentProvider } from '@/lib/stripePaymentProvider';

jest.mock('@/lib/flightLock', () => {
    const actual = jest.requireActual<typeof import('@/lib/flightLock')>('@/lib/flightLock');
    return { ...actual, lockFlightForUpdate: jest.fn(actual.lockFlightForUpdate) };
});

const created = {
    bookingIds: [] as number[],
    flightIds: [] as number[],
    userIds: [] as string[],
};

async function fixture() {
    const suffix = randomUUID();
    const user = await prisma.user.create({
        data: {
            name: 'Payment Traveller',
            email: `payment-${suffix}@example.com`,
            password: 'not-used',
            emailVerified: new Date(),
        },
    });
    const flight = await createFlight(30_000, suffix);
    created.userIds.push(user.id);
    return { user, flight };
}

async function createFlight(priceCents: number, suffix = randomUUID()) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `PAY-${suffix.slice(0, 8)}`,
            airline: 'Mona Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            priceCents,
            firstClassRows: 0,
            businessRows: 10,
            premiumEconomyRows: 0,
            economyRows: 20,
            seatPattern: 'ABC-DEF',
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

function request(userId: string, flightId: number, checkoutId: string, seatNumber = '2A') {
    return {
        userId,
        checkoutId,
        flightIds: [flightId],
        passengers: [{ seatNumbers: [seatNumber], cabinClass: 'BUSINESS' as const }],
    };
}

function provider() {
    const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
    const clientSecret = `${providerIntentId}_secret_for_elements`;
    const createAuthorization = jest.fn().mockResolvedValue({
        providerIntentId,
        clientSecret,
        status: 'REQUIRES_PAYMENT_METHOD' as const,
    });
    const retrieveAuthorization = jest.fn().mockResolvedValue({
        providerIntentId,
        clientSecret,
        status: 'AUTHORIZED' as const,
    });
    const captureAuthorization = jest.fn().mockResolvedValue({
        providerIntentId,
        clientSecret,
        status: 'CAPTURED' as const,
    });
    const cancelAuthorization = jest.fn().mockResolvedValue({
        providerIntentId,
        clientSecret,
        status: 'CANCELLED' as const,
    });
    return {
        value: {
            createAuthorization,
            retrieveAuthorization,
            captureAuthorization,
            cancelAuthorization,
        } satisfies PaymentProvider,
        createAuthorization,
        retrieveAuthorization,
        captureAuthorization,
        cancelAuthorization,
        providerIntentId,
        clientSecret,
    };
}

afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
    await prisma.paymentAttempt.deleteMany({ where: { userId: { in: created.userIds } } });
    await prisma.seatHold.deleteMany({ where: { flightId: { in: created.flightIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('starting a checkout payment', () => {
    it('creates a manual-capture session from the server fare and persists no client secret', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();
        fake.retrieveAuthorization.mockResolvedValueOnce({
            providerIntentId: fake.providerIntentId,
            clientSecret: fake.clientSecret,
            status: 'REQUIRES_PAYMENT_METHOD',
        });

        await expect(new CheckoutPaymentService(fake.value).startPayment(
            request(user.id, flight.id, checkoutId),
        )).resolves.toEqual({
            amountCents: 60_000,
            currency: 'USD',
            clientSecret: fake.clientSecret,
            providerIntentId: fake.providerIntentId,
            status: 'REQUIRES_PAYMENT_METHOD',
        });
        expect(fake.createAuthorization).toHaveBeenCalledWith({
            attemptId: expect.any(String),
            amountCents: 60_000,
            currency: 'USD',
        });

        const saved = await prisma.paymentAttempt.findUniqueOrThrow({
            where: { userId_checkoutId: { userId: user.id, checkoutId } },
        });
        expect(saved).toMatchObject({
            amountCents: 60_000,
            currency: 'USD',
            providerIntentId: fake.providerIntentId,
            status: 'REQUIRES_PAYMENT_METHOD',
        });
        expect(JSON.stringify(saved)).not.toContain(fake.clientSecret);
    });

    it('retrieves the persisted provider intent on an idempotent retry', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();
        const service = new CheckoutPaymentService(fake.value);
        const input = request(user.id, flight.id, checkoutId);

        await service.startPayment(input);
        await expect(service.startPayment(input)).resolves.toMatchObject({ status: 'AUTHORIZED' });

        expect(fake.createAuthorization).toHaveBeenCalledTimes(1);
        expect(fake.retrieveAuthorization).toHaveBeenCalledWith(fake.providerIntentId);
        expect(await prisma.paymentAttempt.count({ where: { userId: user.id, checkoutId } })).toBe(1);
    });

    it('retrieves a booked checkout after its consumed seat hold is gone', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();
        const service = new CheckoutPaymentService(fake.value);
        const input = request(user.id, flight.id, checkoutId);
        await service.startPayment(input);
        const saved = await prisma.booking.create({
            data: {
                userId: user.id,
                idempotencyKey: checkoutId,
                paymentIntentId: fake.providerIntentId,
            },
        });
        created.bookingIds.push(saved.id);
        await prisma.seatHold.deleteMany({ where: { flightId: flight.id } });

        await expect(service.startPayment(input)).resolves.toMatchObject({
            providerIntentId: fake.providerIntentId,
            status: 'AUTHORIZED',
        });
        expect(fake.createAuthorization).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite webhook state with a stale PaymentIntent create response', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const clientSecret = `${providerIntentId}_secret_for_elements`;
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const retrievePaymentState = jest.fn();
        const retrieveAuthorization = jest.fn().mockResolvedValue({
            providerIntentId,
            clientSecret,
            status: 'AUTHORIZED' as const,
        });
        const createAuthorization = jest.fn().mockImplementation(async ({ attemptId }) => {
            retrievePaymentState.mockResolvedValue({
                providerIntentId,
                paymentAttemptId: attemptId,
                status: 'AUTHORIZED' as const,
            });
            await new PaymentWebhookService({ retrievePaymentState }).reconcile({
                eventId: `evt_${randomUUID()}`,
                eventType: 'payment_intent.amount_capturable_updated',
                providerIntentId,
            });
            return {
                providerIntentId,
                clientSecret,
                status: 'REQUIRES_PAYMENT_METHOD' as const,
            };
        });

        await expect(new CheckoutPaymentService({
            createAuthorization,
            retrieveAuthorization,
            captureAuthorization: jest.fn(),
            cancelAuthorization: jest.fn(),
        }).startPayment(request(user.id, flight.id, checkoutId))).resolves.toMatchObject({
            status: 'AUTHORIZED',
        });
        expect(retrieveAuthorization).toHaveBeenCalledWith(providerIntentId);
        await expect(prisma.paymentAttempt.findUniqueOrThrow({
            where: { userId_checkoutId: { userId: user.id, checkoutId } },
        })).resolves.toMatchObject({ status: 'AUTHORIZED' });
    });

    it('serialises a checkout retry with webhook reconciliation for the same intent', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        const providerIntentId = `pi_${randomUUID().replaceAll('-', '')}`;
        const clientSecret = `${providerIntentId}_secret_for_elements`;
        const input = request(user.id, flight.id, checkoutId);
        const requestFingerprint = createHash('sha256').update(JSON.stringify([
            checkoutId,
            input.flightIds,
            input.passengers.map(passenger => [passenger.seatNumbers, passenger.cabinClass]),
        ])).digest('hex');
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const saved = await prisma.paymentAttempt.create({
            data: {
                id: randomUUID(),
                userId: user.id,
                checkoutId,
                requestFingerprint,
                amountCents: 60_000,
                currency: 'USD',
                providerIntentId,
                status: 'REQUIRES_PAYMENT_METHOD',
            },
        });
        let releaseCheckout!: () => void;
        let checkoutRetrieveStarted!: () => void;
        const checkoutRelease = new Promise<void>(resolve => { releaseCheckout = resolve; });
        const retrieveStarted = new Promise<void>(resolve => { checkoutRetrieveStarted = resolve; });
        const retrieveAuthorization = jest.fn().mockImplementation(async () => {
            checkoutRetrieveStarted();
            await checkoutRelease;
            return {
                providerIntentId,
                clientSecret,
                status: 'REQUIRES_PAYMENT_METHOD' as const,
            };
        });
        const checkout = new CheckoutPaymentService({
            createAuthorization: jest.fn(),
            retrieveAuthorization,
            captureAuthorization: jest.fn(),
            cancelAuthorization: jest.fn(),
        }).startPayment(input);
        await retrieveStarted;

        const retrievePaymentState = jest.fn().mockResolvedValue({
            providerIntentId,
            paymentAttemptId: saved.id,
            status: 'AUTHORIZED' as const,
        });
        const webhook = new PaymentWebhookService({ retrievePaymentState }).reconcile({
            eventId: `evt_${randomUUID()}`,
            eventType: 'payment_intent.amount_capturable_updated',
            providerIntentId,
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        const webhookCallsBeforeRelease = retrievePaymentState.mock.calls.length;

        releaseCheckout();
        await Promise.all([checkout, webhook]);

        expect(webhookCallsBeforeRelease).toBe(0);
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: saved.id } }))
            .resolves.toMatchObject({ status: 'AUTHORIZED' });
    });

    it('rejects a changed request that reuses a checkout payment ID', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        const holderKey = checkoutHolderKey(user.id, checkoutId);
        await holdSeats([
            { flightId: flight.id, seatNumber: '2A', holderKey },
            { flightId: flight.id, seatNumber: '2B', holderKey },
        ]);
        const fake = provider();
        const service = new CheckoutPaymentService(fake.value);
        await service.startPayment(request(user.id, flight.id, checkoutId));
        fake.retrieveAuthorization.mockClear();

        await expect(service.startPayment({
            ...request(user.id, flight.id, checkoutId),
            passengers: [{ seatNumbers: ['2B'], cabinClass: 'BUSINESS' as const }],
        })).rejects.toThrow('Checkout payment ID was already used for a different request.');
        expect(fake.createAuthorization).toHaveBeenCalledTimes(1);
        expect(fake.retrieveAuthorization).not.toHaveBeenCalled();
    });

    it('does not create a payment attempt when the checkout no longer owns the seat', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        const fake = provider();

        await expect(new CheckoutPaymentService(fake.value).startPayment(
            request(user.id, flight.id, checkoutId),
        )).rejects.toThrow('Seat 2A is no longer held for this checkout.');
        expect(fake.createAuthorization).not.toHaveBeenCalled();
        expect(await prisma.paymentAttempt.count({ where: { userId: user.id } })).toBe(0);
    });

    it('does not treat an expired hold as payment inventory', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        const holderKey = checkoutHolderKey(user.id, checkoutId);
        await holdSeat({ flightId: flight.id, seatNumber: '2A', holderKey });
        await prisma.$executeRaw`
            UPDATE "SeatHold"
            SET "createdAt" = statement_timestamp() - interval '11 minutes',
                "expiresAt" = statement_timestamp() - interval '1 minute'
            WHERE "flightId" = ${flight.id} AND "seatNumber" = '2A'
        `;
        const fake = provider();

        await expect(new CheckoutPaymentService(fake.value).startPayment(
            request(user.id, flight.id, checkoutId),
        )).rejects.toThrow('Seat 2A is no longer held for this checkout.');
        expect(fake.createAuthorization).not.toHaveBeenCalled();
        expect(await prisma.paymentAttempt.count({ where: { userId: user.id } })).toBe(0);
    });

    it('rejects a flight that does not exist', async () => {
        const { user } = await fixture();
        const latestFlight = await prisma.flight.findFirst({
            orderBy: { id: 'desc' },
            select: { id: true },
        });
        const missingFlightId = (latestFlight?.id ?? 0) + 1;
        const fake = provider();

        await expect(new CheckoutPaymentService(fake.value).startPayment(
            request(user.id, missingFlightId, randomUUID()),
        )).rejects.toThrow('Flight not found');
        expect(fake.createAuthorization).not.toHaveBeenCalled();
    });

    it('rejects a cancelled flight', async () => {
        const { user, flight } = await fixture();
        await prisma.flight.update({
            where: { id: flight.id },
            data: { status: 'CANCELLED' },
        });
        const fake = provider();

        await expect(new CheckoutPaymentService(fake.value).startPayment(
            request(user.id, flight.id, randomUUID()),
        )).rejects.toThrow('Flight is not available for booking.');
        expect(fake.createAuthorization).not.toHaveBeenCalled();
    });

    it('rejects a departed flight', async () => {
        const { user, flight } = await fixture();
        await prisma.flight.update({
            where: { id: flight.id },
            data: { departureDate: new Date(Date.now() - 60_000) },
        });
        const fake = provider();

        await expect(new CheckoutPaymentService(fake.value).startPayment(
            request(user.id, flight.id, randomUUID()),
        )).rejects.toThrow('Flight is not available for booking.');
        expect(fake.createAuthorization).not.toHaveBeenCalled();
    });

    it('rejects a held seat that does not belong to the submitted cabin', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();

        await expect(new CheckoutPaymentService(fake.value).startPayment({
            ...request(user.id, flight.id, checkoutId),
            passengers: [{ seatNumbers: ['2A'], cabinClass: 'ECONOMY' }],
        })).rejects.toThrow('Seat 2A is not available for ECONOMY on this flight.');
        expect(fake.createAuthorization).not.toHaveBeenCalled();
    });

    it('reuses the durable attempt after a provider failure', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();
        fake.createAuthorization.mockRejectedValueOnce(new Error('provider unavailable'));
        const service = new CheckoutPaymentService(fake.value);
        const input = request(user.id, flight.id, checkoutId);

        await expect(service.startPayment(input)).rejects.toThrow('provider unavailable');
        const pending = await prisma.paymentAttempt.findUniqueOrThrow({
            where: { userId_checkoutId: { userId: user.id, checkoutId } },
        });
        expect(pending).toMatchObject({ status: 'CREATING', providerIntentId: null });

        await expect(service.startPayment(input)).resolves.toMatchObject({
            clientSecret: fake.clientSecret,
        });
        expect(fake.createAuthorization).toHaveBeenCalledTimes(2);
        expect(fake.createAuthorization.mock.calls.map(([call]) => call.attemptId))
            .toEqual([pending.id, pending.id]);
        expect(await prisma.paymentAttempt.count({ where: { userId: user.id, checkoutId } })).toBe(1);
    });

    it('gives concurrent starts the same durable provider idempotency key', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();
        const service = new CheckoutPaymentService(fake.value);
        const input = request(user.id, flight.id, checkoutId);

        await expect(Promise.all([
            service.startPayment(input),
            service.startPayment(input),
        ])).resolves.toHaveLength(2);

        expect(await prisma.paymentAttempt.count({ where: { userId: user.id, checkoutId } })).toBe(1);
        expect(new Set(fake.createAuthorization.mock.calls.map(([call]) => call.attemptId)).size)
            .toBe(1);
    });

    it('prices every passenger on every leg from server fares', async () => {
        const { user, flight } = await fixture();
        const returnFlight = await createFlight(20_000);
        const checkoutId = randomUUID();
        const holderKey = checkoutHolderKey(user.id, checkoutId);
        await holdSeats([
            { flightId: flight.id, seatNumber: '2A', holderKey },
            { flightId: flight.id, seatNumber: '2B', holderKey },
            { flightId: returnFlight.id, seatNumber: '2A', holderKey },
            { flightId: returnFlight.id, seatNumber: '2B', holderKey },
        ]);
        const fake = provider();

        await expect(new CheckoutPaymentService(fake.value).startPayment({
            userId: user.id,
            checkoutId,
            flightIds: [flight.id, returnFlight.id],
            passengers: [
                { seatNumbers: ['2A', '2A'], cabinClass: 'BUSINESS' },
                { seatNumbers: ['2B', '2B'], cabinClass: 'BUSINESS' },
            ],
        })).resolves.toMatchObject({ amountCents: 200_000 });
        expect(fake.createAuthorization).toHaveBeenCalledWith(expect.objectContaining({
            amountCents: 200_000,
        }));
    });

    it('checks every passenger hold on every leg before creating a payment', async () => {
        const { user, flight } = await fixture();
        const returnFlight = await createFlight(20_000);
        const checkoutId = randomUUID();
        const holderKey = checkoutHolderKey(user.id, checkoutId);
        await holdSeats([
            { flightId: flight.id, seatNumber: '2A', holderKey },
            { flightId: flight.id, seatNumber: '2B', holderKey },
            { flightId: returnFlight.id, seatNumber: '2A', holderKey },
            // The second traveller's return hold is deliberately absent.
        ]);
        const fake = provider();

        await expect(new CheckoutPaymentService(fake.value).startPayment({
            userId: user.id,
            checkoutId,
            flightIds: [flight.id, returnFlight.id],
            passengers: [
                { seatNumbers: ['2A', '2A'], cabinClass: 'BUSINESS' },
                { seatNumbers: ['2B', '2B'], cabinClass: 'BUSINESS' },
            ],
        })).rejects.toThrow('Seat 2B is no longer held for this checkout.');
        expect(fake.createAuthorization).not.toHaveBeenCalled();
        expect(await prisma.paymentAttempt.count({ where: { userId: user.id } })).toBe(0);
    });

    it('serialises changed requests that use one checkout ID on disjoint flights', async () => {
        const { user, flight } = await fixture();
        const otherFlight = await createFlight(20_000);
        const checkoutId = randomUUID();
        const holderKey = checkoutHolderKey(user.id, checkoutId);
        await holdSeats([
            { flightId: flight.id, seatNumber: '2A', holderKey },
            { flightId: otherFlight.id, seatNumber: '2A', holderKey },
        ]);
        const fake = provider();
        const service = new CheckoutPaymentService(fake.value);

        const settled = await Promise.allSettled([
            service.startPayment(request(user.id, flight.id, checkoutId)),
            service.startPayment(request(user.id, otherFlight.id, checkoutId)),
        ]);

        expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = settled.find(result => result.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toEqual(new Error(
            'Checkout payment ID was already used for a different request.',
        ));
        expect(await prisma.paymentAttempt.count({ where: { userId: user.id, checkoutId } })).toBe(1);
    });

    it('locks every flight in stable ascending order before checking inventory', async () => {
        const { user, flight } = await fixture();
        const returnFlight = await createFlight(20_000);
        const checkoutId = randomUUID();
        const holderKey = checkoutHolderKey(user.id, checkoutId);
        await holdSeats([
            { flightId: flight.id, seatNumber: '2A', holderKey },
            { flightId: returnFlight.id, seatNumber: '2A', holderKey },
        ]);
        const fake = provider();
        const lockSpy = jest.mocked(lockFlightForUpdate);
        lockSpy.mockClear();

        try {
            await new CheckoutPaymentService(fake.value).startPayment({
                userId: user.id,
                checkoutId,
                flightIds: [returnFlight.id, flight.id],
                passengers: [{ seatNumbers: ['2A', '2A'], cabinClass: 'BUSINESS' }],
            });

            expect(lockSpy.mock.calls.map(([, flightId]) => flightId)).toEqual(
                [flight.id, returnFlight.id].sort((left, right) => left - right),
            );
        } finally {
            lockSpy.mockClear();
        }
    });
});

describe('settling a checkout payment', () => {
    async function authorizedFixture() {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();
        const service = new CheckoutPaymentService(fake.value);
        await service.startPayment(request(user.id, flight.id, checkoutId));
        const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
            where: { userId_checkoutId: { userId: user.id, checkoutId } },
        });
        const booking = await prisma.booking.create({
            data: {
                userId: user.id,
                idempotencyKey: checkoutId,
                paymentIntentId: fake.providerIntentId,
                totalPriceCents: attempt.amountCents,
                currency: attempt.currency,
            },
        });
        created.bookingIds.push(booking.id);
        return { user, checkoutId, fake, service, attempt, booking };
    }

    it('captures the exact authorized amount for the linked booking', async () => {
        const { user, checkoutId, fake, service, attempt, booking } = await authorizedFixture();

        await expect(service.capturePayment({
            userId: user.id,
            checkoutId,
            bookingId: booking.id,
        })).resolves.toEqual({ status: 'CAPTURED', wasCaptured: true });
        expect(fake.captureAuthorization).toHaveBeenCalledWith({
            providerIntentId: fake.providerIntentId,
            attemptId: attempt.id,
            amountCents: attempt.amountCents,
        });
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
            .resolves.toMatchObject({ status: 'CAPTURED' });
    });

    it('reconciles a capture whose Stripe response was lost', async () => {
        const { user, checkoutId, fake, service, attempt, booking } = await authorizedFixture();
        fake.captureAuthorization.mockRejectedValueOnce(new Error('connection ended after capture'));
        fake.retrieveAuthorization.mockResolvedValueOnce({
            providerIntentId: fake.providerIntentId,
            clientSecret: fake.clientSecret,
            status: 'CAPTURED',
        });

        await expect(service.capturePayment({
            userId: user.id,
            checkoutId,
            bookingId: booking.id,
        })).resolves.toEqual({ status: 'CAPTURED', wasCaptured: true });
        expect(fake.retrieveAuthorization).toHaveBeenCalledWith(fake.providerIntentId);
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
            .resolves.toMatchObject({ status: 'CAPTURED' });
    });

    it('does not ask Stripe to capture an attempt already recorded as captured', async () => {
        const { user, checkoutId, fake, service, booking } = await authorizedFixture();
        await service.capturePayment({ userId: user.id, checkoutId, bookingId: booking.id });
        fake.captureAuthorization.mockClear();

        await expect(service.capturePayment({
            userId: user.id,
            checkoutId,
            bookingId: booking.id,
        })).resolves.toEqual({ status: 'CAPTURED', wasCaptured: false });
        expect(fake.captureAuthorization).not.toHaveBeenCalled();
    });

    it('refuses to capture when the booking is not linked to the checkout intent', async () => {
        const { user, checkoutId, fake, service, booking } = await authorizedFixture();
        await prisma.booking.update({
            where: { id: booking.id },
            data: { paymentIntentId: 'pi_different' },
        });

        await expect(service.capturePayment({
            userId: user.id,
            checkoutId,
            bookingId: booking.id,
        })).rejects.toThrow('Booking is not linked to this payment attempt.');
        expect(fake.captureAuthorization).not.toHaveBeenCalled();
    });

    it('does not record capture until Stripe reports the captured state', async () => {
        const { user, checkoutId, fake, service, attempt, booking } = await authorizedFixture();
        fake.captureAuthorization.mockResolvedValueOnce({
            providerIntentId: fake.providerIntentId,
            clientSecret: fake.clientSecret,
            status: 'AUTHORIZED',
        });

        await expect(service.capturePayment({
            userId: user.id,
            checkoutId,
            bookingId: booking.id,
        })).rejects.toThrow('Stripe has not confirmed payment capture.');
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
            .resolves.toMatchObject({ status: 'AUTHORIZED' });
    });

    it('does not ask Stripe to capture a non-authorized attempt', async () => {
        const { user, checkoutId, fake, service, attempt, booking } = await authorizedFixture();
        await prisma.paymentAttempt.update({
            where: { id: attempt.id },
            data: { status: 'PROCESSING' },
        });

        await expect(service.capturePayment({
            userId: user.id,
            checkoutId,
            bookingId: booking.id,
        })).rejects.toThrow('Stripe has not confirmed payment capture.');
        expect(fake.captureAuthorization).not.toHaveBeenCalled();
    });

    it('cancels an authorized attempt that did not create a booking', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();
        const service = new CheckoutPaymentService(fake.value);
        await service.startPayment(request(user.id, flight.id, checkoutId));
        const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
            where: { userId_checkoutId: { userId: user.id, checkoutId } },
        });

        await expect(service.cancelPayment({ userId: user.id, checkoutId }))
            .resolves.toEqual({ status: 'CANCELLED', wasCancelled: true });
        expect(fake.cancelAuthorization).toHaveBeenCalledWith({
            providerIntentId: fake.providerIntentId,
            attemptId: attempt.id,
        });
        await expect(prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
            .resolves.toMatchObject({ status: 'CANCELLED' });
    });

    it('does not record cancellation until Stripe reports the cancelled state', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();
        const service = new CheckoutPaymentService(fake.value);
        await service.startPayment(request(user.id, flight.id, checkoutId));
        fake.cancelAuthorization.mockResolvedValueOnce({
            providerIntentId: fake.providerIntentId,
            clientSecret: fake.clientSecret,
            status: 'AUTHORIZED',
        });

        await expect(service.cancelPayment({ userId: user.id, checkoutId }))
            .rejects.toThrow('Stripe has not confirmed payment cancellation.');
        await expect(prisma.paymentAttempt.findUniqueOrThrow({
            where: { userId_checkoutId: { userId: user.id, checkoutId } },
        })).resolves.toMatchObject({ status: 'AUTHORIZED' });
    });

    it('does not cancel a payment already linked to a booking', async () => {
        const { user, checkoutId, fake, service } = await authorizedFixture();

        await expect(service.cancelPayment({ userId: user.id, checkoutId }))
            .rejects.toThrow('A booking already uses this payment attempt.');
        expect(fake.cancelAuthorization).not.toHaveBeenCalled();
    });

    it('does not cancel an attempt already recorded as captured', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();
        const service = new CheckoutPaymentService(fake.value);
        await service.startPayment(request(user.id, flight.id, checkoutId));
        await prisma.paymentAttempt.update({
            where: { userId_checkoutId: { userId: user.id, checkoutId } },
            data: { status: 'CAPTURED' },
        });

        await expect(service.cancelPayment({ userId: user.id, checkoutId }))
            .rejects.toThrow('Stripe has not confirmed payment cancellation.');
        expect(fake.cancelAuthorization).not.toHaveBeenCalled();
    });

    it('does not ask Stripe to cancel an attempt already recorded as cancelled', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();
        const service = new CheckoutPaymentService(fake.value);
        await service.startPayment(request(user.id, flight.id, checkoutId));
        await prisma.paymentAttempt.update({
            where: { userId_checkoutId: { userId: user.id, checkoutId } },
            data: { status: 'CANCELLED' },
        });
        fake.cancelAuthorization.mockClear();

        await expect(service.cancelPayment({ userId: user.id, checkoutId }))
            .resolves.toEqual({ status: 'CANCELLED', wasCancelled: false });
        expect(fake.cancelAuthorization).not.toHaveBeenCalled();
    });

    it('reconciles a cancellation whose Stripe response was lost', async () => {
        const { user, flight } = await fixture();
        const checkoutId = randomUUID();
        await holdSeat({
            flightId: flight.id,
            seatNumber: '2A',
            holderKey: checkoutHolderKey(user.id, checkoutId),
        });
        const fake = provider();
        const service = new CheckoutPaymentService(fake.value);
        await service.startPayment(request(user.id, flight.id, checkoutId));
        fake.cancelAuthorization.mockRejectedValueOnce(new Error('connection ended after cancel'));
        fake.retrieveAuthorization.mockResolvedValueOnce({
            providerIntentId: fake.providerIntentId,
            clientSecret: fake.clientSecret,
            status: 'CANCELLED',
        });

        await expect(service.cancelPayment({ userId: user.id, checkoutId }))
            .resolves.toEqual({ status: 'CANCELLED', wasCancelled: true });
        expect(fake.retrieveAuthorization).toHaveBeenCalledWith(fake.providerIntentId);
        await expect(prisma.paymentAttempt.findUniqueOrThrow({
            where: { userId_checkoutId: { userId: user.id, checkoutId } },
        })).resolves.toMatchObject({ status: 'CANCELLED' });
    });
});
