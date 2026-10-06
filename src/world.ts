import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { Water } from 'three/addons/objects/Water.js'

// World layout. +X is east, -Z is north (away from the camera), Y is up.
export const REST_HEIGHT = 0.45 // drone centre height when sitting on a surface
// The quay is the backdrop on the far shore, beyond the flying area
export const DECK = { minX: -32, maxX: 32, minZ: -56, maxZ: -42 }
export const PAD = new THREE.Vector3(0, 0, 0)
export const PAD_RADIUS = 2.5
export const START = new THREE.Vector3(PAD.x, REST_HEIGHT, PAD.z) // every round begins on the pad
export const RING_RADIUS = 1.8
export const RING_POSITIONS = [
  new THREE.Vector3(-4, 4, -6),
  new THREE.Vector3(4, 6, -12),
  new THREE.Vector3(0, 3.5, -18),
]
const SEA_LEVEL = -0.6
const SUN_DIRECTION = new THREE.Vector3(0.65, 0.42, -0.6).normalize()

// ---------- Renderer, camera ----------

export const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.55
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.domElement.className = 'scene'
document.body.prepend(renderer.domElement)

export const scene = new THREE.Scene()
const HAZE = 0xc3d6e4
scene.fog = new THREE.Fog(HAZE, 120, 900)

export const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 20000)
export const CAMERA_OFFSET = new THREE.Vector3(0, 3.2, 8.5)

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

// ---------- Procedural textures ----------

// Small deterministic generator so the world looks the same on every load
let seed = 7
function random() {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  draw(canvas.getContext('2d')!)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  return texture
}

