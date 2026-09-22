/**
 * Universal name normalization for arbitrary apps/UI labels.
 * No application-specific aliases — works on any user's machine.
 */

/** Lowercase, trim, collapse whitespace, strip harmless punctuation. */
export function normalizeName(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`´]/g, '')
    .replace(/[._]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s+]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Compact form for equality: "Git Bash" / "git-bash" / "gitbash" → "gitbash" */
export function compactName(input: string): string {
  return normalizeName(input).replace(/\s+/g, '')
}

export type NameEquivalence = 'exact' | 'compact' | 'token' | 'fuzzy' | 'none'

/**
 * Compare query to candidate with progressive relaxation.
 * All rules are generic (no hardcoded product names).
 */
export function namesMatch(query: string, candidate: string): NameEquivalence {
  const qn = normalizeName(query)
  const cn = normalizeName(candidate)
  if (!qn || !cn) return 'none'

  if (qn === cn) return 'exact'

  const qc = compactName(query)
  const cc = compactName(candidate)
  if (qc && cc && qc === cc) return 'compact'

  // All query tokens appear as whole tokens in candidate (order-independent)
  const qTokens = qn.split(' ').filter(Boolean)
  const cTokens = cn.split(' ').filter(Boolean)
  if (
    qTokens.length > 0 &&
    qTokens.every((t) => cTokens.some((ct) => ct === t || compactName(ct) === compactName(t)))
  ) {
    return 'token'
  }

  // Light fuzzy on compact forms (typos / spacing variants)
  if (qc.length >= 5 && cc.length >= 5 && Math.abs(qc.length - cc.length) <= 2) {
    if (editDistance(qc, cc) <= 2) return 'fuzzy'
  }

  return 'none'
}

function editDistance(a: string, b: string): number {
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
