import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { UnitPath } from '@qualy/ui/unit-path'
import '../src/app.css'

// A unit is named from its own end: when the line runs out it is the
// parents that fold away, never the unit itself, and the whole chain is one
// press away where a screen asks for it.

const STEPS = ['示例大学', '计算机与软件学院', '2023级', '计算机科学与技术', '软件工程2023级2班']

const mount = (ui: React.ReactNode, width: number) =>
  render(
    <UiProvider scheme="light">
      <div style={{ width }}>{ui}</div>
    </UiProvider>,
  )

/** whether a step is on the line that shows, rather than on one clipped away */
const shown = (index: number) => {
  const line = document.querySelector('[data-testid="unit-path"]')!.getBoundingClientRect()
  const step = document.querySelector(`[data-path-step="${index}"]`)!.getBoundingClientRect()
  return step.top < line.bottom - 1 && step.bottom > line.top + 1
}

describe('a unit path', () => {
  it('keeps the unit and as many parents as fit, folding the front', async () => {
    await mount(<UnitPath steps={STEPS} />, 300)
    const path = page.getByTestId('unit-path')
    await expect.element(path).toHaveAttribute('data-clipped', 'true')
    expect(shown(4)).toBe(true)
    expect(shown(3)).toBe(true)
    expect(shown(0)).toBe(false)
    // the whole of it stays a hint away
    await expect.element(path).toHaveAttribute('title', STEPS.join(' / '))
  })

  it('says all of it where there is room', async () => {
    await mount(<UnitPath steps={STEPS} />, 900)
    await expect.element(page.getByTestId('unit-path')).toHaveAttribute('data-clipped', 'false')
    for (const index of STEPS.keys()) expect(shown(index)).toBe(true)
  })

  it('offers each step as a way in, by its place on the path', async () => {
    const picked = vi.fn()
    await mount(<UnitPath steps={STEPS} onPick={picked} pickLabel="查看" />, 900)
    await page.getByRole('button', { name: '查看 2023级' }).click()
    expect(picked).toHaveBeenCalledWith(2)
  })

  it('opens the whole chain beside a pointer, one level to a line, the unit marked', async () => {
    await page.viewport(1280, 800)
    await mount(<UnitPath steps={STEPS} chain={{ label: '所在单位', closeLabel: '关闭' }} />, 160)
    const open = page.getByRole('button', { name: `所在单位 ${STEPS.join(' / ')}` })
    await expect.element(open).toHaveAttribute('aria-expanded', 'false')
    await open.click()
    const chain = page.getByTestId('unit-chain')
    await expect.element(chain).toBeVisible()
    const levels = [...document.querySelectorAll('[data-testid="unit-chain"] li')]
    expect(levels.map((level) => level.textContent)).toEqual(STEPS)
    expect(levels.map((level) => level.getAttribute('aria-current'))).toEqual([
      null,
      null,
      null,
      null,
      'true',
    ])
    await userEvent.keyboard('{Escape}')
    await expect.element(chain).not.toBeInTheDocument()
  })

  it('keeps the chain’s mark against the words, whether or not the line wrapped', async () => {
    await page.viewport(1280, 800)
    // how far the mark stands from the end of the unit's own name
    const apart = () => {
      const unit = document.querySelector(`[data-path-step="${STEPS.length - 1}"]`)!
      const mark = document.querySelector('[data-testid="unit-path-trail"]')!
      return mark.getBoundingClientRect().left - unit.getBoundingClientRect().right
    }
    const chain = { label: '所在单位', closeLabel: '关闭' }
    // a cell far wider than the path, and one that folds its front away
    for (const width of [900, 260]) {
      const { unmount } = await mount(<UnitPath steps={STEPS} chain={chain} />, width)
      await expect
        .element(page.getByTestId('unit-path'))
        .toHaveAttribute('data-clipped', String(width < 900))
      await expect.poll(apart).toBeLessThanOrEqual(8)
      expect(apart()).toBeGreaterThanOrEqual(0)
      await unmount()
    }
  })

  it('lists the chain it is given where it holds more than the line', async () => {
    await page.viewport(1280, 800)
    await mount(
      <UnitPath
        steps={STEPS.slice(1)}
        chain={{ label: '所在单位', closeLabel: '关闭', levels: STEPS }}
      />,
      900,
    )
    // the line leaves off the root everybody shares; the chain does not
    expect(document.querySelectorAll('[data-path-step]')).toHaveLength(STEPS.length - 1)
    await page.getByRole('button', { name: `所在单位 ${STEPS.join(' / ')}` }).click()
    await expect.element(page.getByTestId('unit-chain')).toBeVisible()
    expect(
      [...document.querySelectorAll('[data-testid="unit-chain"] li')].map((one) => one.textContent),
    ).toEqual(STEPS)
    await userEvent.keyboard('{Escape}')
  })

  it('raises the chain from the foot on a phone, with a way out', async () => {
    await page.viewport(390, 800)
    try {
      await mount(<UnitPath steps={STEPS} chain={{ label: '所在单位', closeLabel: '关闭' }} />, 200)
      await page.getByRole('button', { name: `所在单位 ${STEPS.join(' / ')}` }).click()
      const sheet = page.getByTestId('unit-chain')
      await expect.element(sheet).toHaveAttribute('data-side', 'bottom')
      await expect
        .element(sheet.getByRole('listitem').last())
        .toHaveAttribute('aria-current', 'true')
      await sheet.getByRole('button', { name: '关闭' }).click()
      await expect.element(sheet).not.toBeInTheDocument()
    } finally {
      await page.viewport(1280, 800)
    }
  })
})
