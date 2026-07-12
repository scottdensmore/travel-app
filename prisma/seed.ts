import { PrismaClient } from '@prisma/client'
import CityGuideData from '../lib/data/CityGuideData'
import { FlightData, FlightScheduleData } from '../lib/data/FlightData'

const prisma = new PrismaClient()

async function main() {
    console.log('Start seeding ...')

    // Seed CityGuides
    for (const cityGuide of CityGuideData) {
        const existing = await prisma.cityGuide.findFirst({ where: { city: cityGuide.city } })
        if (!existing) {
            const guide = await prisma.cityGuide.create({
                data: {
                    city: cityGuide.city,
                    country: cityGuide.country,
                    latlong: cityGuide.latlong,
                    description: cityGuide.description,
                    highlights: cityGuide.highlights,
                    coverImage: cityGuide.coverImage,
                },
            })
            console.log(`Created city guide with id: ${guide.id}`)
        }
    }

    // Seed FlightSchedules
    for (const schedule of FlightScheduleData) {
        const existing = await prisma.flightSchedule.findFirst({ where: { flightNumber: schedule.flightNumber } })
        if (!existing) {
            await prisma.flightSchedule.create({
                data: schedule
            })
            console.log(`Created flight schedule: ${schedule.flightNumber}`)
        }
    }

    // Pre-populate Flight instances for the next 30 days from schedules
    const today = new Date();
    const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    for (let i = 0; i < 30; i++) {
        const date = new Date(utcToday);
        date.setUTCDate(utcToday.getUTCDate() + i);
        const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.

        for (const schedule of FlightScheduleData) {
            if (schedule.daysOfWeek.includes(dayOfWeek)) {
                // Generate flight dates
                const dateStr = date.toISOString().split('T')[0];
                const departureDate = new Date(`${dateStr}T${schedule.departureTime}:00Z`);
                
                let returnDate = null;
                if (schedule.returnTime) {
                    const retDate = new Date(date);
                    retDate.setUTCDate(date.getUTCDate() + 7); // Return leg departs 7 days later
                    const retDateStr = retDate.toISOString().split('T')[0];
                    returnDate = new Date(`${retDateStr}T${schedule.returnTime}:00Z`);
                }

                // Check if flight instance already exists for this number and departure date
                const existingInstance = await prisma.flight.findFirst({
                    where: {
                        flightNumber: schedule.flightNumber,
                        departureDate: departureDate
                    }
                });

                if (!existingInstance) {
                    const flight = await prisma.flight.create({
                        data: {
                            flightNumber: schedule.flightNumber,
                            airline: schedule.airline,
                            from: schedule.from,
                            to: schedule.to,
                            departureDate,
                            returnDate,
                            price: schedule.price,
                            status: 'ON_TIME'
                        }
                    });
                    console.log(`Pre-generated flight instance: ${flight.flightNumber} on ${dateStr}`);
                }
            }
        }
    }

    // Seed static legacy Flights (if they don't already exist, to prevent breaking old tests/data)
    for (const flightData of FlightData) {
        const existing = await prisma.flight.findFirst({
            where: {
                flightNumber: flightData.flightNumber,
                departureDate: flightData.departureDate
            }
        });
        if (!existing) {
            const flight = await prisma.flight.create({
                data: flightData
            })
            console.log(`Created static legacy flight with id: ${flight.id}`)
        }
    }

    console.log('Seeding finished.')
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
