/**
 * Drop vision highlights that are really app chrome (window titles / desktop icons)
 * when the user asked for in-app coaching, not locate.
 */
import type { ScreenHighlight } from '../shared'
import type { AppWindowInfo, ScreenElementMap } from '../shared/screenIntel'
import { namesMatch } from './normalize'
import { isCoachingRequest } from './intent'

export function isPeekiUiName(name: string): boolean {
  const n = name.toLowerCase()
  return (
    /\bpeeki\b/.test(n) ||
    n.includes('ask peeki') ||
    n === 'looking' ||
    n.includes('highlight overlay') ||
    n.includes('electron')
  )
}

export function filterCoachingHighlights(
  instruction: string,
  highlights: ScreenHighlight[],
  map: ScreenElementMap | null
): ScreenHighlight[] {
  if (!isCoachingRequest(instruction) || highlights.length === 0) return highlights

  const appNames: string[] = []
  for (const a of map?.applications || []) {
    if (a.name && !isPeekiUiName(a.name)) appNames.push(a.name)
  }
  for (const u of map?.uiElements || []) {
    if ((u.role === 'DesktopIcon' || u.role === 'Window') && u.name && !isPeekiUiName(u.name)) {
      appNames.push(u.name)
    }
  }
  for (const e of map?.elements || []) {
    if (e.source === 'desktop' || e.role === 'Window' || e.role === 'DesktopIcon') {
      if (e.name && !isPeekiUiName(e.name)) appNames.push(e.name)
    }
  }

  return highlights.filter((h) => {
    const label = (h.label || '').trim()
    if (label) {
      for (const name of appNames) {
        if (namesMatch(label, name) !== 'none') {
          console.log(`COACHING: dropped chrome highlight "${label}" (matches app/icon "${name}")`)
          return false
        }
      }
      if (h.y < 0.1 && h.height < 0.07 && h.width > 0.1) {
        console.log(`COACHING: dropped title-bar shaped highlight "${label || 'unnamed'}"`)
        return false
      }
    } else if (h.y < 0.1 && h.height < 0.07) {
      console.log('COACHING: dropped unnamed top chrome highlight')
      return false
    }
    return true
  })
}

function collectAppWindows(map: ScreenElementMap): AppWindowInfo[] {
  const apps: AppWindowInfo[] = [...(map.applications || [])]
  if (apps.length === 0) {
    for (const u of map.uiElements) {
      if (u.role === 'Window' && u.name) {
        apps.push({
          id: u.id,
          name: u.name,
          bounds: u.bounds,
          processName: u.appName
        })
      }
    }
  }
  return apps.filter((a) => a.name && !isPeekiUiName(a.name))
}

/**
 * Best guess of what the user is working in — never Peeki's own UI.
 * Prefers large windows (the actual work surface).
 */
export function inferForegroundAppName(map: ScreenElementMap | null): string | null {
  if (!map) return null
  const apps = collectAppWindows(map)
  if (apps.length === 0) {
    console.log('FOREGROUND APP: (none — only Peeki UI or empty window list)')
    return null
  }

  const screenArea = Math.max(
    1,
    map.screen.sizePhysical.width * map.screen.sizePhysical.height
  )

  apps.sort((a, b) => {
    const areaA = a.bounds.width * a.bounds.height
    const areaB = b.bounds.width * b.bounds.height
    // Prefer near-fullscreen work windows
    const fullA = areaA / screenArea
    const fullB = areaB / screenArea
    if (fullA >= 0.35 !== fullB >= 0.35) return fullA >= 0.35 ? -1 : 1
    return areaB - areaA
  })

  const top = apps[0]
  console.log(
    `FOREGROUND CANDIDATES: ${apps
      .slice(0, 4)
      .map((a) => `"${a.name}" ${a.bounds.width}x${a.bounds.height}`)
      .join(' | ')}`
  )
  return top?.name || null
}
