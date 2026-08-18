import { test, expect } from '@playwright/test';
import { registerAndSignIn } from './helpers/auth';
import { prisma } from '../lib/prisma';

test.describe('Travel Guide Journey', () => {
  const uniqueEmail = `guidetest-${Date.now()}@example.com`;
  const name = 'Guide Test User';
  const password = 'Password123!';

  test.beforeEach(async ({ page }) => {
    // Register and login a fresh user to isolate favorites/reviews state
    await registerAndSignIn(page, { name, email: uniqueEmail, password });
  });

  test.afterAll(async () => {
    // The review and the favorite cascade from the account, so deleting it
    // takes all three. Nothing else does: `global-setup` clears bookings but
    // deliberately not accounts, since it cannot tell this one from a
    // developer's -- so without this the run left a set behind every time, and
    // 25 had accumulated (#213).
    await prisma.user.deleteMany({ where: { email: uniqueEmail } });
  });

  test('User can select a city, write a review, and toggle favorite', async ({ page }) => {
    const renderingErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') renderingErrors.push(message.text());
    });
    page.on('pageerror', error => renderingErrors.push(error.message));

    // Go to travel guide page
    await page.goto('/travelguide');

    // Exercise the real SVG map produced by react-simple-maps and D3.
    const newYorkMarker = page.locator('.rsm-marker[data-city="New York"]');
    await expect(newYorkMarker).toBeVisible();
    await newYorkMarker.click();
    await expect(page.locator('.guide-extra h3')).toContainText('New York');

    // Click on "Detroit, USA" in the sidebar list to make it active
    const cityListItem = page.getByRole('button', { name: 'Detroit, USA', exact: true });
    await expect(cityListItem).toBeVisible();
    await cityListItem.click();

    // Verify highlighted city details sidebar is visible and displays correct header
    // One panel exists at a time now, for the selected city (#78).
    const activeSidebar = page.locator('.guide-extra');
    await expect(activeSidebar).toBeVisible();
    await expect(activeSidebar.locator('h3')).toContainText(/Detroit/i);

    // Write and submit a review
    const reviewText = `Amazing experience here! Reviewed at ${Date.now()}`;
    await activeSidebar.locator('textarea#review-content').fill(reviewText);
    await activeSidebar.locator('button:has-text("Submit Review")').click();

    // Expect the review text to appear in the reviews list
    const newReviewItem = activeSidebar.locator('li', { hasText: reviewText });
    await expect(newReviewItem).toBeVisible();

    const reviewer = await prisma.user.update({
      where: { email: uniqueEmail },
      data: { staffMfaSecretEncrypted: 'staff-mfa-secret-sentinel' },
      select: {
        password: true,
        staffMfaSecretEncrypted: true,
      },
    });
    const publicResponse = await page.request.get('/travelguide');
    expect(publicResponse.ok()).toBe(true);
    const publicResponseBody = await publicResponse.text();
    expect(publicResponseBody).not.toContain(reviewer.password!);
    expect(publicResponseBody).not.toContain(reviewer.staffMfaSecretEncrypted!);
    expect(publicResponseBody).not.toContain('staffMfaSecretEncrypted');
    expect(publicResponseBody).not.toContain('staffMfaLastUsedStep');

    // Toggle favorite state
    const favoriteBtn = activeSidebar.locator('button:has-text("Favorite")');
    await expect(favoriteBtn).toBeVisible();
    await favoriteBtn.click();

    // Verify button text changes to Unfavorite
    const unfavoriteBtn = activeSidebar.locator('button:has-text("Unfavorite")');
    await expect(unfavoriteBtn).toBeVisible();

    expect(renderingErrors).toEqual([]);
  });
});

/**
 * The guide's layout, at the widths #78's first acceptance criterion names.
 *
 * Its own describe, and deliberately not signed in: the layout is the same for an
 * anonymous visitor, and the journey above registers one fixed account in a
 * `beforeEach`, so a second test in that block would try to register it twice.
 * Nothing here creates a row, so nothing here needs cleaning up.
 *
 * The assertion is that the two panels do not intersect, rather than that either
 * sits anywhere in particular. That is exactly what the criterion asks -- "without
 * overlap or inaccessible content" -- and it holds whichever way the panels are
 * arranged, so it cannot be satisfied by a layout that merely moves the defect.
 */
