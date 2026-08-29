import { describe, expect, it } from 'vitest'
import { normalizeStatus, parseCsv } from '../pharmacy/csv-import'

// CSV Upload — the status shown in the preview is the status that gets stored.
//
// The preview read "out of stock" correctly and the import filed the medicine
// as Available, because the two sides recognised different spellings. These
// pin the parser to the same vocabulary the API accepts.

const csv = (...lines) => lines.join('\n')
const HEADER = 'name,generic,strength,dosageform,status'

describe('normalizeStatus', () => {
  it.each([
    ['available', 'available'],
    ['Available', 'available'],
    ['AVAILABLE', 'available'],
    ['in stock', 'available'],
    ['limited', 'limited'],
    ['Limited Stock', 'limited'],
    ['LIMITED STOCK', 'limited'],
    ['out of stock', 'out-of-stock'],
    ['Out of Stock', 'out-of-stock'],
    ['OUT OF STOCK', 'out-of-stock'],
    ['out-of-stock', 'out-of-stock'],
    ['unavailable', 'out-of-stock'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeStatus(input)).toBe(expected)
  })

  it('has no answer for an empty cell', () => {
    expect(normalizeStatus('')).toBeNull()
    expect(normalizeStatus(undefined)).toBeNull()
  })

  it.each(['testing', 'abc', 'unknown-status'])('refuses %s', (input) => {
    expect(normalizeStatus(input)).toBeNull()
  })
})

describe('the preview carries the status the import will store', () => {
  it('normalises the reported case', () => {
    const parsed = parseCsv(csv(HEADER, 'Tester 2,Tester 2,10,tester,out of stock'))

    expect(parsed.error).toBeNull()
    expect(parsed.rows).toHaveLength(1)
    // The value sent to the API, and the value the preview cell renders.
    expect(parsed.rows[0].status).toBe('out-of-stock')
  })

  it.each([
    ['out of stock', 'out-of-stock'],
    ['Out of Stock', 'out-of-stock'],
    ['OUT OF STOCK', 'out-of-stock'],
    ['Limited Stock', 'limited'],
    ['AVAILABLE', 'available'],
  ])('sends %s as %s', (written, stored) => {
    const parsed = parseCsv(csv(HEADER, `Tester,Tester,10,tester,${written}`))
    expect(parsed.rows[0].status).toBe(stored)
  })

  it('keeps the rest of the row intact', () => {
    const parsed = parseCsv(csv(HEADER, 'Tester 2,Tester 2,10,tester,out of stock'))

    expect(parsed.rows[0]).toMatchObject({
      name: 'Tester 2',
      generic: 'Tester 2',
      strength: '10',
      dosageform: 'tester',
      status: 'out-of-stock',
    })
  })

  it('defaults an empty status to available', () => {
    const parsed = parseCsv(csv(HEADER, 'Tester,Tester,10,tester,'))
    expect(parsed.rows[0].status).toBe('available')
  })

  it('defaults a missing status column to available', () => {
    const parsed = parseCsv(csv('name,generic', 'Tester,Tester'))
    expect(parsed.rows[0].status).toBe('available')
  })

  it('reads an "availability" column the same way', () => {
    const parsed = parseCsv(csv('name,availability', 'Tester,Out of Stock'))
    expect(parsed.rows[0].status).toBe('out-of-stock')
  })
})

describe('an unsupported status stops the upload', () => {
  it('reports it instead of importing the row as available', () => {
    const parsed = parseCsv(csv(HEADER, 'Tester,Tester,10,tester,testing'))

    // `error` is what the page renders and what disables the upload button, so
    // the file cannot be sent at all.
    expect(parsed.error).toMatch(/unrecognised status/i)
    expect(parsed.rows).toHaveLength(0)
  })

  it('names the row and the cell', () => {
    const parsed = parseCsv(csv(HEADER, 'Tester,Tester,10,tester,testing'))
    expect(parsed.error).toContain('row 2: "testing"')
  })

  it('says what is accepted', () => {
    const parsed = parseCsv(csv(HEADER, 'Tester,Tester,10,tester,abc'))
    expect(parsed.error).toMatch(/available, limited stock, or out of stock/i)
  })

  it('refuses the whole file, not just the bad row', () => {
    const parsed = parseCsv(
      csv(HEADER, 'Good,Good,10,tester,available', 'Bad,Bad,10,tester,nonsense'),
    )

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.error).toBeTruthy()
  })

  it('lists a few bad rows without listing every one', () => {
    const rows = Array.from({ length: 9 }, (_, i) => `M${i},M${i},1,tab,nonsense`)
    const parsed = parseCsv(csv(HEADER, ...rows))

    expect(parsed.error).toMatch(/and 4 more/)
  })
})

describe('the existing parser behaviour is unchanged', () => {
  it('still refuses a file with no name column', () => {
    expect(parseCsv(csv('generic,status', 'Tester,available')).error).toMatch(/missing required "name"/i)
  })

  it('still refuses an empty file', () => {
    expect(parseCsv('').error).toMatch(/empty/i)
  })

  it('still skips a row with no medicine name', () => {
    const parsed = parseCsv(csv(HEADER, ',Tester,10,tester,available', 'Real,Real,10,tab,available'))

    expect(parsed.rows).toHaveLength(1)
    expect(parsed.invalidRowCount).toBe(1)
  })
})
