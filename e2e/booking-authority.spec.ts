import { expect, test } from '@playwright/test';
import FlightBookingService from '../lib/FlightBookingService';
import { prisma } from '../lib/prisma';

test.describe('Authoritative booking persistence', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const emails = [`authority-a-${suffix}@example.com`, `authority-b-${suffix}@example.com`];
  const flightNumbers = [`RA${suffix.slice(-6)}`, `ID${suffix.slice(-6)}`, `MM${suffix.slice(-6)}`];

  test.afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { in: emails } } });
    const userIds = users.map(user => user.id);
    const flights = await prisma.flight.findMany({
      where: { flightNumber: { in: flightNumbers } }
    });
    const flightIds = flights.map(flight => flight.id);

    await prisma.passenger.deleteMany({
      where: { OR: [{ flightId: { in: flightIds } }, { booking: { userId: { in: userIds } } }] }
    });
    await prisma.booking.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.flight.deleteMany({ where: { id: { in: flightIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  test('serializes a contested seat so exactly one customer acquires it', async () => {
    const [firstUser, secondUser] = await Promise.all(emails.map((email, index) =>
      prisma.user.create({
        data: { name: `Authority ${index}`, email, password: 'not-used-in-service-test' }
      })
    ));
    const flight = await prisma.flight.create({
      data: {
        flightNumber: flightNumbers[0],
        airline: 'Concurrency Air',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: new Date(Date.now() + 86_400_000),
        price: '$123.45',
        firstClassRows: 0,
        businessRows: 0,
        premiumEconomyRows: 0,
        economyRows: 2,
        seatPattern: 'AB-CD'
      }
    });
    const service = new FlightBookingService();
    const passenger = {
      firstName: 'Race', lastName: 'Traveler', dateOfBirth: '1990-01-01',
      passportNumber: 'RACE123', gender: 'Other', seatNumber: '1A',
      cabinClass: 'ECONOMY'
    };

    const results = await Promise.allSettled([
      service.bookFlight({
        flightId: flight.id,
        userId: firstUser.id,
        passengers: [passenger],
        idempotencyKey: '770b1f71-d1b3-43ed-886e-4c0ec45c4e8a'
      }),
      service.bookFlight({
        flightId: flight.id,
        userId: secondUser.id,
        passengers: [{ ...passenger, passportNumber: 'RACE456' }],
        idempotencyKey: '62a0767b-2913-4077-88e8-0f9391f13552'
      })
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.passenger.count({ where: { flightId: flight.id, seatNumber: '1A' } })).toBe(1);
    const persisted = await prisma.booking.findMany({ where: { flightId: flight.id } });
    expect(persisted).toHaveLength(1);
    // The integer total is authoritative; the string is retained for one release.
    expect(persisted[0]).toMatchObject({ totalPrice: '$123.45', totalPriceCents: 12345, paymentIntentId: null });
  });

  test('returns one booking when the same idempotency key is repeated', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    const flight = await prisma.flight.create({
      data: {
        flightNumber: flightNumbers[1],
        airline: 'Idempotent Air',
        from: 'Detroit, USA',
        to: 'Seattle, USA',
        departureDate: new Date(Date.now() + 172_800_000),
        price: '$200',
        firstClassRows: 0,
        businessRows: 1,
        premiumEconomyRows: 0,
        economyRows: 1,
        seatPattern: 'AB-CD'
      }
    });
    const request = {
      flightId: flight.id,
      userId: user.id,
      passengers: [{
        firstName: 'Repeat', lastName: 'Traveler', dateOfBirth: '1990-01-01',
        passportNumber: 'REPEAT123', gender: 'Other', seatNumber: '1A',
        cabinClass: 'BUSINESS'
      }],
      idempotencyKey: 'd9a8ce21-1b61-4e30-8670-cc6ab48534b9'
    };
    const service = new FlightBookingService();

    const first = await service.bookFlight(request);
    const retry = await service.bookFlight(request);

    expect(retry.id).toBe(first.id);
    expect(first).toMatchObject({ totalPrice: '$400', totalPriceCents: 40000, paymentIntentId: null, wasCreated: true });
    expect(retry).toMatchObject({ totalPrice: '$400', totalPriceCents: 40000, paymentIntentId: null, wasCreated: false });
    expect(await prisma.booking.count({
      where: { userId: user.id, idempotencyKey: request.idempotencyKey }
    })).toBe(1);

    await expect(service.bookFlight({
      ...request,
      passengers: [{ ...request.passengers[0], seatNumber: '1B' }]
    })).rejects.toThrow('Booking request ID was already used for a different booking.');

    const otherFlight = await prisma.flight.create({
      data: {
        flightNumber: flightNumbers[2],
        airline: 'Mismatch Air',
        from: 'Seattle, USA',
        to: 'Chicago, USA',
        departureDate: new Date(Date.now() + 259_200_000),
        price: '$250',
        firstClassRows: 0,
        businessRows: 1,
        premiumEconomyRows: 0,
        economyRows: 1,
        seatPattern: 'AB-CD'
      }
    });
    await expect(service.bookFlight({ ...request, flightId: otherFlight.id }))
      .rejects.toThrow('Booking request ID was already used for a different booking.');
  });
});
