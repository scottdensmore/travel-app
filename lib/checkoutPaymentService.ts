import { createHash, randomUUID } from 'node:crypto';
import type { PaymentAttempt } from '@prisma/client';
import { calculateItineraryTotal, flightFareCents } from '@/lib/bookingPricing';
import { lockFlightForUpdate } from '@/lib/flightLock';
import { prisma } from '@/lib/prisma';
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
    status: PaymentAuthorizationStatus;
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

            const claims: SeatClaim[] = flights.flatMap((flight, legIndex) => (
                input.passengers.map(passenger => {
                    const seatNumber = passenger.seatNumbers[legIndex];
                    assertSeatAvailableForCabin(seatNumber, passenger.cabinClass, flight);
                    return { flightId: flight.id, seatNumber, holderKey };
                })
            ));
            for (const claim of claims) {
                if (!await hasLiveSeatHold(tx, claim)) {
                    throw new SeatHoldUnavailableError(claim);
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

        const authorization = attempt.providerIntentId
            ? await this.provider.retrieveAuthorization(attempt.providerIntentId)
            : await this.provider.createAuthorization({
                attemptId: attempt.id,
                amountCents: attempt.amountCents,
                currency: attempt.currency,
            });

        await prisma.paymentAttempt.update({
            where: { id: attempt.id },
            data: {
                providerIntentId: authorization.providerIntentId,
                status: authorization.status,
            },
        });

        return result(attempt, authorization);
    }
}
