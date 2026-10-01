import { afterEach, expect, it, vi } from 'vitest'
import { handlePlatformFailure } from '../src/mutation-failure.ts'
import * as m from '@qualy/web-i18n/messages'

afterEach(() => {
  delete (globalThis as { document?: unknown }).document
})
const policy = () => {
  ;(globalThis as { document?: unknown }).document = {
    documentElement: { dataset: { locale: 'zh-CN' } },
  }
  return { notify: vi.fn(), diagnose: vi.fn(), capture: vi.fn() }
}

it('leaves endpoint failures and their payloads to the use case', () => {
  const ports = policy()
  expect(handlePlatformFailure({ _tag: 'USER_CONFLICT', field: 'email' }, ports)).toBe(false)
  expect(ports.notify).not.toHaveBeenCalled()
  expect(ports.diagnose).not.toHaveBeenCalled()
})

it('presents access and network failures in the document language', () => {
  const ports = policy()
  expect(handlePlatformFailure({ _tag: 'ACCESS_DENIED' }, ports)).toBe(true)
  expect(ports.notify).toHaveBeenCalledWith(m.error_accessDenied(), 'ACCESS_DENIED')
  expect(
    handlePlatformFailure({ _tag: 'HttpClientError', reason: { _tag: 'TransportError' } }, ports),
  ).toBe(true)
  expect(ports.notify).toHaveBeenCalledWith(m.error_network(), 'UNEXPECTED_FAILURE')
  expect(ports.diagnose).not.toHaveBeenCalled()
  expect(ports.capture).not.toHaveBeenCalled()
})

it('captures programming failures without misreporting them as network errors', () => {
  const ports = policy()
  const failure = new TypeError('Cannot read properties of undefined')
  handlePlatformFailure(failure, ports)
  expect(ports.notify).toHaveBeenCalledWith(m.error_unexpected(), 'UNEXPECTED_FAILURE')
  expect(ports.capture).toHaveBeenCalledWith(failure)
})

it('reports contract failures and avoids duplicating the release prompt', () => {
  const ports = policy()
  handlePlatformFailure({ _tag: 'BAD_REQUEST' }, ports)
  expect(ports.diagnose).toHaveBeenCalledWith('BAD_REQUEST')
  ports.notify.mockClear()
  expect(handlePlatformFailure({ _tag: 'QUALY_CLIENT_RELEASE_UNSUPPORTED' }, ports)).toBe(true)
  expect(ports.notify).not.toHaveBeenCalled()
})

it('defaults to a rate-limit message and supports an explicit cooldown callback', () => {
  const ports = policy()
  const error = { _tag: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: 90 }
  handlePlatformFailure(error, ports)
  expect(ports.notify).toHaveBeenCalledWith(
    m.error_tooManyAttempts({ minutes: 2 }),
    'TOO_MANY_ATTEMPTS',
  )
  ports.notify.mockClear()
  const onRateLimited = vi.fn()
  handlePlatformFailure(error, { ...ports, onRateLimited })
  expect(onRateLimited).toHaveBeenCalledWith({ retryAfterSeconds: 90 })
  expect(ports.notify).not.toHaveBeenCalled()
})
