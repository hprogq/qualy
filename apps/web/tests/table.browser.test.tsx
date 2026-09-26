import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import '../src/app.css'

// A table that scrolls inside its box holds its head at the top, and the
// head keeps the rule under it while the rows slide beneath: the cells are
// what hold still, so the cells are what draw it.

const mount = () =>
  render(
    <UiProvider scheme="light">
      <div style={{ display: 'flex', height: 240, flexDirection: 'column' }}>
        <Table fill>
          <TableHeader sticky>
            <TableRow>
              <TableHead>name</TableHead>
              <TableHead>number</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 40 }, (_, n) => (
              <TableRow key={n}>
                <TableCell>person {n}</TableCell>
                <TableCell>{n}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </UiProvider>,
  )

describe('a table with a head held in place', () => {
  it('keeps the head and the rule under it at the top while the rows scroll', async () => {
    await mount()
    const scroller = document.querySelector<HTMLElement>('[data-slot="table-container"]')!
    const cells = [...document.querySelectorAll<HTMLElement>('[data-slot="table-head"]')]
    expect(cells).toHaveLength(2)
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    scroller.scrollTop = scroller.scrollHeight
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)

    for (const cell of cells) {
      expect(cell.getBoundingClientRect().top).toBeCloseTo(scroller.getBoundingClientRect().top, 0)
      // the rule is on a box the browser paints a shadow for
      expect(getComputedStyle(cell).boxShadow).toContain('inset')
    }
  })
})
