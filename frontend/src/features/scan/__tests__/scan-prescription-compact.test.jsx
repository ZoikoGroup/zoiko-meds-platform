// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The results list stays short.
 *
 * A scan can return fourteen medicines. Rendering a search form inside every
 * unsettled one turned the page into something nobody could read, so the list
 * is compact by default and only the row the patient opened shows its controls.
 *
 * The safety rule is unchanged and is the reason Confirm behaves the way it
 * does here: for a row with no settled catalog identity there is nothing for a
 * button to confirm, so Confirm *opens the choices* rather than accepting the
 * reading. Verification still happens only when a MediBase identity is picked.
 */

const readPrescriptionMock = vi.fn()
const matchMedicinesMock = vi.fn()

vi.mock('../prescription-reader', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, readPrescription: (...args) => readPrescriptionMock(...args) }
})
vi.mock('@/services/medicine-api', () => ({
  matchMedicines: (...args) => matchMedicinesMock(...args),
}))
vi.mock('@/providers/language-provider', () => ({
  useLanguage: () => ({ t: (_key, fallback) => fallback }),
}))

const { ScanPrescription } = await import('../scan-prescription')
const { VERIFICATION } = await import('../prescription-reader')

/** A row the catalog could not verify, as the adapter emits it. */
const unsettled = (name, over = {}) => ({
  key: `rx-${name}`,
  name,
  detail: '',
  note: { key: 'notFoundInCatalog', text: 'Read from your prescription but not found in the catalog' },
  reason: 'This medicine is not in the ZoikoMeds catalog. Search by name to check.',
  needsConfirmation: true,
  status: VERIFICATION.NOT_FOUND,
  medicineId: null,
  candidates: [],
  sourceText: name,
  extracted: { rawText: name, name, strength: null },
  ...over,
})

const settled = (name) => ({
  key: `rx-${name}`,
  name,
  detail: 'Paracetamol · 650 mg · Micro Labs Ltd',
  note: null,
  reason: null,
  needsConfirmation: false,
  status: VERIFICATION.MATCHED,
  medicineId: 'med_dolo',
  candidates: [],
  sourceText: name,
  extracted: { rawText: name, name, strength: '650 mg' },
})

const resultOf = (medicines) => ({
  medicines,
  confident: medicines.filter((m) => !m.needsConfirmation),
  unconfirmed: medicines.filter((m) => m.needsConfirmation),
  warnings: [],
  stats: { pages: null, candidates: medicines.length, ocrConfidence: null },
  quality: null,
  needsVisionFallback: false,
  visionUsed: false,
  pageImages: [],
  sourceType: 'image',
  message: null,
})

const upload = async (user) => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], 'rx.png', { type: 'image/png' })
  const input = document.querySelector('input[type=file]')
  await user.upload(input, file)
}

beforeEach(() => {
  readPrescriptionMock.mockReset()
  matchMedicinesMock.mockReset()
})
afterEach(cleanup)

describe('an unsettled medicine, before anyone touches it', () => {
  beforeEach(() => {
    readPrescriptionMock.mockResolvedValue(resultOf([unsettled('Abciximab')]))
  })

  it('renders as a compact row, not a form', async () => {
    const user = userEvent.setup()
    render(<ScanPrescription />)
    await upload(user)

    await screen.findByText('Abciximab')
    // The things that made the page unreadable are absent until asked for.
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByLabelText(/search for this medicine/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /confirm medicine/i })).toBeNull()
  })

  it('says what it is and why it is not settled, in one line each', async () => {
    const user = userEvent.setup()
    render(<ScanPrescription />)
    await upload(user)

    expect(await screen.findByText('Prescription medicine')).toBeDefined()
    expect(
      screen.getByText('Read from your prescription but not found in the catalog'),
    ).toBeDefined()
  })

  it('offers a compact Confirm, and no Search', async () => {
    const user = userEvent.setup()
    render(<ScanPrescription />)
    await upload(user)

    expect(await screen.findByRole('button', { name: /^confirm$/i })).toBeDefined()
    // Search would imply the reading had been verified. It has not been.
    expect(screen.queryByRole('button', { name: /^search$/i })).toBeNull()
  })
})

describe('opening one row', () => {
  it('shows that row’s choices, and only on request', async () => {
    const user = userEvent.setup()
    readPrescriptionMock.mockResolvedValue(resultOf([unsettled('Abciximab')]))
    render(<ScanPrescription />)
    await upload(user)

    await user.click(await screen.findByRole('button', { name: /^confirm$/i }))

    expect(screen.getByLabelText(/search for this medicine/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /confirm medicine/i })).toBeDefined()
  })

  it('leaves every other row compact', async () => {
    const user = userEvent.setup()
    readPrescriptionMock.mockResolvedValue(
      resultOf([unsettled('Abciximab'), unsettled('Vomilast'), unsettled('Zoclar 500')]),
    )
    render(<ScanPrescription />)
    await upload(user)

    const rows = await screen.findAllByRole('listitem')
    await user.click(within(rows[0]).getByRole('button', { name: /^confirm$/i }))

    // One editor open across the whole list, however many medicines there are.
    expect(screen.getAllByLabelText(/search for this medicine/i)).toHaveLength(1)
    expect(within(rows[1]).queryByLabelText(/search for this medicine/i)).toBeNull()
    expect(within(rows[2]).queryByLabelText(/search for this medicine/i)).toBeNull()
  })

  it('moves the editor when a different row is opened', async () => {
    const user = userEvent.setup()
    readPrescriptionMock.mockResolvedValue(resultOf([unsettled('Abciximab'), unsettled('Vomilast')]))
    render(<ScanPrescription />)
    await upload(user)

    const rows = await screen.findAllByRole('listitem')
    await user.click(within(rows[0]).getByRole('button', { name: /^confirm$/i }))
    await user.click(within(rows[1]).getByRole('button', { name: /^confirm$/i }))

    expect(screen.getAllByLabelText(/search for this medicine/i)).toHaveLength(1)
    expect(within(rows[1]).getByLabelText(/search for this medicine/i)).toBeDefined()
  })

  it('collapses again on Cancel', async () => {
    const user = userEvent.setup()
    readPrescriptionMock.mockResolvedValue(resultOf([unsettled('Abciximab')]))
    render(<ScanPrescription />)
    await upload(user)

    await user.click(await screen.findByRole('button', { name: /^confirm$/i }))
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(screen.queryByLabelText(/search for this medicine/i)).toBeNull()
  })
})

