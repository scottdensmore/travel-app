/** @jest-environment node */
import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth';
import { airportCodesForRoute } from '@/lib/airports';
import { checkInLegAction } from '@/app/actions';
import { CHECK_IN_OPENS_HOURS } from '@/lib/checkInPolicy';
import { prisma } from '@/lib/prisma';
import FlightBookingService from '@/lib/FlightBookingService';
import { bookHeldFlight } from '@/e2e/helpers/holdBookingSeats';
import { isActionValidationFailure } from '@/lib/actionResult';

// Only the session and cache boundaries are stubbed. The database is real,
// because what is under test is which rows a check-in stamps and which it must
// refuse to reach.
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

const mockedSession = getServerSession as jest.Mock;

const created = { flightIds: [] as number[], bookingIds: [] as number[], userIds: [] as string[] };

const HOUR = 60 * 60 * 1000;

/**
 * A flight whose departure sits inside the check-in window, so the action's own
 * window check passes and the test is about what it writes.
 */
async function createFlight(suffix: string, hoursFromNow: number) {
    const flight = await prisma.flight.create({
        data: {
            flightNumber: `CKI-${suffix}`,
            airline: 'Gemini Airways',
            ...airportCodesForRoute('Seattle, USA', 'Detroit, USA'),
            departureDate: new Date(Date.now() + hoursFromNow * HOUR),
            durationMinutes: 240,
            priceCents: 35000,
            status: 'ON_TIME',
            economyRows: 20,
            premiumEconomyRows: 4,
            businessRows: 3,
            firstClassRows: 3,
            seatPattern: 'ABC-DEF',
        },
    });
    created.flightIds.push(flight.id);
    return flight;
}

async function createUser(suffix: string) {
    const user = await prisma.user.create({
        data: {
            name: 'Check In',
            // Lowercased: `User_email_canonical_check` refuses anything else,
            // and the suffixes below carry a letter to keep them distinct.
            email: `checkin-${suffix}-${Date.now()}@example.com`.toLowerCase(),
            password: 'not-used',
            emailVerified: new Date(),
        },
    });
    created.userIds.push(user.id);
    return user;
}

async function bookSeats(
    flightIds: number[],
    userId: string,
    passengers: Array<{ firstName: string; seatNumbers: string[] }>,
) {
    const booking = await bookHeldFlight(new FlightBookingService(), {
        flightIds,
        userId,
        passengers: passengers.map((passenger, index) => ({
            firstName: passenger.firstName,
            lastName: 'Traveller',
            dateOfBirth: new Date('1990-01-01'),
            passportNumber: `US111222${index}`,
            gender: 'Female',
            seatNumbers: passenger.seatNumbers,
            cabinClass: 'ECONOMY' as const,
        })),
        idempotencyKey: randomUUID(),
    });
    created.bookingIds.push(booking.id);
    return booking;
}

const legsOf = (bookingId: number) => prisma.itineraryLeg.findMany({
    where: { bookingId },
    orderBy: { sequence: 'asc' },
    include: { seatAssignments: { orderBy: { seatNumber: 'asc' } } },
});

