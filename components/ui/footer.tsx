import React from 'react';
import Link from 'next/link';

const Footer: React.FC = () => {
    return (
        <footer>
        <div className="footer-columns">
            <div className="footer-column">
            <ul>
                <li className="title"><strong>Terms and Conditions</strong></li>
                <li>Contact Us</li>
                <li>FAQ</li>
                <li>About us</li>
                <li><Link href="/admin/travelguide">Admin</Link></li>
            </ul>
            </div>

            <div className="footer-column">
            <ul>
                <li className="title"><strong>On the go?</strong></li>
                <li>Contact traveling support</li>
                <li>+(1)5555555</li>
                <li>Mona Boulevard</li>
                <li>28930, US</li>
            </ul>
            </div>

            <div className="footer-column">
            <ul>
                <li className="title"><strong>For professionals</strong></li>
                <li>Agencies</li>
                <li>Groups</li>
                <li>Corporate</li>
                <li>Partners</li>
            </ul>
            </div>

            <div className="footer-column">
            <ul>
                <li className="title"><strong>Want to get special offers?</strong></li>
                <li>Subscribe to our newsletter</li>
            </ul>
            </div>

            <div className="footer-column">
            <ul>
                <li className="title"><strong>Follow us on</strong></li>
                <li>Mastodon</li>
                <li>GitHub</li>
            </ul>
            </div>
        </div>
    </footer>
    );
};

export default Footer;