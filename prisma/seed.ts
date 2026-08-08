import { PrismaClient } from '@prisma/client'
import CityGuideData from '../lib/data/CityGuideData'
import AirportData from '../lib/data/AirportData'
import { FlightData, FlightScheduleData } from '../lib/data/FlightData'
import { airportCodesForRoute } from '../lib/airports'
import { MAX_BOOKING_LEAD_DAYS } from '../lib/dates'
import FlightScheduleService from '../lib/FlightScheduleService'
import { prisma as applicationPrisma } from '../lib/prisma'

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

    // Seed Airports. Upserted rather than skipped when present, because a
    // corrected timezone has to reach an existing database.
    for (const airport of AirportData) {
        await prisma.airport.upsert({
            where: { iataCode: airport.iataCode },
            update: airport,
            create: airport,
        })
    }
    console.log(`Seeded ${AirportData.length} airports`)

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

    // Pre-populate Flight instances across the whole bookable window. Searching
    // is read-only (#71), so every date a customer may select has to have its
    // inventory generated before the search runs. This uses the same service the
    // scheduler and the administrative generator use, rather than a second copy
    // of the rule (#99).
    const horizon = await new FlightScheduleService()
        .generateFlightsForHorizon(new Date(), MAX_BOOKING_LEAD_DAYS + 1);
    console.log(
        `Pre-generated flight inventory ${horizon.fromDate} through ${horizon.throughDate}: `
        + `${horizon.created} created, ${horizon.alreadyPresent} already present`
    );

    // Seed static legacy Flights (if they don't already exist, to prevent breaking old tests/data)
    for (const flightData of FlightData) {
        const existing = await prisma.flight.findFirst({
            where: {
                flightNumber: flightData.flightNumber,
                departureDate: flightData.departureDate
            }
        });
        if (!existing) {
            const { from, to, ...flightFields } = flightData;
            const flight = await prisma.flight.create({
                data: {
                    ...flightFields,
                    ...airportCodesForRoute(from, to),
                }
            })
            console.log(`Created static legacy flight with id: ${flight.id}`)
        }
    }

    console.log('Seeding finished.')
}

main()
    .then(async () => {
        // The generation service holds its own client, so disconnect both or the
        // seed process will not exit.
        await Promise.all([prisma.$disconnect(), applicationPrisma.$disconnect()])
    })
    .catch(async (e) => {
        console.error(e)
        // The generation service holds its own client, so disconnect both or the
        // seed process will not exit.
        await Promise.all([prisma.$disconnect(), applicationPrisma.$disconnect()])
        process.exit(1)
    })
