import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Button } from '@qualy/ui/button'
import '../src/app.css'

// The Qualy button contract, asserted on the computed result rather than on
// class names: the product size rhythm survives whatever widget library
// renders the element, asChild still turns the button into its child, and
// caller classes still land. Heights are the contract the screens align on
// (a 36px button sits in a row with 36px fields), so they are asserted in
// pixels.
const box = (locator: { element: () => Element }) => {
  const el = locator.element() as HTMLElement
  const style = getComputedStyle(el)
  return { h: style.height, w: style.width, font: style.fontSize, bg: style.backgroundColor }
}

const mount = (ui: React.ReactNode) => render(<>{ui}</>)

describe('the button keeps its product contract', () => {
  it('sizes follow the product rhythm', async () => {
    mount(
      <>
        <Button>plain</Button>
        <Button size="sm">small</Button>
        <Button size="lg">large</Button>
        <Button size="xs">tiny</Button>
        <Button size="icon" aria-label="gear" />
      </>,
    )
    const plain = page.getByRole('button', { name: 'plain' })
    await expect.poll(() => box(plain).h, { timeout: 5000 }).toBe('36px')
    expect(box(page.getByRole('button', { name: 'small' })).h).toBe('32px')
    expect(box(page.getByRole('button', { name: 'large' })).h).toBe('40px')
    const tiny = box(page.getByRole('button', { name: 'tiny' }))
    expect(tiny.h).toBe('24px')
    expect(tiny.font).toBe('12px')
    const icon = box(page.getByRole('button', { name: 'gear' }))
    expect(icon.h).toBe('36px')
    expect(icon.w).toBe('36px')
  })

  it('variants paint from the shared palette', async () => {
    mount(
      <>
        <Button>primary</Button>
        <Button variant="destructive">remove</Button>
        <Button variant="ghost">quiet</Button>
      </>,
    )
    const primary = page.getByRole('button', { name: 'primary' })
    // --q-primary, light scheme
    await expect.poll(() => box(primary).bg, { timeout: 5000 }).toBe('oklch(0.205 0 0)')
    const remove = page.getByRole('button', { name: 'remove' })
    const removed = remove.element() as HTMLElement
    // soft destructive: a tint, not a solid block and not transparent
    await expect.poll(() => box(remove).bg, { timeout: 5000 }).not.toBe('rgba(0, 0, 0, 0)')
    expect(box(remove).bg).not.toBe(getComputedStyle(removed).color)
    // ghost rests transparent
    expect(box(page.getByRole('button', { name: 'quiet' })).bg).toBe('rgba(0, 0, 0, 0)')
  })

  it('asChild renders the child with the button geometry', async () => {
    mount(
      <Button asChild variant="outline" size="sm" className="mt-2">
        <a href="#somewhere">open</a>
      </Button>,
    )
    const link = page.getByRole('link', { name: 'open' })
    await expect.element(link).toBeVisible()
    await expect.poll(() => box(link).h, { timeout: 5000 }).toBe('32px')
    expect((link.element() as HTMLElement).className).toContain('mt-2')
  })

  it('disabled and click reach the real element', async () => {
    let pressed = 0
    mount(
      <>
        <Button onClick={() => (pressed += 1)}>go</Button>
        <Button disabled>stuck</Button>
      </>,
    )
    await page.getByRole('button', { name: 'go' }).click()
    expect(pressed).toBe(1)
    await expect.element(page.getByRole('button', { name: 'stuck' })).toBeDisabled()
  })
})
