/** @jest-environment node */

import { permanentRedirect } from 'next/navigation';
import FlightsPage from '@/app/flights/page';

jest.mock('next/navigation', () => ({
    permanentRedirect: jest.fn(),
}));

describe('FlightsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('permanently redirects to /flight-status', () => {
        FlightsPage();
        expect(permanentRedirect).toHaveBeenCalledWith('/flight-status');
    });
});
