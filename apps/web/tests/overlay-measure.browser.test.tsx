import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@qualy/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '@qualy/ui/alert-dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@qualy/ui/hover-card'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import '../src/app.css'

// How wide an overlay actually comes out.
//
// Every one of these is a panel the widget library sizes for us, and each
// library has its own idea of how: a modal is a flex item sized by its
// basis, a dropdown gets its width written into an inline style. Both beat a
// measure stated as a compiled style - a max-width cannot widen a flex
// basis, and nothing outranks an inline style - so a panel that asked for
// 56rem sat at the library's 440px, and a card that asked for 288 shrank to
// the width of its own text. Neither made an existing case red: every other
// assertion about an overlay is about what it says or what it closes on.
//
// So the measure is asserted here, in pixels, for each family.

const settle = () => new Promise((resolve) => setTimeout(resolve, 250))

function widthOf(slot: string) {
  const el = document.querySelector(`[data-slot="${slot}"]`)
  if (!el) throw new Error(`${slot} is not on the page`)
  return el.getBoundingClientRect().width
}

it('gives a dialog the measure it asked for', async () => {
  render(
    <UiProvider scheme="light">
      <Dialog open>
        <DialogContent size="56rem">
          <DialogHeader>
            <DialogTitle>a wide dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </UiProvider>,
  )
  await settle()
  expect(widthOf('dialog-content')).toBeCloseTo(896, 0)
})

it('gives a dialog that asks for nothing the product measure, not the library one', async () => {
  render(
    <UiProvider scheme="light">
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>a plain dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </UiProvider>,
  )
  await settle()
  expect(widthOf('dialog-content')).toBeCloseTo(512, 0)
})

it('holds an alert to its own measure', async () => {
  render(
    <UiProvider scheme="light">
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>are you sure</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>
    </UiProvider>,
  )
  await settle()
  expect(widthOf('alert-dialog-content')).toBeCloseTo(448, 0)
})

it('holds a sheet to a reading measure', async () => {
  render(
    <UiProvider scheme="light">
      <Sheet open>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>a drawer</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    </UiProvider>,
  )
  await settle()
  expect(widthOf('sheet-content')).toBeCloseTo(384, 0)
})

it('holds a hover card to its own measure rather than its text', async () => {
  render(
    <UiProvider scheme="light">
      <HoverCard openDelay={0}>
        <HoverCardTrigger asChild>
          <button type="button">who</button>
        </HoverCardTrigger>
        <HoverCardContent>
          <p>short</p>
        </HoverCardContent>
      </HoverCard>
    </UiProvider>,
  )
  await settle()
  const trigger = [...document.querySelectorAll('button')].find(
    (node) => node.textContent === 'who',
  )!
  trigger.dispatchEvent(new MouseEvent('mouseenter'))
  trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await settle()
  expect(widthOf('hover-card-content')).toBeCloseTo(288, 0)
})

it('holds a popover to its own measure rather than its text', async () => {
  render(
    <UiProvider scheme="light">
      <Popover defaultOpen>
        <PopoverTrigger>open</PopoverTrigger>
        <PopoverContent>
          <p>short</p>
        </PopoverContent>
      </Popover>
    </UiProvider>,
  )
  await settle()
  expect(widthOf('popover-content')).toBeCloseTo(288, 0)
})
