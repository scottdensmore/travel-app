/** @jest-environment node */
import FlightScheduleService from '@/lib/FlightScheduleService';

describe('FlightScheduleService award seat propagation', () => {
    it('propagates custom award seat quotas from schedule to generated flight occurrences', async () => {
        const service = new FlightScheduleService();
        const schedule = {
            id: 999,
            flightNumber: 'MO101',
            airline: 'Mona Airways',
            from: 'SEA',
            to: 'JFK',
            departureTime: '08:00',
            durationMinutes: 300,
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            priceCents: 25000,
            isActive: true,
            awardSeatsEconomy: 6,
            awardSeatsPremiumEconomy: 3,
            awardSeatsBusiness: 2,
            awardSeatsFirst: 1,
        };

        const flightData = (service as any).buildFlightFromSchedule(schedule, new Date('2026-10-01T08:00:00Z'));
        expect(flightData.awardSeatsEconomy).toBe(6);
        expect(flightData.awardSeatsPremiumEconomy).toBe(3);
        expect(flightData.awardSeatsBusiness).toBe(2);
        expect(flightData.awardSeatsFirst).toBe(1);
    });
});
