// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider, useLanguage } from '../language-provider'

/**
 * Language switching and writing direction.
 *
 * dir on <html> is what mirrors the dashboard: with logical CSS utilities
 * everywhere, this single attribute is the whole RTL mechanism, so it is worth
 * pinning precisely.
 */

function Probe() {
  const { language, dir, isRtl, t, setLanguage } = useLanguage()
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="dir">{dir}</span>
      <span data-testid="rtl">{String(isRtl)}</span>
      <span data-testid="home">{t('home')}</span>
      {['en', 'fr', 'ar', 'zh', 'pt', 'xx'].map((l) => (
        <button key={l} onClick={() => setLanguage(l)}>
          to-{l}
        </button>
      ))}
    </div>
  )
}

const renderProbe = () =>
  render(
    <LanguageProvider>
      <Probe />
    </LanguageProvider>,
  )

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('dir')
  document.documentElement.removeAttribute('lang')
})

describe('default language', () => {
  it('starts in English, left-to-right', () => {
    renderProbe()
    expect(screen.getByTestId('lang').textContent).toBe('en')
    expect(screen.getByTestId('dir').textContent).toBe('ltr')
    expect(screen.getByTestId('home').textContent).toBe('Home')
  })

  it('sets lang and dir on the document', () => {
    renderProbe()
    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dir).toBe('ltr')
  })
})

describe('switching language', () => {
  it.each([
    ['fr', 'Accueil', 'ltr'],
    ['zh', '首页', 'ltr'],
    ['pt', 'Início', 'ltr'],
    ['ar', 'الرئيسية', 'rtl'],
  ])('switches to %s, translating and setting dir=%s', async (lang, home, dir) => {
    renderProbe()
    await userEvent.click(screen.getByText(`to-${lang}`))
    expect(screen.getByTestId('lang').textContent).toBe(lang)
    expect(screen.getByTestId('home').textContent).toBe(home)
    expect(screen.getByTestId('dir').textContent).toBe(dir)
    expect(document.documentElement.dir).toBe(dir)
    expect(document.documentElement.lang).toBe(lang)
  })

  it('flips to RTL for Arabic and back to LTR for every other language', async () => {
    renderProbe()
    await userEvent.click(screen.getByText('to-ar'))
    expect(screen.getByTestId('rtl').textContent).toBe('true')
    expect(document.documentElement.dir).toBe('rtl')

    for (const lang of ['en', 'fr', 'zh', 'pt']) {
      await userEvent.click(screen.getByText(`to-${lang}`))
      expect(document.documentElement.dir).toBe('ltr')
      expect(screen.getByTestId('rtl').textContent).toBe('false')
    }
  })

  it('persists the choice', async () => {
    renderProbe()
    await userEvent.click(screen.getByText('to-ar'))
    expect(localStorage.getItem('zoiko-lang')).toBe('ar')
  })

  it('falls back to English for an unsupported code', async () => {
    renderProbe()
    await userEvent.click(screen.getByText('to-xx'))
    expect(screen.getByTestId('lang').textContent).toBe('en')
    expect(document.documentElement.dir).toBe('ltr')
  })
})

describe('restoring a stored language', () => {
  it('applies RTL on mount, before any interaction', () => {
    // Otherwise an Arabic session flashes left-to-right on every reload.
    localStorage.setItem('zoiko-lang', 'ar')
    renderProbe()
    expect(document.documentElement.dir).toBe('rtl')
    expect(screen.getByTestId('home').textContent).toBe('الرئيسية')
  })

  it('ignores a stored code that is no longer supported', () => {
    localStorage.setItem('zoiko-lang', 'klingon')
    renderProbe()
    expect(screen.getByTestId('lang').textContent).toBe('en')
  })
})

describe('translation fallback', () => {
  it('falls back to English for a key a locale is missing', () => {
    renderProbe()
    // No locale defines this; the caller's fallback is used, then the key.
    const { t } = { t: (k, fb) => (fb || k) }
    expect(t('totallyUnknownKey', 'Fallback')).toBe('Fallback')
  })
})
