import type { ReactNode } from 'react'
import { useDropzone, type Accept, type FileRejection as DropRejection } from 'react-dropzone'
import { clsx } from 'clsx'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '../theme/tokens.stylex.ts'

// Somewhere to drop files, and a row for each one that landed.
//
// Text-free like the rest of this package: what the area invites and what a
// row says about its file both arrive as nodes, so the primitive never needs
// a locale. What it would not take leaves the same way - as a file and a
// reason code, never as a sentence, because the sentence belongs to whoever
// knows what the field is called.

export type { Accept }

/** one file the area turned away, and the one word for why */
export interface FileRejection {
  readonly file: File
  readonly reason: 'too-large' | 'type' | 'too-many'
}

/**
 * Whatever the underlying picker said, in this component's three words.
 *
 * Only these three are reachable: a lower bound is not offered, so a file is
 * turned away for its size, its kind, or for arriving after the area was
 * full. An unknown code is reported as a kind refusal rather than dropped -
 * a file that vanishes without a word is the failure this channel exists to
 * end.
 */

const reasonOf = (rejection: DropRejection): FileRejection['reason'] => {
  const codes = rejection.errors.map((error) => error.code)
  if (codes.includes('file-too-large')) return 'too-large'
  if (codes.includes('too-many-files')) return 'too-many'
  return 'type'
}

const styles = stylex.create({
  drop: {
    display: 'flex',
    cursor: 'pointer',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: {
      default: tokens.border,
      ':hover': `color-mix(in oklab, ${tokens.focusRing} 60%, transparent)`,
      ':focus-visible': tokens.focusRing,
    },
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    },
    boxShadow: {
      default: null,
      ':focus-visible': `0 0 0 3px color-mix(in oklab, ${tokens.focusRing} 50%, transparent)`,
    },
    paddingInline: 16,
    paddingBlock: 20,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    outline: 'none',
  },
  // a file is over the target: the box says so before it is let go
  dropOver: {
    borderColor: tokens.focusRing,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    color: tokens.foreground,
  },
  dropOff: {
    pointerEvents: 'none',
    opacity: 0.5,
  },
  tile: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 10,
    fontSize: 14,
    lineHeight: '1.25rem',
  },
  tileMedia: {
    display: 'flex',
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceMuted,
    color: tokens.mutedForeground,
  },
  tileWords: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 2,
  },
  truncate: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tileMeta: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  tileActions: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 4,
  },
})

export function Dropzone({
  onFiles,
  onRejected,
  accept,
  maxFiles,
  maxSize,
  multiple = true,
  disabled = false,
  className,
  children,
}: {
  onFiles: (files: readonly File[]) => void
  /** the ones it would not take, so the caller can say so in its own words */
  onRejected?: ((rejections: readonly FileRejection[]) => void) | undefined
  accept?: Accept | undefined
  maxFiles?: number | undefined
  /** the largest single file the area will hand over, in bytes */
  maxSize?: number | undefined
  multiple?: boolean
  disabled?: boolean
  className?: string
  /** what the area says while it waits; the drag state is handed back to it */
  children: ReactNode | ((state: { dragging: boolean }) => ReactNode)
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    maxFiles,
    maxSize,
    multiple,
    disabled,
    noKeyboard: false,
    onDrop: (accepted: File[], rejected: DropRejection[]) => {
      if (accepted.length > 0) onFiles(accepted)
      if (rejected.length > 0) {
        onRejected?.(rejected.map((one) => ({ file: one.file, reason: reasonOf(one) })))
      }
    },
  })

  return (
    <div
      {...getRootProps({
        className: clsx(
          stylex.props(
            styles.drop,
            isDragActive && styles.dropOver,
            disabled === true && styles.dropOff,
          ).className,
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
    <div className={clsx(stylex.props(styles.tile).className, className)}>
      {media !== undefined && <span {...stylex.props(styles.tileMedia)}>{media}</span>}
      <span {...stylex.props(styles.tileWords)}>
        <span {...stylex.props(styles.truncate)}>{name}</span>
        {meta !== undefined && <span {...stylex.props(styles.tileMeta)}>{meta}</span>}
      </span>
      {actions !== undefined && <span {...stylex.props(styles.tileActions)}>{actions}</span>}
    </div>
  )
}
