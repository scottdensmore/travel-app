"use client"
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

const TitleBar: React.FC = () => {
    const pathname = usePathname();
    const { data: session } = useSession();

    const pageTitles: { [key: string]: string } = {
        '/book': 'Book Flight',
        '/checkin': 'Check-In',
        '/travelguide': 'Travel Guide',
        '/profile': 'Profile',
        '/admin': 'Admin Dashboard',
        '/admin/travelguide': 'Manage City Guides',
    };

    const pageTitle = pageTitles[pathname] || '';
    const userAvatar = session?.user?.image || "/img/my-profile-photo.jpg";
    const isAdmin = (session?.user as any)?.role === 'ADMIN';

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
                        </>
                    )}

                    {isAdmin && (
                        <li className={pathname === '/admin' ? 'selected' : ''}>
                            <Link href="/admin">Admin</Link>
                        </li>
                    )}

                    {session ? (
                        <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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