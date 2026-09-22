/**
 * Validate a canonical target before highlight/action.
 * Vision may run only when validation fails.
 */
import type { CanonicalTarget, ScreenElementMap } from '../shared/screenIntel'
import { extractSearchQueries } from './queries'
import { compactName, namesMatch, normalizeName } from './normalize'

export type ValidationResult = {
  ok: boolean
  reason: string
}

export function validateCanonicalTarget(
  target: CanonicalTarget,
  map: ScreenElementMap,
  userQuery: string
): ValidationResult {
  const b = target.bounds
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || b.width < 2 || b.height < 2) {
    return { ok: false, reason: 'invalid bounds' }
  }

  const screen = map.screen.sizePhysical
  // Allow slight overflow (icon at x=0 is valid)
  if (b.x + b.width < -20 || b.y + b.height < -20) {
    return { ok: false, reason: 'bounds entirely off-screen (negative)' }
  }
  if (b.x > screen.width + 20 || b.y > screen.height + 20) {
    return { ok: false, reason: 'bounds outside current display' }
  }

  // Compare against extracted search tokens, never the full utterance
  // ("where is the gitbash" → "gitbash" must match "Git Bash")
  if (target.source !== 'vision' && !nameRelatesToRequest(userQuery, target.name)) {
    return { ok: false, reason: 'name no longer matches user request' }
  }

  if (
    target.source === 'desktop' ||
    target.source === 'taskbar' ||
    target.source === 'uia' ||
    target.source === 'ocr'
  ) {
    if (target.confidence >= 0.4) {
      return { ok: true, reason: 'structural target validated' }
    }
  }

  if (target.source === 'vision' && target.confidence >= 0.7) {
    return { ok: true, reason: 'strong vision target' }
  }

  if (target.confidence >= 0.5) {
    return { ok: true, reason: 'confidence confidence' }
  }

  return { ok: false, reason: `confidence too low (${target.confidence.toFixed(2)})` }
}

/** True when any extracted query token equates to the target name (generic rules only). */
export function nameRelatesToRequest(userQuery: string, targetName: string): boolean {
  const queries = extractSearchQueries(userQuery)
  const candidates = queries.length > 0 ? queries : [userQuery]
  for (const q of candidates) {
    const eq = namesMatch(q, targetName)
    if (eq !== 'none') return true

    const qc = compactName(q)
    const tc = compactName(targetName)
    if (qc.length >= 4 && tc.includes(qc)) return true
    if (tc.length >= 4 && qc.includes(tc)) return true

    // Light fuzzy: same length ±2 and edit distance ≤ 2 on compact forms
    if (qc.length >= 5 && tc.length >= 5 && editDistance(qc, tc) <= 2) return true
  }

  // Fallback: any significant token from the utterance compact-matches
  const tokens = normalizeName(userQuery)
    .split(' ')
    .filter((t) => t.length >= 4)
  const tc = compactName(targetName)
  return tokens.some((t) => {
    const c = compactName(t)
    return c === tc || (c.length >= 4 && (tc.includes(c) || c.includes(tc)))
  })
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}
