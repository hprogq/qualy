import { useId, type ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { Alert, AlertDescription } from './alert.tsx'
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog.tsx'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from './drawer.tsx'
import {
  Field as FormField,
  FieldDescription as FormFieldDescription,
  FieldLabel as FormFieldLabel,
} from './field.tsx'
import { Spinner } from './spinner.tsx'

// The shape every administration screen shares. Text-free like the rest of
// this package: every visible string arrives as a prop, so the primitives
// never need a locale and a plugin never needs to re-implement a panel.

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
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
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
  children,
}: {
  pending: boolean
  error?: string | null
  loadingLabel: string
  retryLabel: string
  onRetry: () => void
  /** what the section looks like while it loads; a spinner when absent */
  skeleton?: ReactNode
  children: ReactNode
}) {
  if (pending) {
    if (skeleton) {
      return (
        <div role="status" aria-label={loadingLabel}>
          {skeleton}
        </div>
      )
    }
    return (
      <div className="flex justify-center py-8">
        <Spinner aria-label={loadingLabel} />
      </div>
    )
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="space-y-3">
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  return <>{children}</>
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
    <Alert variant={tone === 'error' ? 'destructive' : 'default'} role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

// a labelled control; the generated id ties label to input, which is what
// makes these screens reachable by name in a browser test and by a screen
// reader in real use
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <FormField>
      <FormFieldLabel htmlFor={id}>{label}</FormFieldLabel>
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
}: {
  legend: string
  name: string
  options: readonly CheckboxOption[]
  selected: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
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
    <Drawer direction="right" open={open} onOpenChange={(next) => !next && onClose()}>
      <DrawerContent className="data-[vaul-drawer-direction=right]:inset-y-2 data-[vaul-drawer-direction=right]:right-2 data-[vaul-drawer-direction=right]:rounded-lg data-[vaul-drawer-direction=right]:sm:max-w-xl">
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          {description && <DrawerDescription>{description}</DrawerDescription>}
        </DrawerHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-5">{children}</div>
        </div>
        {footer && <DrawerFooter>{footer}</DrawerFooter>}
      </DrawerContent>
    </Drawer>
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
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel: string
  cancelLabel: string
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
