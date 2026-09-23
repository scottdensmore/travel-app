import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import StepUpModal from '@/components/admin/StepUpModal';

describe('StepUpModal', () => {
    it('renders dialog with accessible focus and title', () => {
        render(
            <StepUpModal
                isOpen={true}
                title="Authorize Action"
                description="Enter 6-digit TOTP code"
                onClose={jest.fn()}
                onSubmit={jest.fn()}
            />
        );

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Authorize Action')).toBeInTheDocument();
        expect(screen.getByLabelText(/security code/i)).toBeInTheDocument();
    });

    it('submits 6-digit code on valid input', () => {
        const handleSubmit = jest.fn();
        render(
            <StepUpModal
                isOpen={true}
                title="Authorize Action"
                description="Enter 6-digit code"
                onClose={jest.fn()}
                onSubmit={handleSubmit}
            />
        );

        const input = screen.getByLabelText(/security code/i);
        fireEvent.change(input, { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));

        expect(handleSubmit).toHaveBeenCalledWith('123456');
    });

    it('closes on escape key or cancel button', () => {
        const handleClose = jest.fn();
        render(
            <StepUpModal
                isOpen={true}
                title="Authorize Action"
                description="Enter 6-digit code"
                onClose={handleClose}
                onSubmit={jest.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(handleClose).toHaveBeenCalled();

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(handleClose).toHaveBeenCalledTimes(2);
    });

    it('does not submit code when fewer than 6 digits are entered and form submitted', () => {
        const handleSubmit = jest.fn();
        render(
            <StepUpModal
                isOpen={true}
                title="Authorize Action"
                description="Enter 6-digit code"
                onClose={jest.fn()}
                onSubmit={handleSubmit}
            />
        );

        const input = screen.getByLabelText(/security code/i);
        fireEvent.change(input, { target: { value: '123' } });
        fireEvent.submit(input.closest('form')!);

        expect(handleSubmit).not.toHaveBeenCalled();
    });

    it('does not close on Escape key when isSubmitting is true', () => {
        const handleClose = jest.fn();
        render(
            <StepUpModal
                isOpen={true}
                title="Authorize Action"
                description="Enter 6-digit code"
                onClose={handleClose}
                onSubmit={jest.fn()}
                isSubmitting={true}
            />
        );

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(handleClose).not.toHaveBeenCalled();
    });
});
