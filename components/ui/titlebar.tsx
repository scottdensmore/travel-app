"use client"

import { BRAND } from '@/lib/brand';
import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { 
    getUserNotificationsAction, 
    markNotificationAsReadAction, 
    markAllNotificationsAsReadAction 
} from '@/app/actions';

interface Notification {
    id: string;
    userId: string;
    title: string;
    message: string;
    type: string;
    isRead: boolean;
    createdAt: Date | string;
}

/** `useLayoutEffect` in the browser, `useEffect` on the server, which warns. */
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const TitleBar: React.FC = () => {
    const pathname = usePathname();
    const { data: session } = useSession();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const drawerRef = useRef<HTMLLIElement>(null);
    const bellRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    /**
     * Where the drawer sits, measured from the bell each time it opens.
     *
     * It is rendered into `document.body` rather than beside the bell, because
     * at phone width `header nav` carries `overflow-x: auto` -- which forces
     * `overflow-y: auto` too, and clipped the drawer to sixteen visible pixels
     * of a 389px panel. The clicks landed and the badge counted down, so the
     * feature was not dead, just invisible (#208).
     *
     * Measured rather than assumed: the header is sticky and its height changes
     * with the viewport, so a hard-coded offset would drift.
     */
    const [anchor, setAnchor] = useState<{ top: number; right: number; width: number } | null>(null);

    const pageTitles: { [key: string]: string } = {
        '/book': 'Book Flight',
        '/travelguide': 'Travel Guide',
        '/profile': 'Profile',
        '/flights': 'Flight Status',
        '/admin': 'Admin Dashboard',
        '/admin/travelguide': 'Manage City Guides',
    };

    const pageTitle = pageTitles[pathname] || '';
    const userAvatar = session?.user?.image || "/img/my-profile-photo.jpg";
    const isAdmin = session?.user?.role === 'ADMIN' && session.user.staffMfaVerified;

    // Set while the document is going away, so a poll that dies with it can be
    // told apart from one that failed on its own.
    const leavingPage = useRef(false);

    useEffect(() => {
        const onPageHide = () => { leavingPage.current = true; };
        // `pagehide` also fires when the document goes into the back-forward
        // cache, where this component and its effects are kept alive. Coming
        // back with Back fires `pageshow` rather than remounting, so without
        // this the flag would stay set and silence every later failure for the
        // rest of the page's life.
        const onPageShow = () => { leavingPage.current = false; };

        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('pageshow', onPageShow);
        return () => {
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('pageshow', onPageShow);
        };
    }, []);

    // Fetch immediately on mount / route change, and set up 3s polling interval
    useEffect(() => {
        // Whether *this* poll's result is still wanted. A server action takes no
        // abort signal, so the teardown is what gets tracked rather than the
        // request -- which is the distinction that matters: a rejection arriving
        // after the effect was cleaned up, or while the page is being replaced,
        // lost nothing and is not news. Anything else is (#195, #212).
        //
        // Matching the rejection's message instead could not tell a navigation
        // from a dead server: browsers say `Failed to fetch` for both.
        let active = true;

        const poll = async () => {
            if (!session?.user) {
                setNotifications([]);
                return;
            }
            try {
                const notifs = await getUserNotificationsAction();
                if (active) setNotifications(notifs as Notification[]);
            } catch (err) {
                if (!active || leavingPage.current) return;
                console.error("Failed to load notifications:", err);
            }
        };

        poll();
        const interval = setInterval(poll, 3000);
        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [session, pathname]);

    /**
     * Escape closes the drawer from anywhere, and hands focus back.
     *
     * On the document rather than the panel, because focus leaves the panel the
     * moment anyone tabs: with the handler on the panel alone, Escape stopped
     * working and the drawer sat open over the page with the bell five stops
     * away.
     *
     * Focus is only restored here. Restoring it after an outside click fought
     * the browser and lost -- the default mousedown action blurs to the body
     * after React has run, so the effect's work was undone a frame later, and
     * the same guard stole focus to the bell on a cold page load where nothing
     * was focused yet.
     */
    useEffect(() => {
        if (!isOpen) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setIsOpen(false);
            bellRef.current?.focus();
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [isOpen]);

    /**
     * Focused as it mounts, rather than from an effect on `isOpen`.
     *
     * The panel does not exist at the moment `isOpen` flips -- it waits a render
     * for the bell to be measured -- so an effect keyed on `isOpen` finds a null
     * ref and silently does nothing.
     */
    const attachPanel = useCallback((node: HTMLDivElement | null) => {
        panelRef.current = node;
        node?.focus();
    }, []);

    // Keep the drawer under the bell as the page scrolls or the window resizes.
    // Placed before paint, or reopening after the bell has moved shows a frame
    // at the old position; guarded because `useLayoutEffect` warns on the
    // server, where this component is still rendered.
    useBeforePaint(() => {
        if (!isOpen) {
            // Cleared, or reopening paints one frame at the old position.
            setAnchor(null);
            return;
        }

        const place = () => {
            const rect = bellRef.current?.getBoundingClientRect();
            if (!rect) return;
            const viewport = window.innerWidth;
            const measuredRight = Math.max(8, viewport - rect.right);
            // Wide enough to read, but never wider than the viewport itself.
            const floor = Math.min(240, viewport - 16);
            const width = Math.max(floor, Math.min(320, viewport - measuredRight - 8));
            // Then pull it back rightwards if that width would push its left
            // edge off screen. Clamping the width alone is not enough: the
            // floor can beat the space the inset leaves, and at 320px -- where
            // the bell sits in a horizontally scrolled nav, so the inset is
            // large -- the panel started at -65 with no way to scroll to it.
            const right = Math.min(measuredRight, Math.max(8, viewport - width - 8));

            setAnchor({ top: rect.bottom + 8, right, width });
        };

        place();
        window.addEventListener('resize', place);
        // Capturing, so a scroll inside any container still repositions it.
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [isOpen]);

    // Click outside to close notifications drawer
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            // The panel is no longer inside `drawerRef`, so "outside" has to
            // mean outside both, or every click within the drawer closes it.
            const insideTrigger = drawerRef.current?.contains(target);
            const insidePanel = panelRef.current?.contains(target);
            if (!insideTrigger && !insidePanel) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const unreadCount = useMemo(() => {
        return notifications.filter(n => !n.isRead).length;
    }, [notifications]);

    const handleMarkAsRead = async (id: string) => {
        try {
            await markNotificationAsReadAction(id);
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
        } catch (err) {
            console.error("Failed to mark as read:", err);
        }
    };

    const handleMarkAllAsRead = async () => {
        try {
            await markAllNotificationsAsReadAction();
            setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
        } catch (err) {
            console.error("Failed to mark all as read:", err);
        }
    };

    return (
        <header className={pathname?.startsWith('/admin') ? 'admin-header' : ''}>
            <div className="logo">
                <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
                    {/* Decorative: the name follows in text inside the same
                        link, so alt would make the link read "Mona Airways
                        Mona Airways". The mark carries no wordmark of its own. */}
                    <img src="/img/logo.svg" alt="" width="32" height="32" />
                    <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>{BRAND.name}</span>
                </Link>
                <span>{pageTitle}</span>
            </div>
            <nav>
                <ul style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                    {!pathname?.startsWith('/admin') && (
                        <>
                            <li className={pathname === '/book' ? 'selected' : ''}>
                                <Link href="/book">Book Flight</Link>
                            </li>
                            <li className={pathname === '/travelguide' ? 'selected' : ''}>
                                <Link href="/travelguide">Travel Guide</Link>
                            </li>
                            <li className={pathname === '/flights' ? 'selected' : ''}>
                                <Link href="/flights">Flight Status</Link>
                            </li>
                        </>
                    )}

                    {isAdmin && (
                        <li className={pathname === '/admin' ? 'selected' : ''}>
                            <Link href="/admin">Admin</Link>
                        </li>
                    )}

                    {session ? (
                        <li style={{ display: 'flex', alignItems: 'center', gap: '16px', position: 'relative' }} ref={drawerRef}>
                            {/* Notification Bell Container */}
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <button 
                                    ref={bellRef}
                                    onClick={() => setIsOpen(!isOpen)}
                                    aria-label="Toggle notifications"
                                    aria-haspopup="dialog"
                                    aria-expanded={isOpen}
                                    aria-controls={isOpen ? 'notification-drawer' : undefined}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: '1.25rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '4px',
                                        color: pathname?.startsWith('/admin') ? 'white' : 'inherit',
                                        // No `outline: none`: this is the way in
                                        // to the drawer, and a keyboard user
                                        // could not see where they were.
                                        position: 'relative'
                                    }}
                                >
                                    🔔
                                    {unreadCount > 0 && (
                                        <span style={{
                                            position: 'absolute',
                                            top: '-2px',
                                            right: '-2px',
                                            backgroundColor: '#ef4444',
                                            color: '#fff',
                                            borderRadius: '50%',
                                            padding: '2px 5px',
                                            fontSize: '0.65rem',
                                            fontWeight: 'bold',
                                            lineHeight: '1',
                                            minWidth: '16px',
                                            textAlign: 'center'
                                        }}>
                                            {unreadCount}
                                        </span>
                                    )}
                                </button>

                                {/* Notification Drawer Dropdown */}
                                {isOpen && anchor && createPortal(
                                    <div
                                        ref={attachPanel}
                                        id="notification-drawer"
                                        role="dialog"
                                        aria-label="Notifications"
                                        tabIndex={-1}
                                        style={{
                                        // Fixed and in `document.body`, so no
                                        // scrolling ancestor can clip it (#208).
                                        position: 'fixed',
                                        top: `${anchor.top}px`,
                                        right: `${anchor.right}px`,
                                        // Never wider than what is left of the
                                        // viewport after the inset, which is
                                        // what makes it usable on a phone
                                        // rather than merely present.
                                        width: `${anchor.width}px`,
                                        maxHeight: `calc(100vh - ${anchor.top + 16}px)`,
                                        background: 'rgba(15, 10, 25, 0.95)',
                                        backdropFilter: 'blur(20px)',
                                        WebkitBackdropFilter: 'blur(20px)',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '12px',
                                        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                                        zIndex: 1001,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        color: '#fff',
                                        overflow: 'hidden'
                                    }}>
                                        {/* Header */}
                                        <div style={{
                                            padding: '12px 16px',
                                            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            background: 'rgba(0,0,0,0.1)'
                                        }}>
                                            <span style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#c084fc' }}>Notifications</span>
                                            {unreadCount > 0 && (
                                                <button 
                                                    onClick={handleMarkAllAsRead}
                                                    style={{
                                                        background: 'none',
                                                        border: 'none',
                                                        color: '#a78bfa',
                                                        fontSize: '0.75rem',
                                                        cursor: 'pointer',
                                                        fontWeight: 'bold',
                                                        padding: 0
                                                    }}
                                                >
                                                    Mark all read
                                                </button>
                                            )}
                                        </div>

                                        {/* List */}
                                        <div style={{
                                            overflowY: 'auto',
                                            // No cap of its own: the panel's
                                            // `maxHeight` already fits the
                                            // viewport, and a second limit
                                            // showed three of eight
                                            // notifications with 600px of
                                            // screen going spare.
                                            flex: 1,
                                        }}>
                                            {notifications.length > 0 ? (
                                                notifications.map(notif => {
                                                    const isUnread = !notif.isRead;
                                                    const icon = notif.type === 'POINTS' ? '🪙' : '✈️';
                                                    return (
                                                        <div 
                                                            key={notif.id}
                                                            onClick={() => isUnread && handleMarkAsRead(notif.id)}
                                                            style={{
                                                                padding: '12px 16px',
                                                                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                                                cursor: isUnread ? 'pointer' : 'default',
                                                                background: isUnread ? 'rgba(139, 92, 246, 0.1)' : 'transparent',
                                                                display: 'flex',
                                                                gap: '10px',
                                                                alignItems: 'flex-start',
                                                                transition: 'background 0.2s'
                                                            }}
                                                            className="notification-item"
                                                        >
                                                            <span style={{ fontSize: '1.2rem', marginTop: '2px' }}>{icon}</span>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, textAlign: 'left' }}>
                                                                <span style={{ fontWeight: isUnread ? 'bold' : 'normal', fontSize: '0.85rem', color: '#fff' }}>
                                                                    {notif.title}
                                                                </span>
                                                                <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)', lineHeight: '1.3' }}>
                                                                    {notif.message}
                                                                </span>
                                                                <span suppressHydrationWarning style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.72)', marginTop: '4px' }}>
                                                                    {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                </span>
                                                            </div>
                                                            {isUnread && (
                                                                <span style={{
                                                                    width: '6px',
                                                                    height: '6px',
                                                                    backgroundColor: '#a78bfa',
                                                                    borderRadius: '50%',
                                                                    marginTop: '6px',
                                                                    flexShrink: 0
                                                                }} />
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <div style={{
                                                    padding: '24px',
                                                    textAlign: 'center',
                                                    color: 'rgba(255, 255, 255, 0.72)',
                                                    fontSize: '0.85rem'
                                                }}>
                                                    {"You're all caught up!"}
                                                </div>
                                            )}
                                        </div>
                                    </div>,
                                    document.body,
                                )}
                            </div>

                            <div className="avatar" style={{ display: 'flex', alignItems: 'center' }}>
                                <Link href="/profile" style={{ display: 'flex' }}>
                                    <img src={userAvatar} width="32" height="32" alt="Profile" style={{ borderRadius: '50%', display: 'block' }} />
                                </Link>
                            </div>
                            <button onClick={() => signOut()} style={{ background: 'none', border: 'none', padding: 0, height: 'auto', width: 'auto', color: pathname?.startsWith('/admin') ? 'white' : 'inherit', cursor: 'pointer', fontWeight: 'bold', fontSize: 'inherit', fontFamily: 'inherit' }}>
                                Sign Out
                            </button>
                        </li>
                    ) : (
                        <>
                            <li>
                                <Link href="/login" style={{ color: pathname?.startsWith('/admin') ? 'white' : 'inherit', fontWeight: 'bold' }}>
                                    Sign In
                                </Link>
                            </li>
                            <li>
                                <Link href="/signup" style={{ color: pathname?.startsWith('/admin') ? 'white' : 'inherit', fontWeight: 'bold' }}>
                                    Sign Up
                                </Link>
                            </li>
                        </>
                    )}
                </ul>
            </nav>
        </header>
    );
};

export default TitleBar;
