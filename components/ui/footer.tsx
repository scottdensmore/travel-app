import React from 'react';
import { BRAND, SOCIAL_LINKS, SUPPORT } from '@/lib/brand';

/**
 * The footer previously listed Contact Us, FAQ, About us, Agencies, Groups,
 * Corporate, Partners and a newsletter. None were links -- they were list items
 * styled to look navigable, leading nowhere. They promised sections this
 * application does not have, which is the same defect as a control pointing at
 * "#" (#70), so they are gone rather than linked to placeholder pages (#72).
 *
 * What remains is what the product can actually stand behind: who it is, how to
 * reach it, and links that resolve.
 */
const Footer: React.FC = () => {
    return (
        <footer>
            <div className="footer-columns">
                <div className="footer-column">
                    <ul>
                        <li className="title"><strong>{BRAND.name}</strong></li>
                        <li>{BRAND.tagline}</li>
                        <li>Airline code {BRAND.airlineCode}</li>
                    </ul>
                </div>

                <div className="footer-column">
                    <ul>
                        <li className="title"><strong>Traveller support</strong></li>
                        {/*
                          * Non-routable example details on purpose: this
                          * application runs no support desk, and a number that
                          * reached a real stranger would be worse than one that
                          * is plainly an example.
                          */}
                        <li>
                            <a href={`tel:${SUPPORT.phone.replace(/[^\d+]/g, '')}`}>
                                {SUPPORT.phone}
                            </a>{' '}
                            <span className="footer-note">(example)</span>
                        </li>
                        <li>
                            <a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a>{' '}
                            <span className="footer-note">(example)</span>
                        </li>
                    </ul>
                </div>

                <div className="footer-column">
                    <ul>
                        <li className="title"><strong>Registered office</strong></li>
                        {SUPPORT.addressLines.map(line => <li key={line}>{line}</li>)}
                    </ul>
                </div>

                <div className="footer-column">
                    <ul>
                        <li className="title"><strong>Follow us</strong></li>
                        {SOCIAL_LINKS.map(link => (
                            <li key={link.label}>
                                <a href={link.href} rel="noreferrer noopener" target="_blank">
                                    {link.label}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
