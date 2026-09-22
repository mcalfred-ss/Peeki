/**
 * Floating overlay (eye widget) contracts.
 * Window creation stays in main; this module owns placement rules.
 */

import type { OverlayPosition } from '../shared'

/** Logo / orb face size */
export const OVERLAY_ORB_SIZE = 84
/** Done chip above the orb */
export const OVERLAY_DONE_HEIGHT = 30
export const OVERLAY_STACK_GAP = 6
/** Full overlay window (Done + gap + orb) */
export const OVERLAY_WIDTH = OVERLAY_ORB_SIZE
export const OVERLAY_HEIGHT = OVERLAY_DONE_HEIGHT + OVERLAY_STACK_GAP + OVERLAY_ORB_SIZE
/** @deprecated use OVERLAY_ORB_SIZE — kept for older imports */
export const OVERLAY_SIZE = OVERLAY_ORB_SIZE
export const OVERLAY_MARGIN = 24

export type OverlayPlacement = {
  getDefaultPosition(workArea: { x: number; y: number; width: number; height: number }): OverlayPosition
  clampToWorkArea(
    position: OverlayPosition,
    workArea: { x: number; y: number; width: number; height: number },
    size?: { width: number; height: number }
  ): OverlayPosition
}

export function createOverlayPlacement(
  size: { width: number; height: number } = { width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT },
  margin = OVERLAY_MARGIN
): OverlayPlacement {
  function getDefaultPosition(workArea: {
    x: number
    y: number
    width: number
    height: number
  }): OverlayPosition {
    return {
      x: workArea.x + margin,
      y: workArea.y + workArea.height - size.height - margin
    }
  }

  function clampToWorkArea(
    position: OverlayPosition,
    workArea: { x: number; y: number; width: number; height: number },
    widgetSize = size
  ): OverlayPosition {
    const minX = workArea.x
    const minY = workArea.y
    const maxX = workArea.x + workArea.width - widgetSize.width
    const maxY = workArea.y + workArea.height - widgetSize.height

    return {
      x: Math.min(Math.max(position.x, minX), Math.max(minX, maxX)),
      y: Math.min(Math.max(position.y, minY), Math.max(minY, maxY))
    }
  }

  return { getDefaultPosition, clampToWorkArea }
}
