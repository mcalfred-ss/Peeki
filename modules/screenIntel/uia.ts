import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AppWindowInfo, PhysicalRect, UiElement } from '../shared/screenIntel'

const execFileAsync = promisify(execFile)

type RawNode = {
  name?: string
  role?: string
  x?: number
  y?: number
  w?: number
  h?: number
  enabled?: boolean
  automationId?: string
  app?: string
  patterns?: string
  className?: string
  processId?: number
  offscreen?: boolean
  method?: string
  controlType?: string
}

export type DesktopIconDetail = {
  name: string
  role: string
  controlType: string
  bounds: PhysicalRect
  automationId: string
  className: string
  processId: number
  offscreen: boolean
  method?: string
}

function asRect(n: RawNode): PhysicalRect | null {
  const x = Number(n.x)
  const y = Number(n.y)
  const width = Number(n.w)
  const height = Number(n.h)
  if (![x, y, width, height].every((v) => Number.isFinite(v))) return null
  if (width < 2 || height < 2) return null
  if (width > 8000 || height > 8000) return null
  return { x, y, width, height }
}

function parseNodes(stdout: string): RawNode[] {
  const text = String(stdout || '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as RawNode | RawNode[]
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    // PowerShell sometimes prepends warnings — try last JSON blob
    const start = text.indexOf('[')
    const startObj = text.indexOf('{')
    const i = start >= 0 ? start : startObj
    if (i < 0) return []
    try {
      const parsed = JSON.parse(text.slice(i)) as RawNode | RawNode[]
      return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return []
    }
  }
}

function toUiElement(node: RawNode, fallbackRole: string): UiElement | null {
  const bounds = asRect(node)
  const name = String(node.name || '').trim()
  if (!bounds || !name) return null
  const patterns = String(node.patterns || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  return {
    id: randomUUID(),
    name,
    role: String(node.role || fallbackRole),
    bounds,
    enabled: node.enabled !== false,
    visible: node.offscreen !== true,
    automationId: node.automationId ? String(node.automationId) : undefined,
    appName: String(node.app || '').trim() || undefined,
    patterns: patterns.length ? patterns : undefined
  }
}

async function runPs(
  script: string,
  timeoutMs: number,
  label: string
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  // -File is required: nested Add-Type @"..."@ here-strings break under -Command
  const tmp = join(tmpdir(), `peeki-uia-${label}-${Date.now()}.ps1`)
  try {
    writeFileSync(tmp, script, 'utf8')
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }
    )
    return { stdout: String(stdout || ''), stderr: String(stderr || ''), ok: true }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean }
    console.warn(
      `UIA ${label} failed:`,
      e.killed ? 'TIMEOUT' : e.message,
      (e.stderr || '').slice(0, 400)
    )
    return {
      stdout: String(e.stdout || ''),
      stderr: String(e.stderr || e.message || ''),
      ok: false
    }
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      // ignore
    }
  }
}

/**
 * Shared PowerShell helpers for desktop shell discovery.
 *
 * Desktop SysListView32 ("FolderView") often exposes ZERO UIA children via FindAll.
 * We try TreeWalkers first, then fall back to Win32 LVM_GETITEMCOUNT / LVM_GETITEMRECT /
 * LVM_GETITEMTEXTW against explorer's ListView HWND (cross-process).
 */
const PS_DESKTOP_HELPERS = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# Win32 ListView reader for desktop icons (UIA children are often empty)
if (-not ([System.Management.Automation.PSTypeName]'PeekiDesktopLV').Type) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;

