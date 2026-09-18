# E2E Playwright Suite Reliability & Test Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate test flakiness, order-dependence, and server exhaustion in the Playwright end-to-end suite across #268, #252, and #313.

**Architecture:** Replace external network avatar dependencies (`i.pravatar.cc`) with local static assets to eliminate unnamed 404 console errors. Optimize auth abuse testing to reuse page instances and drain server load, and reduce redundant responsive navigation reloads in auth and disruption specs. Re-locate elements fresh across route transitions and calibrate locator timeouts for asynchronous server-action reconciliation under full-suite load.

**Tech Stack:** Next.js 14, Playwright E2E Test Runner, React 18, Prisma ORM, TypeScript.

**Spec:** Issues #268, #252, #313 in GitHub repository `scottdensmore/travel-app`.

## Global Constraints

- Enforce linear git history on `main` via PR squash merge.
- Verification before completion: `npm run lint`, `npm run test:unit`, `npm run test:database`, and `npx playwright test`.
- All user avatar defaults must be served locally from `/public` without external network dependencies.
- Avoid unnecessary full-page browser navigations when testing CSS media query responsiveness.

---

### Task 1: Replace External Avatar URLs with Local Static Assets & Enhance Console Error Diagnostics (#268)

**Files:**
- Modify: `components/ui/TravelGuideClient.tsx:440-448`
- Modify: `app/profile/page.tsx:38`
- Modify: `e2e/travelguide.spec.ts:24-30`

**Interfaces:**
- Consumes: `/img/my-profile-photo.jpg` static asset in `/public/img`
- Produces: 100% offline-safe avatar fallbacks for travel guide reviews and user profiles without third-party network requests.

- [ ] **Step 1: Update TravelGuideClient and profile page to use local avatar fallback**

In `components/ui/TravelGuideClient.tsx` (around line 443):
Replace `src={r.user?.image || "https://i.pravatar.cc/150"}` with:
```tsx
<img
    src={r.user?.image || "/img/my-profile-photo.jpg"}
    alt=""
    width="24"
    height="24"
/>
```

In `app/profile/page.tsx` (line 38):
Replace `const userAvatar = user.image || "https://i.pravatar.cc/150?u=" + userId;` with:
```tsx
const userAvatar = user.image || "/img/my-profile-photo.jpg";
```

- [ ] **Step 2: Enhance console error listener in travel guide E2E test**

In `e2e/travelguide.spec.ts` (lines 24-30):
```ts
    const renderingErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') {
        const location = message.location();
        const locStr = location.url ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})` : '';
        renderingErrors.push(`${message.text()}${locStr}`);
      }
    });
    page.on('pageerror', error => renderingErrors.push(error.message));
```

- [ ] **Step 3: Run unit and E2E travel guide tests to verify changes**

Run: `npx jest __tests__/components/TravelGuideClient.test.tsx`
Run: `npx playwright test e2e/travelguide.spec.ts`
Expected: PASS

---

### Task 2: Eliminate Auth Abuse Dev Server Flooding & Reduce Redundant Layout Navigations (#252)

**Files:**
- Modify: `e2e/auth-abuse.spec.ts:65-87`
- Modify: `e2e/auth.spec.ts:20-47`

**Interfaces:**
- Consumes: Playwright `page.setViewportSize`, NextAuth credentials login flow
- Produces: Streamlined auth abuse attempts without 7 repeated page reloads; 66% fewer page navigations during responsive breakpoint verification.

- [ ] **Step 1: Streamline login attempts in auth-abuse.spec.ts**

In `e2e/auth-abuse.spec.ts`:
Instead of invoking `await page.goto('/login')` inside `attemptLogin` 7 times, navigate to `/login` once and fill/submit credentials on the active page:
```ts
    await page.goto('/login');
    const attemptLogin = async (candidateEmail: string) => {
      await page.fill('#email', candidateEmail);
      await page.fill('#password', 'DefinitelyWrong123!');
      await page.click('button:has-text("Sign In with Email")');
      await expect(page.locator('form').getByRole('alert')).toHaveText('Invalid email or password.');
    };

    await attemptLogin(normalizedEmail);
    await attemptLogin(unknownEmail);
    for (let attempt = 1; attempt < 6; attempt++) {
      await attemptLogin(email.toUpperCase());
    }
```
In `test.afterAll`:
Ensure rate limits are cleaned and wait a brief moment (500ms) for background scheduled tasks and keep-alive sockets to drain before the next spec executes:
```ts
  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: normalizedEmail } });
    await prisma.verificationToken.deleteMany({
      where: { identifier: { endsWith: `:${normalizedEmail}` } }
    });
    await prisma.authRateLimit.deleteMany({
      where: { key: { in: rateLimitKeys } }
    });
    await new Promise(resolve => setTimeout(resolve, 500));
  });
