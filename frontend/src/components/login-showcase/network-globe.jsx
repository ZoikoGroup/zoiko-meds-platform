import { landCells, LAND_STEP } from './land-mask'

/**
 * A dotted Earth with glowing availability routes between pharmacy hubs, drawn
 * as one SVG so it stays sharp at any size and needs no image request.
 *
 * Orthographic view centred on 10°E and tilted 18° north: Europe, Africa and
 * the Atlantic face the reader and the Americas sit on the western limb. The
 * geometry never changes, so it is built once per page load and reused.
 */

const VIEW_LON = 10
const VIEW_LAT = 18
const C = 500 // centre of the 1000×1000 viewBox
const R = 400 // globe radius; the atmosphere fills the rest

const HUBS = {
  newYork: [40.7, -74.0],
  saoPaulo: [-23.5, -46.6],
  london: [51.5, -0.1],
  lagos: [6.5, 3.4],
  cairo: [30.0, 31.2],
  nairobi: [-1.3, 36.8],
  johannesburg: [-26.2, 28.0],
  dubai: [25.2, 55.3],
  mumbai: [19.1, 72.9],
}

const ROUTES = [
  ['london', 'newYork'],
  ['newYork', 'saoPaulo'],
  ['london', 'lagos'],
  ['lagos', 'saoPaulo'],
  ['london', 'dubai'],
  ['dubai', 'mumbai'],
  ['cairo', 'nairobi'],
  ['lagos', 'nairobi'],
  ['nairobi', 'johannesburg'],
  ['nairobi', 'mumbai'],
]

// Dot buckets by how squarely they face the reader: limb dots are smaller and
// dimmer, which is most of what makes a flat dot field read as a sphere.
const DOT_BUCKETS = [
  { maxZ: 0.35, width: 4.2, opacity: 0.32 },
  { maxZ: 0.7, width: 5.2, opacity: 0.6 },
  { maxZ: Infinity, width: 6, opacity: 0.92 },
]

const rad = (deg) => (deg * Math.PI) / 180
const round = (n) => Math.round(n * 10) / 10

/** Unit vector in view space: x right, y up, z toward the reader. */
function toView(lat, lon) {
  const phi = rad(lat)
  const d = rad(lon - VIEW_LON)
  const p0 = rad(VIEW_LAT)
  const cp = Math.cos(phi)
  return [
    cp * Math.sin(d),
    Math.cos(p0) * Math.sin(phi) - Math.sin(p0) * cp * Math.cos(d),
    Math.sin(p0) * Math.sin(phi) + Math.cos(p0) * cp * Math.cos(d),
  ]
}

const project = (v) => [round(C + R * v[0]), round(C - R * v[1])]

function buildDots() {
  const paths = DOT_BUCKETS.map(() => [])
  for (const [lat, lon] of landCells()) {
    // Thin the columns toward the poles so dots stay evenly spaced on the
    // sphere instead of bunching where meridians converge.
    const every = Math.max(1, Math.round(1 / Math.cos(rad(lat))))
    if (Math.round((lon + 180 - LAND_STEP / 2) / LAND_STEP) % every !== 0) continue
    const v = toView(lat, lon)
    if (v[2] <= 0.02) continue
    const [x, y] = project(v)
    const bucket = DOT_BUCKETS.findIndex((b) => v[2] < b.maxZ)
    // A zero-length segment with a round cap draws a dot; far shorter markup
    // than a <circle> per point.
    paths[bucket].push(`M${x} ${y}h0`)
  }
  return paths.map((p) => p.join(''))
}

function buildGraticule() {
  const lines = []
  const trace = (points) => {
    let segment = []
    for (const [lat, lon] of points) {
      const v = toView(lat, lon)
      if (v[2] > 0) {
        segment.push(project(v))
      } else if (segment.length) {
        lines.push(segment)
        segment = []
      }
    }
    if (segment.length > 1) lines.push(segment)
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = []
    for (let lat = -90; lat <= 90; lat += 3) pts.push([lat, lon])
    trace(pts)
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = []
    for (let lon = -180; lon <= 180; lon += 3) pts.push([lat, lon])
    trace(pts)
  }
  return lines
    .filter((s) => s.length > 1)
    .map((s) => s.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(''))
    .join('')
}

