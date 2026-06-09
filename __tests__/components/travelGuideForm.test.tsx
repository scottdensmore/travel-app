/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TravelGuideForm from '@/components/ui/travelGuideForm';
import { saveCityGuideAction } from '@/app/actions';

jest.mock('@/app/actions', () => ({ saveCityGuideAction: jest.fn() }));

const mockSave = saveCityGuideAction as jest.Mock;

describe('TravelGuideForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default fetch stub; individual tests override as needed.
        global.fetch = jest.fn() as unknown as typeof fetch;
    });

    it('renders the core input fields', () => {
        render(<TravelGuideForm />);
        expect(screen.getByText('Add a New Travel Guide')).toBeInTheDocument();
        expect(screen.getByLabelText(/City/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Country/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    });

    it('looks up coordinates once both city and country are filled', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            json: async () => [{ lat: '48.8566', lon: '2.3522' }],
        });

        render(<TravelGuideForm />);
        fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Paris' } });
        fireEvent.change(screen.getByLabelText(/Country/i), { target: { value: 'France' } });
        fireEvent.blur(screen.getByLabelText(/Country/i));

        await waitFor(() => {
            expect(screen.getByText(/Location:/)).toBeInTheDocument();
            expect(screen.getByText(/48\.8566/)).toBeInTheDocument();
        });
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('nominatim.openstreetmap.org')
        );
    });

    it('shows an error when the location is not found', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({ json: async () => [] });

        render(<TravelGuideForm />);
        fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Nowhere' } });
        fireEvent.change(screen.getByLabelText(/Country/i), { target: { value: 'Nodata' } });
        fireEvent.blur(screen.getByLabelText(/Country/i));

        await waitFor(() => {
            expect(screen.getByText('Location not found.')).toBeInTheDocument();
        });
    });

    it('looks up coordinates and submits them via saveCityGuideAction', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            json: async () => [{ lat: '48.8566', lon: '2.3522' }],
        });
        mockSave.mockResolvedValue({ id: 1 });

        render(<TravelGuideForm />);
        fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Paris' } });
        fireEvent.change(screen.getByLabelText(/Country/i), { target: { value: 'France' } });
        fireEvent.blur(screen.getByLabelText(/Country/i));

        // Coordinates must be resolved before submit so they flow into the payload.
        await waitFor(() => expect(screen.getByText(/Location:/)).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: 'Lovely city' } });
        fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() => {
            expect(mockSave).toHaveBeenCalledTimes(1);
            expect(screen.getByText('City guide saved successfully')).toBeInTheDocument();
        });
        expect(mockSave).toHaveBeenCalledWith(
            expect.objectContaining({
                city: 'Paris',
                country: 'France',
                description: 'Lovely city',
                latlong: [48.8566, 2.3522],
            })
        );
    });
});
