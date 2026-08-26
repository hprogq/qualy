'use client'

import * as React from 'react'
import { Drawer as MDrawer } from '@mantine/core'

import { cn } from '../lib/utils.ts'
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
const SheetCtx = React.createContext<SheetState | null>(null)

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
  const photoOpen = usePhotoViewerOpen(open)
  // a STABLE ref object - the focus trap re-runs its focus routine when
  // the content ref identity changes
  const contentRef = React.useRef<HTMLDivElement>(null)
  // the page behind a modal leaves the conversation entirely
  React.useEffect(() => {
    if (!open) return
    return retainInertBackground(() => contentRef.current)
  }, [open])
  return (
    <MDrawer.Root
      opened={open}
      onClose={() => setOpen(false)}
      position={side}
      trapFocus
      returnFocus
      lockScroll
      closeOnEscape={!photoOpen}
      closeOnClickOutside
      transitionProps={{ duration: 200 }}
    >
      {/* no backdrop blur: a backdrop-filter under an opacity entrance makes
          mobile Safari re-rasterize the page behind on every frame, which
          reads as the background flashing while the sheet opens */}
      <MDrawer.Overlay data-slot="sheet-overlay" />
      <MDrawer.Content
        data-slot="sheet-content"
        data-side={side}
        ref={contentRef}
        // structure only; surface and slide transition are the widget's own.
        // classNames.content, not className: the widget duplicates className
        // onto its positioning inner element. The panel itself does not
        // scroll (overflow back to visible) - its children own scrolling,
        // which is what keeps a footer standing while the middle moves.
        classNames={{
          content: cn(
            'flex flex-col overflow-y-visible text-sm',
            (side === 'left' || side === 'right') && 'h-full w-3/4 sm:max-w-sm',
            (side === 'top' || side === 'bottom') && 'h-auto w-full',
            className,
          ),
        }}
        {...props}
      >
        {children}
        {showCloseButton && (
          <Button
            data-slot="sheet-close"
            variant="ghost"
            className="absolute top-4 right-4"
            size="icon-sm"
            onClick={() => setOpen(false)}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
        )}
      </MDrawer.Content>
    </MDrawer.Root>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 p-6', className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-6', className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return (
    <MDrawer.Title
      data-slot="sheet-title"
      className={cn('font-heading text-base font-medium text-foreground', className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
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
