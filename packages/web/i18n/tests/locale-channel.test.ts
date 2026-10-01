import { afterEach, expect, it, vi } from 'vitest'
import { onLocaleChosenElsewhere, reopenInLocale } from '../src/locale-channel.ts'

const stops: (() => void)[] = []
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  vi.unstubAllGlobals()
})

it('reloads the choosing document without notifying its other-page listener', async () => {
  const reload = vi.fn()
  vi.stubGlobal('window', { location: { reload } })
  const listener = vi.fn()
  stops.push(onLocaleChosenElsewhere(listener))
  const received = new Promise<MessageEvent>((resolve) => {
    const other = new BroadcastChannel('qualy.locale')
    other.onmessage = resolve
    stops.push(() => other.close())
  })
  reopenInLocale('en-US')
  expect(reload).toHaveBeenCalledOnce()
  expect((await received).data).toMatchObject({ locale: 'en-US' })
  // Both channels received the same broadcast before this task completes.
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(listener).not.toHaveBeenCalled()
})

it('hears a choice from another document, including older pages without a source', async () => {
  const received: string[] = []
  let heard: (() => void) | undefined
  stops.push(
    onLocaleChosenElsewhere((locale) => {
      received.push(locale)
      heard?.()
    }),
  )
  const other = new BroadcastChannel('qualy.locale')
  stops.push(() => other.close())
  for (const message of [{ locale: 'en-US', source: 'another-document' }, { locale: 'zh-CN' }]) {
    const delivered = new Promise<void>((resolve) => {
      heard = resolve
    })
    other.postMessage(message)
    await delivered
  }
  expect(received).toEqual(['en-US', 'zh-CN'])
})

it('still reloads when BroadcastChannel is unavailable', () => {
  vi.stubGlobal('BroadcastChannel', undefined)
  const reload = vi.fn()
  vi.stubGlobal('window', { location: { reload } })
  stops.push(onLocaleChosenElsewhere(vi.fn()))
  reopenInLocale('en-US')
  expect(reload).toHaveBeenCalledOnce()
})
