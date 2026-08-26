// @vitest-environment jsdom
//
// MP-20 — the settings page's copy button flashed a success message without
// touching the clipboard. This holds the routing: the modern API when it is
// there, the selection fallback when it is refused, and a visible failure when
// neither works — a button that changes nothing on failure is what made the
// original one indistinguishable from one that was never wired up.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CopyButton } from '../copy-button'

let writeText

function setClipboard(value) {
  // jsdom exposes navigator.clipboard as a getter with no setter.
  Object.defineProperty(navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  setClipboard({ writeText })
  document.execCommand = vi.fn().mockReturnValue(true)
})

afterEach(cleanup)

describe('CopyButton', () => {
  it('writes the value to the clipboard and says it did', async () => {
    render(<CopyButton value="zk_live_abc" label="Copy key" />)

    fireEvent.click(screen.getByRole('button', { name: /copy key/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('zk_live_abc'))
    expect(await screen.findByText('Copied')).toBeDefined()
  })

  it('falls back to a selection copy when the clipboard API is refused', async () => {
    writeText.mockRejectedValue(new Error('permission denied'))
    render(<CopyButton value="zk_live_abc" label="Copy key" />)

    fireEvent.click(screen.getByRole('button', { name: /copy key/i }))

    await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith('copy'))
    expect(await screen.findByText('Copied')).toBeDefined()
  })

  it('uses the fallback when the clipboard API is absent entirely', async () => {
    // An insecure origin has no navigator.clipboard at all.
    setClipboard(undefined)
    render(<CopyButton value="zk_live_abc" label="Copy key" />)

    fireEvent.click(screen.getByRole('button', { name: /copy key/i }))

    await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith('copy'))
  })

  it('reports a failure rather than looking unwired', async () => {
    writeText.mockRejectedValue(new Error('permission denied'))
    document.execCommand = vi.fn().mockReturnValue(false)
    render(<CopyButton value="zk_live_abc" label="Copy key" />)

    fireEvent.click(screen.getByRole('button', { name: /copy key/i }))

    expect(await screen.findByText('Press Ctrl+C')).toBeDefined()
    expect(screen.queryByText('Copied')).toBeNull()
  })

  it('is disabled when there is nothing to copy', () => {
    render(<CopyButton value="" label="Copy key" />)
    expect(screen.getByRole('button', { name: /copy key/i }).disabled).toBe(true)
  })

  it('removes the scratch element it uses for the fallback', async () => {
    writeText.mockRejectedValue(new Error('permission denied'))
    render(<CopyButton value="zk_live_abc" label="Copy key" />)

    fireEvent.click(screen.getByRole('button', { name: /copy key/i }))

    await waitFor(() => expect(document.execCommand).toHaveBeenCalled())
    // Left behind, it would accumulate one hidden textarea per copy.
    expect(document.querySelectorAll('textarea').length).toBe(0)
  })
})
