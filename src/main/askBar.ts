import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import type { AskBarLayout } from '@modules/shared'

export type AskBarController = {
  show: () => void
  hide: () => void
  toggle: () => void
  isVisible: () => boolean
  setLayout: (layout: AskBarLayout) => void
  getLayout: () => AskBarLayout
  concealForCapture: () => void
  revealAfterCapture: () => void
  destroy: () => void
  getWindow: () => BrowserWindow | null
}

function whenContentsReady(bar: BrowserWindow, callback: () => void): void {
  if (bar.webContents.isLoadingMainFrame()) {
    bar.webContents.once('did-finish-load', () => {
      if (!bar.isDestroyed()) callback()
    })
    return
  }
  callback()
}

const COACH_HEIGHT = 64
const COACH_WIDTH = 560

/**
 * Bottom ask bar.
 * - ask: full work-area (typing / menus)
 * - coach: thin bottom dock so the user can click the real UI
 */
export function createAskBarController(): AskBarController {
  let win: BrowserWindow | null = null
  let concealed = false
  let layout: AskBarLayout = 'ask'

  function applyBounds(bar: BrowserWindow, next: AskBarLayout): void {
    const display = screen.getPrimaryDisplay().workArea
    if (next === 'coach') {
      const width = Math.min(COACH_WIDTH, display.width - 24)
      bar.setBounds({
        x: display.x + Math.round((display.width - width) / 2),
        y: display.y + display.height - COACH_HEIGHT - 12,
        width,
        height: COACH_HEIGHT
      })
      return
    }
    bar.setBounds({
      x: display.x,
      y: display.y,
      width: display.width,
      height: display.height
    })
  }

  function ensureWindow(): BrowserWindow {
    if (win && !win.isDestroyed()) {
      return win
    }

    const { x, y, width, height } = screen.getPrimaryDisplay().workArea

    win = new BrowserWindow({
      x,
      y,
      width,
      height,
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
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/askbar.html`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/askbar.html'))
    }

    win.on('closed', () => {
      win = null
      concealed = false
      layout = 'ask'
    })

    return win
  }

  function setLayout(next: AskBarLayout): void {
    layout = next
    const bar = ensureWindow()
    applyBounds(bar, next)
    whenContentsReady(bar, () => {
      if (bar.isDestroyed()) return
      bar.webContents.send('ask-bar:layout', next)
    })
  }

  function show(): void {
    const bar = ensureWindow()
    layout = 'ask'
    applyBounds(bar, 'ask')

    whenContentsReady(bar, () => {
      if (bar.isDestroyed()) return
      concealed = false
      bar.setOpacity(1)
      bar.setIgnoreMouseEvents(false)
      bar.show()
      bar.focus()
      bar.webContents.send('ask-bar:layout', 'ask')
      setTimeout(() => {
        if (!bar.isDestroyed()) {
          bar.webContents.send('ask-bar:focus-input')
        }
      }, 30)
    })
  }

  function hide(): void {
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide()
    }
    concealed = false
    layout = 'ask'
  }

  function toggle(): void {
    if (isVisible()) hide()
    else show()
  }

  function isVisible(): boolean {
    return Boolean(win && !win.isDestroyed() && win.isVisible() && !concealed)
  }

  function getLayout(): AskBarLayout {
    return layout
  }

  function concealForCapture(): void {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    concealed = true
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true)
  }

  function revealAfterCapture(): void {
    if (!win || win.isDestroyed()) return
    concealed = false
    win.setIgnoreMouseEvents(false)
    win.setOpacity(1)
    applyBounds(win, layout)
    if (!win.isVisible()) {
      win.show()
    }
    if (layout === 'ask') {
      win.focus()
    }
  }

  function destroy(): void {
    if (win && !win.isDestroyed()) {
      win.destroy()
    }
    win = null
    concealed = false
    layout = 'ask'
  }

  ensureWindow()

  return {
    show,
    hide,
    toggle,
    isVisible,
    setLayout,
    getLayout,
    concealForCapture,
    revealAfterCapture,
    destroy,
    getWindow: () => win
  }
}
