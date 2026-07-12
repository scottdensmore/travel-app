import FlightScheduleService from '@/lib/FlightScheduleService';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        flightSchedule: { findMany: jest.fn() },
        flight: { findFirst: jest.fn(), create: jest.fn() }
    }
}));

const mockedFlightScheduleFindMany = prisma.flightSchedule.findMany as jest.Mock;
const mockedFlightFindFirst = prisma.flight.findFirst as jest.Mock;
const mockedFlightCreate = prisma.flight.create as jest.Mock;

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
                price: '$850'
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
            status: 'ON_TIME'
        };
        mockedFlightFindFirst.mockResolvedValueOnce(concurrentFlight);

        const result = await service.generateFlightsForDate(date);

        expect(mockedFlightCreate).toHaveBeenCalled();
        expect(mockedFlightFindFirst).toHaveBeenCalledTimes(2); // Initial check + after catch
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(concurrentFlight);
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
