import {
    validateImageBuffer,
    validateImageDataUrl,
    DEFAULT_MAX_UPLOAD_BYTES,
    ALLOWED_IMAGE_MIME_TYPES,
} from '@/lib/uploadValidation';

describe('uploadValidation', () => {
    // Helper sample byte buffers
    const sampleJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const samplePng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    const sampleWebp = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x20, 0x00, 0x00, 0x00, // length
        0x57, 0x45, 0x42, 0x50, // WEBP
        0x56, 0x50, 0x38, 0x20, // VP8
    ]);
    // AVIF with major brand 'avif'
    const sampleAvifMajor = Buffer.from([
        0x00, 0x00, 0x00, 0x1C, // 28 bytes
        0x66, 0x74, 0x79, 0x70, // 'ftyp'
        0x61, 0x76, 0x69, 0x66, // 'avif' (major brand)
        0x00, 0x00, 0x00, 0x00, // minor version
        0x6D, 0x69, 0x66, 0x31, // 'mif1'
        0x6D, 0x69, 0x61, 0x66, // 'miaf'
        0x00, 0x00, 0x00, 0x00,
    ]);
    // AVIF with major brand 'avis'
    const sampleAvisMajor = Buffer.from([
        0x00, 0x00, 0x00, 0x14, // 20 bytes
        0x66, 0x74, 0x79, 0x70, // 'ftyp'
        0x61, 0x76, 0x69, 0x73, // 'avis' (major brand)
        0x00, 0x00, 0x00, 0x00,
        0x6D, 0x69, 0x66, 0x31,
    ]);
    // AVIF with compatible brand 'avif'
    const sampleAvifCompatible = Buffer.from([
        0x00, 0x00, 0x00, 0x18, // 24 bytes
        0x66, 0x74, 0x79, 0x70, // 'ftyp'
        0x6D, 0x69, 0x66, 0x31, // 'mif1' (major brand)
        0x00, 0x00, 0x00, 0x00, // minor version
        0x61, 0x76, 0x69, 0x66, // 'avif' (compatible brand)
    ]);

    describe('constants', () => {
        it('has a default max size of 512,000 bytes (500 KB)', () => {
            expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(512_000);
        });

        it('allows JPEG, PNG, WebP, and AVIF, but NOT SVG', () => {
            expect(ALLOWED_IMAGE_MIME_TYPES).toEqual([
                'image/jpeg',
                'image/png',
                'image/webp',
                'image/avif',
            ]);
            expect(ALLOWED_IMAGE_MIME_TYPES).not.toContain('image/svg+xml');
        });
    });

    describe('validateImageBuffer', () => {
        it('validates a JPEG buffer', () => {
            const result = validateImageBuffer(sampleJpeg);
            expect(result).toEqual({
                valid: true,
                mimeType: 'image/jpeg',
                size: sampleJpeg.length,
            });
        });

        it('validates a PNG buffer', () => {
            const result = validateImageBuffer(samplePng);
            expect(result).toEqual({
                valid: true,
                mimeType: 'image/png',
                size: samplePng.length,
            });
        });

        it('validates a WebP buffer', () => {
            const result = validateImageBuffer(sampleWebp);
            expect(result).toEqual({
                valid: true,
                mimeType: 'image/webp',
                size: sampleWebp.length,
            });
        });

        it('validates an AVIF buffer with major brand avif', () => {
            const result = validateImageBuffer(sampleAvifMajor);
            expect(result).toEqual({
                valid: true,
                mimeType: 'image/avif',
                size: sampleAvifMajor.length,
            });
        });

        it('validates an AVIF buffer with major brand avis', () => {
            const result = validateImageBuffer(sampleAvisMajor);
            expect(result).toEqual({
                valid: true,
                mimeType: 'image/avif',
                size: sampleAvisMajor.length,
            });
        });

        it('validates an AVIF buffer with compatible brand avif', () => {
            const result = validateImageBuffer(sampleAvifCompatible);
            expect(result).toEqual({
                valid: true,
                mimeType: 'image/avif',
                size: sampleAvifCompatible.length,
            });
        });

        it('rejects empty buffers', () => {
            const result = validateImageBuffer(Buffer.alloc(0));
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/empty/i);
            }
        });

        it('rejects unknown or invalid file signatures', () => {
            const randomBytes = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
            const result = validateImageBuffer(randomBytes);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/signature|unsupported|invalid/i);
            }
        });

        it('rejects buffers exceeding default 500 KB limit', () => {
            const oversized = Buffer.concat([samplePng, Buffer.alloc(512_000)]);
            expect(oversized.length).toBeGreaterThan(DEFAULT_MAX_UPLOAD_BYTES);
            const result = validateImageBuffer(oversized);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/size|500 KB|limit/i);
            }
        });

        it('accepts buffers exactly at the max size limit', () => {
            const exactSize = Buffer.concat([samplePng, Buffer.alloc(512_000 - samplePng.length)]);
            expect(exactSize.length).toBe(DEFAULT_MAX_UPLOAD_BYTES);
            const result = validateImageBuffer(exactSize);
            expect(result.valid).toBe(true);
        });

        it('supports custom maxSizeBytes option', () => {
            const result = validateImageBuffer(samplePng, { maxSizeBytes: 10 });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/size|limit/i);
            }
        });

        it('supports custom allowedMimeTypes option', () => {
            const result = validateImageBuffer(samplePng, {
                allowedMimeTypes: ['image/jpeg'],
            });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/format|not allowed|support/i);
            }
        });

        it('rejects when declaredMimeType does not match detected format', () => {
            const result = validateImageBuffer(samplePng, {
                declaredMimeType: 'image/jpeg',
            });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/mismatch|does not match/i);
            }
        });

        it('rejects raw SVG buffer', () => {
            const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>');
            const result = validateImageBuffer(svgBuffer);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/svg/i);
            }
        });

        it('rejects SVG with XML declaration buffer', () => {
            const svgBuffer = Buffer.from('<?xml version="1.0"?><svg viewBox="0 0 100 100"></svg>');
            const result = validateImageBuffer(svgBuffer);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/svg/i);
            }
        });
    });

    describe('polyglot file rejection', () => {
        it('rejects PNG with embedded script tag', () => {
            const polyglot = Buffer.concat([samplePng, Buffer.from('<script>alert("xss")</script>')]);
            const result = validateImageBuffer(polyglot);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/polyglot|script|markup/i);
            }
        });

        it('rejects JPEG with embedded SVG tag', () => {
            const polyglot = Buffer.concat([sampleJpeg, Buffer.from('<svg onload=alert(1)>')]);
            const result = validateImageBuffer(polyglot);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/polyglot|svg|script|markup/i);
            }
        });

        it('rejects PNG with embedded PHP tags', () => {
            const polyglot = Buffer.concat([samplePng, Buffer.from('<?php echo "evil"; ?>')]);
            const result = validateImageBuffer(polyglot);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/polyglot|script|php|markup/i);
            }
        });

        it('rejects PNG with embedded HTML document', () => {
            const polyglot = Buffer.concat([samplePng, Buffer.from('<html><body><iframe src="evil.com"></iframe></body></html>')]);
            const result = validateImageBuffer(polyglot);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/polyglot|html|script|markup/i);
            }
        });

        it('rejects WebP with embedded iframe', () => {
            const polyglot = Buffer.concat([sampleWebp, Buffer.from('<iframe src="malicious.com"></iframe>')]);
            const result = validateImageBuffer(polyglot);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/polyglot|script|markup/i);
            }
        });
    });

    describe('validateImageDataUrl', () => {
        it('validates a valid PNG data URL', () => {
            const dataUrl = `data:image/png;base64,${samplePng.toString('base64')}`;
            const result = validateImageDataUrl(dataUrl);
            expect(result).toEqual({
                valid: true,
                mimeType: 'image/png',
                size: samplePng.length,
            });
        });

        it('validates a valid JPEG data URL', () => {
            const dataUrl = `data:image/jpeg;base64,${sampleJpeg.toString('base64')}`;
            const result = validateImageDataUrl(dataUrl);
            expect(result).toEqual({
                valid: true,
                mimeType: 'image/jpeg',
                size: sampleJpeg.length,
            });
        });

        it('validates a valid WebP data URL', () => {
            const dataUrl = `data:image/webp;base64,${sampleWebp.toString('base64')}`;
            const result = validateImageDataUrl(dataUrl);
            expect(result).toEqual({
                valid: true,
                mimeType: 'image/webp',
                size: sampleWebp.length,
            });
        });

        it('validates a valid AVIF data URL', () => {
            const dataUrl = `data:image/avif;base64,${sampleAvifMajor.toString('base64')}`;
            const result = validateImageDataUrl(dataUrl);
            expect(result).toEqual({
                valid: true,
                mimeType: 'image/avif',
                size: sampleAvifMajor.length,
            });
        });

        it('rejects SVG data URLs', () => {
            const svgDataUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=';
            const result = validateImageDataUrl(svgDataUrl);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/svg/i);
            }
        });

        it('rejects plain text SVG data URLs', () => {
            const svgDataUrl = 'data:image/svg+xml;utf8,<svg><script>alert(1)</script></svg>';
            const result = validateImageDataUrl(svgDataUrl);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/svg/i);
            }
        });

        it('rejects unsupported declared MIME types (e.g. image/gif)', () => {
            const gifDataUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            const result = validateImageDataUrl(gifDataUrl);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/supported|allowed/i);
            }
        });

        it('rejects mismatched declared MIME type vs magic bytes', () => {
            // Header says JPEG, but payload is PNG
            const mismatchDataUrl = `data:image/jpeg;base64,${samplePng.toString('base64')}`;
            const result = validateImageDataUrl(mismatchDataUrl);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/match/i);
            }
        });

        it('rejects oversized data URL payloads', () => {
            const oversized = Buffer.concat([samplePng, Buffer.alloc(512_000)]);
            const oversizedDataUrl = `data:image/png;base64,${oversized.toString('base64')}`;
            const result = validateImageDataUrl(oversizedDataUrl);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/size|500 KB|limit/i);
            }
        });

        it('rejects corrupted base64 data URLs', () => {
            const corrupted = 'data:image/png;base64,%%%NOT-BASE-64%%%';
            const result = validateImageDataUrl(corrupted);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/corrupt|invalid/i);
            }
        });

        it('rejects malformed data URL missing comma separator', () => {
            const malformed = 'data:image/png;base64';
            const result = validateImageDataUrl(malformed);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/format|separator|invalid/i);
            }
        });

        it('rejects string not starting with data:', () => {
            const notDataUrl = 'https://example.com/image.png';
            const result = validateImageDataUrl(notDataUrl);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/data url/i);
            }
        });

        it('rejects polyglot data URLs', () => {
            const polyglot = Buffer.concat([samplePng, Buffer.from('<script>alert("polyglot")</script>')]);
            const dataUrl = `data:image/png;base64,${polyglot.toString('base64')}`;
            const result = validateImageDataUrl(dataUrl);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toMatch(/polyglot|script|markup/i);
            }
        });
    });
});
