import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingManagementPortal from '@/components/admin/BookingManagementPortal';
import '@testing-library/jest-dom';

// Mock the dependencies and actions
jest.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: jest.fn() }),
}));

describe('BookingManagementPortal', () => {
    it('renders search form and results area', () => {
        render(<BookingManagementPortal initialBookings={[]} searchAction={jest.fn()} cancelAction={jest.fn()} noteAction={jest.fn()} emailAction={jest.fn()} />);

        expect(screen.getByPlaceholderText(/Search by Reference/i)).toBeInTheDocument();
        expect(screen.getByText('Search')).toBeInTheDocument();
    });

    it('submits search and calls searchAction', async () => {
        const mockSearch = jest.fn().mockResolvedValue([]);
        render(<BookingManagementPortal initialBookings={[]} searchAction={mockSearch} cancelAction={jest.fn()} noteAction={jest.fn()} emailAction={jest.fn()} />);

        const input = screen.getByPlaceholderText(/Search by Reference/i);
        fireEvent.change(input, { target: { value: 'MA-TEST' } });

        const searchButton = screen.getByText('Search');
        fireEvent.click(searchButton);

        await waitFor(() => {
            expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ reference: 'MA-TEST' }));
        });
    });
});
