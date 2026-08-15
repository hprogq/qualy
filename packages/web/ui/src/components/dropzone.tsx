import type { ReactNode } from 'react'
import { useDropzone, type Accept } from 'react-dropzone'
import { cn } from '../lib/cn.ts'

// Somewhere to drop files, and a row for each one that landed.
//
// Text-free like the rest of this package: what the area invites and what a
// row says about its file both arrive as nodes, so the primitive never needs
// a locale.

export type { Accept }

export function Dropzone({
  onFiles,
  accept,
  maxFiles,
  multiple = true,
  disabled = false,
  className,
  children,
}: {
  onFiles: (files: readonly File[]) => void
  accept?: Accept | undefined
  maxFiles?: number | undefined
  multiple?: boolean
  disabled?: boolean
  className?: string
  /** what the area says while it waits; the drag state is handed back to it */
  children: ReactNode | ((state: { dragging: boolean }) => ReactNode)
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    maxFiles,
    multiple,
    disabled,
    noKeyboard: false,
    onDrop: (accepted: File[]) => {
      if (accepted.length > 0) onFiles(accepted)
    },
  })

  return (
    <div
      {...getRootProps({
        className: cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground transition-colors outline-none',
          'hover:border-ring/60 hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          isDragActive && 'border-ring bg-accent/60 text-foreground',
          disabled && 'pointer-events-none opacity-50',
          className,
        ),
      })}
    >
      <input {...getInputProps()} />
      {typeof children === 'function' ? children({ dragging: isDragActive }) : children}
    </div>
  )
}

/** one file that is already there: what it is, what it weighs, what can be done to it */
export function FileTile({
  media,
  name,
  meta,
  actions,
  className,
}: {
  /** a thumbnail or an icon; sized by the caller into the square left of the name */
  media?: ReactNode
  name: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm', className)}>
      {media !== undefined && (
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
          {media}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">{name}</span>
        {meta !== undefined && <span className="truncate text-xs text-muted-foreground">{meta}</span>}
      </span>
      {actions !== undefined && <span className="flex shrink-0 items-center gap-1">{actions}</span>}
    </div>
  )
}
