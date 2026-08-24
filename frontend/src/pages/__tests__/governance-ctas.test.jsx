// @vitest-environment jsdom
//
// Leadership & Oversight — the two CTAs at the bottom of the page (MSA-29).
//
// Both were bare <Button> elements with no onClick, no href and no asChild
// link: they rendered, they depressed, and nothing happened. A test that only
// asserted they were on screen would have passed throughout, so these assert
// what each one actually does — navigates somewhere real, or files a real
// request.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

const submitMock = vi.fn()
vi.mock('@/services/enterprise-api', () => ({
  submitEnterpriseInquiry: (...args) => submitMock(...args),
  INQUIRY_TYPE: { SECURITY_REVIEW: 'SECURITY_REVIEW' },
}))

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    user: { id: 'u_1', name: 'Sanchit Kapoor', email: 'sanchit@zoikogroup.com' },
  }),
}))

// Imported statically: vi.mock is hoisted above this, and pulling the page in
// from inside beforeEach made the first hook pay the whole transform cost and
// time out.
import Governance from '@/pages/Governance'

beforeEach(() => {
  submitMock.mockResolvedValue({
    id: 'inq_1',
    status: 'NEW',
    message: 'Your request has been received.',
  })
})

afterEach(cleanup)

describe('Trust Center CTA', () => {
  // The trust site has not shipped, so there is no URL to send anyone to. The
  // link must still land on something real — the standards published further up
  // this same page — rather than being a button that does nothing.
  it('links to the standards on this page when no trust site is configured', () => {
    render(<Governance />)

    const cta = screen.getByRole('link', { name: /standards we operate against/i })
    expect(cta.getAttribute('href')).toBe('#trust-center')
    // And the anchor it names has to exist, or the link is dead in a subtler way.
    expect(document.getElementById('trust-center')).not.toBeNull()
  })

  it('is a link, not a button, so it can be opened in a new tab', () => {
    render(<Governance />)
    expect(screen.queryByRole('button', { name: /trust center/i })).toBeNull()
  })
})

describe('Security & Procurement Review CTA', () => {
  it('files a SECURITY_REVIEW inquiry with the queue-routing fields the API needs', async () => {
    const user = userEvent.setup()
    render(<Governance />)

    await user.click(
      screen.getByRole('button', { name: /request security & procurement review/i }),
    )

    // Prefilled from the signed-in account: the person pressing this inside the
    // console is normally asking on their own behalf.
    expect(screen.getByLabelText(/your name/i).value).toBe('Sanchit Kapoor')

    await user.type(screen.getByLabelText(/^organization$/i), 'Acme Health')
    await user.click(screen.getByRole('button', { name: /send request/i }))

    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1))
    const [payload] = submitMock.mock.calls[0]
    expect(payload).toMatchObject({
      type: 'SECURITY_REVIEW',
      fullName: 'Sanchit Kapoor',
      workEmail: 'sanchit@zoikogroup.com',
      organizationName: 'Acme Health',
      requestSource: 'admin-governance',
    })
    // The type is what routes it to the security-procurement queue server-side;
    // the client never names the queue itself.
    expect(payload.assignedQueue).toBeUndefined()
  })

  it('confirms with the reference the API returned rather than a generic success', async () => {
    const user = userEvent.setup()
    render(<Governance />)

    await user.click(
      screen.getByRole('button', { name: /request security & procurement review/i }),
    )
    await user.type(screen.getByLabelText(/^organization$/i), 'Acme Health')
    await user.click(screen.getByRole('button', { name: /send request/i }))

    expect(await screen.findByText(/request received/i)).toBeTruthy()
    expect(screen.getByText('inq_1')).toBeTruthy()
  })

  // A failed request must not read as a filed one — the whole defect being fixed
  // is a control that reports nothing about what it did.
  it('reports a failure instead of confirming', async () => {
    submitMock.mockRejectedValue(new Error('Unable to reach the ZoikoMeds API.'))
    const user = userEvent.setup()
    render(<Governance />)

    await user.click(
      screen.getByRole('button', { name: /request security & procurement review/i }),
    )
    await user.type(screen.getByLabelText(/^organization$/i), 'Acme Health')
    await user.click(screen.getByRole('button', { name: /send request/i }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/unable to reach/i)
    expect(screen.queryByText(/request received/i)).toBeNull()
  })
})
