/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
    prisma: { itineraryLeg: { findMany: jest.fn() } },
}));
jest.mock('@/lib/serverClock', () => ({ serverRenderTime: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import CheckInPage from '@/app/checkin/page';
import { CHECK_IN_OPENS_HOURS } from '@/lib/checkInPolicy';
import { serverRenderTime } from '@/lib/serverClock';
import type { CheckInLegView } from '@/components/ui/CheckInPanel';

const findMany = prisma.itineraryLeg.findMany as unknown as jest.Mock;
const mockedServerRenderTime = serverRenderTime as unknown as jest.Mock;
const mockedSession = getServerSession as unknown as jest.Mock;

// Noon UTC, which is 05:00 in Seattle -- so a boundary rendered in the origin's
// zone is visibly not the same string as one rendered in UTC.
const renderedAt = Date.parse('2026-08-18T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const seat = (overrides: {
    passengerId?: string;
    seatNumber?: string;
    releasedAt?: Date | null;
    checkedInAt?: Date | null;
} = {}) => ({
    passengerId: overrides.passengerId ?? 'p1',
    seatNumber: overrides.seatNumber ?? '11A',
    cabinClass: 'ECONOMY' as const,
    releasedAt: overrides.releasedAt ?? null,
    checkedInAt: overrides.checkedInAt ?? null,
});

const leg = (overrides: {
    id?: number;
    sequence?: number;
    hoursFromNow?: number;
    flightStatus?: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
    bookingStatus?: string;
    positions?: Array<{ id: number; sequence: number }>;
    passengers?: Array<{
        id: string;
        firstName: string;
        lastName: string;
        gender: string;
        documentsConfirmedAt?: Date | null;
    }>;
    seatAssignments?: ReturnType<typeof seat>[];
} = {}) => {
    const id = overrides.id ?? 11;
    return {
        id,
        sequence: overrides.sequence ?? 0,
        booking: {
            id: 7,
            reference: 'MA-0123456789ABCDEF0123',
            status: overrides.bookingStatus ?? 'CONFIRMED',
            passengers: (overrides.passengers
                ?? [{ id: 'p1', firstName: 'Ada', lastName: 'Lovelace', gender: 'Female' }]
            ).map(passenger => ({
                documentsConfirmedAt: null,
                ...passenger,
            })),
            legs: overrides.positions ?? [{ id, sequence: overrides.sequence ?? 0 }],
        },
        flight: {
            airline: 'Mona Airways',
            flightNumber: 'MA-100',
            departureDate: new Date(renderedAt + (overrides.hoursFromNow ?? 5) * HOUR),
            status: overrides.flightStatus ?? 'ON_TIME',
            fromAirport: { label: 'Seattle, USA' },
            toAirport: { label: 'Tokyo, Japan' },
        },
        seatAssignments: overrides.seatAssignments ?? [seat()],
    };
};

/**
 * What the check-in page hands its panel.
 *
 * The panel is tested against props it is given; this is where those props are
 * built, and every one of them is derived rather than stored -- the direction
 * label, the window boundaries in the origin's zone, and which travellers are
 * listed at all. None of that has a database column to be wrong about, so it can
 * only be checked here.
 */
describe('check-in page', () => {
    beforeEach(() => {
        findMany.mockReset();
        findMany.mockResolvedValue([]);
        mockedServerRenderTime.mockReset();
        mockedServerRenderTime.mockResolvedValue(renderedAt);
        mockedSession.mockReset();
        mockedSession.mockResolvedValue({ user: { id: 'u1' } });
    });

    const legsPassedToPanel = async (): Promise<CheckInLegView[]> => {
        const element = await CheckInPage() as { props: { legs: CheckInLegView[] } };
        return element.props.legs;
    };

    it('reads nothing at all for a visitor who is not signed in', async () => {
        mockedSession.mockResolvedValue(null);

        await CheckInPage();

        // The query is never issued, so an anonymous request cannot be the thing
        // that decides whose bookings a scoping clause would have matched.
        expect(findMany).not.toHaveBeenCalled();
    });

    it('scopes the query to the authenticated owner', async () => {
        await CheckInPage();

        const { where } = findMany.mock.calls[0][0];
        // In the query rather than in a filter afterwards: a later filter can be
        // removed without the query noticing, and a booking reference is an
        // identifier rather than a credential (#77).
        expect(where.booking).toEqual({ userId: 'u1' });
        expect(where.supersededAt).toBeNull();
    });

    it('asks for a bounded window rather than every booking ever made', async () => {
        await CheckInPage();

        const { where, take } = findMany.mock.calls[0][0];
        const [ordinary] = where.flight.OR;

        // Two hours back, so a flight that has just left is explained rather
        // than absent, and a month forward.
        expect(renderedAt - ordinary.departureDate.gte.getTime()).toBe(2 * HOUR);
        expect(ordinary.departureDate.lte.getTime() - renderedAt).toBe(30 * 24 * HOUR);
        // `/flights` served 1420 rows into an RSC payload because its query had
        // no ceiling at all (#153). The ceiling this pins is "bounded at all"
        // rather than its exact value, so the headroom over MAX_LEGS is
        // deliberate: the property worth defending is that some limit exists.
        expect(take).toBeGreaterThan(0);
        expect(take).toBeLessThanOrEqual(100);
    });

    it('reaches further back for a delayed flight, which keeps its scheduled time', async () => {
        await CheckInPage();

        const { where } = findMany.mock.calls[0][0];
        const delayed = where.flight.OR.find(
            (branch: { status?: string }) => branch.status === 'DELAYED',
        );

        // A delay does not move `departureDate`, so a flight delayed longer than
        // the ordinary two hours fell off this page while the customer was still
        // at the airport waiting for it.
        expect(delayed).toBeDefined();
        expect(renderedAt - delayed.departureDate.gte.getTime()).toBe(24 * HOUR);
    });

    it('carries each traveller identity, not just their name', async () => {
        findMany.mockResolvedValue([leg({
            passengers: [
                { id: 'p1', firstName: 'Ada', lastName: 'Lovelace', gender: 'Female' },
                // A booking really can carry two people with one name.
                { id: 'p2', firstName: 'Ada', lastName: 'Lovelace', gender: 'Female' },
            ],
            seatAssignments: [
                seat({ passengerId: 'p1', seatNumber: '11A', checkedInAt: new Date(renderedAt - HOUR) }),
                seat({ passengerId: 'p2', seatNumber: '11B' }),
            ],
        })]);

        const [view] = await legsPassedToPanel();

        // Without an id the list keys on the name, and two identical keys let
        // React reconcile the rows into each other -- landing one traveller's
        // checked-in state on the other.
        expect(view.travellers.map(traveller => traveller.id)).toEqual(['p1', 'p2']);
        expect(view.travellers.map(traveller => traveller.checkedIn)).toEqual([true, false]);
    });

    it('says whether the window has opened, from the instant rather than the reason', async () => {
        // A cancelled booking weeks out is not NOT_YET_OPEN, but its opening time
        // is still in the future -- which is how the card came to say "Check-in
        // opened" about a date a fortnight away.
        findMany.mockResolvedValue([leg({ bookingStatus: 'CANCELLED', hoursFromNow: 500 })]);
        const [future] = await legsPassedToPanel();
        expect(future.reason).toBe('BOOKING_CANCELLED');
        expect(future.hasOpened).toBe(false);

        findMany.mockResolvedValue([leg({ bookingStatus: 'CANCELLED', hoursFromNow: 5 })]);
        const [open] = await legsPassedToPanel();
        expect(open.reason).toBe('BOOKING_CANCELLED');
        expect(open.hasOpened).toBe(true);
    });

    it('names each leg by its place in the itinerary', async () => {
        const positions = [{ id: 11, sequence: 0 }, { id: 12, sequence: 1 }];
        findMany.mockResolvedValue([
            leg({ id: 11, sequence: 0, positions }),
            leg({ id: 12, sequence: 1, positions, hoursFromNow: 100 }),
        ]);

        const legs = await legsPassedToPanel();

        // "Returning" is a claim about the last leg of a there-and-back trip. A
        // label taken from the row's own sequence without the itinerary's length
        // cannot make it (#160).
        expect(legs.map(view => view.directionLabel)).toEqual(['Departing', 'Returning']);
    });

    it('gives a one-flight booking no direction to be going in', async () => {
        findMany.mockResolvedValue([leg()]);

        const [view] = await legsPassedToPanel();

        // A booking with one leg is not "Departing" as opposed to anything, and
        // saying so makes several interleaved bookings read as one itinerary.
        expect(view.directionLabel).toBe('');
    });

    it('reads both window boundaries at the origin airport, not in UTC', async () => {
        findMany.mockResolvedValue([leg({ hoursFromNow: 30 })]);

        const [view] = await legsPassedToPanel();

        // Departure is 18:00Z on the 19th, which in Seattle is 11:00 on the 19th;
        // check-in opens 24 hours earlier, 11:00 on the 18th. A boundary rendered
        // in UTC would say 18:00, and would sit on the same card as a departure
        // rendered in the origin's zone -- two clocks, one line (#84, #298).
        expect(view.departureReadable).toBe('Aug 19, 2026 at 11:00 PDT');
        expect(view.opensAtReadable).toBe('Aug 18, 2026 at 11:00 PDT');
        expect(view.closesAtReadable).toBe('Aug 19, 2026 at 10:00 PDT');
    });

    it('leaves a released traveller off the flight they are not on', async () => {
        findMany.mockResolvedValue([leg({
            passengers: [
                { id: 'p1', firstName: 'Ada', lastName: 'Lovelace', gender: 'Female' },
                { id: 'p2', firstName: 'Grace', lastName: 'Hopper', gender: 'Female' },
            ],
            seatAssignments: [
                seat({ passengerId: 'p1', seatNumber: '11A' }),
                seat({ passengerId: 'p2', seatNumber: '11B', releasedAt: new Date(renderedAt - HOUR) }),
            ],
        })]);

        const [view] = await legsPassedToPanel();

        // Listing them would invite the customer to check in somebody who holds
        // no seat, and the control cannot do it.
        expect(view.travellers.map(traveller => traveller.name)).toEqual(['Ada Lovelace']);
        expect(view.travellers[0].seat).toBe('Seat 11A');
    });

    it('marks the travellers who have already checked in', async () => {
        findMany.mockResolvedValue([leg({
            passengers: [
                { id: 'p1', firstName: 'Ada', lastName: 'Lovelace', gender: 'Female' },
                { id: 'p2', firstName: 'Grace', lastName: 'Hopper', gender: 'Female' },
            ],
            seatAssignments: [
                seat({ passengerId: 'p1', seatNumber: '11A', checkedInAt: new Date(renderedAt - HOUR) }),
                seat({ passengerId: 'p2', seatNumber: '11B' }),
            ],
        })]);

        const [view] = await legsPassedToPanel();

        expect(view.travellers.map(traveller => traveller.checkedIn)).toEqual([true, false]);
        // Still open, and for one traveller rather than two: a party is not done
        // because one of them is.
        expect(view.allowed).toBe(true);
        expect(view.awaiting).toBe(1);
    });

    it('carries a refusal reason with a matching label and next step', async () => {
        findMany.mockResolvedValue([leg({ hoursFromNow: CHECK_IN_OPENS_HOURS + 10 })]);

        const [view] = await legsPassedToPanel();

        expect(view.allowed).toBe(false);
        expect(view.reason).toBe('NOT_YET_OPEN');
        expect(view.statusLabel).toBe('Check-in not open yet');
        expect(view.nextStep).toContain(`${CHECK_IN_OPENS_HOURS} hours`);
        // The enum itself must not reach a customer (#169).
        expect(view.statusLabel).not.toMatch(/NOT_YET_OPEN/);
    });

    it('gives every check-in state a label of its own', async () => {
        // A missing entry renders `undefined` as the state, which reads as a
        // blank badge rather than as a fault.
        const states: Array<[Parameters<typeof leg>[0], string]> = [
            [{ bookingStatus: 'CANCELLED' }, 'Booking cancelled'],
            [{ bookingStatus: 'DISRUPTED' }, 'Flights changed'],
            [{ flightStatus: 'CANCELLED' }, 'Flight cancelled'],
            [{ hoursFromNow: -1 }, 'Departed'],
            [{ hoursFromNow: 0.5 }, 'Check-in closed'],
            [{ seatAssignments: [seat({ checkedInAt: new Date(renderedAt - HOUR) })] }, 'Checked in'],
            [{ seatAssignments: [seat({ releasedAt: new Date(renderedAt - HOUR) })] }, 'No seat held'],
        ];

        for (const [overrides, expected] of states) {
            findMany.mockResolvedValue([leg(overrides)]);
            const [view] = await legsPassedToPanel();
            expect(view.statusLabel).toBe(expected);
            expect(view.nextStep.length).toBeGreaterThan(0);
        }
    });
});

describe('the document attestation', () => {
    beforeEach(() => {
        findMany.mockReset();
        findMany.mockResolvedValue([]);
        mockedServerRenderTime.mockReset();
        mockedServerRenderTime.mockResolvedValue(renderedAt);
        mockedSession.mockReset();
        mockedSession.mockResolvedValue({ user: { id: 'u1' } });
    });

    const legsPassedToPanel = async (): Promise<CheckInLegView[]> => {
        const element = await CheckInPage() as { props: { legs: CheckInLegView[] } };
        return element.props.legs;
    };

    it('asks for it until every traveller on the booking has confirmed', async () => {
        findMany.mockResolvedValue([leg({
            passengers: [
                { id: 'p1', firstName: 'Ada', lastName: 'Lovelace', gender: 'Female',
                  documentsConfirmedAt: new Date(renderedAt - HOUR) },
                { id: 'p2', firstName: 'Grace', lastName: 'Hopper', gender: 'Female' },
            ],
            seatAssignments: [
                seat({ passengerId: 'p1', seatNumber: '11A' }),
                seat({ passengerId: 'p2', seatNumber: '11B' }),
            ],
        })]);

        const [view] = await legsPassedToPanel();

        // One traveller's confirmation is not the party's, the same way one
        // traveller's check-in is not.
        expect(view.documentsConfirmed).toBe(false);
    });

    it('stops asking once the whole party has confirmed', async () => {
        findMany.mockResolvedValue([leg({
            passengers: [
                { id: 'p1', firstName: 'Ada', lastName: 'Lovelace', gender: 'Female',
                  documentsConfirmedAt: new Date(renderedAt - HOUR) },
            ],
        })]);

        const [view] = await legsPassedToPanel();

        expect(view.documentsConfirmed).toBe(true);
    });

    it('reads only the attestation timestamp, never the identity data behind it', async () => {
        await CheckInPage();

        const { select } = findMany.mock.calls[0][0];
        const passengerSelect = select.booking.select.passengers.select;

        // `docs/PASSENGER_DATA_POLICY.md` forbids either plaintext or ciphertext
        // reaching a customer surface. The attestation is compatible with that
        // only because it is a timestamp, so this query must not widen.
        expect(passengerSelect.documentsConfirmedAt).toBe(true);
        expect(passengerSelect).not.toHaveProperty('passportNumberEncrypted');
        expect(passengerSelect).not.toHaveProperty('dateOfBirthEncrypted');
        expect(Object.keys(passengerSelect).sort())
            .toEqual(['documentsConfirmedAt', 'firstName', 'gender', 'id', 'lastName']);
    });
});