```

- [ ] **Step 2: Invert nested loops in auth.spec.ts responsive test**

In `e2e/auth.spec.ts` (lines 20-47):
Invert the nested loops so each path is loaded once (`page.goto(path)`), followed by resizing the viewport across `[320, 768, 1280]`:
```ts
  test('Authentication and recovery remain usable at phone, tablet, and desktop widths', async ({ page }) => {
    for (const path of [
      '/login',
      '/signup',
      '/forgot-password',
      '/resend-verification',
      `/reset-password#token=${'a'.repeat(43)}`,
    ]) {
      await page.goto(path);
      const form = page.locator('form');
      await expect(form).toBeVisible();
      for (const width of [320, 768, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        const box = await form.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
    }

    await page.goto(`/verify-email#token=${'a'.repeat(43)}`);
    const verificationPanel = page.getByRole('region', { name: 'Confirm your email' });
    await expect(verificationPanel).toBeVisible();
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const verificationBox = await verificationPanel.boundingBox();
      expect(verificationBox).not.toBeNull();
      expect(verificationBox!.x).toBeGreaterThanOrEqual(0);
      expect(verificationBox!.x + verificationBox!.width).toBeLessThanOrEqual(width);
    }
  });
```

- [ ] **Step 3: Run the auth subset in order to verify absence of ERR_INSUFFICIENT_RESOURCES**

Run: `npx playwright test e2e/auth-abuse.spec.ts e2e/auth-recovery.spec.ts e2e/auth.spec.ts`
Expected: PASS with 0 network or chunk load errors.

---

### Task 3: Stabilize Admin Flights Status Reconciliation & Disruption Responsive Viewport Checks (#313)

**Files:**
- Modify: `e2e/disruption.spec.ts:457-515`
- Modify: `e2e/admin.spec.ts:294-315`

**Interfaces:**
- Consumes: Playwright `selectOption`, `expect.toHaveValue`, `setViewportSize`
- Produces: Resilient E2E tests unaffected by dev-server load or async server-action timing.

- [ ] **Step 1: Optimize disruption.spec.ts responsive measurement test**

In `e2e/disruption.spec.ts` (lines 479-514):
Navigate to `/profile` once and wait for the booking row, then measure each viewport width by adjusting viewport size in place:
```ts
        test.slow();
        await page.goto('/profile');
        await page.getByTestId(`booking-row-${booking.id}`).waitFor();

        for (const width of [...stacked, 768, 1024]) {
            await page.setViewportSize({ width, height: 900 });

            const measured = await page.evaluate(() => {
                const region = document.querySelector<HTMLElement>(
                    '[role="region"][aria-label="Your bookings"]',
                )!;
                return {
                    hidden: region.scrollWidth - region.clientWidth,
                    reachable: region.getAttribute('tabindex') === '0',
                };
            });

            if (stacked.includes(width)) {
                expect(measured.hidden, `content is hidden sideways at ${width}px`).toBe(0);
            } else {
                expect(
                    measured.hidden === 0 || measured.reachable,
                    `at ${width}px the table hides ${measured.hidden}px with no way to scroll to it`,
                ).toBe(true);
            }
        }
```

- [ ] **Step 2: Freshly re-locate table row and provide assertion timeout in admin.spec.ts**

In `e2e/admin.spec.ts` (lines 294-315):
After returning to `/admin/flights` from schedule impact preview, re-locate the table row freshly rather than reusing a stale locator reference, and specify `{ timeout: 15_000 }` on `toHaveValue('DELAYED')` to accommodate server action transaction and Next.js `router.refresh()` reconciliation:
```ts
    await page.getByRole('link', { name: 'Back to flight schedules' }).click();
    await expect(page).toHaveURL('/admin/flights');

    // Freshly locate the active occurrence row upon returning to /admin/flights
    const freshPopulatedFlightRow = page.locator('table').nth(1)
      .locator(`tr:has-text("${activeOccurrence.flightNumber}"):has-text("1 Active")`).first();
    const statusSelect = freshPopulatedFlightRow.locator('select').first();
    await expect(statusSelect).toBeVisible();
    await statusSelect.selectOption('DELAYED');

    // Allow sufficient time for the server action transaction and router.refresh() under load
    await expect(statusSelect).toBeEnabled({ timeout: 15_000 });
    await expect(statusSelect).toHaveValue('DELAYED', { timeout: 15_000 });
```

- [ ] **Step 3: Run admin and disruption specs together to verify stability**

Run: `npx playwright test e2e/admin.spec.ts e2e/disruption.spec.ts`
Expected: PASS

---

### Task 4: Complete Suite Verification, Commit & PR Integration

- [ ] **Step 1: Run repository-wide type checking**
Run: `npx tsc --noEmit`
Expected: Exit 0

- [ ] **Step 2: Run linter**
Run: `npm run lint`
Expected: Exit 0

- [ ] **Step 3: Run unit tests**
Run: `npm run test:unit`
Expected: 103 test suites pass, 1247 tests pass.

- [ ] **Step 4: Run database tests**
Run: `npm run test:database`
Expected: 45 test suites pass, 332 tests pass.

- [ ] **Step 5: Run full Playwright E2E suite**
Run: `npx playwright test`
Expected: 46/46 passed with 0 failures or flakes.

- [ ] **Step 6: Stage, commit, push, create PR, squash merge and close issues**
Run:
```bash
git add -A
git commit -m "test(e2e): stabilize suite isolation, eliminate external network dependency, and reduce dev server load (#268, #252, #313)"
git push -u origin <branch>
gh pr create ...
gh pr merge <PR> --squash --delete-branch
gh issue close 268 252 313
```
