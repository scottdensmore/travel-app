/**
 * The product's identity, in one place.
 *
 * The application called itself Mona Airways while every seeded flight was
 * operated by "Gemini Airways", so the site and its inventory disagreed about
 * who the customer was buying from. AGENTS.md names the product, so that is the
 * name; the other was demo residue (#72).
 *
 * Anything a customer reads about the airline itself comes from here, so the
 * name, the code and the contact details cannot drift apart again.
 */
export const BRAND = {
    name: 'Mona Airways',
    /// Two-letter designator, used as the prefix of every flight number.
    airlineCode: 'MA',
    tagline: 'Where Your Journey Takes Flight',
    description:
        'Search and book flights with Mona Airways. Compare fares by cabin, '
        + 'choose your seat on every leg, and manage your trips in one place.',
} as const;

/**
 * Contact details.
 *
 * These are deliberately non-routable example values: this application does not
 * operate a support desk, and printing a number that reaches someone else would
 * be worse than printing an obvious placeholder. They are marked as examples in
 * the interface rather than dressed up as real (#72).
 */
export const SUPPORT = {
    phone: '+1 (555) 0100',
    email: 'support@example.com',
    addressLines: ['1 Mona Boulevard', 'Seattle, WA 98101', 'United States'],
} as const;

/** Links that go somewhere. Anything without a destination does not belong. */
export const SOCIAL_LINKS = [
    { label: 'GitHub', href: 'https://github.com/scottdensmore/travel-app' },
] as const;

/** A page title, in the form every route uses. */
export function pageTitle(page: string): string {
    return `${page} | ${BRAND.name}`;
}
