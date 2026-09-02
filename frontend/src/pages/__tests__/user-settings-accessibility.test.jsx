// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '@/providers/language-provider'
import UserSettings from '../UserSettings'

/**
 * The accessibility switches.
 *
 * They used to be local useState and a "Coming soon" pill: flipping one moved
 * the switch, changed nothing on the page, and was gone on the next reload.
 * These hold the wiring — a stored preference, and a class on <html> that
 * index.css acts on.
 */

const renderSettings = () =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <UserSettings />
      </LanguageProvider>
    </MemoryRouter>,
  )

const root = () => document.documentElement

beforeEach(() => {
  localStorage.clear()
  root().className = ''
  // jsdom has no matchMedia; the module treats that as "no OS preference".
  vi.stubGlobal('matchMedia', undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  root().className = ''
  root().removeAttribute('dir')
})

describe('accessibility preferences', () => {
  it('applies larger text to the document and remembers it', async () => {
    renderSettings()
    await userEvent.click(screen.getByLabelText('Larger text'))

    expect(root().classList.contains('a11y-large-text')).toBe(true)
    expect(JSON.parse(localStorage.getItem('zoiko-a11y')).largeText).toBe(true)
  })

  it('applies reduce motion to the document and remembers it', async () => {
    renderSettings()
    await userEvent.click(screen.getByLabelText('Reduce motion'))

    expect(root().classList.contains('a11y-reduce-motion')).toBe(true)
    expect(JSON.parse(localStorage.getItem('zoiko-a11y')).reduceMotion).toBe(true)
  })

  it('turns a preference back off', async () => {
    localStorage.setItem('zoiko-a11y', JSON.stringify({ largeText: true, reduceMotion: false }))
    renderSettings()
    expect(root().classList.contains('a11y-large-text')).toBe(true)

    await userEvent.click(screen.getByLabelText('Larger text'))
    expect(root().classList.contains('a11y-large-text')).toBe(false)
    expect(JSON.parse(localStorage.getItem('zoiko-a11y')).largeText).toBe(false)
  })

  it('restores a stored preference on the next visit', () => {
    localStorage.setItem('zoiko-a11y', JSON.stringify({ largeText: false, reduceMotion: true }))
    renderSettings()

    expect(screen.getByLabelText('Reduce motion').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText('Larger text').getAttribute('aria-checked')).toBe('false')
    expect(root().classList.contains('a11y-reduce-motion')).toBe(true)
  })

  it('no longer advertises the switches as unbuilt', async () => {
    renderSettings()
    await userEvent.click(screen.getByLabelText('Larger text'))
    expect(screen.queryByText(/coming soon/i)).toBeNull()
  })

  it('starts reduce motion on when the operating system asks for it', () => {
    vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduced-motion') }))
    renderSettings()

    expect(screen.getByLabelText('Reduce motion').getAttribute('aria-checked')).toBe('true')
    expect(root().classList.contains('a11y-reduce-motion')).toBe(true)
  })

  it('lets a stored choice override the operating system', () => {
    vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduced-motion') }))
    localStorage.setItem('zoiko-a11y', JSON.stringify({ largeText: false, reduceMotion: false }))
    renderSettings()

    expect(screen.getByLabelText('Reduce motion').getAttribute('aria-checked')).toBe('false')
    expect(root().classList.contains('a11y-reduce-motion')).toBe(false)
  })
})
