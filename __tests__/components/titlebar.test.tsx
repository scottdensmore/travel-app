import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
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
        // `clearAllMocks` clears call history but leaves implementations in
        // place, so a nested block that signs a visitor in leaves every later
        // sibling rendering as that user. Re-establishing the anonymous default
        // here keeps each test's session its own business, rather than a
        // function of the order they run in.
        jest.clearAllMocks();
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({ data: null });
        mockGetUserNotifications.mockReturnValue(new Promise(() => { }));
    });

    describe('when a notifications poll fails', () => {
        let consoleError: jest.SpyInstance;

        beforeEach(() => {
            // Installed here rather than in the describe body: declared there it
            // is created at collection time and torn down by this block's
            // teardown, so moving this describe below the others would silently
            // strip `console.error` from all of them.
            consoleError = jest.spyOn(console, 'error').mockImplementation(() => { });
            (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
                data: { user: { role: 'USER', email: 'user@example.com' } },
            });
        });

        afterEach(() => consoleError.mockRestore());

        it('reports it, even when it reads like a torn-down request', async () => {
            // The message cannot tell a navigation from a dead server -- a
            // browser says `Failed to fetch` for both. Suppressing on the
            // message meant a signed-in user whose server had gone away saw
            // nothing at all, in the console or on the page (#212).
            mockGetUserNotifications.mockRejectedValue(new TypeError('Failed to fetch'));

            render(<TitleBar />);

            await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
                'Failed to load notifications:',
                expect.objectContaining({ message: 'Failed to fetch' }),
            ));
        });

        it.each([
            ['a poisoned Postgres transaction', 'current transaction is aborted, commands ignored until end of transaction block'],
            ['a closed Prisma transaction', 'Transaction API error: Transaction already closed: Transaction aborted.'],
            ['an authorization failure', 'Unauthorized'],
        ])('reports %s', async (_name, message) => {
            mockGetUserNotifications.mockRejectedValue(new Error(message));

            render(<TitleBar />);

            await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
                'Failed to load notifications:',
                expect.objectContaining({ message }),
            ));
        });

        it('stays quiet when the page is being replaced', async () => {
            // The one case that is genuinely not a failure: the document is
            // going away and this poll's answer was never going to be used.
            // It was the only console error the e2e suite ever produced (#195).
            let reject: (error: Error) => void = () => { };
            mockGetUserNotifications.mockReturnValue(new Promise((_, r) => { reject = r; }));

            render(<TitleBar />);
            await waitFor(() => expect(mockGetUserNotifications).toHaveBeenCalled());

            window.dispatchEvent(new Event('pagehide'));
            await act(async () => {
                reject(new TypeError('Failed to fetch'));
                await Promise.resolve();
            });

            expect(consoleError).not.toHaveBeenCalled();
        });

        it('reports again after the page comes back from the cache', async () => {
            // `pagehide` fires for the back-forward cache too, where this
            // component is kept alive. Without resetting on `pageshow`, one
            // Back would silence every later failure for good.
            const useSession = require('next-auth/react').useSession as jest.Mock;
            const signedInAs = (email: string) => ({ data: { user: { role: 'USER', email } } });
            mockGetUserNotifications.mockRejectedValue(new TypeError('Failed to fetch'));
            useSession.mockReturnValue(signedInAs('a@example.com'));

            const { rerender } = render(<TitleBar />);
            await waitFor(() => expect(consoleError).toHaveBeenCalled());

            // Into the back-forward cache: `pagehide` fires, the component and
            // its effects survive.
            await act(async () => { window.dispatchEvent(new Event('pagehide')); });
            consoleError.mockClear();

            // ...and back out again, which fires `pageshow` rather than
            // remounting anything.
            await act(async () => { window.dispatchEvent(new Event('pageshow')); });

            // A fresh poll. Changing the session re-runs the polling effect,
            // which is deterministic where waiting out the 3s interval is not.
            useSession.mockReturnValue(signedInAs('b@example.com'));
            rerender(<TitleBar />);

            await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
                'Failed to load notifications:',
                expect.objectContaining({ message: 'Failed to fetch' }),
            ));
        });

        it('stays quiet when the poll outlives the component', async () => {
            let reject: (error: Error) => void = () => { };
            mockGetUserNotifications.mockReturnValue(new Promise((_, r) => { reject = r; }));

            const { unmount } = render(<TitleBar />);
            await waitFor(() => expect(mockGetUserNotifications).toHaveBeenCalled());

            unmount();
            await act(async () => {
                reject(new TypeError('Failed to fetch'));
                await Promise.resolve();
            });

            expect(consoleError).not.toHaveBeenCalled();
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

describe('the notification drawer is reachable, not just visible', () => {
    // Its own setup, not the outer block's. `clearAllMocks` leaves
    // implementations in place, so a block that relies on a *sibling* having
    // signed a user in passes only in the order it happens to run -- which is
    // what the comment on the outer `beforeEach` was written about.
    beforeEach(() => {
        jest.clearAllMocks();
        (usePathname as jest.Mock).mockReturnValue('/');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
            data: { user: { id: 'u1', name: 'Bob', role: 'USER' } },
        });
        mockGetUserNotifications.mockResolvedValue([
            {
                id: 'n1', userId: 'u1', title: 'Flight Delayed',
                message: 'Flight AA100 is delayed', type: 'FLIGHT_STATUS',
                isRead: false, createdAt: new Date(),
            },
        ]);
    });

    /**
     * Portalling the panel out of the header fixed it being clipped to sixteen
     * pixels (#208) and broke something else on the way: the panel became the
     * last thing in the document, so "Mark all read" went from one Tab away to
     * past every other control on the page, with no way to dismiss it from the
     * keyboard. The DOM used to express the relationship; now it has to be
     * stated.
     */
    it('lives outside the header, where no scrolling ancestor can clip it', async () => {
        // The whole of #208: `header nav` carries `overflow-x: auto` at phone
        // width, which forces `overflow-y: auto` and clipped a 389px panel to
        // sixteen visible pixels. Reverting the portal passes every other test
        // in the repository, because nothing else opens the drawer at all.
        render(<TitleBar />);

        fireEvent.click(screen.getByRole('button', { name: /toggle notifications/i }));

        // Awaited, so the notifications promise settles inside `act` rather
        // than warning after the test has ended.
        const drawer = await screen.findByRole('dialog', { name: /notifications/i });
        expect(drawer.parentElement).toBe(document.body);
        expect(document.querySelector('header')?.contains(drawer)).toBe(false);
    });

    it('says the bell opens a dialog, and which one', async () => {
        render(<TitleBar />);

        const bell = screen.getByRole('button', { name: /toggle notifications/i });
        expect(bell).toHaveAttribute('aria-haspopup', 'dialog');
        expect(bell).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(bell);

        await waitFor(() => expect(bell).toHaveAttribute('aria-expanded', 'true'));
        const drawer = screen.getByRole('dialog', { name: /notifications/i });
        expect(bell).toHaveAttribute('aria-controls', drawer.id);
    });

    it('moves focus into the drawer, and back to the bell on Escape', async () => {
        render(<TitleBar />);

        const bell = screen.getByRole('button', { name: /toggle notifications/i });
        fireEvent.click(bell);

        const drawer = await screen.findByRole('dialog', { name: /notifications/i });
        await waitFor(() => expect(drawer).toHaveFocus());

        // On the body, not the drawer: a handler scoped to the panel catches a
        // keydown dispatched on the panel too, so that assertion could not tell
        // the two apart -- and panel-scoped is the arrangement that left the
        // drawer open once focus had tabbed away.
        fireEvent.keyDown(document.body, { key: 'Escape' });

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
        await waitFor(() => expect(bell).toHaveFocus());
    });
});

