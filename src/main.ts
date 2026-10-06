import * as THREE from 'three'
import QRCode from 'qrcode'
import { channel, type Controls } from './realtime'
import { compass, fetchWind } from './wind'
import './styles.css'

// World layout. +X is east, -Z is north (away from the camera), Y is up.
const REST_HEIGHT = 0.3 // drone centre height when sitting on a surface
const DECK = { minX: -12, maxX: 12, minZ: 6, maxZ: 18 }
const PAD = new THREE.Vector3(0, 0, 0)
const START = new THREE.Vector3(PAD.x, REST_HEIGHT, PAD.z) // every round begins on the pad
const PAD_RADIUS = 2.5
const RING_RADIUS = 1.8
const RING_POSITIONS = [
  new THREE.Vector3(-4, 4, -6),
  new THREE.Vector3(4, 6, -12),
  new THREE.Vector3(0, 3.5, -18),
]
const BOUNDS = 30
const CEILING = 25

// Tuning
const MOVE_ACCEL = 8
const CLIMB_ACCEL = 6
const DRAG = 1.2 // per second
// Wind push in m/s²: a small base so even a light breeze drifts visibly, plus a gentle
// per-km/h term so real gusts stay flyable
const WIND_BASE = 0.6
const WIND_FORCE = 0.06
const MAX_WIND_KMH = 60
const SAFE_LANDING_SPEED = 2
const PHONE_TIMEOUT_MS = 1000
const ROUND_SECONDS = 60
const TAKEOFF_HEIGHT = 1 // must climb this far above the pad before a landing counts

// ---------- Scene ----------

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.domElement.className = 'scene'
document.body.prepend(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x9fd3f0)
scene.fog = new THREE.Fog(0x9fd3f0, 40, 140)

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)
const CAMERA_OFFSET = new THREE.Vector3(0, 5, 9)

scene.add(new THREE.HemisphereLight(0xffffff, 0x1b4f72, 1.6))
const sun = new THREE.DirectionalLight(0xffffff, 1.8)
sun.position.set(10, 20, 8)
scene.add(sun)

const sea = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x1565c0, roughness: 0.4 }),
)
sea.rotation.x = -Math.PI / 2
sea.position.y = -0.6
scene.add(sea)

const deck = new THREE.Mesh(
  new THREE.BoxGeometry(DECK.maxX - DECK.minX, 0.6, DECK.maxZ - DECK.minZ),
  new THREE.MeshStandardMaterial({ color: 0x7d8590 }),
)
deck.position.set((DECK.minX + DECK.maxX) / 2, -0.3, (DECK.minZ + DECK.maxZ) / 2)
scene.add(deck)

const pad = new THREE.Mesh(
  new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS, 0.6, 40),
  new THREE.MeshStandardMaterial({ color: 0x2e7d32 }),
)
pad.position.set(PAD.x, -0.3, PAD.z)
scene.add(pad)

const padMarker = new THREE.Mesh(
  new THREE.RingGeometry(1.3, 1.6, 40),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
)
padMarker.rotation.x = -Math.PI / 2
padMarker.position.set(PAD.x, 0.01, PAD.z)
scene.add(padMarker)

const rings = RING_POSITIONS.map((position) => {
  // A torus lies in the XY plane by default, so the drone flies through it along Z
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, 0.12, 12, 48),
    new THREE.MeshStandardMaterial({ color: 0xffa726, emissive: 0xffa726, emissiveIntensity: 0.5 }),
  )
  mesh.position.copy(position)
  scene.add(mesh)
  return { mesh, collected: false }
})

const drone = new THREE.Group()
const rotors: THREE.Mesh[] = []
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x263238 })
  drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), dark))
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.08), dark)
    arm.rotation.y = angle
    drone.add(arm)
  }
  const rotorMaterial = new THREE.MeshStandardMaterial({ color: 0xeceff1 })
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 0.06), rotorMaterial)
    rotor.position.set(x * 0.5, 0.08, z * 0.5)
    drone.add(rotor)
    rotors.push(rotor)
  }
  // Red nose so the pilot can tell which way is forward
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.1, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xe53935 }),
  )
  nose.position.z = -0.3
  drone.add(nose)
}
scene.add(drone)

// Rides above the drone and points the way the wind is pushing it
// Built pointing along +Y, then rotated onto the wind direction
const windArrow = new THREE.Group()
const windArrowMaterial = new THREE.MeshBasicMaterial({ color: 0xffeb3b })
const windArrowShaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.07, 0.07, 1, 12).translate(0, 0.5, 0),
  windArrowMaterial,
)
const windArrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 16), windArrowMaterial)
windArrow.add(windArrowShaft, windArrowHead)
windArrow.visible = false
scene.add(windArrow)

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

