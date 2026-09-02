// @vitest-environment jsdom
//
// ZoikoSignal → Notification settings: which switches are real.
//
// The three channel switches (push, email, SMS) persisted a boolean and then did
// nothing at all: there is no service worker, no VAPID key and no push
// subscription anywhere in the app; no SMS provider in the dependency tree; and
// while MailService and SMTP are real and used by auth and admin, the patient
// signal producer never injects or calls them — `email` is only echoed back in
// the settings payload. A switch that says "on" while nothing is delivered is
// worse than no switch, so those three are badged and disabled.
//
// The five notification-type switches are genuinely wired now (see the backend
// gate spec) and stay interactive.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationSettings } from '../notification-settings'

vi.mock('@/providers/language-provider', () => ({
  useLanguage: () => ({ t: (_key, fallback) => fallback }),
}))

const ALL_ON = {
  runningLow: true,
  backInStock: true,
  nearbyRestock: true,
  recall: true,
  safety: true,
  push: true,
  email: true,
  sms: true,
}

afterEach(cleanup)

const setup = (settings = ALL_ON) => {
  const onToggle = vi.fn()
  render(<NotificationSettings settings={settings} onToggle={onToggle} />)
  return { onToggle }
}

/** The switch for a labelled row. */
const toggle = (name) => screen.getByRole('switch', { name })

/** The row containing that switch, so its badge can be read. */
const rowFor = (name) => toggle(name).closest('div.flex.items-start')

const IMPLEMENTED = ['Running low', 'Back in stock', 'Nearby restock', 'Medicine recall alerts', 'Government safety alerts']
const COMING_SOON = ['Push notifications', 'Email notifications', 'SMS notifications']

describe('channels with no delivery path', () => {
  it.each(COMING_SOON)('marks %s as Coming Soon', (name) => {
    setup()

    expect(within(rowFor(name)).getByText('Coming Soon')).toBeDefined()
  })

  it.each(COMING_SOON)('disables the %s switch', (name) => {
    setup()

    expect(toggle(name).disabled).toBe(true)
  })

  it.each(COMING_SOON)('ignores a click on %s', async (name) => {
    // Disabled is enforced, not merely styled.
    const user = userEvent.setup()
    const { onToggle } = setup()

    await user.click(toggle(name)).catch(() => {})

    expect(onToggle).not.toHaveBeenCalled()
  })

  it.each(COMING_SOON)('shows %s as off, whatever is stored', (name) => {
    // The stored value is true here. Rendering it "on" would state that email is
    // being delivered, which is the impression being corrected.
    setup()

    expect(toggle(name).getAttribute('data-state')).toBe('unchecked')
  })

  it('keeps the labels, rather than dropping the rows', () => {
    // Product wants patients to know these are planned.
    setup()

    for (const name of COMING_SOON) {
      expect(toggle(name)).toBeDefined()
    }
  })

  it('says when they will work', () => {
    setup()

    expect(
      within(rowFor('Email notifications')).getByText(/available in a future update/i),
    ).toBeDefined()
  })
})

describe('notification types that are wired', () => {
  it.each(IMPLEMENTED)('leaves the %s switch usable', (name) => {
    setup()

    expect(toggle(name).disabled).toBe(false)
    expect(within(rowFor(name)).queryByText('Coming Soon')).toBeNull()
  })

  it.each(IMPLEMENTED)('reports %s from the stored value', (name) => {
    setup({ ...ALL_ON, runningLow: false, backInStock: false, nearbyRestock: false, recall: false, safety: false })

    expect(toggle(name).getAttribute('data-state')).toBe('unchecked')
  })

  it('passes the changed key up so the parent can persist it', async () => {
    const user = userEvent.setup()
    const { onToggle } = setup()

    await user.click(toggle('Back in stock'))

    expect(onToggle).toHaveBeenCalledWith('backInStock')
  })
})

describe('the copy no longer over-promises', () => {
  it('does not claim nearby restock knows where the patient is', () => {
    // The producer fires on a recently refreshed signal from any pharmacy at any
    // distance — it has no radius and no user location.
    setup()

    const row = rowFor('Nearby restock')
    expect(row.textContent).not.toMatch(/nearby pharmacy receives new stock/i)
  })

  it('does not claim recalls are scoped to medicines the patient follows', () => {
    // Recall and safety rows come from platform-wide admin broadcasts, fanned
    // out to every account regardless of saved medicines.
    setup()

    expect(rowFor('Medicine recall alerts').textContent).not.toMatch(/medicines you follow/i)
    expect(rowFor('Government safety alerts').textContent).not.toMatch(/saved medicine classes/i)
  })
})
