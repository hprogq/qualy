'use client'

import * as React from 'react'
import { Drawer as MDrawer } from '@mantine/core'

import clsx from 'clsx'
import * as stylex from '@stylexjs/stylex'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'
import { retainInertBackground } from '../lib/inert-background.ts'
import { Button } from './button.tsx'
import { XIcon } from 'lucide-react'

// A panel sliding in from an edge, over the widget library's drawer. The
// library owns portal, focus trap, scroll lock, Escape and the slide
// transition per position; the adapter owns the product prop shape and the
// photo-viewer coexistence rule below.

interface SheetState {
  open: boolean
  setOpen: (next: boolean) => void
}
// Entrances are CSS insertion animations and exits are transitions the
// adapter drives with `data-closing`; the keyframes themselves stay in the
// stylesheet, where they are a global name shared with the dialogs.
const REDUCE = '@media (prefers-reduced-motion: reduce)'

const SLIDE_IN = {
  right: 'q-slide-in-right',
  left: 'q-slide-in-left',
  top: 'q-slide-in-top',
  bottom: 'q-slide-in-bottom',
} as const

const styles = stylex.create({
  // the same veil the dialogs draw, fading on its own compositing layer: a
  // backdrop-filter under an animating opacity made mobile Safari
  // re-rasterize the page behind it on every frame
  overlay: {
    animationName: { default: 'q-overlay-in', [REDUCE]: 'none' },
    animationDuration: { default: '150ms', [REDUCE]: '0s' },
    animationTimingFunction: 'ease',
    // a reader who asked for less motion is answered on the way in and on
    // the way out alike, whether or not this panel is currently leaving
    transitionProperty: { default: null, [REDUCE]: 'none' },
    isolation: 'isolate',
    willChange: 'opacity',
  },
  // both layers leave the way they came, and neither answers the pointer on
  // the way out
  overlayClosing: {
    opacity: 0,
    transitionProperty: { default: 'opacity', [REDUCE]: 'none' },
    transitionDuration: { default: '200ms', [REDUCE]: '0s' },
    transitionTimingFunction: 'ease',
    pointerEvents: 'none',
  },
  panelClosing: {
    transitionProperty: { default: 'transform', [REDUCE]: 'none' },
    transitionDuration: { default: '200ms', [REDUCE]: '0s' },
    transitionTimingFunction: 'ease',
    pointerEvents: 'none',
  },
  entranceRight: {
    animationName: { default: SLIDE_IN.right, [REDUCE]: 'none' },
    animationDuration: { default: '200ms', [REDUCE]: '0s' },
    animationTimingFunction: 'ease',
  },
  entranceLeft: {
    animationName: { default: SLIDE_IN.left, [REDUCE]: 'none' },
    animationDuration: { default: '200ms', [REDUCE]: '0s' },
    animationTimingFunction: 'ease',
  },
  entranceTop: {
    animationName: { default: SLIDE_IN.top, [REDUCE]: 'none' },
    animationDuration: { default: '200ms', [REDUCE]: '0s' },
    animationTimingFunction: 'ease',
  },
  entranceBottom: {
    animationName: { default: SLIDE_IN.bottom, [REDUCE]: 'none' },
    animationDuration: { default: '200ms', [REDUCE]: '0s' },
    animationTimingFunction: 'ease',
  },
  outRight: { transform: 'translateX(100%)' },
  outLeft: { transform: 'translateX(-100%)' },
  outTop: { transform: 'translateY(-100%)' },
  outBottom: { transform: 'translateY(100%)' },
  // a grab region answers the drag, not the scroll: without this the browser
  // claims a downward pull for scrolling before the dismiss gesture sees it
  grab: { touchAction: 'none' },
  // structure only; the surface is the widget's own under the theme. The
  // panel itself does not scroll - its children own scrolling, which is what
  // keeps a footer standing while the middle moves.
  content: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    transitionProperty: { default: null, [REDUCE]: 'none' },
    overflowY: 'visible',
    // size and leading travel together, as the utility this replaces did
    fontSize: 14,
    lineHeight: '1.25rem',
  },
  // a panel that comes in from a side takes the full height and most of the
  // width, up to a comfortable reading measure
  contentBeside: {
    height: '100%',
    width: '75%',
    maxWidth: { default: null, '@media (min-width: 640px)': '24rem' },
  },
  // one that comes from above or below takes the width and is as tall as it
  // needs to be
  contentAcross: {
    height: 'auto',
    width: '100%',
  },
  close: {
    position: 'absolute',
    insetBlockStart: 16,
    insetInlineEnd: 16,
  },
  // announced, never shown
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 24,
  },
  footer: {
    marginTop: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 24,
  },
  title: {
    fontFamily: 'var(--font-heading)',
    fontSize: 16,
    lineHeight: '1.5rem',
    fontWeight: 500,
    color: tokens.foreground,
  },
  description: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
})

const SheetCtx = React.createContext<SheetState | null>(null)

/**
 * Which way the panel came in.
 *
 * The header is a grab region only on a sheet that came up from the bottom -
 * a fact that lives on the PANEL, one level above it, which a compiled style
 * cannot read. It is passed down instead.
 */
