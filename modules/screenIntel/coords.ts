import { screen } from 'electron'
import type { PhysicalRect } from '../shared/screenIntel'

/** Physical screen pixels → Electron DIP point (for BrowserWindow overlay). */
export function physicalToDipPoint(x: number, y: number): { x: number; y: number } {
  try {
    return screen.screenToDipPoint({ x, y })
  } catch {
    const sf = screen.getPrimaryDisplay().scaleFactor || 1
    return { x: x / sf, y: y / sf }
  }
}

/** Electron DIP → physical screen pixels (for SetCursorPos). */
export function dipToPhysicalPoint(x: number, y: number): { x: number; y: number } {
  try {
    return screen.dipToScreenPoint({ x, y })
  } catch {
    const sf = screen.getPrimaryDisplay().scaleFactor || 1
    return { x: x * sf, y: y * sf }
  }
}

export function physicalRectToDip(rect: PhysicalRect): PhysicalRect {
  const tl = physicalToDipPoint(rect.x, rect.y)
  const br = physicalToDipPoint(rect.x + rect.width, rect.y + rect.height)
  return {
    x: tl.x,
    y: tl.y,
    width: Math.max(1, br.x - tl.x),
    height: Math.max(1, br.y - tl.y)
  }
}

export function rectCenter(rect: PhysicalRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  }
}

/** Normalized capture box → physical screen via capture metadata. */
export function normalizedToPhysical(
  nx: number,
  ny: number,
  nw: number,
  nh: number,
  meta: {
    displayBounds?: { x: number; y: number; width: number; height: number }
    coordMap?: { offsetX: number; offsetY: number; width: number; height: number }
    scaleFactor: number
  }
): PhysicalRect {
  const bounds = meta.displayBounds ?? screen.getPrimaryDisplay().bounds
  const map = meta.coordMap ?? {
    offsetX: 0,
    offsetY: 0,
    width: bounds.width,
    height: bounds.height
  }
  const dipX = bounds.x + map.offsetX + nx * map.width
  const dipY = bounds.y + map.offsetY + ny * map.height
  const dipW = nw * map.width
  const dipH = nh * map.height
  const tl = dipToPhysicalPoint(dipX, dipY)
  const br = dipToPhysicalPoint(dipX + dipW, dipY + dipH)
  return {
    x: Math.round(tl.x),
    y: Math.round(tl.y),
    width: Math.max(1, Math.round(br.x - tl.x)),
    height: Math.max(1, Math.round(br.y - tl.y))
  }
}