public static class PeekiDesktopLV {
  const uint LVM_FIRST = 0x1000;
  const uint LVM_GETITEMCOUNT = LVM_FIRST + 4;
  const uint LVM_GETITEMRECT = LVM_FIRST + 14;
  const uint LVM_GETITEMTEXTW = LVM_FIRST + 115;
  const int LVIF_TEXT = 0x0001;
  const int LVIR_BOUNDS = 0;
  const int LVIR_ICON = 1;
  const uint PROCESS_VM_OPERATION = 0x0008;
  const uint PROCESS_VM_READ = 0x0010;
  const uint PROCESS_VM_WRITE = 0x0020;
  const uint PROCESS_QUERY_INFORMATION = 0x0400;
  const uint MEM_COMMIT = 0x1000;
  const uint MEM_RELEASE = 0x8000;
  const uint PAGE_READWRITE = 0x04;

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct LVITEM {
    public uint mask;
    public int iItem;
    public int iSubItem;
    public uint state;
    public uint stateMask;
    public IntPtr pszText;
    public int cchTextMax;
    public int iImage;
    public IntPtr lParam;
    public int iIndent;
    public int iGroupId;
    public uint cColumns;
    public IntPtr puColumns;
    public IntPtr piColFmt;
    public int iGroup;
  }

  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr h, IntPtr a, uint size, uint type, uint protect);
  [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr h, IntPtr a, uint size, uint type);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out int read);
  [DllImport("kernel32.dll")] static extern bool WriteProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out int written);

  public class Icon {
    public string name;
    public string controlType;
    public string className;
    public string automationId;
    public int x, y, w, h;
    public int processId;
    public string method;
  }

  public static int GetCount(IntPtr hwnd) {
    return SendMessage(hwnd, LVM_GETITEMCOUNT, IntPtr.Zero, IntPtr.Zero).ToInt32();
  }

  public static List<Icon> ReadIcons(IntPtr hwnd, int processId) {
    var result = new List<Icon>();
    int count = GetCount(hwnd);
    if (count <= 0 || hwnd == IntPtr.Zero) return result;

    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    IntPtr hProc = OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_INFORMATION, false, pid);
    if (hProc == IntPtr.Zero) return result;

    int rectSize = Marshal.SizeOf(typeof(RECT));
    int lvSize = Marshal.SizeOf(typeof(LVITEM));
    IntPtr remoteRect = VirtualAllocEx(hProc, IntPtr.Zero, (uint)rectSize, MEM_COMMIT, PAGE_READWRITE);
    IntPtr remoteBlock = VirtualAllocEx(hProc, IntPtr.Zero, (uint)(lvSize + 520), MEM_COMMIT, PAGE_READWRITE);
    if (remoteRect == IntPtr.Zero || remoteBlock == IntPtr.Zero) {
      if (remoteRect != IntPtr.Zero) VirtualFreeEx(hProc, remoteRect, 0, MEM_RELEASE);
      if (remoteBlock != IntPtr.Zero) VirtualFreeEx(hProc, remoteBlock, 0, MEM_RELEASE);
      CloseHandle(hProc);
      return result;
    }
    IntPtr remoteText = IntPtr.Add(remoteBlock, lvSize);

    try {
      for (int i = 0; i < count; i++) {
        // Bounds (client → screen)
        byte[] rectBytes = new byte[rectSize];
        BitConverter.GetBytes(LVIR_BOUNDS).CopyTo(rectBytes, 0);
        int written;
        WriteProcessMemory(hProc, remoteRect, rectBytes, rectSize, out written);
        SendMessage(hwnd, LVM_GETITEMRECT, new IntPtr(i), remoteRect);
        byte[] rectOut = new byte[rectSize];
        int read;
        ReadProcessMemory(hProc, remoteRect, rectOut, rectSize, out read);
        int left = BitConverter.ToInt32(rectOut, 0);
        int top = BitConverter.ToInt32(rectOut, 4);
        int right = BitConverter.ToInt32(rectOut, 8);
        int bottom = BitConverter.ToInt32(rectOut, 12);

        POINT p1 = new POINT { X = left, Y = top };
        POINT p2 = new POINT { X = right, Y = bottom };
        ClientToScreen(hwnd, ref p1);
        ClientToScreen(hwnd, ref p2);

        // Text via LVITEM in remote process
        LVITEM lvi = new LVITEM();
        lvi.mask = (uint)LVIF_TEXT;
        lvi.iItem = i;
        lvi.iSubItem = 0;
        lvi.pszText = remoteText;
        lvi.cchTextMax = 260;
        byte[] lvBytes = new byte[lvSize];
        IntPtr localLv = Marshal.AllocHGlobal(lvSize);
        Marshal.StructureToPtr(lvi, localLv, false);
        Marshal.Copy(localLv, lvBytes, 0, lvSize);
        Marshal.FreeHGlobal(localLv);
        WriteProcessMemory(hProc, remoteBlock, lvBytes, lvSize, out written);
        SendMessage(hwnd, LVM_GETITEMTEXTW, new IntPtr(i), remoteBlock);

        byte[] textBuf = new byte[520];
        ReadProcessMemory(hProc, remoteText, textBuf, 520, out read);
        string name = Encoding.Unicode.GetString(textBuf);
        int z = name.IndexOf((char)0);
        if (z >= 0) name = name.Substring(0, z);
        name = name.Trim();
        if (string.IsNullOrWhiteSpace(name)) continue;

        int w = Math.Max(1, p2.X - p1.X);
        int h = Math.Max(1, p2.Y - p1.Y);
        if (w < 4 || h < 4) continue;
        if (w > 500 || h > 500) continue;

        result.Add(new Icon {
          name = name,
          controlType = "ListItem",
          className = "SysListView32Item",
          automationId = "",
          x = p1.X, y = p1.Y, w = w, h = h,
          processId = processId > 0 ? processId : (int)pid,
          method = "win32-lvm"
        });
      }
    } finally {
      VirtualFreeEx(hProc, remoteRect, 0, MEM_RELEASE);
      VirtualFreeEx(hProc, remoteBlock, 0, MEM_RELEASE);
      CloseHandle(hProc);
    }
    return result;
  }
}
"@
}

