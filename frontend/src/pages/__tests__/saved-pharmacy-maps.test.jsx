// @vitest-environment jsdom
//
// Tapping a pharmacy in the Saved Medicines panel opens it on a map.
//
// The panel listed a name, a distance, a freshness and a Call link, and the
// name led nowhere — a patient who wanted to know where "Apollo Pharmacy" was
// had to copy the name into another app. The row is now the destination.
//
// Coordinates first, and by a wide margin: they are the pin an operator placed,
// so they land on the door. An address goes through Google's geocoder, which
// for an address without a plus code can resolve to a street or a
// neighbourhood.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mapsSearchLink, pharmacyMapsLink } from '@/lib/google-maps-url'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, ...rest }) => <a {...rest}>{children}</a>,
}))

vi.mock('@/providers/language-provider', () => ({
  useLanguage: () => ({
    t: (_key, fallback, params) =>
      params
        ? String(fallback).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
        : fallback,
  }),
}))

const listSavedMock = vi.fn()
const toggleAlertsMock = vi.fn()

vi.mock('@/hooks/use-saved-medicines', () => ({
  useSavedMedicines: () => ({
    data: listSavedMock(),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUnsaveMedicine: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleSavedAlerts: () => ({
    mutate: (vars, opts) => {
      toggleAlertsMock(vars)
      opts?.onSuccess?.()
    },
    isPending: false,
  }),
  useSignalSettings: () => ({ data: { backInStock: true } }),
}))

const { default: UserSaved } = await import('../UserSaved')

/** The two pharmacies from the reported screenshot. */
const APOLLO = {
  id: 'ph_apollo',
  name: 'Apollo Pharmacy',
  address: 'Plot 12, Kompally, Hyderabad, Telangana, 500014',
  latitude: 17.5561,
  longitude: 78.4181,
  confidence: 'high',
  distance: 7.7,
  approximate: false,
  updated: '14 days ago',
  phone: '+91 40 2345 6789',
}

const ZOIKO = {
  id: 'ph_zoiko',
  name: 'Zoiko Meds Pharmacy',
  address: 'Main Road, Gandimaisamma, Hyderabad, Telangana, 500043',
  latitude: 17.6012,
  longitude: 78.4433,
  confidence: 'high',
  distance: 12.3,
  approximate: false,
  updated: '5 min ago',
  phone: '+91 40 9876 5432',
}

const saved = (pharmacies) => [
  {
    id: 'med_1',
    name: 'Dolo 650',
    generic: 'Paracetamol',
    strength: '650 mg',
    confidence: 'high',
    pharmacy: 'Apollo Pharmacy',
    distance: 7.7,
    updated: '14 days ago',
    alertsEnabled: true,
    pharmacies,
  },
]

const VIEW_PHARMACIES = /View pharmacies/i

/** Open the panel and hand back the dialog plus a user-event session. */
const openPanel = async (pharmacies) => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  listSavedMock.mockReturnValue(saved(pharmacies))
  render(<UserSaved />)
  await user.click(screen.getByRole('button', { name: VIEW_PHARMACIES }))
  return { user, panel: await screen.findByRole('dialog') }
}

const mapLink = (panel, name) =>
  within(panel).getByRole('link', { name: new RegExp(`Open ${name} in Google Maps`, 'i') })

beforeEach(() => vi.clearAllMocks())

// This project has no vitest setup file, so auto-cleanup is not registered.
afterEach(cleanup)

// --- The destination resolver on its own ------------------------------------

describe('pharmacyMapsLink', () => {
  it('prefers the pin over the address', () => {
    expect(pharmacyMapsLink(APOLLO)).toBe(
      'https://www.google.com/maps/search/?api=1&query=17.5561,78.4181',
    )
  })

  it('falls back to the address, carrying the name to disambiguate it', () => {
    const noPin = { ...APOLLO, latitude: null, longitude: null }

    expect(pharmacyMapsLink(noPin)).toBe(
      mapsSearchLink('Apollo Pharmacy, Plot 12, Kompally, Hyderabad, Telangana, 500014'),
    )
  })

  it('falls back to the name when there is no address either', () => {
    expect(pharmacyMapsLink({ name: 'Apollo Pharmacy' })).toBe(mapsSearchLink('Apollo Pharmacy'))
  })

  it.each(['—', '-', '', '   ', null, undefined])(
    'treats %s as no address rather than a place to search for',
    (address) => {
      // The API joins the address server-side and emits an em dash when nothing
      // is on record. Searching Maps for "—" is worse than not linking.
      const link = pharmacyMapsLink({ name: 'Apollo Pharmacy', address })

      expect(link).toBe(mapsSearchLink('Apollo Pharmacy'))
    },
  )

  it('returns null when there is nothing at all to point at', () => {
    expect(pharmacyMapsLink({})).toBeNull()
    expect(pharmacyMapsLink(null)).toBeNull()
    expect(pharmacyMapsLink({ name: '  ' })).toBeNull()
  })

  it.each([
    [{ latitude: 0, longitude: 0 }, 'the Atlantic — a parse artefact, not a pharmacy'],
    [{ latitude: 91, longitude: 10 }, 'out of range'],
    [{ latitude: 17.5, longitude: 200 }, 'out of range'],
    [{ latitude: 'abc', longitude: 'def' }, 'not numbers'],
  ])('does not pin %o — %s', (coords) => {
    // Reuses the existing isValidCoordinate guard rather than a second one.
    const link = pharmacyMapsLink({ name: 'Apollo Pharmacy', address: '12 High St', ...coords })

    expect(link).toBe(mapsSearchLink('Apollo Pharmacy, 12 High St'))
  })

  it('escapes an address so the query cannot break the URL', () => {
    const link = pharmacyMapsLink({
      name: 'Corner & Co',
      address: 'Shop 3/4, M G Road',
      latitude: null,
      longitude: null,
    })

    expect(link).toContain('Corner%20%26%20Co')
    expect(link).not.toMatch(/[&?]query=.*[&]/)
  })
})

// --- Through the panel ------------------------------------------------------

describe('1 & 2. each row opens its own pharmacy', () => {
  it('Apollo Pharmacy links to Apollo’s coordinates', async () => {
    const { panel } = await openPanel([APOLLO, ZOIKO])

    expect(mapLink(panel, 'Apollo Pharmacy').getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=17.5561,78.4181',
    )
  })

  it('Zoiko Meds Pharmacy links to its own, different coordinates', async () => {
    const { panel } = await openPanel([APOLLO, ZOIKO])

    expect(mapLink(panel, 'Zoiko Meds Pharmacy').getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=17.6012,78.4433',
    )
  })

  it('gives every listed pharmacy its own destination', async () => {
    const { panel } = await openPanel([APOLLO, ZOIKO])
    const hrefs = within(panel)
      .getAllByRole('link', { name: /Open .* in Google Maps/i })
      .map((a) => a.getAttribute('href'))

    expect(new Set(hrefs).size).toBe(2)
  })
})

describe('3 & 4. which location data is used', () => {
  it('uses the pin when one is stored', async () => {
    const { panel } = await openPanel([APOLLO])

    expect(mapLink(panel, 'Apollo Pharmacy').getAttribute('href')).toContain('17.5561,78.4181')
  })

  it('uses the address when no pin is stored', async () => {
    const { panel } = await openPanel([{ ...APOLLO, latitude: null, longitude: null }])

    const href = mapLink(panel, 'Apollo Pharmacy').getAttribute('href')
    expect(href).toContain('Kompally')
    expect(href).not.toContain('17.5561')
  })
})

describe('5 & 6. Call stays its own action', () => {
  it('still offers Call, pointing at the number', async () => {
    const { panel } = await openPanel([APOLLO])

    expect(within(panel).getByRole('link', { name: /^Call$/ }).getAttribute('href')).toContain(
      'tel:',
    )
  })

  it('is not inside the map link, so it cannot open Maps', async () => {
    // A sibling rather than a child: nested anchors are invalid, and keeping
    // Call outside the map target means no click handler has to remember to
    // stop propagating.
    const { panel } = await openPanel([APOLLO])

    const call = within(panel).getByRole('link', { name: /^Call$/ })
    expect(mapLink(panel, 'Apollo Pharmacy').contains(call)).toBe(false)
    expect(call.closest('a[href*="google.com/maps"]')).toBeNull()
  })

  it('clicking Call does not navigate to Maps', async () => {
    const { user, panel } = await openPanel([APOLLO])
    const call = within(panel).getByRole('link', { name: /^Call$/ })
    const clicks = []
    panel.addEventListener('click', (e) => {
      const link = e.target.closest('a')
      if (link) clicks.push(link.getAttribute('href'))
    })

    await user.click(call)

    expect(clicks).toHaveLength(1)
    expect(clicks[0]).toContain('tel:')
    expect(clicks[0]).not.toContain('google.com/maps')
  })

  it('offers no Call for a pharmacy with no number, but still maps it', async () => {
    const { panel } = await openPanel([{ ...APOLLO, phone: '' }])

    expect(within(panel).queryByRole('link', { name: /^Call$/ })).toBeNull()
    expect(mapLink(panel, 'Apollo Pharmacy')).toBeDefined()
  })
})

describe('7. keyboard', () => {
  it('is reachable by Tab and labelled for a screen reader', async () => {
    const { panel } = await openPanel([APOLLO])
    const link = mapLink(panel, 'Apollo Pharmacy')

    // A real anchor: focusable and activatable by Enter without any handler.
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('aria-label')).toBe('Open Apollo Pharmacy in Google Maps')
  })

  it('activates on Space, which an anchor does not do by itself', async () => {
    const { user, panel } = await openPanel([APOLLO])
    const link = mapLink(panel, 'Apollo Pharmacy')
    const clicked = vi.fn((e) => e.preventDefault())
    link.addEventListener('click', clicked)

    link.focus()
    await user.keyboard(' ')

    expect(clicked).toHaveBeenCalled()
  })

  it('activates on Enter', async () => {
    const { user, panel } = await openPanel([APOLLO])
    const link = mapLink(panel, 'Apollo Pharmacy')
    const clicked = vi.fn((e) => e.preventDefault())
    link.addEventListener('click', clicked)

    link.focus()
    await user.keyboard('{Enter}')

    expect(clicked).toHaveBeenCalled()
  })

  it('shows a focus ring, not just a hover state', async () => {
    const { panel } = await openPanel([APOLLO])

    expect(mapLink(panel, 'Apollo Pharmacy').className).toContain('focus-visible:ring-2')
  })
})

