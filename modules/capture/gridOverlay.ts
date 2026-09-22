import { nativeImage } from 'electron'
import type { ScreenCapture } from '../shared'

/**
 * Burn a light 10×10 grid into a copy of the screenshot so the vision model
 * can ground normalized coordinates more accurately.
 * (Does not change what the user sees — only the image sent to the AI.)
 */
export function burnCoordinateGrid(capture: ScreenCapture): ScreenCapture {
  let image = nativeImage.createFromDataURL(capture.dataUrl)
  if (image.isEmpty()) return capture

  const { width, height } = image.getSize()
  if (width < 40 || height < 40) return capture

  // Windows bitmaps from Electron are BGRA, premultiplied=false typically
  const bitmap = Buffer.from(image.toBitmap())
  const stride = width * 4

  function plot(x: number, y: number, a = 160): void {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = y * stride + x * 4
    // Mix toward cyan-ish (B,G,R)
    bitmap[i] = Math.min(255, bitmap[i] + Math.floor((255 - bitmap[i]) * (a / 255) * 0.7)) // B
    bitmap[i + 1] = Math.min(255, bitmap[i + 1] + Math.floor((220 - bitmap[i + 1]) * (a / 255))) // G
    bitmap[i + 2] = Math.min(255, Math.floor(bitmap[i + 2] * (1 - a / 400))) // R
  }

  function vLine(x: number, strong: boolean): void {
    const xi = Math.max(0, Math.min(width - 1, Math.round(x)))
    const a = strong ? 200 : 110
    for (let y = 0; y < height; y += 1) {
      plot(xi, y, a)
      if (strong && xi + 1 < width) plot(xi + 1, y, 90)
    }
  }

  function hLine(y: number, strong: boolean): void {
    const yi = Math.max(0, Math.min(height - 1, Math.round(y)))
    const a = strong ? 200 : 110
    for (let x = 0; x < width; x += 1) {
      plot(x, yi, a)
      if (strong && yi + 1 < height) plot(x, yi + 1, 90)
    }
  }

  for (let i = 1; i < 10; i += 1) {
    const strong = i === 5
    vLine((i / 10) * width, strong)
    hLine((i / 10) * height, strong)
  }

  // Outer frame
  vLine(0, true)
  vLine(width - 1, true)
  hLine(0, true)
  hLine(height - 1, true)

  // Corner ticks so (0,0) / (1,1) are obvious
  for (let t = 0; t < 12; t += 1) {
    plot(t, 0, 220)
    plot(0, t, 220)
    plot(width - 1 - t, height - 1, 220)
    plot(width - 1, height - 1 - t, 220)
  }

  image = nativeImage.createFromBitmap(bitmap, { width, height })
  const jpeg = image.toJPEG(92)
  const dataUrl =
    jpeg.length > 0
      ? `data:image/jpeg;base64,${jpeg.toString('base64')}`
      : `data:image/png;base64,${image.toPNG().toString('base64')}`

  return {
    ...capture,
    dataUrl,
    width: image.getSize().width,
    height: image.getSize().height
  }
}
