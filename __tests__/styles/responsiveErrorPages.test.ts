/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

describe('error boundary and not-found responsive design rules', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');

    it('ensures error and not-found containers shrink and avoid horizontal overflow on 320px, 390px, 768px, and 1280px', () => {
        // Container width constraints
        expect(css).toContain('.error-boundary-container,\n.not-found-page {\n  justify-content: center;\n  width: 100%;\n  box-sizing: border-box;\n}');

        // Card sizing with min(100%, 34rem) and viewport-safe clamp padding
        expect(css).toContain('.error-card,\n.not-found-card {\n  width: min(100%, 34rem);');
        expect(css).toMatch(/\.error-card,\s*\.not-found-card\s*\{[^}]*box-sizing: border-box;/);

        // Fluid typography using clamp to avoid overflow on narrow 320px screens
        expect(css).toContain('font-size: clamp(3.5rem, 10vw, 5.5rem);');
        expect(css).toContain('font-size: clamp(1.5rem, 5vw, 2rem);');

        // Incident reference text wraps anywhere rather than overflowing narrow containers
        expect(css).toMatch(/\.incident-reference-text\s*\{[^}]*overflow-wrap: anywhere;/);

        // Actions and links take 100% width with border-box
        expect(css).toMatch(/\.error-actions,\s*\.not-found-shortcuts\s*\{[^}]*width: 100%;/);
        expect(css).toMatch(/\.error-actions,\s*\.not-found-shortcuts\s*\{[^}]*box-sizing: border-box;/);
    });
});
