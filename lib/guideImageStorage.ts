import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    DEFAULT_MAX_UPLOAD_BYTES,
    validateImageBuffer,
    type UploadValidationResult,
} from './uploadValidation';

const MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
};

const MANAGED_GUIDE_IMAGE_REGEX = /^\/uploads\/guides\/guide-[a-f0-9]{16}\.(jpe?g|png|webp|avif)$/i;

/**
 * Checks whether a given path conforms to the managed guide image storage format:
 * /uploads/guides/guide-[16 hex chars].[ext]
 */
export function isManagedGuideImagePath(filePath: string): boolean {
    if (typeof filePath !== 'string') return false;
    return MANAGED_GUIDE_IMAGE_REGEX.test(filePath);
}

/**
 * Validates and stores a guide cover image payload (data URL, base64 string, or Buffer)
 * into managed local storage (public/uploads/guides/guide-[16 hex hash].[ext]).
 *
 * @param payload - Base64 data URL, base64 string, or binary Buffer
 * @returns Relative public URL path to the saved image (e.g. /uploads/guides/guide-abcdef1234567890.png)
 */
export async function saveGuideImage(payload: string | Buffer): Promise<string> {
    let buffer: Buffer;
    let declaredMimeType: string | undefined;

    if (typeof payload === 'string') {
        const trimmed = payload.trim();
        if (trimmed.startsWith('data:')) {
            const commaIndex = trimmed.indexOf(',');
            if (commaIndex === -1) {
                throw new Error('Invalid image: missing data separator comma in data URL.');
            }
            const metadataPart = trimmed.slice(5, commaIndex);
            const dataPart = trimmed.slice(commaIndex + 1);
            const parts = metadataPart.split(';');
            declaredMimeType = parts[0]?.trim().toLowerCase();
            const isBase64 = parts.slice(1).some(part => part.trim().toLowerCase() === 'base64');
            if (isBase64) {
                const cleaned = dataPart.replace(/\s+/g, '');
                buffer = Buffer.from(cleaned, 'base64');
            } else {
                buffer = Buffer.from(decodeURIComponent(dataPart), 'binary');
            }
        } else {
            buffer = Buffer.from(trimmed, 'base64');
        }
    } else if (Buffer.isBuffer(payload)) {
        buffer = payload;
    } else {
        throw new Error('Invalid payload: expected string or Buffer.');
    }

    if (buffer.length > DEFAULT_MAX_UPLOAD_BYTES) {
        throw new Error(`Image must be 500 KB or smaller (received ${buffer.length} bytes).`);
    }

    const validation: UploadValidationResult = validateImageBuffer(buffer, { declaredMimeType });
    if (!validation.valid) {
        throw new Error(`Invalid image: prohibited markup or script detected. ${validation.error}`);
    }

    const ext = MIME_TO_EXT[validation.mimeType] || 'png';
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const filename = `guide-${hash}.${ext}`;
    const publicRelativePath = `/uploads/guides/${filename}`;

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'guides');
    await fs.mkdir(uploadDir, { recursive: true });

    const targetFilePath = path.join(uploadDir, filename);
    await fs.writeFile(targetFilePath, buffer);

    return publicRelativePath;
}
