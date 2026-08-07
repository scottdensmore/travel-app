import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlightScheduleForm from '@/components/ui/flightScheduleForm';
import { saveFlightScheduleAction } from '@/app/actions';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

jest.mock('@/app/actions', () => ({
    saveFlightScheduleAction: jest.fn(),
    generateFlightOccurrencesAction: jest.fn(),
}));

const mockSave = saveFlightScheduleAction as jest.Mock;

/**
 * A rejected place has to be reported on the input holding it.
 *
 * The action names the field, but the form kept only the summary message and
 * put it in a box at the top — routinely scrolled off-screen, with the offending
 * input left looking untouched, and focus dropped to the body (#73).
 */
function fill() {
    fireEvent.change(screen.getByLabelText(/Flight Number/i), { target: { value: 'MA900' } });
    fireEvent.change(screen.getByLabelText(/Airline/i), { target: { value: 'Mona Airways' } });
    fireEvent.change(screen.getByLabelText(/From \(Origin\)/i), { target: { value: 'New York' } });
    fireEvent.change(screen.getByLabelText(/To \(Destination\)/i), { target: { value: 'Boston' } });
    // The form checks the rest of the required fields before it calls the
    // action, so they have to be present for the server's answer to be reached.
    fireEvent.change(screen.getByLabelText(/Departure \(HH:MM\)/i), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText(/Price/i), { target: { value: '350' } });
    fireEvent.click(screen.getByText('Mon'));
}

describe('flight schedule form field errors', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSave.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'No airport is known for "New York". No airport is known for "Boston".',
                fields: {
                    from: ['No airport is known for "New York". Use a place the airline flies from, such as "Seattle, USA".'],
                    to: ['No airport is known for "Boston". Use a place the airline flies to, such as "Detroit, USA".'],
                },
            },
        });
    });

    it('marks each offending input and describes it', async () => {
        render(<FlightScheduleForm />);
        fill();
        fireEvent.click(screen.getByRole('button', { name: /Create Schedule/i }));

        const origin = await screen.findByLabelText(/From \(Origin\)/i);
        const destination = screen.getByLabelText(/To \(Destination\)/i);

        await waitFor(() => expect(origin).toHaveAttribute('aria-invalid', 'true'));
        expect(destination).toHaveAttribute('aria-invalid', 'true');
        expect(origin).toHaveAccessibleDescription(/No airport is known for "New York"/);
        expect(destination).toHaveAccessibleDescription(/No airport is known for "Boston"/);
    });

    it('takes the caller to the first field they have to change', async () => {
        render(<FlightScheduleForm />);
        fill();
        fireEvent.click(screen.getByRole('button', { name: /Create Schedule/i }));

        // Otherwise focus lands on the disabled submit, drops to the body, and
        // Tab walks forward out of the form entirely.
        await waitFor(() => expect(screen.getByLabelText(/From \(Origin\)/i)).toHaveFocus());
    });

    it('clears a field error once the caller edits that field', async () => {
        render(<FlightScheduleForm />);
        fill();
        fireEvent.click(screen.getByRole('button', { name: /Create Schedule/i }));
        await waitFor(() => expect(screen.getByLabelText(/From \(Origin\)/i)).toHaveAttribute('aria-invalid', 'true'));

        fireEvent.change(screen.getByLabelText(/From \(Origin\)/i), { target: { value: 'New York, USA' } });

        expect(screen.getByLabelText(/From \(Origin\)/i)).not.toHaveAttribute('aria-invalid');
        // The other field is still wrong and still says so.
        expect(screen.getByLabelText(/To \(Destination\)/i)).toHaveAttribute('aria-invalid', 'true');
    });
});
