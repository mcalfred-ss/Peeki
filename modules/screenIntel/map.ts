import { screen } from 'electron'
import type { ScreenCapture } from '../shared'
import type { ScreenElementMap, ScreenMeta, UiElement } from '../shared/screenIntel'
import { scanUiAutomation } from './uia'
import { scanOcr } from './ocr'
import { toUnifiedElements } from './unify'

export type BuildMapOptions = {
  capture: ScreenCapture
  includeOcr?: boolean
  maxUiElements?: number
  /** Hard ceiling so pointing never hangs the ask flow */
  budgetMs?: number
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(fallback)
      })
  })
}

export async function buildScreenElementMap(
  options: BuildMapOptions
): Promise<ScreenElementMap> {
  const { capture, includeOcr = false, maxUiElements = 160, budgetMs = 3200 } = options
  const display =
    screen.getAllDisplays().find((d) => String(d.id) === capture.displayId) ??
    screen.getPrimaryDisplay()

  const scaleFactor = display.scaleFactor || 1
  const bounds = display.bounds
  const sizeDip = display.size
  const sizePhysical = {
    width: Math.round(sizeDip.width * scaleFactor),
    height: Math.round(sizeDip.height * scaleFactor)
  }

  const captureToPhysicalScale =
    capture.width > 0
      ? sizePhysical.width / capture.width
      : scaleFactor

  const meta: ScreenMeta = {
    displayId: String(display.id),
    scaleFactor,
    boundsDip: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    },
    sizeDip: { width: sizeDip.width, height: sizeDip.height },
    sizePhysical,
    captureWidth: capture.width,
    captureHeight: capture.height,
    captureToPhysicalScale
  }

  const emptyUia = {
    applications: [] as ScreenElementMap['applications'],
    uiElements: [] as UiElement[]
  }

  const ocrBudget = includeOcr ? Math.min(2800, budgetMs) : 0

  const [uia, ocrElements] = await Promise.all([
    withTimeout(
      scanUiAutomation({ maxElements: maxUiElements, timeoutMs: budgetMs }),
      budgetMs,
      emptyUia
    ),
    includeOcr
      ? withTimeout(scanOcr(capture, { timeoutMs: ocrBudget }), ocrBudget + 200, [])
      : Promise.resolve([])
  ])

  const elements = toUnifiedElements(uia.uiElements, ocrElements, uia.applications)

  return {
    screen: meta,
    applications: uia.applications,
    uiElements: uia.uiElements,
    ocrElements,
    elements,
    builtAt: new Date().toISOString()
  }
}
