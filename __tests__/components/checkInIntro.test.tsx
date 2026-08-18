import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

/**
 * The check-in window, as the page states it in prose.
 *
 * Its own test file because it needs the policy's constants mocked, and a module
 * mock applies to a whole file. The point is not that the intro says "24 hours"
 * -- asserting that against the real constant passes just as well for a
 * hard-coded literal, since the two agree today. The point is that the sentence
 * *follows* the policy: change the window and the prose changes with it, rather
 * than going on claiming the old figure with nothing failing.
 *
 * Every other user-visible mention of the window is already derived --
 * `checkInNextStep` interpolates both constants -- so this was the one place a
 * number was written out by hand.
 */
jest.mock('@/lib/checkInPolicy', () => {
    const actual = jest.requireActual<typeof import('@/lib/checkInPolicy')>('@/lib/checkInPolicy');
    // Deliberately not the real values, so prose that ignores them is visible.
    return { ...actual, CHECK_IN_OPENS_HOURS: 36, CHECK_IN_CLOSES_MINUTES: 45 };
});

jest.mock('@/app/actions', () => ({ checkInLegAction: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

import CheckInPanel from '@/components/ui/CheckInPanel';

describe('the check-in window as stated to the customer', () => {
    it('takes both figures from the policy rather than restating them', () => {
        render(<CheckInPanel legs={[]} />);

        const intro = screen.getByText(/Check-in opens/);
        expect(intro).toHaveTextContent('opens 36 hours');
        expect(intro).toHaveTextContent('closes 45 minutes');
        // The real values must not survive a change to the policy.
        expect(intro).not.toHaveTextContent('24 hours');
        expect(intro).not.toHaveTextContent('60 minutes');
    });
});
