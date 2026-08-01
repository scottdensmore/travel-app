import FlightScheduleService from '@/lib/FlightScheduleService';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        flightSchedule: { findMany: jest.fn() },
        flight: { findFirst: jest.fn(), create: jest.fn(), groupBy: jest.fn() }
    }
}));

const mockedFlightScheduleFindMany = prisma.flightSchedule.findMany as jest.Mock;
const mockedFlightFindFirst = prisma.flight.findFirst as jest.Mock;
const mockedFlightCreate = prisma.flight.create as jest.Mock;
const mockedFlightGroupBy = prisma.flight.groupBy as unknown as jest.Mock;

describe('FlightScheduleService dynamic generator', () => {
    let service: FlightScheduleService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new FlightScheduleService();
    });

    it('finds active schedules for the day of week and generates flight instances if missing', async () => {
        // Date is 2026-06-25 (Thursday -> getDay() returns 4)
        const date = new Date('2026-06-25T12:00:00Z');

        const mockSchedules = [
            {
                id: 1,
                flightNumber: 'CA101',
                airline: 'Gemini Airways',
                from: 'Seattle, USA',
                to: 'Detroit, USA',
                departureTime: '08:00',
                returnTime: '18:00',
                daysOfWeek: [1, 3, 5],
                price: '$350'
            },
            {
                id: 2,
                flightNumber: 'CA202',
                airline: 'Gemini Airways',
                from: 'New York, USA',
                to: 'London, UK',
                departureTime: '19:30',
                returnTime: null, // one-way
                daysOfWeek: [2, 4, 6],
                price: '$850',
                firstClassRows: 1,
                businessRows: 2,
                premiumEconomyRows: 3,
                economyRows: 18,
                seatPattern: 'AC-DF'
            }
        ];

        // Only schedule 2 runs on day 4 (Thursday)
        mockedFlightScheduleFindMany.mockResolvedValue([mockSchedules[1]]);
        mockedFlightFindFirst.mockResolvedValue(null); // Instance does not exist yet
        mockedFlightCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: 100, ...data }));

        const result = await service.generateFlightsForDate(date);

        expect(mockedFlightScheduleFindMany).toHaveBeenCalledWith({
            where: {
                isActive: true,
                daysOfWeek: {
                    has: 4
                }
            }
        });

        // Verifies correct instance check in DB
        expect(mockedFlightFindFirst).toHaveBeenCalledWith({
            where: {
                flightNumber: 'CA202',
                departureDate: new Date('2026-06-25T19:30:00Z')
            }
        });

        // Verifies correct instance creation
        expect(mockedFlightCreate).toHaveBeenCalledWith({
            data: {
                flightNumber: 'CA202',
                airline: 'Gemini Airways',
                from: 'New York, USA',
                to: 'London, UK',
                departureDate: new Date('2026-06-25T19:30:00Z'),
                returnDate: null,
                price: '$850',
                firstClassRows: 1,
                businessRows: 2,
                premiumEconomyRows: 3,
                economyRows: 18,
                seatPattern: 'AC-DF',
                status: 'ON_TIME'
            }
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty('flightNumber', 'CA202');
    });

    it('does not create a flight instance if it already exists in the database', async () => {
        const date = new Date('2026-06-25T12:00:00Z');
        const mockSchedule = {
            id: 2,
            flightNumber: 'CA202',
            airline: 'Gemini Airways',
            from: 'New York, USA',
            to: 'London, UK',
            departureTime: '19:30',
            returnTime: null,
            daysOfWeek: [4],
            price: '$850'
        };

        mockedFlightScheduleFindMany.mockResolvedValue([mockSchedule]);
        
        // Instance already exists
        const existingFlight = {
            id: 999,
            flightNumber: 'CA202',
            airline: 'Gemini Airways',
            from: 'New York, USA',
            to: 'London, UK',
            departureDate: new Date('2026-06-25T19:30:00Z'),
            returnDate: null,
            price: '$850',
            status: 'DELAYED' // Administrative override preserved
        };
        mockedFlightFindFirst.mockResolvedValue(existingFlight);

        const result = await service.generateFlightsForDate(date);

        expect(mockedFlightFindFirst).toHaveBeenCalled();
        expect(mockedFlightCreate).not.toHaveBeenCalled();
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(existingFlight);
    });

    it('handles database race condition (P2002 error) gracefully during creation and returns the existing record', async () => {
        const date = new Date('2026-06-25T12:00:00Z');
        const mockSchedule = {
            id: 2,
            flightNumber: 'CA202',
            airline: 'Gemini Airways',
            from: 'New York, USA',
            to: 'London, UK',
            departureTime: '19:30',
            returnTime: null,
            daysOfWeek: [4],
            price: '$850'
        };

        mockedFlightScheduleFindMany.mockResolvedValue([mockSchedule]);
        mockedFlightFindFirst.mockResolvedValueOnce(null); // Initially not found in check

        // Mock error object for duplicate key violation in Prisma (P2002)
        const prismaError = new Error('Prisma unique constraint failed');
        (prismaError as any).code = 'P2002';
        mockedFlightCreate.mockRejectedValueOnce(prismaError);

        // Subsequent findFirst returns the instance inserted concurrently
        const concurrentFlight = {
            id: 101,
            flightNumber: 'CA202',
            airline: 'Gemini Airways',
            from: 'New York, USA',
            to: 'London, UK',
            departureDate: new Date('2026-06-25T19:30:00Z'),
            returnDate: null,
                price: '$850',
                status: 'ON_TIME',
                firstClassRows: 1,
                businessRows: 2,
                premiumEconomyRows: 3,
                economyRows: 18,
                seatPattern: 'AC-DF'
        };
        mockedFlightFindFirst.mockResolvedValueOnce(concurrentFlight);

        const result = await service.generateFlightsForDate(date);

        expect(mockedFlightCreate).toHaveBeenCalled();
        expect(mockedFlightFindFirst).toHaveBeenCalledTimes(2); // Initial check + after catch
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(concurrentFlight);
    });

    it('reports whether each instance was created or already present', async () => {
        const date = new Date('2026-06-25T12:00:00Z');
        const schedule = {
            id: 2,
            flightNumber: 'CA202',
            airline: 'Gemini Airways',
            from: 'New York, USA',
            to: 'London, UK',
            departureTime: '19:30',
            returnTime: null,
            daysOfWeek: [4],
            price: '$850'
        };

        mockedFlightScheduleFindMany.mockResolvedValue([schedule]);
        mockedFlightFindFirst.mockResolvedValue(null);
        mockedFlightCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: 100, ...data }));

        await expect(service.ensureFlightsForDate(date)).resolves.toEqual([
            { flight: expect.objectContaining({ flightNumber: 'CA202' }), created: true }
        ]);
    });

    it('throws other errors encountered during flight instance creation', async () => {
        const date = new Date('2026-06-25T12:00:00Z');
        const mockSchedule = {
            id: 2,
            flightNumber: 'CA202',
            airline: 'Gemini Airways',
            from: 'New York, USA',
            to: 'London, UK',
            departureTime: '19:30',
            returnTime: null,
            daysOfWeek: [4],
            price: '$850'
        };

        mockedFlightScheduleFindMany.mockResolvedValue([mockSchedule]);
        mockedFlightFindFirst.mockResolvedValue(null);

        const standardError = new Error('Connection failed');
        mockedFlightCreate.mockRejectedValue(standardError);

        await expect(service.generateFlightsForDate(date)).rejects.toThrow('Connection failed');
    });
});

