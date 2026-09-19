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

    describe('the Check In entry', () => {
        beforeEach(() => {
            (usePathname as jest.Mock).mockReturnValue('/');
        });

        it('is absent for a visitor who is not signed in', () => {
            render(<TitleBar />);

            // Check-in needs a booking, so this would lead an anonymous visitor
            // to a page whose only content is "log in" -- the dead-end #70
            // removed the original check-in control for.
            expect(screen.queryByRole('link', { name: 'Check In' })).not.toBeInTheDocument();
        });

        it('leads to the check-in page once signed in', () => {
            (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
                data: { user: { id: 'u1', name: 'Ada' } },
            });

            render(<TitleBar />);

            expect(screen.getByRole('link', { name: 'Check In' }))
                .toHaveAttribute('href', '/checkin');
        });
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

        it('shows an error alert in the drawer instead of caught up when fetching notifications fails (#209)', async () => {
            mockGetUserNotifications.mockRejectedValue(new Error('Internal Server Error'));

            render(<TitleBar />);

            await waitFor(() => expect(consoleError).toHaveBeenCalled());

            const bell = screen.getByRole('button', { name: /toggle notifications/i });
            fireEvent.click(bell);

            const alert = await screen.findByRole('alert');
            expect(alert).toBeInTheDocument();
            expect(alert).toHaveTextContent('Unable to load notifications. Please try again.');
            expect(screen.queryByText("You're all caught up!")).not.toBeInTheDocument();
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

    it('renders the correct title and nav link when pathname is /flight-status', () => {
        (usePathname as jest.Mock).mockReturnValue('/flight-status');

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
        const bellButton = screen.getByRole('button', { name: /toggle notifications/i });
        expect(bellButton).toBeInTheDocument();

        // Unread badge count should show "1"
        await waitFor(() => {
            expect(screen.getByText('1')).toBeInTheDocument();
        });
    });

    it('includes unread count in bell aria-label and provides high-contrast badge background (#210)', async () => {
        (usePathname as jest.Mock).mockReturnValue('/book');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
            data: { user: { id: 'u1', name: 'Bob', role: 'USER' } }
        });
        mockGetUserNotifications.mockResolvedValue([
            { id: 'n1', userId: 'u1', title: 'Flight Delayed', message: 'Flight AA100 is delayed', type: 'FLIGHT_STATUS', isRead: false, createdAt: new Date() },
            { id: 'n2', userId: 'u1', title: 'Gate Changed', message: 'Gate is now B12', type: 'FLIGHT_STATUS', isRead: false, createdAt: new Date() },
        ]);

        render(<TitleBar />);

        // Initially before fetch completes, bell has default label
        expect(screen.getByRole('button', { name: 'Toggle notifications' })).toBeInTheDocument();

        // Once notifications load with 2 unread items:
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Toggle notifications, 2 unread' })).toBeInTheDocument();
        });

        // Badge has WCAG AA compliant background color #b91c1c
        const badge = screen.getByText('2');
        expect(badge).toHaveStyle({ backgroundColor: '#b91c1c' });
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
        const bellButton = screen.getByRole('button', { name: /toggle notifications/i });
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

        const bellButton = screen.getByRole('button', { name: /toggle notifications/i });
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

describe('titlebar navigation, scroll affordance, and accessibility', () => {
    let scrollIntoViewMock: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        (usePathname as jest.Mock).mockReturnValue('/');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({ data: null });
        mockGetUserNotifications.mockReturnValue(new Promise(() => { }));
        scrollIntoViewMock = jest.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => { });
    });

    afterEach(() => {
        scrollIntoViewMock.mockRestore();
    });

    it('renders an accessible navigation landmark with links for visitors', () => {
        render(<TitleBar />);

        const nav = screen.getByRole('navigation', { name: /main navigation/i });
        expect(nav).toBeInTheDocument();

        expect(screen.getByRole('link', { name: 'Book Flight' })).toHaveAttribute('href', '/book');
        expect(screen.getByRole('link', { name: 'Travel Guide' })).toHaveAttribute('href', '/travelguide');
        expect(screen.getByRole('link', { name: 'Flight Status' })).toHaveAttribute('href', '/flight-status');
        expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login');
        expect(screen.getByRole('link', { name: 'Sign Up' })).toHaveAttribute('href', '/signup');
    });

    it('renders authenticated navigation links including check in and account controls', () => {
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
            data: { user: { id: 'u1', name: 'Alice', role: 'USER' } },
        });

        render(<TitleBar />);

        const nav = screen.getByRole('navigation', { name: /main navigation/i });
        expect(nav).toBeInTheDocument();

        expect(screen.getByRole('link', { name: 'Check In' })).toHaveAttribute('href', '/checkin');
        expect(screen.getByRole('button', { name: /toggle notifications/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
        expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    });

    it('renders admin navigation when staff MFA is verified', () => {
        (usePathname as jest.Mock).mockReturnValue('/admin');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
            data: { user: { id: 'admin1', name: 'Staff', role: 'ADMIN', staffMfaVerified: true } },
        });

        render(<TitleBar />);

        expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
        expect(screen.queryByRole('link', { name: 'Book Flight' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    });

    it('scrolls focused navigation elements cleanly into view', () => {
        render(<TitleBar />);

        const flightStatusLink = screen.getByRole('link', { name: 'Flight Status' });
        fireEvent.focus(flightStatusLink);

        expect(scrollIntoViewMock).toHaveBeenCalledWith(
            expect.objectContaining({ block: 'nearest', inline: 'nearest' }),
        );
    });

    it('scrolls the selected route navigation link into view on route change', () => {
        (usePathname as jest.Mock).mockReturnValue('/flight-status');

        render(<TitleBar />);

        const selectedItem = screen.getByRole('link', { name: 'Flight Status' }).closest('li');
        expect(selectedItem).toHaveClass('selected');
        expect(scrollIntoViewMock).toHaveBeenCalledWith(
            expect.objectContaining({ block: 'nearest', inline: 'nearest' }),
        );
    });

    it('manages scroll affordance state and data attributes as the user scrolls', () => {
        render(<TitleBar />);

        const nav = screen.getByRole('navigation', { name: /main navigation/i });

        // Simulate a phone viewport where navigation overflows:
        // container width 320px, content width 500px, initially at start
        Object.defineProperty(nav, 'clientWidth', { configurable: true, value: 320 });
        Object.defineProperty(nav, 'scrollWidth', { configurable: true, value: 500 });
        Object.defineProperty(nav, 'scrollLeft', { configurable: true, value: 0 });

        fireEvent.scroll(nav);

        expect(nav).toHaveAttribute('data-overflowing', 'true');
        expect(nav).toHaveAttribute('data-scroll-left', 'false');
        expect(nav).toHaveAttribute('data-scroll-right', 'true');

        // User scrolls into middle of nav strip
        Object.defineProperty(nav, 'scrollLeft', { configurable: true, value: 80 });
        fireEvent.scroll(nav);

        expect(nav).toHaveAttribute('data-overflowing', 'true');
        expect(nav).toHaveAttribute('data-scroll-left', 'true');
        expect(nav).toHaveAttribute('data-scroll-right', 'true');

        // User scrolls all the way to the end (500 - 320 = 180)
        Object.defineProperty(nav, 'scrollLeft', { configurable: true, value: 180 });
        fireEvent.scroll(nav);

        expect(nav).toHaveAttribute('data-overflowing', 'true');
        expect(nav).toHaveAttribute('data-scroll-left', 'true');
        expect(nav).toHaveAttribute('data-scroll-right', 'false');
    });

    it('indicates when navigation does not overflow', () => {
        render(<TitleBar />);

        const nav = screen.getByRole('navigation', { name: /main navigation/i });

        // Wide container where all items fit without overflowing
        Object.defineProperty(nav, 'clientWidth', { configurable: true, value: 800 });
        Object.defineProperty(nav, 'scrollWidth', { configurable: true, value: 400 });
        Object.defineProperty(nav, 'scrollLeft', { configurable: true, value: 0 });

        fireEvent.scroll(nav);

        expect(nav).toHaveAttribute('data-overflowing', 'false');
        expect(nav).toHaveAttribute('data-scroll-left', 'false');
        expect(nav).toHaveAttribute('data-scroll-right', 'false');
    });
});

