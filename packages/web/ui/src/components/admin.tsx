import { useEffect, useId, useState, type ReactNode } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import { cn } from '../lib/cn.ts'
import { Alert, AlertDescription } from './alert.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from './empty.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog.tsx'
import { Button } from './button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from './card.tsx'
import { Checkbox } from './checkbox.tsx'
import { RadioGroup as RadioGroupRoot, RadioGroupItem } from './radio-group.tsx'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog.tsx'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from './sheet.tsx'
import {
  Field as FormField,
  FieldContent as FormFieldContent,
  FieldDescription as FormFieldDescription,
  FieldLabel as FormFieldLabel,
  FieldTitle as FormFieldTitle,
} from './field.tsx'
import { Spinner } from './spinner.tsx'

// The shape every administration screen shares. Text-free like the rest of
// this package: every visible string arrives as a prop, so the primitives
// never need a locale and a plugin never needs to re-implement a panel.

/**
 * What a page is, above what it shows.
 *
 * The shell says which application and which object; the page still has to
 * say which of that object's pages this is. Without it a section opens on
 * its own controls, which reads as a fragment of a screen rather than a
 * screen.
 */
export function PageHeader({
  title,
  description,
  actions,
  variant = 'plain',
}: {
  /**
   * Usually the page's name. Takes a node so a heading that has something to
   * say beside the name - a standing, a chip - is still this heading rather
   * than a second one built to look like it: two headings assembled
   * separately drift apart by a few pixels, and in a band that hands over
   * from one to the other those pixels are a jump.
   */
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /**
   * The heading of a band that spans the content area, rather than a line of
   * text above it.
   *
   * Only the rhythm differs here - the band itself belongs to whoever draws
   * it edge to edge, because a header inset inside the page's own width is a
   * card pretending to be a header.
   */
  variant?: 'plain' | 'banner'
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-4 gap-y-2',
        variant === 'banner' && 'py-1',
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="flex min-w-0 items-center gap-2.5 text-lg font-semibold tracking-tight">
          {title}
        </h1>
        {description !== undefined && description !== '' && (
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {/* capped at the header's own width so what a page puts here wraps
          instead of running off the edge: a flex item that may not shrink is
          sized to its content, and its own wrapping never gets a chance */}
      {actions && (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}

/**
 * One part of a screen: a heading, what it says, and what it holds.
 *
 * A rule above it and nothing else. It used to be a card, and a screen of
 * five settings then read as five unrelated objects stacked on a page -
 * boxes inside a box, each with its own edge competing with the edges of the
 * rows inside it. What separates two parts of one thing is a line.
 */
export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  )
}

// loading, failed-with-retry, or the content — the three states every remote
// section has, so no screen invents its own combination of them
export function AsyncSection({
  pending,
  error,
  loadingLabel,
  retryLabel,
  onRetry,
  skeleton,
  className,
  children,
}: {
  pending: boolean
  error?: string | null
  loadingLabel: string
  retryLabel: string
  onRetry: () => void
  /** what the section looks like while it loads; a spinner when absent */
  skeleton?: ReactNode
  /** carried by every branch, for a section that has to fill its parent */
  className?: string
  children: ReactNode
}) {
  if (pending) {
    if (skeleton) {
      return (
        <div role="status" aria-label={loadingLabel} className={className}>
          {skeleton}
        </div>
      )
    }
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Spinner aria-label={loadingLabel} />
      </div>
    )
  }
  if (error) {
    // Centred and given room, rather than a red bar hugging the left edge.
    // A section that could not load is the whole of what the reader is
    // looking at, and the sentence and its one action should be where their
    // eye already is.
    return (
      <Empty className={cn('rounded-lg border border-dashed', className)}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  return className === undefined ? <>{children}</> : <div className={className}>{children}</div>
}

export function Feedback({
  message,
  tone = 'error',
}: {
  message?: string | null
  tone?: 'error' | 'success'
}) {
  if (!message) return null
  return (
    // what kind of answer this is, beside the sentence carrying it: a test
    // about "it saved" asks for the tone, not for the wording of the note
    <Alert
      data-testid="feedback"
      data-tone={tone}
      variant={tone === 'error' ? 'destructive' : 'default'}
      role="alert"
    >
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

// a labelled control; the generated id ties label to input, which is what
// makes these screens reachable by name in a browser test and by a screen
// reader in real use
/**
 * The asterisk a required label wears.
 *
 * Exported because not every required control is a `Field`: a group of
 * toggles carries its own label row, and two hand-rolled asterisks drift
 * apart. Always aria-hidden - the accessible name is the label itself, and
 * "Title *" is what a screen reader would otherwise read out and a test
 * would have to ask for.
 */
export function RequiredMark() {
  return (
    <span aria-hidden className="pl-0.5 text-destructive">
      *
    </span>
  )
}

export function Field({
  label,
  hint,
  required = false,
  children,
}: {
  label: string
  hint?: ReactNode
  /**
   * Marks the label with the usual asterisk. Hidden from the accessible
   * name, which is the label itself - a control called "Title *" is what a
   * screen reader would then have to read out, and what a test would have to
   * ask for.
   */
  required?: boolean
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <FormField>
      <FormFieldLabel htmlFor={id}>
        {label}
        {required && <RequiredMark />}
      </FormFieldLabel>
      {children(id)}
      {hint && <FormFieldDescription>{hint}</FormFieldDescription>}
    </FormField>
  )
}

export interface CheckboxOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

// multi-select as real checkboxes rather than a custom widget: keyboard,
// labels and form semantics come free and are what a test drives
export function CheckboxGroup({
  legend,
  options,
  selected,
  onChange,
  disabled,
  emptyLabel,
}: {
  legend: string
  options: readonly CheckboxOption[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  emptyLabel: string
}) {
  const chosen = new Set(selected)
  const toggle = (value: string) => {
    const next = new Set(chosen)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange([...next])
  }
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="grid gap-1 sm:grid-cols-2">
          {options.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex items-start gap-2 rounded-md px-2 py-1 text-sm',
                option.disabled || disabled ? 'opacity-50' : 'hover:bg-muted/50',
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={chosen.has(option.value)}
                disabled={option.disabled ?? disabled}
                onCheckedChange={() => toggle(option.value)}
              />
              <span className="min-w-0">
                <span className="block truncate">{option.label}</span>
                {option.hint && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

// One-of-several as real radios, for the same reasons as the checkboxes
// above: a fieldset with a legend is what a screen reader announces and what
// a test drives by role and name.
export function RadioGroup({
  legend,
  name,
  options,
  selected,
  onChange,
  disabled,
  variant = 'list',
}: {
  legend: string
  name: string
  options: readonly CheckboxOption[]
  selected: string
  onChange: (next: string) => void
  disabled?: boolean
  /** 'cards' gives each option a full-width target, for a few real choices */
  variant?: 'list' | 'cards'
}) {
  if (variant === 'cards') {
    return (
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        {/* a legend is not part of the flow box, so its spacing is its own */}
        <legend className="mb-2 text-sm font-medium">{legend}</legend>
        <RadioGroupRoot
          name={name}
          value={selected}
          onValueChange={onChange}
          {...(disabled !== undefined ? { disabled } : {})}
          className="grid gap-2"
        >
          {options.map((option) => (
            <FormFieldLabel key={option.value}>
              {/* a card is one choice, not a paragraph with a control beside
                  it: the same has- modifier the variant uses, so this wins */}
              <FormField
                orientation="horizontal"
                className="has-[>[data-slot=field-content]]:items-center"
              >
                <FormFieldContent>
                  <FormFieldTitle>{option.label}</FormFieldTitle>
                  {option.hint && <FormFieldDescription>{option.hint}</FormFieldDescription>}
                </FormFieldContent>
                <RadioGroupItem value={option.value} disabled={option.disabled ?? disabled} />
              </FormField>
            </FormFieldLabel>
          ))}
        </RadioGroupRoot>
      </fieldset>
    )
  }
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <RadioGroupRoot
        name={name}
        value={selected}
        onValueChange={onChange}
        {...(disabled !== undefined ? { disabled } : {})}
        className="grid gap-1 sm:grid-cols-2"
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex items-start gap-2 rounded-md px-2 py-1 text-sm',
              option.disabled || disabled ? 'opacity-50' : 'hover:bg-muted/50',
            )}
          >
            <RadioGroupItem
              className="mt-0.5"
              value={option.value}
              disabled={option.disabled ?? disabled}
            />
            <span className="min-w-0">
              <span className="block truncate">{option.label}</span>
              {option.hint && (
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              )}
            </span>
          </label>
        ))}
      </RadioGroupRoot>
    </fieldset>
  )
}

// The overlays, over the library primitives: the same prop shape as always
// (open/title/description/onClose/footer), so a screen never re-states how a
// modal opens, closes or animates.

// A centred modal for a short task - creating something, answering a
// question with a form. Content and buttons arrive as children/footer so the
// dialog itself stays text-free.
export function FormDialog({
  open,
  title,
  description,
  size = 'default',
  restfulFocus = false,
  onClose,
  children,
  footer,
}: {
  open: boolean
  /**
   * Takes a node so a title with something beside it - a chip saying what
   * the thing being filled in is worth - is still this title rather than a
   * second heading built to look like it.
   */
  title: ReactNode
  description?: ReactNode
  /**
   * How much room the task needs. `wide` is for a form that has something to
   * say beside it - the terms it is answering, what was already answered -
   * which at the default width would sit under the form instead of next to
   * it and stop being context.
   */
  size?: 'default' | 'wide'
  /**
   * Open with the focus resting on the dialog itself rather than on its
   * first control. For a dialog whose first control is a choice made by
   * key: opened from the keyboard, the default focus paints a ring on the
   * first option, which reads as "this one is chosen" when nothing is.
   */
  restfulFocus?: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Never taller than the window, and the middle row is what gives:
          a form long enough to outgrow a phone used to push its own footer
          off the bottom, where the button that saves it could not be
          reached. The three rows are the header, the body and the footer -
          a dialog without a footer simply leaves the last one empty. */}
      <DialogContent
        // prevented, the focus scope settles on the dialog container: keys
        // still land, tab still reaches every control, nothing wears a ring
        {...(restfulFocus ? { onOpenAutoFocus: (event: Event) => event.preventDefault() } : {})}
        className={cn(
          'max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]',
          size === 'wide' ? 'sm:max-w-4xl' : 'sm:max-w-lg',
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

// A panel docked to the right edge for editing one thing in place while the
// list behind stays visible in spirit: inspect, change, close.
export function SidePanel({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      {/* the whole width on a phone: three quarters of a 390px screen is a
          panel with a dead strip beside it and nothing readable inside */}
      <SheetContent side="right" className="max-sm:w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4">
          <div className="flex flex-col gap-5 pb-4">{children}</div>
        </div>
        {footer && <SheetFooter className="flex-row justify-end">{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  )
}

// A real modal instead of window.confirm: it can say how much damage the
// action does, it localizes, and a browser test can read and drive it.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  otherLabel,
  pending,
  tone = 'default',
  onConfirm,
  onOther,
  onCancel,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel: string
  cancelLabel: string
  /**
   * A third way out, offered where calling it off is not the only smaller
   * answer: the lesser commitment the question implies - keep the work
   * without handing it on - so that reaching it costs one press and not a
   * dismissal followed by hunting for the other button.
   */
  otherLabel?: string
  pending?: boolean
  /** destructive colours the confirming button, for what cannot be undone */
  tone?: 'default' | 'destructive'
  onConfirm: () => void
  onOther?: () => void
  onCancel: () => void
}) {
  // The words outlive the answer.
  //
  // Whoever opens one of these keeps the subject in state - which person is
  // being removed - and clears it the moment the question is answered. The
  // dialog is still on screen for the length of its closing animation, so the
  // sentence lost its name mid-fade and asked about nobody. Holding the last
  // words it was given costs nothing and means a caller can go on clearing
  // its own state the moment it is done with it.
  const [said, setSaid] = useState({ title, description, confirmLabel, otherLabel })
  useEffect(() => {
    if (open) setSaid({ title, description, confirmLabel, otherLabel })
  }, [open, title, description, confirmLabel, otherLabel])
  const shown = open ? { title, description, confirmLabel, otherLabel } : said

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{shown.title}</AlertDialogTitle>
          {shown.description !== undefined && (
            <AlertDialogDescription>{shown.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-dismiss" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          {shown.otherLabel !== undefined && onOther !== undefined && (
            <AlertDialogAction
              data-testid="confirm-other"
              variant="outline"
              onClick={onOther}
              disabled={pending}
            >
              {shown.otherLabel}
            </AlertDialogAction>
          )}
          <AlertDialogAction
            data-testid="confirm-accept"
            data-tone={tone}
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={pending}
          >
            {shown.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
