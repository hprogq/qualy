import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { FormDialog } from '@qualy/ui/admin'
import { PageNotices, type PageNotice } from '@qualy/ui/page-notices'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

const EXPAND = 'Expand page warnings'
const COLLAPSE = 'Collapse page warnings'
const SHORT = [
  '2 people cannot submit some items',
  '3 organization placements changed',
  '4 grants need review',
]
const LONG =
  'Some participants cannot submit this item because their organization has no matching review route'

function Example({
  count = 1,
  phone = false,
  long = false,
  dialog = false,
  info = false,
}: {
  count?: number
  phone?: boolean
  long?: boolean
  dialog?: boolean
  info?: boolean
}) {
  const [present, setPresent] = useState(true)
  const [selected, setSelected] = useState('')
  const [open, setOpen] = useState(false)
  const notices: PageNotice[] = Array.from({ length: count }, (_, index) => ({
    id: String(index),
    label: long ? `${index + 1}: ${LONG}` : SHORT[index % SHORT.length]!,
    actionLabel: 'View details',
    tone: info || index === 2 ? 'info' : 'warning',
    testId: `notice-${index}`,
    onSelect: () => {
      setSelected(String(index))
      if (dialog) setOpen(true)
    },
  }))
  return (
    <UiProvider scheme="light">
      <button
        type="button"
        onClick={() => setPresent((value) => !value)}
        style={{ position: 'fixed', left: 0, top: 0 }}
      >
        Change page
      </button>
      <output data-testid="selected-notice" style={{ position: 'fixed', left: 0, top: 40 }}>
        {selected}
      </output>
      <main
        data-testid="notice-scrollport"
        style={{
          position: 'fixed',
          left: phone ? 0 : 224,
          top: 112,
          right: 0,
          bottom: 0,
          overflowY: 'auto',
          paddingBottom: 64,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ height: 1800 }}>Page content</div>
        <button type="button" data-testid="last-content-action">
          Last content action
        </button>
        {present && (
          <PageNotices
            notices={notices}
            label="Page warnings"
            expandLabel={EXPAND}
            collapseLabel={COLLAPSE}
          />
        )}
      </main>
      <FormDialog
        open={open}
        title="Warning details"
        onClose={() => setOpen(false)}
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            Close details
          </button>
        }
      >
        <p>People affected by the selected warning</p>
      </FormDialog>
    </UiProvider>
  )
}

afterEach(async () => {
  await page.viewport(1280, 800)
  await commands.emulateMedia({ reducedMotion: 'reduce' })
})

const parkPointer = () => page.getByRole('button', { name: 'Change page' }).hover()
const notice = (index: number) => page.getByTestId(`notice-${index}`)
const dock = () => page.getByTestId('page-notices').element()
const port = () => dock().querySelector<HTMLElement>('[data-slot="page-notices-port"]')!

