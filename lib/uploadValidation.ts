/**
 * Upload validation and magic byte inspection for image uploads.
 * Restricts uploads to JPEG, PNG, WebP, and AVIF, enforcing size limits and
 * inspecting file signatures (magic bytes) to prevent polyglot attacks, XSS,
 * and malicious uploads (e.g. executable SVGs).
 */

export const DEFAULT_MAX_UPLOAD_BYTES = 512_000; // 500 KB (500 * 1024 = 512,000 bytes)

export const ALLOWED_IMAGE_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export interface UploadValidationOptions {
    maxSizeBytes?: number;
    allowedMimeTypes?: readonly string[] | string[];
    declaredMimeType?: string;
}

export type UploadValidationResult =
    | { valid: true; mimeType: string; size: number }
    | { valid: false; error: string };

/**
 * Checks whether a buffer contains executable script tags, SVG vectors, PHP blocks,
 * or HTML markup that could be leveraged for polyglot attacks.
 */
function inspectProhibitedMarkup(buffer: Uint8Array): { prohibited: boolean; isSvg: boolean } {
    const text = typeof Buffer !== 'undefined'
        ? Buffer.from(buffer).toString('latin1')
        : Array.from(buffer.subarray(0, Math.min(buffer.length, 65536))).map(b => String.fromCharCode(b)).join('');

    const isSvg = /<\s*svg\b/i.test(text);

    const polyglotPatterns = [
        /<\s*script\b/i,
        /<\s*html\b/i,
        /<\s*body\b/i,
        /<\s*iframe\b/i,
        /<\s*object\b/i,
        /<\s*embed\b/i,
        /<\?php/i,
        /<!ENTITY/i,
    ];

    const isPolyglot = isSvg || polyglotPatterns.some(pattern => pattern.test(text));

    return { prohibited: isPolyglot, isSvg };
}

/**
 * Detects whether the buffer matches JPEG magic bytes (starts with 0xFF, 0xD8, 0xFF).
 */
function isJpeg(buffer: Uint8Array): boolean {
    return buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
}

/**
 * Detects whether the buffer matches PNG magic bytes (0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A).
 */
function isPng(buffer: Uint8Array): boolean {
    return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4E &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0D &&
        buffer[5] === 0x0A &&
        buffer[6] === 0x1A &&
        buffer[7] === 0x0A
    );
}

/**
 * Detects whether the buffer matches WebP magic bytes:
 * RIFF header with WEBP format ('RIFF....WEBP').
 */
function isWebP(buffer: Uint8Array): boolean {
    return (
        buffer.length >= 12 &&
        buffer[0] === 0x52 && // R
        buffer[1] === 0x49 && // I
        buffer[2] === 0x46 && // F
        buffer[3] === 0x46 && // F
        buffer[8] === 0x57 && // W
        buffer[9] === 0x45 && // E
        buffer[10] === 0x42 && // B
        buffer[11] === 0x50 // P
    );
}

/**
 * Detects whether the buffer matches AVIF:
 * ISO Base Media File Format containing 'ftyp' box with 'avif' or 'avis'.
 */
function isAvif(buffer: Uint8Array): boolean {
    if (buffer.length < 12) return false;

    // Bytes 4-7 must be 'ftyp'
    if (
        buffer[4] !== 0x66 || // f
        buffer[5] !== 0x74 || // t
        buffer[6] !== 0x79 || // y
        buffer[7] !== 0x70 // p
    ) {
        return false;
    }

    // Read box size (32-bit big-endian)
    const boxSize = ((buffer[0] << 24) >>> 0) + (buffer[1] << 16) + (buffer[2] << 8) + buffer[3];
    const scanEnd = boxSize >= 12 && boxSize <= buffer.length ? boxSize : Math.min(buffer.length, 1024);

    // Search for 'avif' or 'avis' brand in the ftyp box
    for (let i = 8; i + 4 <= scanEnd; i++) {
        if (
            buffer[i] === 0x61 && // a
            buffer[i + 1] === 0x76 && // v
            buffer[i + 2] === 0x69 && // i
            (buffer[i + 3] === 0x66 || buffer[i + 3] === 0x73) // f or s
        ) {
            return true;
        }
    }

    return false;
}

/**
 * Inspects a binary buffer or Uint8Array for image magic bytes, size limits,
 * allowed MIME types, and prohibited polyglot/script content.
 */