describe('8. no location data', () => {
  it('renders the row without a map link rather than a broken search', async () => {
    const bare = {
      id: 'ph_bare',
      name: '',
      address: '—',
      latitude: null,
      longitude: null,
      confidence: 'high',
      distance: 3.2,
      approximate: false,
      updated: '2 min ago',
      phone: '+91 40 1111 2222',
    }
    const { panel } = await openPanel([bare])

    expect(within(panel).queryByRole('link', { name: /in Google Maps/i })).toBeNull()
    // Still listed, and still callable — the pharmacy does report this medicine.
    expect(within(panel).getByRole('link', { name: /^Call$/ })).toBeDefined()
    expect(within(panel).getByText('2 min ago')).toBeDefined()
  })

  it('never emits a Maps URL with an empty query', async () => {
    const { panel } = await openPanel([{ ...APOLLO, name: '', address: '—', latitude: null, longitude: null }])

    for (const a of within(panel).getAllByRole('link')) {
      expect(a.getAttribute('href')).not.toMatch(/query=(&|$)/)
    }
  })
})

describe('9. desktop and mobile', () => {
  it('opens in a new tab, safely', async () => {
    const { panel } = await openPanel([APOLLO])
    const link = mapLink(panel, 'Apollo Pharmacy')

    expect(link.getAttribute('target')).toBe('_blank')
    // Untrusted third-party tab: no window.opener handle back to this one.
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('uses a plain https Maps URL, which a phone hands to its own maps app', async () => {
    // No geo: or comgooglemaps: scheme, so a desktop browser and an Android or
    // iOS handler all resolve it without a per-platform branch.
    const { panel } = await openPanel([APOLLO])

    expect(mapLink(panel, 'Apollo Pharmacy').getAttribute('href')).toMatch(
      /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/,
    )
  })

  it('shows the row is interactive on hover and keeps the name from overflowing', async () => {
    const { panel } = await openPanel([
      { ...APOLLO, name: 'The Very Long Community Pharmacy And Dispensing Chemist Limited' },
    ])
    const link = mapLink(panel, 'The Very Long Community Pharmacy And Dispensing Chemist Limited')

    expect(link.className).toContain('hover:bg-accent')
    expect(link.className).toContain('min-w-0')
    expect(within(link).getByText(/The Very Long Community/).className).toContain('truncate')
  })
})

describe('what the panel does not show', () => {
  it('shows no stock quantity or internal metadata', async () => {
    const { panel } = await openPanel([APOLLO, ZOIKO])

    expect(panel.textContent).not.toMatch(/units|quantity|qty|in stock:/i)
    expect(panel.textContent).not.toMatch(/verificationStatus|commercialClassification|licence/i)
  })

  it('lists exactly the pharmacies the API sent', async () => {
    // Presentation only: nothing added to or removed from the visibility rule.
    const { panel } = await openPanel([APOLLO, ZOIKO])

    expect(within(panel).getAllByRole('listitem')).toHaveLength(2)
  })
})