function Get-Patterns($el) {
  $names = @()
  try {
    $null = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $names += 'Invoke'
  } catch {}
  try {
    $null = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $names += 'SelectionItem'
  } catch {}
  return ($names -join ',')
}

function Add-UiaIcon($el, $results, $method) {
  try {
    $name = $el.Current.Name
    if ([string]::IsNullOrWhiteSpace($name)) { return }
    $r = $el.Current.BoundingRectangle
    if ($r.Width -lt 4 -or $r.Height -lt 4) { return }
    if ($r.Width -gt 500 -or $r.Height -gt 500) { return }
    $results.Add([pscustomobject]@{
      name = $name
      role = 'DesktopIcon'
      controlType = [string]$el.Current.ControlType.ProgrammaticName
      x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height
      enabled = [bool]$el.Current.IsEnabled
      automationId = [string]$el.Current.AutomationId
      app = 'Desktop'
      patterns = (Get-Patterns $el)
      className = [string]$el.Current.ClassName
      processId = [int]$el.Current.ProcessId
      offscreen = [bool]$el.Current.IsOffscreen
      method = $method
    }) | Out-Null
  } catch {}
}

function Walk-Children($list, $walker, $results, $method) {
  try {
    $child = $walker.GetFirstChild($list)
    $n = 0
    while ($null -ne $child) {
      $n++
      Add-UiaIcon $child $results $method
      $child = $walker.GetNextSibling($child)
    }
    return $n
  } catch { return 0 }
}

