import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { Alert, AlertDescription } from './alert.tsx'
import { Button } from './button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from './card.tsx'
import { Label } from './label.tsx'
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
  children,
}: {
  pending: boolean
  error?: string | null
  loadingLabel: string
  retryLabel: string
  onRetry: () => void
  children: ReactNode
}) {
  if (pending) {
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

export function Feedback({ message, tone = 'error' }: { message?: string | null; tone?: 'error' | 'success' }) {
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
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
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
    <fieldset className="space-y-2" disabled={disabled}>
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
                option.disabled ? 'opacity-50' : 'hover:bg-muted/50',
              )}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={chosen.has(option.value)}
                disabled={option.disabled}
                onChange={() => toggle(option.value)}
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

// A real modal instead of window.confirm: it can say how much damage the
// action does, it localizes, and a browser test can read and drive it.
// Native <dialog> gives focus trapping and escape handling without a
// dependency.
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
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="rounded-lg border bg-card p-0 text-card-foreground backdrop:bg-black/40"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <div className="max-w-sm space-y-4 p-5">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
