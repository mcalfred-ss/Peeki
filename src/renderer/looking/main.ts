import './styles.css'

const rim = document.getElementById('rim')
if (!(rim instanceof HTMLElement)) {
  throw new Error('Looking rim missing')
}

function setActive(active: boolean): void {
  rim.classList.toggle('is-on', active)
}

window.peeki.onLookingState((payload) => {
  setActive(Boolean(payload.active))
})
