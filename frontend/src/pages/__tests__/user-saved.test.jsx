// @vitest-environment jsdom
//
// Saved Medicines page — the availability confidence the API already returns
// per saved medicine must actually reach the screen. The page promises
// "Track availability confidence…" in its own subtitle but used to render only
// name / generic / strength and discard the rest.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))

vi.mock('@/providers/language-provider', () => ({
  // Mirrors the real t(): substitutes {token} params, so a message like
  // 'Remove {name} from saved' renders with the medicine name as it does in app.
  useLanguage: () => ({
    t: (_key, fallback, params) =>
      params
        ? String(fallback).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
        : fallback,
  }),
}))

const listSavedMock = vi.fn()
// Query state for the saved-medicines list, so a test can put the page in the
// failed-load state the API returns while a migration is pending.
let savedQueryError = null
const refetchMock = vi.fn()
const unsaveMock = vi.fn(async () => ({ saved: false }))
const toggleAlertsMock = vi.fn(async () => ({ success: true }))
// The global 'Back in stock' category, as the settings endpoint reports it.
let signalSettings = { backInStock: true }

vi.mock('@/hooks/use-saved-medicines', () => ({
  useSavedMedicines: () => ({
    data: savedQueryError ? undefined : listSavedMock(),
    isLoading: false,
    isError: !!savedQueryError,
    error: savedQueryError,
    refetch: refetchMock,
  }),
  useUnsaveMedicine: () => ({ mutate: (id, opts) => { unsaveMock(id); opts?.onSuccess?.() }, isPending: false }),
  useToggleSavedAlerts: () => ({ mutate: (vars, opts) => { toggleAlertsMock(vars); opts?.onSuccess?.() }, isPending: false }),
  // The page reads the ZoikoSignal category to say when it would silence
  // these switches. Defaults on, which is the ordinary case.
  useSignalSettings: () => ({ data: signalSettings }),
}))

const SAVED = [
  {
    id: 'med_1',
    name: 'Amoxicillin 500 mg',
    generic: 'Amoxicillin',
    strength: '500 mg',
    confidence: 'high',
    pharmacy: 'Apollo Pharmacy',
    distance: 4.2,
    updated: '10 min ago',
    alertsEnabled: true,
  },
  {
    id: 'med_2',
    name: 'Metformin 500 mg',
    generic: 'Metformin',
    strength: '500 mg',
    confidence: 'unknown',
    pharmacy: 'No verified pharmacy nearby',
    distance: null,
    updated: 'No recent signal',
    alertsEnabled: false,
  },
]

const { default: UserSaved } = await import('../UserSaved')

beforeEach(() => {
  vi.clearAllMocks()
  savedQueryError = null
  listSavedMock.mockReturnValue(SAVED)
})

afterEach(cleanup)

describe('Saved Medicines page', () => {
  it('lists every saved medicine', () => {
    render(<UserSaved />)
    expect(screen.getByText('Amoxicillin 500 mg')).toBeDefined()
    expect(screen.getByText('Metformin 500 mg')).toBeDefined()
  })

  it('shows availability confidence, pharmacy and freshness per medicine', () => {
    const { container } = render(<UserSaved />)

    // The plain-language reading of the confidence band, not just the raw level.
    expect(container.textContent).toContain('Likely available now')
    expect(container.textContent).toContain('Apollo Pharmacy')
    expect(container.textContent).toContain('4.2 km')
    expect(container.textContent).toContain('10 min ago')
  })

  it('degrades honestly when there is no signal', () => {
    const { container } = render(<UserSaved />)
    expect(container.textContent).toContain('No recent signal')
    expect(container.textContent).toContain('No verified pharmacy nearby')
    // No distance is invented when the API reports none.
    expect(container.textContent).not.toContain('null km')
  })

  it('carries the governance disclaimer wherever availability is shown', () => {
    const { container } = render(<UserSaved />)
    expect(container.textContent).toMatch(/not exact stock/i)
  })

  it('removes a medicine through the existing unsave mutation', async () => {
    const user = userEvent.setup()
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: /Remove Amoxicillin 500 mg from saved/i }))
    expect(unsaveMock).toHaveBeenCalledWith('med_1')
  })

  it('toggles alerts through the existing mutation, sending the inverted value', async () => {
    const user = userEvent.setup()
    render(<UserSaved />)

    await user.click(screen.getByRole('switch', { name: /Toggle alerts for Metformin 500 mg/i }))
    await waitFor(() =>
      expect(toggleAlertsMock).toHaveBeenCalledWith({ medicineId: 'med_2', alertsEnabled: true }),
    )
  })

  it('opens the medicine details page', async () => {
    const user = userEvent.setup()
    render(<UserSaved />)

    const card = within(screen.getByText('Amoxicillin 500 mg').closest('div').parentElement.parentElement)
    await user.click(card.getByRole('button', { name: /View details/i }))
    expect(navigateMock).toHaveBeenCalledWith('/medicine/med_1')
  })

  // A failed request left `data` undefined, which the page defaulted to [] and
  // rendered as "No saved medicines yet" — an empty list the API never reported.
  // The distinction matters most when the cause is a pending migration: the
  // patient's medicines are still there, and telling them otherwise is a lie.
  it('reports a failed load instead of claiming the list is empty', () => {
    savedQueryError = new Error(
      'This feature is temporarily unavailable: the database schema is behind the deployed application.',
    )
    const { container } = render(<UserSaved />)

    expect(screen.getByRole('alert')).toBeDefined()
    expect(container.textContent).toContain('Could not load your saved medicines')
    expect(container.textContent).toContain('the database schema is behind')
    expect(screen.queryByText('No saved medicines yet')).toBeNull()
    // No governance disclaimer either — nothing was shown to disclaim.
    expect(container.textContent).not.toMatch(/not exact stock/i)
  })

  it('retries the load from the error state', async () => {
    savedQueryError = new Error('Request failed')
    const user = userEvent.setup()
    render(<UserSaved />)

    await user.click(screen.getByRole('button', { name: /Retry/i }))
    expect(refetchMock).toHaveBeenCalled()
  })

  it('shows an empty state, and no disclaimer, with nothing saved', () => {
    listSavedMock.mockReturnValue([])
    const { container } = render(<UserSaved />)

    expect(screen.getByText('No saved medicines yet')).toBeDefined()
    expect(container.textContent).not.toMatch(/not exact stock/i)
  })
})

