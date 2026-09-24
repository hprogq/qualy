import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Cell, Table, TableHead, TableRow } from '@qualy/ui/screen'
import { Steps } from '@qualy/ui/steps'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// Two shapes a phone rearranges: a table row stacked under its name, and a
// strip of steps across a sheet.

const mount = (ui: React.ReactNode) => render(<UiProvider scheme="light">{ui}</UiProvider>)
const box = (element: Element) => element.getBoundingClientRect()
const middle = (element: Element) => box(element).top + box(element).height / 2
const found = async (locator: ReturnType<typeof page.getByTestId>) => {
  await expect.element(locator).toBeInTheDocument()
  return locator.element()
}

afterEach(async () => {
  await page.viewport(1280, 800)
})

const table = (
  <Table columns="minmax(0, 1.4fr) minmax(0, 1fr) 6rem 8.5rem" openable>
    <TableHead>
      <span>name</span>
      <span>unit</span>
      <span>state</span>
      <span>since</span>
    </TableHead>
    <TableRow data-testid="row" onOpen={() => {}}>
      <Cell lead>Round one</Cell>
      <Cell>
        <span data-testid="unit">Unit</span>
      </Cell>
      <Cell narrow="end" unlabelled>
        <span data-testid="state">in</span>
      </Cell>
      <Cell numeric>
        <span data-testid="since">Sep 1</span>
      </Cell>
    </TableRow>
  </Table>
)

describe('a row with a column after the one it is scanned by', () => {
  it('stacked, keeps that column on the line under the name and its state mid-row', async () => {
    await page.viewport(360, 740)
    await mount(table)
    const row = await found(page.getByTestId('row'))
    const unit = await found(page.getByTestId('unit'))
    const since = await found(page.getByTestId('since'))
    const state = await found(page.getByTestId('state'))
    expect(Math.abs(box(since).top - box(unit).top)).toBeLessThan(2)
    expect(Math.abs(middle(state) - middle(row))).toBeLessThan(2)
  })

  it('across, keeps the columns in their order', async () => {
    await mount(table)
    const unit = box(await found(page.getByTestId('unit')))
    const state = box(await found(page.getByTestId('state')))
    const since = box(await found(page.getByTestId('since')))
    expect(unit.left).toBeLessThan(state.left)
    expect(state.left).toBeLessThan(since.left)
  })
})

describe('a row with its own menu after the one it is scanned by', () => {
  it('across, keeps the scanned cell before the menu', async () => {
    await mount(
      <Table columns="minmax(0, 1fr) 6rem 2rem">
        <TableHead>
          <span>name</span>
          <span>state</span>
          <span />
        </TableHead>
        <TableRow data-testid="row">
          <Cell lead>Somebody</Cell>
          <Cell narrow="end" unlabelled>
            <span data-testid="state">in</span>
          </Cell>
          <span data-testid="menu">…</span>
        </TableRow>
      </Table>,
    )
    const state = box(await found(page.getByTestId('state')))
    const menu = box(await found(page.getByTestId('menu')))
    expect(state.left).toBeLessThan(menu.left)
  })
})

describe('a strip of steps', () => {
  it('reaches the last dot to the end of the strip, leaving no room after it', async () => {
    await page.viewport(360, 740)
    await mount(
      <div data-testid="strip" style={{ width: 320 }}>
        <Steps steps={['Basics', 'Phases']} current={0} />
      </div>,
    )
    const strip = box(await found(page.getByTestId('strip')))
    const last = box(await found(page.getByText('2')))
    expect(strip.right - last.right).toBeLessThan(2)
  })
})
