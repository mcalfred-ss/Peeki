import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { IpcChannels } from '@modules/shared'

export type LookingController = {
  /** Start the "Peeki is looking" edge glow */
  show: () => void
  /** Stop the glow */
  hide: () => void
  /** Hide for screenshot so it isn't captured */
  concealForCapture: () => void
  /** Restore after screenshot if still looking */
  revealAfterCapture: () => void
  isActive: () => boolean
  destroy: () => void
}

/**
 * Full-screen click-through rim glow while Peeki analyzes the screen
 * (Apple Intelligence–style edge light).
 */
export function createLookingController(): LookingController {
  let win: BrowserWindow | null = null
  let active = false
  let concealed = false

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
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/looking.html`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/looking.html'))
    }

    win.on('closed', () => {
      win = null
    })

    return win
  }

  function fitToDisplay(bar: BrowserWindow): void {
    const area = screen.getPrimaryDisplay().bounds
    bar.setBounds({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height
    })
  }

  function send(state: 'on' | 'off'): void {
    if (!win || win.isDestroyed()) return
    const go = (): void => {
      if (!win || win.isDestroyed()) return
      win.webContents.send(IpcChannels.LOOKING_STATE, { active: state === 'on' })
    }
    if (win.webContents.isLoadingMainFrame()) {
      win.webContents.once('did-finish-load', go)
    } else {
      go()
    }
  }

  function show(): void {
    active = true
    concealed = false
    const bar = ensureWindow()
    fitToDisplay(bar)
    bar.setOpacity(1)
    bar.setIgnoreMouseEvents(true, { forward: true })
    if (!bar.isVisible()) {
      bar.showInactive()
    }
    send('on')
  }

  function hide(): void {
    active = false
    concealed = false
    send('off')
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide()
    }
  }

  function concealForCapture(): void {
    if (!win || win.isDestroyed() || !active) return
    concealed = true
    win.setOpacity(0)
  }

  function revealAfterCapture(): void {
    if (!win || win.isDestroyed() || !active) return
    concealed = false
    win.setOpacity(1)
    fitToDisplay(win)
    if (!win.isVisible()) {
      win.showInactive()
    }
    send('on')
  }

  function isActive(): boolean {
    return active && !concealed
  }

  function destroy(): void {
    active = false
    concealed = false
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  }

  return {
    show,
    hide,
    concealForCapture,
    revealAfterCapture,
    isActive,
    destroy
  }
}