/**
 * Two switches govern one alert, and this page used to mention only one.
 *
 * Turning "Alerts enabled" on for a medicine while ZoikoSignal's "Back in
 * stock" category was off produced silence, with nothing on screen to say why
 * — so the per-medicine switch read as a control wired to nothing. It is
 * wired; it is the per-medicine half of a decision the category also governs.
 * The page now says so, and only when it changes the outcome.
 */
describe('the ZoikoSignal category that also governs these switches', () => {
  afterEach(() => {
    signalSettings = { backInStock: true }
  })

  it('says nothing while the category is on', () => {
    render(<UserSaved />)
    expect(screen.queryByText(/switched off for every saved medicine/i)).toBeNull()
  })

  it('says nothing while the category is still loading', () => {
    // An absent answer is not a "no". Warning on undefined would flash the
    // notice on every page load.
    signalSettings = undefined
    render(<UserSaved />)
    expect(screen.queryByText(/switched off for every saved medicine/i)).toBeNull()
  })

  it('warns on a medicine whose alerts are on when the category is off', () => {
    signalSettings = { backInStock: false }
    render(<UserSaved />)

    // SAVED[0] has alertsEnabled: true, SAVED[1] has false.
    expect(screen.getAllByText(/switched off for every saved medicine/i)).toHaveLength(1)
  })

  it('stays quiet on a medicine whose own alerts are off', () => {
    // Nothing is being silenced that the patient did not already silence.
    signalSettings = { backInStock: false }
    render(<UserSaved />)

    const card = screen.getByText('Metformin 500 mg').closest('div[data-slot="card"]')
    expect(within(card).queryByText(/switched off for every saved medicine/i)).toBeNull()
  })

  it('offers the way to fix it', () => {
    signalSettings = { backInStock: false }
    render(<UserSaved />)

    expect(screen.getByRole('button', { name: /Turn on .Back in stock./i })).toBeDefined()
  })

  it('does not touch the per-medicine switch itself', () => {
    // The notice explains; it does not silently flip or disable the control the
    // patient set. Faking the switch would hide the real cause all over again.
    signalSettings = { backInStock: false }
    render(<UserSaved />)

    const toggle = screen.getByLabelText('Toggle alerts for Amoxicillin 500 mg')
    expect(toggle.getAttribute('data-state')).toBe('checked')
    expect(toggle.disabled).toBeFalsy()
  })

  it('still sends only the per-medicine value when toggled', async () => {
    // The two settings stay separate: this page never writes the category.
    signalSettings = { backInStock: false }
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<UserSaved />)

    await user.click(screen.getByLabelText('Toggle alerts for Metformin 500 mg'))

    await waitFor(() =>
      expect(toggleAlertsMock).toHaveBeenCalledWith({ medicineId: 'med_2', alertsEnabled: true }),
    )
  })
})
