import { saveGuideImage, isManagedGuideImagePath } from '@/lib/guideImageStorage';
import { coverImageSchema } from '@/lib/validation';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('guideImageStorage', () => {
    const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const validJpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    const validWebpHeader = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x20, 0x00, 0x00, 0x00, // file size
        0x57, 0x45, 0x42, 0x50, // WEBP
        0x56, 0x50, 0x38, 0x20, // VP8
    ]);
    const validAvifHeader = Buffer.from([
        0x00, 0x00, 0x00, 0x1c, // size
        0x66, 0x74, 0x79, 0x70, // ftyp
        0x61, 0x76, 0x69, 0x66, // avif
        0x00, 0x00, 0x00, 0x00,
    ]);

    it('saves a valid PNG buffer to managed storage with deterministic hash', async () => {
        const filePath = await saveGuideImage(validPngHeader);
        expect(filePath).toMatch(/^\/uploads\/guides\/guide-[a-f0-9]{16}\.png$/);
        expect(isManagedGuideImagePath(filePath)).toBe(true);

        const diskPath = path.join(process.cwd(), 'public', filePath.replace(/^\//, ''));
        const exists = await fs.stat(diskPath).then(() => true).catch(() => false);
        expect(exists).toBe(true);

        // Deterministic hash: saving again produces same path
        const repeatPath = await saveGuideImage(validPngHeader);
        expect(repeatPath).toBe(filePath);

        // Cleanup
        await fs.unlink(diskPath).catch(() => {});
    });

    it('saves valid JPEG, WebP, and AVIF buffers to managed storage', async () => {
        const jpegPath = await saveGuideImage(validJpegHeader);
        expect(jpegPath).toMatch(/^\/uploads\/guides\/guide-[a-f0-9]{16}\.jpeg$/);
        const diskJpeg = path.join(process.cwd(), 'public', jpegPath.replace(/^\//, ''));
        await fs.unlink(diskJpeg).catch(() => {});

        const webpPath = await saveGuideImage(validWebpHeader);
        expect(webpPath).toMatch(/^\/uploads\/guides\/guide-[a-f0-9]{16}\.webp$/);
        const diskWebp = path.join(process.cwd(), 'public', webpPath.replace(/^\//, ''));
        await fs.unlink(diskWebp).catch(() => {});

        const avifPath = await saveGuideImage(validAvifHeader);
        expect(avifPath).toMatch(/^\/uploads\/guides\/guide-[a-f0-9]{16}\.avif$/);
        const diskAvif = path.join(process.cwd(), 'public', avifPath.replace(/^\//, ''));
        await fs.unlink(diskAvif).catch(() => {});
    });

    it('saves image from base64 data URL', async () => {
        const dataUrl = `data:image/png;base64,${validPngHeader.toString('base64')}`;
        const filePath = await saveGuideImage(dataUrl);
        expect(filePath).toMatch(/^\/uploads\/guides\/guide-[a-f0-9]{16}\.png$/);

        const diskPath = path.join(process.cwd(), 'public', filePath.replace(/^\//, ''));
        await fs.unlink(diskPath).catch(() => {});
    });

    it('rejects polyglot payloads containing executable HTML/scripts', async () => {
        const polyglot = Buffer.concat([validPngHeader, Buffer.from('<script>alert("xss")</script>')]);
        await expect(saveGuideImage(polyglot)).rejects.toThrow(/prohibited markup|invalid image/i);
    });

    it('rejects SVG images masquerading as raster images', async () => {
        const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
        await expect(saveGuideImage(svgContent)).rejects.toThrow(/invalid image|svg/i);
    });

    it('rejects files exceeding max upload size limit', async () => {
        const oversized = Buffer.alloc(600 * 1024, 0);
        await expect(saveGuideImage(oversized)).rejects.toThrow(/500 KB or smaller/i);
    });

    it('validates paths with isManagedGuideImagePath', () => {
        expect(isManagedGuideImagePath('/uploads/guides/guide-1234567890abcdef.png')).toBe(true);
        expect(isManagedGuideImagePath('/uploads/guides/guide-1234567890abcdef.jpeg')).toBe(true);
        expect(isManagedGuideImagePath('/uploads/guides/guide-1234567890abcdef.jpg')).toBe(true);
        expect(isManagedGuideImagePath('/uploads/guides/guide-1234567890abcdef.webp')).toBe(true);
        expect(isManagedGuideImagePath('/uploads/guides/guide-1234567890abcdef.avif')).toBe(true);

        expect(isManagedGuideImagePath('/uploads/guides/guide-1234.png')).toBe(false); // hash too short
        expect(isManagedGuideImagePath('/uploads/guides/other.png')).toBe(false);
        expect(isManagedGuideImagePath('/uploads/guides/../../etc/passwd')).toBe(false);
        expect(isManagedGuideImagePath('https://malicious.com/image.jpg')).toBe(false);
        expect(isManagedGuideImagePath('/img/my-profile-photo.jpg')).toBe(false);
    });

    it('updates coverImageSchema to reject unmanaged external URLs', () => {
        expect(coverImageSchema.safeParse('https://malicious.com/image.jpg').success).toBe(false);
        expect(coverImageSchema.safeParse('http://malicious.com/image.jpg').success).toBe(false);
        expect(coverImageSchema.safeParse('/img/my-profile-photo.jpg').success).toBe(true);
        expect(coverImageSchema.safeParse('/uploads/guides/guide-1234567890abcdef.png').success).toBe(true);
        expect(coverImageSchema.safeParse('/uploads/guides/guide-1234567890abcdef.jpeg').success).toBe(true);
        expect(coverImageSchema.safeParse('/uploads/guides/guide-1234567890abcdef.jpg').success).toBe(true);
        expect(coverImageSchema.safeParse('/uploads/guides/guide-1234567890abcdef.webp').success).toBe(true);
        expect(coverImageSchema.safeParse('/uploads/guides/guide-1234567890abcdef.avif').success).toBe(true);
    });
});