function Collect-FromListView($list, $results) {
  if (-not $list) { return }

  $diag = New-Object System.Collections.Generic.List[string]
  $hwnd = [IntPtr]$list.Current.NativeWindowHandle
  $pid = [int]$list.Current.ProcessId
  $diag.Add(('ListView hwnd=' + $hwnd.ToInt64() + ' pid=' + $pid + ' name="' + $list.Current.Name + '"')) | Out-Null

  # --- UIA attempts (often return 0 on desktop FolderView) ---
  $itemCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ListItem
  )
  $trueCond = [System.Windows.Automation.Condition]::TrueCondition

  $byListItem = $list.FindAll([System.Windows.Automation.TreeScope]::Children, $itemCond)
  $diag.Add(('FindAll Children ListItem count=' + $byListItem.Count)) | Out-Null
  foreach ($el in $byListItem) { Add-UiaIcon $el $results 'uia-findall-listitem' }

  $byAllChildren = $list.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCond)
  $diag.Add(('FindAll Children TrueCondition count=' + $byAllChildren.Count)) | Out-Null
  if ($results.Count -eq 0) {
    foreach ($el in $byAllChildren) { Add-UiaIcon $el $results 'uia-findall-any' }
  }

  $byDesc = $list.FindAll([System.Windows.Automation.TreeScope]::Descendants, $itemCond)
  $diag.Add(('FindAll Descendants ListItem count=' + $byDesc.Count)) | Out-Null
  if ($results.Count -eq 0) {
    foreach ($el in $byDesc) { Add-UiaIcon $el $results 'uia-findall-desc' }
  }

  $rawN = Walk-Children $list ([System.Windows.Automation.TreeWalker]::RawViewWalker) $results 'uia-raw-walker'
  $diag.Add(('RawViewWalker children walked=' + $rawN)) | Out-Null
  if ($results.Count -eq 0) {
    $ctlN = Walk-Children $list ([System.Windows.Automation.TreeWalker]::ControlViewWalker) $results 'uia-control-walker'
    $diag.Add(('ControlViewWalker children walked=' + $ctlN)) | Out-Null
  }
  if ($results.Count -eq 0) {
    $cntN = Walk-Children $list ([System.Windows.Automation.TreeWalker]::ContentViewWalker) $results 'uia-content-walker'
    $diag.Add(('ContentViewWalker children walked=' + $cntN)) | Out-Null
  }

  # --- Win32 LVM fallback (reliable for desktop icons) ---
  if ($hwnd -ne [IntPtr]::Zero) {
    $lvmCount = [PeekiDesktopLV]::GetCount($hwnd)
    $diag.Add(('Win32 LVM_GETITEMCOUNT=' + $lvmCount)) | Out-Null
    if ($results.Count -eq 0 -and $lvmCount -gt 0) {
      $icons = [PeekiDesktopLV]::ReadIcons($hwnd, $pid)
      $diag.Add(('Win32 LVM icons read=' + $icons.Count)) | Out-Null
      foreach ($ic in $icons) {
        $results.Add([pscustomobject]@{
          name = $ic.name
          role = 'DesktopIcon'
          controlType = $ic.controlType
          x = $ic.x; y = $ic.y; w = $ic.w; h = $ic.h
          enabled = $true
          automationId = $ic.automationId
          app = 'Desktop'
          patterns = 'Invoke'
          className = $ic.className
          processId = $ic.processId
          offscreen = $false
          method = $ic.method
        }) | Out-Null
      }
    }
  } else {
    $diag.Add('Win32 skipped: NativeWindowHandle is 0') | Out-Null
  }

  [Console]::Error.WriteLine('PEEKI_LV_DIAG:' + ($diag -join ' | '))
}

function Find-DesktopListViews($root) {
  $lists = New-Object System.Collections.Generic.List[object]
  $seen = @{}

  function Add-List($list) {
    if (-not $list) { return }
    try {
      $hwnd = [IntPtr]$list.Current.NativeWindowHandle
      $key = [string]$hwnd.ToInt64()
      if ($seen.ContainsKey($key)) { return }
      $seen[$key] = $true
      $lists.Add($list) | Out-Null
    } catch {}
  }

  $defCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'SHELLDLL_DefView'
  )
  $defViews = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $defCond)
  foreach ($dv in $defViews) {
    $listCond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'SysListView32'
    )
    $list = $dv.FindFirst([System.Windows.Automation.TreeScope]::Children, $listCond)
    if (-not $list) {
      $list = $dv.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $listCond)
    }
    Add-List $list
  }

  foreach ($cn in @('Progman', 'WorkerW')) {
    $hostCond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ClassNameProperty, $cn
    )
    $hosts = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $hostCond)
    foreach ($h in $hosts) {
      $listCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'SysListView32'
      )
      Add-List ($h.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $listCond))
    }
  }

  return $lists
}
`

/**
 * Dump the desktop shell UIA hierarchy + every icon with bounds.
 */
export async function diagnoseDesktopUia(timeoutMs = 12000): Promise<{
  treeText: string
  icons: DesktopIconDetail[]
}> {
  const script = `