/** Great-circle route lifted off the surface toward its midpoint. */
function buildArc(from, to) {
  const a = toView(...from)
  const b = toView(...to)
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  const omega = Math.acos(dot)
  const lift = 0.05 + 0.24 * (omega / Math.PI)
  const steps = 40
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const s0 = Math.sin((1 - t) * omega) / Math.sin(omega)
    const s1 = Math.sin(t * omega) / Math.sin(omega)
    const h = 1 + lift * Math.sin(Math.PI * t)
    const v = [0, 1, 2].map((k) => (s0 * a[k] + s1 * b[k]) * h)
    const [x, y] = project(v)
    d += `${i ? 'L' : 'M'}${x} ${y}`
  }
  return d
}

let geometry = null
function getGeometry() {
  if (geometry) return geometry
  geometry = {
    dots: buildDots(),
    graticule: buildGraticule(),
    arcs: ROUTES.map(([from, to]) => buildArc(HUBS[from], HUBS[to])),
    hubs: Object.values(HUBS)
      .map(([lat, lon]) => toView(lat, lon))
      .filter((v) => v[2] > 0.05)
      .map((v) => project(v)),
  }
  return geometry
}

export function NetworkGlobe({ className }) {
  const { dots, graticule, arcs, hubs } = getGeometry()

  return (
    <svg
      viewBox="0 0 1000 1000"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="zm-globe-atmosphere" cx="50%" cy="50%" r="50%">
          <stop offset="76%" stopColor="#2dd4bf" stopOpacity="0" />
          <stop offset="81%" stopColor="#2dd4bf" stopOpacity="0.3" />
          <stop offset="88%" stopColor="#22d3ee" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="zm-globe-ocean" cx="40%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#0f5f78" />
          <stop offset="55%" stopColor="#09344f" />
          <stop offset="100%" stopColor="#041a30" />
        </radialGradient>
        <radialGradient id="zm-globe-shade" cx="36%" cy="30%" r="76%">
          <stop offset="45%" stopColor="#020b18" stopOpacity="0" />
          <stop offset="100%" stopColor="#020b18" stopOpacity="0.62" />
        </radialGradient>
      </defs>

      <circle cx={C} cy={C} r={C} fill="url(#zm-globe-atmosphere)" />
      <circle cx={C} cy={C} r={R} fill="url(#zm-globe-ocean)" />
      <path d={graticule} fill="none" stroke="#7dd3fc" strokeOpacity="0.1" strokeWidth="1.2" />

      {dots.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="#5eead4"
          strokeOpacity={DOT_BUCKETS[i].opacity}
          strokeWidth={DOT_BUCKETS[i].width}
          strokeLinecap="round"
        />
      ))}

      <circle cx={C} cy={C} r={R} fill="url(#zm-globe-shade)" />
      <circle cx={C} cy={C} r={R} fill="none" stroke="#5eead4" strokeOpacity="0.35" strokeWidth="2" />

      <g fill="none" strokeLinecap="round">
        {arcs.map((d, i) => (
          <g key={i}>
            <path d={d} stroke="#2dd4bf" strokeOpacity="0.16" strokeWidth="7" />
            <path d={d} stroke="#5eead4" strokeOpacity="0.62" strokeWidth="1.8" />
            <path
              d={d}
              pathLength="100"
              className="zm-globe-flow"
              stroke="#ecfeff"
              strokeWidth="2.6"
              strokeDasharray="10 90"
              style={{ animationDelay: `${(i * -0.53).toFixed(2)}s` }}
            />
          </g>
        ))}
      </g>

      {hubs.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="15" fill="#2dd4bf" fillOpacity="0.18" />
          <circle
            cx={x}
            cy={y}
            r="9"
            className="zm-globe-pulse"
            fill="none"
            stroke="#5eead4"
            strokeWidth="2"
            style={{ animationDelay: `${(i * -0.41).toFixed(2)}s` }}
          />
          <circle cx={x} cy={y} r="5.5" fill="#ecfeff" />
        </g>
      ))}
    </svg>
  )
}
