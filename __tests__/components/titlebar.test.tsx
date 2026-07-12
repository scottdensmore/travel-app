import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TitleBar from '@/components/ui/titlebar';
import { usePathname } from 'next/navigation';
import { 
    getUserNotificationsAction, 
    markNotificationAsReadAction, 
    markAllNotificationsAsReadAction 
} from '@/app/actions';

// Mock Next.js navigation hooks
jest.mock('next/navigation', () => ({
    usePathname: jest.fn(),
}));

jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => ({ data: null })),
    signIn: jest.fn(),
    signOut: jest.fn(),
}));

jest.mock('@/app/actions', () => ({
    getUserNotificationsAction: jest.fn(),
    markNotificationAsReadAction: jest.fn(),
    markAllNotificationsAsReadAction: jest.fn(),
}));

const mockGetUserNotifications = getUserNotificationsAction as jest.Mock;
const mockMarkNotificationAsRead = markNotificationAsReadAction as jest.Mock;
const mockMarkAllNotificationsAsRead = markAllNotificationsAsReadAction as jest.Mock;

describe('TitleBar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetUserNotifications.mockResolvedValue([]);
    });

    it('renders the correct title when pathname is /book', () => {
        (usePathname as jest.Mock).mockReturnValue('/book');

        render(<TitleBar />);

        expect(screen.getByText('Book Flight', { selector: 'span' })).toBeInTheDocument();
        expect(screen.getByAltText('Gemini Airways')).toBeInTheDocument();
    });

    it('renders the correct title and nav link when pathname is /flights', () => {
        (usePathname as jest.Mock).mockReturnValue('/flights');

        render(<TitleBar />);

        expect(screen.getByText('Flight Status', { selector: 'span' })).toBeInTheDocument();
        expect(screen.getByText('Flight Status', { selector: 'a' })).toBeInTheDocument();
    });

    it('renders the admin view when pathname is /admin/travelguide', () => {
        (usePathname as jest.Mock).mockReturnValue('/admin/travelguide');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({ data: { user: { role: 'ADMIN' } } });

        render(<TitleBar />);

        expect(screen.getByText('Admin')).toBeInTheDocument();
        expect(screen.queryByText('Book Flight')).not.toBeInTheDocument();
    });

    it('calls signOut when the Sign Out button is clicked', () => {
        const mockSignOut = require('next-auth/react').signOut;
        (usePathname as jest.Mock).mockReturnValue('/book');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({ data: { user: { role: 'USER', email: 'user@example.com' } } });

        render(<TitleBar />);

        const signOutButton = screen.getByRole('button', { name: 'Sign Out' });
        expect(signOutButton).toBeInTheDocument();
        
        fireEvent.click(signOutButton);

        expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it('renders the notification bell and count when user is logged in', async () => {
        (usePathname as jest.Mock).mockReturnValue('/book');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
            data: { user: { id: 'u1', name: 'Bob', role: 'USER' } }
        });
        mockGetUserNotifications.mockResolvedValue([
            { id: 'n1', userId: 'u1', title: 'Flight Delayed', message: 'Flight AA100 is delayed', type: 'FLIGHT_STATUS', isRead: false, createdAt: new Date() },
            { id: 'n2', userId: 'u1', title: 'Points Earned', message: 'You earned 350 points', type: 'POINTS', isRead: true, createdAt: new Date() },
        ]);

        render(<TitleBar />);

        // Bell should be visible
        const bellButton = screen.getByRole('button', { name: 'Toggle notifications' });
        expect(bellButton).toBeInTheDocument();

        // Unread badge count should show "1"
        await waitFor(() => {
            expect(screen.getByText('1')).toBeInTheDocument();
        });
    });

    it('toggles drawer and triggers mark as read actions', async () => {
        (usePathname as jest.Mock).mockReturnValue('/book');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
            data: { user: { id: 'u1', name: 'Bob', role: 'USER' } }
        });
        mockGetUserNotifications.mockResolvedValue([
            { id: 'n1', userId: 'u1', title: 'Flight Delayed', message: 'Flight AA100 is delayed', type: 'FLIGHT_STATUS', isRead: false, createdAt: new Date() }
        ]);
        mockMarkNotificationAsRead.mockResolvedValue({ id: 'n1', isRead: true });

        render(<TitleBar />);

        // Open notifications drawer
        const bellButton = screen.getByRole('button', { name: 'Toggle notifications' });
        fireEvent.click(bellButton);

        // Drawer header should be present
        expect(screen.getByText('Notifications')).toBeInTheDocument();

        // Notification item should be present
        await waitFor(() => {
            expect(screen.getByText('Flight Delayed')).toBeInTheDocument();
            expect(screen.getByText('Flight AA100 is delayed')).toBeInTheDocument();
        });

        // Click unread notification item
        const notifItem = screen.getByText('Flight Delayed').closest('.notification-item');
        expect(notifItem).toBeInTheDocument();
        fireEvent.click(notifItem!);

        expect(mockMarkNotificationAsRead).toHaveBeenCalledWith('n1');
    });

    it('handles mark all as read action', async () => {
        (usePathname as jest.Mock).mockReturnValue('/book');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
            data: { user: { id: 'u1', name: 'Bob', role: 'USER' } }
        });
        mockGetUserNotifications.mockResolvedValue([
            { id: 'n1', userId: 'u1', title: 'Flight Delayed', message: 'Flight AA100 is delayed', type: 'FLIGHT_STATUS', isRead: false, createdAt: new Date() }
        ]);
        mockMarkAllNotificationsAsRead.mockResolvedValue({ count: 1 });

        render(<TitleBar />);

        const bellButton = screen.getByRole('button', { name: 'Toggle notifications' });
        fireEvent.click(bellButton);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Mark all read' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
        expect(mockMarkAllNotificationsAsRead).toHaveBeenCalled();
    });
});
