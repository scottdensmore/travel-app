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

    it('handles blur with missing fields, coordinate fetch failure, and save failure', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('Network Error'));
        mockSave.mockRejectedValue(new Error('Save Error'));

        render(<TravelGuideForm />);

        // 1. Blur with missing country
        fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Paris' } });
        fireEvent.blur(screen.getByLabelText(/City/i));
        expect(global.fetch).not.toHaveBeenCalled();

        // 2. Blur with both to trigger network failure
        fireEvent.change(screen.getByLabelText(/Country/i), { target: { value: 'France' } });
        fireEvent.blur(screen.getByLabelText(/Country/i));

        await waitFor(() => {
            expect(screen.getByText('Failed to fetch coordinates.')).toBeInTheDocument();
        });

        // 3. Submit failure check
        fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
        await waitFor(() => {
            expect(screen.getByText('Failed to save city guide')).toBeInTheDocument();
        });
    });

    it('supports adding and editing highlights', async () => {
        render(<TravelGuideForm />);

        // Get the first highlight input
        const highlightInput = screen.getByPlaceholderText('Add Highlight');
        fireEvent.change(highlightInput, { target: { value: 'Eiffel Tower' } });
        expect(highlightInput).toHaveValue('Eiffel Tower');

        // Click '+' button to add new highlight input
        const addButton = screen.getByRole('button', { name: '+' });
        fireEvent.click(addButton);

        // Verify that there are now 2 highlight inputs
        const highlightInputs = screen.getAllByPlaceholderText('Add Highlight');
        expect(highlightInputs).toHaveLength(2);
        
        fireEvent.change(highlightInputs[1], { target: { value: 'Louvre' } });
        expect(highlightInputs[1]).toHaveValue('Louvre');
    });

    it('handles image upload via file input', async () => {
        const dummyFileReader = {
            readAsDataURL: jest.fn().mockImplementation(function(this: any) {
                this.result = 'data:image/png;base64,mocked';
                if (this.onloadend) this.onloadend();
            }),
            onloadend: null as any,
            result: '',
        };
        const originalFileReader = global.FileReader;
        global.FileReader = jest.fn().mockImplementation(() => dummyFileReader) as any;

        render(<TravelGuideForm />);

        const fileInput = screen.getByLabelText(/Cover Image:/i);
        const file = new File(['foo'], 'foo.png', { type: 'image/png' });
        
        fireEvent.change(fileInput, { target: { files: [file] } });

        expect(dummyFileReader.readAsDataURL).toHaveBeenCalledWith(file);
        expect(await screen.findByAltText('Cover Preview')).toBeInTheDocument();

        global.FileReader = originalFileReader;
    });
});

