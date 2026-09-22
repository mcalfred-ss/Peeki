import type {
  AppWindowInfo,
  OcrElement,
  ScreenElement,
  UiElement
} from '../shared/screenIntel'

function area(b: { width: number; height: number }): number {
  return Math.max(1, b.width * b.height)
}

export function toUnifiedElements(
  uiElements: UiElement[],
  ocrElements: OcrElement[],
  applications: AppWindowInfo[]
): ScreenElement[] {
  const out: ScreenElement[] = []

  for (const el of uiElements) {
    const source =
      el.role === 'DesktopIcon'
        ? 'desktop'
        : el.role === 'TaskbarButton' || el.appName === 'Taskbar'
          ? 'taskbar'
          : 'uia'
    out.push({
      id: el.id,
      source,
      name: el.name,
      role: el.role,
      text: el.name,
      bounds: el.bounds,
      confidence: source === 'desktop' || source === 'taskbar' ? 0.92 : 0.85,
      clickable: el.enabled && el.visible,
      visible: el.visible,
      appName: el.appName,
      automationId: el.automationId,
      patterns: el.patterns
    })
  }

  for (const el of ocrElements) {
    out.push({
      id: el.id,
      source: 'ocr',
      name: el.text,
      role: 'Text',
      text: el.text,
      bounds: el.bounds,
      confidence: el.confidence ?? 0.75,
      clickable: true,
      visible: true
    })
  }

  for (const app of applications) {
    // Avoid duplicating if a Window uia entry already exists with same name+bounds
    const dup = out.some(
      (e) =>
        e.role === 'Window' &&
        e.name === app.name &&
        Math.abs(e.bounds.x - app.bounds.x) < 4 &&
        Math.abs(e.bounds.y - app.bounds.y) < 4
    )
    if (dup) continue
    out.push({
      id: app.id,
      source: 'uia',
      name: app.name,
      role: 'Window',
      text: app.name,
      bounds: app.bounds,
      confidence: 0.7,
      clickable: true,
      visible: true,
      appName: app.name
    })
  }

  // Prefer smaller clickable targets first in listings
  out.sort((a, b) => area(a.bounds) - area(b.bounds))
  return out
}
