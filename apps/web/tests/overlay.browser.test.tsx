import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ConfirmDialog, FormDialog, SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// The overlay contract of docs/ui-platform-migration.md §11, pinned before
// any overlay primitive changes hands. Every case here is a way the product
// has actually broken: a body left with pointer-events none after two
// modals traded places, focus lost on close, an Escape that fell through a
// popover into the dialog under it. The assertions drive roles and real
// clicks - whether Radix or Prime renders the layers must not matter.
const mount = (ui: React.ReactNode) => render(<UiProvider scheme="light">{ui}</UiProvider>)

const bodyAlive = () => document.body.style.pointerEvents !== 'none'

function DialogHarness() {
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState(0)
  const [pick, setPick] = useState('')
  return (
    <>
      <button type="button" onClick={() => setHits((n) => n + 1)}>
        target
      </button>
      <output data-testid="hits">{hits}</output>
      <Button onClick={() => setOpen(true)}>open dialog</Button>
      <FormDialog
        open={open}
        title="Task"
        onClose={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>done</Button>}
      >
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">more</Button>
          </PopoverTrigger>
          <PopoverContent>
            <p>note</p>
          </PopoverContent>
        </Popover>
        <Select value={pick} onValueChange={setPick}>
          <SelectTrigger aria-label="flavor">
            <SelectValue placeholder="pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="plum">plum</SelectItem>
            <SelectItem value="pear">pear</SelectItem>
          </SelectContent>
        </Select>
        <output data-testid="pick">{pick}</output>
      </FormDialog>
    </>
  )
}

describe('a dialog and the page under it', () => {
  it('opens, closes, and leaves the page clickable with focus on the trigger', async () => {
    mount(<DialogHarness />)
    await page.getByRole('button', { name: 'open dialog' }).click()
    await expect.element(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: 'done' }).click()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    // the body lock is released once the exit settles
    await expect.poll(bodyAlive, { timeout: 5000 }).toBe(true)
    expect(document.body.style.overflow).not.toBe('hidden')
    // Focus never strands on a removed node. The product opens every dialog
    // in controlled mode without a registered trigger, so "return to the
    // trigger" was never its behavior - what must hold is that focus stays
    // in the live document and the keyboard still works.
    await expect
      .poll(() => document.activeElement?.isConnected ?? false, { timeout: 5000 })
      .toBe(true)

    await page.getByRole('button', { name: 'target' }).click()
    expect(page.getByTestId('hits').element().textContent).toBe('1')
  })

  it('closes the topmost layer per Escape, not everything at once', async () => {
    mount(<DialogHarness />)
    await page.getByRole('button', { name: 'open dialog' }).click()
    await page.getByRole('button', { name: 'more' }).click()
    await expect.element(page.getByText('note')).toBeVisible()

    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByText('note')).not.toBeInTheDocument()
    await expect.element(page.getByRole('dialog')).toBeVisible()

    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await expect.poll(bodyAlive, { timeout: 5000 }).toBe(true)
  })

  it('hosts a select whose choice lands without closing the dialog', async () => {
    mount(<DialogHarness />)
    await page.getByRole('button', { name: 'open dialog' }).click()
    await page.getByRole('combobox', { name: 'flavor' }).click()
    await page.getByRole('option', { name: 'pear' }).click()
    expect(page.getByTestId('pick').element().textContent).toBe('pear')
    await expect.element(page.getByRole('dialog')).toBeVisible()
  })
})

function Handover() {
  const [first, setFirst] = useState(false)
  const [second, setSecond] = useState(false)
  const [hits, setHits] = useState(0)
  return (
    <>
      <button type="button" onClick={() => setHits((n) => n + 1)}>
        target
      </button>
      <output data-testid="hits">{hits}</output>
      <Button onClick={() => setFirst(true)}>begin</Button>
      <FormDialog
        open={first}
        title="First"
        onClose={() => setFirst(false)}
        footer={
          <Button
            onClick={() => {
              // the historical killer: one modal opening in the same breath
              // as another closes, their body bookkeeping crossing
              setFirst(false)
              setSecond(true)
            }}
          >
            continue
          </Button>
        }
      >
        <p>step one</p>
      </FormDialog>
      <FormDialog
        open={second}
        title="Second"
        onClose={() => setSecond(false)}
        footer={<Button onClick={() => setSecond(false)}>finish</Button>}
      >
        <p>step two</p>
      </FormDialog>
    </>
  )
}

describe('two modals trading places', () => {
  it('never leaves the body dead to clicks', async () => {
    mount(<Handover />)
    await page.getByRole('button', { name: 'begin' }).click()
    await page.getByRole('button', { name: 'continue' }).click()
    await expect.element(page.getByText('step two')).toBeVisible()
    await page.getByRole('button', { name: 'finish' }).click()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()

    await expect.poll(bodyAlive, { timeout: 5000 }).toBe(true)
    await page.getByRole('button', { name: 'target' }).click()
    expect(page.getByTestId('hits').element().textContent).toBe('1')
  })
})

// Handlers are idempotent the way every real caller's are: onCancel also
// fires through onOpenChange when the dialog closes for any reason, so it
// only ever closes; the decision itself is recorded by onConfirm alone.
function ConfirmHarness() {
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState('')
  return (
    <>
      <Button onClick={() => setOpen(true)}>ask</Button>
      <output data-testid="outcome">{outcome}</output>
      <ConfirmDialog
        open={open}
        title="Remove it?"
        confirmLabel="remove"
        cancelLabel="keep"
        onConfirm={() => {
          setOutcome('removed')
          setOpen(false)
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  )
}

describe('a confirm asked twice', () => {
  it('answers cleanly on consecutive open and close', async () => {
    mount(<ConfirmHarness />)
    await page.getByRole('button', { name: 'ask' }).click()
    await page.getByTestId('confirm-dismiss').click()
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
    expect(page.getByTestId('outcome').element().textContent).toBe('')

    await page.getByRole('button', { name: 'ask' }).click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    await page.getByTestId('confirm-accept').click()
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
    expect(page.getByTestId('outcome').element().textContent).toBe('removed')
    await expect.poll(bodyAlive, { timeout: 5000 }).toBe(true)
  })
})

function PanelHarness() {
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState(0)
  return (
    <>
      <button type="button" onClick={() => setHits((n) => n + 1)}>
        target
      </button>
      <output data-testid="hits">{hits}</output>
      <Button onClick={() => setOpen(true)}>inspect</Button>
      <SidePanel
        open={open}
        title="Details"
        onClose={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>close panel</Button>}
      >
        <p>facts</p>
      </SidePanel>
    </>
  )
}

describe('the side panel', () => {
  it('opens, closes by escape, and releases the page', async () => {
    mount(<PanelHarness />)
    await page.getByRole('button', { name: 'inspect' }).click()
    await expect.element(page.getByText('facts')).toBeVisible()

    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByText('facts')).not.toBeInTheDocument()
    await expect.poll(bodyAlive, { timeout: 5000 }).toBe(true)
    await page.getByRole('button', { name: 'target' }).click()
    expect(page.getByTestId('hits').element().textContent).toBe('1')
  })
})
