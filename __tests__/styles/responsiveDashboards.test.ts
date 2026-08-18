/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

describe('dashboard responsive layout rules', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');

    it('lets profile and admin flex/grid children shrink within the viewport', () => {
        expect(css).toContain('.profile, .admin {\n  min-width: 0;');
        expect(css).toContain('.profile .content, .admin .content {\n  min-width: 0;');
        expect(css).toContain('.admin-flights-layout > * {\n  min-width: 0;');
        expect(css).toContain('.profile .profile-card, .admin .admin-card {\n  min-width: 0;');
    });

    it('stacks the profile and uses viewport-safe padding on narrow screens', () => {
        expect(css).toContain('@media (max-width: 900px) {\n  .profile {\n    flex-direction: column;');
        expect(css).toContain('.profile .sidebar-menu {\n    width: 100%;\n    flex-basis: auto;');
        expect(css).toContain('.page-container.admin {\n    padding-left: 1rem !important;');
    });

    it('contains the shared titlebar navigation on phone-sized screens', () => {
        expect(css).toContain('@media (max-width: 600px) {\n  header {\n    flex-wrap: wrap;');
        expect(css).toContain('header nav {\n    width: 100%;\n    min-width: 0;\n    overflow-x: auto;');
        expect(css).toContain('header nav ul {\n    width: max-content;\n    gap: 1rem !important;');
        expect(css).toContain('header nav ul li {\n    margin-left: 0;');
    });

    it('stacks the travel guide instead of overlapping its two panels', () => {
        // The map and the sidebar must both be in normal flow. The defect was a
        // `position: absolute` sidebar beside a `width: calc(100% - 472px)` map,
        // which disagreed about which box they measured against and overlapped by
        // a constant 216px at every width -- and left the map at zero width below
        // 512px, with the sidebar's left edge off-screen at -82px (#78).
        expect(css).toContain('.guide {\n'
            + '  display: flex;\n'
            + '  flex-direction: row;\n'
            + '  align-items: stretch;\n');
        // `.guide` shares its element with `.page-container`, so it has to undo
        // that rule's column direction, centring and padding rather than work
        // around them.
        expect(css).toMatch(/\.guide \{[^}]*padding: 0;/);
        expect(css).toMatch(/\.map \{[^}]*flex: 1 1 auto;/);
        expect(css).toMatch(/\.map \{[^}]*min-width: 0;/);
        expect(css).not.toMatch(/\.map \{[^}]*width: calc\(100% - 472px\);/);
        expect(css).toMatch(/\.sticky-sidebar \{[^}]*position: sticky;/);
        expect(css).not.toMatch(/\.sticky-sidebar \{[^}]*position: absolute;/);
    });

    it('gives the travel guide a breakpoint at all', () => {
        // There was no `@media` rule anywhere targeting these three selectors, in
        // a stylesheet with eight breakpoints for other surfaces. That absence is
        // the defect, so the guard is that the rule exists and stacks them.
        //
        // 1100 rather than 900: with a fixed 472px sidebar the map column is 429px
        // at 901px wide, which draws the world in 429x268 inside an 811-tall panel.
        // A rendered review called that broken rather than deliberate, and geometry
        // cannot tell the difference -- so the number is pinned here.
        expect(css).toContain('@media (max-width: 1100px) {\n'
            + '  .guide {\n'
            + '    flex-direction: column;\n'
            + '  }');
        expect(css).toMatch(/@media \(max-width: 1100px\) \{\s*\.guide \{[\s\S]*?\.sticky-sidebar \{[^}]*position: static;/);
    });

    it('sizes the guide from a measured header height, named once', () => {
        // 72px, hard-coded in four places, against a header that is 89px. Two
        // constants that had to agree and did not.
        expect(css).toMatch(/--header-height: 89px;/);
        expect(css).toMatch(/\.map \{[^}]*height: calc\(100vh - var\(--header-height\)\);/);
        expect(css).toMatch(/\.sticky-sidebar \{[^}]*height: calc\(100vh - var\(--header-height\)\);/);
        expect(css).toMatch(/\.sticky-sidebar \{[^}]*top: var\(--header-height\);/);
        // No rule may go back to asserting the old number about the header.
        expect(css).not.toMatch(/calc\(100vh - 72px\)/);
    });

    it('keeps the destinations list from dragging the page under the header', () => {
        // Reaching the end of the list chained its scroll to the document and
        // pulled the whole guide up under the translucent header, so the city prose
        // and the nav labels were legible through one another.
        expect(css).toMatch(/\.sticky-sidebar \{[^}]*overscroll-behavior: contain;/);
    });

    it('keeps a revealed city panel clear of the sticky header', () => {
        // `scrollIntoView({ block: 'nearest' })` start-aligns an element taller than
        // the scrollport, so the panel landed at y=0 under a translucent
        // `z-index: 1000` header and its back and favourite controls could not be
        // clicked. A ceiling rather than a measurement, because the header's height
        // depends on whether its logo and title wrap.
        expect(css).toMatch(/--header-scroll-offset: 120px;/);
        expect(css).toContain('.guide-extra {\n  scroll-margin-top: var(--header-scroll-offset);\n}');
    });

    it('fits the map drawing inside its panel', () => {
        // The SVG is aspect-locked and keeps its intrinsic height, so a fixed-height
        // panel let it spill 157px past the bottom and paint through the 85%-opaque
        // sidebar.
        expect(css).toMatch(/\.map \{[^}]*overflow: hidden;/);
        expect(css).toContain('.map > svg {\n  width: 100%;\n  height: 100%;\n}');
    });

    it('makes the guide rating select legible', () => {
        // It had no rule at all, so it inherited white text onto the user agent's
        // light control background -- about 1.2:1, in the one control the review
        // journey cannot be completed without.
        expect(css).toMatch(/\.guide-review-form select \{[^}]*background: #17142d;/);
        expect(css).toMatch(/\.guide-review-form select \{[^}]*color: #fff;/);
    });

    it('keeps the programmatically focused schedule result visibly located', () => {
        expect(css).toContain(
            '.schedule-terms-success:focus {\n'
            + '  outline: 3px solid #fbbf24;\n'
            + '  outline-offset: 3px;\n'
            + '  box-shadow: 0 0 0 5px rgba(251, 191, 36, 0.28);\n'
            + '}',
        );
    });
});