afterAll(async () => {
    for (const bookingId of created.bookingIds) {
        await prisma.passenger.deleteMany({ where: { bookingId } });
        await prisma.booking.deleteMany({ where: { id: bookingId } });
    }
    await prisma.flight.deleteMany({ where: { id: { in: created.flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
});

describe('checkInLegAction', () => {
    it('stamps every traveller on the named leg and no other leg', async () => {
        const suffix = `A${Date.now()}`;
        const outbound = await createFlight(`O${suffix}`, 5);
        // Outside the window, so a leaked stamp cannot be explained as this
        // leg being independently eligible.
        const inbound = await createFlight(`I${suffix}`, CHECK_IN_OPENS_HOURS + 48);
        const user = await createUser(suffix);
        const booking = await bookSeats([outbound.id, inbound.id], user.id, [
            { firstName: 'Ada', seatNumbers: ['11A', '12A'] },
            { firstName: 'Grace', seatNumbers: ['11B', '12B'] },
        ]);

        const before = await legsOf(booking.id);
        mockedSession.mockResolvedValue({ user: { id: user.id } });

        const result = await checkInLegAction({ bookingId: booking.id, legId: before[0].id });
        expect(isActionValidationFailure(result)).toBe(false);

        const after = await legsOf(booking.id);
        // Both travellers on the outbound, so a party is not left half checked in.
        expect(after[0].seatAssignments.map(seat => seat.checkedInAt !== null)).toEqual([true, true]);
        // The return leg is a separate check-in with its own window.
        expect(after[1].seatAssignments.map(seat => seat.checkedInAt)).toEqual([null, null]);
    });

    it('refuses a leg belonging to another customer', async () => {
        const suffix = `B${Date.now()}`;
        const flight = await createFlight(`F${suffix}`, 5);
        const owner = await createUser(`owner${suffix}`);
        const intruder = await createUser(`intruder${suffix}`);
        const booking = await bookSeats([flight.id], owner.id, [
            { firstName: 'Ada', seatNumbers: ['11A'] },
        ]);
        const [leg] = await legsOf(booking.id);

        mockedSession.mockResolvedValue({ user: { id: intruder.id } });

        await expect(
            checkInLegAction({ bookingId: booking.id, legId: leg.id }),
        ).rejects.toThrow('Unauthorized');

        const after = await legsOf(booking.id);
        expect(after[0].seatAssignments[0].checkedInAt).toBeNull();
    });

    it('refuses a leg that does not belong to the booking it is named with', async () => {
        // The ownership check passes -- this customer does own `booking` -- so
        // only the leg-to-booking check stands between them and stamping a
        // stranger's leg.
        const suffix = `C${Date.now()}`;
        const own = await createFlight(`W${suffix}`, 5);
        const other = await createFlight(`X${suffix}`, 5);
        const user = await createUser(`own${suffix}`);
        const stranger = await createUser(`str${suffix}`);
        const booking = await bookSeats([own.id], user.id, [
            { firstName: 'Ada', seatNumbers: ['11A'] },
        ]);
        const strangerBooking = await bookSeats([other.id], stranger.id, [
            { firstName: 'Alan', seatNumbers: ['11A'] },
        ]);
        const [strangerLeg] = await legsOf(strangerBooking.id);

        mockedSession.mockResolvedValue({ user: { id: user.id } });

        await expect(
            checkInLegAction({ bookingId: booking.id, legId: strangerLeg.id }),
        ).rejects.toThrow('Itinerary leg not found');

        const after = await legsOf(strangerBooking.id);
        expect(after[0].seatAssignments[0].checkedInAt).toBeNull();
    });

    it('refuses a flight the window has not opened for, and writes nothing', async () => {
        const suffix = `D${Date.now()}`;
        const flight = await createFlight(`F${suffix}`, CHECK_IN_OPENS_HOURS + 12);
        const user = await createUser(suffix);
        const booking = await bookSeats([flight.id], user.id, [
            { firstName: 'Ada', seatNumbers: ['11A'] },
        ]);
        const [leg] = await legsOf(booking.id);

        mockedSession.mockResolvedValue({ user: { id: user.id } });

        const result = await checkInLegAction({ bookingId: booking.id, legId: leg.id });

        // A policy answer the customer can act on, not a thrown fault.
        expect(isActionValidationFailure(result)).toBe(true);
        expect((result as { error: { message: string } }).error.message)
            .toContain(`${CHECK_IN_OPENS_HOURS} hours`);

        const after = await legsOf(booking.id);
        expect(after[0].seatAssignments[0].checkedInAt).toBeNull();
    });

    it('refuses a cancelled flight inside an otherwise open window', async () => {
        const suffix = `E${Date.now()}`;
        const flight = await createFlight(`F${suffix}`, 5);
        const user = await createUser(suffix);
        const booking = await bookSeats([flight.id], user.id, [
            { firstName: 'Ada', seatNumbers: ['11A'] },
        ]);
        const [leg] = await legsOf(booking.id);
        // Cancelled after the booking exists, which is the only order that can
        // happen: `FlightBookingService` refuses to sell a cancelled flight, so a
        // booking on one always predates the cancellation.
        await prisma.flight.update({
            where: { id: flight.id },
            data: { status: 'CANCELLED' },
        });

        mockedSession.mockResolvedValue({ user: { id: user.id } });

        const result = await checkInLegAction({ bookingId: booking.id, legId: leg.id });

        expect(isActionValidationFailure(result)).toBe(true);
        const after = await legsOf(booking.id);
        expect(after[0].seatAssignments[0].checkedInAt).toBeNull();
    });

    it('leaves the first stamp alone when pressed twice', async () => {
        const suffix = `F${Date.now()}`;
        const flight = await createFlight(`F${suffix}`, 5);
        const user = await createUser(suffix);
        const booking = await bookSeats([flight.id], user.id, [
            { firstName: 'Ada', seatNumbers: ['11A'] },
        ]);
        const [leg] = await legsOf(booking.id);

        mockedSession.mockResolvedValue({ user: { id: user.id } });

        await checkInLegAction({ bookingId: booking.id, legId: leg.id });
        const first = (await legsOf(booking.id))[0].seatAssignments[0].checkedInAt;
        expect(first).not.toBeNull();

        const second = await checkInLegAction({ bookingId: booking.id, legId: leg.id });

        // Success rather than a refusal, and the same instant: re-stamping would
        // claim the traveller checked in later than they did.
        expect(isActionValidationFailure(second)).toBe(false);
        const after = (await legsOf(booking.id))[0].seatAssignments[0].checkedInAt;
        expect(after?.getTime()).toBe(first?.getTime());
    });

    it('checks in the traveller still travelling when another has released a seat', async () => {
        const suffix = `G${Date.now()}`;
        const flight = await createFlight(`F${suffix}`, 5);
        const user = await createUser(suffix);
        const booking = await bookSeats([flight.id], user.id, [
            { firstName: 'Ada', seatNumbers: ['11A'] },
            { firstName: 'Grace', seatNumbers: ['11B'] },
        ]);
        const [leg] = await legsOf(booking.id);
        const released = leg.seatAssignments[1];
        await prisma.seatAssignment.update({
            where: { id: released.id },
            data: { releasedAt: new Date() },
        });

        mockedSession.mockResolvedValue({ user: { id: user.id } });

        const result = await checkInLegAction({ bookingId: booking.id, legId: leg.id });
        expect(isActionValidationFailure(result)).toBe(false);

        const after = await prisma.seatAssignment.findMany({
            where: { legId: leg.id },
            orderBy: { seatNumber: 'asc' },
        });
        expect(after[0].checkedInAt).not.toBeNull();
        // A released seat is nobody's boarding position any more, so stamping it
        // would record a check-in for a traveller who is not on the flight.
        expect(after[1].checkedInAt).toBeNull();
    });

    it('leaves an already checked-in traveller\'s stamp alone while checking in the rest', async () => {
        // The case the whole-party idempotency test cannot reach: with one of two
        // travellers checked in, the leg is still open, so the update *does* run.
        // Without `checkedInAt: null` on it, Ada's stamp is rewritten to now --
        // recording that she checked in later than she did.
        const suffix = `J${Date.now()}`;
        const flight = await createFlight(`F${suffix}`, 5);
        const user = await createUser(suffix);
        const booking = await bookSeats([flight.id], user.id, [
            { firstName: 'Ada', seatNumbers: ['11A'] },
            { firstName: 'Grace', seatNumbers: ['11B'] },
        ]);
        const [leg] = await legsOf(booking.id);
        const earlier = new Date(Date.now() - 3 * HOUR);
        await prisma.seatAssignment.update({
            where: { id: leg.seatAssignments[0].id },
            data: { checkedInAt: earlier },
        });

        mockedSession.mockResolvedValue({ user: { id: user.id } });

        const result = await checkInLegAction({ bookingId: booking.id, legId: leg.id });
        expect(isActionValidationFailure(result)).toBe(false);

        const after = await prisma.seatAssignment.findMany({
            where: { legId: leg.id },
            orderBy: { seatNumber: 'asc' },
        });
        expect(after[0].checkedInAt?.getTime()).toBe(earlier.getTime());
        expect(after[1].checkedInAt).not.toBeNull();
        expect(after[1].checkedInAt!.getTime()).toBeGreaterThan(earlier.getTime());
    });

    it('refuses a cancelled booking whose flight is still in the window', async () => {
        const suffix = `H${Date.now()}`;
        const flight = await createFlight(`F${suffix}`, 5);
        const user = await createUser(suffix);
        const booking = await bookSeats([flight.id], user.id, [
            { firstName: 'Ada', seatNumbers: ['11A'] },
        ]);
        const [leg] = await legsOf(booking.id);
        await prisma.booking.update({
            where: { id: booking.id },
            data: { status: 'CANCELLED' },
        });

        mockedSession.mockResolvedValue({ user: { id: user.id } });

        const result = await checkInLegAction({ bookingId: booking.id, legId: leg.id });

        expect(isActionValidationFailure(result)).toBe(true);
        expect((result as { error: { message: string } }).error.message).toContain('cancelled');
        const after = await prisma.seatAssignment.findMany({ where: { legId: leg.id } });
        expect(after.every(seat => seat.checkedInAt === null)).toBe(true);
    });

    it('refuses an unauthenticated caller before reading anything', async () => {
        mockedSession.mockResolvedValue(null);

        await expect(
            checkInLegAction({ bookingId: 1, legId: 1 }),
        ).rejects.toThrow('Unauthorized');
    });

    it('rejects an unparseable request rather than querying with it', async () => {
        const user = await createUser(`I${Date.now()}`);
        mockedSession.mockResolvedValue({ user: { id: user.id } });

        const result = await checkInLegAction({ bookingId: -1, legId: 0 });

        expect(isActionValidationFailure(result)).toBe(true);
    });
});
