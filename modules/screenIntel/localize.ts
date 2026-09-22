import type { ScreenCapture } from '../shared'
import type { PhysicalRect, TargetMatch } from '../shared/screenIntel'
import { cropPhysicalRegion, mapCropPointToFull } from '../capture/crop'
import { inferPointingHint, type PointingHint } from './intent'
import { extractSearchQueries } from './queries'
import { normalizedToPhysical } from './coords'

export type LocalizeVisionFn = (input: {
  dataUrl: string
  width: number
  height: number
  labelHint: string
  model?: string
}) => Promise<{ cx: number; cy: number; found: boolean } | null>

/**
 * Guess a physical region of the screen likely to contain the target.
 */
export function inferSearchRegion(
  instruction: string,
  sizePhysical: { width: number; height: number },
  displayOriginPhysical: { x: number; y: number } = { x: 0, y: 0 }
): PhysicalRect {
  const hint: PointingHint = inferPointingHint(instruction)
  const { width: W, height: H } = sizePhysical
  const ox = displayOriginPhysical.x
  const oy = displayOriginPhysical.y

  switch (hint) {
    case 'taskbar':
      return { x: ox, y: oy + Math.round(H * 0.88), width: W, height: Math.round(H * 0.12) }
    case 'desktop-icon':
      return {
        x: ox,
        y: oy,
        width: W,
        height: Math.round(H * 0.9)
      }
    case 'search-field':
      return {
        x: ox + Math.round(W * 0.15),
        y: oy,
        width: Math.round(W * 0.7),
        height: Math.round(H * 0.28)
      }
    case 'button':
      return {
        x: ox + Math.round(W * 0.1),
        y: oy + Math.round(H * 0.05),
        width: Math.round(W * 0.8),
        height: Math.round(H * 0.7)
      }
    case 'window':
      return { x: ox, y: oy, width: W, height: H }
    case 'text-on-page':
      return {
        x: ox + Math.round(W * 0.05),
        y: oy + Math.round(H * 0.05),
        width: Math.round(W * 0.9),
        height: Math.round(H * 0.85)
      }
    case 'generic':
      return { x: ox, y: oy, width: W, height: H }
    default: {
      const _exhaustive: never = hint
      return _exhaustive
    }
  }
}

/**
 * Vision as localizer: crop likely region → ask model for center → map back to physical.
 * Box size is hint-aware (icons stay ~72px), not a fixed oversized screen fraction.
 */
export async function localizeTargetInRegion(options: {
  capture: ScreenCapture
  instruction: string
  sizePhysical: { width: number; height: number }
  displayOriginPhysical?: { x: number; y: number }
  region?: PhysicalRect
  model?: string
  localize: LocalizeVisionFn
}): Promise<TargetMatch | null> {
  const origin = options.displayOriginPhysical ?? { x: 0, y: 0 }
  const hint = inferPointingHint(options.instruction)
  const region =
    options.region ??
    inferSearchRegion(options.instruction, options.sizePhysical, origin)

  const crop = cropPhysicalRegion(options.capture, region, 32)
  if (!crop) return null

  const shortLabel =
    extractSearchQueries(options.instruction)[0] || options.instruction.slice(0, 40)

  const result = await options.localize({
    dataUrl: crop.dataUrl,
    width: crop.width,
    height: crop.height,
    labelHint: shortLabel,
    model: options.model
  })
  if (!result || !result.found) return null

  // Icon-sized physical box from center — avoid huge normalized rectangles
  if (hint === 'desktop-icon' || hint === 'taskbar' || hint === 'button') {
    const highlight = mapCropPointToFull(result.cx, result.cy, crop, 0.02, 0.02)
    const center = normalizedToPhysical(
      highlight.x + highlight.width / 2,
      highlight.y + highlight.height / 2,
      0.001,
      0.001,
      {
        displayBounds: options.capture.displayBounds,
        coordMap: options.capture.coordMap,
        scaleFactor: 1
      }
    )
    const cx = center.x + center.width / 2
    const cy = center.y + center.height / 2
    const side = hint === 'taskbar' ? 48 : 72
    const bounds: PhysicalRect = {
      x: Math.round(cx - side / 2),
      y: Math.round(cy - side / 2),
      width: side,
      height: side
    }
    return {
      source: 'vision',
      confidence: 0.55,
      label: shortLabel,
      bounds,
      reason: 'vision-localized-icon-box'
    }
  }

  const boxW = hint === 'search-field' ? 0.28 : 0.05
  const boxH = hint === 'search-field' ? 0.04 : 0.05
  const highlight = mapCropPointToFull(result.cx, result.cy, crop, boxW, boxH)
  const bounds = normalizedToPhysical(
    highlight.x,
    highlight.y,
    highlight.width,
    highlight.height,
    {
      displayBounds: options.capture.displayBounds,
      coordMap: options.capture.coordMap,
      scaleFactor: 1
    }
  )

  return {
    source: 'vision',
    confidence: 0.58,
    label: shortLabel,
    bounds,
    reason: 'vision-localized-crop'
  }
}
