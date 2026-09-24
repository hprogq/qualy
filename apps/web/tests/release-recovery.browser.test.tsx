import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import type { ReleaseProbe } from '@qualy/release-contract'
import { bootstrapMessages } from '@qualy/web-i18n/bootstrap'
import { createReleaseCoordinator } from '@qualy/web-runtime/release'
import { ReleaseRecoveryGate } from '../src/release-ui.tsx'

// The gate as the reader meets it: a notice that lets the page go on, a
// screen that does not, in the words of the locale the root is marked
// with; and the reload is the reader's to ask for, never the page's.

const current = {
  schema: 1 as const,
  releaseId: 'A',
  mode: 'production' as const,
  clientProtocol: 1,
}
const probeFor = (releaseId: string): ReleaseProbe => ({ schema: 2, releaseId })

const setUp = (answer: ReleaseProbe) => {
  const reload = vi.fn()
  const coordinator = createReleaseCoordinator({
    current,
    fetch: async () => new Response(JSON.stringify(answer), { status: 200 }),
    window: new EventTarget(),
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    channel: null,
    reload,
  })
  return { coordinator, reload }
}

afterEach(() => {
  delete document.documentElement.dataset['locale']
})

for (const locale of ['zh-CN', 'en-US'] as const) {
  const copy = bootstrapMessages[locale]

  describe(`in ${locale}`, () => {
    it('says a newer release is there, and lets the reader go on or reload', async () => {
      document.documentElement.dataset['locale'] = locale
      const { coordinator, reload } = setUp(probeFor('B'))
      await render(
        <ReleaseRecoveryGate coordinator={coordinator} copy={bootstrapMessages}>
          <main>the page</main>
        </ReleaseRecoveryGate>,
      )
      await expect.element(page.getByRole('main')).toBeVisible()
      await coordinator.check({ force: true })
      const notice = page.getByRole('status')
      await expect.element(notice).toBeVisible()
      expect(notice.element().getAttribute('data-release-update')).toBe('B')
      await expect.element(page.getByText(copy.updateAvailableTitle)).toBeVisible()
      // the page is still there, under the notice
      await expect.element(page.getByRole('main')).toBeVisible()
      // later: the notice goes, the page stays, nothing reloads
      await page.getByRole('button', { name: copy.later }).click()
      await expect.element(page.getByRole('status')).not.toBeInTheDocument()
      await expect.element(page.getByRole('main')).toBeVisible()
      expect(reload).not.toHaveBeenCalled()
      // the same release again is not news
      await coordinator.check({ force: true })
      expect(page.getByRole('status').elements()).toHaveLength(0)
    })

    it('reloads only when the reader asks', async () => {
      document.documentElement.dataset['locale'] = locale
      const { coordinator, reload } = setUp(probeFor('B'))
      await render(
        <ReleaseRecoveryGate coordinator={coordinator} copy={bootstrapMessages}>
          <main>the page</main>
        </ReleaseRecoveryGate>,
      )
      await coordinator.check({ force: true })
      await page.getByRole('button', { name: copy.reloadNow }).click()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('takes the page over when a chunk is gone because the server moved on', async () => {
      document.documentElement.dataset['locale'] = locale
      const { coordinator, reload } = setUp(probeFor('B'))
      await render(
        <ReleaseRecoveryGate coordinator={coordinator} copy={bootstrapMessages}>
          <main>the page</main>
        </ReleaseRecoveryGate>,
      )
      coordinator.requireReload('release-skew', probeFor('B'))
      const screen = page.getByRole('alert')
      await expect.element(screen).toBeVisible()
      expect(screen.element().getAttribute('data-release-recovery')).toBe('release-skew')
      await expect.element(page.getByRole('heading', { name: copy.releaseSkewTitle })).toBeVisible()
      await expect.element(page.getByText(copy.releaseSkewHint)).toBeVisible()
      expect(page.getByRole('main').elements()).toHaveLength(0)
      expect(reload).not.toHaveBeenCalled()
      await page.getByRole('button', { name: copy.reloadPage }).click()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('says a file failed to load, and does not claim an update', async () => {
      document.documentElement.dataset['locale'] = locale
      const { coordinator } = setUp(probeFor('A'))
      await render(
        <ReleaseRecoveryGate coordinator={coordinator} copy={bootstrapMessages}>
          <main>the page</main>
        </ReleaseRecoveryGate>,
      )
      coordinator.requireReload('asset-load-failed')
      const screen = page.getByRole('alert')
      await expect.element(screen).toBeVisible()
      expect(screen.element().getAttribute('data-release-recovery')).toBe('asset-load-failed')
      await expect.element(page.getByRole('heading', { name: copy.assetFailedTitle })).toBeVisible()
      expect(screen.element().textContent).not.toContain(copy.updateAvailableTitle)
    })

    it('says the server no longer speaks this page', async () => {
      document.documentElement.dataset['locale'] = locale
      const { coordinator } = setUp(probeFor('A'))
      await render(
        <ReleaseRecoveryGate coordinator={coordinator} copy={bootstrapMessages}>
          <main>the page</main>
        </ReleaseRecoveryGate>,
      )
      coordinator.notifyClientUnsupported('protocol')
      await expect
        .element(page.getByRole('heading', { name: copy.clientProtocolTitle }))
        .toBeVisible()
      await expect.element(page.getByText(copy.clientProtocolHint)).toBeVisible()
    })
  })
}
