"use client"
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation'; 
// @damovisa I am sorry I don't think this is the best way to do this but I am not sure how to do it better.


  const TitleBar: React.FC = () => {    
    const pathname = usePathname();

    const pageTitles: { [key: string]: string } = {
        '/book': 'Book Flight',
        '/checkin': 'Check-In',
        '/travelguide': 'Travel Guide',
        '/profile': 'Profile',
        '/admin/travelguide': 'Admin',
    };

    const pageTitle = pageTitles[pathname] || '';
    return (
        <header className={pathname === '/admin/travelguide' ? 'admin-header' : ''}>
            <div className="logo">
                <Link href="/"><img src="/img/logo.svg" alt="Copilot Airways" /></Link>
                <span>{pageTitle}</span> 
            </div>
            <nav>
            {pathname === '/admin/travelguide' ? (             
                    <ul>
                    <li className="avatar">
                            <Link href="/profile">
                                <img src="/img/profile-photo.jpg" width="32px" height="32px" />
                            </Link>
                        </li>
                    </ul>           
            ) : (
                
                    <ul>
                        <li className={pathname === '/book' ? 'selected' : ''}>
                            <Link href="/book">Book Flight</Link>
                        </li>
                        <li className={pathname === '/checkin' ? 'selected' : ''}>
                            <Link href="#">Check-In</Link>
                        </li>
                        <li className={pathname === '/travelguide' ? 'selected' : ''}>
                            <Link href="/travelguide">Travel Guide</Link>
                        </li>
                        <li className={pathname === '/profile' ? 'avatar' : 'avatar'}>
                            <Link href="/profile">
                                <img src="/img/profile-photo.jpg" width="32px" height="32px" />
                            </Link>
                        </li>
                    </ul>
               
            )}
            </nav>
        </header>
    );
};

export default TitleBar;