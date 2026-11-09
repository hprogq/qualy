import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import '@qualy/ui/theme.css'
import { DeadlineDock } from '../src/client/batch/DeadlineDock.tsx'

it('keeps the server-painted dock still, drags away, and snaps back to its outline', async () => {
  await page.viewport(950, 680)
  await commands.emulateMedia({ reducedMotion: 'no-preference' })
  const locale = document.documentElement.getAttribute('data-locale')
  document.documentElement.setAttribute('data-locale', 'zh-CN')
  const host = document.createElement('div')
  document.body.append(host)
  const errors: unknown[] = []
  const content = (remaining: number) => (
    <main
      style={{
        width: 640,
        height: 480,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      <span
        data-testid="away"
        style={{ position: 'absolute', width: 12, height: 12, left: 210, top: 144 }}
      />
      <span
        data-testid="near"
        style={{ position: 'absolute', width: 12, height: 12, left: 326, top: 375 }}
      />
      <DeadlineDock
        id="deadline"
        batchId="deadline-fixture"
        title="正式填报"
        detail="23:00"
        countdown={{
          text: remaining < 3_600_000 ? '剩余 37 分钟' : '剩余 5 小时',
          remaining,
          progress: 0.8,
        }}
      />
    </main>
  )
  let root: ReturnType<typeof hydrateRoot> | undefined
  let observer: MutationObserver | undefined
  try {
    const initial = content(37 * 60_000)
    host.innerHTML = renderToString(initial)
    const dock = page.getByTestId('deadline')
    const card = dock.element()
    const origin = card.getBoundingClientRect()
    expect(card.closest('main')!.getBoundingClientRect().bottom - origin.bottom).toBeCloseTo(64, 0)
    const style = getComputedStyle(card)
    const paint = [style.backgroundColor, style.borderTopColor]
    const progress = card.querySelector<HTMLElement>('[data-slot="deadline-progress"]')!
    const figures = card.querySelector<HTMLElement>('[data-slot="deadline-countdown"]')!
    const urgent = getComputedStyle(figures).color
    expect(getComputedStyle(progress).backgroundColor).toBe(urgent)
    expect(style.animationName).toBe('none')

    root = hydrateRoot(host, initial, { onRecoverableError: (error) => errors.push(error) })
    let outlineSeen = false
    observer = new MutationObserver((records) => {
      for (const record of records)
        for (const added of record.addedNodes)
          if (added instanceof SVGElement && added.dataset['slot'] === 'deadline-home')
            outlineSeen =
              getComputedStyle(added.querySelector('rect')!).strokeDasharray === '8px, 5px'
    })
    observer.observe(card.parentElement!, { childList: true })
    await dock.dropTo(page.getByTestId('away'))
    await expect.poll(() => card.getBoundingClientRect().top).toBeLessThan(origin.top - 100)
    expect(outlineSeen).toBe(true)
    expect(card.parentElement!.querySelector('[data-slot="deadline-home"]')).toBeNull()

    let snappedBeforeRelease = false
    card.addEventListener(
      'pointerup',
      () => {
        snappedBeforeRelease =
          card.dataset['dragging'] === 'true' && card.dataset['snapped'] === 'true'
      },
      { once: true },
    )
    await dock.dropTo(page.getByTestId('near'))
    expect(snappedBeforeRelease).toBe(true)
    await expect.poll(() => Math.abs(card.getBoundingClientRect().top - origin.top)).toBeLessThan(1)
    await expect
      .poll(() => Math.abs(card.getBoundingClientRect().left - origin.left))
      .toBeLessThan(1)

    card.querySelector('button')!.focus()
    await userEvent.keyboard('{ArrowUp}')
    await expect.poll(() => card.getBoundingClientRect().top).toBeLessThan(origin.top - 8)
    await userEvent.keyboard('{Home}')
    await expect.poll(() => Math.abs(card.getBoundingClientRect().top - origin.top)).toBeLessThan(1)
    root.render(content(5 * 3_600_000))
    await expect.element(dock).toHaveAttribute('data-tone', 'calm')
    expect(getComputedStyle(figures).color).not.toBe(urgent)
    expect(getComputedStyle(progress).backgroundColor).toBe(getComputedStyle(figures).color)
    expect([getComputedStyle(card).backgroundColor, getComputedStyle(card).borderTopColor]).toEqual(
      paint,
    )
    expect(errors).toEqual([])
    expect(dock.element()).toBe(card)
  } finally {
    observer?.disconnect()
    root?.unmount()
    host.remove()
    if (locale === null) document.documentElement.removeAttribute('data-locale')
    else document.documentElement.setAttribute('data-locale', locale)
    await commands.emulateMedia({ reducedMotion: 'reduce' })
  }
})

it('keeps the countdown and timeline action together when a long deadline wraps', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const locale = document.documentElement.getAttribute('data-locale')
  document.documentElement.setAttribute('data-locale', 'en-US')
  const title = 'Supplementary review of the long-running assessment round'
  const detail = 'Reviewing closes on November 10 at 02:00 China Standard Time'
  try {
    host.innerHTML = renderToString(
      <main style={{ maxWidth: 460, paddingInline: 12 }}>
        <DeadlineDock
          id="compact-deadline"
          batchId="deadline-fixture"
          title={title}
          detail={detail}
          countdown={{ text: '31 minutes left', remaining: 31 * 60_000, progress: 0.9 }}
        />
      </main>,
    )
    // Also exercise a narrow pane inside a wide viewport.
    for (const width of [320, 390, 920]) {
      await page.viewport(width, 680)
      const card = page.getByTestId('compact-deadline').element()
      const heading = card.querySelector<HTMLElement>('[title="' + title + '"]')!
      const date = page.getByText(detail, { exact: true }).element()
      const countdown = card.querySelector<HTMLElement>('[data-slot="deadline-countdown"]')!
      const action = card.querySelector<HTMLElement>('button[aria-haspopup="dialog"]')!
      const bounds = card.getBoundingClientRect()
      const line = heading.getBoundingClientRect()
      const numbers = countdown.getBoundingClientRect()
      const button = action.getBoundingClientRect()
      const centerY = (rect: DOMRect) => rect.top + rect.height / 2
      expect(Math.abs(centerY(line) - centerY(numbers))).toBeLessThan(1)
      expect(Math.abs(centerY(line) - centerY(button))).toBeLessThan(1)
      expect(line.right).toBeLessThan(numbers.left)
      expect(numbers.right).toBeLessThan(button.left)
      expect(date.getBoundingClientRect().top).toBeGreaterThan(line.bottom)
      expect(date.scrollWidth).toBe(date.clientWidth)
      expect(bounds.left).toBeGreaterThan(0)
      expect(bounds.right).toBeLessThan(width)
      expect(getComputedStyle(heading).textOverflow).toBe('ellipsis')
    }
  } finally {
    host.remove()
    if (locale === null) document.documentElement.removeAttribute('data-locale')
    else document.documentElement.setAttribute('data-locale', locale)
  }
})