const SideCtx = React.createContext<'top' | 'right' | 'bottom' | 'left'>('right')

function useSheet(): SheetState {
  const ctx = React.use(SheetCtx)
  if (ctx === null) throw new Error('Sheet components must sit inside <Sheet>')
  return ctx
}

function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}) {
  const [inner, setInner] = React.useState(defaultOpen ?? false)
  const value = React.useMemo<SheetState>(
    () => ({
      open: open ?? inner,
      setOpen: (next) => {
        setInner(next)
        onOpenChange?.(next)
      },
    }),
    [open, inner, onOpenChange],
  )
  return <SheetCtx value={value}>{children}</SheetCtx>
}

function SheetTrigger({
  asChild = false,
  children,
  onClick,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { setOpen } = useSheet()
  if (asChild) {
    const child = React.Children.only(children) as React.ReactElement<{
      onClick?: React.MouseEventHandler
    }>
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event)
        setOpen(true)
      },
    })
  }
  return (
    <button
      type="button"
      data-slot="sheet-trigger"
      onClick={(event) => {
        onClick?.(event)
        setOpen(true)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

function SheetClose({
  asChild = false,
  children,
  onClick,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { setOpen } = useSheet()
  if (asChild) {
    const child = React.Children.only(children) as React.ReactElement<{
      onClick?: React.MouseEventHandler
    }>
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event)
        setOpen(false)
      },
    })
  }
  return (
    <button
      type="button"
      data-slot="sheet-close"
      onClick={(event) => {
        onClick?.(event)
        setOpen(false)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * Whether a photo viewer is standing over the sheet.
 *
 * The viewer portals to <body> and answers Escape itself; while it is up,
 * that Escape must not also close the sheet under it. The viewer mounts
 * imperatively (no prop reaches this component), so its presence is watched
 * on the body and fed to the drawer's own closeOnEscape switch.
 */
function usePhotoViewerOpen(active: boolean): boolean {
  const [viewerOpen, setViewerOpen] = React.useState(false)
  React.useEffect(() => {
    if (!active) return
    const read = () => setViewerOpen(document.querySelector('.PhotoView-Portal') !== null)
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.body, { childList: true })
    return () => observer.disconnect()
  }, [active])
  return viewerOpen
}

/** how long the exit plays; the closing transition in theme.css matches it */
const EXIT_MS = 200

/**
 * The panel's presence, owning the exit the widget library cannot play.
 *
 * The library's transition machine never ran here (entrances are CSS
 * insertion animations so they also play for mount-already-open), and with
 * its duration at zero a close unmounted everything mid-breath. So the
 * adapter holds the drawer mounted for one exit beat after `open` turns
 * false - however the close arrived: Escape, a click outside, the corner
 * button, or the parent flipping its own state - and marks both layers
 * `data-closing` for the stylesheet to slide and fade them out.
 */
function useExit(open: boolean): { shown: boolean; closing: boolean } {
  const [shown, setShown] = React.useState(open)
  const [closing, setClosing] = React.useState(false)
  React.useEffect(() => {
    if (open) {
      setClosing(false)
      setShown(true)
      return
    }
    if (!shown) return
    // a reader who asked for less motion gets the instant close
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(false)
      return
    }
    setClosing(true)
    const timer = window.setTimeout(() => {
      setClosing(false)
      setShown(false)
    }, EXIT_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return { shown, closing }
}

/**
 * Drag-down-to-dismiss for a bottom sheet, the way a phone expects.
 *
 * Only a drag that STARTS on a declared grab region counts - the grabber
 * bar, a header stamped `data-sheet-grab` (SheetHeader carries it for
 * free) - so pulling the content itself scrolls it and never closes the
 * panel. The panel follows the finger raw; releasing past the threshold
 * hands the panel, at its current offset, to the data-closing exit, and
 * releasing short of it runs the panel back.
 */
function useDragDismiss(
  active: boolean,
  closing: boolean,
  panelOf: () => HTMLElement | null,
  requestClose: () => void,
) {
  const drag = React.useRef<{ pointer: number; startY: number; dy: number } | null>(null)

  // the exit takes over from wherever the finger left the panel: clearing
  // the inline transform while the closing transition stands lets CSS
  // animate current offset -> off-screen instead of snapping to the top
  React.useEffect(() => {
    if (!closing) return
    const panel = panelOf()
    if (panel !== null) {
      panel.style.transform = ''
      panel.style.transition = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing])

  if (!active) return {}
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (closing || drag.current !== null) return
      const target = event.target as HTMLElement
      // a drag begins on a grab region and never on a control inside one
      if (target.closest('[data-sheet-grab]') === null) return
      if (target.closest('button, a, input, textarea, select') !== null) return
      drag.current = { pointer: event.pointerId, startY: event.clientY, dy: 0 }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // a pointer id the platform has no record of; the drag still counts
      }
      const panel = panelOf()
      if (panel !== null) panel.style.transition = 'none'
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const held = drag.current
      if (held === null || held.pointer !== event.pointerId) return
      held.dy = Math.max(0, event.clientY - held.startY)
      const panel = panelOf()
      if (panel !== null) panel.style.transform = `translateY(${held.dy}px)`
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      const held = drag.current
      if (held === null || held.pointer !== event.pointerId) return
      drag.current = null
      const panel = panelOf()
      const height = panel?.offsetHeight ?? 0
      if (held.dy > Math.min(96, height * 0.3) && held.dy > 48) {
        requestClose()
        return
      }
      if (panel !== null) {
        panel.style.transition = 'transform 150ms cubic-bezier(0.4, 0, 0.2, 1)'
        panel.style.transform = 'translateY(0)'
        window.setTimeout(() => {
          panel.style.transition = ''
          panel.style.transform = ''
        }, 160)
      }
    },
    onPointerCancel: () => {
      drag.current = null
      const panel = panelOf()
      if (panel !== null) {
        panel.style.transition = ''
        panel.style.transform = ''
      }
    },
  }
}

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
  showCloseButton?: boolean
}) {
  const { open, setOpen } = useSheet()
  const { shown, closing } = useExit(open)
  const photoOpen = usePhotoViewerOpen(open)
  // a STABLE ref object - the focus trap re-runs its focus routine when
  // the content ref identity changes
  const contentRef = React.useRef<HTMLDivElement>(null)
  const dragHandlers = useDragDismiss(
    side === 'bottom',
    closing,
    () => contentRef.current,
    () => setOpen(false),
  )
  // the page behind a modal leaves the conversation entirely
  React.useEffect(() => {
    if (!open) return
    return retainInertBackground(() => contentRef.current)
  }, [open])
  return (
    <MDrawer.Root
      opened={shown}
      onClose={() => setOpen(false)}
      position={side}
      trapFocus
      returnFocus
      lockScroll
      closeOnEscape={!photoOpen && !closing}
      closeOnClickOutside
      // motion has one owner and it is not the widget: entrances are CSS
      // insertion animations, exits are the data-closing transition, and
      // the widget only mounts and unmounts
      transitionProps={{ duration: 0 }}
    >
      <MDrawer.Overlay
        data-slot="sheet-overlay"
        blur={2}
        {...(closing ? { 'data-closing': '' } : {})}
        {...stylex.props(styles.overlay, closing && styles.overlayClosing)}
      />
      <MDrawer.Content
        data-slot="sheet-content"
        data-side={side}
        {...(closing ? { 'data-closing': '' } : {})}
        {...dragHandlers}
        ref={contentRef}
        // structure only; surface and the panel chrome are the widget's own.
        // classNames.content, not className: the widget duplicates className
        // onto its positioning inner element. `relative`, because the corner
        // button is anchored to this panel: while the entrance animation
        // holds a transform the panel is a containing block by accident, and
        // the moment it ends an unpositioned panel hands the button to the
        // viewport - the corner button leaping to the page corner. The panel
        // itself does not scroll (overflow back to visible) - its children
        // own scrolling, which is what keeps a footer standing while the
        // middle moves.
        classNames={{
          content: clsx(
            stylex.props(
              styles.content,
              side === 'left' || side === 'right' ? styles.contentBeside : styles.contentAcross,
              entranceOf(side),
              closing && styles.panelClosing,
              closing && outOf(side),
            ).className,
            className,
          ),
        }}
        {...props}
      >
        <SideCtx value={side}>{children}</SideCtx>
        {showCloseButton && (
          <Button
            data-slot="sheet-close"
            variant="ghost"
            className={stylex.props(styles.close).className}
            size="icon-sm"
            onClick={() => setOpen(false)}
          >
            <XIcon />
            <span {...stylex.props(styles.hidden)}>Close</span>
          </Button>
        )}
      </MDrawer.Content>
    </MDrawer.Root>
  )
}

const entranceOf = (side: 'top' | 'right' | 'bottom' | 'left') =>
  side === 'right'
    ? styles.entranceRight
    : side === 'left'
      ? styles.entranceLeft
      : side === 'top'
        ? styles.entranceTop
        : styles.entranceBottom

const outOf = (side: 'top' | 'right' | 'bottom' | 'left') =>
  side === 'right'
    ? styles.outRight
    : side === 'left'
      ? styles.outLeft
      : side === 'top'
        ? styles.outTop
        : styles.outBottom

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  const fromBottom = React.use(SideCtx) === 'bottom'
  return (
    <div
      data-slot="sheet-header"
      // the header is a grab region: on a bottom sheet, dragging it down
      // dismisses the panel the way a phone expects
      data-sheet-grab=""
      {...props}
      {...seatOf(stylex.props(styles.header, fromBottom && styles.grab), className)}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-footer" {...props} {...seatOf(stylex.props(styles.footer), className)} />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return (
    <MDrawer.Title
      data-slot="sheet-title"
      {...props}
      {...seatOf(stylex.props(styles.title), className)}
    />
  )
}

function SheetDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="sheet-description"
      {...props}
      {...seatOf(stylex.props(styles.description), className)}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
