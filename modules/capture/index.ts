import { desktopCapturer, screen } from 'electron'
import { randomUUID } from 'crypto'
import type { ScreenCapture } from '../shared'
import type { CaptureModule } from './types'

function scaleToMaxWidth(
  width: number,
  height: number,
  maxWidth: number
): { width: number; height: number } {
  if (width <= maxWidth) {
    return { width, height }
  }
  const scale = maxWidth / width
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale)
  }
}

/**
 * Prefer JPEG for smaller payloads (faster upload). Fall back to PNG if needed.
 */
function toDataUrl(image: Electron.NativeImage): string {
  const jpeg = image.toJPEG(85)
  if (jpeg.length > 0) {
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  }
  const png = image.toPNG()
  return `data:image/png;base64,${png.toString('base64')}`
}

export function createCaptureService(): CaptureModule {
  async function capturePrimaryDisplay(maxWidth = 1280): Promise<ScreenCapture> {
    const primary = screen.getPrimaryDisplay()
    return captureDisplay(String(primary.id), maxWidth)
  }

  async function captureDisplay(displayId: string, maxWidth = 1280): Promise<ScreenCapture> {
    const displays = screen.getAllDisplays()
    const target =
      displays.find((d) => String(d.id) === displayId) ?? screen.getPrimaryDisplay()

    // Capture at a sharp working size for UI text, without sending a 4K monster image
    const { width, height } = scaleToMaxWidth(
      target.size.width * target.scaleFactor,
      target.size.height * target.scaleFactor,
      maxWidth
    )

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
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

    const dataUrl = toDataUrl(source.thumbnail)
    const size = source.thumbnail.getSize()

    return {
      id: randomUUID(),
      dataUrl,
      width: size.width,
      height: size.height,
      displayId: String(target.id),
      capturedAt: new Date().toISOString()
    }
  }

  return {
    capturePrimaryDisplay,
    captureDisplay
  }
}

export type { CaptureModule } from './types'