${PS_DESKTOP_HELPERS}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$tree = New-Object System.Collections.Generic.List[string]
$icons = New-Object System.Collections.Generic.List[object]

function Describe($el) {
  try {
    $n = $el.Current.Name
    $c = $el.Current.ClassName
    $t = $el.Current.ControlType.ProgrammaticName
    $r = $el.Current.BoundingRectangle
    $bx = [int]$r.X; $by = [int]$r.Y; $bw = [int]$r.Width; $bh = [int]$r.Height
    return ('[' + $t + '] class=' + $c + ' name="' + $n + '" bounds=' + $bx + ',' + $by + ' ' + $bw + 'x' + $bh)
  } catch { return '[error]' }
}

$tree.Add('Desktop root') | Out-Null

# Progman
$progCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Progman'
)
$progman = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $progCond)
if ($progman) {
  $tree.Add('  └─ Progman  ' + (Describe $progman)) | Out-Null
  $trueCond = [System.Windows.Automation.Condition]::TrueCondition
  $kids = $progman.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCond)
  foreach ($k in $kids) {
    $tree.Add('      └─ ' + (Describe $k)) | Out-Null
    $gk = $k.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCond)
    foreach ($g in $gk) {
      $tree.Add('          └─ ' + (Describe $g)) | Out-Null
    }
  }
} else {
  $tree.Add('  └─ Progman (NOT FOUND)') | Out-Null
}

# WorkerW hosts
$workerCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'WorkerW'
)
$workers = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $workerCond)
$tree.Add(('  WorkerW count=' + $workers.Count)) | Out-Null
$wi = 0
foreach ($w in $workers) {
  $tree.Add(('      WorkerW[' + $wi + ']  ' + (Describe $w))) | Out-Null
  $trueCond = [System.Windows.Automation.Condition]::TrueCondition
  $kids = $w.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCond)
  foreach ($k in $kids) {
    $tree.Add(('          ' + (Describe $k))) | Out-Null
    $gk = $k.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCond)
    foreach ($g in $gk) {
      $tree.Add(('              ' + (Describe $g))) | Out-Null
    }
  }
  $wi++
}

# SHELLDLL_DefView summary
$defCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'SHELLDLL_DefView'
)
$defs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $defCond)
$tree.Add(('SHELLDLL_DefView count=' + $defs.Count)) | Out-Null

# Collect icons via helper
$lists = Find-DesktopListViews $root
$tree.Add(('SysListView32 candidates=' + $lists.Count)) | Out-Null
foreach ($list in $lists) {
  $tree.Add(('  ListView  ' + (Describe $list))) | Out-Null
  Collect-FromListView $list $icons
}

# Deduplicate icons by name+bounds
$unique = New-Object System.Collections.Generic.List[object]
$seen = @{}
foreach ($ic in $icons) {
  $key = ($ic.name + '|' + $ic.x + '|' + $ic.y + '|' + $ic.w + '|' + $ic.h)
  if ($seen.ContainsKey($key)) { continue }
  $seen[$key] = $true
  $unique.Add($ic) | Out-Null
  $tree.Add(('    - ' + $ic.name + '  type=' + $ic.controlType + ' method=' + $ic.method + '  ' + $ic.w + 'x' + $ic.h + ' @ ' + $ic.x + ',' + $ic.y)) | Out-Null
}

