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
        mockGetUserNotifications.mockReturnValue(new Promise(() => { }));
    });

    describe('when a notifications poll is cut short', () => {
        // A navigation aborts whatever the 3s poll had in flight. That is not a
        // failure, and reporting it as one made the only console error the e2e
        // suite ever sees -- which then failed a spec that asserts the console
        // is clean (#195).
        let consoleError: jest.SpyInstance;

        beforeEach(() => {
            // Installed here rather than in the describe body: declared there it
            // is created at collection time and torn down by this block's
            // `afterAll`, so moving this describe below the others would
            // silently strip `console.error` from all of them.
            consoleError = jest.spyOn(console, 'error').mockImplementation(() => { });
            // The poll only runs for a signed-in visitor.
            (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
                data: { user: { role: 'USER', email: 'user@example.com' } },
            });
        });

        afterEach(() => consoleError.mockRestore());

        it.each([
            ['a fetch torn down by navigation', new TypeError('Failed to fetch')],
            ['a network error', new TypeError('NetworkError when attempting to fetch resource.')],
            ['an explicit abort', Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })],
            // What Chromium actually reports for a server action cut short by a
            // navigation, and the string the e2e suite sees.
            ['a server action torn down mid-flight', new TypeError('network error')],
            // Safari's wording. The suite runs chromium only, so nothing else
            // here can reach it.
            ['a WebKit teardown', new TypeError('Load failed')],
        ])('stays quiet about %s', async (_name, error) => {
            mockGetUserNotifications.mockRejectedValue(error);

            render(<TitleBar />);
            await waitFor(() => expect(mockGetUserNotifications).toHaveBeenCalled());

            expect(consoleError).not.toHaveBeenCalled();
        });

        it.each([
            ['an authorization failure', 'Unauthorized'],
            // In development Next forwards a server error's message verbatim,
            // so these arrive at this catch exactly as written. A substring
            // match on "aborted" or "network error" silenced all three.
            ['a poisoned Postgres transaction', 'current transaction is aborted, commands ignored until end of transaction block'],
            ['a closed Prisma transaction', 'Transaction API error: Transaction already closed: Transaction aborted.'],
            ['a database reachability error', 'A network error occurred while reaching the database'],
        ])('still reports %s', async (_name, message) => {
            mockGetUserNotifications.mockRejectedValue(new Error(message));

            render(<TitleBar />);
            await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
                'Failed to load notifications:',
                expect.objectContaining({ message }),
            ));
        });
    });

    it('renders the correct title when pathname is /book', () => {
        (usePathname as jest.Mock).mockReturnValue('/book');

        render(<TitleBar />);

        expect(screen.getByText('Book Flight', { selector: 'span' })).toBeInTheDocument();

        // The home link names the product once. It used to carry the name
        // twice — `alt` on the mark plus the visible text beside it — which a
        // screen reader read out as "Mona Airways Mona Airways". The mark no
        // longer contains a wordmark of its own, so it is decorative (#140).
        expect(screen.getByRole('link', { name: 'Mona Airways' })).toBeInTheDocument();
    });

    it('offers no navigation that goes nowhere', () => {
        // Check-In pointed at "#" with nothing behind it. It comes back when
        // check-in exists (#77); until then the nav only offers what works.
        (usePathname as jest.Mock).mockReturnValue('/book');

        render(<TitleBar />);

        expect(screen.queryByRole('link', { name: 'Check-In' })).not.toBeInTheDocument();
        for (const link of screen.getAllByRole('link')) {
            expect(link).not.toHaveAttribute('href', '#');
        }
    });

    it('renders the correct title and nav link when pathname is /flights', () => {
        (usePathname as jest.Mock).mockReturnValue('/flights');

        render(<TitleBar />);

        expect(screen.getByText('Flight Status', { selector: 'span' })).toBeInTheDocument();
        expect(screen.getByText('Flight Status', { selector: 'a' })).toBeInTheDocument();
    });

    it('renders the admin view when pathname is /admin/travelguide', () => {
        (usePathname as jest.Mock).mockReturnValue('/admin/travelguide');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
            data: { user: { role: 'ADMIN', staffMfaVerified: true } }
        });

        render(<TitleBar />);

        expect(screen.getByText('Admin')).toBeInTheDocument();
        expect(screen.queryByText('Book Flight')).not.toBeInTheDocument();
    });

    it('does not expose the admin navigation before staff MFA is verified', () => {
        (usePathname as jest.Mock).mockReturnValue('/book');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
            data: { user: { role: 'ADMIN', staffMfaVerified: false } }
        });

        render(<TitleBar />);

        expect(screen.queryByText('Admin')).not.toBeInTheDocument();
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

        await waitFor(() => {
            expect(mockMarkNotificationAsRead).toHaveBeenCalledWith('n1');
        });
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
        await waitFor(() => {
            expect(mockMarkAllNotificationsAsRead).toHaveBeenCalled();
        });
    });
});