describe('FlightScheduleService inventory horizon', () => {
    let service: FlightScheduleService;

    // A schedule that operates every day of the week, so each horizon day
    // produces exactly one instance.
    const dailySchedule = {
        id: 7,
        flightNumber: 'CA303',
        airline: 'Gemini Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureTime: '08:00',
        returnTime: null,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        price: '$350'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        service = new FlightScheduleService();
        mockedFlightScheduleFindMany.mockResolvedValue([dailySchedule]);
    });

    it('fills every day of the requested horizon', async () => {
        mockedFlightFindFirst.mockResolvedValue(null);
        mockedFlightCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data }));

        const summary = await service.generateFlightsForHorizon(new Date('2026-06-25T12:00:00Z'), 3);

        expect(mockedFlightScheduleFindMany).toHaveBeenCalledTimes(3);
        expect(mockedFlightCreate).toHaveBeenCalledTimes(3);
        expect(mockedFlightCreate.mock.calls.map(([{ data }]: any) => data.departureDate)).toEqual([
            new Date('2026-06-25T08:00:00Z'),
            new Date('2026-06-26T08:00:00Z'),
            new Date('2026-06-27T08:00:00Z'),
        ]);
        expect(summary).toEqual({
            fromDate: '2026-06-25',
            throughDate: '2026-06-27',
            days: 3,
            created: 3,
            alreadyPresent: 0,
        });
    });

    it('creates nothing on a second run over the same horizon', async () => {
        mockedFlightFindFirst.mockResolvedValue({ id: 1, flightNumber: 'CA303' });

        const summary = await service.generateFlightsForHorizon(new Date('2026-06-25T12:00:00Z'), 3);

        expect(mockedFlightCreate).not.toHaveBeenCalled();
        expect(summary).toMatchObject({ created: 0, alreadyPresent: 3 });
    });

    it('anchors the horizon on the UTC day, not the time of day it runs', async () => {
        mockedFlightFindFirst.mockResolvedValue({ id: 1 });

        // A scheduler firing just before midnight UTC must still cover today.
        const summary = await service.generateFlightsForHorizon(new Date('2026-06-25T23:59:59Z'), 2);

        expect(summary).toMatchObject({ fromDate: '2026-06-25', throughDate: '2026-06-26' });
    });

    it('rejects a horizon that is not a positive number of days', async () => {
        await expect(service.generateFlightsForHorizon(new Date('2026-06-25T12:00:00Z'), 0))
            .rejects.toThrow('Horizon must cover at least one day.');
        await expect(service.generateFlightsForHorizon(new Date('2026-06-25T12:00:00Z'), 1.5))
            .rejects.toThrow('Horizon must cover at least one day.');
    });

    it('rejects a horizon longer than the bookable window', async () => {
        await expect(service.generateFlightsForHorizon(new Date('2026-06-25T12:00:00Z'), 367))
            .rejects.toThrow('Horizon cannot exceed 366 days.');
        expect(mockedFlightScheduleFindMany).not.toHaveBeenCalled();
    });
});

