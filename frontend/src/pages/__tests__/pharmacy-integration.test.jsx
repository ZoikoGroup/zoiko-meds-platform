// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const getIntegrationMock = vi.fn()
const saveIntegrationMock = vi.fn()
const disconnectIntegrationMock = vi.fn()
const triggerSyncMock = vi.fn()
const issueIntegrationKeyMock = vi.fn()

vi.mock('@/services/pharmacy-api', () => ({
  getIntegration: (...args) => getIntegrationMock(...args),
  saveIntegration: (...args) => saveIntegrationMock(...args),
  disconnectIntegration: (...args) => disconnectIntegrationMock(...args),
  triggerSync: (...args) => triggerSyncMock(...args),
  issueIntegrationKey: (...args) => issueIntegrationKeyMock(...args),
}))

vi.mock('@/lib/api-client', () => ({
  apiBaseUrl: () => 'http://localhost:8000/api',
}))

const { default: PharmacyIntegration } = await import('../pharmacy/PharmacyIntegration')

const DISCONNECTED_VIEW = {
  connected: false,
  provider: null,
  direction: 'PULL',
  enabled: false,
  feedUrl: null,
  authHeaderName: null,
  hasAuthHeader: false,
  syncMode: 'merge',
  intervalMinutes: 60,
  apiKeyPrefix: null,
  apiKeyIssuedAt: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  nextSyncAt: null,
  syncing: false,
  history: [],
}

const CONNECTED_VIEW = {
  connected: true,
  provider: 'Marg ERP',
  direction: 'PULL',
  enabled: true,
  feedUrl: 'https://feeds.example.com/stock.csv',
  authHeaderName: 'Authorization',
  hasAuthHeader: true,
  syncMode: 'merge',
  intervalMinutes: 60,
  apiKeyPrefix: null,
  apiKeyIssuedAt: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  nextSyncAt: null,
  syncing: false,
  history: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('Pharmacy Portal → Integration optional auth header submission', () => {
  it('omits blank auth header fields from request payload on connect', async () => {
    getIntegrationMock.mockResolvedValue({ ...DISCONNECTED_VIEW })
    saveIntegrationMock.mockResolvedValue({ ...CONNECTED_VIEW, hasAuthHeader: false, authHeaderName: null })

    render(<PharmacyIntegration />)
    const user = userEvent.setup()

    await screen.findByRole('button', { name: /connect/i })

    await user.type(screen.getByLabelText(/system name/i), 'Tester POS')
    await user.type(screen.getByLabelText(/feed url/i), 'https://example.com/stock.csv')

    await user.click(screen.getByRole('button', { name: /connect/i }))

    await waitFor(() => expect(saveIntegrationMock).toHaveBeenCalledTimes(1))
    const payload = saveIntegrationMock.mock.calls[0][0]

    expect(payload.provider).toBe('Tester POS')
    expect(payload.feedUrl).toBe('https://example.com/stock.csv')
    expect(payload.authHeaderName).toBeUndefined()
    expect(payload.authHeaderValue).toBeUndefined()
  })

  it('omits whitespace-only auth header fields from request payload', async () => {
    getIntegrationMock.mockResolvedValue({ ...DISCONNECTED_VIEW })
    saveIntegrationMock.mockResolvedValue({ ...CONNECTED_VIEW, hasAuthHeader: false, authHeaderName: null })

    render(<PharmacyIntegration />)
    const user = userEvent.setup()

    await screen.findByRole('button', { name: /connect/i })

    await user.type(screen.getByLabelText(/system name/i), 'Tester POS')
    await user.type(screen.getByLabelText(/feed url/i), 'https://example.com/stock.csv')
    await user.type(screen.getByLabelText(/auth header name/i), '   ')
    await user.type(screen.getByLabelText(/auth header value/i), '   ')

    await user.click(screen.getByRole('button', { name: /connect/i }))

    await waitFor(() => expect(saveIntegrationMock).toHaveBeenCalledTimes(1))
    const payload = saveIntegrationMock.mock.calls[0][0]

    expect(payload.authHeaderName).toBeUndefined()
    expect(payload.authHeaderValue).toBeUndefined()
  })

  it('submits trimmed header name and exact header value when both are provided', async () => {
    getIntegrationMock.mockResolvedValue({ ...DISCONNECTED_VIEW })
    saveIntegrationMock.mockResolvedValue({ ...CONNECTED_VIEW })

    render(<PharmacyIntegration />)
    const user = userEvent.setup()

    await screen.findByRole('button', { name: /connect/i })

    await user.type(screen.getByLabelText(/system name/i), 'Marg ERP')
    await user.type(screen.getByLabelText(/feed url/i), 'https://feeds.example.com/stock.csv')
    await user.type(screen.getByLabelText(/auth header name/i), '  Authorization  ')
    await user.type(screen.getByLabelText(/auth header value/i), 'Bearer  secret123 ')

    await user.click(screen.getByRole('button', { name: /connect/i }))

    await waitFor(() => expect(saveIntegrationMock).toHaveBeenCalledTimes(1))
    const payload = saveIntegrationMock.mock.calls[0][0]

    expect(payload.authHeaderName).toBe('Authorization')
    expect(payload.authHeaderValue).toBe('Bearer  secret123 ')
  })

  it('never prefills stored secret value and omits authHeaderValue on edit when left blank', async () => {
    getIntegrationMock.mockResolvedValue({ ...CONNECTED_VIEW })
    saveIntegrationMock.mockResolvedValue({ ...CONNECTED_VIEW })

    render(<PharmacyIntegration />)
    const user = userEvent.setup()

    const editBtn = await screen.findByRole('button', { name: /edit connection/i })
    await user.click(editBtn)

    const secretInput = screen.getByLabelText(/auth header value/i)
    expect(secretInput.value).toBe('')
    expect(secretInput.getAttribute('placeholder')).toMatch(/stored — leave blank to keep/i)

    const nameInput = screen.getByLabelText(/auth header name/i)
    expect(nameInput.value).toBe('Authorization')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(saveIntegrationMock).toHaveBeenCalledTimes(1))
    const payload = saveIntegrationMock.mock.calls[0][0]

    expect(payload.authHeaderName).toBe('Authorization')
    expect(payload.authHeaderValue).toBeUndefined()
  })

  it('displays validation error returned from the backend in an alert', async () => {
    getIntegrationMock.mockResolvedValue({ ...DISCONNECTED_VIEW })
    saveIntegrationMock.mockRejectedValue(
      new Error('Auth header value is required when an auth header name is provided.'),
    )

    render(<PharmacyIntegration />)
    const user = userEvent.setup()

    await screen.findByRole('button', { name: /connect/i })

    await user.type(screen.getByLabelText(/system name/i), 'Tester POS')
    await user.type(screen.getByLabelText(/feed url/i), 'https://example.com/stock.csv')
    await user.type(screen.getByLabelText(/auth header name/i), 'Authorization')

    await user.click(screen.getByRole('button', { name: /connect/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Auth header value is required when an auth header name is provided/i)
  })
})