[pscustomobject]@{
  tree = ($tree -join [Environment]::NewLine)
  icons = $unique
} | ConvertTo-Json -Depth 6 -Compress
`

  const { stdout, ok } = await runPs(script, timeoutMs, 'diagnoseDesktop')
  if (!ok && !stdout.trim()) {
    return { treeText: 'diagnose failed (timeout or PowerShell error)', icons: [] }
  }

  try {
    const text = stdout.trim()
    const start = text.indexOf('{')
    const parsed = JSON.parse(start >= 0 ? text.slice(start) : text) as {
      tree?: string
      icons?: RawNode[]
    }
    const icons: DesktopIconDetail[] = []
    for (const n of parsed.icons || []) {
      const bounds = asRect(n)
      if (!bounds || !n.name) continue
      icons.push({
        name: String(n.name),
        role: String(n.role || 'DesktopIcon'),
        controlType: String(n.controlType || 'ListItem'),
        bounds,
        automationId: String(n.automationId || ''),
        className: String(n.className || ''),
        processId: Number(n.processId || 0),
        offscreen: Boolean(n.offscreen),
        method: n.method ? String(n.method) : undefined
      })
    }
    const treeText = String(parsed.tree || '')
    console.log('=== PEEKI DESKTOP UIA DIAGNOSE ===\n' + treeText + '\n=================================')
    console.log(
      'Desktop icons JSON:\n' +
        JSON.stringify(
          icons.map((i) => ({
            name: i.name,
            controlType: i.controlType,
            className: i.className,
            automationId: i.automationId,
            bounds: i.bounds,
            processId: i.processId,
            method: i.method
          })),
          null,
          2
        )
    )
    return { treeText, icons }
  } catch (e) {
    console.warn('diagnoseDesktop parse failed', e, stdout.slice(0, 500))
    return { treeText: stdout.slice(0, 2000), icons: [] }
  }
}

/**
 * Desktop icons via SHELLDLL_DefView / Progman / WorkerW → SysListView32.
 * Does NOT filter out IsOffscreen (that was causing desktop=0).
 */
async function scanDesktopIcons(timeoutMs: number): Promise<UiElement[]> {
  const script = `
${PS_DESKTOP_HELPERS}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$results = New-Object System.Collections.Generic.List[object]
$lists = Find-DesktopListViews $root
foreach ($list in $lists) { Collect-FromListView $list $results }

