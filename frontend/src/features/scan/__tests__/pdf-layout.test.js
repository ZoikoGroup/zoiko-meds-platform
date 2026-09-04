// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

// pdf-text.js imports pdfjs, which touches DOMMatrix at module load. The
// subject here is pure geometry, so the renderer is stubbed the same way the
// rest of the scan suite stubs it.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: vi.fn() }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))
vi.mock('../ocr-worker', () => ({ recognize: vi.fn() }))

const { textFromContent } = await import('../pdf-text')

/**
 * A prescription's columns survive text extraction.
 *
 * pdfjs hands back a flat list of positioned strings, and the previous
 * reconstruction grouped them by Y alone: anything within four units vertically
 * became one line, whatever its X. Most prescriptions put the medicines in one
 * column and the directions beside them in another, and the two share a Y — so
 * "Levosiz 5mg Tablet" and "Night - 1" arrived as a single line and the
 * instruction travelled attached to the medicine name for the rest of the
 * pipeline.
 *
 * Rows are still found by Y. Within a row, items are ordered by X and split
 * where the gap between them is too wide to be a word space. Nothing here knows
 * what a prescription is — it is generic layout, and these fixtures are ordinary
 * PDF geometry.
 */

const FONT = 10

/** A positioned text item, as pdfjs emits one. */
const item = (str, x, y, { width = str.length * 5, height = FONT, hasEOL = false } = {}) => ({
  str,
  width,
  height,
  transform: [height, 0, 0, height, x, y],
  hasEOL,
})

const extract = (items) => textFromContent({ items })
const lines = (items) => extract(items).split('\n')

describe('A. a single-column prescription is unchanged', () => {
  it('keeps one line per row', () => {
    expect(
      lines([
        item('Rx', 50, 700),
        item('Tab. Amoxicillin 500mg TDS', 50, 680),
        item('Cap. Omeprazole 20mg OD', 50, 660),
      ]),
    ).toEqual(['Rx', 'Tab. Amoxicillin 500mg TDS', 'Cap. Omeprazole 20mg OD'])
  })

  it('joins items on the same row into one phrase', () => {
    // Word spacing is encoded as position, not as a space character.
    expect(
      extract([
        item('Tab.', 50, 700, { width: 20 }),
        item('Amoxicillin', 73, 700, { width: 50 }),
        item('500mg', 126, 700, { width: 25 }),
      ]),
    ).toBe('Tab. Amoxicillin 500mg')
  })
})

describe('B. a two-column medicine + instruction layout', () => {
  // Medicines at x=50, directions at x=300 — a gutter of ~140 units against a
  // 10-unit font, which is nothing like a word space.
  const TWO_COLUMN = [
    item('1. Levosiz 5mg Tablet', 50, 700, { width: 110 }),
    item('Night - 1', 300, 700, { width: 45 }),
    item('2. Zimig 1% w/w Cream', 50, 680, { width: 112 }),
    item('Apply twice daily', 300, 680, { width: 80 }),
    item('3. Forcan 150mg Tablet', 50, 660, { width: 115 }),
    item('Weekly once', 300, 660, { width: 55 }),
  ]

  it('splits each row into its two cells', () => {
    expect(lines(TWO_COLUMN)).toEqual([
      '1. Levosiz 5mg Tablet',
      'Night - 1',
      '2. Zimig 1% w/w Cream',
      'Apply twice daily',
      '3. Forcan 150mg Tablet',
      'Weekly once',
    ])
  })

  it('never joins a medicine to the direction beside it', () => {
    // The defect, stated directly.
    for (const line of lines(TWO_COLUMN)) {
      expect(line).not.toMatch(/Tablet\s+Night/)
      expect(line).not.toMatch(/Cream\s+Apply/)
      expect(line).not.toMatch(/Tablet\s+Weekly/)
    }
  })

  it('reads across then down, which is the order of a table', () => {
    const out = lines(TWO_COLUMN)

    expect(out.indexOf('1. Levosiz 5mg Tablet')).toBeLessThan(out.indexOf('Night - 1'))
    expect(out.indexOf('Night - 1')).toBeLessThan(out.indexOf('2. Zimig 1% w/w Cream'))
  })

  it('handles a third column', () => {
    expect(
      lines([
        item('Tab. Amoxicillin', 50, 700, { width: 70 }),
        item('500mg', 300, 700, { width: 25 }),
        item('5 days', 450, 700, { width: 28 }),
      ]),
    ).toEqual(['Tab. Amoxicillin', '500mg', '5 days'])
  })
})

