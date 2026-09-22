import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { OcrElement, PhysicalRect } from '../shared/screenIntel'
import type { ScreenCapture } from '../shared'

const execFileAsync = promisify(execFile)

type RawLine = {
  text?: string
  x?: number
  y?: number
  w?: number
  h?: number
}

/**
 * OCR via Windows.Media.Ocr (WinRT) when available.
 * Maps line boxes into physical screen space using capture metadata.
 * Returns [] if OCR is unavailable — vision remains the fallback.
 */
export async function scanOcr(
  capture: ScreenCapture,
  options?: { timeoutMs?: number }
): Promise<OcrElement[]> {
  if (!capture.dataUrl.startsWith('data:image')) return []

  const timeoutMs = options?.timeoutMs ?? 8000
  const dir = join(tmpdir(), 'peeki-ocr')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${randomUUID()}.jpg`)

  try {
    const b64 = capture.dataUrl.replace(/^data:image\/\w+;base64,/, '')
    writeFileSync(filePath, Buffer.from(b64, 'base64'))

    const script = `
$ErrorActionPreference = 'Stop'
$path = '${filePath.replace(/'/g, "''")}'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType=WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]

Function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { '[]'; exit 0 }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = @()
foreach ($line in $result.Lines) {
  $words = @($line.Words)
  if ($words.Count -lt 1) { continue }
  $minX = ($words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
  $minY = ($words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
  $maxX = ($words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
  $maxY = ($words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
  $lines += [pscustomobject]@{
    text = $line.Text
    x = [int]$minX
    y = [int]$minY
    w = [int]($maxX - $minX)
    h = [int]($maxY - $minY)
  }
}
$lines | ConvertTo-Json -Compress
`

    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024
      }
    )

    const text = String(stdout || '').trim()
    if (!text || text === '[]') return []

    const parsed = JSON.parse(text) as RawLine | RawLine[]
    const lines = Array.isArray(parsed) ? parsed : [parsed]

    const map = capture.coordMap
    const bounds = capture.displayBounds
    const scaleFactor =
      bounds && map
        ? // approx physical/DIP from map width vs capture
          capture.width / Math.max(1, map.width)
        : 1

    const elements: OcrElement[] = []
    for (const line of lines) {
      const t = String(line.text || '').trim()
      if (!t || t.length < 1) continue
      const ix = Number(line.x)
      const iy = Number(line.y)
      const iw = Number(line.w)
      const ih = Number(line.h)
      if (![ix, iy, iw, ih].every((v) => Number.isFinite(v)) || iw < 2 || ih < 2) continue

      // OCR boxes are in capture-image pixels → physical screen via coordMap + scale
      let rect: PhysicalRect
      if (map && bounds) {
        const nx = ix / Math.max(1, capture.width)
        const ny = iy / Math.max(1, capture.height)
        const nw = iw / Math.max(1, capture.width)
        const nh = ih / Math.max(1, capture.height)
        // DIP within display, then to physical using scaleFactor estimate
        const dipX = bounds.x + map.offsetX + nx * map.width
        const dipY = bounds.y + map.offsetY + ny * map.height
        const dipW = nw * map.width
        const dipH = nh * map.height
        const sf = Number.isFinite(scaleFactor) && scaleFactor > 0.5 ? scaleFactor : 1
        rect = {
          x: Math.round(dipX * sf),
          y: Math.round(dipY * sf),
          width: Math.round(dipW * sf),
          height: Math.round(dipH * sf)
        }
      } else {
        rect = { x: Math.round(ix), y: Math.round(iy), width: Math.round(iw), height: Math.round(ih) }
      }

      elements.push({
        id: randomUUID(),
        text: t.slice(0, 200),
        bounds: rect
      })
    }

    return elements.slice(0, 120)
  } catch {
    return []
  } finally {
    try {
      if (existsSync(filePath)) unlinkSync(filePath)
    } catch {
      // ignore
    }
  }
}