# Deduplicate
$unique = New-Object System.Collections.Generic.List[object]
$seen = @{}
foreach ($ic in $results) {
  $key = ($ic.name + '|' + $ic.x + '|' + $ic.y)
  if ($seen.ContainsKey($key)) { continue }
  $seen[$key] = $true
  $unique.Add($ic) | Out-Null
}
Write-Output ('PEEKI_DESKTOP_COUNT=' + $unique.Count)
$unique | ConvertTo-Json -Compress
`

  const { stdout, stderr, ok } = await runPs(script, timeoutMs, 'scanDesktop')
  if (stderr.includes('PEEKI_LV_DIAG:')) {
    for (const line of stderr.split(/\r?\n/)) {
      if (line.includes('PEEKI_LV_DIAG:')) console.log(line.trim())
    }
  }
  if (!stdout.trim()) {
    console.warn(`UIA desktop: empty stdout ok=${ok} stderr=${stderr.slice(0, 300)}`)
    return []
  }

  const countLine = stdout.match(/PEEKI_DESKTOP_COUNT=(\d+)/)
  if (countLine) {
    console.log(`UIA desktop raw count from PS: ${countLine[1]}`)
  }

  const out: UiElement[] = []
  const seen = new Set<string>()
  for (const node of parseNodes(stdout.replace(/PEEKI_DESKTOP_COUNT=\d+\r?\n?/, ''))) {
    const el = toUiElement(node, 'DesktopIcon')
    if (!el) continue
    const key = `${el.name}|${el.bounds.x}|${el.bounds.y}`
    if (seen.has(key)) continue
    seen.add(key)
      console.log(
          `UIA DesktopIcon raw: name="${el.name}" x=${el.bounds.x} y=${el.bounds.y} w=${el.bounds.width} h=${el.bounds.height} method=${node.method || '?'} offscreen=${node.offscreen}`
        )
    out.push(el)
  }
  return out
}

/**
 * Taskbar buttons — Shell_TrayWnd + secondary trays; include ListItem (Win11).
 */
async function scanTaskbar(timeoutMs: number): Promise<UiElement[]> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$results = New-Object System.Collections.Generic.List[object]
$root = [System.Windows.Automation.AutomationElement]::RootElement

function Get-Patterns($el) {
  $names = @()
  try {
    $null = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $names += 'Invoke'
  } catch {}
  return ($names -join ',')
}

function Collect($parent, $limit) {
  if (-not $parent) { return }
  $types = @(
    [System.Windows.Automation.ControlType]::Button,
    [System.Windows.Automation.ControlType]::ListItem
  )
  $i = 0
  foreach ($ct in $types) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ct
    )
    $els = $parent.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($el in $els) {
      if ($i -ge $limit) { return }
      try {
        $name = $el.Current.Name
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $r = $el.Current.BoundingRectangle
        if ($r.Width -lt 6 -or $r.Height -lt 6) { continue }
        if ($r.Width -gt 480 -or $r.Height -gt 120) { continue }
        $results.Add([pscustomobject]@{
          name = $name
          role = 'TaskbarButton'
          x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height
          enabled = [bool]$el.Current.IsEnabled
          automationId = [string]$el.Current.AutomationId
          app = 'Taskbar'
          patterns = (Get-Patterns $el)
          className = [string]$el.Current.ClassName
          processId = [int]$el.Current.ProcessId
          offscreen = [bool]$el.Current.IsOffscreen
        }) | Out-Null
        $i++
      } catch {}
    }
  }
}

foreach ($cn in @('Shell_TrayWnd', 'Shell_SecondaryTrayWnd')) {
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, $cn
  )
  $trays = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  foreach ($tray in $trays) { Collect $tray 50 }
}

Write-Output ('PEEKI_TASKBAR_COUNT=' + $results.Count)
$results | ConvertTo-Json -Compress
`

  const { stdout, ok } = await runPs(script, timeoutMs, 'scanTaskbar')
  if (!stdout.trim()) {
    console.warn(`UIA taskbar: empty stdout ok=${ok}`)
    return []
  }
  const countLine = stdout.match(/PEEKI_TASKBAR_COUNT=(\d+)/)
  if (countLine) console.log(`UIA taskbar raw count from PS: ${countLine[1]}`)

  const out: UiElement[] = []
  for (const node of parseNodes(stdout.replace(/PEEKI_TASKBAR_COUNT=\d+\r?\n?/, ''))) {
    const el = toUiElement(node, 'TaskbarButton')
    if (el) out.push(el)
  }
  return out
}

async function scanWindowsShallow(
  maxElements: number,
  timeoutMs: number
): Promise<{
  applications: AppWindowInfo[]
  uiElements: UiElement[]
}> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$max = ${maxElements}
$results = New-Object System.Collections.Generic.List[object]
$root = [System.Windows.Automation.AutomationElement]::RootElement
$winCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Window
)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $winCond)

function Get-Patterns($el) {
  $names = @()
  try {
    $null = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $names += 'Invoke'
  } catch {}
  return ($names -join ',')
}

