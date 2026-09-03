// @vitest-environment jsdom
//
// MP-52 — after paying, nothing happened.
//
// The pharmacy completed hosted checkout, was redirected back, and was told
// "Payment submitted. Your plan activates as soon as the payment provider
// confirms it — this page updates automatically". It did not update
// automatically: the page read the billing record once on mount and then only on
// window focus. And there was nothing to update to, because the only thing that
// could create the subscription was a provider webhook, and the return URL
// carried no session id for the app to confirm the payment itself. When that
// webhook did not arrive the plan never activated, on the pharmacy's page or on
// an administrator's.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const getBillingMock = vi.fn()
const confirmMock = vi.fn()

vi.mock('@/services/pharmacy-api', () => ({
  getBilling: () => getBillingMock(),
  confirmBillingCheckout: (id) => confirmMock(id),
  openBillingPortal: vi.fn(),
  startBillingCheckout: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  apiBaseUrl: () => '/internal',
  apiFetch: () => Promise.resolve(undefined),
}))

const { default: PharmacyBilling } = await import('../pharmacy/PharmacyBilling')

const BILLING = (over = {}) => ({
  linked: true,
  pharmacyName: 'Apollo Kompally',
  classification: 'VERIFIED_NETWORK_CORE',
  canSeeFinancialDetail: true,
  plan: null,
  invoices: [],
  ...over,
})

const ACTIVE = BILLING({
  classification: 'PRO_ACTIVE',
  plan: { state: 'ACTIVE', paidLocations: 1 },
})

/** Land on the page as the provider's redirect leaves it. */
function arriveFrom(query) {
  window.history.replaceState({}, '', `/pharmacy/billing${query}`)
  return render(
    <MemoryRouter initialEntries={[`/pharmacy/billing${query}`]}>
      <PharmacyBilling />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  getBillingMock.mockResolvedValue(BILLING())
  confirmMock.mockResolvedValue({ status: 'active', message: 'Payment confirmed.' })
})

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('returning from a completed checkout', () => {
  it('confirms the payment itself rather than waiting on a webhook', async () => {
    // The whole of the bug: nothing here used to ask anybody whether the payment
    // had landed.
    arriveFrom('?checkout=success&session_id=cs_123')

    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith('cs_123'))
  })

  it('says the payment is confirmed once it is', async () => {
    arriveFrom('?checkout=success&session_id=cs_123')

    expect(await screen.findByText(/payment confirmed/i)).toBeDefined()
  })

  it('re-reads the plan, so the page shows the state it just brought about', async () => {
    getBillingMock.mockResolvedValueOnce(BILLING()).mockResolvedValue(ACTIVE)
    arriveFrom('?checkout=success&session_id=cs_123')

    await waitFor(() => expect(getBillingMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Active')).toBeDefined()
  })

  it('says it is still confirming while it asks, rather than claiming success', async () => {
    let settle
    confirmMock.mockReturnValue(new Promise((res) => { settle = res }))
    arriveFrom('?checkout=success&session_id=cs_123')

    expect(await screen.findByText(/confirming it with the payment provider/i)).toBeDefined()
    settle({ status: 'active' })
  })

  it('keeps asking while the provider has not settled the payment', async () => {
    // An asynchronous payment method, or a browser that beat the provider back.
    // Nothing has gone wrong, so the page waits rather than giving up at once.
    vi.useFakeTimers()
    confirmMock.mockResolvedValue({ status: 'pending' })
    arriveFrom('?checkout=success&session_id=cs_123')

    await vi.waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(5000)
    await vi.waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(2))
    vi.useRealTimers()
  })

  it('stops asking eventually, and says plainly that it is still waiting', async () => {
    // A pharmacy that has been charged must not be left reading "activates
    // automatically" forever over a plan that never activated.
    vi.useFakeTimers()
    confirmMock.mockResolvedValue({ status: 'pending' })
    arriveFrom('?checkout=success&session_id=cs_123')

    await vi.advanceTimersByTimeAsync(12 * 5000)
    vi.useRealTimers()

    expect(await screen.findByText(/has not confirmed it yet/i)).toBeDefined()
    expect(screen.getByText(/contact\s+ZoikoMeds support/i)).toBeDefined()
    // Bounded: it does not go on asking after it has said it gave up.
    const asked = confirmMock.mock.calls.length
    expect(asked).toBeLessThanOrEqual(12)
  })

  it('survives a confirm that fails outright, without alarming the operator', async () => {
    // The webhook may still land. "We do not know yet" is the honest report, and
    // a red error over a successful payment is not.
    vi.useFakeTimers()
    confirmMock.mockRejectedValue(new Error('Network down'))
    arriveFrom('?checkout=success&session_id=cs_123')

    await vi.advanceTimersByTimeAsync(12 * 5000)
    vi.useRealTimers()

    expect(await screen.findByText(/has not confirmed it yet/i)).toBeDefined()
  })
})

describe('arriving any other way', () => {
  it('confirms nothing when the redirect carried no session', async () => {
    // An older link, or somebody typing the query string. There is nothing to
    // confirm and nothing to claim.
    arriveFrom('?checkout=success')

    await screen.findByText(/payment submitted/i)
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('confirms nothing after a cancelled checkout', async () => {
    arriveFrom('?checkout=cancelled')

    expect(await screen.findByText(/nothing has been charged/i)).toBeDefined()
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('confirms nothing on an ordinary visit', async () => {
    arriveFrom('')

    await waitFor(() => expect(getBillingMock).toHaveBeenCalled())
    expect(confirmMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/payment submitted/i)).toBeNull()
  })
})
