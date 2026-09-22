/**
 * Peeki self-check — pure logic harness (no GUI).
 * Run: npm run selfcheck
 * Use this as the baseline loop: fail → fix → re-run until green.
 */
import assert from 'node:assert/strict'
import {
  isInventoryRequest,
  isCoachingRequest,
  isProgressRequest,
  isPointingRequest,
  inferUserTargetIntent
} from '../modules/screenIntel/intent'
import { namesMatch, compactName, normalizeName } from '../modules/screenIntel/normalize'
import { marksFromMatch } from '../modules/screenIntel/debugLog'
import { isPeekiUiName } from '../modules/screenIntel/coachFilter'
import { planSession } from '../modules/screenIntel/sessionPlan'
import type { TargetMatch } from '../modules/shared/screenIntel'

type Case = { name: string; run: () => void }

const cases: Case[] = []

function test(name: string, run: () => void): void {
  cases.push({ name, run })
}

// --- Intent routing (product core) ---

test('done / next are progress, not locate', () => {
  for (const q of ['done', 'Done', 'next', 'I did that', "what's next", 'continue']) {
    assert.equal(isProgressRequest(q), true, q)
    assert.equal(isPointingRequest(q), false, q)
    assert.equal(inferUserTargetIntent(q), 'progress', q)
  }
})

test('find / where is are pointing', () => {
  for (const q of ['where is Recycle Bin', 'find the Save button', 'point to File']) {
    assert.equal(isPointingRequest(q), true, q)
    assert.equal(isProgressRequest(q), false, q)
    assert.equal(isCoachingRequest(q), false, q)
  }
})

test('help me design is coaching, not locate Photoshop by title', () => {
  const q = 'help me design'
  assert.equal(isCoachingRequest(q), true, q)
  assert.equal(isPointingRequest(q), false, q)
  assert.equal(inferUserTargetIntent(q), 'coaching', q)
})

test('desktop inventory is inventory', () => {
  for (const q of ['what apps are on my desktop', 'how many icons do I have']) {
    assert.equal(isInventoryRequest(q), true, q)
    assert.equal(isPointingRequest(q), false, q)
  }
})

// --- Name matching (environment-independent) ---

test('normalize / compact treat Git Bash variants as equal', () => {
  assert.equal(compactName('Git Bash'), 'gitbash')
  assert.equal(compactName('git-bash'), 'gitbash')
  assert.equal(namesMatch('Git Bash', 'gitbash'), 'compact')
  assert.equal(normalizeName("What's Next"), 'whats next')
})

// --- Pointer is a DOT, not a rectangle ---

test('marksFromMatch is a circle centered on the control (full hit bounds)', () => {
  const match: TargetMatch = {
    elementId: 'el-1',
    label: 'Save',
    source: 'uia',
    confidence: 1,
    matchKind: 'exact',
    bounds: { x: 100, y: 200, width: 80, height: 40 }
  }
  const marks = marksFromMatch(match)
  assert.equal(marks.length, 1)
  const m = marks[0]!
  assert.equal(m.style, 'circle')
  // Keep full control bounds for reach-to-dismiss
  assert.equal(m.bounds.width, 80)
  assert.equal(m.bounds.height, 40)
  const cx = match.bounds.x + match.bounds.width / 2
  const cy = match.bounds.y + match.bounds.height / 2
  const mx = m.bounds.x + m.bounds.width / 2
  const my = m.bounds.y + m.bounds.height / 2
  assert.ok(Math.abs(mx - cx) <= 1, `x center ${mx} vs ${cx}`)
  assert.ok(Math.abs(my - cy) <= 1, `y center ${my} vs ${cy}`)
})

// --- Never coach Peeki’s own chrome as the target ---

test('isPeekiUiName catches overlay chrome', () => {
  assert.equal(isPeekiUiName('Ask Peeki'), true)
  assert.equal(isPeekiUiName('Looking'), true)
  assert.equal(isPeekiUiName('Photoshop'), false)
  assert.equal(isPeekiUiName('File Explorer'), false)
})

// --- Session plan: Auto picks sensible mode ---

test('planSession: done prefers progress path', () => {
  const plan = planSession({
    instruction: 'done',
    settingsMode: 'auto',
    allowProposedActions: false
  })
  assert.equal(plan.progress, true)
  assert.equal(plan.pointing, false)
})

test('planSession: help me edit uses step coaching', () => {
  const plan = planSession({
    instruction: 'help me edit this photo',
    settingsMode: 'auto',
    allowProposedActions: false
  })
  assert.equal(plan.effectiveMode, 'step')
  assert.ok(plan.intent === 'coaching' || plan.reason.length > 0)
})

test('planSession: where is X is pointing + local-friendly', () => {
  const plan = planSession({
    instruction: 'where is Notepad',
    settingsMode: 'auto',
    allowProposedActions: false
  })
  assert.equal(plan.pointing, true)
  assert.equal(plan.progress, false)
})

async function main(): Promise<void> {
  let failed = 0
  for (const c of cases) {
    try {
      c.run()
      console.log(`  PASS  ${c.name}`)
    } catch (err) {
      failed += 1
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  FAIL  ${c.name}`)
      console.log(`        ${msg}`)
    }
  }
  console.log('')
  console.log(failed === 0 ? `All ${cases.length} checks passed.` : `${failed}/${cases.length} failed.`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
