/** @jest-environment node */

import { prisma } from '@/lib/prisma';
import { searchBookings } from '@/lib/customerSupportService';
import { BookingStatus } from '@prisma/client';

describe('customerSupportService database integration', () => {
    it('queries bookings with pagination and filters from real database', async () => {
        const result = await searchBookings({ page: 1, pageSize: 5 });
        expect(result).toHaveProperty('bookings');
        expect(result).toHaveProperty('totalCount');
        expect(result).toHaveProperty('page', 1);
        expect(result).toHaveProperty('pageSize', 5);
        expect(Array.isArray(result.bookings)).toBe(true);
    });
});
