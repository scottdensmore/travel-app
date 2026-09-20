/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

describe('privacy responsive layout rules', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');

    it('ensures privacy page and cards cannot overflow horizontally', () => {
        expect(css).toContain('.privacy-page {\n  max-width: 1100px;\n  margin: 0 auto;\n  padding: 1.5rem 1rem;\n  color: #fff;\n  box-sizing: border-box;\n  min-width: 0;\n  width: 100%;');
        expect(css).toContain('.privacy-cards-grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));\n  gap: 2rem;\n  width: 100%;\n  min-width: 0;\n  box-sizing: border-box;');
        expect(css).toContain('.privacy-card {\n  background: rgba(255, 255, 255, 0.04);');
        expect(css).toContain('min-width: 0;\n  box-sizing: border-box;\n  overflow-wrap: break-word;');
    });

    it('adapts privacy layout for narrow screens (320px / 390px / 640px)', () => {
        expect(css).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?\.privacy-cards-grid \{\s*grid-template-columns: 1fr;\s*gap: 1.5rem;/);
        expect(css).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?\.privacy-page \{\s*padding: 1rem 0.75rem;/);
    });

    it('ensures buttons and inputs are responsive and fit mobile viewports', () => {
        expect(css).toContain('.privacy-button-primary,\n.privacy-button-secondary,\n.privacy-button-danger {\n  width: 100%;\n  min-height: 48px;');
        expect(css).toContain('.privacy-password-input {\n  width: 100%;\n  min-height: 44px;');
    });

    it('ensures landing page deletion banner is responsive', () => {
        expect(css).toContain('.account-deletion-banner {\n  max-width: 1200px;\n  margin: 1.5rem auto 0;\n  padding: 0 1rem;\n  box-sizing: border-box;\n  width: 100%;');
    });
});