describe('drawer loading and empty states (#209)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (usePathname as jest.Mock).mockReturnValue('/');
        (require('next-auth/react').useSession as jest.Mock).mockReturnValue({
            data: { user: { id: 'u1', name: 'Bob', role: 'USER' } },
        });
    });

    it('shows loading placeholder while fetching notifications', async () => {
        let resolvePromise: (val: any) => void = () => {};
        mockGetUserNotifications.mockReturnValue(new Promise(resolve => { resolvePromise = resolve; }));

        render(<TitleBar />);

        const bell = screen.getByRole('button', { name: /toggle notifications/i });
        fireEvent.click(bell);

        expect(screen.getByText('Loading notifications...')).toBeInTheDocument();
        expect(screen.queryByText("You're all caught up!")).not.toBeInTheDocument();

        await act(async () => {
            resolvePromise([]);
        });

        await waitFor(() => {
            expect(screen.getByText("You're all caught up!")).toBeInTheDocument();
            expect(screen.queryByText('Loading notifications...')).not.toBeInTheDocument();
        });
    });

    it('shows caught up message when notifications list is empty after successful load', async () => {
        mockGetUserNotifications.mockResolvedValue([]);

        render(<TitleBar />);

        const bell = screen.getByRole('button', { name: /toggle notifications/i });
        fireEvent.click(bell);

        await waitFor(() => {
            expect(screen.getByText("You're all caught up!")).toBeInTheDocument();
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('notification row keyboard accessibility and operability (#241)', () => {
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
            {
                id: 'n2', userId: 'u1', title: 'Points Earned',
                message: 'You earned 350 points', type: 'POINTS',
                isRead: true, createdAt: new Date(),
            },
        ]);
        mockMarkNotificationAsRead.mockResolvedValue({ id: 'n1', isRead: true });
    });

    it('assigns role="button", tabIndex={0}, and aria-label to unread notifications and marks them read on Enter', async () => {
        render(<TitleBar />);

        fireEvent.click(screen.getByRole('button', { name: /toggle notifications/i }));

        const unreadItem = await screen.findByRole('button', { name: 'Mark notification "Flight Delayed" as read' });
        expect(unreadItem).toHaveAttribute('tabindex', '0');

        fireEvent.keyDown(unreadItem, { key: 'Enter' });

        await waitFor(() => {
            expect(mockMarkNotificationAsRead).toHaveBeenCalledWith('n1');
        });
    });

    it('marks unread notification as read on Space key press', async () => {
        render(<TitleBar />);

        fireEvent.click(screen.getByRole('button', { name: /toggle notifications/i }));

        const unreadItem = await screen.findByRole('button', { name: 'Mark notification "Flight Delayed" as read' });
        fireEvent.keyDown(unreadItem, { key: ' ' });

        await waitFor(() => {
            expect(mockMarkNotificationAsRead).toHaveBeenCalledWith('n1');
        });
    });

    it('ignores other keyboard keys on unread notifications', async () => {
        render(<TitleBar />);

        fireEvent.click(screen.getByRole('button', { name: /toggle notifications/i }));

        const unreadItem = await screen.findByRole('button', { name: 'Mark notification "Flight Delayed" as read' });
        fireEvent.keyDown(unreadItem, { key: 'ArrowDown' });

        expect(mockMarkNotificationAsRead).not.toHaveBeenCalled();
    });

    it('omits button role and keyboard tab stops on already-read notifications', async () => {
        render(<TitleBar />);

        fireEvent.click(screen.getByRole('button', { name: /toggle notifications/i }));

        await screen.findByText('Points Earned');
        const readItem = screen.getByText('Points Earned').closest('.notification-item');
        expect(readItem).not.toHaveAttribute('role', 'button');
        expect(readItem).not.toHaveAttribute('tabindex', '0');
        expect(readItem).not.toHaveAttribute('aria-label');
    });

    it('renders focus-visible stylesheet rule for accessible notification item outlines', async () => {
        const { container } = render(<TitleBar />);

        const styleTags = container.querySelectorAll('style');
        const styleContent = Array.from(styleTags).map(tag => tag.textContent).join('\n');

        expect(styleContent).toContain('.notification-item:focus-visible');
        expect(styleContent).toContain('outline: 2px solid #c084fc');
        expect(styleContent).toContain('outline-offset: -2px');

        await waitFor(() => {
            expect(screen.getByText('1')).toBeInTheDocument();
        });
    });
});



