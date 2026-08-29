import { useEffect, useState, type CSSProperties } from 'react'
import { Toaster as Sonner, toast } from 'sonner'
import { Portal } from './portal.tsx'

// What just happened, said where the eye already is.
//
// A write that changes a list somewhere else on the page - a person added, a
// unit imported, a permission withheld - leaves nothing behind that says it
// worked; the reader is left comparing the list to their memory of it. This
// says it once, briefly, and gets out of the way.
//
// The words never come from here: every caller formats its own, because this
// package holds no copy.
//
// No close button: these say what already happened and leave on their own, so
// dismissing one saves nobody anything, and sonner puts it over the first
// characters of the line it is meant to help you read.

export function Toaster() {
  // Into a portal container of its own, not into the page.
  //
  // While a modal is up every body child WITHOUT `data-portal` is made inert
  // and aria-hidden, and the toaster rendered wherever it was mounted - inside
  // the application root, which is page. So a toast raised while a dialog
  // stayed open painted on screen inside a hidden subtree and was announced to
  // nobody. That is not a corner: several dialogs deliberately stay open on
  // failure and use `toast.error(formatError(...))` as their ONLY way of
  // saying the write did not happen.
  const [into, setInto] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const host = document.createElement('div')
    host.setAttribute('data-portal', '')
    host.setAttribute('data-slot', 'toaster')
    document.body.append(host)
    setInto(host)
    return () => host.remove()
  }, [])

  return (
    <Portal into={into}>
      <Sonner
        position="top-center"
        // the viewer's theme is on the document already, and sonner's own
        // theme prop would fight it
        theme="system"
        // sonner's own surface, told to use this application's: without it the
        // library paints its own greens and reds, which belong to no palette
        // here and read as a banner rather than a remark
        style={
          {
            '--normal-bg': 'var(--q-surface-elevated)',
            '--normal-text': 'var(--q-foreground)',
            '--normal-border': 'var(--q-border)',
          } as CSSProperties
        }
        toastOptions={{ duration: 4000 }}
      />
    </Portal>
  )
}

export { toast }