describe('persistent page warnings', () => {
  it.each([
    { phone: false, long: false },
    { phone: true, long: false },
    { phone: true, long: true },
  ])(
    'stays inside the content viewport above the phone navigation ($phone, long=$long)',
    async ({ phone, long }) => {
      await page.viewport(phone ? 390 : 1440, phone ? 844 : 900)
      await render(<Example phone={phone} long={long} />)
      await expect.element(notice(0)).toBeVisible()
      const dock = page.getByTestId('page-notices').element()
      const bounds = dock.getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual((phone ? 0 : 224) + 12)
      expect(bounds.right).toBeLessThanOrEqual(window.innerWidth - 12)
      expect(bounds.bottom).toBeCloseTo(window.innerHeight - 64 - 48, 0)
      expect(bounds.top).toBeGreaterThan(112)
      const port = page.getByTestId('notice-scrollport').element()
      port.scrollTop = port.scrollHeight
      await expect
        .poll(
          () => page.getByTestId('last-content-action').element().getBoundingClientRect().bottom,
        )
        .toBeLessThanOrEqual(bounds.top)
      expect(dock.getBoundingClientRect().top).toBe(bounds.top)
      expect(getComputedStyle(notice(0).element().parentElement!).backgroundColor).not.toBe(
        'rgba(0, 0, 0, 0)',
      )
    },
  )

  it('draws each notice as a card the shape of the product toasts', async () => {
    await page.viewport(1440, 900)
    await render(<Example count={3} />)
    await parkPointer()
    const card = notice(0).element().parentElement!
    const geometry = card.getBoundingClientRect()
    expect(geometry.width).toBe(400)
    expect(geometry.height).toBeGreaterThanOrEqual(48)
    const surface = getComputedStyle(card)
    const probe = document.createElement('span')
    probe.style.color = 'var(--q-surface-elevated)'
    probe.style.borderRadius = 'var(--q-radius-lg)'
    probe.style.boxShadow = 'var(--q-elevation-2)'
    document.body.append(probe)
    expect(surface.backgroundColor).toBe(getComputedStyle(probe).color)
    expect(surface.borderTopLeftRadius).toBe(getComputedStyle(probe).borderTopLeftRadius)
    expect(surface.boxShadow).toBe(getComputedStyle(probe).boxShadow)
    probe.remove()
    // fanned out, every card keeps the front one's shape
    await notice(0).hover()
    await expect.element(notice(1)).toBeVisible()
    for (const index of [1, 2]) {
      const other = getComputedStyle(notice(index).element().parentElement!)
      expect(other.borderTopLeftRadius).toBe(surface.borderTopLeftRadius)
      expect(notice(index).element().parentElement!.getBoundingClientRect().width).toBe(400)
    }
  })

  it('stacks the notices behind the front one and fans them out above it', async () => {
    await render(<Example count={4} />)
    await parkPointer()
    const dock = page.getByTestId('page-notices').element()
    const slots = () => Array.from(dock.querySelectorAll<HTMLElement>('[data-slot="page-notice"]'))
    expect(slots()).toHaveLength(4)
    const front = slots()[0]!.getBoundingClientRect()
    // two cards peek out above the front one, each a little smaller; more stay hidden
    for (const index of [1, 2]) {
      const behind = slots()[index]!
      expect(behind.getAttribute('aria-hidden')).toBe('true')
      expect(behind.getBoundingClientRect().top).toBeCloseTo(front.top - 10 * index, 0)
      expect(behind.getBoundingClientRect().width).toBeLessThan(front.width)
      expect(Number(getComputedStyle(behind).zIndex)).toBeLessThan(
        Number(getComputedStyle(slots()[0]!).zIndex),
      )
    }
    expect(getComputedStyle(slots()[3]!).opacity).toBe('0')
    await notice(0).hover()
    await expect.element(notice(3)).toBeVisible()
    await expect
      .poll(() => notice(1).element().getBoundingClientRect().bottom)
      .toBeCloseTo(notice(0).element().getBoundingClientRect().top - 8, 0)
    expect(notice(2).element().getBoundingClientRect().bottom).toBeLessThan(
      notice(1).element().getBoundingClientRect().top,
    )
    expect(slots().every((slot) => !slot.hasAttribute('aria-hidden'))).toBe(true)
  })

  it('moves the stack with its own transitions, and not at all for reduced motion', async () => {
    await commands.emulateMedia({ reducedMotion: 'no-preference' })
    const rendered = await render(<Example count={3} />)
    await parkPointer()
    const slot = () =>
      page
        .getByTestId('page-notices')
        .element()
        .querySelector<HTMLElement>('[data-slot="page-notice"]')!
    expect(getComputedStyle(slot()).transitionDuration).not.toBe('0s')
    expect(dock().querySelector('[data-slot="page-notice-wave"]')).toBeNull()
    await rendered.unmount()
    await commands.emulateMedia({ reducedMotion: 'reduce' })
    await render(<Example count={3} />)
    await expect.element(notice(0)).toBeVisible()
    expect(getComputedStyle(slot()).transitionDuration).toBe('0s')
    expect(notice(0).element().parentElement!.getAnimations()).toHaveLength(0)
  })

  it('expands on hover and adds no repeated tooltip or decorative separator text', async () => {
    await render(<Example count={3} />)
    await parkPointer()
    await expect.element(notice(1)).not.toBeInTheDocument()
    await notice(0).hover()
    await expect.element(notice(1)).toBeVisible()
    await expect.element(notice(2)).toBeVisible()
    const dock = page.getByTestId('page-notices').element()
    expect(dock.querySelector('[title]')).toBeNull()
    expect(dock.textContent).not.toMatch(/[\u00b7\u300c\u300d\u2014\u2022]/u)
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument()
    await parkPointer()
    await expect.element(notice(1)).not.toBeInTheDocument()
  })

  it('lets keyboard users enter the expanded actions without relying on hover', async () => {
    await render(<Example count={3} />)
    await parkPointer()
    const toggle = page.getByRole('button', { name: EXPAND }).element() as HTMLButtonElement
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(notice(1)).toBeVisible()
    if (document.activeElement === toggle) await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(notice(1).element())
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('selected-notice')).toHaveTextContent('1')
    await userEvent.keyboard('{Escape}')
    await expect.element(notice(1)).not.toBeInTheDocument()
    expect(document.activeElement).toBe(page.getByRole('button', { name: EXPAND }).element())
  })

  it('accepts a touch-style click without a preceding mouse enter', async () => {
    await page.viewport(390, 844)
    await render(<Example phone count={3} />)
    await parkPointer()
    const toggle = page.getByRole('button', { name: EXPAND }).element() as HTMLButtonElement
    // Touch activation must not depend on the mouse-hover path.
    toggle.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 1 }),
    )
    toggle.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 1 }),
    )
    toggle.click()
    await expect.element(notice(1)).toBeVisible()
    await expect.element(page.getByRole('button', { name: COLLAPSE })).toBeVisible()
  })

  it('scrolls a long stack without shrinking its actions and can open the final warning', async () => {
    await page.viewport(390, 844)
    await render(<Example phone count={10} long />)
    await parkPointer()
    const toggle = page.getByRole('button', { name: EXPAND }).element() as HTMLButtonElement
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(notice(9)).toBeInTheDocument()
    const list = port()
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
    for (let index = 1; index < 10; index += 1) {
      const action = notice(index).element()
      const card = action.parentElement!
      expect(card.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
      expect(card.clientHeight).toBeGreaterThanOrEqual(action.scrollHeight)
    }
    notice(9).element().scrollIntoView({ block: 'nearest' })
    await notice(9).click()
    await expect.element(page.getByTestId('selected-notice')).toHaveTextContent('9')
    expect(
      page.getByTestId('page-notices').element().getBoundingClientRect().right,
    ).toBeLessThanOrEqual(378)
  })

  it('removes its portal when the page unmounts and stays behind an open dialog', async () => {
    await render(<Example dialog />)
    await notice(0).click()
    const dialog = page.getByRole('dialog', { name: 'Warning details' })
    await expect.element(dialog).toBeVisible()
    await expect.poll(() => dialog.element().contains(document.activeElement)).toBe(true)
    const action = notice(0).element()
    const rect = action.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    expect(action.contains(hit)).toBe(false)
    await page.getByRole('button', { name: 'Close details' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Change page' }).click()
    await expect.element(page.getByTestId('page-notices')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="page-notice-space"]')).toBeNull()
  })

  it('keeps expanded warnings below the header in a short landscape viewport', async () => {
    await page.viewport(844, 390)
    await render(<Example phone count={10} long />)
    await parkPointer()
    const toggle = page.getByRole('button', { name: EXPAND }).element() as HTMLButtonElement
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(notice(9)).toBeInTheDocument()
    const list = port()
    await expect.poll(() => list.getBoundingClientRect().height).toBeGreaterThan(48)
    expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(112)
    expect(page.getByTestId('page-notices').element().getBoundingClientRect().bottom).toBeCloseTo(
      390 - 64 - 24,
      0,
    )
    expect(list.clientHeight).toBeGreaterThan(0)
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
    notice(9).element().scrollIntoView({ block: 'nearest' })
    await notice(9).click()
    await expect.element(page.getByTestId('selected-notice')).toHaveTextContent('9')
  })
})
