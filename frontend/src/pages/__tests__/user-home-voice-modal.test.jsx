// @vitest-environment jsdom
//
// Speak and Search → "Medicine Captured" modal, on a phone.
//
// The footer stacks below sm: (DialogFooter is flex-col-reverse), so the main
// axis is vertical there. The action buttons carried `flex-1`, which is
// `flex: 1 1 0%` — flex-basis 0 on that vertical axis replaced each button's
// height and collapsed it to padding plus one line, overriding even the h-8
// from size="sm". Those classes were written for a row layout.
//
// jsdom computes no layout, so what is asserted here is the class contract that
// produces it: full width and a touch-sized height on mobile, the previous
// desktop values behind sm:.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))

vi.mock('@/providers/language-provider', () => ({
  useLanguage: () => ({ t: (_key, fallback) => fallback }),
}))

vi.mock('@/hooks/use-medicine-suggestions', () => ({
  useMedicineSuggestions: () => ({ suggestions: [], loading: false, error: null }),
}))

vi.mock('@/services/user-api', () => ({
  getUserOverview: async () => ({ summary: {}, featured: [], recentSearches: [] }),
  listNearbyPharmacies: async () => [],
}))

vi.mock('@/services/medicine-api', () => ({
  matchMedicines: async () => [{ id: 'med_1', name: 'Paracetamol' }],
}))

vi.mock('@/features/signal/signal-widget', () => ({ SignalWidget: () => null }))
vi.mock('@/components/shared/location-modal', () => ({ LocationModal: () => null }))

const { default: UserHome } = await import('../UserHome')

/** A stand-in for the browser's SpeechRecognition, driven by the test. */
let recognition
class FakeSpeechRecognition {
  constructor() {
    recognition = this
    this.continuous = false
    this.interimResults = false
    this.lang = 'en-US'
  }
  start() {
    this.onstart?.()
  }
  stop() {
    this.onend?.()
  }
  /** Deliver a spoken phrase the way the real API does. */
  say(transcript) {
    // results[i] is an array of alternatives carrying an isFinal flag; the
    // component only leaves "Listening…" once a result is final.
    const alternatives = [{ transcript }]
    alternatives.isFinal = true
    this.onresult?.({ results: [alternatives], resultIndex: 0 })
  }
  /** Refuse, the way the browser does when the mic permission is denied. */
  fail(error = 'not-allowed') {
    this.onerror?.({ error })
  }
}

/** Open the modal and get it into its "Medicine Captured" review state. */
async function captureMedicine(user, phrase = 'Paracetamol') {
  render(<UserHome />)
  await user.click(screen.getByRole('button', { name: /voice search/i }))
  await waitFor(() => expect(recognition).toBeDefined())
  // Speech arrives outside React's event system.
  await act(async () => recognition.say(phrase))
  await screen.findByText('Medicine Captured')
}

/**
 * Open the modal and get it into its "Voice Search Error" state.
 *
 * The reported case is a denied microphone, which arrives through onerror. In
 * this state Cancel is the only action in the footer — every other button is
 * behind `!voiceError` — so it is the one button carrying the whole footer.
 */
async function failVoice(user, error = 'not-allowed') {
  render(<UserHome />)
  await user.click(screen.getByRole('button', { name: /voice search/i }))
  await waitFor(() => expect(recognition).toBeDefined())
  await act(async () => recognition.fail(error))
  await screen.findByText('Voice Search Error')
}

const actionButton = (name) => screen.getByRole('button', { name })

beforeEach(() => {
  recognition = undefined
  window.SpeechRecognition = FakeSpeechRecognition
  localStorage.setItem('zoiko-user-loc', 'Hyderabad')
  // Answered already, so the unrelated "Use your location?" prompt (a 1s timer)
  // never opens over the modal under test.
  localStorage.setItem('zoiko-loc-permission', 'granted')
})

afterEach(() => {
  cleanup()
  delete window.SpeechRecognition
  localStorage.clear()
})

describe('the captured-medicine actions on a phone', () => {
  it('shows all three actions with their labels', async () => {
    // Labels stay — no icon-only buttons.
    await captureMedicine(userEvent.setup())

    expect(actionButton(/^search$/i)).toBeDefined()
    expect(actionButton(/speak again/i)).toBeDefined()
    expect(actionButton(/^cancel$/i)).toBeDefined()
  })

  it.each([/^search$/i, /speak again/i, /^cancel$/i])(
    'gives %s a touch-sized height on mobile',
    async (name) => {
      await captureMedicine(userEvent.setup())

      // h-11 is 44px — the collapsed version was one line of text tall.
      expect(actionButton(name).className).toContain('h-11')
    },
  )

  it.each([/^search$/i, /speak again/i, /^cancel$/i])(
    'gives %s the full width of the modal on mobile',
    async (name) => {
      await captureMedicine(userEvent.setup())

      expect(actionButton(name).className).toContain('w-full')
    },
  )

  it.each([/^search$/i, /speak again/i, /^cancel$/i])(
    'no longer sizes %s with flex-1, which collapsed it when stacked',
    async (name) => {
      await captureMedicine(userEvent.setup())

      const { className } = actionButton(name)
      expect(className).not.toMatch(/(^|\s)flex-1(\s|$)/)
    },
  )

  it.each([/^search$/i, /speak again/i, /^cancel$/i])(
    'restores the previous desktop sizing for %s behind the sm: breakpoint',
    async (name) => {
      // Desktop must look exactly as it did: h-8, auto width, text-xs.
      await captureMedicine(userEvent.setup())

      const { className } = actionButton(name)
      expect(className).toContain('sm:h-8')
      expect(className).toContain('sm:w-auto')
      expect(className).toContain('sm:text-xs')
    },
  )

  it('keeps the button hierarchy — Search primary, the others outlined', async () => {
    await captureMedicine(userEvent.setup())

    // The teal/primary treatment stays on Search alone.
    expect(actionButton(/^search$/i).className).toMatch(/bg-teal|bg-primary/)
    expect(actionButton(/speak again/i).className).toMatch(/border/)
    expect(actionButton(/^cancel$/i).className).toMatch(/border/)
  })

  it('centres each label inside its button', async () => {
    await captureMedicine(userEvent.setup())

    for (const name of [/^search$/i, /speak again/i, /^cancel$/i]) {
      const { className } = actionButton(name)
      expect(className).toContain('items-center')
      expect(className).toContain('justify-center')
    }
  })

  it('leaves every action reachable by keyboard', async () => {
    await captureMedicine(userEvent.setup())

    for (const name of [/^search$/i, /speak again/i, /^cancel$/i]) {
      expect(actionButton(name).tabIndex).not.toBe(-1)
      expect(actionButton(name).disabled).toBe(false)
    }
  })

  it('keeps the close control available', async () => {
    await captureMedicine(userEvent.setup())

    expect(screen.getByRole('button', { name: /close/i })).toBeDefined()
  })
})

