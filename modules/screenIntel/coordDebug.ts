/**
 * Temporary coordinate-pipeline diagnostics for pointing accuracy.
 * Logs every transform stage and can emit dual markers (physical vs DIP interpretation).
 */
import { screen, type BrowserWindow } from 'electron'
import type { AbsoluteMark, PhysicalRect } from '../shared/screenIntel'

export type CoordDebugSnapshot = {
  label: string
  uiaBounds: PhysicalRect
  display: {
    id: number
    bounds: Electron.Rectangle
    size: { width: number; height: number }
    scaleFactor: number
  }
  physicalCorners: {
    topLeft: { x: number; y: number }
    topRight: { x: number; y: number }
    bottomLeft: { x: number; y: number }
    bottomRight: { x: number; y: number }
    center: { x: number; y: number }
  }
  afterDip: {
    topLeft: { x: number; y: number }
    topRight: { x: number; y: number }
    bottomLeft: { x: number; y: number }
    bottomRight: { x: number; y: number }
    center: { x: number; y: number }
  }
  /** Same numbers treated as already-DIP (no screenToDipPoint) */
  asIfAlreadyDip: {
    topLeft: { x: number; y: number }
    center: { x: number; y: number }
    width: number
    height: number
  }
  overlayWindow: { x: number; y: number; width: number; height: number }
  overlayLocal: { left: number; top: number; width: number; height: number }
  overlayLocalIfAlreadyDip: { left: number; top: number; width: number; height: number }
  roundTripPhysical: { x: number; y: number }
  scaleFactorAtCenter: number
}

function pt(x: number, y: number): { x: number; y: number } {
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
}

function toDip(x: number, y: number): { x: number; y: number } {
  try {
    return screen.screenToDipPoint({ x, y })
  } catch {
    const sf = screen.getPrimaryDisplay().scaleFactor || 1
    return { x: x / sf, y: y / sf }
  }
}

function toPhysical(x: number, y: number): { x: number; y: number } {
  try {
    return screen.dipToScreenPoint({ x, y })
  } catch {
    const sf = screen.getPrimaryDisplay().scaleFactor || 1
    return { x: x * sf, y: y * sf }
  }
}

/**
 * Full target coordinate dump. Call from the highlight paint path.
 */
