import { nativeImage } from 'electron'
import type { PrivacyZone, ScreenCapture } from '../shared'
import { DEFAULT_PRIVACY_ZONES } from '../shared'

export type PrivacyModule = {
  applyBlur(capture: ScreenCapture, zones?: PrivacyZone[]): ScreenCapture
  getDefaultZones(): PrivacyZone[]
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * Redact/blur normalized zones before a screenshot is sent to the AI.
 * Uses downscale→upscale for a soft privacy blur.
 */
export function createPrivacyService(): PrivacyModule {
  function getDefaultZones(): PrivacyZone[] {
    return DEFAULT_PRIVACY_ZONES.map((z) => ({ ...z }))
  }

  function applyBlur(capture: ScreenCapture, zones = getDefaultZones()): ScreenCapture {
    if (zones.length === 0) {
      return { ...capture, privacyApplied: false }
    }

    let image = nativeImage.createFromDataURL(capture.dataUrl)
    if (image.isEmpty()) {
      return capture
    }

    for (const zone of zones) {
      const { width, height } = image.getSize()
      const x0 = Math.floor(clamp01(zone.x) * width)
      const y0 = Math.floor(clamp01(zone.y) * height)
      const x1 = Math.min(width, Math.ceil(clamp01(zone.x + zone.width) * width))
      const y1 = Math.min(height, Math.ceil(clamp01(zone.y + zone.height) * height))
      if (x1 <= x0 || y1 <= y0) continue

      const zw = x1 - x0
      const zh = y1 - y0
      const crop = image.crop({ x: x0, y: y0, width: zw, height: zh })
      const tinyW = Math.max(2, Math.floor(zw / 16))
      const tinyH = Math.max(2, Math.floor(zh / 16))
      const blurred = crop
        .resize({ width: tinyW, height: tinyH })
        .resize({ width: zw, height: zh, quality: 'better' })

      // Composite by rebuilding full image: draw original, then overlay blurred crop via bitmap copy
      const full = Buffer.from(image.toBitmap())
      const patch = blurred.toBitmap()
      const stride = width * 4
      for (let row = 0; row < zh; row++) {
        const dest = (y0 + row) * stride + x0 * 4
        const src = row * zw * 4
        patch.copy(full, dest, src, zw * 4)
      }
      image = nativeImage.createFromBitmap(full, { width, height })
    }

    const jpeg = image.toJPEG(85)
    const dataUrl =
      jpeg.length > 0
        ? `data:image/jpeg;base64,${jpeg.toString('base64')}`
        : `data:image/png;base64,${image.toPNG().toString('base64')}`

    return {
      ...capture,
      dataUrl,
      privacyApplied: true
    }
  }

  return {
    applyBlur,
    getDefaultZones
  }
}
