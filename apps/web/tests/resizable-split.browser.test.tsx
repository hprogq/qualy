import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ResizableSplit } from '@qualy/ui/screen'
import '../src/app.css'

const KEY = 'test:collapsible-split'

function Example() {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div style={{ width: 1000 }}>
      <button type="button" onClick={() => setCollapsed((value) => !value)}>
        Toggle tree
      </button>
      <ResizableSplit
        storageKey={KEY}
        initial={312}
        min={220}
        max={312}
        handleLabel="Resize tree"
        collapsed={collapsed}
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
  localStorage.removeItem(KEY)
  await commands.emulateMedia({ reducedMotion: 'reduce' })
})

describe('a resizable tree that folds beside its list', () => {
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
    localStorage.setItem(KEY, '280')
    await render(<Example />)
    const side = page.getByTestId('split-side').element() as HTMLElement
    expect(side.getBoundingClientRect().width).toBe(280)
    await page.getByRole('separator', { name: 'Resize tree' }).click()
    await userEvent.keyboard('{ArrowLeft}')
    expect(localStorage.getItem(KEY)).toBe('264')
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