export function buildAndLogTargetCoordDebug(options: {
  label: string
  /** Bounds as stored on AbsoluteMark (claimed physical) */
  bounds: PhysicalRect
  overlayArea: { x: number; y: number; width: number; height: number }
  win?: BrowserWindow | null
}): CoordDebugSnapshot {
  const b = options.bounds
  const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  const display = screen.getDisplayNearestPoint({ x: center.x, y: center.y })

  // NOTE: getDisplayNearestPoint expects DIP in Electron docs — if bounds are physical
  // this nearest-display lookup itself may be wrong. Log both attempts.
  const displayByDipGuess = screen.getDisplayNearestPoint(toDip(center.x, center.y))

  const physicalCorners = {
    topLeft: pt(b.x, b.y),
    topRight: pt(b.x + b.width, b.y),
    bottomLeft: pt(b.x, b.y + b.height),
    bottomRight: pt(b.x + b.width, b.y + b.height),
    center: pt(center.x, center.y)
  }

  const dipTl = toDip(b.x, b.y)
  const dipTr = toDip(b.x + b.width, b.y)
  const dipBl = toDip(b.x, b.y + b.height)
  const dipBr = toDip(b.x + b.width, b.y + b.height)
  const dipC = toDip(center.x, center.y)

  const afterDip = {
    topLeft: pt(dipTl.x, dipTl.y),
    topRight: pt(dipTr.x, dipTr.y),
    bottomLeft: pt(dipBl.x, dipBl.y),
    bottomRight: pt(dipBr.x, dipBr.y),
    center: pt(dipC.x, dipC.y)
  }

  const area = options.overlayArea
  const dipW = dipBr.x - dipTl.x
  const dipH = dipBr.y - dipTl.y
  const overlayLocal = {
    left: dipTl.x - area.x,
    top: dipTl.y - area.y,
    width: Math.max(1, dipW),
    height: Math.max(1, dipH)
  }

  const asIfAlreadyDip = {
    topLeft: pt(b.x, b.y),
    center: pt(center.x, center.y),
    width: b.width,
    height: b.height
  }
  const overlayLocalIfAlreadyDip = {
    left: b.x - area.x,
    top: b.y - area.y,
    width: Math.max(1, b.width),
    height: Math.max(1, b.height)
  }

  const roundTrip = toPhysical(dipC.x, dipC.y)

  let winBounds = area
  if (options.win && !options.win.isDestroyed()) {
    winBounds = options.win.getBounds()
  }

  const snapshot: CoordDebugSnapshot = {
    label: options.label,
    uiaBounds: { ...b },
    display: {
      id: display.id,
      bounds: display.bounds,
      size: { width: display.size.width, height: display.size.height },
      scaleFactor: display.scaleFactor
    },
    physicalCorners,
    afterDip,
    asIfAlreadyDip,
    overlayWindow: {
      x: winBounds.x,
      y: winBounds.y,
      width: winBounds.width,
      height: winBounds.height
    },
    overlayLocal: {
      left: Math.round(overlayLocal.left * 100) / 100,
      top: Math.round(overlayLocal.top * 100) / 100,
      width: Math.round(overlayLocal.width * 100) / 100,
      height: Math.round(overlayLocal.height * 100) / 100
    },
    overlayLocalIfAlreadyDip: {
      left: Math.round(overlayLocalIfAlreadyDip.left * 100) / 100,
      top: Math.round(overlayLocalIfAlreadyDip.top * 100) / 100,
      width: Math.round(overlayLocalIfAlreadyDip.width * 100) / 100,
      height: Math.round(overlayLocalIfAlreadyDip.height * 100) / 100
    },
    roundTripPhysical: pt(roundTrip.x, roundTrip.y),
    scaleFactorAtCenter: display.scaleFactor
  }

  const lines = [
    '=== PEEKI TARGET DEBUG ===',
    '',
    'Target:',
    options.label,
    '',
    'UIA bounds (as stored on AbsoluteMark — claimed physical):',
    `x: ${b.x}`,
    `y: ${b.y}`,
    `width: ${b.width}`,
    `height: ${b.height}`,
    '',
    'Display (via getDisplayNearestPoint on raw center — may be wrong if raw is physical):',
    `id: ${display.id}`,
    `bounds: ${JSON.stringify(display.bounds)}  ← Electron DIP`,
    `size: ${JSON.stringify(display.size)}  ← Electron DIP`,
    `scaleFactor: ${display.scaleFactor}`,
    `scaleFactorX: ${display.scaleFactor} (Electron exposes one factor)`,
    `scaleFactorY: ${display.scaleFactor}`,
    `displayByDipGuess.id: ${displayByDipGuess.id} scale=${displayByDipGuess.scaleFactor}`,
    '',
    'Physical coordinates (interpreting UIA as physical pixels):',
    `topLeft: ${JSON.stringify(physicalCorners.topLeft)}`,
    `topRight: ${JSON.stringify(physicalCorners.topRight)}`,
    `bottomLeft: ${JSON.stringify(physicalCorners.bottomLeft)}`,
    `bottomRight: ${JSON.stringify(physicalCorners.bottomRight)}`,
    `center: ${JSON.stringify(physicalCorners.center)}`,
    '',
    'After physical → DIP conversion (screenToDipPoint):',
    `topLeft: ${JSON.stringify(afterDip.topLeft)}`,
    `topRight: ${JSON.stringify(afterDip.topRight)}`,
    `bottomLeft: ${JSON.stringify(afterDip.bottomLeft)}`,
    `bottomRight: ${JSON.stringify(afterDip.bottomRight)}`,
    `center: ${JSON.stringify(afterDip.center)}`,
    '',
    'If UIA were ALREADY DIP (skip screenToDipPoint):',
    `topLeft: ${JSON.stringify(asIfAlreadyDip.topLeft)}`,
    `center: ${JSON.stringify(asIfAlreadyDip.center)}`,
    `size: ${asIfAlreadyDip.width}x${asIfAlreadyDip.height}`,
    '',
    'Overlay window (BrowserWindow.getBounds — Electron DIP):',
    `x: ${winBounds.x}`,
    `y: ${winBounds.y}`,
    `width: ${winBounds.width}`,
    `height: ${winBounds.height}`,
    `setArea: ${JSON.stringify(area)}`,
    '',
    'Final overlay-local coordinates (current path: DIP − overlay origin):',
    `left: ${snapshot.overlayLocal.left}`,
    `top: ${snapshot.overlayLocal.top}`,
    `width: ${snapshot.overlayLocal.width}`,
    `height: ${snapshot.overlayLocal.height}`,
    '',
    'Final overlay-local IF UIA already DIP:',
    `left: ${snapshot.overlayLocalIfAlreadyDip.left}`,
    `top: ${snapshot.overlayLocalIfAlreadyDip.top}`,
    `width: ${snapshot.overlayLocalIfAlreadyDip.width}`,
    `height: ${snapshot.overlayLocalIfAlreadyDip.height}`,
    '',
    'Final CSS (current path — what renderer will set):',
    `left: ${snapshot.overlayLocal.left}px`,
    `top: ${snapshot.overlayLocal.top}px`,
    `width: ${snapshot.overlayLocal.width}px`,
    `height: ${snapshot.overlayLocal.height}px`,
    '',
    'Round-trip check: screenToDipPoint(center) → dipToScreenPoint:',
    `got: ${JSON.stringify(snapshot.roundTripPhysical)}`,
    `expected UIA center: ${JSON.stringify(physicalCorners.center)}`,
    `delta: dx=${(snapshot.roundTripPhysical.x - center.x).toFixed(1)} dy=${(snapshot.roundTripPhysical.y - center.y).toFixed(1)}`,
    '',
    'Coordinate system legend:',
    '1. UIA AbsoluteMark.bounds — ASSUMED physical screen pixels (needs verification)',
    '2. screenToDipPoint output — Windows/Electron logical DIP',
    '3. BrowserWindow bounds/position — Electron DIP',
    '4. CSS left/top in highlight renderer — CSS px (1:1 with DIP in Electron)',
    '',
    '=========================='
  ]

  console.log(lines.join('\n'))
  return snapshot
}

