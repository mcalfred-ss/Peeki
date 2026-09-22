import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import type { AbsoluteMark, HighlightsShowPayload, ScreenHighlight } from '@modules/shared'
import { buildAndLogTargetCoordDebug } from '../../modules/screenIntel/coordDebug'

export type HighlightController = {
  show: (payload: HighlightsShowPayload) => void
  setStep: (stepIndex: number) => void
  hide: () => void
  concealForCapture: () => void
  revealAfterCapture: () => void
  destroy: () => void
  isVisible: () => boolean
}

type HighlightRenderState = {
  highlights: ScreenHighlight[]
  absoluteMarks: AbsoluteMark[]
  stepIndex?: number
  debugOverlay?: boolean
}

type DipMark = {
  id?: string
  left: number
  top: number
  width: number
  height: number
  label?: string
  style: 'rect' | 'circle' | 'arrow'
  /** Debug only — which interpretation */
  debugKind?: 'a-physical' | 'b-already-dip' | 'normal'
}

function physicalToDipRect(mark: AbsoluteMark): {
  left: number
  top: number
  width: number
  height: number
  label?: string
  style: 'rect' | 'circle' | 'arrow'
} {
  const b = mark.bounds
  let tl: { x: number; y: number }
  let br: { x: number; y: number }
  try {
    tl = screen.screenToDipPoint({ x: b.x, y: b.y })
    br = screen.screenToDipPoint({ x: b.x + b.width, y: b.y + b.height })
  } catch {
    const sf = screen.getPrimaryDisplay().scaleFactor || 1
    tl = { x: b.x / sf, y: b.y / sf }
    br = { x: (b.x + b.width) / sf, y: (b.y + b.height) / sf }
  }
  return {
    left: tl.x,
    top: tl.y,
    width: Math.max(1, br.x - tl.x),
    height: Math.max(1, br.y - tl.y),
    label: mark.label,
    style: mark.style ?? 'rect'
  }
}

/** Treat AbsoluteMark.bounds as already-DIP (skip screenToDipPoint). */
function alreadyDipRect(mark: AbsoluteMark): {
  left: number
  top: number
  width: number
  height: number
  label?: string
  style: 'rect' | 'circle' | 'arrow'
} {
  const b = mark.bounds
  return {
    left: b.x,
    top: b.y,
    width: Math.max(1, b.width),
    height: Math.max(1, b.height),
    label: mark.label,
    style: mark.style ?? 'rect'
  }
}

function virtualDesktopDipBounds(): { x: number; y: number; width: number; height: number } {
  const displays = screen.getAllDisplays()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x)
    minY = Math.min(minY, d.bounds.y)
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width)
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height)
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  }
}

