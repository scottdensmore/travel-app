/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TravelGuideForm from '@/components/ui/travelGuideForm';
import { geocodeCityAction, saveCityGuideAction } from '@/app/actions';

jest.mock('@/app/actions', () => ({
    geocodeCityAction: jest.fn(),
    saveCityGuideAction: jest.fn(),
}));

const mockSave = saveCityGuideAction as jest.Mock;
const mockGeocode = geocodeCityAction as jest.Mock;

describe('TravelGuideForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default fetch stub; individual tests override as needed.
        global.fetch = jest.fn() as unknown as typeof fetch;
    });

    it('renders the core input fields without attribution badge on initial mount', () => {
        render(<TravelGuideForm />);
        expect(screen.getByText('Add a New Travel Guide')).toBeInTheDocument();
        expect(screen.getByLabelText(/City/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Country/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
        expect(screen.queryByTestId('geocode-attribution')).not.toBeInTheDocument();
    });

    it('looks up coordinates once both city and country are filled', async () => {
        mockGeocode.mockResolvedValue({
            ok: true,
            data: {
                latitude: 48.8566,
                longitude: 2.3522,
                attribution: 'Data © OpenStreetMap contributors, ODbL 1.0',
                source: 'nominatim',
            },
        });

        render(<TravelGuideForm />);
        expect(screen.queryByTestId('geocode-attribution')).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Paris' } });
        fireEvent.change(screen.getByLabelText(/Country/i), { target: { value: 'France' } });
        fireEvent.blur(screen.getByLabelText(/Country/i));

        await waitFor(() => {
            expect(screen.getByText(/Location:/)).toBeInTheDocument();
            expect(screen.getByText(/48\.8566/)).toBeInTheDocument();
            const attribution = screen.getByTestId('geocode-attribution');
            expect(attribution).toBeInTheDocument();
            expect(attribution).toHaveTextContent(/Location data ©.*OpenStreetMap.*contributors/);
            const link = screen.getByRole('link', { name: 'OpenStreetMap' });
            expect(link).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        });
        expect(mockGeocode).toHaveBeenCalledWith({
            city: 'Paris',
            country: 'France',
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('shows an error when the location is not found', async () => {
        mockGeocode.mockRejectedValue(new Error('Location not found.'));

        render(<TravelGuideForm />);
        fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Nowhere' } });
        fireEvent.change(screen.getByLabelText(/Country/i), { target: { value: 'Nodata' } });
        fireEvent.blur(screen.getByLabelText(/Country/i));

        await waitFor(() => {
            expect(screen.getByText('Location not found.')).toBeInTheDocument();
        });
        expect(mockGeocode).toHaveBeenCalledWith({
            city: 'Nowhere',
            country: 'Nodata',
        });
    });

    it('looks up coordinates and submits them via saveCityGuideAction', async () => {
        mockGeocode.mockResolvedValue({
            ok: true,
            data: {
                latitude: 48.8566,
                longitude: 2.3522,
                attribution: 'Data © OpenStreetMap contributors, ODbL 1.0',
                source: 'nominatim',
            },
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
        expect(mockGeocode).toHaveBeenCalledWith({
            city: 'Paris',
            country: 'France',
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
        mockGeocode.mockRejectedValue(new Error('Failed to fetch coordinates.'));
        mockSave.mockRejectedValue(new Error('Save Error'));

        render(<TravelGuideForm />);

        // 1. Blur with missing country
        fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Paris' } });
        fireEvent.blur(screen.getByLabelText(/City/i));
        expect(mockGeocode).not.toHaveBeenCalled();

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

    it('handles geocoding validation failure response', async () => {
        mockGeocode.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'City is required.',
                fields: { city: ['City is required.'] },
            },
        });

        render(<TravelGuideForm />);
        fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Paris' } });
        fireEvent.change(screen.getByLabelText(/Country/i), { target: { value: 'France' } });
        fireEvent.blur(screen.getByLabelText(/Country/i));

        await waitFor(() => {
            expect(screen.getByText('City is required.')).toBeInTheDocument();
        });
    });

    it('announces server validation failures as errors rather than success', async () => {
        mockSave.mockResolvedValue({
            ok: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'City is required.',
                fields: { city: ['City is required.'] },
            },
        });

        render(<TravelGuideForm />);
        fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('City is required.');
        expect(alert).toHaveClass('text-red-500');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

    it('handles image upload via file input with valid image', async () => {
        const validPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const dummyFileReader = {
            readAsDataURL: jest.fn().mockImplementation(function(this: any) {
                this.result = validPngDataUrl;
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

    it('rejects oversized image uploads (> 500 KB) without reading as data URL', () => {
        const dummyFileReader = {
            readAsDataURL: jest.fn(),
            onloadend: null as any,
            result: '',
        };
        const originalFileReader = global.FileReader;
        global.FileReader = jest.fn().mockImplementation(() => dummyFileReader) as any;

        render(<TravelGuideForm />);

        const fileInput = screen.getByLabelText(/Cover Image:/i);
        const largeContent = new Uint8Array(512_001);
        const file = new File([largeContent], 'large.png', { type: 'image/png' });

        fireEvent.change(fileInput, { target: { files: [file] } });

        expect(dummyFileReader.readAsDataURL).not.toHaveBeenCalled();
        expect(screen.getByText('Image must be 500 KB or smaller.')).toBeInTheDocument();
        expect(screen.queryByAltText('Cover Preview')).not.toBeInTheDocument();

        global.FileReader = originalFileReader;
    });

    it('rejects SVG image uploads with security error message', () => {
        const dummyFileReader = {
            readAsDataURL: jest.fn(),
            onloadend: null as any,
            result: '',
        };
        const originalFileReader = global.FileReader;
        global.FileReader = jest.fn().mockImplementation(() => dummyFileReader) as any;

        render(<TravelGuideForm />);

        const fileInput = screen.getByLabelText(/Cover Image:/i);
        const file = new File(['<svg></svg>'], 'image.svg', { type: 'image/svg+xml' });

        fireEvent.change(fileInput, { target: { files: [file] } });

        expect(dummyFileReader.readAsDataURL).not.toHaveBeenCalled();
        expect(screen.getByText('SVG images are not allowed for security reasons.')).toBeInTheDocument();
        expect(screen.queryByAltText('Cover Preview')).not.toBeInTheDocument();

        global.FileReader = originalFileReader;
    });

    it('rejects unsupported file formats (e.g. image/gif)', () => {
        const dummyFileReader = {
            readAsDataURL: jest.fn(),
            onloadend: null as any,
            result: '',
        };
        const originalFileReader = global.FileReader;
        global.FileReader = jest.fn().mockImplementation(() => dummyFileReader) as any;

        render(<TravelGuideForm />);

        const fileInput = screen.getByLabelText(/Cover Image:/i);
        const file = new File(['gifdata'], 'image.gif', { type: 'image/gif' });

        fireEvent.change(fileInput, { target: { files: [file] } });

        expect(dummyFileReader.readAsDataURL).not.toHaveBeenCalled();
        expect(screen.getByText('Only JPEG, PNG, WebP, and AVIF images are allowed.')).toBeInTheDocument();
        expect(screen.queryByAltText('Cover Preview')).not.toBeInTheDocument();

        global.FileReader = originalFileReader;
    });

    it('rejects image files whose payload fails data URL validation', async () => {
        const corruptedDataUrl = 'data:image/png;base64,not-valid-base64!';
        const dummyFileReader = {
            readAsDataURL: jest.fn().mockImplementation(function(this: any) {
                this.result = corruptedDataUrl;
                if (this.onloadend) this.onloadend();
            }),
            onloadend: null as any,
            result: '',
        };
        const originalFileReader = global.FileReader;
        global.FileReader = jest.fn().mockImplementation(() => dummyFileReader) as any;

        render(<TravelGuideForm />);

        const fileInput = screen.getByLabelText(/Cover Image:/i);
        const file = new File(['corrupted'], 'corrupted.png', { type: 'image/png' });

        fireEvent.change(fileInput, { target: { files: [file] } });

        expect(dummyFileReader.readAsDataURL).toHaveBeenCalledWith(file);
        expect(screen.queryByAltText('Cover Preview')).not.toBeInTheDocument();

        global.FileReader = originalFileReader;
    });
});
