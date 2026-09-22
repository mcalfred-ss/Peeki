import './styles.css'

const orbElement = document.getElementById('peeki-orb')
if (!(orbElement instanceof HTMLButtonElement)) {
  throw new Error('Peeki orb button missing')
}
const orb = orbElement

const DRAG_THRESHOLD_PX = 4

let pointerId: number | null = null
let startX = 0
let startY = 0
let dragged = false

orb.addEventListener('pointerdown', (event: PointerEvent) => {
  if (event.button === 2) return
  pointerId = event.pointerId
  startX = event.screenX
  startY = event.screenY
  dragged = false
  orb.setPointerCapture(pointerId)
  orb.classList.add('is-dragging')
})

orb.addEventListener('pointermove', (event: PointerEvent) => {
  if (pointerId === null || event.pointerId !== pointerId) return

  const dx = event.screenX - startX
  const dy = event.screenY - startY
  if (!dragged && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
    dragged = true
  }

  if (dragged) {
    window.peeki.dragOverlay({
      screenX: event.screenX,
      screenY: event.screenY
    })
  }
})

function endPointer(event: PointerEvent): void {
  if (pointerId === null || event.pointerId !== pointerId) return

  orb.releasePointerCapture(pointerId)
  orb.classList.remove('is-dragging')
  pointerId = null

  if (dragged) {
    void window.peeki.endOverlayDrag()
  } else {
    void window.peeki.clickOverlay()
  }
}

orb.addEventListener('pointerup', endPointer)
orb.addEventListener('pointercancel', endPointer)

orb.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  void window.peeki.openOrbMenu()
})

window.peeki.onWatchState(({ enabled }) => {
  orb.classList.toggle('is-watching', enabled)
  orb.title = enabled
    ? 'Watching with you · Click to ask · Right-click for menu'
    : 'Drag to move · Click to ask · Right-click for menu'
})

void window.peeki.getWatchStatus().then((status) => {
  orb.classList.toggle('is-watching', status.enabled)
  if (status.enabled) {
    orb.title = 'Watching with you · Click to ask · Right-click for menu'
  }
})
