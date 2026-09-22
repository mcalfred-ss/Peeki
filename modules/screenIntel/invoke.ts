/**
 * UIA action path — prefer InvokePattern over guessed mouse clicks.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mouseClickAt } from '../actions/windowsInput'
import type { PhysicalRect } from '../shared/screenIntel'
import { rectCenter } from './coords'

const execFileAsync = promisify(execFile)

export type InvokeResult = {
  ok: boolean
  method: 'invoke' | 'click-center' | 'none'
  message: string
}

/**
 * Try InvokePattern on a named UIA element near the given physical bounds.
 * Falls back to clicking the center of verifiedBounds when Invoke fails
 * or when allowVisionClick is false and no UIA hit is found.
 */
export async function invokeOrClick(options: {
  name: string
  verifiedBounds: PhysicalRect
  /** If true, allow click even without UIA confirmation (dangerous for vision-only). */
  allowUnverifiedClick?: boolean
  source?: string
  timeoutMs?: number
}): Promise<InvokeResult> {
  const timeoutMs = options.timeoutMs ?? 2500
  const nameEsc = options.name.replace(/'/g, "''")
  const b = options.verifiedBounds
  const cx = Math.round(b.x + b.width / 2)
  const cy = Math.round(b.y + b.height / 2)

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$targetName = '${nameEsc}'
$cx = ${cx}; $cy = ${cy}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NameProperty, $targetName
)
$candidates = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
$best = $null
$bestDist = [double]::MaxValue
foreach ($el in $candidates) {
  try {
    $r = $el.Current.BoundingRectangle
    $ex = $r.X + $r.Width/2
    $ey = $r.Y + $r.Height/2
    $d = [Math]::Abs($ex - $cx) + [Math]::Abs($ey - $cy)
    if ($d -lt $bestDist -and $d -lt 120) {
      $bestDist = $d
      $best = $el
    }
  } catch {}
}
if (-not $best) { Write-Output 'MISS'; exit 0 }

try {
  $pat = $best.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  if ($pat) {
    $pat.Invoke()
    Write-Output 'INVOKE'
    exit 0
  }
} catch {}
Write-Output 'NOINVOKE'
`

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 }
    )
    const result = String(stdout || '').trim()
    if (result === 'INVOKE') {
      return { ok: true, method: 'invoke', message: `Invoked “${options.name}” via UIA.` }
    }
  } catch {
    // fall through to click
  }

  // Vision-only coords must not auto-click important controls
  if (options.source === 'vision' && !options.allowUnverifiedClick) {
    return {
      ok: false,
      method: 'none',
      message: 'Vision-only target — refusing automatic click. Confirm the highlight first.'
    }
  }

  const center = rectCenter(options.verifiedBounds)
  await mouseClickAt(center.x, center.y)
  return {
    ok: true,
    method: 'click-center',
    message: `Clicked center of verified bounds for “${options.name}”.`
  }
}
