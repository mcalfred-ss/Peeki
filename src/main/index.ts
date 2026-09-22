import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { createCaptureService } from '@modules/capture'
import { createAiClient } from '@modules/ai'
import { createAgentOrchestrator } from '@modules/agent'
import { createActionExecutor } from '@modules/actions'
import { createPermissionService } from '@modules/permissions'
import { createSessionMemory } from '@modules/memory'
import { createPrivacyService } from '@modules/privacy'
import { createWatchService } from '@modules/watch'
import { createSkillsStore } from '@modules/skills'
import { createHistoryStore } from '@modules/history'
import {
  IpcChannels,
  type ActionExecutionRequest,
  type AgentRunRequest,
  type AppSettings,
  type AppStatus,
  type HighlightsShowPayload,
  type MemorySnapshot,
  type OverlayDragPayload,
  type AskBarLayout,
  type SaveSkillRequest,
  type WatchNudgePayload,
  type WatchStatus
} from '@modules/shared'
import { createSettingsStore, loadEnvFile } from './config'
import { createOverlayController } from './overlay'
import { createAskBarController } from './askBar'
import { createHighlightController } from './highlights'
import { createLookingController } from './looking'
import { diagnoseDesktopUia, runPhysicalCalibration } from '@modules/screenIntel'

