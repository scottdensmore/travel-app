import { createHash, randomUUID } from 'node:crypto';
import type { PaymentAttempt } from '@prisma/client';
import { calculateItineraryTotal, flightFareCents } from '@/lib/bookingPricing';
import { lockFlightForUpdate } from '@/lib/flightLock';
import { prisma } from '@/lib/prisma';
import { lockPaymentIntentForUpdate } from '@/lib/paymentIntentLock';
import { assertSeatAvailableForCabin } from '@/lib/seatLayout';
import {
    checkoutHolderKey,
    hasLiveSeatHold,
    SeatHoldUnavailableError,
    type SeatClaim,
} from '@/lib/seatHolds';
import type {
    PaymentAuthorization,
    PaymentAuthorizationStatus,
    PaymentProvider,
} from '@/lib/stripePaymentProvider';
import { checkoutPaymentServiceSchema, parseInput } from '@/lib/validation';

interface CheckoutPaymentInput {
    userId: string;
    checkoutId: string;
    flightIds: number[];
    passengers: Array<{
        seatNumbers: string[];
        cabinClass: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
    }>;
}

interface CheckoutPaymentResult {
    amountCents: number;
    currency: string;
    clientSecret: string;
    providerIntentId: string;
    status: PaymentAuthorizationStatus;
}

interface CapturePaymentInput {
    userId: string;
    checkoutId: string;
    bookingId: number;
}

interface CancelPaymentInput {
    userId: string;
    checkoutId: string;
}

export class PaymentCaptureIncompleteError extends Error {
    constructor() {
        super('Stripe has not confirmed payment capture.');
        this.name = 'PaymentCaptureIncompleteError';
    }
}

export class PaymentCancellationIncompleteError extends Error {
    constructor() {
        super('Stripe has not confirmed payment cancellation.');
        this.name = 'PaymentCancellationIncompleteError';
    }
}

function requestFingerprint(input: Omit<CheckoutPaymentInput, 'userId'>): string {
    return createHash('sha256').update(JSON.stringify([
        input.checkoutId,
        input.flightIds,
        input.passengers.map(passenger => [passenger.seatNumbers, passenger.cabinClass]),
    ])).digest('hex');
}

function result(
    attempt: Pick<PaymentAttempt, 'amountCents' | 'currency'>,
    authorization: PaymentAuthorization,
): CheckoutPaymentResult {
    return {
        amountCents: attempt.amountCents,
        currency: attempt.currency,
        clientSecret: authorization.clientSecret,
        providerIntentId: authorization.providerIntentId,
        status: authorization.status,
    };
}

export class CheckoutPaymentService {
    constructor(private readonly provider: PaymentProvider) {}

    async startPayment(rawInput: CheckoutPaymentInput): Promise<CheckoutPaymentResult> {
        const input = parseInput(checkoutPaymentServiceSchema, rawInput);
        const fingerprint = requestFingerprint(input);
        const holderKey = checkoutHolderKey(input.userId, input.checkoutId);

        const attempt = await prisma.$transaction(async tx => {
            await tx.$queryRaw`
                SELECT pg_advisory_xact_lock(
                    hashtextextended(${holderKey}, 75)
                )::text AS "locked"
            `;

            const orderedFlightIds = [...input.flightIds].sort((left, right) => left - right);
            for (const flightId of orderedFlightIds) {
                await lockFlightForUpdate(tx, flightId);
            }

            const flightsById = new Map(
                (await tx.flight.findMany({ where: { id: { in: input.flightIds } } }))
                    .map(flight => [flight.id, flight]),
            );
            const flights = input.flightIds.map(flightId => {
                const flight = flightsById.get(flightId);
                if (!flight) throw new Error('Flight not found');
                if (flight.status === 'CANCELLED' || flight.departureDate.getTime() <= Date.now()) {
                    throw new Error('Flight is not available for booking.');
                }
                return flight;
            });

            const existing = await tx.paymentAttempt.findUnique({
                where: {
                    userId_checkoutId: { userId: input.userId, checkoutId: input.checkoutId },
                },
            });
            if (existing && existing.requestFingerprint !== fingerprint) {
                throw new Error('Checkout payment ID was already used for a different request.');
            }

            const linkedBooking = existing?.providerIntentId
                ? await tx.booking.findFirst({
                    where: {
                        userId: input.userId,
                        idempotencyKey: input.checkoutId,
                        paymentIntentId: existing.providerIntentId,
                    },
                    select: { id: true },
                })
                : null;

            const claims: SeatClaim[] = flights.flatMap((flight, legIndex) => (
                input.passengers.map(passenger => {
                    const seatNumber = passenger.seatNumbers[legIndex];
                    assertSeatAvailableForCabin(seatNumber, passenger.cabinClass, flight);
                    return { flightId: flight.id, seatNumber, holderKey };
                })
            ));
            if (!linkedBooking) {
                for (const claim of claims) {
                    if (!await hasLiveSeatHold(tx, claim)) {
                        throw new SeatHoldUnavailableError(claim);
                    }
                }
            }

            if (existing) {
                return existing;
            }

            const total = calculateItineraryTotal(
                flights.map(flightFareCents),
                input.passengers.map(passenger => ({ cabinClass: passenger.cabinClass })),
            );
            return tx.paymentAttempt.create({
                data: {
                    id: randomUUID(),
                    userId: input.userId,
                    checkoutId: input.checkoutId,
                    requestFingerprint: fingerprint,
                    amountCents: total.cents,
                    currency: 'USD',
                    status: 'CREATING',
                },
            });
        });

        const createdAuthorization = attempt.providerIntentId
            ? null
            : await this.provider.createAuthorization({
                attemptId: attempt.id,
                amountCents: attempt.amountCents,
                currency: attempt.currency,
            });
        const providerIntentId = attempt.providerIntentId
            ?? createdAuthorization!.providerIntentId;
        const authorization = await prisma.$transaction(async tx => {
            await lockPaymentIntentForUpdate(tx, providerIntentId);
            const current = await this.provider.retrieveAuthorization(providerIntentId);
            await tx.paymentAttempt.update({
                where: { id: attempt.id },
                data: {
                    providerIntentId: current.providerIntentId,
                    status: current.status,
                },
            });
            return current;
        }, { maxWait: 5_000, timeout: 15_000 });

        return result(attempt, authorization);
    }

