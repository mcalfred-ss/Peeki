import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import type { HighlightsShowPayload, ScreenHighlight } from '@modules/shared'

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
  stepIndex?: number
}

export function createHighlightController(): HighlightController {
  let win: BrowserWindow | null = null
  let hideTimer: NodeJS.Timeout | null = null
  let lastPayload: HighlightRenderState | null = null
  let wasVisibleBeforeCapture = false

  function clearTimer(): void {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
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
    const area = screen.getPrimaryDisplay().bounds
    bar.setBounds(area)

    const filtered =
      typeof state.stepIndex === 'number'
        ? state.highlights.filter(
            (h) => h.stepIndex === undefined || h.stepIndex === state.stepIndex
          )
        : state.highlights

    const send = (): void => {
      if (bar.isDestroyed()) return
      bar.webContents.send('highlights:paint', {
        highlights: filtered,
        display: { width: area.width, height: area.height }
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
    lastPayload = {
      highlights: payload.highlights,
      stepIndex: payload.stepIndex
    }

    if (!payload.highlights.length) {
      hide()
      return
    }

    paint(lastPayload)

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
    hideTimer = setTimeout(() => hide(), 14000)
  }

  function hide(): void {
    clearTimer()
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide()
      win.webContents.send('highlights:paint', { highlights: [], display: null })
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
      if (wasVisibleBeforeCapture && lastPayload && lastPayload.highlights.length > 0) {
        paint(lastPayload)
      }
    }
    wasVisibleBeforeCapture = false
  }

  function destroy(): void {
    clearTimer()
    if (win && !win.isDestroyed()) win.destroy()
    win = null
    lastPayload = null
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
