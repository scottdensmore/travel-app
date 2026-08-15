import type { Page } from '@playwright/test';
import { flightDeparture } from '@/lib/flightTime';

interface SearchableFlight {
    departureDate: Date;
    fromAirport: { label: string };
    toAirport: { label: string };
}

export function flightSearchDate(flight: SearchableFlight): string {
    return flightDeparture({
        departureDate: flight.departureDate,
        from: flight.fromAirport.label,
    }).date;
}

export async function fillOneWayFlightSearch(page: Page, flight: SearchableFlight) {
    await page.getByLabel('One Way').click();
    await page.selectOption('#from', flight.fromAirport.label);
    await page.selectOption('#to', flight.toAirport.label);
    await page.fill('#depart', flightSearchDate(flight));
}
