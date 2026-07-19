import { expect, test } from '@playwright/test';

test.describe('Flight search', () => {
  test('Default route and date produce an available flight', async ({ page }) => {
    await page.goto('/');

    const departureDate = await page.locator('#depart').inputValue();
    expect(departureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.getByRole('button', { name: 'Find your trip' }).click();

    const resultsHeading = page.getByRole('heading', { name: 'Available Flights' });
    await expect(resultsHeading).toBeVisible();
    await expect(resultsHeading).toBeFocused();
    await expect(page.getByRole('link', { name: 'Book Now' }).first()).toBeVisible();
  });

  test('Search criteria and results survive a refresh', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('From').selectOption({ label: 'New York, USA' });
    await expect(page.getByLabel('To')).toHaveValue('London, UK');
    const departureDate = await page.getByLabel('Depart').inputValue();
    const returnDate = await page.getByLabel('Return').inputValue();

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
      from: 'New York, USA',
      to: 'London, UK',
      depart: departureDate,
      returnDate,
      trip: 'round-trip',
    });

    await page.reload();

    await expect(page.getByLabel('From')).toHaveValue('New York, USA');
    await expect(page.getByLabel('To')).toHaveValue('London, UK');
    await expect(page.getByLabel('Depart')).toHaveValue(departureDate);
    await expect(page.getByLabel('Return')).toHaveValue(returnDate);
    await expect(page.getByLabel('Round Trip')).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();
  });

  test('A round trip without an optional return date survives a refresh', async ({ page }) => {
    await page.goto('/');

    const departureDate = await page.getByLabel('Depart').inputValue();
    await page.getByLabel('Return').fill('');
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

    await expect(page.getByLabel('Depart')).toHaveValue(departureDate);
    await expect(page.getByLabel('Return')).toHaveValue('');
    await expect(page.getByLabel('Round Trip')).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Available Flights' })).toBeVisible();
  });

  test('Invalid shared criteria fall back to valid defaults', async ({ page }) => {
    await page.goto(
      '/?from=Seattle%2C+USA&to=London%2C+UK&depart=2020-01-01&return=2020-01-08&trip=round-trip'
    );

    await expect.poll(async () => ({
      from: await page.getByLabel('From').inputValue(),
      to: await page.getByLabel('To').inputValue(),
    })).not.toEqual({
      from: 'Seattle, USA',
      to: 'London, UK',
    });
    await expect(page.getByLabel('Depart')).not.toHaveValue('2020-01-01');
    await expect(page.getByRole('heading', { name: 'Available Flights' })).toHaveCount(0);
  });

  test('Date controls reject past departures and invalid return order', async ({ page }) => {
    await page.goto('/');

    const departure = page.getByLabel('Depart');
    const returnDate = page.getByLabel('Return');
    const form = page.locator('form');
    const today = new Date().toISOString().slice(0, 10);
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
    await page.goto('/');

    const departure = page.getByLabel('Depart');
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
    await expect(page.getByRole('link', { name: 'Book Now' }).first()).toBeVisible();
  });
});