export function createHighlightController(): HighlightController {
  let win: BrowserWindow | null = null
  let hideTimer: NodeJS.Timeout | null = null
  let reachTimer: NodeJS.Timeout | null = null
  let reachArmedAt = 0
  let lastPayload: HighlightRenderState | null = null
  let lastDisplayBounds: HighlightsShowPayload['displayBounds']
  let lastCoordMap: HighlightsShowPayload['coordMap']
  let wasVisibleBeforeCapture = false

  /** Brief flash so the tip is visible before reach-to-dismiss arms */
  const REACH_GRACE_MS = 400
  const REACH_POLL_MS = 50
  /** Minimum hit box around the target center (DIP) */
  const MIN_HIT_HALF_DIP = 22

  function clearTimer(): void {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  function clearReachWatch(): void {
    if (reachTimer) {
      clearInterval(reachTimer)
      reachTimer = null
    }
  }

  function physicalBoundsToDip(bounds: AbsoluteMark['bounds']): {
    left: number
    top: number
    right: number
    bottom: number
  } {
    let tl: { x: number; y: number }
    let br: { x: number; y: number }
    try {
      tl = screen.screenToDipPoint({ x: bounds.x, y: bounds.y })
      br = screen.screenToDipPoint({
        x: bounds.x + bounds.width,
        y: bounds.y + bounds.height
      })
    } catch {
      const sf = screen.getPrimaryDisplay().scaleFactor || 1
      tl = { x: bounds.x / sf, y: bounds.y / sf }
      br = {
        x: (bounds.x + bounds.width) / sf,
        y: (bounds.y + bounds.height) / sf
      }
    }
    return {
      left: Math.min(tl.x, br.x),
      top: Math.min(tl.y, br.y),
      right: Math.max(tl.x, br.x),
      bottom: Math.max(tl.y, br.y)
    }
  }

  function cursorHitsAbsolute(cursor: { x: number; y: number }, mark: AbsoluteMark): boolean {
    if (mark.id.startsWith('debug-')) return false
    const box = physicalBoundsToDip(mark.bounds)
    const cx = (box.left + box.right) / 2
    const cy = (box.top + box.bottom) / 2
    const halfW = Math.max(MIN_HIT_HALF_DIP, (box.right - box.left) / 2) + 8
    const halfH = Math.max(MIN_HIT_HALF_DIP, (box.bottom - box.top) / 2) + 8
    return (
      cursor.x >= cx - halfW &&
      cursor.x <= cx + halfW &&
      cursor.y >= cy - halfH &&
      cursor.y <= cy + halfH
    )
  }

  function cursorHitsNormalized(
    cursor: { x: number; y: number },
    h: ScreenHighlight
  ): boolean {
    const area = lastDisplayBounds ?? virtualDesktopDipBounds()
    const map = lastCoordMap ?? {
      offsetX: 0,
      offsetY: 0,
      width: area.width,
      height: area.height
    }
    const left = area.x + map.offsetX + h.x * map.width
    const top = area.y + map.offsetY + h.y * map.height
    const width = Math.max(1, h.width * map.width)
    const height = Math.max(1, h.height * map.height)
    const cx = left + width / 2
    const cy = top + height / 2
    const halfW = Math.max(MIN_HIT_HALF_DIP, width / 2) + 8
    const halfH = Math.max(MIN_HIT_HALF_DIP, height / 2) + 8
    return (
      cursor.x >= cx - halfW &&
      cursor.x <= cx + halfW &&
      cursor.y >= cy - halfH &&
      cursor.y <= cy + halfH
    )
  }

  function cursorReachedTarget(): boolean {
    if (!lastPayload) return false
    const cursor = screen.getCursorScreenPoint()
    for (const m of lastPayload.absoluteMarks) {
      if (cursorHitsAbsolute(cursor, m)) return true
    }
    if (lastPayload.absoluteMarks.length > 0) return false
    for (const h of lastPayload.highlights) {
      if (cursorHitsNormalized(cursor, h)) return true
    }
    return false
  }

  function startReachWatch(): void {
    clearReachWatch()
    reachArmedAt = Date.now()
    reachTimer = setInterval(() => {
      if (!lastPayload) {
        clearReachWatch()
        return
      }
      if (Date.now() - reachArmedAt < REACH_GRACE_MS) return
      if (cursorReachedTarget()) {
        hide()
      }
    }, REACH_POLL_MS)
  }

  function ensureWindow(): BrowserWindow {
    if (win && !win.isDestroyed()) return win

    const area = screen.getPrimaryDisplay().bounds

    win = new BrowserWindow({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      focusable: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true, { forward: true })
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/highlight.html`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/highlight.html'))
    }

    win.on('closed', () => {
      win = null
    })

    return win
  }

  function paint(state: HighlightRenderState): void {
    const bar = ensureWindow()
    const area = virtualDesktopDipBounds()
    bar.setBounds(area)

    const filteredNorm =
      typeof state.stepIndex === 'number'
        ? state.highlights.filter(
            (h) => h.stepIndex === undefined || h.stepIndex === state.stepIndex
          )
        : state.highlights

    const map = lastCoordMap ?? {
      offsetX: 0,
      offsetY: 0,
      width: lastDisplayBounds?.width ?? area.width,
      height: lastDisplayBounds?.height ?? area.height
    }

    // Primary rect mark for full debug dump (developer mode only)
    const primary =
      state.absoluteMarks.find((m) => (m.style ?? 'rect') === 'rect' && !m.id.startsWith('debug-')) ??
      state.absoluteMarks.find((m) => !m.id.startsWith('debug-')) ??
      state.absoluteMarks[0]

    const debug = Boolean(state.debugOverlay)

    if (debug && primary) {
      buildAndLogTargetCoordDebug({
        label: primary.label || primary.id,
        bounds: primary.bounds,
        overlayArea: area,
        win: bar
      })
    }

    const absoluteDip: DipMark[] = []

    for (const m of state.absoluteMarks) {
      // Skip debug-only marks in production UI
      if (!debug && (m.id.startsWith('debug-') || m.label?.startsWith('B-dip') || m.label?.startsWith('A-phys'))) {
        continue
      }

      // User-facing pointer is always a center DOT (full bounds kept for reach-to-dismiss)
      let mark = m
      if (!debug) {
        const cx = m.bounds.x + m.bounds.width / 2
        const cy = m.bounds.y + m.bounds.height / 2
        const d = 22
        mark = {
          ...m,
          style: 'circle',
          bounds: {
            x: Math.round(cx - d / 2),
            y: Math.round(cy - d / 2),
            width: d,
            height: d
          }
        }
      }

      // Dual-debug: B marks skip physical→DIP (treat UIA as already DIP)
      if (debug && (mark.id === 'debug-b-already-dip' || mark.id.startsWith('debug-b-'))) {
        const r = alreadyDipRect(mark)
        absoluteDip.push({
          ...r,
          left: r.left - area.x,
          top: r.top - area.y,
          debugKind: 'b-already-dip'
        })
        continue
      }

      const r = physicalToDipRect(mark)
      absoluteDip.push({
        id: mark.id,
        ...r,
        left: r.left - area.x,
        top: r.top - area.y,
        debugKind:
          debug && (mark.id === 'debug-a-physical-path' || mark.id.startsWith('debug-a-'))
            ? 'a-physical'
            : 'normal'
      })
    }

    // Normalized vision boxes → center dots (unless debug)
    const paintNorm = debug
      ? filteredNorm
      : filteredNorm.map((h) => {
          const cx = h.x + h.width / 2
          const cy = h.y + h.height / 2
          const s = 0.018
          return {
            ...h,
            x: cx - s / 2,
            y: cy - s / 2,
            width: s,
            height: s
          }
        })

    // A/B diagnostic marker only in developer debug mode
    if (debug && primary && !state.absoluteMarks.some((m) => m.id.startsWith('debug-b-'))) {
      const half = Math.max(7, Math.min(14, primary.bounds.width * 0.2))
      absoluteDip.push({
        left: primary.bounds.x + primary.bounds.width / 2 - half - area.x,
        top: primary.bounds.y + primary.bounds.height / 2 - half - area.y,
        width: half * 2,
        height: half * 2,
        label: 'B-dip',
        style: 'circle',
        debugKind: 'b-already-dip'
      })
    }

    if (debug) {
      console.log(
        [
          '=== PEEKI OVERLAY PAINT ===',
          `marks: ${absoluteDip.length}`,
          ...absoluteDip.map(
            (m) =>
              `  [${m.debugKind || m.style}] label=${m.label ?? '-'} CSS left=${m.left.toFixed(1)} top=${m.top.toFixed(1)} w=${m.width.toFixed(1)} h=${m.height.toFixed(1)}`
          ),
          '==========================='
        ].join('\n')
      )
    }

    const send = (): void => {
      if (bar.isDestroyed()) return
      if (debug) {
        void bar.webContents
          .executeJavaScript(
            `({ dpr: window.devicePixelRatio, iw: window.innerWidth, ih: window.innerHeight })`
          )
          .then((info: { dpr: number; iw: number; ih: number }) => {
            console.log(
              `=== PEEKI RENDERER METRICS ===\ndevicePixelRatio: ${info.dpr}\ninnerWidth: ${info.iw}\ninnerHeight: ${info.ih}\noverlayArea: ${area.width}x${area.height}\n==============================`
            )
          })
          .catch(() => {
            // ignore
          })
      }

      bar.webContents.send('highlights:paint', {
        highlights: paintNorm,
        display: { width: area.width, height: area.height },
        coordMap: map,
        displayOrigin: {
          x: lastDisplayBounds?.x ?? area.x,
          y: lastDisplayBounds?.y ?? area.y
        },
        absoluteMarks: absoluteDip,
        debugOverlay: debug,
        pointerMode: 'dot'
      })
    }

    if (bar.webContents.isLoadingMainFrame()) {
      bar.webContents.once('did-finish-load', send)
    } else {
      send()
    }

    if (!bar.isVisible()) {
      bar.showInactive()
    }
  }

  function show(payload: HighlightsShowPayload): void {
    clearTimer()
    clearReachWatch()
    lastPayload = {
      highlights: payload.highlights ?? [],
      absoluteMarks: payload.absoluteMarks ?? [],
      stepIndex: payload.stepIndex,
      debugOverlay: Boolean(payload.debugOverlay)
    }
    lastDisplayBounds = payload.displayBounds
    lastCoordMap = payload.coordMap

    const hasAbs = (payload.absoluteMarks?.length ?? 0) > 0
    const hasNorm = (payload.highlights?.length ?? 0) > 0
    if (!hasAbs && !hasNorm) {
      hide()
      return
    }

    paint(lastPayload)
    startReachWatch()

    // Fallback only — normally the tip clears when the mouse reaches the target
    const ms = payload.autoHideMs ?? 14000
    if (ms > 0) {
      hideTimer = setTimeout(() => hide(), ms)
    }
  }

  function setStep(stepIndex: number): void {
    if (!lastPayload) return
    lastPayload = { ...lastPayload, stepIndex }
    paint(lastPayload)
    clearTimer()
    startReachWatch()
    hideTimer = setTimeout(() => hide(), 14000)
  }

  function hide(): void {
    clearTimer()
    clearReachWatch()
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide()
      win.webContents.send('highlights:paint', {
        highlights: [],
        absoluteMarks: [],
        display: null
      })
    }
  }

  function concealForCapture(): void {
    wasVisibleBeforeCapture = Boolean(win && !win.isDestroyed() && win.isVisible())
    if (wasVisibleBeforeCapture && win && !win.isDestroyed()) {
      win.setOpacity(0)
    }
  }

  function revealAfterCapture(): void {
    if (win && !win.isDestroyed()) {
      win.setOpacity(1)
      if (wasVisibleBeforeCapture && lastPayload) {
        const has =
          lastPayload.absoluteMarks.length > 0 || lastPayload.highlights.length > 0
        if (has) {
          paint(lastPayload)
          startReachWatch()
        }
      }
    }
    wasVisibleBeforeCapture = false
  }

  function destroy(): void {
    clearTimer()
    clearReachWatch()
    if (win && !win.isDestroyed()) win.destroy()
    win = null
    lastPayload = null
    lastDisplayBounds = undefined
    lastCoordMap = undefined
  }

  function isVisible(): boolean {
    return Boolean(win && !win.isDestroyed() && win.isVisible())
  }

  return {
    show,
    setStep,
    hide,
    concealForCapture,
    revealAfterCapture,
    destroy,
    isVisible
  }
}
