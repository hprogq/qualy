import { afterEach, describe, expect, it } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ResizableSplit } from '@qualy/ui/screen'
import { setLayoutPreference, useLayoutPreference } from '@qualy/ui/layout-preferences'
import { bootTestLayoutPreferences, runTestLayoutBootstrap } from '@qualy/testkit/browser'
import '../src/app.css'

const KEY = 'assessment-roster-tree-width'
const FOLD = 'assessment-roster-tree-folded'

function Example() {
  const collapsed = useLayoutPreference(FOLD)
  return (
    <div style={{ width: 1000 }}>
      <button type="button" onClick={() => setLayoutPreference(FOLD, !collapsed)}>
        Toggle tree
      </button>
      <ResizableSplit
        preference={KEY}
        handleLabel="Resize tree"
        side={<button type="button">Choose organization</button>}
      >
        <div data-testid="list-state" style={{ height: 150, overflow: 'auto' }}>
          <input aria-label="Filter people" defaultValue="" />
          <div style={{ height: 800 }} />
        </div>
      </ResizableSplit>
    </div>
  )
}

afterEach(async () => {
  bootTestLayoutPreferences()
  await commands.emulateMedia({ reducedMotion: 'reduce' })
})

describe('a resizable tree that folds beside its list', () => {
  it('imports old layout cookies once and removes them', async () => {
    await page.viewport(1440, 900)
    localStorage.removeItem('qualy.ui')
    document.cookie = 'qualy-layout-assessment-roster-tree-width=280; Path=/'
    runTestLayoutBootstrap()
    expect(document.cookie).not.toContain('qualy-layout-assessment-roster-tree-width')
    expect(JSON.parse(localStorage.getItem('qualy.ui') ?? '{}').values[KEY]).toBe(280)
    await render(<Example />)
    await expect.element(page.getByTestId('split-handle')).toHaveAttribute('aria-valuenow', '280')
  })

  it('defaults broken storage and clamps valid integer widths', async () => {
    await page.viewport(1440, 900)
    localStorage.setItem('qualy.ui', '{broken')
    runTestLayoutBootstrap()
    const invalid = await render(<Example />)
    await expect.element(page.getByTestId('split-handle')).toHaveAttribute('aria-valuenow', '312')
    await invalid.unmount()
    bootTestLayoutPreferences({ [KEY]: 100 })
    await render(<Example />)
    await expect.element(page.getByTestId('split-handle')).toHaveAttribute('aria-valuenow', '220')
    expect(page.getByTestId('split-side').element().getBoundingClientRect().width).toBe(220)
  })
  it('animates column width and opacity in both directions without replacing list state', async () => {
    await page.viewport(1440, 900)
    await commands.emulateMedia({ reducedMotion: 'no-preference' })
    await render(<Example />)
    const side = page.getByTestId('split-side').element() as HTMLElement
    const split = side.parentElement!
    const list = page.getByTestId('list-state').element()
    const field = page.getByRole('textbox', { name: 'Filter people' })
    await field.fill('kept filter')
    list.scrollTop = 80
    expect(side.getBoundingClientRect().width).toBe(312)
    const expandedLeft = list.getBoundingClientRect().left
    for (const closing of [true, false]) {
      await page.getByRole('button', { name: 'Toggle tree' }).click()
      const widthMotion = split
        .getAnimations()
        .find((animation) =>
          (animation.effect as KeyframeEffect)
            .getKeyframes()
            .some((frame) => 'gridTemplateColumns' in frame),
        )
      expect(widthMotion).toBeDefined()
      const motions = [...split.getAnimations(), ...side.getAnimations()]
      for (const motion of motions) {
        motion.pause()
        motion.currentTime = 110
      }
      const halfway = side.getBoundingClientRect().width
      expect(halfway).toBeGreaterThan(20)
      expect(halfway).toBeLessThan(292)
      expect(Number(getComputedStyle(side).opacity)).toBeGreaterThan(0)
      expect(Number(getComputedStyle(side).opacity)).toBeLessThan(1)
      expect(list.getBoundingClientRect().left).toBeGreaterThan(split.getBoundingClientRect().left)
      expect(list.getBoundingClientRect().left).toBeLessThan(expandedLeft)
      expect(side.inert).toBe(closing)
      for (const motion of motions) motion.finish()
      await expect.poll(() => side.getBoundingClientRect().width).toBe(closing ? 0 : 312)
      expect(page.getByTestId('list-state').element()).toBe(list)
      expect(list.scrollTop).toBe(80)
      await expect.element(field).toHaveValue('kept filter')
      if (closing) {
        await expect.element(page.getByTestId('split-side')).not.toBeVisible()
        expect(list.getBoundingClientRect().left).toBe(split.getBoundingClientRect().left)
      }
    }
  })

  it('honors saved width and keeps hidden controls out of keyboard navigation with reduced motion', async () => {
    await page.viewport(1440, 900)
    bootTestLayoutPreferences({ [KEY]: 280 })
    await render(<Example />)
    const side = page.getByTestId('split-side').element() as HTMLElement
    expect(side.getBoundingClientRect().width).toBe(280)
    await page.getByRole('separator', { name: 'Resize tree' }).click()
    await userEvent.keyboard('{ArrowLeft}')
    expect(JSON.parse(localStorage.getItem('qualy.ui') ?? '{}').values[KEY]).toBe(264)
    await page.getByRole('button', { name: 'Toggle tree' }).click()
    expect(side.getBoundingClientRect().width).toBe(0)
    expect(side.parentElement!.getAnimations()).toHaveLength(0)
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(
      page.getByRole('textbox', { name: 'Filter people' }).element(),
    )
    await page.getByRole('button', { name: 'Toggle tree' }).click()
    expect(side.getBoundingClientRect().width).toBe(264)
  })
})
