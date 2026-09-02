// @vitest-environment jsdom
//
// Downloading a report (MSA-53).
//
// The table showed "PDF · Ready" and the file that landed was JSON. Two causes,
// both here: `downloadReport` went through apiFetch, which parses every response
// as text, and the page then handed the parsed object to `downloadJson`, which
// re-encodes it and forces a .json extension. So the format column described an
// artifact nothing ever produced.
//
// The API now renders the artifact; the page only saves it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const listReportsMock = vi.fn()
const createReportMock = vi.fn()
const downloadReportMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  listReports: () => listReportsMock(),
  createReport: (body) => createReportMock(body),
  downloadReport: (id) => downloadReportMock(id),
  duplicateReport: vi.fn(),
  deleteReport: vi.fn(),
}))

/** Captures what the browser was asked to save. */
let saved
vi.mock('@/utils/export', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    downloadBlob: (filename, blob) => {
      saved = { filename, blob }
    },
    downloadJson: () => {
      throw new Error('downloadJson must not be used for a report artifact')
    },
  }
})

const report = (over = {}) => ({
  id: 'rep_1',
  name: 'Data quality report',
  type: 'DATA_QUALITY',
  format: 'PDF',
  scope: 'ALL',
  status: 'READY',
  owner: 'tester_super_admin@gmail.com',
  schedule: null,
  createdAt: '2026-09-01T12:04:32.000Z',
  updatedAt: '2026-09-01T12:04:32.000Z',
  ...over,
})

/** What the API answers with — real bytes, not a parsed object. */
const pdfBlob = () => new Blob(['%PDF-1.7 ...'], { type: 'application/pdf' })

async function renderReports(rows = [report()]) {
  listReportsMock.mockResolvedValue(rows)
  const { default: Reports } = await import('@/pages/Reports')
  render(
    <MemoryRouter initialEntries={['/admin/reports']}>
      <Reports />
    </MemoryRouter>,
  )
  await screen.findByText('Data quality report')
}

/**
 * userEvent with Radix's inert overlay tolerated.
 *
 * An open DropdownMenu sets `pointer-events: none` on everything behind it. In a
 * real browser that is lifted when the menu closes; in jsdom it lingers, and the
 * next click is refused for a reason that has nothing to do with the component.
 */
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 })

/** Open a row's action menu and click Download. */
async function downloadFirstRow(user) {
  await user.click(screen.getAllByRole('button', { name: /open menu|actions|more/i })[0])
  await user.click(await screen.findByRole('menuitem', { name: /download/i }))
  await waitFor(() => expect(downloadReportMock).toHaveBeenCalled())
}

beforeEach(() => {
  saved = undefined
  vi.clearAllMocks()
  downloadReportMock.mockResolvedValue(pdfBlob())
})

afterEach(cleanup)

describe('downloading an existing PDF report', () => {
  it('asks the API for the artifact itself', async () => {
    const user = setupUser()
    await renderReports()

    await downloadFirstRow(user)

    expect(downloadReportMock).toHaveBeenCalledWith('rep_1')
  })

  it('saves the bytes the API returned, without re-encoding them', async () => {
    const user = setupUser()
    await renderReports()

    await downloadFirstRow(user)

    expect(saved.blob).toBeInstanceOf(Blob)
    expect(saved.blob.type).toBe('application/pdf')
  })

  it('names the file .pdf', async () => {
    const user = setupUser()
    await renderReports()

    await downloadFirstRow(user)

    expect(saved.filename).toMatch(/\.pdf$/)
    expect(saved.filename).toContain('data-quality-report')
  })

  it('never routes a report through downloadJson', async () => {
    // The mock throws if it is called; reaching the assertion is the proof.
    const user = setupUser()
    await renderReports()

    await downloadFirstRow(user)

    expect(saved.filename).not.toMatch(/\.json$/)
  })
})

describe('the extension follows the report format', () => {
  it.each([
    ['PDF', /\.pdf$/],
    ['CSV', /\.csv$/],
    ['JSON', /\.json$/],
    ['XLSX', /\.xlsx$/],
  ])('saves a %s report with the matching extension', async (format, extension) => {
    const user = setupUser()
    await renderReports([report({ format })])

    await downloadFirstRow(user)

    expect(saved.filename).toMatch(extension)
  })

  it('does not hardcode pdf for every report', async () => {
    const user = setupUser()
    await renderReports([report({ format: 'CSV' })])

    await downloadFirstRow(user)

    expect(saved.filename).not.toMatch(/\.pdf$/)
  })
})

describe('the Export center', () => {
  it('creates the export and saves the artifact it produced', async () => {
    const created = report({ id: 'rep_export', name: 'All intelligence export' })
    createReportMock.mockResolvedValue(created)
    const user = setupUser()
    await renderReports()

    await user.click(screen.getByRole('tab', { name: /export center/i }))
    await user.click(await screen.findByRole('button', { name: /generate export/i }))

    await waitFor(() => expect(downloadReportMock).toHaveBeenCalledWith('rep_export'))
    expect(saved.blob.type).toBe('application/pdf')
    expect(saved.filename).toMatch(/\.pdf$/)
  })

  it('asks for the format the operator chose', async () => {
    createReportMock.mockResolvedValue(report({ id: 'rep_export' }))
    const user = setupUser()
    await renderReports()

    await user.click(screen.getByRole('tab', { name: /export center/i }))
    await user.click(await screen.findByRole('button', { name: /generate export/i }))

    await waitFor(() => expect(createReportMock).toHaveBeenCalled())
    expect(createReportMock.mock.calls[0][0]).toMatchObject({ format: 'PDF' })
  })
})

describe('when the export cannot be produced', () => {
  it('reports the reason rather than saving a broken file', async () => {
    // XLSX has no writer; the API says so instead of returning JSON named .xlsx.
    downloadReportMock.mockRejectedValue(
      new Error('XLSX exports are not available yet. Choose PDF, CSV or JSON.'),
    )
    const user = setupUser()
    await renderReports([report({ format: 'XLSX' })])

    await downloadFirstRow(user)

    expect(await screen.findByText(/not available yet/i)).toBeDefined()
    expect(saved).toBeUndefined()
  })
})
