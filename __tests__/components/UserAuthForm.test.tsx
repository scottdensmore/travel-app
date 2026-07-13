import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import UserAuthForm from '@/app/login/components/user-auth-form';

jest.mock('next-auth/react', () => ({ signIn: jest.fn() }));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), refresh: jest.fn() })
}));

describe('UserAuthForm registration errors', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        global.fetch = jest.fn();
    });

    it('shows structured server validation errors and associates them with fields', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            json: async () => ({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Enter a valid email address.',
                    fields: { email: ['Enter a valid email address.'] }
                }
            })
        } as Response);
        render(<UserAuthForm type="signup" />);

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bad@example.com' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
        await waitFor(() => {
            expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
            expect(screen.getByLabelText('Email')).toHaveAttribute(
                'aria-describedby',
                'registration-email-error'
            );
        });
    });
});
