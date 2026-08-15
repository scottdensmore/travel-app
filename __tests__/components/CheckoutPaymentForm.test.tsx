import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import CheckoutPaymentForm from '@/components/ui/CheckoutPaymentForm';

jest.mock('@stripe/stripe-js', () => ({
    loadStripe: jest.fn().mockReturnValue(Promise.resolve({})),
}));

jest.mock('@stripe/react-stripe-js', () => ({
    Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PaymentElement: ({
        onReady,
        onLoadError,
    }: {
        onReady?: () => void;
        onLoadError?: () => void;
    }) => (
        <div>
            <button type="button" onClick={onReady}>Hosted Stripe payment fields</button>
            <button type="button" onClick={onLoadError}>Fail hosted payment fields</button>
        </div>
    ),
    useElements: jest.fn(),
    useStripe: jest.fn(),
}));

const mockedUseStripe = useStripe as jest.Mock;
const mockedUseElements = useElements as jest.Mock;
const mockedLoadStripe = loadStripe as jest.Mock;

describe('CheckoutPaymentForm', () => {
    const elements = {};
    const confirmPayment = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseStripe.mockReturnValue({ confirmPayment });
        mockedUseElements.mockReturnValue(elements);
    });

    it('uses the guarded Playwright payment boundary without loading Stripe.js', async () => {
        const onConfirmed = jest.fn();
        render(
            <CheckoutPaymentForm
                publishableKey="pk_test_mona_playwright"
                clientSecret="pi_playwright_secret"
                amountDisplay="$100"
                disabled={false}
                submitting={false}
                onConfirmed={onConfirmed}
            />
        );

        expect(mockedLoadStripe).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Authorize $100 and confirm booking' }));
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    });

    it('loads Stripe with the publishable key and keeps hosted fields behind Elements', () => {
        render(
            <CheckoutPaymentForm
                publishableKey="pk_test_public"
                clientSecret="pi_secret_for_elements"
                amountDisplay="$100"
                disabled={false}
                submitting={false}
                onConfirmed={jest.fn()}
            />
        );

        expect(mockedLoadStripe).toHaveBeenCalledWith('pk_test_public');
        expect(screen.getByText('Hosted Stripe payment fields')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Authorize $100 and confirm booking' })).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('Loading secure payment fields');
        expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
        expect(screen.getByText(/payment details are encrypted and sent directly to Stripe/i))
            .toBeInTheDocument();
    });

    it('reports hosted-field loading failure and keeps authorization disabled', async () => {
        render(
            <CheckoutPaymentForm
                publishableKey="pk_test_public"
                clientSecret="pi_secret_for_elements"
                amountDisplay="$100"
                disabled={false}
                submitting={false}
                onConfirmed={jest.fn()}
            />
        );

        fireEvent.click(screen.getByText('Fail hosted payment fields'));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'Stripe’s secure payment fields could not load. Please try again.',
        );
        await waitFor(() => expect(alert).toHaveFocus());
        expect(screen.getByRole('button', { name: 'Authorize $100 and confirm booking' })).toBeDisabled();
    });

    it('stays disabled after hosted fields become ready when the seat hold is unavailable', () => {
        render(
            <CheckoutPaymentForm
                publishableKey="pk_test_public"
                clientSecret="pi_secret_for_elements"
                amountDisplay="$100"
                disabled
                submitting={false}
                onConfirmed={jest.fn()}
            />
        );

        fireEvent.click(screen.getByText('Hosted Stripe payment fields'));
        fireEvent.click(screen.getByRole('button', { name: 'Authorize $100 and confirm booking' }));

        expect(screen.getByRole('button', { name: 'Authorize $100 and confirm booking' })).toBeDisabled();
        expect(confirmPayment).not.toHaveBeenCalled();
    });

    it('submits hosted fields and only reports completion after Stripe confirms', async () => {
        const onConfirmed = jest.fn();
        confirmPayment.mockResolvedValue({ paymentIntent: { status: 'requires_capture' } });
        render(
            <CheckoutPaymentForm
                publishableKey="pk_test_public"
                clientSecret="pi_secret_for_elements"
                amountDisplay="$100"
                disabled={false}
                submitting={false}
                onConfirmed={onConfirmed}
            />
        );
        fireEvent.click(screen.getByText('Hosted Stripe payment fields'));
        fireEvent.click(screen.getByRole('button', { name: 'Authorize $100 and confirm booking' }));

        await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
        expect(confirmPayment).toHaveBeenCalledWith({
            elements,
            confirmParams: { return_url: window.location.href },
            redirect: 'if_required',
        });
    });

    it('retries booking completion without authorizing the hosted payment twice', async () => {
        const onConfirmed = jest.fn().mockResolvedValue(undefined);
        confirmPayment.mockResolvedValue({ paymentIntent: { status: 'requires_capture' } });
        render(
            <CheckoutPaymentForm
                publishableKey="pk_test_public"
                clientSecret="pi_secret_for_elements"
                amountDisplay="$100"
                disabled={false}
                submitting={false}
                onConfirmed={onConfirmed}
            />
        );
        fireEvent.click(screen.getByText('Hosted Stripe payment fields'));
        fireEvent.click(screen.getByRole('button', { name: 'Authorize $100 and confirm booking' }));

        await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
        const retry = await screen.findByRole('button', {
            name: 'Finish payment and confirm booking',
        });
        fireEvent.click(retry);
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(2));

        expect(confirmPayment).toHaveBeenCalledTimes(1);
    });

    it('shows a recoverable Stripe error and never reports confirmation', async () => {
        const onConfirmed = jest.fn();
        confirmPayment.mockResolvedValue({ error: { message: 'Your card was declined.' } });
        render(
            <CheckoutPaymentForm
                publishableKey="pk_test_public"
                clientSecret="pi_secret_for_elements"
                amountDisplay="$100"
                disabled={false}
                submitting={false}
                onConfirmed={onConfirmed}
            />
        );
        fireEvent.click(screen.getByText('Hosted Stripe payment fields'));
        fireEvent.click(screen.getByRole('button', { name: 'Authorize $100 and confirm booking' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Your card was declined.');
        await waitFor(() => expect(alert).toHaveFocus());
        expect(onConfirmed).not.toHaveBeenCalled();
    });
});