describe('the safety rule the compact UI must not loosen', () => {
  it('does not verify the reading just because Confirm was pressed', async () => {
    const user = userEvent.setup()
    readPrescriptionMock.mockResolvedValue(resultOf([unsettled('Abciximab')]))
    render(<ScanPrescription />)
    await upload(user)

    await user.click(await screen.findByRole('button', { name: /^confirm$/i }))

    // Pressing Confirm opened the choices; it did not accept "Abciximab" as a
    // catalog medicine. The row is still unsettled, so the action is Cancel
    // rather than Search, and nothing can be confirmed until something is
    // picked. (The Search button now on screen is the catalog search inside the
    // panel — a query, not an acceptance.)
    const [row] = screen.getAllByRole('listitem')
    expect(within(row).getByRole('button', { name: /^cancel$/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /confirm medicine/i }).disabled).toBe(true)
    expect(screen.getByText('Read from your prescription but not found in the catalog')).toBeDefined()
  })

  it('will not accept typed text that has no catalog identity behind it', async () => {
    const user = userEvent.setup()
    matchMedicinesMock.mockResolvedValue([])
    readPrescriptionMock.mockResolvedValue(resultOf([unsettled('Zzqrrfn')]))
    render(<ScanPrescription />)
    await upload(user)

    await user.click(await screen.findByRole('button', { name: /^confirm$/i }))
    await user.type(screen.getByLabelText(/search for this medicine/i), 'Zzqrrfn')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    await waitFor(() =>
      expect(screen.getByText(/No medicine in the ZoikoMeds catalog matches/i)).toBeDefined(),
    )
    expect(screen.getByRole('button', { name: /confirm medicine/i }).disabled).toBe(true)
  })

  it('becomes a normal, searchable row once a catalog medicine is chosen', async () => {
    const user = userEvent.setup()
    matchMedicinesMock.mockResolvedValue([
      {
        id: 'med_abx',
        brandName: 'Abciximab 2mg/ml',
        genericName: 'Abciximab',
        strength: '2 mg/ml',
        dosageForm: 'Injection',
        manufacturer: 'Reliance',
      },
    ])
    readPrescriptionMock.mockResolvedValue(resultOf([unsettled('Abciximab')]))
    render(<ScanPrescription />)
    await upload(user)

    await user.click(await screen.findByRole('button', { name: /^confirm$/i }))
    await user.type(screen.getByLabelText(/search for this medicine/i), 'Abciximab')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    await waitFor(() => expect(screen.getByRole('radio')).toBeDefined())
    await user.click(screen.getByRole('radio'))
    await user.click(screen.getByRole('button', { name: /confirm medicine/i }))

    // Collapsed, verified, and searchable — in that order.
    await waitFor(() => expect(screen.getByText('Abciximab 2mg/ml')).toBeDefined())
    expect(screen.queryByLabelText(/search for this medicine/i)).toBeNull()
    expect(screen.getByRole('button', { name: /^search$/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /^confirm$/i })).toBeNull()
  })
})

describe('a settled medicine', () => {
  it('renders normally, with Search and no confirmation controls', async () => {
    const user = userEvent.setup()
    readPrescriptionMock.mockResolvedValue(resultOf([settled('Dolo 650')]))
    render(<ScanPrescription />)
    await upload(user)

    expect(await screen.findByText('Dolo 650')).toBeDefined()
    expect(screen.getByText('Paracetamol · 650 mg · Micro Labs Ltd')).toBeDefined()
    expect(screen.getByRole('button', { name: /^search$/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /^confirm$/i })).toBeNull()
  })
})

describe('a long result list', () => {
  it('renders fourteen medicines without a single search form', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 14 }, (_, i) => unsettled(`Medicine ${i + 1}`))
    readPrescriptionMock.mockResolvedValue(resultOf(many))
    render(<ScanPrescription />)
    await upload(user)

    await screen.findByText('Medicine 1')
    expect(screen.getAllByRole('button', { name: /^confirm$/i })).toHaveLength(14)
    expect(screen.queryAllByLabelText(/search for this medicine/i)).toHaveLength(0)
    expect(screen.queryAllByRole('radiogroup')).toHaveLength(0)
  })
})
