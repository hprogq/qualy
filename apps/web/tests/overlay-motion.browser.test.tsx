import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Button } from '@qualy/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import { UiProvider } from '@qualy/ui/provider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import '../src/app.css'

// How a panel anchored to a trigger arrives: it travels a few pixels out of
// its trigger while it fades, and it is never scaled. The widget's stock
// entrance grew the panel from ninety percent while raising it from below,
// so a list opening under its trigger came up from further down the page.
//
// Asserted on every transform the panel is given on its way in, caught as
// the widget writes them, and on the side a flipped panel travels from.

// the runner asks for reduced motion, which takes every duration to zero;
// the entrance only exists for a reader who has not
beforeEach(() => commands.emulateMedia({ reducedMotion: 'no-preference' }))
afterEach(() => commands.emulateMedia({ reducedMotion: 'reduce' }))

/** every inline transform a panel matching `selector` is given from now on */
const watchTransforms = (selector: string) => {
  const seen: string[] = []
  const record = (node: Node) => {
    if (!(node instanceof HTMLElement)) return
    const panel = node.matches(selector) ? node : node.querySelector<HTMLElement>(selector)
    if (panel !== null && panel.style.transform !== '') seen.push(panel.style.transform)
  }
  const observer = new MutationObserver((records) => {
    for (const change of records) {
      record(change.target)
      change.addedNodes.forEach(record)
    }
  })
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style'],
  })
  return { seen, stop: () => observer.disconnect() }
}

const mount = (ui: React.ReactNode) => render(<UiProvider scheme="light">{ui}</UiProvider>)

/** the entrance ran, travelling rather than growing, and settled in place */
const expectTravelled = async (selector: string, seen: string[]) => {
  await expect
    .poll(() => document.querySelector<HTMLElement>(selector)?.style.transform)
    .toBe('none')
  expect(seen.some((transform) => transform.startsWith('translate('))).toBe(true)
  expect(seen.filter((transform) => transform.includes('scale'))).toEqual([])
}

describe('an anchored panel’s entrance', () => {
  it('a select’s list travels out of its trigger', async () => {
    await mount(
      <Select value="a">
        <SelectTrigger aria-label="order">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">latest first</SelectItem>
          <SelectItem value="b">earliest first</SelectItem>
        </SelectContent>
      </Select>,
    )
    const watch = watchTransforms('[data-slot="select-content"]')
    await page.getByRole('combobox', { name: 'order' }).click()
    await expectTravelled('[data-slot="select-content"]', watch.seen)
    watch.stop()
    await userEvent.keyboard('{Escape}')
  })

  it('a menu travels out of its trigger', async () => {
    await mount(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">more</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>adjust</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    // the first press mounts the menu already open, which the widget
    // treats as already entered; every opening after it enters
    const more = page.getByRole('button', { name: 'more' })
    await more.click()
    await expect.element(page.getByRole('menuitem', { name: 'adjust' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('menuitem', { name: 'adjust' })).not.toBeInTheDocument()
    const watch = watchTransforms('[data-slot="dropdown-menu-content"]')
    await more.click()
    await expectTravelled('[data-slot="dropdown-menu-content"]', watch.seen)
    watch.stop()
    await userEvent.keyboard('{Escape}')
  })

  it('a popover travels out of its trigger', async () => {
    await mount(
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">details</Button>
        </PopoverTrigger>
        <PopoverContent>what it holds</PopoverContent>
      </Popover>,
    )
    const watch = watchTransforms('[data-slot="popover-content"]')
    await page.getByRole('button', { name: 'details' }).click()
    await expectTravelled('[data-slot="popover-content"]', watch.seen)
    watch.stop()
    // below its trigger, it comes down out of it
    const panel = document.querySelector<HTMLElement>('[data-slot="popover-content"]')!
    expect(panel.getAttribute('data-position')).toMatch(/^bottom/)
    expect(getComputedStyle(panel).getPropertyValue('--q-drop-y').trim()).toBe('-4px')
    await userEvent.keyboard('{Escape}')
  })

  // placement may flip a panel above its trigger once it has been measured;
  // it then comes up out of the trigger rather than down past it
  it('travels from the side the panel landed on', async () => {
    await page.viewport(1280, 600)
    await mount(
      <div style={{ position: 'fixed', left: 40, bottom: 8 }}>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">low</Button>
          </PopoverTrigger>
          <PopoverContent>a panel with no room below it</PopoverContent>
        </Popover>
      </div>,
    )
    await page.getByRole('button', { name: 'low' }).click()
    const panel = () => document.querySelector<HTMLElement>('[data-slot="popover-content"]')
    await expect.poll(() => panel()?.getAttribute('data-position') ?? '').toMatch(/^top/)
    expect(getComputedStyle(panel()!).getPropertyValue('--q-drop-y').trim()).toBe('4px')
    await userEvent.keyboard('{Escape}')
  })
})
