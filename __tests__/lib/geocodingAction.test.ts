import { geocodeCityAction } from '@/app/actions';
import { geocodingService } from '@/lib/geocodingService';
import { getServerSession } from 'next-auth';
import { hasVerifiedStaffAccess } from '@/lib/staffAuthorization';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    redirect: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

jest.mock('@/lib/staffAuthorization', () => ({
    hasVerifiedStaffAccess: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
    prisma: {},
}));

jest.mock('@/lib/geocodingService', () => ({
    geocodingService: {
        lookup: jest.fn(),
    },
}));

describe('geocodeCityAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects unauthorized requests without staff verification', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        (hasVerifiedStaffAccess as jest.Mock).mockReturnValue(false);

        await expect(geocodeCityAction({ city: 'Seattle', country: 'USA' })).rejects.toThrow('Unauthorized');
    });

    it('rejects requests from authenticated users who are not verified staff', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { role: 'USER' } });
        (hasVerifiedStaffAccess as jest.Mock).mockReturnValue(false);

        await expect(geocodeCityAction({ city: 'Seattle', country: 'USA' })).rejects.toThrow('Unauthorized');
    });

    it('validates city and country parameters', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { role: 'ADMIN' } });
        (hasVerifiedStaffAccess as jest.Mock).mockReturnValue(true);

        const emptyCityResult = await geocodeCityAction({ city: '', country: 'USA' });
        expect(emptyCityResult).toHaveProperty('ok', false);

        const emptyCountryResult = await geocodeCityAction({ city: 'Seattle', country: '' });
        expect(emptyCountryResult).toHaveProperty('ok', false);

        const longCityResult = await geocodeCityAction({ city: 'A'.repeat(101), country: 'USA' });
        expect(longCityResult).toHaveProperty('ok', false);

        const extraFieldResult = await geocodeCityAction({ city: 'Seattle', country: 'USA', extra: 'bad' } as never);
        expect(extraFieldResult).toHaveProperty('ok', false);
    });

    it('executes geocoding lookup for authorized staff', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { role: 'ADMIN' } });
        (hasVerifiedStaffAccess as jest.Mock).mockReturnValue(true);
        (geocodingService.lookup as jest.Mock).mockResolvedValue({
            latitude: 47.6062,
            longitude: -122.3321,
            attribution: 'Data © OpenStreetMap contributors',
            source: 'nominatim',
        });

        const result = await geocodeCityAction({ city: 'Seattle', country: 'USA' });
        expect(result).toEqual({
            ok: true,
            data: {
                latitude: 47.6062,
                longitude: -122.3321,
                attribution: 'Data © OpenStreetMap contributors',
                source: 'nominatim',
            },
        });
        expect(geocodingService.lookup).toHaveBeenCalledWith('Seattle', 'USA');
    });

    it('returns ActionValidationFailure when geocodingService.lookup throws', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { role: 'ADMIN' } });
        (hasVerifiedStaffAccess as jest.Mock).mockReturnValue(true);
        (geocodingService.lookup as jest.Mock).mockRejectedValue(new Error('Location not found: Nowhere, USA'));

        const result = await geocodeCityAction({ city: 'Nowhere', country: 'USA' });
        expect(result).toEqual({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Location not found: Nowhere, USA',
                fields: {
                    city: ['Location not found: Nowhere, USA'],
                },
            },
        });
    });
});