foreach ($win in $windows) {
  if ($results.Count -ge $max) { break }
  try {
    $appName = $win.Current.Name
    if ([string]::IsNullOrWhiteSpace($appName)) { continue }
    $r = $win.Current.BoundingRectangle
    if ($r.Width -lt 40 -or $r.Height -lt 40) { continue }
    $results.Add([pscustomobject]@{
      name = $appName; role = 'Window'
      x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height
      enabled = $true; automationId = ''; app = $appName
      patterns = (Get-Patterns $win)
    }) | Out-Null

    $types = @(
      [System.Windows.Automation.ControlType]::Button,
      [System.Windows.Automation.ControlType]::Edit,
      [System.Windows.Automation.ControlType]::Hyperlink,
      [System.Windows.Automation.ControlType]::MenuItem,
      [System.Windows.Automation.ControlType]::TabItem,
      [System.Windows.Automation.ControlType]::ListItem
    )
    foreach ($ct in $types) {
      if ($results.Count -ge $max) { break }
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ct
      )
      $els = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
      $i = 0
      foreach ($el in $els) {
        if ($results.Count -ge $max) { break }
        if ($i -ge 18) { break }
        $i++
        try {
          $name = $el.Current.Name
          if ([string]::IsNullOrWhiteSpace($name)) { continue }
          if ($el.Current.IsOffscreen) { continue }
          $br = $el.Current.BoundingRectangle
          if ($br.Width -lt 4 -or $br.Height -lt 4) { continue }
          $roleName = $ct.ProgrammaticName -replace 'ControlType\\.',''
          $results.Add([pscustomobject]@{
            name = $name; role = $roleName
            x = [int]$br.X; y = [int]$br.Y; w = [int]$br.Width; h = [int]$br.Height
            enabled = [bool]$el.Current.IsEnabled
            automationId = $el.Current.AutomationId
            app = $appName
            patterns = (Get-Patterns $el)
          }) | Out-Null
        } catch {}
      }
    }
  } catch {}
}

$results | ConvertTo-Json -Compress
`

  const { stdout } = await runPs(script, timeoutMs, 'scanWindows')
  const nodes = parseNodes(stdout)
  const applications: AppWindowInfo[] = []
  const uiElements: UiElement[] = []
  const seenApps = new Set<string>()

  for (const node of nodes) {
    const el = toUiElement(node, 'Unknown')
    if (!el) continue
    if (el.role === 'Window' && el.appName && !seenApps.has(el.appName)) {
      seenApps.add(el.appName)
      applications.push({ id: randomUUID(), name: el.appName, bounds: el.bounds })
    }
    uiElements.push(el)
  }

  return { applications, uiElements }
}

export async function scanUiAutomation(options?: {
  maxElements?: number
  timeoutMs?: number
}): Promise<{ applications: AppWindowInfo[]; uiElements: UiElement[] }> {
  const maxElements = options?.maxElements ?? 160
  const timeoutMs = options?.timeoutMs ?? 2800
  // Desktop scan needs enough time for shell tree walks
  const iconBudget = Math.max(3500, Math.min(8000, timeoutMs + 1500))

  const [desktop, taskbar] = await Promise.all([
    scanDesktopIcons(iconBudget),
    scanTaskbar(iconBudget)
  ])

  const remaining = Math.max(800, timeoutMs)
  const windowsPromise = scanWindowsShallow(maxElements, remaining)
  const windows = await new Promise<{
    applications: AppWindowInfo[]
    uiElements: UiElement[]
  }>((resolve) => {
    const timer = setTimeout(
      () => resolve({ applications: [], uiElements: [] }),
      remaining
    )
    windowsPromise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve({ applications: [], uiElements: [] })
      })
  })

  console.log(
    `UIA scan: desktop=${desktop.length} taskbar=${taskbar.length} windows=${windows.uiElements.length}`
  )

  // If desktop still empty, auto-run hierarchy dump once for diagnosis
  if (desktop.length === 0) {
    console.warn('UIA desktop=0 — running hierarchy diagnose…')
    try {
      await diagnoseDesktopUia(10000)
    } catch (e) {
      console.warn('diagnoseDesktopUia failed', e)
    }
  }

  return {
    applications: windows.applications,
    uiElements: [...desktop, ...taskbar, ...windows.uiElements].slice(
      0,
      maxElements + desktop.length + taskbar.length
    )
  }
}
