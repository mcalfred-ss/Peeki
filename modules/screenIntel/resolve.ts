import type {
  PhysicalRect,
  ScreenElement,
  ScreenElementMap,
  TargetMatch
} from '../shared/screenIntel'
import { extractSearchQueries } from './queries'
import {
  categorizeElement,
  inferPointingHint,
  inferUserTargetIntent,
  type PointingHint,
  type TargetCategory,
  type UserTargetIntent
} from './intent'
import { namesMatch, normalizeName, compactName } from './normalize'
import { rectCenter } from './coords'

export { extractSearchQueries } from './queries'

/** How tightly a candidate name/text matches the query. */
export type NameMatchKind = 'exact' | 'strong' | 'partial' | 'weak' | 'none'

export function nameMatchKind(query: string, candidate: string): NameMatchKind {
  const eq = namesMatch(query, candidate)
  if (eq === 'exact' || eq === 'compact') return 'exact'
  if (eq === 'token') return 'strong'
  if (eq === 'fuzzy') return 'partial'

  const qn = normalizeName(query)
  const cn = normalizeName(candidate)
  if (!qn || !cn) return 'none'

  // Whole-word containment
  const wordRe = new RegExp(`(?:^|\\s)${escapeRegExp(qn)}(?:\\s|$)`)
  if (wordRe.test(cn)) return 'partial'

  // Compact containment for longer names (generic, e.g. query inside candidate compact form)
  const qc = compactName(query)
  const cc = compactName(candidate)
  if (qc.length >= 4 && cc.includes(qc)) return 'partial'
  if (cc.length >= 4 && qc.includes(cc)) return 'partial'

  // Token fuzzy overlap — weak
  const qTokens = qn.split(' ').filter((t) => t.length >= 3)
  const cTokens = cn.split(' ').filter(Boolean)
  if (qTokens.length === 0) return 'none'
  const hit = qTokens.filter((t) =>
    cTokens.some((ct) => ct === t || compactName(ct) === compactName(t) || ct.includes(t))
  )
  if (hit.length === qTokens.length) return 'weak'
  if (hit.length / qTokens.length >= 0.6) return 'weak'

  return 'none'
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function bestNameMatch(query: string, el: ScreenElement): NameMatchKind {
  const kinds = [
    nameMatchKind(query, el.name),
    el.text ? nameMatchKind(query, el.text) : 'none',
    el.appName ? nameMatchKind(query, el.appName) : 'none'
  ]
  const order: NameMatchKind[] = ['exact', 'strong', 'partial', 'weak', 'none']
  for (const k of order) {
    if (kinds.includes(k)) return k
  }
  return 'none'
}

/**
 * Discrete priority tiers — primary sort key.
 * Exact desktop icons for app-icon intent must sit above OCR partials.
 */
function matchTier(
  intent: UserTargetIntent,
  category: TargetCategory,
  kind: NameMatchKind,
  source: string
): number {
  const isUiaFamily = source === 'desktop' || source === 'taskbar' || source === 'uia'
  const isOcr = source === 'ocr'

  if (intent === 'app-icon') {
    if (isUiaFamily && category === 'desktop-icon' && kind === 'exact') return 1000
    if (isUiaFamily && category === 'desktop-icon' && kind === 'strong') return 950
    if (isUiaFamily && category === 'taskbar' && (kind === 'exact' || kind === 'strong')) return 920
    if (isUiaFamily && (kind === 'exact' || kind === 'strong')) return 880
    if (isUiaFamily && category === 'desktop-icon' && kind === 'partial') return 820
    if (isUiaFamily && kind === 'partial') return 780
    // OCR only competes for app-icon when the OCR string itself is an exact short label
    if (isOcr && kind === 'exact') return 700
    if (isOcr && kind === 'strong') return 520
    if (isOcr && kind === 'partial') return 300
    if (isOcr && kind === 'weak') return 120
    if (isUiaFamily && kind === 'weak') return 600
    return 0
  }

  if (intent === 'text-on-page') {
    if (isOcr && kind === 'exact') return 1000
    if (isOcr && kind === 'strong') return 920
    if (isOcr && kind === 'partial') return 840
    if (isUiaFamily && kind === 'exact') return 700
    if (isOcr && kind === 'weak') return 500
    if (isUiaFamily && kind === 'strong') return 480
    return kind === 'none' ? 0 : 200
  }

  if (intent === 'search-field') {
    if (category === 'input' && (kind === 'exact' || kind === 'strong' || kind === 'partial')) {
      return 950
    }
    if (isOcr && kind === 'exact') return 900
    if (isOcr && kind === 'strong') return 850
    if (isUiaFamily && kind === 'exact') return 800
    return kind === 'none' ? 0 : 400
  }

  if (intent === 'ui-control') {
    if (category === 'button' && (kind === 'exact' || kind === 'strong')) return 950
    if (category === 'link' && (kind === 'exact' || kind === 'strong')) return 930
    if (isUiaFamily && kind === 'exact') return 900
    if (isOcr && kind === 'exact') return 700
    return kind === 'none' ? 0 : 400
  }

  // Inventory / progress / open coaching never resolve to a single click target here
  if (intent === 'inventory' || intent === 'progress' || intent === 'coaching') return 0

  // generic
  if (isUiaFamily && kind === 'exact') return 900
  if (isUiaFamily && kind === 'strong') return 850
  if (isOcr && kind === 'exact') return 800
  if (isUiaFamily && kind === 'partial') return 700
  if (isOcr && kind === 'strong') return 650
  if (isOcr && kind === 'partial') return 500
  return kind === 'none' ? 0 : 300
}

function fineScore(
  hint: PointingHint,
  intent: UserTargetIntent,
  el: ScreenElement,
  kind: NameMatchKind,
  map: ScreenElementMap
): number {
  let s = 0
  switch (kind) {
    case 'exact':
      s += 1
      break
    case 'strong':
      s += 0.85
      break
    case 'partial':
      s += 0.55
      break
    case 'weak':
      s += 0.3
      break
    default:
      s += 0
  }

  const category = categorizeElement(el)
  if (intent === 'app-icon' && category === 'desktop-icon') s += 0.08
  if (intent === 'app-icon' && category === 'taskbar') s += 0.05
  if (intent === 'text-on-page' && category === 'text') s += 0.08

  // Compact clickable targets for icons
  const area = el.bounds.width * el.bounds.height
  if (intent === 'app-icon' && area > 0 && area < 200 * 200) s += 0.04
  if (intent === 'app-icon' && area > 800 * 600) s -= 0.1

  const { sizePhysical } = map.screen
  const c = rectCenter(el.bounds)
  if (hint === 'taskbar' && c.y > sizePhysical.height * 0.88) s += 0.05
  if (hint === 'search-field' && c.y < sizePhysical.height * 0.2) s += 0.04

  s *= 0.9 + 0.1 * Math.min(1, el.confidence)
  return s
}

export type RankedCandidate = {
  el: ScreenElement
  score: number
  tier: number
  query: string
  kind: NameMatchKind
  category: TargetCategory
  rejectReason?: string
}

function catalogElements(map: ScreenElementMap): ScreenElement[] {
  if (map.elements?.length) return map.elements
  return [
    ...map.uiElements.map(
      (u): ScreenElement => ({
        id: u.id,
        source:
          u.role === 'DesktopIcon' ? 'desktop' : u.role === 'TaskbarButton' ? 'taskbar' : 'uia',
        name: u.name,
        role: u.role,
        text: u.name,
        bounds: u.bounds,
        confidence: 0.85,
        clickable: u.enabled,
        visible: u.visible,
        appName: u.appName,
        patterns: u.patterns
      })
    ),
    ...map.ocrElements.map(
      (o): ScreenElement => ({
        id: o.id,
        source: 'ocr',
        name: o.text,
        role: 'Text',
        text: o.text,
        bounds: o.bounds,
        confidence: o.confidence ?? 0.75,
        clickable: true,
        visible: true
      })
    )
  ]
}

function rankElements(map: ScreenElementMap, instruction: string): RankedCandidate[] {
  const queries = extractSearchQueries(instruction)
  const intent = inferUserTargetIntent(instruction)
  const hint = inferPointingHint(instruction)
  const elements = catalogElements(map)

  const ranked: RankedCandidate[] = []
  for (const el of elements) {
    // Desktop/win32 icons may report visible=false incorrectly — still allow desktop/taskbar
    if (!el.visible && el.source !== 'ocr' && el.source !== 'desktop' && el.source !== 'taskbar') {
      continue
    }
    for (const q of queries) {
      const kind = bestNameMatch(q, el)
      if (kind === 'none') continue
      const category = categorizeElement(el)
      const tier = matchTier(intent, category, kind, el.source)
      if (tier <= 0) continue
      const fine = fineScore(hint, intent, el, kind, map)
      ranked.push({
        el,
        score: tier + fine,
        tier,
        query: q,
        kind,
        category
      })
    }
  }

  ranked.sort((a, b) => b.score - a.score || b.tier - a.tier)
  return ranked
}

const STRONG_UIA = 0.72
const STRONG_OCR = 0.78
const STRONG_COMBINED = 0.7

/**
 * Resolve pointing target with intent-aware tiered ranking.
 * Vision is never applied here — caller localizes only if weak/no match.
 */
export function resolveTarget(
  map: ScreenElementMap,
  instruction: string
): TargetMatch | null {
  const intent = inferUserTargetIntent(instruction)
  if (intent === 'inventory') {
    console.log(
      [
        '=== TARGET RESOLUTION ===',
        `USER REQUEST: "${instruction}"`,
        'INTENT: inventory',
        'SELECTED TARGET: (none — inventory uses element map, not a single highlight)',
        'FINAL TARGET: (none)',
        '========================='
      ].join('\n')
    )
    return null
  }

  if (intent === 'progress') {
    console.log(
      [
        '=== TARGET RESOLUTION ===',
        `USER REQUEST: "${instruction}"`,
        'INTENT: progress',
        'SELECTED TARGET: (handled by coach continue — not a fresh locate)',
        '========================='
      ].join('\n')
    )
    return null
  }

  if (intent === 'coaching') {
    console.log(
      [
        '=== TARGET RESOLUTION ===',
        `USER REQUEST: "${instruction}"`,
        'INTENT: coaching',
        'SELECTED TARGET: (none — in-app coaching, not locate)',
        'FINAL TARGET: (none)',
        '========================='
      ].join('\n')
    )
    return null
  }

  const ranked = rankElements(map, instruction)
  if (ranked.length === 0) {
    console.log(
      [
        '=== TARGET RESOLUTION ===',
        `USER REQUEST: "${instruction}"`,
        `INTENT: ${intent}`,
        'CANDIDATES: (none)',
        'SELECTED TARGET: (none)',
        'FINAL TARGET: (none)',
        '========================='
      ].join('\n')
    )
    return null
  }

  const top = ranked[0]
  const el = top.el

  // Confidence reflects match quality + tier, not raw OCR fuzzy luck
  let confidence = 0.5
  if (top.kind === 'exact' && (el.source === 'desktop' || el.source === 'taskbar')) {
    confidence = 0.99
  } else if (top.kind === 'exact') {
    confidence = 0.95
  } else if (top.kind === 'strong' && (el.source === 'desktop' || el.source === 'taskbar')) {
    confidence = 0.96
  } else if (top.kind === 'strong') {
    confidence = 0.9
  } else if (top.kind === 'partial') {
    confidence = el.source === 'ocr' ? 0.62 : 0.8
  } else if (el.source === 'desktop' || el.source === 'taskbar') {
    // Structural desktop hit — never treat as throwaway-weak
    confidence = 0.85
  } else {
    confidence = 0.45
  }

  let reason = `matched "${top.query}" via ${el.source}/${top.category} (${top.kind}, intent=${intent}, tier=${top.tier})`

  // Prefer UIA when OCR won only by partial and an exact/strong desktop exists
  if (el.source === 'ocr' && intent === 'app-icon') {
    const better = ranked.find(
      (r) =>
        (r.el.source === 'desktop' || r.el.source === 'taskbar' || r.el.source === 'uia') &&
        (r.kind === 'exact' || r.kind === 'strong') &&
        r.tier >= 880
    )
    if (better) {
      logResolutionDebug(instruction, intent, better, ranked, true)
      return {
        source: better.el.source,
        confidence: better.kind === 'exact' ? 0.99 : 0.9,
        label: better.el.name || better.el.text || 'target',
        bounds: better.el.bounds,
        elementId: better.el.id,
        targetType: better.category,
        matchKind: better.kind,
        reason: `preferred ${better.el.source}/${better.category} ${better.kind} over OCR partial`
      }
    }
  }

  logResolutionDebug(instruction, intent, top, ranked, true)

  return {
    source: el.source,
    confidence,
    label: el.name || el.text || 'target',
    bounds: el.bounds,
    elementId: el.id,
    targetType: top.category,
    matchKind: top.kind,
    reason
  }
}

function logResolutionDebug(
  instruction: string,
  intent: UserTargetIntent,
  selected: RankedCandidate,
  ranked: RankedCandidate[],
  isFinal = false
): void {
  const b = selected.el.bounds
  const conf =
    selected.kind === 'exact' &&
    (selected.el.source === 'desktop' || selected.el.source === 'taskbar')
      ? 0.99
      : selected.kind === 'exact'
        ? 0.95
        : selected.kind === 'strong'
          ? 0.9
          : selected.el.source === 'desktop' || selected.el.source === 'taskbar'
            ? 0.85
            : Number(selected.score.toFixed(3))

  const rejected = ranked.slice(1, 8).map((r) => {
    let why = `tier ${r.tier} < selected ${selected.tier}`
    if (
      selected.category === 'desktop-icon' &&
      (selected.kind === 'exact' || selected.kind === 'strong') &&
      r.el.source === 'ocr'
    ) {
      why = `lower priority than exact/strong desktop-icon match (intent=${intent})`
    }
    if (r.el.source === 'vision') {
      why = 'vision must not replace structural UIA/desktop match'
    }
    return {
      name: (r.el.name || r.el.text || '').slice(0, 60),
      source: r.el.source,
      type: r.category,
      kind: r.kind,
      tier: r.tier,
      reason: why
    }
  })

  console.log(
    [
      '=== TARGET RESOLUTION ===',
      `USER REQUEST: "${instruction}"`,
      `INTENT: ${intent}`,
      '',
      'CANDIDATES:',
      ...ranked.slice(0, 6).map(
        (r, i) =>
          `${i + 1}. ${r.el.name || r.el.text}\n   source: ${r.el.source}\n   type: ${r.category}\n   match: ${r.kind}\n   tier: ${r.tier}\n   bounds: x=${r.el.bounds.x} y=${r.el.bounds.y} w=${r.el.bounds.width} h=${r.el.bounds.height}`
      ),
      '',
      'SELECTED TARGET:',
      selected.el.name || selected.el.text || '(unnamed)',
      `SOURCE: ${selected.el.source}`,
      `TYPE: ${selected.category}`,
      `MATCH: ${selected.kind}`,
      `CONFIDENCE: ${conf}`,
      `BOUNDS: x=${b.x} y=${b.y} w=${b.width} h=${b.height}`,
      isFinal
        ? [
            '',
            'FINAL TARGET:',
            selected.el.name || selected.el.text || '(unnamed)',
            `SOURCE: ${selected.el.source}`,
            `TYPE: ${selected.category}`,
            '(canonical — must not be replaced by vision)'
          ].join('\n')
        : '',
      '',
      'Rejected:',
      ...rejected.map(
        (r) =>
          `- [${r.source}] "${r.name}" type=${r.type} match=${r.kind}\n  reason=${r.reason}`
      ),
      '========================='
    ]
      .filter(Boolean)
      .join('\n')
  )
}

export function isStrongMatch(match: TargetMatch): boolean {
  if (match.source === 'desktop' || match.source === 'taskbar') {
    return match.confidence >= 0.5
  }
  if (match.source === 'uia') return match.confidence >= STRONG_UIA
  if (match.source === 'ocr') return match.confidence >= STRONG_OCR
  if (match.source === 'vision') return match.confidence >= 0.85
  return match.confidence >= STRONG_COMBINED
}

/** Structural resolver hits must not be replaced by vision. */
export function shouldPreferOverVision(match: TargetMatch | null): boolean {
  if (!match) return false
  if (match.source === 'desktop' || match.source === 'taskbar') {
    return match.confidence >= 0.4
  }
  if (match.source === 'uia') return match.confidence >= 0.55
  if (match.source === 'ocr') return match.confidence >= 0.78
  return isStrongMatch(match)
}

export function formatMapForPrompt(map: ScreenElementMap, limit = 60): string {
  const lines: string[] = [
    `Screen: ${map.screen.sizePhysical.width}x${map.screen.sizePhysical.height} physical, scale=${map.screen.scaleFactor}`,
    `Elements (${Math.min(limit, map.elements?.length || map.uiElements.length)}):`
  ]

  const list = map.elements?.length
    ? map.elements.slice(0, limit)
    : map.uiElements.slice(0, limit).map((el) => ({
        source: 'uia' as const,
        name: el.name,
        role: el.role,
        text: el.name,
        bounds: el.bounds,
        confidence: 0.85
      }))

  for (const el of list) {
    const b = el.bounds
    lines.push(
      `- [${el.source}/${el.role || '?'}] "${el.name || el.text}" conf=${(el.confidence ?? 0).toFixed(2)} @ (${b.x},${b.y},${b.width},${b.height})`
    )
  }

  if (map.ocrElements.length > 0 && !(map.elements?.some((e) => e.source === 'ocr'))) {
    lines.push(`OCR (${Math.min(40, map.ocrElements.length)}):`)
    for (const el of map.ocrElements.slice(0, 40)) {
      const b = el.bounds
      lines.push(`- "${el.text}" @ (${b.x},${b.y},${b.width},${b.height})`)
    }
  }

  lines.push(
    'Match named elements when possible. Do not invent coordinates if a listed element matches.'
  )
  return lines.join('\n')
}

/** Desktop / taskbar inventory for count/list questions — no single-target pointing. */
export function formatDesktopInventoryForPrompt(map: ScreenElementMap): string {
  const icons = (map.elements?.length ? map.elements : []).filter(
    (e) => e.source === 'desktop' || e.role === 'DesktopIcon'
  )
  const fromUi =
    icons.length > 0
      ? icons
      : map.uiElements
          .filter((u) => u.role === 'DesktopIcon')
          .map((u) => ({
            name: u.name,
            source: 'desktop' as const,
            bounds: u.bounds
          }))

  const taskbar = (map.elements || []).filter((e) => e.source === 'taskbar')
  const taskbarUi =
    taskbar.length > 0
      ? taskbar
      : map.uiElements
          .filter((u) => u.role === 'TaskbarButton')
          .map((u) => ({ name: u.name, source: 'taskbar' as const, bounds: u.bounds }))

  const lines = [
    'DESKTOP INVENTORY (from Windows UI Automation — ground truth):',
    `Desktop icons (${fromUi.length}):`
  ]
  for (const el of fromUi) {
    lines.push(`- ${el.name}`)
  }
  if (taskbarUi.length) {
    lines.push(`Taskbar (${taskbarUi.length}):`)
    for (const el of taskbarUi) {
      lines.push(`- ${el.name}`)
    }
  }
  lines.push(
    'Answer the user from this list. Do NOT invent a highlight box. Return highlights as [].'
  )
  return lines.join('\n')
}

export function listRankedCandidates(
  map: ScreenElementMap,
  instruction: string,
  limit = 12
): Array<{
  name: string
  source: string
  score: number
  bounds: PhysicalRect
  category?: TargetCategory
  kind?: NameMatchKind
}> {
  return rankElements(map, instruction)
    .slice(0, limit)
    .map((r) => ({
      name: r.el.name,
      source: r.el.source,
      score: r.score,
      bounds: r.el.bounds,
      category: r.category,
      kind: r.kind
    }))
}
