import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminGuidesListClient, { AdminGuideItem } from '@/components/admin/AdminGuidesListClient';

jest.mock('@/app/admin/travelguide/DeleteGuideButton', () => {
    return function MockDeleteGuideButton({ id }: { id: number }) {
        return <button data-testid={`delete-guide-${id}`}>Delete</button>;
    };
});

const SAMPLE_GUIDES: AdminGuideItem[] = [
    { id: 1, city: 'Kyoto', country: 'Japan' },
    { id: 2, city: 'Paris', country: 'France' },
    { id: 3, city: 'Tokyo', country: 'Japan' },
];

describe('AdminGuidesListClient', () => {
    it('renders "No guides found." when guides is empty and hides filter controls', () => {
        render(<AdminGuidesListClient guides={[]} />);

        expect(screen.getByText('No guides found.')).toBeInTheDocument();
        expect(screen.queryByTestId('admin-guides-search')).not.toBeInTheDocument();
        expect(screen.queryByTestId('admin-guides-country-filter')).not.toBeInTheDocument();
    });

    it('renders existing guides with DeleteGuideButton and sorted country filter options', () => {
        render(<AdminGuidesListClient guides={SAMPLE_GUIDES} />);

        expect(screen.getByText('Kyoto')).toBeInTheDocument();
        expect(screen.getByText('Paris')).toBeInTheDocument();
        expect(screen.getByText('Tokyo')).toBeInTheDocument();

        expect(screen.getByTestId('delete-guide-1')).toBeInTheDocument();
        expect(screen.getByTestId('delete-guide-2')).toBeInTheDocument();
        expect(screen.getByTestId('delete-guide-3')).toBeInTheDocument();

        const countrySelect = screen.getByTestId('admin-guides-country-filter') as HTMLSelectElement;
        const optionValues = Array.from(countrySelect.options).map(opt => opt.value);
        expect(optionValues).toEqual(['ALL', 'France', 'Japan']);
    });

    it('filters guides by search query matching city or country case-insensitively', () => {
        render(<AdminGuidesListClient guides={SAMPLE_GUIDES} />);

        const searchInput = screen.getByTestId('admin-guides-search');

        fireEvent.change(searchInput, { target: { value: 'kyoto' } });
        expect(screen.getByText('Kyoto')).toBeInTheDocument();
        expect(screen.queryByText('Paris')).not.toBeInTheDocument();
        expect(screen.queryByText('Tokyo')).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: '  japan  ' } });
        expect(screen.getByText('Kyoto')).toBeInTheDocument();
        expect(screen.getByText('Tokyo')).toBeInTheDocument();
        expect(screen.queryByText('Paris')).not.toBeInTheDocument();
    });

    it('filters guides by country dropdown', () => {
        render(<AdminGuidesListClient guides={SAMPLE_GUIDES} />);

        const countrySelect = screen.getByTestId('admin-guides-country-filter');

        fireEvent.change(countrySelect, { target: { value: 'France' } });
        expect(screen.getByText('Paris')).toBeInTheDocument();
        expect(screen.queryByText('Kyoto')).not.toBeInTheDocument();
        expect(screen.queryByText('Tokyo')).not.toBeInTheDocument();

        fireEvent.change(countrySelect, { target: { value: 'ALL' } });
        expect(screen.getByText('Paris')).toBeInTheDocument();
        expect(screen.getByText('Kyoto')).toBeInTheDocument();
        expect(screen.getByText('Tokyo')).toBeInTheDocument();
    });

    it('renders "No guides match the current filters." when no guides match', () => {
        render(<AdminGuidesListClient guides={SAMPLE_GUIDES} />);

        const searchInput = screen.getByTestId('admin-guides-search');
        fireEvent.change(searchInput, { target: { value: 'Atlantis' } });

        expect(screen.getByText('No guides match the current filters.')).toBeInTheDocument();
        expect(screen.queryByText('No guides found.')).not.toBeInTheDocument();
    });
});
