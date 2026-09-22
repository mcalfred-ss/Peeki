import { nativeImage, screen } from 'electron'
import { randomUUID } from 'crypto'
import type { ScreenCapture, ScreenHighlight } from '../shared'

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * Crop a zoomed region around a rough highlight for a second-pass pinpoint.
 */
export function cropAroundHighlight(
  capture: ScreenCapture,
  highlight: ScreenHighlight,
  pad = 0.1
): {
  dataUrl: string
  width: number
  height: number
  /** Full-image normalized origin of the crop */
  originX: number
  originY: number
  /** Full-image normalized size of the crop */
  scaleX: number
  scaleY: number
} | null {
  const image = nativeImage.createFromDataURL(capture.dataUrl)
  if (image.isEmpty()) return null

  const { width: iw, height: ih } = image.getSize()
  const cx = highlight.x + highlight.width / 2
  const cy = highlight.y + highlight.height / 2
  const half = Math.max(highlight.width, highlight.height) / 2 + pad
  const side = clamp(half * 2, 0.12, 0.45)

  const originX = clamp(cx - side / 2, 0, 1 - side)
  const originY = clamp(cy - side / 2, 0, 1 - side)

  const x0 = Math.floor(originX * iw)
  const y0 = Math.floor(originY * ih)
  const cw = Math.max(32, Math.floor(side * iw))
  const ch = Math.max(32, Math.floor(side * ih))
  const width = Math.min(cw, iw - x0)
  const height = Math.min(ch, ih - y0)
  if (width < 32 || height < 32) return null

  const crop = image.crop({ x: x0, y: y0, width, height })
  // Upscale small crops so the model can see icon details
  const target = 768
  const longest = Math.max(width, height)
  const scaled =
    longest < target
      ? crop.resize({
          width: Math.round((width / longest) * target),
          height: Math.round((height / longest) * target),
          quality: 'best'
        })
      : crop

  // PNG preferred for tiny-target localization (icons, thin bars)
  const png = scaled.toPNG()
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const size = scaled.getSize()

  return {
    dataUrl,
    width: size.width,
    height: size.height,
    originX,
    originY,
    scaleX: side,
    scaleY: side
  }
}

export function mapCropPointToFull(
  cropCx: number,
  cropCy: number,
  crop: { originX: number; originY: number; scaleX: number; scaleY: number },
  boxW = 0.035,
  boxH = 0.05
): ScreenHighlight {
  const cx = clamp(crop.originX + clamp(cropCx, 0, 1) * crop.scaleX, 0, 1)
  const cy = clamp(crop.originY + clamp(cropCy, 0, 1) * crop.scaleY, 0, 1)
  const width = Math.min(boxW, 1 - (cx - boxW / 2))
  const height = Math.min(boxH, 1 - (cy - boxH / 2))
  const x = clamp(cx - width / 2, 0, 1 - width)
  const y = clamp(cy - height / 2, 0, 1 - height)
  return {
    id: randomUUID(),
    x,
    y,
    width,
    height
  }
}

export type PhysicalCropResult = {
  dataUrl: string
  /** Crop pixel size */
  width: number
  height: number
  /** Normalized origin/size within full capture (0..1) */
  originX: number
  originY: number
  scaleX: number
  scaleY: number
}

function physicalToDip(x: number, y: number): { x: number; y: number } {
  try {
    return screen.screenToDipPoint({ x, y })
  } catch {
    const sf = screen.getPrimaryDisplay().scaleFactor || 1
    return { x: x / sf, y: y / sf }
  }
}

/**
 * Crop a physical-screen rectangle from a capture using the capture↔display transform.
 * Prefers PNG so tiny icons stay sharp for localization.
 */
export function cropPhysicalRegion(
  capture: ScreenCapture,
  physical: { x: number; y: number; width: number; height: number },
  padPx = 24
): PhysicalCropResult | null {
  const image = nativeImage.createFromDataURL(capture.dataUrl)
  if (image.isEmpty()) return null

  const { width: iw, height: ih } = image.getSize()
  const bounds = capture.displayBounds ?? screen.getPrimaryDisplay().bounds
  const map = capture.coordMap ?? {
    offsetX: 0,
    offsetY: 0,
    width: bounds.width,
    height: bounds.height
  }

  const tl = physicalToDip(physical.x, physical.y)
  const br = physicalToDip(physical.x + physical.width, physical.y + physical.height)

  const relX = (tl.x - bounds.x - map.offsetX) / Math.max(1, map.width)
  const relY = (tl.y - bounds.y - map.offsetY) / Math.max(1, map.height)
  const relW = (br.x - tl.x) / Math.max(1, map.width)
  const relH = (br.y - tl.y) / Math.max(1, map.height)

  const padN = padPx / Math.max(iw, ih)
  const originX = clamp(relX - padN, 0, 0.95)
  const originY = clamp(relY - padN, 0, 0.95)
  const scaleX = clamp(relW + padN * 2, 0.08, 1 - originX)
  const scaleY = clamp(relH + padN * 2, 0.08, 1 - originY)

  const x0 = Math.floor(originX * iw)
  const y0 = Math.floor(originY * ih)
  const width = Math.max(32, Math.min(iw - x0, Math.floor(scaleX * iw)))
  const height = Math.max(32, Math.min(ih - y0, Math.floor(scaleY * ih)))
  if (width < 32 || height < 32) return null

  const crop = image.crop({ x: x0, y: y0, width, height })
  const target = 768
  const longest = Math.max(width, height)
  const scaled =
    longest < target
      ? crop.resize({
          width: Math.round((width / longest) * target),
          height: Math.round((height / longest) * target),
          quality: 'best'
        })
      : crop

  const png = scaled.toPNG()
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const size = scaled.getSize()

  return {
    dataUrl,
    width: size.width,
    height: size.height,
    originX,
    originY,
    scaleX,
    scaleY
  }
}
