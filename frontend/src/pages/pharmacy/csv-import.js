// CSV Upload — reading a pharmacy's inventory file.
//
// Parsing and status vocabulary live here rather than in the page so the page
// stays a component file (fast refresh), and so the rules can be tested as the
// unit they are.

/**
 * How a spreadsheet spells each inventory status.
 *
 * Mirrors normalizeInventoryStatus in the API (backend: modules/pharmacy).
 * Kept in step deliberately: the preview must show the status the import will
 * actually store, and it must refuse the same cells the API refuses — a preview
 * that promises "out of stock" while the import files it as available is the
 * bug this page had.
 */
const STATUS_SYNONYMS = {
  available: 'available',
  instock: 'available',
  instocks: 'available',
  yes: 'available',
  y: 'available',
  limited: 'limited',
  limitedstock: 'limited',
  low: 'limited',
  lowstock: 'limited',
  outofstock: 'out-of-stock',
  outstock: 'out-of-stock',
  unavailable: 'out-of-stock',
  notavailable: 'out-of-stock',
  nostock: 'out-of-stock',
  no: 'out-of-stock',
  n: 'out-of-stock',
}

/** Canonical status, or null when the cell says something we have no status for. */
export function normalizeStatus(raw) {
  const key = String(raw ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  if (!key) return null
  return STATUS_SYNONYMS[key] ?? null
}

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) return { headers: [], rows: [], error: 'The file is empty.' }
  const rawHeaders = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ''))
  
  const hasName = rawHeaders.some((h) => h === 'name' || h === 'medicinename' || h === 'canonicalname')
  if (!hasName) {
    return {
      headers: rawHeaders,
      rows: [],
      error: 'CSV file missing required "name" header column. Required column: name (optional: generic, strength, dosageform, status).',
    }
  }

  const rows = []
  let invalidRowCount = 0
  const badStatuses = []

  lines.slice(1).forEach((line, index) => {
    const cells = line.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''))
    const row = {}
    rawHeaders.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    const nameVal = row.name || row.medicinename || row.canonicalname
    if (nameVal) {
      // Normalize keys to standard names
      row.name = nameVal
      row.generic = row.generic || row.genericname || ''
      row.strength = row.strength || ''
      row.dosageform = row.dosageform || row.dosageForm || row.form || 'Tablet'
      // An empty cell means available — the documented default. A cell with
      // something in it that is not a status is a mistake in the file, and is
      // reported rather than quietly turned into "available".
      const rawStatus = row.status || row.availability || ''
      const status = rawStatus.trim() ? normalizeStatus(rawStatus) : 'available'
      if (!status) {
        badStatuses.push(`row ${index + 2}: "${rawStatus.trim()}"`)
        return
      }
      row.status = status
      rows.push(row)
    } else {
      invalidRowCount++
    }
  })

  if (badStatuses.length > 0) {
    const shown = badStatuses.slice(0, 5).join(', ')
    const more = badStatuses.length > 5 ? ` and ${badStatuses.length - 5} more` : ''
    return {
      headers: rawHeaders,
      rows: [],
      error: `Unrecognised status in the CSV (${shown}${more}). Use available, limited stock, or out of stock.`,
    }
  }

  if (rows.length === 0) {
    return { headers: rawHeaders, rows: [], error: 'No valid rows containing a medicine name were found.' }
  }

  const standardHeaders = ['name', 'generic', 'strength', 'dosageform', 'status']
  return { headers: standardHeaders, rows, invalidRowCount, error: null }
}
