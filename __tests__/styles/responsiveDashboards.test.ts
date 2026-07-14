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
});
