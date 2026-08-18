// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '@/providers/language-provider'
import { LANG_NAMES } from '@/locales'
import UserSettings from '../UserSettings'

/**
 * The language picker.
 *
 * It used to hardcode four <option> tags, so four new locale files shipped
 * without ever reaching the dropdown. Driving it from the registry is the whole
 * point of "adding a language must not require editing a component" — this
 * holds that line.
 */

const renderSettings = () =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <UserSettings />
      </LanguageProvider>
    </MemoryRouter>,
  )

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('dir')
})

describe('language picker', () => {
  it('offers every registered locale, not a hardcoded subset', () => {
    renderSettings()
    const options = [...screen.getByLabelText(/interface language/i).options].map((o) => o.value)
    expect(options.sort()).toEqual(Object.keys(LANG_NAMES).sort())
  })

  it('lists each language in its own script', () => {
    renderSettings()
    for (const name of Object.values(LANG_NAMES)) {
      expect(screen.getByRole('option', { name })).toBeTruthy()
    }
  })

  it.each(['fr', 'ar', 'zh', 'pt'])('offers the new %s locale', (code) => {
    renderSettings()
    const options = [...screen.getByLabelText(/interface language/i).options].map((o) => o.value)
    expect(options).toContain(code)
  })

  it('applies Arabic and flips the document to RTL', async () => {
    renderSettings()
    await userEvent.selectOptions(screen.getByLabelText(/interface language/i), 'ar')
    await userEvent.click(screen.getByRole('button', { name: /apply|تطبيق/i }))

    expect(localStorage.getItem('zoiko-lang')).toBe('ar')
    expect(document.documentElement.dir).toBe('rtl')
  })

  it('applies French and stays left-to-right', async () => {
    renderSettings()
    await userEvent.selectOptions(screen.getByLabelText(/interface language/i), 'fr')
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(localStorage.getItem('zoiko-lang')).toBe('fr')
    expect(document.documentElement.dir).toBe('ltr')
  })

  it('translates its own copy once a language is applied', async () => {
    renderSettings()
    await userEvent.selectOptions(screen.getByLabelText(/interface language/i), 'fr')
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(screen.getByText('Langue et région')).toBeTruthy()
  })
})
