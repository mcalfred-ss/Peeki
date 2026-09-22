/**
 * Screen intelligence contracts — UI Automation + OCR + unified map.
 * Bounds are always in physical screen pixels unless noted.
 */

export type PhysicalRect = {
  x: number
  y: number
  width: number
  height: number
}

export type ElementSource = 'uia' | 'ocr' | 'vision' | 'desktop' | 'taskbar'

export type ScreenMeta = {
  displayId: string
  scaleFactor: number
  boundsDip: PhysicalRect
  sizeDip: { width: number; height: number }
  sizePhysical: { width: number; height: number }
  captureWidth: number
  captureHeight: number
  /** capture→physical scale (capturePx * scale ≈ physical when origins align) */
  captureToPhysicalScale?: number
}

export type UiElement = {
  id: string
  name: string
  role: string
  bounds: PhysicalRect
  enabled: boolean
  visible: boolean
  automationId?: string
  patterns?: string[]
  appName?: string
}

export type OcrElement = {
  id: string
  text: string
  bounds: PhysicalRect
  confidence?: number
}

export type AppWindowInfo = {
  id: string
  name: string
  bounds: PhysicalRect
  processName?: string
}

/** Unified map entry used for ranking / debug */
export type ScreenElement = {
  id: string
  source: ElementSource
  name: string
  role?: string
  text?: string
  bounds: PhysicalRect
  confidence: number
  clickable: boolean
  visible: boolean
  appName?: string
  automationId?: string
  patterns?: string[]
}

export type ScreenElementMap = {
  screen: ScreenMeta
  applications: AppWindowInfo[]
  uiElements: UiElement[]
  ocrElements: OcrElement[]
  /** Flattened ranked-ready catalog */
  elements: ScreenElement[]
  builtAt: string
}

export type AbsoluteMark = {
  id: string
  label?: string
  bounds: PhysicalRect
  style?: 'rect' | 'circle' | 'arrow'
}

export type TargetMatch = {
  source: ElementSource | 'uia' | 'ocr' | 'vision'
  confidence: number
  label: string
  bounds: PhysicalRect
  elementId?: string
  reason?: string
  /** Target category when known (desktop-icon, text, …) */
  targetType?: string
  matchKind?: string
}

/**
 * Single canonical target that travels resolve → validate → highlight/action.
 * Downstream must not invent a competing target when this is valid.
 */
export type CanonicalTarget = {
  id: string
  name: string
  type: string
  source: ElementSource
  bounds: PhysicalRect
  confidence: number
  matchKind?: string
  reason?: string
  evidence: Array<{ kind: string; detail: string }>
}

export function targetMatchToCanonical(match: TargetMatch): CanonicalTarget {
  return {
    id: match.elementId || `target-${match.source}`,
    name: match.label,
    type: match.targetType || 'unknown',
    source: match.source as ElementSource,
    bounds: match.bounds,
    confidence: match.confidence,
    matchKind: match.matchKind,
    reason: match.reason,
    evidence: [
      {
        kind: match.source,
        detail: match.reason || `${match.source} match`
      }
    ]
  }
}

