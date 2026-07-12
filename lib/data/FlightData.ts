export const FlightData = [
    {
        flightNumber: 'CA101',
        airline: 'Gemini Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureDate: new Date('2026-05-15T08:00:00Z'),
        returnDate: new Date('2026-05-22T18:00:00Z'),
        price: '$350',
        status: 'ON_TIME'
    },
    {
        flightNumber: 'CA202',
        airline: 'Gemini Airways',
        from: 'New York, USA',
        to: 'London, UK',
        departureDate: new Date('2026-06-10T19:30:00Z'),
        returnDate: new Date('2026-06-20T10:00:00Z'),
        price: '$850',
        status: 'DELAYED'
    },
    {
        flightNumber: 'CA303',
        airline: 'Gemini Airways',
        from: 'San Francisco, USA',
        to: 'Tokyo, Japan',
        departureDate: new Date('2026-07-05T11:00:00Z'),
        returnDate: new Date('2026-07-15T15:00:00Z'),
        price: '$1200',
        status: 'CANCELLED'
    },
    {
        flightNumber: 'CA404',
        airline: 'Gemini Airways',
        from: 'Chicago, USA',
        to: 'Paris, France',
        departureDate: new Date('2026-08-12T17:45:00Z'),
        returnDate: new Date('2026-08-26T09:30:00Z'),
        price: '$950',
        status: 'ON_TIME'
    },
    {
        flightNumber: 'CA505',
        airline: 'Gemini Airways',
        from: 'Miami, USA',
        to: 'Rio de Janeiro, Brazil',
        departureDate: new Date('2026-09-18T22:00:00Z'),
        returnDate: null,
        price: '$500',
        status: 'ON_TIME'
    }
];

export const FlightScheduleData = [
    {
        flightNumber: 'CA101',
        airline: 'Gemini Airways',
        from: 'Seattle, USA',
        to: 'Detroit, USA',
        departureTime: '08:00',
        returnTime: '18:00',
        daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
        price: '$350'
    },
    {
        flightNumber: 'CA202',
        airline: 'Gemini Airways',
        from: 'New York, USA',
        to: 'London, UK',
        departureTime: '19:30',
        returnTime: '10:00',
        daysOfWeek: [2, 4, 6], // Tue, Thu, Sat
        price: '$850'
    },
    {
        flightNumber: 'CA303',
        airline: 'Gemini Airways',
        from: 'San Francisco, USA',
        to: 'Tokyo, Japan',
        departureTime: '11:00',
        returnTime: '15:00',
        daysOfWeek: [0, 2, 4], // Sun, Tue, Thu
        price: '$1200'
    },
    {
        flightNumber: 'CA404',
        airline: 'Gemini Airways',
        from: 'Chicago, USA',
        to: 'Paris, France',
        departureTime: '17:45',
        returnTime: '09:30',
        daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
        price: '$950'
    },
    {
        flightNumber: 'CA505',
        airline: 'Gemini Airways',
        from: 'Miami, USA',
        to: 'Rio de Janeiro, Brazil',
        departureTime: '22:00',
        returnTime: null,
        daysOfWeek: [0, 3, 5], // Sun, Wed, Fri
        price: '$500'
    }
];

export default FlightData;
