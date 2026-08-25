import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { ConfirmDialog, SidePanel } from '@qualy/ui/admin'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// The interactive-widget contracts of the overlay family, asserted through
// roles, focus and native form facts. Everything here is a way an overlay
// substrate can genuinely differ; none of it says which substrate renders.
const mount = (ui: React.ReactNode) => render(<UiProvider scheme="light">{ui}</UiProvider>)

describe('the menu', () => {
  function MenuHarness() {
    const [said, setSaid] = useState('')
    return (
      <>
        <output data-testid="said">{said}</output>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setSaid('renamed')}>rename</DropdownMenuItem>
            <DropdownMenuItem disabled>frozen</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setSaid('removed')}>
              remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )
  }

  it('opens, walks with arrows, answers Enter, and returns focus', async () => {
    mount(<MenuHarness />)
    const trigger = page.getByRole('button', { name: 'actions' })
    await trigger.click()
    await expect.element(page.getByRole('menu')).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: 'frozen' })).toBeDisabled()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('said')).toHaveTextContent('renamed')
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
    // the keyboard journey ends where it began
    await expect.poll(() => document.activeElement?.textContent).toContain('actions')
  })

  it('Escape closes the menu and nothing else', async () => {
    mount(<MenuHarness />)
    await page.getByRole('button', { name: 'actions' }).click()
    await expect.element(page.getByRole('menu')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  })
})

describe('the tooltip', () => {
  it('shows on keyboard focus, not only on hover', async () => {
    mount(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline">why not</Button>
          </TooltipTrigger>
          <TooltipContent>submissions are closed</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )
    const trigger = page.getByRole('button', { name: 'why not' })
    await expect.element(trigger).toBeVisible()
    ;(trigger.element() as HTMLElement).focus()
    await expect.element(page.getByText('submissions are closed')).toBeVisible()
    // the trigger is described by the tip, which is how a reader hears it
    const describedby = trigger.element().getAttribute('aria-describedby')
    expect(describedby).not.toBeNull()
    ;(trigger.element() as HTMLElement).blur()
    await expect.element(page.getByText('submissions are closed')).not.toBeInTheDocument()
  })
})

describe('the select as a form citizen', () => {
  it('opening and choosing never submits the form around it', async () => {
    function FormHarness() {
      const [submits, setSubmits] = useState(0)
      const [pick, setPick] = useState('')
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setSubmits((n) => n + 1)
          }}
        >
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger aria-label="kind">
              <SelectValue placeholder="pick" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">alpha</SelectItem>
              <SelectItem value="b" description="the second one">
                beta
              </SelectItem>
            </SelectContent>
          </Select>
          <output data-testid="submits">{submits}</output>
          <output data-testid="pick">{pick}</output>
        </form>
      )
    }
    mount(<FormHarness />)
    await page.getByRole('combobox', { name: 'kind' }).click()
    // the description explains in the list only
    await expect.element(page.getByText('the second one')).toBeVisible()
    await page.getByRole('option', { name: /beta/ }).click()
    await expect.element(page.getByTestId('pick')).toHaveTextContent('b')
    await expect.element(page.getByTestId('submits')).toHaveTextContent('0')
    // the closed trigger echoes the chosen label
    await expect.element(page.getByRole('combobox', { name: 'kind' })).toHaveTextContent('beta')
  })

  it('walks options with arrows and answers Enter and Escape', async () => {
    function KeysHarness() {
      const [pick, setPick] = useState('')
      return (
        <>
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger aria-label="kind">
              <SelectValue placeholder="pick" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">alpha</SelectItem>
              <SelectItem value="b">beta</SelectItem>
            </SelectContent>
          </Select>
          <output data-testid="pick">{pick}</output>
        </>
      )
    }
    mount(<KeysHarness />)
    const trigger = page.getByRole('combobox', { name: 'kind' })
    await expect.element(trigger).toBeVisible()
    ;(trigger.element() as HTMLElement).focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('listbox')).toBeVisible()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('pick')).toHaveTextContent('a')
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('listbox')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('a dialog hosting a select answers Escape one layer at a time', () => {
  it('first the list, then the dialog', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      const [pick, setPick] = useState('')
      return (
        <>
          <Button onClick={() => setOpen(true)}>begin</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Choose</DialogTitle>
              </DialogHeader>
              <Select value={pick} onValueChange={setPick}>
                <SelectTrigger aria-label="flavor">
                  <SelectValue placeholder="pick" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plum">plum</SelectItem>
                </SelectContent>
              </Select>
            </DialogContent>
          </Dialog>
        </>
      )
    }
    mount(<Harness />)
    await page.getByRole('button', { name: 'begin' }).click()
    await page.getByRole('combobox', { name: 'flavor' }).click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('dialog accessibility wiring', () => {
  it('the dialog is named by its title and described by its description', async () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Move the file</DialogTitle>
              <DialogDescription>It leaves this folder for good.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )
    }
    mount(<Harness />)
    const dialog = page.getByRole('dialog', { name: 'Move the file' })
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog).toHaveAccessibleDescription('It leaves this folder for good.')
    const el = dialog.element()
    expect(el.getAttribute('aria-modal')).toBe('true')
  })

  it('the confirm is an alertdialog resting on the safe answer', async () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <ConfirmDialog
          open={open}
          title="Remove it?"
          description="This cannot be undone."
          confirmLabel="remove"
          cancelLabel="keep"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      )
    }
    mount(<Harness />)
    const alert = page.getByRole('alertdialog', { name: 'Remove it?' })
    await expect.element(alert).toBeVisible()
    await expect.element(alert).toHaveAccessibleDescription('This cannot be undone.')
    // the safe answer is where a stray Enter lands
    await expect.poll(() => document.activeElement?.textContent).toBe('keep')
  })
})

describe('the sheet', () => {
  it.each(['left', 'right', 'bottom'] as const)('docks to the %s edge', async (side) => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>Panel</SheetTitle>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      )
    }
    mount(<Harness />)
    const panel = page.getByRole('dialog', { name: 'Panel' })
    await expect.element(panel).toBeVisible()
    await expect
      .poll(() => {
        const rect = panel.element().getBoundingClientRect()
        if (side === 'left') return Math.round(rect.left) === 0 && rect.height >= innerHeight - 1
        if (side === 'right')
          return Math.round(rect.right) >= innerWidth - 1 && rect.height >= innerHeight - 1
        return Math.round(rect.bottom) >= innerHeight - 1 && rect.width >= innerWidth - 1
      })
      .toBe(true)
  })

  it('locks the page scroll while open and releases it after', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Button onClick={() => setOpen(true)}>inspect</Button>
          <SidePanel open={open} title="Details" onClose={() => setOpen(false)}>
            <p>facts</p>
          </SidePanel>
        </>
      )
    }
    mount(<Harness />)
    await page.getByRole('button', { name: 'inspect' }).click()
    await expect.element(page.getByText('facts')).toBeVisible()
    await expect.poll(() => document.body.hasAttribute('data-scroll-locked')).toBe(true)
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByText('facts')).not.toBeInTheDocument()
    await expect.poll(() => document.body.hasAttribute('data-scroll-locked')).toBe(false)
    // focus comes home to the opener
    await expect.poll(() => document.activeElement?.textContent).toContain('inspect')
  })
})