    async capturePayment(input: CapturePaymentInput): Promise<{
        status: 'CAPTURED';
        wasCaptured: boolean;
    }> {
        return prisma.$transaction(async tx => {
            const initial = await tx.paymentAttempt.findUnique({
                where: {
                    userId_checkoutId: {
                        userId: input.userId,
                        checkoutId: input.checkoutId,
                    },
                },
            });
            if (!initial?.providerIntentId) {
                throw new Error('Checkout payment attempt was not found.');
            }
            const providerIntentId = initial.providerIntentId;

            await lockPaymentIntentForUpdate(tx, providerIntentId);
            const [attempt, booking] = await Promise.all([
                tx.paymentAttempt.findUniqueOrThrow({ where: { id: initial.id } }),
                tx.booking.findFirst({
                    where: {
                        id: input.bookingId,
                        userId: input.userId,
                        idempotencyKey: input.checkoutId,
                    },
                    select: { paymentIntentId: true },
                }),
            ]);
            if (!booking || booking.paymentIntentId !== attempt.providerIntentId) {
                throw new Error('Booking is not linked to this payment attempt.');
            }
            if (attempt.status === 'CAPTURED') {
                return { status: 'CAPTURED', wasCaptured: false };
            }
            if (attempt.status !== 'AUTHORIZED') {
                throw new PaymentCaptureIncompleteError();
            }

            let authorization: PaymentAuthorization;
            try {
                authorization = await this.provider.captureAuthorization({
                    providerIntentId,
                    attemptId: attempt.id,
                    amountCents: attempt.amountCents,
                });
            } catch {
                // A missing API response does not say whether Stripe captured.
                // Re-read the intent before deciding; a later retry uses the
                // same capture idempotency key if this read is also uncertain.
                authorization = await this.provider.retrieveAuthorization(providerIntentId);
            }
            if (
                authorization.providerIntentId !== providerIntentId
                || authorization.status !== 'CAPTURED'
            ) {
                throw new PaymentCaptureIncompleteError();
            }
            await tx.paymentAttempt.update({
                where: { id: attempt.id },
                data: { status: 'CAPTURED' },
            });
            return { status: 'CAPTURED', wasCaptured: true };
        }, { maxWait: 5_000, timeout: 15_000 });
    }

    async cancelPayment(input: CancelPaymentInput): Promise<{
        status: 'CANCELLED';
        wasCancelled: boolean;
    }> {
        return prisma.$transaction(async tx => {
            const initial = await tx.paymentAttempt.findUnique({
                where: {
                    userId_checkoutId: {
                        userId: input.userId,
                        checkoutId: input.checkoutId,
                    },
                },
            });
            if (!initial?.providerIntentId) {
                throw new Error('Checkout payment attempt was not found.');
            }
            const providerIntentId = initial.providerIntentId;

            await lockPaymentIntentForUpdate(tx, providerIntentId);
            const [attempt, linkedBooking] = await Promise.all([
                tx.paymentAttempt.findUniqueOrThrow({ where: { id: initial.id } }),
                tx.booking.findFirst({
                    where: { paymentIntentId: providerIntentId },
                    select: { id: true },
                }),
            ]);
            if (linkedBooking) {
                throw new Error('A booking already uses this payment attempt.');
            }
            if (attempt.status === 'CANCELLED') {
                return { status: 'CANCELLED', wasCancelled: false };
            }
            if (attempt.status === 'CAPTURED') {
                throw new PaymentCancellationIncompleteError();
            }

            let authorization: PaymentAuthorization;
            try {
                authorization = await this.provider.cancelAuthorization({
                    providerIntentId,
                    attemptId: attempt.id,
                });
            } catch {
                authorization = await this.provider.retrieveAuthorization(providerIntentId);
            }
            if (
                authorization.providerIntentId !== providerIntentId
                || authorization.status !== 'CANCELLED'
            ) {
                throw new PaymentCancellationIncompleteError();
            }
            await tx.paymentAttempt.update({
                where: { id: attempt.id },
                data: { status: 'CANCELLED' },
            });
            return { status: 'CANCELLED', wasCancelled: true };
        }, { maxWait: 5_000, timeout: 15_000 });
    }
}
