// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Asking the patient which medicine this is.
 *
 * The behaviour under test is a refusal: the system has candidates, one of them
 * is obviously the nearest, and it must not pick it. Everything here is about
 * the confirm action staying out of reach until a human has chosen, and about
 * typed text never becoming a verified medicine on its own.
 */

const matchMedicinesMock = vi.fn()
vi.mock('@/services/medicine-api', () => ({
  matchMedicines: (...args) => matchMedicinesMock(...args),
}))

const { MedicineConfirmation } = await import('../medicine-confirmation')
const { confirmMedicine, VERIFICATION } = await import('../prescription-reader')

const t = (_key, fallback) => fallback

const candidate = (over = {}) => ({
  id: 'amox500',
  brandName: 'Amoxicillin 500 mg',
  genericName: 'Amoxicillin',
  strength: '500 mg',
  dosageForm: 'Capsule',
  manufacturer: 'Generic Labs',
  ...over,
})

const unreadable = (over = {}) => ({
  key: 'rx-0',
  name: 'Amo... 500',
  detail: '500 mg',
  reason: "We couldn't confidently read this medicine. Confirm which one it is, or search for it.",
  needsConfirmation: true,
  status: VERIFICATION.USER_CONFIRMATION_REQUIRED,
  medicineId: null,
  candidates: [candidate(), candidate({ id: 'amox-clav', brandName: 'Amoxicillin + Clavulanate 500/125' })],
  sourceText: 'Amo... 500',
  extracted: { rawText: 'Amo... 500', name: null, strength: '500 mg' },
  ...over,
})

beforeEach(() => {
  matchMedicinesMock.mockReset()
})
afterEach(cleanup)

describe('choosing between candidates', () => {
  it('shows what was unclear and why it is asking', () => {
    render(<MedicineConfirmation medicine={unreadable()} onConfirm={vi.fn()} t={t} />)

    expect(screen.getByText(/couldn't confidently read this medicine/i)).toBeDefined()
  })

  it('lists each candidate with its identity, and no internal score', () => {
    render(<MedicineConfirmation medicine={unreadable()} onConfirm={vi.fn()} t={t} />)

    const group = screen.getByRole('radiogroup')
    const [first] = within(group).getAllByRole('listitem')

    expect(within(first).getByText('Amoxicillin 500 mg')).toBeDefined()
    expect(within(first).getByText(/Amoxicillin · 500 mg · Capsule · Generic Labs/)).toBeDefined()
    // A match score means nothing to a patient and invites false confidence.
    expect(group.textContent).not.toMatch(/0\.\d|score/i)
  })

  it('keeps Confirm out of reach until something is chosen', async () => {
    const user = userEvent.setup()
    render(<MedicineConfirmation medicine={unreadable()} onConfirm={vi.fn()} t={t} />)

    const confirm = screen.getByRole('button', { name: /confirm medicine/i })
    expect(confirm.disabled).toBe(true)

    await user.click(screen.getAllByRole('radio')[0])

    expect(confirm.disabled).toBe(false)
  })

  it('hands back the catalog identity the patient picked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<MedicineConfirmation medicine={unreadable()} onConfirm={onConfirm} t={t} />)

    await user.click(screen.getAllByRole('radio')[1])
    await user.click(screen.getByRole('button', { name: /confirm medicine/i }))

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'amox-clav' }))
  })

  it('never confirms on its own, however obvious the nearest candidate is', () => {
    const onConfirm = vi.fn()
    render(<MedicineConfirmation medicine={unreadable()} onConfirm={onConfirm} t={t} />)

    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('searching the catalog instead', () => {
  it('offers a search even when there are no candidates at all', () => {
    render(<MedicineConfirmation medicine={unreadable({ candidates: [] })} onConfirm={vi.fn()} t={t} />)

    expect(screen.getByLabelText(/search for this medicine/i)).toBeDefined()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('puts catalog hits up as choices, not as an answer', async () => {
    const user = userEvent.setup()
    matchMedicinesMock.mockResolvedValue([candidate({ id: 'found', brandName: 'Amoxicillin 250 mg' })])
    const onConfirm = vi.fn()
    render(<MedicineConfirmation medicine={unreadable({ candidates: [] })} onConfirm={onConfirm} t={t} />)

    await user.type(screen.getByLabelText(/search for this medicine/i), 'Amoxicillin')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    await waitFor(() => expect(screen.getByText('Amoxicillin 250 mg')).toBeDefined())
    // Found is not chosen: a search result still has to be selected and confirmed.
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm medicine/i }).disabled).toBe(true)
  })

  it('routes the typed text through MediBase rather than trusting it', async () => {
    const user = userEvent.setup()
    matchMedicinesMock.mockResolvedValue([])
    render(<MedicineConfirmation medicine={unreadable({ candidates: [] })} onConfirm={vi.fn()} t={t} />)

    await user.type(screen.getByLabelText(/search for this medicine/i), 'Amoxicillin 500')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(matchMedicinesMock).toHaveBeenCalledWith('Amoxicillin 500', 8)
  })

  it('says so when the catalog has nothing, and still refuses to confirm', async () => {
    const user = userEvent.setup()
    matchMedicinesMock.mockResolvedValue([])
    render(<MedicineConfirmation medicine={unreadable({ candidates: [] })} onConfirm={vi.fn()} t={t} />)

    await user.type(screen.getByLabelText(/search for this medicine/i), 'Zzqrrfn')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    await waitFor(() => expect(screen.getByText(/No medicine in the ZoikoMeds catalog matches/i)).toBeDefined())
    expect(screen.getByRole('button', { name: /confirm medicine/i }).disabled).toBe(true)
  })

  it('reports a catalog failure without pretending the medicine is unknown', async () => {
    const user = userEvent.setup()
    matchMedicinesMock.mockRejectedValue(new Error('network'))
    render(<MedicineConfirmation medicine={unreadable({ candidates: [] })} onConfirm={vi.fn()} t={t} />)

    await user.type(screen.getByLabelText(/search for this medicine/i), 'Dolo')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    await waitFor(() => expect(screen.getByText(/Could not search the catalog/i)).toBeDefined())
  })
})

describe('confirmMedicine', () => {
  it('promotes the row to a verified medicine with the catalog id', () => {
    const confirmed = confirmMedicine(unreadable(), candidate())

    expect(confirmed.status).toBe(VERIFICATION.MATCHED)
    expect(confirmed.needsConfirmation).toBe(false)
    expect(confirmed.confirmedByUser).toBe(true)
    expect(confirmed.medicineId).toBe('amox500')
    expect(confirmed.name).toBe('Amoxicillin 500 mg')
    expect(confirmed.detail).toContain('Amoxicillin')
  })

  it('keeps the original reading beside it, so it stays checkable', () => {
    const confirmed = confirmMedicine(unreadable(), candidate())

    expect(confirmed.sourceText).toBe('Amo... 500')
    expect(confirmed.extracted.rawText).toBe('Amo... 500')
  })

  it('clears the candidate list and the reason once settled', () => {
    const confirmed = confirmMedicine(unreadable(), candidate())

    expect(confirmed.candidates).toEqual([])
    expect(confirmed.reason).toBeNull()
  })
})
