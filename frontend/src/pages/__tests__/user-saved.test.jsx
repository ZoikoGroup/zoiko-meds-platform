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
const unsaveMock = vi.fn(async () => ({ saved: false }))
const toggleAlertsMock = vi.fn(async () => ({ success: true }))

vi.mock('@/hooks/use-saved-medicines', () => ({
  useSavedMedicines: () => ({ data: listSavedMock(), isLoading: false }),
  useUnsaveMedicine: () => ({ mutate: (id, opts) => { unsaveMock(id); opts?.onSuccess?.() }, isPending: false }),
  useToggleSavedAlerts: () => ({ mutate: (vars, opts) => { toggleAlertsMock(vars); opts?.onSuccess?.() }, isPending: false }),
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

  it('shows an empty state, and no disclaimer, with nothing saved', () => {
    listSavedMock.mockReturnValue([])
    const { container } = render(<UserSaved />)

    expect(screen.getByText('No saved medicines yet')).toBeDefined()
    expect(container.textContent).not.toMatch(/not exact stock/i)
  })
})
