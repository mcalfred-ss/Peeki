import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import {
  createOverlayPlacement,
  OVERLAY_WIDTH,
  OVERLAY_HEIGHT
} from '@modules/overlay'
import type { AppSettings, OverlayPosition } from '@modules/shared'

export type OverlayController = {
  show: () => void
  hide: () => void
  setVisible: (visible: boolean) => void
  isVisible: () => boolean
  concealForCapture: () => void
  revealAfterCapture: () => void
  moveTo: (screenX: number, screenY: number) => OverlayPosition
  persistCurrentPosition: () => OverlayPosition | null
  focusMain: () => void
  getWindow: () => BrowserWindow | null
  destroy: () => void
}

export function createOverlayController(deps: {
  getSettings: () => AppSettings
  updateSettings: (partial: Partial<AppSettings>) => AppSettings
  getMainWindow: () => BrowserWindow | null
}): OverlayController {
  const placement = createOverlayPlacement()
  let overlay: BrowserWindow | null = null
  let dragOffset: OverlayPosition | null = null

  function resolveStartPosition(): OverlayPosition {
    const display = screen.getPrimaryDisplay()
    const saved = deps.getSettings().overlayPosition
    if (saved) {
      return placement.clampToWorkArea(saved, display.workArea)
    }
    return placement.getDefaultPosition(display.workArea)
  }

  function ensureWindow(): BrowserWindow {
    if (overlay && !overlay.isDestroyed()) {
      return overlay
    }

    const start = resolveStartPosition()

    overlay = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      x: start.x,
      y: start.y,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      focusable: true,
      roundedCorners: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    overlay.setIgnoreMouseEvents(false)

    if (process.env.ELECTRON_RENDERER_URL) {
      void overlay.loadURL(`${process.env.ELECTRON_RENDERER_URL}/widget.html`)
    } else {
      void overlay.loadFile(join(__dirname, '../renderer/widget.html'))
    }

    overlay.once('ready-to-show', () => {
      if (deps.getSettings().overlayVisible) {
        overlay?.showInactive()
      }
    })

    overlay.on('closed', () => {
      overlay = null
    })

    return overlay
  }

  function show(): void {
    const win = ensureWindow()
    if (!win.isVisible()) {
      win.showInactive()
    }
    deps.updateSettings({ overlayVisible: true })
  }

  function hide(): void {
    if (overlay && !overlay.isDestroyed()) {
      overlay.hide()
    }
    deps.updateSettings({ overlayVisible: false })
  }

  function setVisible(visible: boolean): void {
    if (visible) show()
    else hide()
  }

  function isVisible(): boolean {
    return Boolean(overlay && !overlay.isDestroyed() && overlay.isVisible())
  }

  function concealForCapture(): void {
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return
    overlay.setOpacity(0)
    overlay.setIgnoreMouseEvents(true)
  }

  function revealAfterCapture(): void {
    if (!overlay || overlay.isDestroyed()) return
    overlay.setIgnoreMouseEvents(false)
    overlay.setOpacity(1)
    if (!overlay.isVisible() && deps.getSettings().overlayVisible) {
      overlay.showInactive()
    }
  }

  function moveTo(screenX: number, screenY: number): OverlayPosition {
    const win = ensureWindow()
    if (!dragOffset) {
      const [wx, wy] = win.getPosition()
      dragOffset = { x: screenX - wx, y: screenY - wy }
    }

    const display = screen.getDisplayNearestPoint({ x: screenX, y: screenY })
    const next = placement.clampToWorkArea(
      {
        x: Math.round(screenX - dragOffset.x),
        y: Math.round(screenY - dragOffset.y)
      },
      display.workArea
    )

    win.setPosition(next.x, next.y)
    return next
  }

  function persistCurrentPosition(): OverlayPosition | null {
    dragOffset = null
    if (!overlay || overlay.isDestroyed()) return null
    const [x, y] = overlay.getPosition()
    const position = { x, y }
    deps.updateSettings({ overlayPosition: position })
    return position
  }

  function focusMain(): void {
    const main = deps.getMainWindow()
    if (!main || main.isDestroyed()) return
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
  }

  function destroy(): void {
    dragOffset = null
    if (overlay && !overlay.isDestroyed()) {
      overlay.destroy()
    }
    overlay = null
  }

  // Warm-create so logo appears quickly when app is active
  if (deps.getSettings().overlayVisible) {
    ensureWindow()
  }

  return {
    show,
    hide,
    setVisible,
    isVisible,
    concealForCapture,
    revealAfterCapture,
    moveTo,
    persistCurrentPosition,
    focusMain,
    getWindow: () => overlay,
    destroy
  }
}
