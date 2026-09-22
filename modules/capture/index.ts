import { desktopCapturer, screen } from 'electron'
import { randomUUID } from 'crypto'
import type { ScreenCapture } from '../shared'
import type { CaptureModule } from './types'
import { logCaptureTransform } from '../screenIntel/debugLog'

export { burnCoordinateGrid } from './gridOverlay'

export type CaptureOptions = {
  maxWidth?: number
  /** Prefer PNG for target localization (sharper icons) */
  preferPng?: boolean
}

function toDataUrl(image: Electron.NativeImage, preferPng = false): string {
  if (preferPng) {
    return `data:image/png;base64,${image.toPNG().toString('base64')}`
  }
  // Higher quality JPEG — tiny icons degrade badly at lower quality
  const jpeg = image.toJPEG(95)
  if (jpeg.length > 0) {
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  }
  return `data:image/png;base64,${image.toPNG().toString('base64')}`
}

/**
 * Scale uniformly (never stretch). Stretching breaks AI coordinate mapping.
 */
function scaleUniform(
  image: Electron.NativeImage,
  maxSide: number
): Electron.NativeImage {
  const { width, height } = image.getSize()
  const longest = Math.max(width, height)
  if (longest <= maxSide) return image
  const scale = maxSide / longest
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'best'
  })
}

function buildCoordMap(
  imageW: number,
  imageH: number,
  displayW: number,
  displayH: number
): NonNullable<ScreenCapture['coordMap']> {
  const imgAspect = imageW / Math.max(1, imageH)
  const dispAspect = displayW / Math.max(1, displayH)

  if (Math.abs(imgAspect - dispAspect) < 0.015) {
    return { offsetX: 0, offsetY: 0, width: displayW, height: displayH }
  }

  if (imgAspect > dispAspect) {
    const height = displayW / imgAspect
    return {
      offsetX: 0,
      offsetY: (displayH - height) / 2,
      width: displayW,
      height
    }
  }

  const width = displayH * imgAspect
  return {
    offsetX: (displayW - width) / 2,
    offsetY: 0,
    width,
    height: displayH
  }
}

function resolveTargetDisplay(preferredId?: string): Electron.Display {
  const displays = screen.getAllDisplays()
  if (preferredId) {
    const found = displays.find((d) => String(d.id) === preferredId)
    if (found) return found
  }
  return screen.getPrimaryDisplay()
}

/**
 * Display that contains the cursor, else the one with the largest work area
 * near the cursor (multi-monitor). Falls back to primary.
 */
export function getActiveDisplay(): Electron.Display {
  try {
    const point = screen.getCursorScreenPoint()
    return screen.getDisplayNearestPoint(point)
  } catch {
    return screen.getPrimaryDisplay()
  }
}

export function createCaptureService(): CaptureModule {
  async function capturePrimaryDisplay(maxWidth = 1920): Promise<ScreenCapture> {
    const primary = screen.getPrimaryDisplay()
    return captureDisplay(String(primary.id), maxWidth)
  }

  async function captureActiveDisplay(maxWidth = 1920): Promise<ScreenCapture> {
    const active = getActiveDisplay()
    return captureDisplay(String(active.id), maxWidth)
  }

  async function captureDisplay(
    displayId: string,
    maxWidth = 1920,
    options?: CaptureOptions
  ): Promise<ScreenCapture> {
    const target = resolveTargetDisplay(displayId)
    const preferPng = options?.preferPng ?? false

    const physicalW = Math.max(1, Math.round(target.size.width * target.scaleFactor))
    const physicalH = Math.max(1, Math.round(target.size.height * target.scaleFactor))
    const maxSide = Math.max(1280, maxWidth)

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: physicalW, height: physicalH }
    })

    const source =
      sources.find((s) => s.display_id === String(target.id)) ??
      sources.find((s) => s.id.includes(String(target.id))) ??
      sources[0]

    if (!source) {
      throw new Error('No screen source available for capture')
    }
    if (source.thumbnail.isEmpty()) {
      throw new Error('Screen capture came back empty. Check Windows screen-capture permissions.')
    }

    const rawSize = source.thumbnail.getSize()
    // Validate raw capture aspect vs expected physical — never stretch
    const rawAspect = rawSize.width / Math.max(1, rawSize.height)
    const physAspect = physicalW / Math.max(1, physicalH)
    if (Math.abs(rawAspect - physAspect) > 0.05) {
      console.warn(
        `Capture aspect mismatch: raw=${rawSize.width}x${rawSize.height} expected physical=${physicalW}x${physicalH}`
      )
    }

    const image = scaleUniform(source.thumbnail, maxSide)
    const size = image.getSize()
    const bounds = target.bounds
    const coordMap = buildCoordMap(size.width, size.height, bounds.width, bounds.height)

    const format = preferPng ? 'png' : 'jpeg'
    logCaptureTransform({
      captureW: size.width,
      captureH: size.height,
      physicalW,
      physicalH,
      displayId: String(target.id),
      format
    })

    return {
      id: randomUUID(),
      dataUrl: toDataUrl(image, preferPng),
      width: size.width,
      height: size.height,
      displayId: String(target.id),
      capturedAt: new Date().toISOString(),
      displayBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      },
      coordMap
    }
  }

  return {
    capturePrimaryDisplay,
    captureActiveDisplay,
    captureDisplay
  }
}

export type { CaptureModule } from './types'
