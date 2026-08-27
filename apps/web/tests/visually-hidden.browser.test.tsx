import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { cleanup, render } from 'vitest-browser-react'
import { Dialog, DialogContent, DialogTitle } from '@qualy/ui/dialog'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { UiProvider } from '@qualy/ui/provider'
import { VisuallyHidden, a11yStyles } from '@qualy/ui/visually-hidden'
import * as stylex from '@stylexjs/stylex'
import '../src/app.css'

// A label a screen reader reads must not move anything a reader sees.
//
// The usual recipe - absolutely positioned, resting at its static position -
// costs nothing in a document that scrolls itself, and costs a phantom
// scrollbar in a shell that holds the viewport and scrolls a region inside
// it: with no positioned ancestor the page becomes the label's containing
// block, so no region can clip it and the page grows to reach it. Measured
// without the pinned insets, these three layouts grew the document by 1248px,
// 848px and - sideways, which is the one that reads as broken - 2586px.
//
// Both ways of using the primitive are held to the same contract: the
// component that makes a span, and the style that hides an element which has
// to keep being itself.

const settle = () => new Promise((resolve) => setTimeout(resolve, 120))

const filler = (height: number) => <div style={{ height }}>filler</div>

/** what the page could scroll to, before anything hidden is on it */
const pageExtent = () => ({
  width: document.documentElement.scrollWidth,
  height: document.documentElement.scrollHeight,
})

const shell = (children: ReactNode) => (
  <UiProvider scheme="light">
    <div style={{ display: 'flex', height: '100dvh', flexDirection: 'column', overflow: 'hidden' }}>
      <main
        data-testid="scroller"
        style={{ minHeight: 0, flexGrow: 1, flexShrink: 1, flexBasis: '0%', overflowY: 'auto' }}
      >
        {children}
      </main>
    </div>
  </UiProvider>
)

/** the same label, made both ways the product makes one */
const forms = {
  component: <VisuallyHidden>what this button does</VisuallyHidden>,
  element: <h2 {...stylex.props(a11yStyles.visuallyHidden)}>what this section is</h2>,
}

const scenes: Record<string, (label: ReactNode) => ReactNode> = {
  'far down a long region': (label) => (
    <>
      {filler(2000)}
      <button type="button">icon{label}</button>
      {filler(600)}
    </>
  ),
  'inside a region within the region': (label) => (
    <>
      {filler(400)}
      <div style={{ height: 200, overflowY: 'auto' }}>
        {filler(1200)}
        <button type="button">icon{label}</button>
      </div>
      {filler(1200)}
    </>
  ),
  'at the far end of a sideways strip': (label) => (
    <>
      {filler(1500)}
      <div style={{ overflowX: 'auto', whiteSpace: 'nowrap' }}>
        <div style={{ width: 3000, display: 'inline-flex', justifyContent: 'flex-end' }}>
          <button type="button">icon{label}</button>
        </div>
      </div>
      {filler(900)}
    </>
  ),
}

describe('hidden content leaves the page where it found it', () => {
  for (const [form, label] of Object.entries(forms)) {
    for (const [scene, build] of Object.entries(scenes)) {
      it(`${scene}, as ${form}`, async () => {
        page.viewport(414, 800)
        render(shell(build(null)))
        await settle()
        const before = pageExtent()
        cleanup()
        await settle()
        render(shell(build(label)))
        await settle()
        expect(pageExtent()).toEqual(before)
        // the region it belongs to still scrolls, which is the point of it
        const scroller = document.querySelector('[data-testid="scroller"]')!
        expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
      })
    }
  }

  // sanity: a positioned panel is already a containing block, so nothing here
  // ever depended on the pin - these hold the case rather than prove it
  it('inside a dialog', async () => {
    page.viewport(414, 800)
    const before = pageExtent()
    render(
      <UiProvider scheme="light">
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>t</DialogTitle>
            {filler(2000)}
            <button type="button">
              icon
              <VisuallyHidden>what this button does</VisuallyHidden>
            </button>
          </DialogContent>
        </Dialog>
      </UiProvider>,
    )
    await settle()
    expect(pageExtent()).toEqual(before)
  })

  it('inside a sheet', async () => {
    page.viewport(414, 800)
    const before = pageExtent()
    render(
      <UiProvider scheme="light">
        <Sheet defaultOpen>
          <SheetContent>
            <SheetTitle {...stylex.props(a11yStyles.visuallyHidden)}>t</SheetTitle>
            {filler(2000)}
            <button type="button">
              icon
              <VisuallyHidden>what this button does</VisuallyHidden>
            </button>
          </SheetContent>
        </Sheet>
      </UiProvider>,
    )
    await settle()
    expect(pageExtent()).toEqual(before)
  })
})
