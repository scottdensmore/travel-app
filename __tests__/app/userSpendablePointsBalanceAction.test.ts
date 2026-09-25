/** @jest-environment node */
import { getUserSpendablePointsBalanceAction } from '@/app/actions';
import { getServerSession } from 'next-auth';
import {
    getUserSpendablePointsBalance,
    grantWelcomePointsIfEligible,
} from '@/lib/pointsLedgerService';

jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/pointsLedgerService', () => ({
    getUserSpendablePointsBalance: jest.fn(),
    grantWelcomePointsIfEligible: jest.fn(),
}));
jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}));

describe('getUserSpendablePointsBalanceAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('throws Unauthorized when there is no authenticated session', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);

        await expect(getUserSpendablePointsBalanceAction()).rejects.toThrow('Unauthorized');
        expect(grantWelcomePointsIfEligible).not.toHaveBeenCalled();
        expect(getUserSpendablePointsBalance).not.toHaveBeenCalled();
    });

    it('evaluates welcome points grant and returns spendable points balance for authenticated user', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: 'user-welcome-test' },
        });
        (grantWelcomePointsIfEligible as jest.Mock).mockResolvedValue(10000);
        (getUserSpendablePointsBalance as jest.Mock).mockResolvedValue(10000);

        const balance = await getUserSpendablePointsBalanceAction();

        expect(grantWelcomePointsIfEligible).toHaveBeenCalledWith('user-welcome-test');
        expect(getUserSpendablePointsBalance).toHaveBeenCalledWith('user-welcome-test');
        expect(balance).toBe(10000);
    });
});
