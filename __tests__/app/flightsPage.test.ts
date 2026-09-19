/** @jest-environment node */

import { redirect, RedirectType } from 'next/navigation';
import FlightsPage from '@/app/flights/page';

jest.mock('next/navigation', () => ({
    redirect: jest.fn(),
    RedirectType: { replace: 'replace', push: 'push' },
}));

describe('FlightsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('redirects permanently/replace to /flight-status', () => {
        FlightsPage();
        expect(redirect).toHaveBeenCalledWith('/flight-status', RedirectType.replace);
    });
});