test.describe('Travel guide layout', () => {
  // 1100 is the breakpoint, so both sides of it are here. 901 and 1024 used to be
  // the row layout and are now stacked, which is the point of moving it.
  const widths = [320, 390, 768, 900, 901, 1024, 1100, 1101, 1280, 1440];

  for (const width of widths) {
    test(`map and destinations do not overlap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/travelguide');
      await page.locator('.sticky-sidebar').waitFor();
      // The map renders only after hydration -- before that the panel holds a
      // status message -- so measuring the drawing means waiting for it. Without
      // this the drawing assertions read a null and the geometry they exist to pin
      // goes unmeasured.
      await page.locator('.map svg').waitFor();
      await page.locator('.rsm-marker').first().waitFor();

      const measure = () => page.evaluate(() => {
        const map = document.querySelector<HTMLElement>('.map')!;
        const sidebar = document.querySelector<HTMLElement>('.sticky-sidebar')!;
        const rect = (element: HTMLElement) => {
          const { left, right, top, bottom, width: w, height: h } = element.getBoundingClientRect();
          return { left, right, top, bottom, width: w, height: h };
        };
        const drawing = map.querySelector<SVGSVGElement>('svg');
        const a = rect(map);
        const b = rect(sidebar);
        return {
          map: a,
          sidebar: b,
          // The panel's own box was never the whole story. The map is an
          // aspect-locked SVG that keeps its intrinsic height, so it spilled out of
          // a fixed-height panel -- 157px past the bottom at 900px wide -- and
          // painted through the 85%-opaque sidebar. Measuring only the two panels
          // could not see it, which is exactly the blind spot a rendered review
          // found.
          drawingOverflows: map.scrollHeight - map.clientHeight,
          drawing: drawing ? rect(drawing as unknown as HTMLElement) : null,
          // Rectangles intersect only when they overlap on both axes, so a row
          // layout and a stacked one both pass and an overlapping one cannot.
          overlaps: a.left < b.right && b.left < a.right
            && a.top < b.bottom && b.top < a.bottom,
          pageScrollsSideways:
            document.documentElement.scrollWidth > document.documentElement.clientWidth,
          viewportWidth: document.documentElement.clientWidth,
          viewportHeight: window.innerHeight,
          headerHeight: document.querySelector<HTMLElement>('header')!.getBoundingClientRect().height,
          tokenHeaderHeight: parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--header-height'),
          ),
          // The resolved offset that keeps a revealed panel clear of the header.
          detailScrollMargin: parseFloat(
            getComputedStyle(document.querySelector<HTMLElement>('.guide-extra')!)
              .scrollMarginTop,
          ),
          stacked: getComputedStyle(document.querySelector<HTMLElement>('.guide')!)
            .flexDirection === 'column',
        };
      });

      const measured = await measure();

      expect(
        measured.overlaps,
        `map ${JSON.stringify(measured.map)} overlaps sidebar ${JSON.stringify(measured.sidebar)}`,
      ).toBe(false);

      // Both panels have to be there at all. The map used to compute to a
      // negative width and clamp to zero below 512px.
      expect(measured.map.width, `map has no width at ${width}px`).toBeGreaterThan(0);
      expect(measured.map.height, `map has no height at ${width}px`).toBeGreaterThan(0);
      expect(measured.sidebar.width, `sidebar has no width at ${width}px`).toBeGreaterThan(0);

      // And on screen. The sidebar's left edge used to sit at -82px at 390,
      // which no amount of scrolling reaches: an absolutely positioned box with
      // a negative offset does not extend the scroll region leftwards.
      expect(measured.sidebar.left, `sidebar starts off-screen at ${width}px`)
        .toBeGreaterThanOrEqual(0);
      expect(measured.sidebar.right, `sidebar ends past the viewport at ${width}px`)
        .toBeLessThanOrEqual(measured.viewportWidth + 1);
      expect(measured.map.left, `map starts off-screen at ${width}px`)
        .toBeGreaterThanOrEqual(0);

      expect(measured.pageScrollsSideways, `page scrolls sideways at ${width}px`).toBe(false);

      // The drawing stays inside its panel, and inside it in both directions.
      expect(
        measured.drawingOverflows,
        `the map drawing overflows its panel by ${measured.drawingOverflows}px at ${width}px`,
      ).toBe(0);
      expect(measured.drawing, `no map drawing at ${width}px`).not.toBeNull();
      expect(
        measured.drawing!.bottom,
        `the map drawing runs past its panel at ${width}px`,
      ).toBeLessThanOrEqual(measured.map.bottom + 1);
      expect(
        measured.drawing!.right,
        `the map drawing runs past its panel at ${width}px`,
      ).toBeLessThanOrEqual(measured.map.right + 1);

      // The panel that gets revealed on selection has to come to rest below the
      // header, not under it. Asserted as an inequality against the header as
      // *measured on this render*, rather than against the number in the token: the
      // header's height depends on whether its logo and title wrap, and the font
      // arrives over the network, so a frozen number would make an unrelated font
      // swap fail this spec while blaming the panels.
      expect(
        measured.detailScrollMargin,
        `a revealed panel would rest ${measured.headerHeight - measured.detailScrollMargin}px `
        + `under the ${measured.headerHeight}px header at ${width}px`,
      ).toBeGreaterThanOrEqual(measured.headerHeight);

      // Above the breakpoint the panels are sized from the header's height, so a
      // wrong constant puts them past the fold -- it was hard-coded 17px short of
      // the real 89px. Checked in two steps so a failure names its own cause: first
      // that the token still describes the header, then that the panels fit.
      if (!measured.stacked) {
        expect(
          Math.abs(measured.headerHeight - measured.tokenHeaderHeight),
          `--header-height is ${measured.tokenHeaderHeight}px but the header measures `
          + `${measured.headerHeight}px at ${width}px`,
        ).toBeLessThanOrEqual(1);
        expect(
          measured.sidebar.bottom,
          `the panels run ${measured.sidebar.bottom - measured.viewportHeight}px past the fold `
          + `at ${width}px, against a ${measured.headerHeight}px header`,
        ).toBeLessThanOrEqual(measured.viewportHeight + 1);
      }

      // And again after scrolling. Measuring only at the top was a real blind
      // spot: a `position: sticky` panel participates in normal flow, so it
      // stacks correctly at rest and then pins itself over its sibling as the
      // page moves. Leaving the stacked map sticky passed every assertion above
      // while the map slid across the destinations list on scroll.
      //
      // Above the breakpoint both panels are a viewport tall and the sidebar
      // scrolls inside itself, so the page does not move and this repeats the
      // measurement harmlessly.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const scrolled = await measure();

      expect(
        scrolled.overlaps,
        `map ${JSON.stringify(scrolled.map)} overlaps sidebar ${JSON.stringify(scrolled.sidebar)} once scrolled at ${width}px`,
      ).toBe(false);
      expect(scrolled.pageScrollsSideways, `page scrolls sideways once scrolled at ${width}px`)
        .toBe(false);
    });
  }
});