export function validateImageBuffer(
    buffer: Buffer | Uint8Array,
    options?: UploadValidationOptions
): UploadValidationResult {
    const maxSizeBytes = options?.maxSizeBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
    const allowedMimeTypes = options?.allowedMimeTypes ?? ALLOWED_IMAGE_MIME_TYPES;
    const declaredMimeType = options?.declaredMimeType?.toLowerCase().trim();

    if (!buffer || buffer.length === 0) {
        return { valid: false, error: 'File is empty.' };
    }

    if (buffer.length > maxSizeBytes) {
        return {
            valid: false,
            error: `File size (${buffer.length} bytes) exceeds the maximum allowed limit of ${maxSizeBytes} bytes (500 KB).`,
        };
    }

    // Explicit check for declared SVG MIME type
    if (declaredMimeType === 'image/svg+xml') {
        return {
            valid: false,
            error: 'SVG images are not allowed for security reasons (script execution / XSS risk).',
        };
    }

    // Check for polyglot markup or SVG content in the buffer
    const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const { prohibited, isSvg } = inspectProhibitedMarkup(uint8);

    if (isSvg) {
        return {
            valid: false,
            error: 'SVG images are not allowed for security reasons (script execution / XSS risk).',
        };
    }

    // Determine detected format based on magic bytes
    let detectedMimeType: string | null = null;
    if (isJpeg(uint8)) {
        detectedMimeType = 'image/jpeg';
    } else if (isPng(uint8)) {
        detectedMimeType = 'image/png';
    } else if (isWebP(uint8)) {
        detectedMimeType = 'image/webp';
    } else if (isAvif(uint8)) {
        detectedMimeType = 'image/avif';
    }

    // If magic bytes matched an image type, but the buffer also contains dangerous scripts/HTML
    if (prohibited) {
        return {
            valid: false,
            error: 'File contains prohibited script or HTML markup (potential polyglot file).',
        };
    }

    if (!detectedMimeType) {
        return {
            valid: false,
            error: 'Unsupported or invalid image file signature. Allowed formats: JPEG, PNG, WebP, AVIF.',
        };
    }

    // Check against allowed MIME types
    if (!allowedMimeTypes.includes(detectedMimeType)) {
        return {
            valid: false,
            error: `Image format "${detectedMimeType}" is not allowed. Allowed formats: ${allowedMimeTypes.join(', ')}.`,
        };
    }

    // Check if declared MIME type matches detected format
    if (declaredMimeType && declaredMimeType !== detectedMimeType) {
        return {
            valid: false,
            error: `Declared MIME type "${declaredMimeType}" does not match detected format ("${detectedMimeType}").`,
        };
    }

    return {
        valid: true,
        mimeType: detectedMimeType,
        size: buffer.length,
    };
}

/**
 * Validates a base64 or encoded image data URL.
 * Checks MIME type, parses payload, and inspects magic bytes.
 */
export function validateImageDataUrl(
    dataUrl: string,
    options?: UploadValidationOptions
): UploadValidationResult {
    const maxSizeBytes = options?.maxSizeBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
    const allowedMimeTypes = options?.allowedMimeTypes ?? ALLOWED_IMAGE_MIME_TYPES;

    if (typeof dataUrl !== 'string' || !dataUrl.trim()) {
        return { valid: false, error: 'Image data URL must be a non-empty string.' };
    }

    const trimmed = dataUrl.trim();
    if (!trimmed.startsWith('data:')) {
        return { valid: false, error: 'Invalid data URL: must start with "data:".' };
    }

    const commaIndex = trimmed.indexOf(',');
    if (commaIndex === -1) {
        return { valid: false, error: 'Invalid data URL format: missing data separator comma.' };
    }

    const metadataPart = trimmed.slice(5, commaIndex); // e.g. "image/png;base64"
    const dataPart = trimmed.slice(commaIndex + 1);

    const parts = metadataPart.split(';');
    const declaredMimeType = parts[0]?.trim().toLowerCase();
    const isBase64 = parts.slice(1).some(part => part.trim().toLowerCase() === 'base64');

    // Reject SVGs immediately
    if (declaredMimeType === 'image/svg+xml') {
        return {
            valid: false,
            error: 'SVG images are not allowed for security reasons (script execution / XSS risk).',
        };
    }

    // Check declared MIME against allowed list if present
    if (declaredMimeType && !allowedMimeTypes.includes(declaredMimeType)) {
        return {
            valid: false,
            error: `Image format "${declaredMimeType}" is not supported. Allowed formats: ${allowedMimeTypes.join(', ')}.`,
        };
    }

    let buffer: Buffer;
    if (isBase64) {
        const cleanedData = dataPart.replace(/\s+/g, '');
        // Validate base64 string structure
        const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
        if (cleanedData.length === 0 || cleanedData.length % 4 !== 0 || !base64Regex.test(cleanedData)) {
            return { valid: false, error: 'Corrupted or invalid base64 image data payload.' };
        }

        try {
            buffer = Buffer.from(cleanedData, 'base64');
        } catch {
            return { valid: false, error: 'Failed to decode base64 image data.' };
        }
    } else {
        try {
            buffer = Buffer.from(decodeURIComponent(dataPart), 'binary');
        } catch {
            return { valid: false, error: 'Corrupted or invalid URL-encoded image data.' };
        }
    }

    return validateImageBuffer(buffer, {
        maxSizeBytes,
        allowedMimeTypes,
        declaredMimeType,
    });
}
