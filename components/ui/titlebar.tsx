"use client"
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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

const TitleBar: React.FC = () => {
    const pathname = usePathname();
    const { data: session } = useSession();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const drawerRef = useRef<HTMLLIElement>(null);

    const pageTitles: { [key: string]: string } = {
        '/book': 'Book Flight',
        '/checkin': 'Check-In',
        '/travelguide': 'Travel Guide',
        '/profile': 'Profile',
        '/flights': 'Flight Status',
        '/admin': 'Admin Dashboard',
        '/admin/travelguide': 'Manage City Guides',
    };

    const pageTitle = pageTitles[pathname] || '';
    const userAvatar = session?.user?.image || "/img/my-profile-photo.jpg";
    const isAdmin = session?.user?.role === 'ADMIN';

    const fetchNotifications = useCallback(async () => {
        if (session?.user) {
            try {
                const notifs = await getUserNotificationsAction();
                setNotifications(notifs as Notification[]);
            } catch (err) {
                console.error("Failed to load notifications:", err);
            }
        } else {
            setNotifications([]);
        }
    }, [session]);

    // Fetch immediately on mount / route change, and set up 3s polling interval
    useEffect(() => {
        fetchNotifications();
        const interval = setInterval(fetchNotifications, 3000);
        return () => clearInterval(interval);
    }, [fetchNotifications, pathname]);

    // Click outside to close notifications drawer
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (drawerRef.current && !drawerRef.current.contains(event.target as Node)) {
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
                    <img src="/img/logo.svg" alt="Gemini Airways" width="32" height="32" />
                    <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Gemini Airways</span>
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
                            <li className={pathname === '/checkin' ? 'selected' : ''}>
                                <Link href="#">Check-In</Link>
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
                                    onClick={() => setIsOpen(!isOpen)}
                                    aria-label="Toggle notifications"
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: '1.25rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '4px',
                                        color: pathname?.startsWith('/admin') ? 'white' : 'inherit',
                                        outline: 'none',
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
                                {isOpen && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '40px',
                                        right: 0,
                                        width: '320px',
                                        maxHeight: '400px',
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
                                            flex: 1,
                                            maxHeight: '340px'
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
                                                                <span suppressHydrationWarning style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.4)', marginTop: '4px' }}>
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
                                                    color: 'rgba(255, 255, 255, 0.4)',
                                                    fontSize: '0.85rem'
                                                }}>
                                                    {"You're all caught up!"}
                                                </div>
                                            )}
                                        </div>
                                    </div>
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