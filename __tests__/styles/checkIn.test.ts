/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * The two check-in rules a rendered review caught and no other test can.
 *
 * `app/globals.css` ships to the browser, so it is product code. Both of these
 * are the kind of defect that looks fine in the markup: the focus ring never
 * appeared for a mouse user, and the links were distinguished from the sentence
 * around them by colour alone.
 */
describe('check-in styling', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');

    it('scans the stylesheet it claims to scan', () => {
        // Guards the guard: a read of the wrong file would pass everything.
        expect(css).toContain('.checkin-card {');
    });

    it('keeps the programmatically focused check-in outcome visibly located', () => {
        // `:focus`, not `:focus-visible`. The panel moves focus here after a
        // check-in, and Chrome does not count a programmatic focus as
        // focus-visible when the last interaction was a pointer -- so a mouse or
        // touch user's focus moved with nothing on screen saying where. The same
        // reasoning, and the same fix, as `.schedule-terms-success:focus`.
        expect(css).toContain(
            '.checkin-feedback:focus {\n'
            + '  outline: 3px solid #f5d0fe;\n'
            + '  outline-offset: 2px;\n'
            + '}',
        );
    });

    it('gives the attestation checkbox a target the size guideline asks for', () => {
        // 1.5rem = 24px, WCAG 2.5.8's minimum, rather than leaning on the
        // "equivalent inline target" exception the `<label for>` would grant. The
        // label is still a target; the box no longer needs it to pass.
        expect(css).toContain('.checkin-attestation input[type="checkbox"] {');
        expect(css).toMatch(/\.checkin-attestation input\[type="checkbox"\] \{[^}]*width: 1\.5rem;/);
        expect(css).toMatch(/\.checkin-attestation input\[type="checkbox"\] \{[^}]*height: 1\.5rem;/);
    });

    it('keeps the checkbox from rendering as a solid white square', () => {
        // A light-scheme UA control on a dark panel reads as filled rather than
        // empty. Scoped to this block, not the root, where it would restyle every
        // control in the application.
        expect(css).toMatch(
            /\.checkin-attestation input\[type="checkbox"\] \{[^}]*color-scheme: dark;/,
        );
    });

    it('makes the attestation checkbox focus visible', () => {
        expect(css).toContain(
            '.checkin-attestation input[type="checkbox"]:focus-visible {\n'
            + '  outline: 3px solid #f5d0fe;\n'
            + '  outline-offset: 2px;\n'
            + '}',
        );
    });

    it('does not call a blocked control busy', () => {
        // `aria-disabled` now marks two different states -- a request in flight and
        // an attestation not yet given -- and nothing is in progress in the second.
        // `progress` was honest for the first only.
        expect(css).toMatch(
            /\.checkin-submit\[aria-disabled="true"\] \{[^}]*cursor: not-allowed;/,
        );
        expect(css).not.toMatch(
            /\.checkin-submit\[aria-disabled="true"\] \{[^}]*cursor: progress;/,
        );
    });

    it('ships no escaped markup in its comments', () => {
        // `&lt;`/`&gt;` reached this stylesheet once through a heredoc. Harmless
        // inside a comment, but globals.css ships to the browser.
        expect(css).not.toContain('&lt;');
        expect(css).not.toContain('&gt;');
    });

    it('does not distinguish an in-sentence link by colour alone', () => {
        // The link colour against the body text around it is 1.43:1, well under
        // the 3:1 WCAG G183 asks for when colour is the only cue. Weight is a
        // second cue; the underline is the one that does not depend on comparing
        // two shades of the same hue.
        expect(css).toContain(
            '.checkin-empty a,\n'
            + '.checkin-link {\n'
            + '  color: #d8b4fe;\n'
            + '  font-weight: 700;\n'
            + '  text-decoration: underline;\n'
            + '}',
        );
    });
});
