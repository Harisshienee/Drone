import { channel, type Controls } from './realtime'
import './styles.css'

const controls: Controls = { leftY: 0, rightX: 0, rightY: 0 }

const statusEl = document.getElementById('status')!
const leftValue = document.getElementById('left-value')!
const rightValue = document.getElementById('right-value')!

// Touch joystick. Reports x/y in -1..1 with up = +y, and snaps back to 0 on release.
function stick(zone: HTMLElement, verticalOnly: boolean, onMove: (x: number, y: number) => void) {
  const knob = zone.querySelector<HTMLElement>('.knob')!
  let pointer: number | null = null

  const move = (e: PointerEvent) => {
    const rect = zone.getBoundingClientRect()
    const radius = rect.width / 2
    let x = verticalOnly ? 0 : (e.clientX - rect.left - radius) / radius
    let y = (e.clientY - rect.top - radius) / radius
    const length = Math.hypot(x, y)
    if (length > 1) {
      x /= length
      y /= length
    }
    knob.style.transform = `translate(${x * radius * 0.6}px, ${y * radius * 0.6}px)`
    onMove(x, -y)
  }

  const release = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return
    pointer = null
    knob.style.transform = ''
    onMove(0, 0)
  }

  zone.addEventListener('pointerdown', (e) => {
    if (pointer !== null) return
    pointer = e.pointerId
    zone.setPointerCapture(e.pointerId)
    move(e)
  })
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId === pointer) move(e)
  })
  zone.addEventListener('pointerup', release)
  zone.addEventListener('pointercancel', release)
}

stick(document.getElementById('left')!, true, (_x, y) => {
  controls.leftY = y
  leftValue.textContent = `Y: ${y.toFixed(2)}`
})

stick(document.getElementById('right')!, false, (x, y) => {
  controls.rightX = x
  controls.rightY = y
  rightValue.textContent = `X: ${x.toFixed(2)} Y: ${y.toFixed(2)}`
})

let connected = false

if (channel) {
  channel.subscribe((status) => {
    connected = status === 'SUBSCRIBED'
    statusEl.textContent = connected ? 'Connected ●' : 'Connecting…'
    statusEl.style.color = connected ? '#7CFC8A' : ''
  })
} else {
  statusEl.textContent = 'Supabase keys missing — see .env.example'
  statusEl.style.color = '#ff8a80'
}

// 20 messages/second while flying; a slower heartbeat when idle so the laptop knows we're here
const HEARTBEAT_MS = 300
let lastSent = 0
let wasIdle = true

setInterval(() => {
  if (!channel || !connected) return
  const idle = controls.leftY === 0 && controls.rightX === 0 && controls.rightY === 0
  const now = performance.now()
  // The first zero after a release must go out at once, or the drone keeps flying on stale input
  if (idle && wasIdle && now - lastSent < HEARTBEAT_MS) return
  wasIdle = idle
  lastSent = now
  channel.send({ type: 'broadcast', event: 'control', payload: controls })
}, 50)

document.getElementById('reset')!.addEventListener('click', () => {
  if (!channel || !connected) return
  channel.send({ type: 'broadcast', event: 'reset', payload: {} })
})
