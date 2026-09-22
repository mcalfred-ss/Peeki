/**
 * Build tight overlay marks from a resolved target's real bounds.
 * Never invents a fixed generic highlight size.
 */
import type { AbsoluteMark, PhysicalRect, TargetMatch } from '../shared/screenIntel'
import { physicalRectToDip } from './coords'

/** Expand bounds by ~15% (10–20% band), keeping the same center. */
export function padTargetBounds(bounds: PhysicalRect, grow = 0.15): PhysicalRect {
  const factor = Math.min(0.2, Math.max(0.1, grow))
  const width = Math.max(12, Math.round(bounds.width * (1 + factor)))
  const height = Math.max(12, Math.round(bounds.height * (1 + factor)))
  return {
    x: Math.round(bounds.x - (width - bounds.width) / 2),
    y: Math.round(bounds.y - (height - bounds.height) / 2),
    width,
    height
  }
}

export function logTargetPipeline(
  match: TargetMatch,
  overlayBounds?: PhysicalRect
): void {
  const dip = physicalRectToDip(match.bounds)
  const overlay = overlayBounds ?? dip
  const lines = [
    'TARGET',
    `name: ${match.label}`,
    `source: ${match.source}`,
    `confidence: ${match.confidence.toFixed(3)}`,
    match.reason ? `reason: ${match.reason}` : null,
    `physical bounds: x=${match.bounds.x}, y=${match.bounds.y}, w=${match.bounds.width}, h=${match.bounds.height}`,
    `DIP bounds: x=${Math.round(dip.x)}, y=${Math.round(dip.y)}, w=${Math.round(dip.width)}, h=${Math.round(dip.height)}`,
    `overlay bounds: x=${Math.round(overlay.x)}, y=${Math.round(overlay.y)}, w=${Math.round(overlay.width)}, h=${Math.round(overlay.height)}`
  ].filter(Boolean)
  console.log(lines.join('\n'))
}

export function logCaptureTransform(info: {
  captureW: number
  captureH: number
  physicalW: number
  physicalH: number
  displayId: string
  format: string
}): void {
  const captureAspect = info.captureW / Math.max(1, info.captureH)
  const physicalAspect = info.physicalW / Math.max(1, info.physicalH)
  const ratioOk = Math.abs(captureAspect - physicalAspect) < 0.02
  console.log(
    [
      'CAPTURE TRANSFORM',
      `displayId: ${info.displayId}`,
      `capture: ${info.captureW}x${info.captureH} (${info.format})`,
      `physical: ${info.physicalW}x${info.physicalH}`,
      `aspect capture=${captureAspect.toFixed(4)} physical=${physicalAspect.toFixed(4)} ok=${ratioOk}`,
      `scaleX=${(info.physicalW / Math.max(1, info.captureW)).toFixed(4)} scaleY=${(info.physicalH / Math.max(1, info.captureH)).toFixed(4)}`
    ].join('\n')
  )
  if (!ratioOk) {
    console.warn('CAPTURE TRANSFORM: aspect mismatch — image must not be stretched')
  }
}

/**
 * Center pointer mark for a match.
 * Bounds stay the full control rect so “mouse reached it” can dismiss;
 * the overlay paints a small glowing DOT at the center only.
 */
export function marksFromMatch(match: TargetMatch): AbsoluteMark[] {
  const raw = match.bounds
  return [
    {
      id: match.elementId || 'target',
      label: match.label,
      bounds: {
        x: Math.round(raw.x),
        y: Math.round(raw.y),
        width: Math.max(1, Math.round(raw.width)),
        height: Math.max(1, Math.round(raw.height))
      },
      style: 'circle'
    }
  ]
}
