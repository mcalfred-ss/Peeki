import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

function psEscape(value: string): string {
  return value.replace(/'/g, "''")
}

async function runPowerShell(script: string): Promise<void> {
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 1024 * 1024
    }
  )
}

/**
 * Minimal Windows input helpers via user32 (no native addon).
 */
export async function mouseClickAt(screenX: number, screenY: number): Promise<void> {
  const x = Math.round(screenX)
  const y = Math.round(screenY)
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PeekiMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
}
"@
[PeekiMouse]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 40
[PeekiMouse]::mouse_event(0x0002, 0, 0, 0, 0)
Start-Sleep -Milliseconds 30
[PeekiMouse]::mouse_event(0x0004, 0, 0, 0, 0)
`
  await runPowerShell(script)
}

export async function typeText(text: string): Promise<void> {
  const safe = psEscape(text)
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${safe}')
`
  await runPowerShell(script)
}

export async function sendHotkey(keys: string): Promise<void> {
  // Expect value like "^s" (Ctrl+S) or "%{F4}" style SendKeys
  const safe = psEscape(keys)
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${safe}')
`
  await runPowerShell(script)
}

export async function scrollAt(
  screenX: number,
  screenY: number,
  amount: number
): Promise<void> {
  const x = Math.round(screenX)
  const y = Math.round(screenY)
  const wheel = Math.round(amount)
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PeekiScroll {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
"@
[PeekiScroll]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 30
[PeekiScroll]::mouse_event(0x0800, 0, 0, ${wheel}, 0)
`
  await runPowerShell(script)
}