let mainWindow: BrowserWindow | null = null
let overlayController: ReturnType<typeof createOverlayController> | null = null
let askBarController: ReturnType<typeof createAskBarController> | null = null
let highlightController: ReturnType<typeof createHighlightController> | null = null
let lookingController: ReturnType<typeof createLookingController> | null = null
let watchService: ReturnType<typeof createWatchService> | null = null

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    askBarController?.show()
  })

  loadEnvFile(app.isPackaged ? app.getPath('userData') : process.cwd())

  const userData = app.getPath('userData')
  const settingsStore = createSettingsStore(join(userData, 'settings.json'))
  const permissions = createPermissionService()
  const capture = createCaptureService()
  const ai = createAiClient()
  const memory = createSessionMemory({ maxTurns: 5 })
  const privacy = createPrivacyService()
  const skills = createSkillsStore(join(userData, 'skills.json'))
  const history = createHistoryStore(join(userData, 'history.json'))
  const actions = createActionExecutor({
    permissions,
    getEnabled: () => settingsStore.get().computerControlEnabled
  })

  let mainHiddenForCapture = false
  let overlayVisibleBeforeCapture = false
  let askBarVisibleBeforeCapture = false

  const captureHooks = {
    beforeCapture: () => {
      askBarVisibleBeforeCapture = askBarController?.isVisible() ?? false
      overlayVisibleBeforeCapture = overlayController?.isVisible() ?? false

      askBarController?.concealForCapture()
      overlayController?.concealForCapture()
      highlightController?.concealForCapture()
      lookingController?.concealForCapture()

      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainHiddenForCapture = true
        mainWindow.hide()
      } else {
        mainHiddenForCapture = false
      }
    },
    afterCapture: () => {
      if (mainHiddenForCapture && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.showInactive()
      }
      mainHiddenForCapture = false

      if (overlayVisibleBeforeCapture) {
        overlayController?.revealAfterCapture()
      }
      if (askBarVisibleBeforeCapture) {
        askBarController?.revealAfterCapture()
      }
      highlightController?.revealAfterCapture()
      lookingController?.revealAfterCapture()
    }
  }

  const agent = createAgentOrchestrator({
    capture,
    ai,
    permissions,
    memory,
    privacy,
    history,
    getSettings: () => settingsStore.get(),
    ...captureHooks
  })

  function broadcastWatchState(enabled: boolean): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannels.WATCH_STATE, { enabled })
      }
    }
  }

  function openOrbMenu(): void {
    const settings = settingsStore.get()
    const menu = Menu.buildFromTemplate([
      {
        label: 'Ask Peeki',
        click: () => askBarController?.show()
      },
      {
        label: 'On duty (live coach)',
        type: 'checkbox',
        checked: settings.watchEnabled,
        click: (item) => {
          const enabled = Boolean(item.checked)
          settingsStore.update({ watchEnabled: enabled })
          watchService?.setEnabled(enabled)
        }
      },
      { type: 'separator' },
      {
        label: 'Privacy blur',
        type: 'checkbox',
        checked: settings.privacyBlurEnabled,
        click: (item) => {
          settingsStore.update({ privacyBlurEnabled: Boolean(item.checked) })
        }
      },
      {
        label: 'Computer control',
        type: 'checkbox',
        checked: settings.computerControlEnabled,
        click: (item) => {
          settingsStore.update({ computerControlEnabled: Boolean(item.checked) })
        }
      },
      {
        label: 'Debug screen map',
        type: 'checkbox',
        checked: settings.debugScreenIntel,
        click: (item) => {
          settingsStore.update({ debugScreenIntel: Boolean(item.checked) })
        }
      },
      {
        label: 'Diagnose desktop UIA…',
        click: () => {
          void (async () => {
            const result = await diagnoseDesktopUia(12000)
            console.log(
              `Diagnose done: ${result.icons.length} icons\n` + result.treeText.slice(0, 4000)
            )
          })()
        }
      },
      {
        label: 'Calibrate physical coords…',
        click: () => {
          void runPhysicalCalibration({
            showMarks: (marks) => {
              highlightController?.show({
                highlights: [],
                absoluteMarks: marks,
                autoHideMs: 20000
              })
            }
          })
        }
      },
      { type: 'separator' },
      {
        label: 'Hide floating eye',
        click: () => overlayController?.setVisible(false)
      }
    ])
    menu.popup()
  }

  function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 980,
      height: 720,
      minWidth: 720,
      minHeight: 560,
      title: 'Peeki',
      backgroundColor: '#0f1419',
      icon: join(app.isPackaged ? process.resourcesPath : process.cwd(), 'resources', 'peeki-logo.jpg'),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    win.on('closed', () => {
      mainWindow = null
    })

    mainWindow = win
    return win
  }

  function registerIpc(): void {
    ipcMain.handle(IpcChannels.APP_STATUS, (): AppStatus => {
      const settings = settingsStore.get()
      return {
        hasApiKey: ai.isConfigured(),
        actionsEnabled: actions.isEnabled(),
        version: app.getVersion(),
        overlayVisible: overlayController?.isVisible() ?? settings.overlayVisible,
        memoryTurnCount: memory.size(),
        privacyBlurEnabled: settings.privacyBlurEnabled,
        coachMode: settings.coachMode,
        watchEnabled: watchService?.isEnabled() ?? settings.watchEnabled,
        computerControlEnabled: settings.computerControlEnabled
      }
    })

    ipcMain.handle(IpcChannels.SETTINGS_GET, () => settingsStore.get())

    ipcMain.handle(
      IpcChannels.SETTINGS_UPDATE,
      (_event, partial: Partial<AppSettings>) => {
        const next = settingsStore.update(partial ?? {})
        if (typeof partial?.overlayVisible === 'boolean') {
          overlayController?.setVisible(partial.overlayVisible)
        }
        if (typeof partial?.watchEnabled === 'boolean') {
          watchService?.setEnabled(partial.watchEnabled)
        }
        return next
      }
    )

    ipcMain.handle(IpcChannels.CAPTURE_SCREEN, async () => {
      const settings = settingsStore.get()
      let shot = await capture.capturePrimaryDisplay(settings.maxCaptureWidth)
      if (settings.privacyBlurEnabled) {
        shot = privacy.applyBlur(shot)
      }
      return shot
    })

    ipcMain.handle(IpcChannels.AGENT_RUN, async (_event, request: AgentRunRequest) => {
      lookingController?.show()
      try {
        return await agent.run(request)
      } finally {
        lookingController?.hide()
      }
    })

    ipcMain.handle(
      IpcChannels.ACTIONS_EXECUTE,
      async (_event, request: ActionExecutionRequest) => {
        await captureHooks.beforeCapture()
        await new Promise((r) => setTimeout(r, 120))
        try {
          return await actions.execute(request)
        } finally {
          await captureHooks.afterCapture()
        }
      }
    )

    ipcMain.on(IpcChannels.OVERLAY_DRAG, (_event, payload: OverlayDragPayload) => {
      if (!payload || typeof payload.screenX !== 'number' || typeof payload.screenY !== 'number') {
        return
      }
      overlayController?.moveTo(payload.screenX, payload.screenY)
    })

    ipcMain.handle(IpcChannels.OVERLAY_DRAG_END, () => {
      return overlayController?.persistCurrentPosition() ?? null
    })

    ipcMain.handle(IpcChannels.OVERLAY_CLICK, () => {
      askBarController?.show()
      return { ok: true }
    })

    ipcMain.handle(IpcChannels.OVERLAY_SET_VISIBLE, (_event, visible: boolean) => {
      overlayController?.setVisible(Boolean(visible))
      return settingsStore.get()
    })

    ipcMain.handle(IpcChannels.ASK_BAR_SHOW, () => {
      askBarController?.show()
    })

    ipcMain.handle(IpcChannels.ASK_BAR_HIDE, () => {
      askBarController?.hide()
    })

    ipcMain.handle(IpcChannels.ASK_BAR_TOGGLE, () => {
      askBarController?.toggle()
    })

    ipcMain.handle(IpcChannels.ASK_BAR_LAYOUT, (_event, next: AskBarLayout) => {
      if (next === 'ask' || next === 'coach') {
        askBarController?.setLayout(next)
      }
      return askBarController?.getLayout() ?? 'ask'
    })

    ipcMain.handle(IpcChannels.MEMORY_GET, (): MemorySnapshot => {
      const recent = memory.getRecent(5).map((turn) => ({
        id: turn.id,
        instruction: turn.instruction,
        guidance: turn.guidance,
        createdAt: turn.createdAt
      }))
      return {
        turnCount: memory.size(),
        recent
      }
    })

    ipcMain.handle(IpcChannels.MEMORY_CLEAR, (): MemorySnapshot => {
      memory.clear()
      return {
        turnCount: 0,
        recent: []
      }
    })

    ipcMain.handle(IpcChannels.HIGHLIGHTS_SHOW, (_event, payload: HighlightsShowPayload) => {
      highlightController?.show(payload)
    })

    ipcMain.handle(IpcChannels.HIGHLIGHTS_HIDE, () => {
      highlightController?.hide()
    })

    ipcMain.handle(IpcChannels.HIGHLIGHTS_SET_STEP, (_event, stepIndex: number) => {
      highlightController?.setStep(Number(stepIndex) || 0)
    })

    ipcMain.handle(IpcChannels.WATCH_GET, (): WatchStatus => {
      return (
        watchService?.getStatus() ?? {
          enabled: false,
          intervalSec: settingsStore.get().watchIntervalSec,
          lastCheckedAt: null,
          lastNudgeAt: null,
          activeGoal: null
        }
      )
    })

    ipcMain.handle(IpcChannels.WATCH_TOGGLE, (_event, enabled?: boolean) => {
      const next =
        typeof enabled === 'boolean' ? enabled : !(watchService?.isEnabled() ?? false)
      settingsStore.update({ watchEnabled: next })
      watchService?.setEnabled(next)
      return watchService?.getStatus()
    })

    ipcMain.handle(IpcChannels.ORB_MENU, () => {
      openOrbMenu()
    })

    /** Done chip on the floating logo — verify progress and coach the next tip */
    ipcMain.handle(IpcChannels.ORB_DONE, async () => {
      lookingController?.show()
      try {
        const result = await agent.run({
          instruction: 'done',
          allowProposedActions: settingsStore.get().computerControlEnabled
        })

        askBarController?.show()

        if (result.ok) {
          const { decision, capture } = result
          const payload: WatchNudgePayload = {
            guidance: decision.guidance,
            nextStep: decision.nextStep,
            screenSummary: decision.screenSummary,
            highlights: decision.highlights,
            absoluteMarks: decision.absoluteMarks,
            proposedActions: decision.proposedActions,
            confidence: decision.confidence
          }
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send(IpcChannels.WATCH_NUDGE, payload)
            }
          }
          const hasAbs = (decision.absoluteMarks?.length ?? 0) > 0
          if (hasAbs || decision.highlights.length > 0) {
            highlightController?.show({
              highlights: hasAbs ? [] : decision.highlights,
              absoluteMarks: decision.absoluteMarks,
              autoHideMs: 16000,
              displayBounds: capture.displayBounds,
              coordMap: capture.coordMap
            })
          }
        } else {
          const payload: WatchNudgePayload = {
            guidance: result.error,
            nextStep: 'Try again or ask Peeki what to do next',
            screenSummary: '',
            highlights: [],
            proposedActions: [],
            confidence: 0
          }
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send(IpcChannels.WATCH_NUDGE, payload)
            }
          }
        }

        return result
      } finally {
        lookingController?.hide()
      }
    })

    ipcMain.handle(IpcChannels.SKILLS_LIST, () => skills.list())

    ipcMain.handle(IpcChannels.SKILLS_GET, (_event, id: string) => {
      return typeof id === 'string' ? skills.get(id) : null
    })

    ipcMain.handle(IpcChannels.SKILLS_SAVE, (_event, request: SaveSkillRequest) => {
      if (!request || typeof request.name !== 'string') {
        throw new Error('Skill name is required')
      }
      return skills.save(request)
    })

    ipcMain.handle(IpcChannels.SKILLS_DELETE, (_event, id: string) => {
      if (typeof id !== 'string') return false
      return skills.remove(id)
    })

    ipcMain.handle(IpcChannels.HISTORY_LIST, (_event, limit?: number) => {
      return history.list(typeof limit === 'number' ? limit : 30)
    })

    ipcMain.handle(IpcChannels.HISTORY_CLEAR, () => {
      history.clear()
      return history.list(30)
    })

    ipcMain.handle(IpcChannels.UIA_DIAGNOSE_DESKTOP, async () => {
      return diagnoseDesktopUia(12000)
    })

    ipcMain.handle(IpcChannels.CALIBRATE_PHYSICAL, async () => {
      return runPhysicalCalibration({
        showMarks: (marks) => {
          highlightController?.show({
            highlights: [],
            absoluteMarks: marks,
            autoHideMs: 20000
          })
        }
      })
    })
  }

  app.whenReady().then(() => {
    registerIpc()
    createWindow()

    askBarController = createAskBarController()
    highlightController = createHighlightController()
    lookingController = createLookingController()

    overlayController = createOverlayController({
      getSettings: () => settingsStore.get(),
      updateSettings: (partial) => settingsStore.update(partial),
      getMainWindow: () => mainWindow
    })

    watchService = createWatchService({
      capture,
      ai,
      privacy,
      memory,
      getSettings: () => settingsStore.get(),
      ...captureHooks,
      onStateChange: (enabled) => broadcastWatchState(enabled),
      onLookingStart: () => lookingController?.show(),
      onLookingEnd: () => lookingController?.hide(),
      onNudge: (decision, captureShot) => {
        const payload: WatchNudgePayload = {
          guidance: decision.guidance,
          nextStep: decision.nextStep,
          screenSummary: decision.screenSummary,
          highlights: decision.highlights,
          absoluteMarks: decision.absoluteMarks,
          proposedActions: decision.proposedActions,
          confidence: decision.confidence
        }
        askBarController?.show()
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send(IpcChannels.WATCH_NUDGE, payload)
          }
        }
        const hasAbs = (decision.absoluteMarks?.length ?? 0) > 0
        if (hasAbs || decision.highlights.length > 0) {
          highlightController?.show({
            highlights: hasAbs ? [] : decision.highlights,
            absoluteMarks: decision.absoluteMarks,
            autoHideMs: 14000,
            displayBounds: captureShot.displayBounds,
            coordMap: captureShot.coordMap
          })
        }
      }
    })

    if (settingsStore.get().watchEnabled) {
      watchService.setEnabled(true)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      } else if (!mainWindow) {
        createWindow()
      } else {
        mainWindow.show()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    watchService?.stop()
    lookingController?.destroy()
    askBarController?.destroy()
    overlayController?.destroy()
    highlightController?.destroy()
  })
}