// ---------- HUD ----------

const scoreEl = document.getElementById('score')!
const timeEl = document.getElementById('time')!
const messageEl = document.getElementById('message')!
const linkEl = document.getElementById('link')!
const windArrowEl = document.getElementById('wind-arrow')!
const windSpeedEl = document.getElementById('wind-speed')!
const windFromEl = document.getElementById('wind-from')!

let messageTimer = 0
function showMessage(text: string, ms?: number) {
  clearTimeout(messageTimer)
  messageEl.textContent = text
  if (ms) messageTimer = window.setTimeout(() => (messageEl.textContent = ''), ms)
}

const controllerUrl = new URL('/controller/', location.href).href
document.getElementById('controller-url')!.textContent = controllerUrl
QRCode.toCanvas(document.getElementById('qr') as HTMLCanvasElement, controllerUrl, {
  width: 120,
  margin: 1,
})

// ---------- Wind ----------

const windAccel = new THREE.Vector3()

async function refreshWind() {
  try {
    const wind = await fetchWind()
    // The API reports where the wind comes FROM; the drone is pushed the opposite way
    const radians = THREE.MathUtils.degToRad(wind.direction)
    const push = new THREE.Vector3(-Math.sin(radians), 0, Math.cos(radians))
    const strength =
      wind.speed > 0 ? WIND_BASE + Math.min(wind.speed, MAX_WIND_KMH) * WIND_FORCE : 0
    windAccel.copy(push).multiplyScalar(strength)

    windSpeedEl.textContent = `${wind.speed.toFixed(0)} km/h`
    windFromEl.textContent = `from ${compass(wind.direction)} (${wind.direction.toFixed(0)}°)`
    // Up on screen is north, so the arrow points where the wind is heading
    windArrowEl.style.transform = `rotate(${wind.direction + 180}deg)`

    windArrow.visible = wind.speed > 0
    windArrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), push)
    const shaftLength = 1.2 + Math.min(wind.speed, MAX_WIND_KMH) * 0.05
    windArrowShaft.scale.y = shaftLength
    windArrowHead.position.y = shaftLength + 0.3
  } catch (error) {
    console.error(error)
    // Keep flying on the last known wind; only say so if we never got a reading
    if (windAccel.lengthSq() === 0) windFromEl.textContent = 'wind unavailable'
  }
}
refreshWind()
setInterval(refreshWind, 60_000)

// ---------- Input ----------

const phone: Controls = { leftY: 0, rightX: 0, rightY: 0 }
let lastPhoneMessage = -Infinity
let channelUp = false

const axis = (value: unknown) => THREE.MathUtils.clamp(Number(value) || 0, -1, 1)

if (channel) {
  channel
    .on('broadcast', { event: 'control' }, ({ payload }) => {
      phone.leftY = axis(payload?.leftY)
      phone.rightX = axis(payload?.rightX)
      phone.rightY = axis(payload?.rightY)
      lastPhoneMessage = performance.now()
    })
    .on('broadcast', { event: 'reset' }, reset)
    .subscribe((status) => (channelUp = status === 'SUBSCRIBED'))
}

const keys = new Set<string>()
window.addEventListener('keydown', (e) => {
  keys.add(e.code)
  if (e.code === 'KeyR') reset()
})
window.addEventListener('keyup', (e) => keys.delete(e.code))
const keyAxis = (positive: string, negative: string) =>
  (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0)

// ---------- Game ----------

const velocity = new THREE.Vector3()
let score = 0
let over = false // landed or out of time; frozen until reset
let airborne = false // has left the pad, so touching it again is a landing
let startedAt: number | null = null
let remaining = ROUND_SECONDS

function reset() {
  drone.position.copy(START)
  velocity.set(0, 0, 0)
  score = 0
  over = false
  airborne = false
  startedAt = null
  remaining = ROUND_SECONDS
  for (const ring of rings) {
    ring.collected = false
    ring.mesh.material.color.set(0xffa726)
    ring.mesh.material.emissive.set(0xffa726)
  }
  showMessage('')
}

function overSurface(position: THREE.Vector3) {
  const onDeck =
    position.x >= DECK.minX &&
    position.x <= DECK.maxX &&
    position.z >= DECK.minZ &&
    position.z <= DECK.maxZ
  return onDeck || distanceToPad(position) <= PAD_RADIUS
}

function distanceToPad(position: THREE.Vector3) {
  return Math.hypot(position.x - PAD.x, position.z - PAD.z)
}

