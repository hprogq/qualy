import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { CaptchaPrompt } from '../src/contract.ts'
import {
  CaptchaChallenge,
  registerCaptchaProvider,
  useCaptchaGate,
  type CaptchaClientState,
  type CaptchaPlacement,
  type CaptchaSolution,
} from '../src/client/index.ts'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// A challenge from the moment a request is answered with one to the proof.
//
// A scripted provider throughout: the suite says when it is working, when it
// needs the person and when it is done, and watches what the host shows and
// what reaches the caller. Nothing here knows what any real provider does.

interface Script {
  started: number
  disposed: number
  /** how the latest start reports; an earlier start keeps its own */
  report: (state: CaptchaClientState) => void
}

const scripted = (): Script => {
  const script: Script = { started: 0, disposed: 0, report: () => undefined }
  return script
}

let unregister: () => void = () => undefined
afterEach(() => unregister())

const provide = (script: Script) => {
  unregister = registerCaptchaProvider({
    code: 'fake',
    start: ({ container, onStateChange }) => {
      script.started += 1
      script.report = onStateChange
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'tick'
      container.append(button)
      return Promise.resolve({
        dispose: () => {
          script.disposed += 1
          button.remove()
        },
      })
    },
  })
}

const prompt = (provider = 'fake'): CaptchaPrompt => ({ provider, challenge: { n: 1 } })

function Form({
  initial,
  placement,
  solved,
  refreshed,
}: {
  initial: CaptchaPrompt | null
  placement: CaptchaPlacement
  solved: CaptchaSolution[]
  refreshed: { count: number }
}) {
  const [current, setCurrent] = useState<CaptchaPrompt | null>(initial)
  const gate = useCaptchaGate({
    prompt: current,
    placement,
    onSolved: (solution) => solved.push(solution),
    onRefresh: () => {
      refreshed.count += 1
    },
  })
  return (
    <div>
      <CaptchaChallenge gate={gate} />
      <button type="button" onClick={gate.cancel}>
        abandon
      </button>
      <button type="button" onClick={() => setCurrent(null)}>
        drop
      </button>
    </div>
  )
}

const open = (placement: CaptchaPlacement = 'inline', initial: CaptchaPrompt | null = prompt()) => {
  const solved: CaptchaSolution[] = []
  const refreshed = { count: 0 }
  renderScreen({
    client: fakeClient({ app: { getManifest: emptyManifest() } }),
    children: (
      <Form initial={initial} placement={placement} solved={solved} refreshed={refreshed} />
    ),
  })
  return { solved, refreshed }
}

const host = () => page.getByTestId('captcha-challenge')

describe('a challenge that needs nobody', () => {
  it('works where nobody sees it and hands the proof over once', async () => {
    const script = scripted()
    provide(script)
    const { solved } = open()
    await expect.poll(() => script.started).toBeGreaterThan(0)
    await expect.element(host()).toHaveAttribute('data-state', 'loading-provider')
    script.report({ kind: 'working' })
    await expect.element(host()).toHaveAttribute('data-state', 'working')
    script.report({ kind: 'solved', response: 'proof' })
    await expect.element(host()).toHaveAttribute('data-state', 'idle')
    // said once, whatever else the provider says after it
    script.report({ kind: 'solved', response: 'again' })
    expect(solved).toEqual([{ provider: 'fake', response: 'proof' }])
  })
})

describe('a challenge that needs the person', () => {
  it('opens in the form, with the challenge in reach', async () => {
    const script = scripted()
    provide(script)
    open()
    await expect.poll(() => script.started).toBeGreaterThan(0)
    script.report({ kind: 'interaction-required' })
    await expect.element(host()).toHaveAttribute('data-state', 'interaction')
    await expect.element(page.getByRole('button', { name: 'tick' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'tick' })).toHaveFocus()
    expect(page.getByRole('dialog').elements()).toHaveLength(0)
    // as wide as the form it stands in, so a provider sizing itself to its
    // container lines up with the fields above it
    const container = page.getByRole('button', { name: 'tick' }).element().parentElement!
    expect(container.getBoundingClientRect().width).toBe(
      host().element().getBoundingClientRect().width,
    )
  })

  it('comes over the page only once it needs the person, when placed there', async () => {
    const script = scripted()
    provide(script)
    open('modal')
    await expect.poll(() => script.started).toBeGreaterThan(0)
    script.report({ kind: 'working' })
    await expect.element(host()).toHaveAttribute('data-state', 'working')
    expect(page.getByRole('dialog').elements()).toHaveLength(0)
    script.report({ kind: 'interaction-required' })
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'tick' })).toBeVisible()
  })
})

describe('a challenge left behind', () => {
  it('delivers nothing once it was abandoned, however late the provider finishes', async () => {
    const script = scripted()
    provide(script)
    const { solved } = open()
    await expect.poll(() => script.started).toBeGreaterThan(0)
    const late = script.report
    await page.getByRole('button', { name: 'abandon' }).click()
    await expect.element(host()).toHaveAttribute('data-state', 'idle')
    await expect.poll(() => script.disposed).toBe(script.started)
    late({ kind: 'solved', response: 'too late' })
    expect(solved).toEqual([])
  })

  it('is taken down when the prompt goes', async () => {
    const script = scripted()
    provide(script)
    const { solved } = open()
    await expect.poll(() => script.started).toBeGreaterThan(0)
    const late = script.report
    await page.getByRole('button', { name: 'drop' }).click()
    await expect.poll(() => script.disposed).toBe(script.started)
    late({ kind: 'solved', response: 'too late' })
    expect(solved).toEqual([])
  })

  it('starts the same challenge over when it can be met again', async () => {
    const script = scripted()
    provide(script)
    const opened = open()
    await expect.poll(() => script.started).toBeGreaterThan(0)
    const before = script.started
    script.report({ kind: 'failed', recovery: 'restart' })
    await expect.element(host()).toHaveAttribute('data-state', 'failed')
    await expect.element(host()).toHaveAttribute('data-recovery', 'restart')
    await expect.element(page.getByRole('alert')).toBeVisible()
    await page.getByRole('button', { name: '重试' }).click()
    await expect.poll(() => script.started).toBeGreaterThan(before)
    expect(opened.refreshed.count).toBe(0)
  })

  it('asks the caller for a new challenge when this one is spent', async () => {
    const script = scripted()
    provide(script)
    const opened = open()
    await expect.poll(() => script.started).toBeGreaterThan(0)
    const before = script.started
    script.report({ kind: 'failed', recovery: 'refresh' })
    await expect.element(host()).toHaveAttribute('data-recovery', 'refresh')
    await page.getByRole('button', { name: '重试' }).click()
    await expect.poll(() => opened.refreshed.count).toBe(1)
    // nothing was brought up again on the spent challenge
    expect(script.started).toBe(before)
  })

  it('fails at once for a provider this build does not carry', async () => {
    const script = scripted()
    provide(script)
    open('inline', prompt('elsewhere'))
    await expect.element(host()).toHaveAttribute('data-state', 'failed')
    expect(script.started).toBe(0)
  })
})