/**
 * Build dual debug marks so we can SEE which interpretation is correct:
 * - style rect + label "A-phys": current path (treat UIA as physical → DIP)
 * - style circle + label "B-dip": treat UIA numbers as already DIP
 *
 * If B lands on the icon and A does not → UIA is returning DIP and we must NOT call screenToDipPoint.
 * If A lands on the icon and B does not → conversion is correct; offset is elsewhere.
 * If neither lands on the icon → UIA bounds themselves are wrong.
 */
export function buildDualDebugMarks(rawBounds: PhysicalRect, label: string): AbsoluteMark[] {
  const cx = Math.round(rawBounds.x + rawBounds.width / 2)
  const cy = Math.round(rawBounds.y + rawBounds.height / 2)
  return [
    {
      id: 'debug-a-physical-path',
      label: `A-phys:${label}`,
      bounds: rawBounds,
      style: 'rect'
    },
    {
      id: 'debug-b-already-dip',
      label: `B-dip:${label}`,
      // Encode "already DIP" by storing DIP coords in a mark that paint() will
      // interpret with a special id — see highlights.ts paint().
      bounds: rawBounds,
      style: 'circle'
    },
    {
      id: 'debug-center-raw',
      label: undefined,
      bounds: { x: cx - 6, y: cy - 6, width: 12, height: 12 },
      style: 'circle'
    }
  ]
}