describe('the modal itself', () => {
  it('is held inside the viewport on a narrow phone', async () => {
    await captureMedicine(userEvent.setup())

    // w-full alone let it sit flush against both screen edges at 320px.
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('max-w-[calc(100vw-2rem)]')
    expect(dialog.className).toContain('sm:max-w-[420px]')
  })

  it('keeps the editable medicine name and its validation line', async () => {
    // The fix is layout only — the flow is untouched.
    await captureMedicine(userEvent.setup(), 'Paracetamol')

    // The dashboard field mirrors the transcript too, so scope to the modal's.
    expect(screen.getByLabelText(/edit medicine name/i).value).toBe('Paracetamol')
  })

  it('still searches what was captured', async () => {
    const user = userEvent.setup()
    await captureMedicine(user, 'Paracetamol')

    await user.click(actionButton(/^search$/i))

    await waitFor(() => expect(screen.queryByText('Medicine Captured')).toBeNull())
  })
})

describe('the error state, where Cancel stands alone', () => {
  it('shows the error rather than the capture flow', async () => {
    await failVoice(userEvent.setup())

    expect(screen.getByText('Voice Search Error')).toBeDefined()
    expect(screen.queryByText('Medicine Captured')).toBeNull()
  })

  it('offers Cancel and nothing else', async () => {
    // Speak again, Search and Listening are all behind `!voiceError`, so this
    // footer holds a single button — the case the stacked layout has to survive.
    await failVoice(userEvent.setup())

    expect(actionButton(/^cancel$/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /speak again/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^search$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /listening/i })).toBeNull()
  })

  it('gives Cancel a touch-sized height on mobile', async () => {
    await failVoice(userEvent.setup())

    // h-11 is 44px. Without it the button inherits h-8 from size="sm" (32px),
    // which is what "almost flat" looks like on a phone.
    expect(actionButton(/^cancel$/i).className).toContain('h-11')
  })

  it('gives Cancel the full width of the modal on mobile', async () => {
    await failVoice(userEvent.setup())

    expect(actionButton(/^cancel$/i).className).toContain('w-full')
  })

  it('does not size Cancel with flex-1, which collapsed it when stacked', async () => {
    await failVoice(userEvent.setup())

    expect(actionButton(/^cancel$/i).className).not.toMatch(/(^|\s)flex-1(\s|$)/)
  })

  it('centres the label inside the button', async () => {
    await failVoice(userEvent.setup())

    const { className } = actionButton(/^cancel$/i)
    expect(className).toContain('items-center')
    expect(className).toContain('justify-center')
  })

  it('keeps the desktop sizing behind the sm: breakpoint', async () => {
    await failVoice(userEvent.setup())

    const { className } = actionButton(/^cancel$/i)
    expect(className).toContain('sm:h-8')
    expect(className).toContain('sm:w-auto')
    expect(className).toContain('sm:text-xs')
  })

  it('keeps the text label rather than reducing to an icon', async () => {
    await failVoice(userEvent.setup())

    expect(actionButton(/^cancel$/i).textContent.trim()).toBe('Cancel')
  })

  it('leaves Cancel reachable and enabled', async () => {
    await failVoice(userEvent.setup())

    const cancel = actionButton(/^cancel$/i)
    expect(cancel.tabIndex).not.toBe(-1)
    expect(cancel.disabled).toBe(false)
  })

  it('holds the dialog inside a narrow viewport', async () => {
    await failVoice(userEvent.setup())

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('max-w-[calc(100vw-2rem)]')
    expect(dialog.className).toContain('sm:max-w-[420px]')
  })

  it('still closes the modal when Cancel is pressed', async () => {
    // The layout fix must not have cost the button its job.
    const user = userEvent.setup()
    await failVoice(user)

    await user.click(actionButton(/^cancel$/i))

    await waitFor(() => expect(screen.queryByText('Voice Search Error')).toBeNull())
  })

  it('reports the same way when the browser has no speech recognition at all', async () => {
    // A second route into this state, with no recognition object involved.
    delete window.SpeechRecognition
    const user = userEvent.setup()
    render(<UserHome />)

    await user.click(screen.getByRole('button', { name: /voice search/i }))

    await screen.findByText('Voice Search Error')
    expect(actionButton(/^cancel$/i).className).toContain('h-11')
  })
})