function speckle(ctx: CanvasRenderingContext2D, size: number, base: string, count: number) {
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < count; i++) {
    const shade = random() < 0.5 ? 0 : 255
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${random() * 0.07})`
    const s = 1 + random() * 3
    ctx.fillRect(random() * size, random() * size, s, s)
  }
}

// Tileable ripple normal map: a sum of sine waves with whole-number frequencies
function waterNormals(size = 256) {
  const waves = Array.from({ length: 28 }, () => {
    const fx = Math.round((random() - 0.5) * 18)
    const fy = Math.round((random() - 0.5) * 18)
    return { fx, fy, phase: random() * Math.PI * 2, amp: 1 / Math.max(1, Math.hypot(fx, fy)) }
  })
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0
      let dy = 0
      for (const w of waves) {
        const slope = w.amp * Math.cos(2 * Math.PI * ((w.fx * x + w.fy * y) / size) + w.phase)
        dx += slope * w.fx
        dy += slope * w.fy
      }
      const n = new THREE.Vector3(-dx * 0.12, -dy * 0.12, 1).normalize()
      const i = (y * size + x) * 4
      image.data[i] = (n.x * 0.5 + 0.5) * 255
      image.data[i + 1] = (n.y * 0.5 + 0.5) * 255
      image.data[i + 2] = (n.z * 0.5 + 0.5) * 255
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

// ---------- Sky, sun, sea ----------

const sky = new Sky()
sky.scale.setScalar(10000)
const skyUniforms = sky.material.uniforms
skyUniforms.turbidity.value = 2.5
skyUniforms.rayleigh.value = 0.9
skyUniforms.mieCoefficient.value = 0.004
skyUniforms.mieDirectionalG.value = 0.8
skyUniforms.sunPosition.value.copy(SUN_DIRECTION)

// Light everything from the sky itself so metal and water pick up real reflections
{
  const pmrem = new THREE.PMREMGenerator(renderer)
  const skyScene = new THREE.Scene()
  skyScene.add(sky)
  scene.environment = pmrem.fromScene(skyScene).texture
  pmrem.dispose()
}
// The sea's mirror pass would reflect the raw, unexposed sky as pure white. Keep the sky on a
// layer only the main camera sees, so the water reflects this plain sky blue instead.
const SKY_LAYER = 1
sky.layers.set(SKY_LAYER)
camera.layers.enable(SKY_LAYER)
scene.background = new THREE.Color(0x4f86b8)
scene.add(sky)

const sun = new THREE.DirectionalLight(0xfff1dc, 3.2)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = sun.shadow.camera.bottom = -18
sun.shadow.camera.right = sun.shadow.camera.top = 18
sun.shadow.camera.far = 120
sun.shadow.bias = -0.0005
scene.add(sun, sun.target)

const water = new Water(new THREE.PlaneGeometry(4000, 4000), {
  textureWidth: 512,
  textureHeight: 512,
  waterNormals: waterNormals(),
  sunDirection: SUN_DIRECTION,
  sunColor: 0xffffff,
  waterColor: 0x0a3d4f,
  distortionScale: 1.4,
  fog: true,
})
water.rotation.x = -Math.PI / 2
water.position.y = SEA_LEVEL
// Ripple scale: one tile of the normal map covers roughly 100 / size metres
water.material.uniforms.size.value = 14
scene.add(water)

// ---------- Harbour ----------

const concrete = new THREE.MeshStandardMaterial({
  map: canvasTexture(512, (ctx) => {
    speckle(ctx, 512, '#8f9396', 9000)
    // Expansion joints
    ctx.strokeStyle = 'rgba(40,40,40,0.35)'
    ctx.lineWidth = 2
    for (let i = 0; i <= 512; i += 128) {
      ctx.strokeRect(i, -2, 0.1, 516)
      ctx.strokeRect(-2, i, 516, 0.1)
    }
  }),
  roughness: 0.92,
  envMapIntensity: 0.4,
})
concrete.map!.wrapS = concrete.map!.wrapT = THREE.RepeatWrapping
concrete.map!.repeat.set(8, 2)

function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = mesh.receiveShadow = true
  scene.add(mesh)
  return mesh
}

const deckWidth = DECK.maxX - DECK.minX
const deckDepth = DECK.maxZ - DECK.minZ
const deckX = (DECK.minX + DECK.maxX) / 2
const deckZ = (DECK.minZ + DECK.maxZ) / 2
const edge = DECK.maxZ // seaward side, facing the pilot
box(deckWidth, 2.4, deckDepth, concrete, deckX, -1.2, deckZ)

const paint = (color: number, roughness = 0.6, metalness = 0.2) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness })

// Yellow safety line along the seaward edge, bollards, a dark fender strip at the waterline
box(deckWidth, 0.02, 0.3, paint(0xf2c318, 0.8, 0), deckX, 0.011, edge - 0.6)
box(deckWidth, 0.5, 0.2, paint(0x1b1b1b, 0.9, 0), deckX, -0.5, edge + 0.1)
for (let x = DECK.minX + 2; x <= DECK.maxX - 2; x += 6) {
  const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.5, 16), paint(0x222222))
  bollard.position.set(x, 0.25, edge - 0.25)
  bollard.castShadow = true
  scene.add(bollard)
}

// Shipping containers stacked at the back of the quay
const containerColors = [0xa63a2e, 0x2b5d8a, 0x3f7d4e, 0xc98a1b, 0x6d6f73]
const containerSlots: [number, number, number][] = [
  [-10, 0, 10], [-10, 1, 10], [-3.6, 0, 10], [2.8, 0, 10], [2.8, 1, 10], [2.8, 2, 10], [9.2, 0, 10],
  [-6.8, 0, 12.8], [-6.8, 1, 12.8], [6, 0, 12.8],
]
// Each slot is [x, stack level, distance back from the seaward edge]; repeated along the quay
;[-20, 0, 20].forEach((offset, block) =>
  containerSlots.forEach(([x, level, back], i) => {
    const color = containerColors[(i + block * 2) % containerColors.length]
    box(6, 2.5, 2.4, paint(color, 0.55, 0.5), x + offset, 1.25 + level * 2.5, edge - back)
  }),
)

// Gantry crane reaching out over the water
{
  const steel = paint(0xd9a514, 0.5, 0.6)
  for (const x of [9, 13]) for (const back of [2.5, 7]) box(0.4, 11, 0.4, steel, x, 5.5, edge - back)
  box(4.8, 0.5, 5.3, steel, 11, 11.2, edge - 4.75)
  box(0.6, 0.6, 22, steel, 11, 11.8, edge + 2)
  box(1.2, 0.9, 1.2, paint(0x333333), 11, 11.1, edge + 9)
  box(0.05, 4, 0.05, paint(0x111111), 11, 8.7, edge + 9)
}

// Hills on the far shore, softened by the haze
{
  const hill = new THREE.MeshStandardMaterial({ color: 0x3c5a3a, roughness: 1, envMapIntensity: 0.2 })
  const hills: [number, number, number, number][] = [
    [-420, -520, 260, 70], [-150, -600, 320, 95], [180, -560, 280, 60], [470, -500, 300, 85],
    [-620, -260, 240, 55], [640, -220, 260, 65],
  ]
  for (const [x, z, radius, height] of hills) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), hill)
    mesh.scale.set(radius, height, radius * 0.6)
    mesh.position.set(x, SEA_LEVEL - height * 0.25, z)
    scene.add(mesh)
  }
}

// ---------- Landing pad ----------

{
  const top = canvasTexture(512, (ctx) => {
    speckle(ctx, 512, '#3d4347', 7000)
    ctx.lineWidth = 16
    ctx.strokeStyle = '#f2c318'
    ctx.beginPath()
    ctx.arc(256, 256, 232, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = '#f4f4f4'
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.arc(256, 256, 150, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#f4f4f4'
    ctx.font = 'bold 190px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('H', 256, 266)
  })
  // The cylinder cap maps the texture sideways; turn it so the H reads upright to the pilot
  top.center.set(0.5, 0.5)
  top.rotation = Math.PI / 2
  const side = paint(0x4a4f53, 0.8, 0.3)
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS, 0.35, 48), [
    side,
    new THREE.MeshStandardMaterial({ map: top, roughness: 0.85, envMapIntensity: 0.4 }),
    side,
  ])
  pad.position.set(PAD.x, -0.175, PAD.z)
  pad.receiveShadow = true
  scene.add(pad)

  // Piles holding the platform above the water
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
    const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3, 12), paint(0x5b4a3a, 0.9, 0))
    pile.position.set(PAD.x + Math.cos(angle) * 1.9, -1.8, PAD.z + Math.sin(angle) * 1.9)
    scene.add(pile)
  }

  // Green perimeter lights
  const lamp = new THREE.MeshBasicMaterial({ color: 0x5dff8a })
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), lamp)
    light.position.set(
      PAD.x + Math.cos(angle) * (PAD_RADIUS - 0.08),
      0.04,
      PAD.z + Math.sin(angle) * (PAD_RADIUS - 0.08),
    )
    scene.add(light)
  }
}

// ---------- Rings ----------

export const rings = RING_POSITIONS.map((position) => {
  // A torus lies in the XY plane by default, so the drone flies through it along Z
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, 0.11, 16, 64),
    new THREE.MeshStandardMaterial({
      color: 0xffa726,
      emissive: 0xffa726,
      emissiveIntensity: 1.6,
      roughness: 0.3,
      metalness: 0.4,
    }),
  )
  mesh.position.copy(position)
  mesh.castShadow = true
  scene.add(mesh)
  return { mesh, collected: false }
})

// ---------- Drone ----------

export const drone = new THREE.Group()
export const rotors: THREE.Object3D[] = []
{
  const shell = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.35, metalness: 0.3 })
  const carbon = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.45, metalness: 0.6 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.05, metalness: 0.9 })

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.34, 8, 16), shell)
  body.rotation.x = Math.PI / 2
  body.scale.set(1.25, 1, 0.8)
  drone.add(body)

  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.4), carbon)
  belly.position.y = -0.1
  drone.add(belly)

  // Camera gimbal under the nose (the nose points north, -Z)
  const gimbal = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), glass)
  gimbal.position.set(0, -0.13, -0.24)
  drone.add(gimbal)

  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, 0.62, 10), carbon)
    arm.rotation.z = Math.PI / 2
    arm.rotation.y = Math.atan2(-z, x)
    arm.position.set(x * 0.27, 0, z * 0.27)
    drone.add(arm)

    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.11, 16), carbon)
    motor.position.set(x * 0.5, 0.03, z * 0.5)
    drone.add(motor)

    const rotor = new THREE.Group()
    rotor.position.set(x * 0.5, 0.1, z * 0.5)
    rotor.add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.008, 0.045), carbon))
    // Faint disc reads as motion blur while the blades spin
    const blur = new THREE.Mesh(
      new THREE.CircleGeometry(0.28, 24),
      new THREE.MeshBasicMaterial({
        color: 0x111111,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    blur.rotation.x = -Math.PI / 2
    rotor.add(blur)
    drone.add(rotor)
    rotors.push(rotor)

    // Navigation lights: red at the front, green at the back
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 8, 8),
      new THREE.MeshBasicMaterial({ color: z < 0 ? 0xff3b30 : 0x34ff6a }),
    )
    led.position.set(x * 0.5, -0.05, z * 0.5)
    drone.add(led)

    // Landing leg under each motor, reaching down to the drone's resting height
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.27, 8), carbon)
    leg.position.set(x * 0.5, -0.165, z * 0.5)
    drone.add(leg)
  }

  drone.traverse((part) => (part.castShadow = true))
  drone.scale.setScalar(1.5)
}
scene.add(drone)

// Rides above the drone and points the way the wind is pushing it.
// Built pointing along +Y, then rotated onto the wind direction.
export const windArrow = new THREE.Group()
const windArrowMaterial = new THREE.MeshBasicMaterial({ color: 0xffeb3b })
export const windArrowShaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.06, 0.06, 1, 12).translate(0, 0.5, 0),
  windArrowMaterial,
)
export const windArrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 16), windArrowMaterial)
windArrow.add(windArrowShaft, windArrowHead)
windArrow.visible = false
scene.add(windArrow)

// Call once per frame: moves the ripples and keeps the shadow box centred on the drone
export function animateWorld(dt: number) {
  water.material.uniforms.time.value += dt * 0.6
  sun.target.position.copy(drone.position)
  sun.position.copy(drone.position).addScaledVector(SUN_DIRECTION, 60)
}