describe('FlightScheduleService inventory coverage', () => {
    let service: FlightScheduleService;

    const schedules = [
        { flightNumber: 'CA303', isActive: true },
        { flightNumber: 'CA404', isActive: true },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        service = new FlightScheduleService();
        mockedFlightScheduleFindMany.mockResolvedValue(schedules);
    });

    it('reports how far ahead each active schedule has inventory', async () => {
        mockedFlightGroupBy.mockResolvedValue([
            { flightNumber: 'CA303', _max: { departureDate: new Date('2026-08-20T08:00:00Z') } },
            { flightNumber: 'CA404', _max: { departureDate: new Date('2026-07-11T08:00:00Z') } },
        ]);

        const coverage = await service.reportInventoryCoverage(30, new Date('2026-06-25T12:00:00Z'));

        expect(coverage).toEqual({
            asOfDate: '2026-06-25',
            requiredDays: 30,
            shortestDaysCovered: 16,
            isSufficient: false,
            schedules: [
                { flightNumber: 'CA303', coveredThroughDate: '2026-08-20', daysCovered: 56 },
                { flightNumber: 'CA404', coveredThroughDate: '2026-07-11', daysCovered: 16 },
            ],
        });
    });

    it('is sufficient when the shortest covered schedule clears the requirement', async () => {
        mockedFlightGroupBy.mockResolvedValue([
            { flightNumber: 'CA303', _max: { departureDate: new Date('2026-07-25T08:00:00Z') } },
            { flightNumber: 'CA404', _max: { departureDate: new Date('2026-07-30T08:00:00Z') } },
        ]);

        const coverage = await service.reportInventoryCoverage(30, new Date('2026-06-25T12:00:00Z'));

        expect(coverage.shortestDaysCovered).toBe(30);
        expect(coverage.isSufficient).toBe(true);
    });

    it('treats a schedule with no instances at all as zero coverage', async () => {
        // The scheduler has never run for a newly added schedule.
        mockedFlightGroupBy.mockResolvedValue([
            { flightNumber: 'CA303', _max: { departureDate: new Date('2026-08-20T08:00:00Z') } },
        ]);

        const coverage = await service.reportInventoryCoverage(30, new Date('2026-06-25T12:00:00Z'));

        expect(coverage.schedules).toContainEqual({
            flightNumber: 'CA404',
            coveredThroughDate: null,
            daysCovered: 0,
        });
        expect(coverage.shortestDaysCovered).toBe(0);
        expect(coverage.isSufficient).toBe(false);
    });

    it('does not count inventory that has already fallen behind today', async () => {
        mockedFlightGroupBy.mockResolvedValue([
            { flightNumber: 'CA303', _max: { departureDate: new Date('2026-06-01T08:00:00Z') } },
            { flightNumber: 'CA404', _max: { departureDate: new Date('2026-08-20T08:00:00Z') } },
        ]);

        const coverage = await service.reportInventoryCoverage(30, new Date('2026-06-25T12:00:00Z'));

        expect(coverage.schedules[0]).toEqual({
            flightNumber: 'CA303',
            coveredThroughDate: '2026-06-01',
            daysCovered: 0,
        });
        expect(coverage.isSufficient).toBe(false);
    });

    it('reports sufficient coverage when no schedules are active', async () => {
        mockedFlightScheduleFindMany.mockResolvedValue([]);

        const coverage = await service.reportInventoryCoverage(30, new Date('2026-06-25T12:00:00Z'));

        expect(coverage.schedules).toEqual([]);
        expect(coverage.isSufficient).toBe(true);
        expect(mockedFlightGroupBy).not.toHaveBeenCalled();
    });
});
