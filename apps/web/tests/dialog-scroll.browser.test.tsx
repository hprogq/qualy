import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ConfirmDialog, FormDialog, SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// A dialog that holds more than the window scrolls its middle and nothing
// else. The widget caps the panel at the window and scrolls the whole of it,
// which took the title, the corner button and the buttons at the foot up the
// screen with the list being read - on every dialog whose body outgrew the
// room, at every width. These pin the head and the foot in view while the
// body is scrolled to its end, for each family of overlay and on a phone.

const settle = () => new Promise((resolve) => setTimeout(resolve, 250))

const mount = (ui: React.ReactNode) => render(<UiProvider scheme="light">{ui}</UiProvider>)

/** more than any window holds */
const Long = () => (
  <>
    {Array.from({ length: 60 }, (_, n) => (
      <p key={n}>line {n + 1}</p>
    ))}
  </>
)

const one = (selector: string): HTMLElement => {
  const found = document.querySelectorAll<HTMLElement>(selector)
  if (found.length !== 1) throw new Error(`${selector}: ${found.length} on the page`)
  return found[0]!
}

/** wholly on screen, top to bottom */
const inView = (element: HTMLElement) => {
  const box = element.getBoundingClientRect()
  return box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight + 0.5
}

/**
 * Scrolls the one part that should scroll to its end, and says whether the
 * panel around it moved: a panel that scrolls is what put the head and the
 * foot out of reach.
 */
const scrollBodyToEnd = (panel: HTMLElement, body: HTMLElement) => {
  expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
  body.scrollTop = body.scrollHeight
  expect(body.scrollTop).toBeGreaterThan(0)
  // the panel has nothing of its own to scroll
  expect(panel.scrollHeight).toBeLessThanOrEqual(panel.clientHeight + 1)
  expect(panel.scrollTop).toBe(0)
}

afterEach(async () => {
  await page.viewport(1280, 800)
})

describe('a dialog that outgrows the window', () => {
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ] as const) {
    it(`scrolls only its body at ${width} wide`, async () => {
      await page.viewport(width, height)
      await mount(
        <Dialog open>
          <DialogContent size="48rem">
            <DialogHeader>
              <DialogTitle>a long list</DialogTitle>
              <DialogDescription>read it through</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Long />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline">cancel</Button>
              <Button>confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>,
      )
      await settle()
      scrollBodyToEnd(one('[data-slot="dialog-content"]'), one('[data-slot="dialog-body"]'))
      expect(inView(one('[data-slot="dialog-title"]'))).toBe(true)
      expect(inView(one('[data-slot="dialog-footer"]'))).toBe(true)
      expect(inView(one('[data-slot="dialog-content"] > [data-slot="dialog-close"]'))).toBe(true)
    })

    it(`keeps a form's head and keys in view at ${width} wide`, async () => {
      await page.viewport(width, height)
      await mount(
        <FormDialog
          open
          title="a long form"
          onClose={() => {}}
          footer={<Button data-testid="form-save">save</Button>}
        >
          <Long />
        </FormDialog>,
      )
      await settle()
      scrollBodyToEnd(one('[data-slot="dialog-content"]'), one('[data-slot="dialog-body"]'))
      expect(
        inView(page.getByRole('heading', { name: 'a long form' }).element() as HTMLElement),
      ).toBe(true)
      expect(inView(one('[data-testid="form-save"]'))).toBe(true)
    })

    it(`keeps a side panel's head and keys in view at ${width} wide`, async () => {
      await page.viewport(width, height)
      await mount(
        <SidePanel
          open
          title="a long panel"
          onClose={() => {}}
          footer={<Button data-testid="panel-save">save</Button>}
        >
          <Long />
        </SidePanel>,
      )
      await settle()
      scrollBodyToEnd(one('[data-slot="sheet-content"]'), one('[data-slot="dialog-body"]'))
      expect(inView(one('[data-slot="sheet-title"]'))).toBe(true)
      expect(inView(one('[data-testid="panel-save"]'))).toBe(true)
    })
  }

  // An alert holds a sentence, and a sentence long enough to outgrow a phone
  // is still to be answered: its two keys stay where the thumb is.
  it('keeps an alert’s answers in view however long the question is', async () => {
    await page.viewport(390, 640)
    await mount(
      <ConfirmDialog
        open
        title="remove all of them"
        description={Array.from({ length: 80 }, (_, n) => `consequence ${n + 1}.`).join(' ')}
        confirmLabel="remove"
        cancelLabel="keep"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    await settle()
    const panel = one('[data-slot="alert-dialog-content"]')
    expect(panel.scrollHeight).toBeLessThanOrEqual(panel.clientHeight + 1)
    expect(inView(one('[data-testid="confirm-accept"]'))).toBe(true)
    expect(inView(one('[data-testid="confirm-dismiss"]'))).toBe(true)
  })
})