function update(dt: number, now: number) {
  const phoneLive = now - lastPhoneMessage < PHONE_TIMEOUT_MS
  linkEl.textContent = !channel
    ? 'Supabase keys missing — keyboard only'
    : phoneLive
      ? 'Phone connected ●'
      : channelUp
        ? 'Waiting for phone…'
        : 'Connecting…'
  linkEl.style.color = phoneLive ? '#7CFC8A' : ''

  if (!over && startedAt !== null) {
    remaining = Math.max(0, ROUND_SECONDS - (now - startedAt) / 1000)
    if (remaining === 0) {
      over = true
      velocity.set(0, 0, 0)
      showMessage('TIME UP\nRESET TO PLAY AGAIN')
    }
  }

  if (!over) {
    // A phone that has gone quiet counts as sticks released
    const leftY = axis((phoneLive ? phone.leftY : 0) + keyAxis('KeyW', 'KeyS'))
    const rightX = axis((phoneLive ? phone.rightX : 0) + keyAxis('ArrowRight', 'ArrowLeft'))
    const rightY = axis((phoneLive ? phone.rightY : 0) + keyAxis('ArrowUp', 'ArrowDown'))

    const position = drone.position
    const grounded = position.y <= REST_HEIGHT + 0.01 && overSurface(position)

    velocity.y += leftY * CLIMB_ACCEL * dt
    if (grounded) {
      // Sitting on the deck: no sliding and the wind can't move it
      velocity.x = 0
      velocity.z = 0
    } else {
      velocity.x += rightX * MOVE_ACCEL * dt
      velocity.z -= rightY * MOVE_ACCEL * dt
      velocity.x += windAccel.x * dt
      velocity.z += windAccel.z * dt
    }
    velocity.multiplyScalar(Math.exp(-DRAG * dt))

    const previousZ = position.z
    position.addScaledVector(velocity, dt)
    position.x = THREE.MathUtils.clamp(position.x, -BOUNDS, BOUNDS)
    position.z = THREE.MathUtils.clamp(position.z, -BOUNDS, BOUNDS)
    position.y = Math.min(position.y, CEILING)

    if (startedAt === null && position.y > REST_HEIGHT + 0.05) startedAt = now
    if (position.y > REST_HEIGHT + TAKEOFF_HEIGHT) airborne = true

    for (const ring of rings) {
      if (ring.collected) continue
      const ringPosition = ring.mesh.position
      const crossed = (previousZ - ringPosition.z) * (position.z - ringPosition.z) <= 0
      const inside =
        Math.hypot(position.x - ringPosition.x, position.y - ringPosition.y) < RING_RADIUS
      if (crossed && inside) {
        ring.collected = true
        ring.mesh.material.color.set(0x66bb6a)
        ring.mesh.material.emissive.set(0x66bb6a)
        score += 100
        showMessage('RING +100', 1200)
      }
    }

    if (overSurface(position)) {
      if (position.y <= REST_HEIGHT) {
        const impact = velocity.length()
        position.y = REST_HEIGHT
        const onPad = distanceToPad(position) < PAD_RADIUS - 0.5
        if (onPad && airborne && impact < SAFE_LANDING_SPEED) {
          over = true
          velocity.set(0, 0, 0)
          // 100 for the landing plus a point per second left on the clock
          const points = 100 + Math.floor(remaining)
          score += points
          showMessage(`LANDED!\n+${points}`)
        } else if (onPad && airborne) {
          velocity.set(0, 1.5, 0)
          showMessage('TOO FAST — EASE DOWN', 1200)
        } else {
          velocity.y = Math.max(0, velocity.y)
        }
      }
    } else if (position.y <= -0.3) {
      // In the sea: lose points and go back to the pad, clock keeps running
      score = Math.max(0, score - 50)
      position.copy(START)
      velocity.set(0, 0, 0)
      airborne = false
      showMessage('SPLASH! −50', 1500)
    }
  }

  scoreEl.textContent = String(score)
  timeEl.textContent = remaining.toFixed(1)

  // Lean into the direction of travel, spin the rotors
  drone.rotation.z = -velocity.x * 0.05
  drone.rotation.x = velocity.z * 0.05
  if (!over) for (const rotor of rotors) rotor.rotation.y += 40 * dt

  windArrow.position.copy(drone.position).setY(drone.position.y + 0.9)

  camera.position.lerp(drone.position.clone().add(CAMERA_OFFSET), 1 - Math.exp(-4 * dt))
  camera.lookAt(drone.position)
}

reset()
camera.position.copy(START).add(CAMERA_OFFSET)

let last = performance.now()
renderer.setAnimationLoop(() => {
  const now = performance.now()
  // Cap dt so a backgrounded tab doesn't fling the drone on return
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  update(dt, now)
  renderer.render(scene, camera)
})
