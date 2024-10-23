/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Home from '../app/admin/travelguide/page';

describe('Home Page', () => {
  it('renders the sidebar menu', () => {
    const doc = render(<Home />);
    const sidebar = doc.container.querySelector('#sidebar');
    expect(sidebar).toBeInTheDocument();
  });

  it('renders the correct menu items', () => {
    render(<Home />);
    const menuItems = screen.getAllByRole('listitem');
    expect(menuItems).toHaveLength(5);
    expect(screen.getByText('New Airports')).toBeInTheDocument();
    expect(screen.getByText('Partners')).toBeInTheDocument();
    expect(screen.getByText('Add travel Guide')).toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    expect(screen.getByText('Manage Corporate')).toBeInTheDocument();
  });

  it('renders the TravelGuideForm component', () => {
    const doc = render(<Home />);
    const form = doc.container.querySelector('#travelGuideForm');
    expect(form).toBeInTheDocument();
  });

  // check only the expected input fields are rendered
  it('renders the correct input fields', () => {
    const doc = render(<Home />);
    const inputs = doc.container.querySelectorAll('input');
    expect(inputs).toHaveLength(3);
  });
});