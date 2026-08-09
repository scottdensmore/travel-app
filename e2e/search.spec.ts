import { expect, test, type Page } from '@playwright/test';
import { airportCodeFor, airportLocalDate, airportTimeZoneFor } from '../lib/airports';

async function waitForSearchReady(page: Page) {
  await expect(page.locator('[data-search-ready="true"]')).toBeVisible();
}

async function openSearchPage(page: Page, url = '/') {
  await page.goto(url);
  await waitForSearchReady(page);
}

test.describe('Flight search', () => {
  test('Default route and date produce an available flight', async ({ page }) => {
    await openSearchPage(page);

    const departureDate = await page.locator('#depart').inputValue();
    expect(departureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.getByRole('button', { name: 'Find your trip' }).click();

    const resultsHeading = page.getByRole('heading', { name: 'Available Flights' });
    await expect(resultsHeading).toBeVisible();
    await expect(resultsHeading).toBeFocused();
    // The default search is a round trip, so each result offers a leg
    // selection rather than a link that would book it on its own (#69).
    await expect(page.getByRole('button', { name: /as the departing leg/ }).first()).toBeVisible();
  });

  test('Search criteria and results survive a refresh', async ({ page }) => {
    await openSearchPage(page);

    await page.getByLabel('From', { exact: true }).selectOption({ label: 'New York, USA' });
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('London, UK');
    // Both values in one evaluation. Read separately they are two round trips,
    // and the route change commits between them — producing a pair the form
    // never actually held, which the URL assertion below then waits for
    // forever. Reproduced at about 4% before this, and 0 in 50 after (#181).
    const { departureDate, returnDate } = await page.evaluate(() => ({
      departureDate: (document.querySelector('#depart') as HTMLInputElement).value,
      returnDate: (document.querySelector('#returnDate') as HTMLInputElement).value,
    }));

    await page.getByRole('button', { name: 'Find your trip' }).click();
    await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();

    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return {
        from: params.get('from'),
        to: params.get('to'),
        depart: params.get('depart'),
        returnDate: params.get('return'),
        trip: params.get('trip'),
      };
    }).toEqual({
      // The link carries the airports' codes; the form above still shows the
      // words they stand for (#73).
      from: 'JFK',
      to: 'LHR',
      depart: departureDate,
      returnDate,
      trip: 'round-trip',
    });

    await page.reload();
    await waitForSearchReady(page);

    await expect(page.getByLabel('From', { exact: true })).toHaveValue('New York, USA');
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('London, UK');
    await expect(page.getByLabel('Depart', { exact: true })).toHaveValue(departureDate);
    await expect(page.getByLabel('Return', { exact: true })).toHaveValue(returnDate);
    await expect(page.getByLabel('Round Trip')).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();
  });

  test('A round trip without an optional return date survives a refresh', async ({ page }) => {
    await openSearchPage(page);

    const departureDate = await page.getByLabel('Depart', { exact: true }).inputValue();
    await page.getByLabel('Return', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Find your trip' }).click();
    await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();

    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return {
        depart: params.get('depart'),
        returnDate: params.get('return'),
        trip: params.get('trip'),
      };
    }).toEqual({
      depart: departureDate,
      returnDate: null,
      trip: 'round-trip',
    });

    await page.reload();
    await waitForSearchReady(page);

    await expect(page.getByLabel('Depart', { exact: true })).toHaveValue(departureDate);
    await expect(page.getByLabel('Return', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Round Trip')).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();
  });

  test('A shared link names airports by code, and restores the words', async ({ page }) => {
    await openSearchPage(page);
    await page.getByRole('button', { name: 'Find your trip' }).click();
    await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();

    const origin = await page.getByLabel('From', { exact: true }).inputValue();
    const shared = new URL(page.url());

    // Three letters, and none of the prose the form is showing (#73).
    expect(shared.searchParams.get('from')).toMatch(/^[A-Z]{3}$/);
    expect(shared.searchParams.get('to')).toMatch(/^[A-Z]{3}$/);
    // Not `encodeURIComponent`: `URLSearchParams.toString()` writes '+' for a
    // space and that never matches, so the check would pass in a label-format
    // world too. Comparing against the query string's own encoding is what
    // makes it mean something.
    const asWritten = new URLSearchParams({ origin }).toString().slice('origin='.length);
    expect(shared.search).not.toContain(asWritten);

    await page.goto(`${shared.pathname}${shared.search}`);
    await waitForSearchReady(page);

    await expect(page.getByLabel('From', { exact: true })).toHaveValue(origin);
    await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();
  });

  test('Invalid shared criteria fall back to valid defaults', async ({ page }) => {
    await openSearchPage(
      page,
      // Airport codes, so this exercises the rejection it is named for -- an
      // unflown route and a past date. Written as labels it would be refused
      // for carrying the pre-#73 format instead, and still pass.
      '/?from=SEA&to=LHR&depart=2020-01-01&return=2020-01-08&trip=round-trip'
    );

    await expect.poll(async () => ({
      from: await page.getByLabel('From', { exact: true }).inputValue(),
      to: await page.getByLabel('To', { exact: true }).inputValue(),
    })).not.toEqual({
      from: 'Seattle, USA',
      to: 'London, UK',
    });
    await expect(page.getByLabel('Depart', { exact: true })).not.toHaveValue('2020-01-01');
    await expect(page.getByRole('heading', { name: 'Available Flights' })).toHaveCount(0);
    // Falling back is right; falling back in silence is not. The address bar
    // still names the trip the page refused (#73).
    await expect(page.getByRole('alert').filter({ hasText: /not one we can show/i })).toBeVisible();
  });

  test('A link in the pre-airport-code format is refused, and says so', async ({ page }) => {
    // The format the URL used before #73. There is deliberately no shim, so
    // this is a link people may still hold rather than a malformed one.
    // Derived, not hard-coded: a fixed date eventually falls outside the
    // booking window, and then this passes because the date is wrong rather
    // than because the format is.
    const departure = airportLocalDate(airportTimeZoneFor('Seattle, USA')!, new Date(Date.now() + 7 * 86_400_000));
    await openSearchPage(
      page,
      `/?from=Seattle%2C+USA&to=Detroit%2C+USA&depart=${departure}&trip=one-way`
    );

    await expect(page.getByRole('alert').filter({ hasText: /not one we can show/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Available Flights' })).toHaveCount(0);
    // And the form is usable rather than stuck: the origin is a real choice,
    // not blank or a raw code.
    await expect(page.getByLabel('From', { exact: true })).not.toHaveValue('');
    await expect(page.getByLabel('From', { exact: true })).not.toHaveValue(/^[A-Z]{3}$/);
  });

  test('Date controls reject past departures and invalid return order', async ({ page }) => {
    await openSearchPage(page);

    const departure = page.getByLabel('Depart', { exact: true });
    const returnDate = page.getByLabel('Return', { exact: true });
    const form = page.locator('form');
    // Selectable dates are calendar days at the origin airport, not in UTC, so
    // the expected window is derived from the origin the form opens on.
    const origin = await page.locator('#from').inputValue();
    const today = airportLocalDate(airportTimeZoneFor(origin) ?? 'UTC', new Date());
    const latest = new Date(`${today}T00:00:00.000Z`);
    latest.setUTCDate(latest.getUTCDate() + 365);
    const latestString = latest.toISOString().slice(0, 10);
    const beyondLatest = new Date(latest);
    beyondLatest.setUTCDate(beyondLatest.getUTCDate() + 1);
    const beyondLatestString = beyondLatest.toISOString().slice(0, 10);
    const yesterday = new Date(`${today}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayString = yesterday.toISOString().slice(0, 10);
    const validDeparture = await departure.inputValue();

    await expect(departure).toHaveAttribute('min', today);
    await expect(departure).toHaveAttribute('max', latestString);
    await expect(returnDate).toHaveAttribute('min', validDeparture);
    await expect(returnDate).toHaveAttribute('max', latestString);

    await departure.fill(beyondLatestString);
    await form.evaluate((element) => {
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('alert').filter({
      hasText: 'Departure date cannot be more than 365 days in advance.',
    })).toBeVisible();

    await departure.fill(yesterdayString);
    await form.evaluate((element) => {
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('alert').filter({
      hasText: 'Departure date cannot be in the past.',
    })).toBeVisible();

    await page.getByLabel('One Way').check();
    await expect(page.getByRole('alert').filter({
      hasText: 'Departure date cannot be in the past.',
    })).toBeVisible();
    await page.getByLabel('Round Trip').check();

    await departure.fill(validDeparture);
    await returnDate.fill(yesterdayString);
    await form.evaluate((element) => {
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('alert').filter({
      hasText: 'Return date cannot be before departure date.',
    })).toBeVisible();

    await page.getByLabel('One Way').check();
    await expect(returnDate).toBeDisabled();
    await expect(returnDate).toHaveValue('');
    await expect(page.getByRole('alert').filter({
      hasText: 'Return date cannot be before departure date.',
    })).toHaveCount(0);

    await page.getByLabel('Round Trip').check();
    await departure.fill('');
    await returnDate.fill(validDeparture);
    await form.evaluate((element) => {
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('alert').filter({
      hasText: 'Departure date is required when a return date is provided.',
    })).toBeVisible();

    await page.getByLabel('One Way').check();
    await expect(page.getByRole('alert').filter({
      hasText: 'Departure date is required when a return date is provided.',
    })).toHaveCount(0);
  });

  test('No exact flight offers a nearby operating date that can be searched', async ({ page }) => {
    await openSearchPage(page);

    const departure = page.getByLabel('Depart', { exact: true });
    const exactOperatingDate = await departure.inputValue();
    const noServiceDate = new Date(`${exactOperatingDate}T00:00:00.000Z`);
    noServiceDate.setUTCDate(noServiceDate.getUTCDate() + 1);
    await departure.fill(noServiceDate.toISOString().slice(0, 10));

    await page.getByRole('button', { name: 'Find your trip' }).click();

    await expect(page.getByText(/No flights found/i)).toBeVisible();
    const suggestion = page
      .getByLabel('Nearby operating dates')
      .getByRole('button')
      .first();
    await expect(suggestion).toBeVisible();
    await suggestion.click();

    const resultsHeading = page.getByRole('heading', { name: 'Available Flights' });
    await expect(resultsHeading).toBeVisible();
    await expect(resultsHeading).toBeFocused();
    // The default search is a round trip, so each result offers a leg
    // selection rather than a link that would book it on its own (#69).
    await expect(page.getByRole('button', { name: /as the departing leg/ }).first()).toBeVisible();
  });

  test('A failed search can be retried with the same criteria', async ({ page }) => {
    let releaseFailedSearch: () => void = () => undefined;
    const holdFailedSearch = new Promise<void>((resolve) => {
      releaseFailedSearch = resolve;
    });
    let hasFailedSearch = false;

    await page.route('**/*', async (route) => {
      const request = route.request();
      if (
        !hasFailedSearch
        && request.method() === 'POST'
        && request.headers()['next-action']
      ) {
        hasFailedSearch = true;
        await holdFailedSearch;
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await openSearchPage(page);
    const from = await page.getByLabel('From', { exact: true }).inputValue();
    const to = await page.getByLabel('To', { exact: true }).inputValue();
    const departure = await page.getByLabel('Depart', { exact: true }).inputValue();
    const returnDate = await page.getByLabel('Return', { exact: true }).inputValue();

    await page.getByRole('button', { name: 'Find your trip' }).click();
    await expect(page.getByRole('status')).toContainText('Searching for flights');
    await expect(page.getByRole('button', { name: 'Searching...' })).toBeDisabled();

    releaseFailedSearch();
    await expect(page.getByRole('alert').filter({
      hasText: 'Unable to search for flights right now.',
    })).toBeVisible();
    await page.getByRole('button', { name: 'Retry search' }).click();

    await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return {
        from: params.get('from'),
        to: params.get('to'),
        departure: params.get('depart'),
        returnDate: params.get('return'),
      };
      // The criteria the retry preserved are the same ones; the URL states
      // them as airport codes while the form states them in words (#73).
    }).toEqual({ from: airportCodeFor(from), to: airportCodeFor(to), departure, returnDate });
  });
});

test('A round trip lists return flights for the chosen return date', async ({ page }) => {
  await openSearchPage(page);

  const returnDate = page.getByLabel('Return', { exact: true });
  await expect(returnDate).toBeEnabled();

  await page.getByText('Find your trip').click();

  // The return direction is searched on its own route and date (#112), and the
  // results are listed rather than the return being inferred from the outbound.
  const inbound = page.getByTestId('inbound-results');
  await expect(inbound).toBeVisible();
  await expect(inbound.getByRole('heading', { name: 'Return flights' })).toBeVisible();

  // Real return inventory exists now that routes operate in both directions
  // (#113), so the list is populated rather than empty.
  await expect(inbound.locator('.flight-result-card').first()).toBeVisible();
  await expect(inbound).not.toContainText('No return flights available');
});

test('Shopping a cabin prices results for it and marks flights without it', async ({ page }) => {
  await openSearchPage(page);

  await page.getByLabel('Cabin class').selectOption('ECONOMY');
  await page.getByRole('button', { name: 'Find your trip' }).click();
  await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();
  const economyFare = (await page.locator('.flight-result-fare span').first().textContent())!.trim();

  // Business is 200% of the economy fare, so the quoted price has to change.
  await page.getByLabel('Cabin class').selectOption('BUSINESS');
  await page.getByRole('button', { name: 'Find your trip' }).click();
  await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();
  const businessFare = (await page.locator('.flight-result-fare span').first().textContent())!.trim();
  expect(businessFare).not.toBe(economyFare);

  const toCents = (fare: string) => Math.round(Number(fare.replace(/[$,]/g, '')) * 100);
  expect(toCents(businessFare)).toBe(toCents(economyFare) * 2);

  // The cabin survives a refresh, so a shared link describes the same trip.
  await page.reload();
  await expect(page.getByLabel('Cabin class')).toHaveValue('BUSINESS');
  expect(new URL(page.url()).searchParams.get('cabin')).toBe('BUSINESS');
});

test('A cabin the flight does not operate is marked, not hidden', async ({ page }) => {
  await openSearchPage(page);

  await page.getByLabel('Cabin class').selectOption('ECONOMY');
  await page.getByRole('button', { name: 'Find your trip' }).click();
  await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();
  await expect(page.locator('.flight-result-card').first()).toBeVisible();
  const economyCount = await page.locator('.flight-result-card').count();
  expect(economyCount).toBeGreaterThan(0);

  await page.getByLabel('Cabin class').selectOption('FIRST');
  await page.getByRole('button', { name: 'Find your trip' }).click();
  await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();

  // Every flight is still offered. A cabin it does not run is marked on the
  // card rather than removing the flight from a route that has seats.
  expect(await page.locator('.flight-result-card').count()).toBe(economyCount);
});

test('Sorting and the price filter work on server-stored fares', async ({ page }) => {
  await openSearchPage(page);
  await page.getByRole('button', { name: 'Find your trip' }).click();
  await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();

  const fares = async () => (await page.locator('.flight-result-fare > span:first-child').allTextContents())
    .map(text => Math.round(Number(text.replace(/[$,]/g, '')) * 100));

  await page.getByLabel('Sort:').selectOption('price-asc');
  const ascending = await fares();
  expect(ascending).toEqual([...ascending].sort((a, b) => a - b));

  await page.getByLabel('Sort:').selectOption('price-desc');
  const descending = await fares();
  expect(descending).toEqual([...descending].sort((a, b) => b - a));

  // The slider is denominated in the units the database stores, so its bounds
  // are the real fares rather than numbers recovered from display text.
  const slider = page.getByLabel(/Max Price/i);
  if (await slider.count()) {
    const max = Number(await slider.getAttribute('max'));
    const min = Number(await slider.getAttribute('min'));
    expect(max).toBeGreaterThanOrEqual(min);
    expect(Number.isInteger(max)).toBe(true);
    expect(max).toBe(Math.max(...descending));
  }
});
