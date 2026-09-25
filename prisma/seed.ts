import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { encryptPassengerData, getPassengerDataRetentionDeadline } from '../lib/passengerDataProtection'
import CityGuideData from '../lib/data/CityGuideData'
import AirportData from '../lib/data/AirportData'
import { FlightData, FlightScheduleData } from '../lib/data/FlightData'
import { airportCodesForRoute, airportTimeZoneFor } from '../lib/airports'
import { MAX_BOOKING_LEAD_DAYS } from '../lib/dates'
import FlightScheduleService from '../lib/FlightScheduleService'
import { airportLocalInstant } from '../lib/flightTime'
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
        // The fixture states a wall clock at the origin, the way the schedules
        // do. Written straight through it would be read as an instant and the
        // flight would leave at the wrong time of day (#84).
        const stated = flightData.departureDate.toISOString();
        const originZone = airportTimeZoneFor(flightData.from);
        const departureDate = originZone
            ? airportLocalInstant(stated.slice(0, 10), stated.slice(11, 16), originZone)
            : flightData.departureDate;

        const existing = await prisma.flight.findFirst({
            where: {
                flightNumber: flightData.flightNumber,
                departureDate
            }
        });
        if (!existing) {
            const { from, to, ...flightFields } = flightData;
            const flight = await prisma.flight.create({
                data: {
                    ...flightFields,
                    departureDate,
                    ...airportCodesForRoute(from, to),
                }
            })
            console.log(`Created static legacy flight with id: ${flight.id}`)
        }
    }

    // ----------------------------------------------------
    // Seed Real-World Test Users, Bookings, and Engagement
    // ----------------------------------------------------
    console.log('Seeding real-world test data ...')
    const hashedPassword = await bcrypt.hash('Password123!', 10)

    // 1. Diverse Real-World Users with Distinct Avatars
    const seedUsersData = [
        {
            name: 'Alex Traveler',
            email: 'alex.traveler@example.com',
            image: '/avatars/alex.jpg',
            timeZone: 'America/New_York',
            role: 'USER' as const,
        },
        {
            name: 'Sarah Admin',
            email: 'sarah.admin@example.com',
            image: '/avatars/sarah.jpg',
            timeZone: 'America/New_York',
            role: 'ADMIN' as const,
        },
        {
            name: 'Elena Rostova',
            email: 'elena.rostova@example.com',
            image: '/avatars/elena.jpg',
            timeZone: 'America/New_York',
            role: 'USER' as const,
        },
        {
            name: 'Marcus Vance',
            email: 'marcus.vance@example.com',
            image: '/avatars/marcus.jpg',
            timeZone: 'America/Chicago',
            role: 'USER' as const,
        },
        {
            name: 'Priya Patel',
            email: 'priya.patel@example.com',
            image: '/avatars/priya.jpg',
            timeZone: 'America/Los_Angeles',
            role: 'USER' as const,
        },
        {
            name: 'Kenji Sato',
            email: 'kenji.sato@example.com',
            image: '/avatars/kenji.jpg',
            timeZone: 'America/Los_Angeles',
            role: 'USER' as const,
        },
        {
            name: 'Aisha Diallo',
            email: 'aisha.diallo@example.com',
            image: '/avatars/aisha.jpg',
            timeZone: 'America/New_York',
            role: 'USER' as const,
        },
        {
            name: 'Diego Morales',
            email: 'diego.morales@example.com',
            image: '/avatars/diego.jpg',
            timeZone: 'America/Chicago',
            role: 'USER' as const,
        },
        {
            name: 'Chloe Bennett',
            email: 'chloe.bennett@example.com',
            image: '/avatars/chloe.jpg',
            timeZone: 'America/New_York',
            role: 'USER' as const,
        },
        {
            name: 'David Kim',
            email: 'david.kim@example.com',
            image: '/avatars/david.jpg',
            timeZone: 'America/Los_Angeles',
            role: 'USER' as const,
        },
    ]

    const usersByEmail = new Map<string, any>()
    for (const u of seedUsersData) {
        const user = await prisma.user.upsert({
            where: { email: u.email },
            update: {
                name: u.name,
                image: u.image,
                timeZone: u.timeZone,
                role: u.role,
            },
            create: {
                name: u.name,
                email: u.email,
                image: u.image,
                password: hashedPassword,
                emailVerified: new Date(),
                timeZone: u.timeZone,
                role: u.role,
            }
        })
        usersByEmail.set(u.email, user)
        console.log(`Seeded user: ${user.name} (${user.email}) [avatar: ${user.image}]`)
    }

    // Update active development user if present in database
    const devUserEmail = 'scottdensmore@mac.com'
    const existingDevUser = await prisma.user.findUnique({ where: { email: devUserEmail } })
    if (existingDevUser) {
        const updatedDevUser = await prisma.user.update({
            where: { email: devUserEmail },
            data: {
                image: existingDevUser.image || '/avatars/david.jpg',
                name: existingDevUser.name || 'Scott Densmore',
            }
        })
        usersByEmail.set(devUserEmail, updatedDevUser)
        console.log(`Updated active user avatar for ${devUserEmail}: ${updatedDevUser.image}`)
    }

    // Seed initial PointsLedgerEntry welcome grants (50,000 pts for seed dev users, 10,000 for standard user)
    console.log('Seeding points ledger welcome grants ...')
    for (const [email, user] of usersByEmail.entries()) {
        const isDevUser = email === devUserEmail || email === 'alex.traveler@example.com' || user.role === 'ADMIN'
        const amount = isDevUser ? 50000 : 10000
        const existingGrant = await prisma.pointsLedgerEntry.findFirst({
            where: {
                userId: user.id,
                type: 'WELCOME_GRANT',
            }
        })
        if (!existingGrant) {
            await prisma.pointsLedgerEntry.create({
                data: {
                    userId: user.id,
                    type: 'WELCOME_GRANT',
                    amount,
                    balanceAfter: amount,
                    description: isDevUser ? 'Welcome grant (development account)' : 'Welcome grant',
                }
            })
            console.log(`Granted ${amount} welcome points to ${user.name} (${user.email})`)
        }
    }

    const travelerUser = usersByEmail.get('alex.traveler@example.com')!

    // 2. Real-World Reviews across City Guides
    const seedReviews = [
        {
            city: 'New York',
            userEmail: 'alex.traveler@example.com',
            rating: 5,
            content: 'Central Park and the Broadway theaters were magnificent! Incredible energy, endless dining options, and easy transit.',
        },
        {
            city: 'New York',
            userEmail: 'priya.patel@example.com',
            rating: 5,
            content: 'The High Line at golden hour and MoMA were absolute highlights. Walking across the Brooklyn Bridge is unforgettable on clear mornings.',
        },
        {
            city: 'Seattle',
            userEmail: 'alex.traveler@example.com',
            rating: 5,
            content: 'Pike Place Market and the Space Needle are must-visits. The Pacific Northwest scenery and coffee culture are second to none.',
        },
        {
            city: 'Seattle',
            userEmail: 'marcus.vance@example.com',
            rating: 4,
            content: 'Chihuly Garden and Glass is breathtaking. Excellent fresh Dungeness crab at the waterfront, though be prepared for brisk drizzle in autumn.',
        },
        {
            city: 'Los Angeles',
            userEmail: 'kenji.sato@example.com',
            rating: 5,
            content: 'Phenomenal food scene from street tacos in East LA to sushi in Little Tokyo. Sunset view from Griffith Observatory over the basin is unforgettable.',
        },
        {
            city: 'Los Angeles',
            userEmail: 'elena.rostova@example.com',
            rating: 4,
            content: 'Santa Monica beach walk and biking down to Venice Beach were idyllic. Having a rental car made exploring different neighborhoods effortless.',
        },
        {
            city: 'Chicago',
            userEmail: 'marcus.vance@example.com',
            rating: 5,
            content: 'The architecture boat tour along the Chicago River is the best urban tour anywhere. Deep-dish pizza at Lou Malnati’s definitely lived up to the hype.',
        },
        {
            city: 'Chicago',
            userEmail: 'aisha.diallo@example.com',
            rating: 5,
            content: 'Millennium Park, Cloud Gate, and the Art Institute are world-class. The lakefront trail offers breathtaking views of the skyline.',
        },
        {
            city: 'Miami',
            userEmail: 'elena.rostova@example.com',
            rating: 5,
            content: 'South Beach Art Deco architecture is stunning in person. Wynwood Walls murals and Little Havana live salsa music made this trip unforgettable.',
        },
        {
            city: 'Miami',
            userEmail: 'diego.morales@example.com',
            rating: 5,
            content: 'Cuban coffee in Calle Ocho and snorkeling along Biscayne Bay. Mona Airways direct flight was smooth and punctual.',
        },
        {
            city: 'Boston',
            userEmail: 'aisha.diallo@example.com',
            rating: 5,
            content: 'Walking the Freedom Trail brought American history to life. North End Italian pastries and strolling Harvard Square were wonderful highlights.',
        },
        {
            city: 'Boston',
            userEmail: 'david.kim@example.com',
            rating: 4,
            content: 'Boston Common during peak fall foliage was gorgeous. Superb walkability across all historic cobblestone streets.',
        },
        {
            city: 'New Orleans',
            userEmail: 'diego.morales@example.com',
            rating: 5,
            content: 'Preservation Hall jazz, beignets at Café du Monde, and the vibrant brass bands in the French Quarter. The soul of this city is unmatched.',
        },
        {
            city: 'New Orleans',
            userEmail: 'chloe.bennett@example.com',
            rating: 5,
            content: 'The historic Garden District architecture and Frenchmen Street evening music venues. Easily the best culinary and cultural trip of our year.',
        },
        {
            city: 'Las Vegas',
            userEmail: 'chloe.bennett@example.com',
            rating: 4,
            content: 'The Bellagio fountains and Cirque du Soleil were spectacular. The Neon Museum at dusk was an unexpected photographic gem.',
        },
        {
            city: 'Las Vegas',
            userEmail: 'kenji.sato@example.com',
            rating: 5,
            content: 'World-class chef residencies and phenomenal culinary experiences everywhere on the Strip. A morning flight out to Red Rock Canyon is well worth it.',
        },
        {
            city: 'Orlando',
            userEmail: 'david.kim@example.com',
            rating: 5,
            content: 'Fantastic family getaway. Beyond the theme parks, staying near Lake Eola offered charming evening strolls and great local dining.',
        },
        {
            city: 'Detroit',
            userEmail: 'priya.patel@example.com',
            rating: 5,
            content: 'The Motown Museum and Detroit Institute of Arts were deeply inspiring. The downtown revitalization and architectural heritage are impressive.',
        },
    ]

    for (const r of seedReviews) {
        const user = usersByEmail.get(r.userEmail)
        const cityGuide = await prisma.cityGuide.findFirst({ where: { city: r.city } })
        if (user && cityGuide) {
            const existingReview = await prisma.review.findFirst({
                where: { userId: user.id, cityGuideId: cityGuide.id }
            })
            if (!existingReview) {
                await prisma.review.create({
                    data: {
                        userId: user.id,
                        cityGuideId: cityGuide.id,
                        rating: r.rating,
                        content: r.content,
                    }
                })
            }
        }
    }
    console.log(`Seeded ${seedReviews.length} real-world city guide reviews with distinct avatars.`)

    // 3. User Favorites
    const seedFavorites = [
        { email: 'alex.traveler@example.com', cities: ['New York', 'Seattle', 'Chicago', 'Miami'] },
        { email: 'elena.rostova@example.com', cities: ['Miami', 'Los Angeles', 'New Orleans'] },
        { email: 'marcus.vance@example.com', cities: ['Chicago', 'Seattle', 'Detroit'] },
        { email: 'priya.patel@example.com', cities: ['New York', 'Detroit', 'Boston'] },
        { email: 'kenji.sato@example.com', cities: ['Los Angeles', 'Las Vegas', 'Seattle'] },
        { email: 'aisha.diallo@example.com', cities: ['Boston', 'Chicago', 'New York'] },
        { email: 'diego.morales@example.com', cities: ['New Orleans', 'Miami'] },
        { email: 'chloe.bennett@example.com', cities: ['New Orleans', 'Las Vegas', 'New York'] },
        { email: 'david.kim@example.com', cities: ['Boston', 'Orlando', 'Los Angeles'] },
    ]
    if (existingDevUser) {
        seedFavorites.push({ email: devUserEmail, cities: ['Seattle', 'New York', 'Boston'] })
    }

    for (const fav of seedFavorites) {
        const user = usersByEmail.get(fav.email)
        if (user) {
            for (const cityName of fav.cities) {
                const guide = await prisma.cityGuide.findFirst({ where: { city: cityName } })
                if (guide) {
                    await prisma.userFavorite.upsert({
                        where: {
                            userId_cityGuideId: {
                                userId: user.id,
                                cityGuideId: guide.id,
                            }
                        },
                        update: {},
                        create: {
                            userId: user.id,
                            cityGuideId: guide.id,
                        }
                    })
                }
            }
        }
    }

    // 4. Notifications
    const notificationRecipients = [travelerUser]
    if (existingDevUser) {
        notificationRecipients.push(usersByEmail.get(devUserEmail)!)
    }

    for (const recipient of notificationRecipients) {
        const testNotifications = [
            {
                userId: recipient.id,
                type: 'FLIGHT_STATUS',
                title: 'Upcoming Flight Confirmed',
                message: 'Your reservation for New York (JFK) to London (LHR) is confirmed. Check-in opens 24 hours before departure.',
                isRead: false,
            },
            {
                userId: recipient.id,
                type: 'POINTS',
                title: 'Mona Club Points Added',
                message: 'You have earned 1,200 travel reward points for your recent flight reservation.',
                isRead: true,
            },
            {
                userId: recipient.id,
                type: 'FLIGHT_STATUS',
                title: 'Gate Assignment Update',
                message: 'Flight MA101 departure gate has been assigned to Gate B14 with on-time departure.',
                isRead: true,
            }
        ]

        for (const notif of testNotifications) {
            const existing = await prisma.notification.findFirst({
                where: { userId: notif.userId, title: notif.title }
            })
            if (!existing) {
                await prisma.notification.create({ data: notif })
            }
        }
    }

    // 5. Booking Seeding Helper
    async function seedBookingForUser(
        user: any,
        flight: any,
        options: {
            passengerName: { first: string; last: string };
            seatNumber: string;
            cabinClass: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
            isPast?: boolean;
            totalPriceCents: number;
        }
    ) {
        const existingBooking = await prisma.booking.findFirst({
            where: {
                userId: user.id,
                legs: { some: { flightId: flight.id } }
            }
        })
        if (existingBooking) return existingBooking

        const passengerId = randomUUID()
        const retention = getPassengerDataRetentionDeadline(flight.departureDate)
        const dobEnc = encryptPassengerData('1990-05-15', { passengerId, field: 'dateOfBirth' })
        const passportEnc = encryptPassengerData('A12345678', { passengerId, field: 'passportNumber' })

        const booking = await prisma.booking.create({
            data: {
                userId: user.id,
                totalPriceCents: options.totalPriceCents,
                currency: 'USD',
                status: 'CONFIRMED',
                legs: {
                    create: [{
                        sequence: 1,
                        flightId: flight.id,
                    }]
                },
                passengers: {
                    create: [{
                        id: passengerId,
                        firstName: options.passengerName.first,
                        lastName: options.passengerName.last,
                        gender: 'M',
                        dateOfBirthEncrypted: dobEnc,
                        passportNumberEncrypted: passportEnc,
                        sensitiveDataExpiresAt: retention,
                        documentsConfirmedAt: new Date(),
                    }]
                },
                statusChanges: {
                    create: [{
                        to: 'CONFIRMED',
                        reason: options.isPast ? 'Flight journey completed' : 'Initial flight reservation confirmed',
                    }]
                }
            },
            include: {
                passengers: true,
                legs: true,
            }
        })

        await prisma.seatAssignment.create({
            data: {
                passengerId: booking.passengers[0].id,
                legId: booking.legs[0].id,
                flightId: flight.id,
                seatNumber: options.seatNumber,
                cabinClass: options.cabinClass,
                checkedInAt: options.isPast ? flight.departureDate : null,
            }
        })

        await prisma.passengerAncillary.createMany({
            data: [
                { passengerId: booking.passengers[0].id, type: 'CARRY_ON', priceCents: 3500 },
                { passengerId: booking.passengers[0].id, type: 'CHECKED_BAG_1', priceCents: 4500 },
            ]
        })

        console.log(`Created ${options.isPast ? 'past' : 'upcoming'} test booking ${booking.reference} for ${user.email}`)
        return booking
    }

    // 6. Upcoming Booking
    const upcomingFlight = await prisma.flight.findFirst({
        where: {
            fromAirportCode: 'JFK',
            toAirportCode: 'LHR',
            departureDate: { gte: new Date() }
        },
        orderBy: { departureDate: 'asc' }
    }) || await prisma.flight.findFirst({
        where: { departureDate: { gte: new Date() } },
        orderBy: { departureDate: 'asc' }
    })

    if (upcomingFlight) {
        await seedBookingForUser(travelerUser, upcomingFlight, {
            passengerName: { first: 'Alex', last: 'Traveler' },
            seatNumber: '12A',
            cabinClass: 'ECONOMY',
            totalPriceCents: 93000,
        })

        if (existingDevUser) {
            await seedBookingForUser(usersByEmail.get(devUserEmail)!, upcomingFlight, {
                passengerName: { first: 'Scott', last: 'Densmore' },
                seatNumber: '3A',
                cabinClass: 'BUSINESS',
                totalPriceCents: 185000,
            })
        }
    }

    // 7. Past Booking (for travel history and points activity)
    const pastFlight = await prisma.flight.findFirst({
        where: { departureDate: { lt: new Date() } },
        orderBy: { departureDate: 'desc' }
    })

    if (pastFlight) {
        await seedBookingForUser(travelerUser, pastFlight, {
            passengerName: { first: 'Alex', last: 'Traveler' },
            seatNumber: '4B',
            cabinClass: 'BUSINESS',
            isPast: true,
            totalPriceCents: 45000,
        })
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
