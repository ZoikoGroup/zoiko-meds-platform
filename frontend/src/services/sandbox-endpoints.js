// Interactive sandbox endpoint registry for ZoikoAvail™.
//
// Every entry here is a REAL, public, read-only ZoikoMeds API endpoint. The
// sandbox console (pages/ZoikoAvailSandbox.jsx) calls them live against the
// configured API base URL. Each entry also carries a `sample` response used
// ONLY as an offline fallback when the API is unreachable — the console flags
// those responses clearly so a sample is never mistaken for a live result.

/** Identifier systems accepted by GET /medibase/lookup (see backend). */
export const IDENTIFIER_SYSTEMS = [
  'NDC',
  'RXCUI',
  'GTIN',
  'GS1',
  'DIN',
  'DMD',
  'ATC',
  'EAN',
  'UPC',
  'LOCAL',
]

export const SANDBOX_ENDPOINTS = [
  {
    id: 'search',
    method: 'GET',
    path: '/search',
    category: 'Availability',
    summary: 'Medicine search',
    description:
      'Search the governed medicine catalogue. Optional location fields add nearby-pharmacy results (provide lat+lng or a city).',
    params: [
      { name: 'q', label: 'Query (medicine term)', type: 'string', placeholder: 'amoxicillin', example: 'amoxicillin' },
      { name: 'city', label: 'City', type: 'string', placeholder: 'London' },
      { name: 'lat', label: 'Latitude', type: 'number', placeholder: '51.5072' },
      { name: 'lng', label: 'Longitude', type: 'number', placeholder: '-0.1276' },
      { name: 'maxDistance', label: 'Max distance (km, 1–50)', type: 'number', placeholder: '10' },
    ],
    sample: {
      query: 'amoxicillin',
      results: [
        { id: 'med_amox_500', name: 'Amoxicillin 500mg capsules', form: 'capsule', strength: '500 mg' },
        { id: 'med_amox_250', name: 'Amoxicillin 250mg/5ml oral suspension', form: 'suspension', strength: '250 mg/5ml' },
      ],
      nearby: [],
    },
  },
  {
    id: 'availability',
    method: 'GET',
    path: '/availability',
    category: 'Availability',
    summary: 'Availability confidence',
    description:
      'Governed, aggregate-only availability confidence for a medicine. Never returns exact stock.',
    params: [
      {
        name: 'medicineId',
        label: 'Medicine ID',
        type: 'string',
        required: true,
        placeholder: 'med_amox_500',
        example: 'med_amox_500',
        help: 'Use an id returned by GET /search.',
      },
    ],
    sample: {
      medicineId: 'med_amox_500',
      confidence: 'high',
      band: '75–100%',
      updatedAt: '2026-07-23T09:00:00.000Z',
    },
  },
  {
    id: 'medibase-match',
    method: 'GET',
    path: '/medibase/match',
    category: 'MediBase',
    summary: 'Medicine identity match',
    description: 'Normalized, ranked medicine identity match from MediBase™.',
    params: [
      { name: 'q', label: 'Query', type: 'string', placeholder: 'amox', example: 'amox' },
      { name: 'limit', label: 'Limit (1–50)', type: 'number', placeholder: '10' },
      { name: 'jurisdiction', label: 'Jurisdiction code', type: 'string', placeholder: 'GB' },
      { name: 'includeIdentifiers', label: 'Include identifiers', type: 'boolean' },
    ],
    sample: {
      query: 'amox',
      matches: [
        { id: 'mb_amoxicillin', name: 'Amoxicillin', score: 0.98, jurisdiction: 'GB' },
      ],
    },
  },
  {
    id: 'medibase-lookup',
    method: 'GET',
    path: '/medibase/lookup',
    category: 'MediBase',
    summary: 'Lookup by external identifier',
    description: 'Resolve a medicine identity by an external identifier (NDC, RxCUI, ATC, …).',
    params: [
      { name: 'system', label: 'Identifier system', type: 'select', required: true, options: IDENTIFIER_SYSTEMS, example: 'ATC' },
      { name: 'value', label: 'Identifier value', type: 'string', required: true, placeholder: 'J01CA04', example: 'J01CA04' },
    ],
    sample: {
      system: 'ATC',
      value: 'J01CA04',
      medicine: { id: 'mb_amoxicillin', name: 'Amoxicillin' },
    },
  },
  {
    id: 'medibase-dictionary',
    method: 'GET',
    path: '/medibase/meta/dictionary',
    category: 'MediBase',
    summary: 'Data dictionary',
    description: 'The MediBase™ data dictionary — the public schema contract.',
    params: [],
    sample: {
      fields: [
        { name: 'id', type: 'string', description: 'Stable medicine identity id.' },
        { name: 'name', type: 'string', description: 'Governed display name.' },
      ],
    },
  },
  {
    id: 'health',
    method: 'GET',
    path: '/health',
    category: 'System',
    summary: 'Liveness',
    description: 'Liveness probe — confirms the API process is up. Does not touch the database.',
    params: [],
    sample: { status: 'ok', service: 'zoikomeds-api', timestamp: '2026-07-23T09:00:00.000Z' },
  },
  {
    id: 'health-ready',
    method: 'GET',
    path: '/health/ready',
    category: 'System',
    summary: 'Readiness',
    description: 'Readiness probe — returns 503 when the database is unreachable.',
    params: [],
    sample: { status: 'ok', service: 'zoikomeds-api', db: 'up', timestamp: '2026-07-23T09:00:00.000Z' },
  },
]

/**
 * Build a query string from an endpoint's param specs and the current values.
 * Empty / unset values are omitted; booleans only appear when true.
 */
export function buildQueryString(params, values) {
  const sp = new URLSearchParams()
  for (const p of params) {
    const v = values[p.name]
    if (v === undefined || v === null || v === '') continue
    if (p.type === 'boolean') {
      if (v) sp.set(p.name, 'true')
      continue
    }
    sp.set(p.name, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** Prefill an endpoint's form with any example values it declares. */
export function exampleValues(endpoint) {
  const out = {}
  for (const p of endpoint.params) {
    if (p.example !== undefined) out[p.name] = p.example
  }
  return out
}
