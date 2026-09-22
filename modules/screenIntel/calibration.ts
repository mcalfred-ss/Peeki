/**
 * Physical-coordinate calibration: move cursor + draw 10×10 marks.
 * Uses AbsoluteMark physical bounds through the existing overlay path
 * (does not change conversion math — validates what the pipeline draws).
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AbsoluteMark } from '../shared/screenIntel'

const execFileAsync = promisify(execFile)

export type CalibrationPoint = { x: number; y: number; label: string }

export const DEFAULT_CALIBRATION_POINTS: CalibrationPoint[] = [
  { x: 100, y: 100, label: 'P1 100,100' },
  { x: 500, y: 500, label: 'P2 500,500' }
]

export function calibrationMarks(
  points: CalibrationPoint[] = DEFAULT_CALIBRATION_POINTS
): AbsoluteMark[] {
  return points.map((p, i) => ({
    id: `calib-${i}`,
    label: p.label,
    style: 'rect' as const,
    bounds: {
      x: p.x,
      y: p.y,
      width: 10,
      height: 10
    }
  }))
}

export async function moveCursorPhysical(x: number, y: number): Promise<void> {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PeekiCalib {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
"@
[PeekiCalib]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
`
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: 3000 }
  )
}

export async function runPhysicalCalibration(options: {
  showMarks: (marks: AbsoluteMark[]) => void
  points?: CalibrationPoint[]
  pauseMs?: number
}): Promise<string> {
  const points = options.points ?? DEFAULT_CALIBRATION_POINTS
  const pauseMs = options.pauseMs ?? 1200
  const lines: string[] = ['=== PEEKI PHYSICAL CALIBRATION ===']

  for (const p of points) {
    lines.push(`Move cursor → physical (${p.x}, ${p.y})`)
    console.log(`CALIB: SetCursorPos(${p.x}, ${p.y})`)
    await moveCursorPhysical(p.x, p.y)
    options.showMarks([
      {
        id: `calib-${p.x}-${p.y}`,
        label: p.label,
        style: 'rect',
        bounds: { x: p.x, y: p.y, width: 10, height: 10 }
      }
    ])
    lines.push(`Drew 10×10 mark at physical (${p.x}, ${p.y}) — compare cursor vs red square`)
    await new Promise((r) => setTimeout(r, pauseMs))
  }

  // Leave both marks visible
  options.showMarks(calibrationMarks(points))
  lines.push('Both marks left on screen. Hide highlights when done.')
  lines.push('=================================')
  const text = lines.join('\n')
  console.log(text)
  return text
}
