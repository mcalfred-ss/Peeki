/**
 * Floating overlay (eye widget) contracts.
 * Window creation stays in main; this module owns placement rules.
 */

import type { OverlayPosition } from '../shared'

export const OVERLAY_SIZE = 84
export const OVERLAY_MARGIN = 24

export type OverlayPlacement = {
  getDefaultPosition(workArea: { x: number; y: number; width: number; height: number }): OverlayPosition
  clampToWorkArea(
    position: OverlayPosition,
    workArea: { x: number; y: number; width: number; height: number },
    size?: number
  ): OverlayPosition
}

export function createOverlayPlacement(size = OVERLAY_SIZE, margin = OVERLAY_MARGIN): OverlayPlacement {
  function getDefaultPosition(workArea: {
    x: number
    y: number
    width: number
    height: number
  }): OverlayPosition {
    return {
      x: workArea.x + margin,
      y: workArea.y + workArea.height - size - margin
    }
  }

  function clampToWorkArea(
    position: OverlayPosition,
    workArea: { x: number; y: number; width: number; height: number },
    widgetSize = size
  ): OverlayPosition {
    const minX = workArea.x
    const minY = workArea.y
    const maxX = workArea.x + workArea.width - widgetSize
    const maxY = workArea.y + workArea.height - widgetSize

    return {
      x: Math.min(Math.max(position.x, minX), Math.max(minX, maxX)),
      y: Math.min(Math.max(position.y, minY), Math.max(minY, maxY))
    }
  }

  return { getDefaultPosition, clampToWorkArea }
}
