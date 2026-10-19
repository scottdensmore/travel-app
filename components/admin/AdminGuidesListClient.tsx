'use client';

import React, { useMemo, useState } from 'react';
import DeleteGuideButton from '@/app/admin/travelguide/DeleteGuideButton';

export interface AdminGuideItem {
    id: number;
    city: string;
    country: string;
}

export interface AdminGuidesListClientProps {
    guides: AdminGuideItem[];
}

export default function AdminGuidesListClient({ guides }: AdminGuidesListClientProps) {
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [countryFilter, setCountryFilter] = useState<string>('ALL');

    const countries = useMemo(
        () => Array.from(new Set(guides.map((g) => g.country))).sort(),
        [guides]
    );

    const filteredGuides = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        return guides.filter((guide) => {
            if (countryFilter !== 'ALL' && guide.country !== countryFilter) {
                return false;
            }
            if (normalizedQuery) {
                const matchesCity = guide.city.toLowerCase().includes(normalizedQuery);
                const matchesCountry = guide.country.toLowerCase().includes(normalizedQuery);
                return matchesCity || matchesCountry;
            }
            return true;
        });
    }, [guides, searchQuery, countryFilter]);

    return (
        <div>
            {guides.length > 0 && (
                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                    <input
                        id="admin-guides-search"
                        type="search"
                        aria-label="Search city guides"
                        data-testid="admin-guides-search"
                        placeholder="Search city or country..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <select
                        id="admin-guides-country-filter"
                        aria-label="Filter guides by country"
                        data-testid="admin-guides-country-filter"
                        value={countryFilter}
                        onChange={(e) => setCountryFilter(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="ALL">All Countries</option>
                        {countries.map((country) => (
                            <option key={country} value={country}>
                                {country}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 text-left">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">City</th>
                            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Country</th>
                            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredGuides.map((guide) => (
                            <tr key={guide.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{guide.city}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{guide.country}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <DeleteGuideButton id={guide.id} />
                                </td>
                            </tr>
                        ))}
                        {guides.length === 0 && (
                            <tr>
                                <td colSpan={3} className="px-6 py-4 text-center text-sm text-gray-500">No guides found.</td>
                            </tr>
                        )}
                        {guides.length > 0 && filteredGuides.length === 0 && (
                            <tr>
                                <td colSpan={3} className="px-6 py-4 text-center text-sm text-gray-500">No guides match the current filters.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
