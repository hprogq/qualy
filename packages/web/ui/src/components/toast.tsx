import type { CSSProperties } from 'react'
import { Toaster as Sonner, toast } from 'sonner'

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
  return (
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
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      toastOptions={{ duration: 4000 }}
    />
  )
}

export { toast }
