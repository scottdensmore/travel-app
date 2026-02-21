import { PrismaClient } from '@prisma/client'
import CityGuideData from '../lib/data/CityGuideData'
import FlightData from '../lib/data/FlightData'

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

    // Seed Flights
    for (const flightData of FlightData) {
        const existing = await prisma.flight.findFirst({ where: { flightNumber: flightData.flightNumber } })
        if (!existing) {
            const flight = await prisma.flight.create({
                data: flightData
            })
            console.log(`Created flight with id: ${flight.id}`)
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
