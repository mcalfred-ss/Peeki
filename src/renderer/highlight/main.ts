import './styles.css'
import type { ScreenHighlight } from '../../../modules/shared'

type PaintPayload = {
  highlights: ScreenHighlight[]
  display: { width: number; height: number } | null
}

const layerEl = document.getElementById('layer')
if (!(layerEl instanceof HTMLElement)) {
  throw new Error('Highlight layer missing')
}
const layer = layerEl

function render(payload: PaintPayload): void {
  layer.innerHTML = ''
  if (!payload.display || payload.highlights.length === 0) return

  const { width, height } = payload.display

  for (const mark of payload.highlights) {
    const el = document.createElement('div')
    el.className = 'mark'
    el.style.left = `${mark.x * width}px`
    el.style.top = `${mark.y * height}px`
    el.style.width = `${mark.width * width}px`
    el.style.height = `${mark.height * height}px`

    if (mark.label) {
      const label = document.createElement('div')
      label.className = 'label'
      label.textContent = mark.label
      if (mark.y * height < 40) {
        label.style.top = 'calc(100% + 8px)'
      }
      el.appendChild(label)
    }

    layer.appendChild(el)
  }
}

window.peeki.onHighlightsPaint((payload) => {
  render(payload as PaintPayload)
})
