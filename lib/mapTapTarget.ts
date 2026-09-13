export const MIN_TAP_TARGET_PX = 24;
export const VIEWBOX_WIDTH = 800;
export const VIEWBOX_HEIGHT = 500;
export const MAP_PROJECTION_CONFIG = {
    scale: 600,
    center: [-70, 28] as [number, number],
};

export function tapTargetRadius(viewportWidth: number = 390): number {
    return (MIN_TAP_TARGET_PX / 2) / (viewportWidth / VIEWBOX_WIDTH);
}

export function minPairwiseMarkerDistance(viewportWidth: number = 390, dotRadius: number = 5): number {
    return tapTargetRadius(viewportWidth) + dotRadius;
}
