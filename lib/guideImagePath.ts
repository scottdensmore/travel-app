const MANAGED_GUIDE_IMAGE_REGEX = /^\/uploads\/guides\/guide-[a-f0-9]{16}\.(jpe?g|png|webp|avif)$/i;

/**
 * Checks whether a given path conforms to the managed guide image storage format:
 * /uploads/guides/guide-[16 hex chars].[ext]
 */
export function isManagedGuideImagePath(filePath: string): boolean {
    if (typeof filePath !== 'string') return false;
    return MANAGED_GUIDE_IMAGE_REGEX.test(filePath);
}

