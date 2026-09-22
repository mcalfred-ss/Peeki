import './styles.css'
import type { ScreenHighlight } from '../../../modules/shared'

type AbsoluteDipMark = {
  id?: string
  left: number
  top: number
  width: number
  height: number
  label?: string
  style: 'rect' | 'circle' | 'arrow'
  debugKind?: 'a-physical' | 'b-already-dip' | 'normal'
}

type PaintPayload = {
  highlights: ScreenHighlight[]
  display: { width: number; height: number } | null
  coordMap?: {
    offsetX: number
    offsetY: number
    width: number
    height: number
  }
  displayOrigin?: { x: number; y: number }
  absoluteMarks?: AbsoluteDipMark[]
  debugOverlay?: boolean
}

const layerEl = document.getElementById('layer')
if (!(layerEl instanceof HTMLElement)) {
  throw new Error('Highlight layer missing')
}
const layer = layerEl

function render(payload: PaintPayload): void {
  layer.innerHTML = ''
  if (!payload.display) return

  const abs = payload.absoluteMarks ?? []
  if (abs.length > 0) {
    for (const mark of abs) {
      const el = document.createElement('div')
      el.className =
        mark.style === 'circle' || mark.style === 'arrow' || !payload.debugOverlay
          ? 'mark mark-circle mark-dot'
          : 'mark'
      if (mark.debugKind === 'a-physical') el.classList.add('debug-a')
      if (mark.debugKind === 'b-already-dip') el.classList.add('debug-b')
      if (mark.id?.startsWith('calib-') || mark.label?.startsWith('P1') || mark.label?.startsWith('P2')) {
        el.classList.add('calib')
      }

      el.style.left = `${mark.left}px`
      el.style.top = `${mark.top}px`
      el.style.width = `${mark.width}px`
      el.style.height = `${mark.height}px`

      if (mark.style !== 'circle') {
        const r = Math.max(6, Math.min(12, Math.round(Math.min(mark.width, mark.height) * 0.18)))
        el.style.borderRadius = `${r}px`
      }

      if (mark.label) {
        const label = document.createElement('div')
        label.className = 'label'
        label.textContent = mark.label
        if (mark.top < 40) label.style.top = 'calc(100% + 8px)'
        el.appendChild(label)
      }

      // Report computed CSS only in developer debug mode
      if (
        payload.debugOverlay &&
        (mark.style === 'rect' || mark.debugKind === 'a-physical') &&
        mark.label
      ) {
        console.log(
          [
            '=== PEEKI CSS APPLIED ===',
            `label: ${mark.label}`,
            `debugKind: ${mark.debugKind ?? 'normal'}`,
            `CSS left: ${el.style.left}`,
            `CSS top: ${el.style.top}`,
            `CSS width: ${el.style.width}`,
            `CSS height: ${el.style.height}`,
            `devicePixelRatio: ${window.devicePixelRatio}`,
            `inner: ${window.innerWidth}x${window.innerHeight}`,
            '========================='
          ].join('\n')
        )
      }

      layer.appendChild(el)
    }
    return
  }

  if (payload.highlights.length === 0) return

  const map = payload.coordMap ?? {
    offsetX: 0,
    offsetY: 0,
    width: payload.display.width,
    height: payload.display.height
  }
  const origin = payload.displayOrigin ?? { x: 0, y: 0 }

  for (const mark of payload.highlights) {
    const el = document.createElement('div')
    el.className = 'mark mark-circle mark-dot'
    // Place the dot at the center of the highlight box
    const boxLeft = origin.x + map.offsetX + mark.x * map.width
    const boxTop = origin.y + map.offsetY + mark.y * map.height
    const boxW = Math.max(1, mark.width * map.width)
    const boxH = Math.max(1, mark.height * map.height)
    const size = 22
    el.style.left = `${boxLeft + boxW / 2 - size / 2}px`
    el.style.top = `${boxTop + boxH / 2 - size / 2}px`
    el.style.width = `${size}px`
    el.style.height = `${size}px`

    if (mark.label) {
      const label = document.createElement('div')
      label.className = 'label'
      label.textContent = mark.label
      el.appendChild(label)
    }

    layer.appendChild(el)
  }
}

window.peeki.onHighlightsPaint((payload) => {
  render(payload as PaintPayload)
})
