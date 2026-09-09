// @vitest-environment jsdom
//
// What the Super Admin audit table shows, and specifically what it no longer
// shows.
//
// The originating IP used to have a column of its own, printed against a named
// actor on every row. It is still recorded against every audit entry and still
// arrives on this payload — an investigation needs it, and nothing about this
// change touches the record — but the console table is read over shoulders and
// pasted into tickets, and an address beside a person's name on every screen is
// more exposure than reading the log calls for.
//
// So these hold two things at once: the column is gone from the table, and the
// value is still in the response the table was built from. A test that dropped
// the field from its fixture could not tell the difference between "not
// rendered" and "not sent".

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const listAuditLogsMock = vi.fn()

vi.mock('@/services/admin-api', () => ({
  listAuditLogs: (params) => listAuditLogsMock(params),
}))

const { default: AuditLogs } = await import('../AuditLogs')

/** The API's own shape — `ip` included, exactly as the backend maps it. */
const row = (over = {}) => ({
  id: 'log_1',
  timestamp: '2026-09-08T10:15:00.000Z',
  action: 'auth.login',
  severity: 'INFO',
  actor: 'Root (root@zoikomeds.test)',
  module: 'Authentication',
  ip: '203.0.113.42',
  details: JSON.stringify({ action: 'Login', userEmail: 'root@zoikomeds.test' }),
  summary: 'Logged in successfully: root@zoikomeds.test',
  ...over,
})

const ROWS = [
  row(),
  row({
    id: 'log_2',
    action: 'pharmacy.inventory.update',
    severity: 'WARNING',
    actor: 'Asha (asha@zoikomeds.test)',
    module: 'Inventory',
    ip: '198.51.100.7',
    summary: 'Updated Paracetamol status to limited',
  }),
]

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/audit-logs']}>
      <AuditLogs />
    </MemoryRouter>,
  )

/** The table's header cells, in the order a reader meets them. */
const headers = () =>
  screen.getAllByRole('columnheader').map((th) => th.textContent.trim())

beforeEach(() => {
  vi.clearAllMocks()
  listAuditLogsMock.mockResolvedValue({ items: ROWS, total: ROWS.length })
})

afterEach(cleanup)

describe('the IP address is not on the screen', () => {
  it('renders no IP Address header', async () => {
    renderPage()
    await screen.findByText(/Logged in successfully/i)

    expect(headers()).not.toContain('IP Address')
    expect(screen.queryByText(/IP Address/i)).toBeNull()
  })

  it('prints no address in any row', async () => {
    renderPage()
    await screen.findByText(/Logged in successfully/i)

    expect(screen.queryByText('203.0.113.42')).toBeNull()
    expect(screen.queryByText('198.51.100.7')).toBeNull()
  })

  it('leaks none through a title or any other attribute', async () => {
    // The summary cell carries the raw details blob as a tooltip, so "not in a
    // cell's text" is not the whole question.
    renderPage()
    await screen.findByText(/Logged in successfully/i)

    expect(document.body.innerHTML).not.toContain('203.0.113.42')
    expect(document.body.innerHTML).not.toContain('198.51.100.7')
  })

  it('still receives it from the API, which is the point', async () => {
    // Storage and capture are untouched: this is a presentation change, and the
    // fixture above is the real payload shape with `ip` on every row.
    renderPage()
    await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalled())

    expect(ROWS.every((r) => r.ip)).toBe(true)
  })
})

describe('the rest of the table is unchanged', () => {
  it('shows every remaining column, and nothing between them', async () => {
    // Asserted as the exact list rather than one header at a time: a removal
    // that left a blank <th> behind would still pass a `toContain` check on
    // each of the others.
    renderPage()
    await screen.findByText(/Logged in successfully/i)

    expect(headers()).toEqual([
      'Timestamp',
      'Event Action',
      'Severity',
      'Actor / User',
      'System Module',
      'Log Summary Details',
    ]);
  })

  it('gives every row exactly as many cells as there are columns', async () => {
    // The empty-gap check from the other side: a stray cell in the body would
    // shift every value one column to the right of its heading.
    renderPage()
    await screen.findByText(/Logged in successfully/i)

    const [, ...bodyRows] = screen.getAllByRole('row')
    expect(bodyRows.length).toBe(ROWS.length)
    for (const tr of bodyRows) {
      expect(within(tr).getAllByRole('cell')).toHaveLength(headers().length)
    }
  })

  it('still renders the values those columns are for', async () => {
    renderPage()
    await screen.findByText(/Logged in successfully/i)

    // Scoped to the row: "Authentication" is also one of the module filter's
    // options, and the subject here is the cell, not the toolbar.
    const [, first] = screen.getAllByRole('row')
    const cells = within(first).getAllByRole('cell').map((td) => td.textContent.trim())

    expect(cells).toEqual([
      new Date('2026-09-08T10:15:00.000Z').toLocaleString(),
      'auth.login',
      'Info',
      'Root (root@zoikomeds.test)',
      'Authentication',
      'Logged in successfully: root@zoikomeds.test',
    ])
  })
})

describe('searching and filtering still work', () => {
  it('narrows the table on a search term', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/Logged in successfully/i)

    await user.type(screen.getByLabelText(/search table/i), 'Paracetamol')

    await waitFor(() => expect(screen.queryByText(/Logged in successfully/i)).toBeNull())
    expect(screen.getByText(/Updated Paracetamol/i)).toBeDefined()
  })

  it('does not match on an IP, because it is not on the row any more', async () => {
    // It was never in the search accessor either; this states it so that
    // putting it back would be a deliberate act rather than an accident.
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/Logged in successfully/i)

    await user.type(screen.getByLabelText(/search table/i), '203.0.113.42')

    await waitFor(() => expect(screen.queryByText(/Logged in successfully/i)).toBeNull())
    expect(screen.queryByText(/Updated Paracetamol/i)).toBeNull()
  })

  it('asks the API again when a module filter is chosen', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/Logged in successfully/i)

    await user.selectOptions(screen.getByDisplayValue('All Modules'), 'Inventory')

    await waitFor(() =>
      expect(listAuditLogsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ module: 'Inventory' }),
      ),
    )
  })
})