describe('C. numbered medicine rows', () => {
  it('keeps the number with its medicine', () => {
    // The list marker is what candidate extraction reads as a row, so it must
    // not be severed from the name.
    expect(
      extract([
        item('1.', 50, 700, { width: 8 }),
        item('Levosiz 5mg Tablet', 61, 700, { width: 95 }),
      ]),
    ).toBe('1. Levosiz 5mg Tablet')
  })

  it('keeps each numbered row on its own line', () => {
    expect(
      lines([
        item('1. Levosiz 5mg Tablet', 50, 700),
        item('2. Zimig 1% w/w Cream', 50, 680),
        item('3. Forcan 150mg Tablet', 50, 660),
      ]),
    ).toHaveLength(3)
  })
})

describe('D. a name and strength split across neighbouring items', () => {
  it.each([
    [['Levosiz', '5mg', 'Tablet'], 'Levosiz 5mg Tablet'],
    [['Zimig', '1%', 'w/w', 'Cream'], 'Zimig 1% w/w Cream'],
    [['Paracetamol', '250mg/5ml'], 'Paracetamol 250mg/5ml'],
    [['Amoxicillin', '500', 'mg'], 'Amoxicillin 500 mg'],
  ])('rejoins %j', (parts, expected) => {
    // pdfjs splits on font and kerning runs, so a strength routinely arrives in
    // pieces. Breaking one would destroy the evidence the classifier needs.
    let x = 50
    const items = parts.map((part) => {
      const next = item(part, x, 700, { width: part.length * 5 })
      x += part.length * 5 + 3
      return next
    })

    expect(extract(items)).toBe(expected)
  })

  it('does not split a strength across a column boundary', () => {
    expect(extract([item('Levosiz', 50, 700, { width: 35 }), item('5mg', 88, 700)])).toBe(
      'Levosiz 5mg',
    )
  })
})

describe('E & F. what counts as a gap', () => {
  it('a wide gap starts a new cell', () => {
    // 100 units against a 10-unit font.
    expect(lines([item('Left', 50, 700, { width: 20 }), item('Right', 170, 700)])).toEqual([
      'Left',
      'Right',
    ])
  })

  it('a narrow gap is a word space in the same phrase', () => {
    // 3 units — ordinary inter-word spacing.
    expect(extract([item('Left', 50, 700, { width: 20 }), item('Right', 73, 700)])).toBe(
      'Left Right',
    )
  })

  it('scales with the font rather than using a fixed distance', () => {
    // The same 40-unit gap: a column break at 10pt, a word space at 24pt.
    const small = lines([
      item('A', 50, 700, { width: 10, height: 10 }),
      item('B', 100, 700, { height: 10 }),
    ])
    const large = lines([
      item('A', 50, 700, { width: 10, height: 24 }),
      item('B', 100, 700, { height: 24 }),
    ])

    expect(small).toHaveLength(2)
    expect(large).toHaveLength(1)
  })

  it('respects an explicit end-of-line from the producer', () => {
    // The only signal available when a producer writes every item at one Y.
    expect(
      lines([
        item('First', 50, 700, { hasEOL: true }),
        item('Second', 50, 700, { hasEOL: true }),
      ]),
    ).toEqual(['First', 'Second'])
  })

  it('survives items carrying no geometry at all', () => {
    expect(textFromContent({ items: [{ str: 'Bare' }, { str: 'Items' }] })).toContain('Bare')
  })

  it('returns nothing for an empty page', () => {
    expect(textFromContent({ items: [] })).toBe('')
    expect(textFromContent(null)).toBe('')
  })
})
