import { useEffect, useState } from 'react'
import { FileIcon, PlusIcon, TypeIcon, XIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Kbd, KbdGroup } from '@qualy/ui/kbd'
import { Label } from '@qualy/ui/label'
import { Textarea } from '@qualy/ui/textarea'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { DecisionSheet } from './decision-dialogs.tsx'
import { useFinePointer } from './pointer.ts'

// Asking for more backing without moving the round. The builder offers two
// shapes and only two - a written answer or files - so an ask can never grow
// into a second form the filing was not written under; anything richer than
// that is a rejection with a suggested version, which is the other door.
//
// The dialog composes the ask and hands it back; it does not send it. Asking
// is a disposition like approving, so it goes out through the same five
// second window - which is also the only way to take back a wording nobody
// should have been shown.

const styles = stylex.create({
  fixed: { flexShrink: 0 },
  toggle: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    lineHeight: '1rem',
    whiteSpace: 'nowrap',
  },
  // a border adds to the box and made this cap wider than its siblings; a
  // ring is paint
  capOnSurface: {
    backgroundColor: tokens.background,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  onSolid: {
    backgroundColor: 'color-mix(in oklab, currentColor 20%, transparent)',
    color: 'currentColor',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  pieces: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  piecesTitle: {
    fontSize: 14,
    fontWeight: 500,
  },
  pieceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  pieceKind: {
    display: 'flex',
    width: 96,
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  kindIcon: {
    width: 14,
    height: 14,
  },
  grow: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  addRow: {
    display: 'flex',
    gap: 8,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
})

interface Piece {
  label: string
  kind: 'text' | 'file'
  required: boolean
}

/** an ask as the dialog hands it over, before anything is sent */
export interface WordedSupplement {
  readonly instructions: string
  readonly requirements: readonly Piece[]
}

export function SupplementDialog({
  open,
  onClose,
  onConfirm,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  onClose: () => void
  onConfirm: (worded: WordedSupplement) => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  const [instructions, setInstructions] = useState('')
  const [pieces, setPieces] = useState<readonly Piece[]>([
    { label: '', kind: 'file', required: true },
  ])

  const edit = (index: number, next: Partial<Piece>) =>
    setPieces((current) =>
      current.map((piece, at) => (at === index ? { ...piece, ...next } : piece)),
    )
  const add = (kind: Piece['kind']) => {
    setPieces((current) => {
      // the new row's slot is where the cursor goes: asking for a piece and
      // then reaching for the mouse to name it defeats the shortcut
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLInputElement>(`[data-piece-slot="${current.length + 1}"]`)
          ?.focus(),
      )
      return [...current, { label: '', kind, required: true }]
    })
  }
  const remove = (index: number) => setPieces((current) => current.filter((_, at) => at !== index))

  // The same chords the send-back panel taught: ⌥ letters act while the
  // cursor is writing, ⌘↵ sends the finished ask. Read off the document so
  // a chord pressed inside the instructions box still lands.
  useEffect(() => {
    if (!fine || !open) return
    const down = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (ready) confirm()
        return
      }
      if (!event.altKey || event.metaKey || event.ctrlKey) return
      if (event.code === 'KeyF') {
        event.preventDefault()
        add('file')
        return
      }
      if (event.code === 'KeyT') {
        event.preventDefault()
        add('text')
        return
      }
      const digit = event.code.startsWith('Digit') ? Number(event.code.slice(5)) : NaN
      if (Number.isInteger(digit) && digit >= 1 && digit <= Math.min(9, pieces.length)) {
        event.preventDefault()
        document.querySelector<HTMLInputElement>(`[data-piece-slot="${digit}"]`)?.select()
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  })

  const ready =
    instructions.trim() !== '' &&
    pieces.length > 0 &&
    pieces.every((piece) => piece.label.trim() !== '')

  const confirm = () =>
    onConfirm({
      instructions: instructions.trim(),
      requirements: pieces.map((piece) => ({
        label: piece.label.trim(),
        kind: piece.kind,
        required: piece.required,
      })),
    })

  const body = (
    <div {...stylex.props(styles.body)}>
      <Field label={format(m.supplementInstructionsLabel)} required>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={fine}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        )}
      </Field>

      <div {...stylex.props(styles.pieces)}>
        <p {...stylex.props(styles.piecesTitle)}>{format(m.supplementPiecesLabel)}</p>
        {pieces.map((piece, index) => (
          <div key={index} {...stylex.props(styles.pieceRow)}>
            <span {...stylex.props(styles.pieceKind)}>
              {piece.kind === 'file' ? (
                <FileIcon aria-hidden className={stylex.props(styles.kindIcon).className} />
              ) : (
                <TypeIcon aria-hidden className={stylex.props(styles.kindIcon).className} />
              )}
              {format(piece.kind === 'file' ? m.supplementAddFile : m.supplementAddText)}
            </span>
            <Input
              value={piece.label}
              data-piece-slot={index + 1}
              placeholder={format(m.supplementPieceLabel)}
              className={stylex.props(styles.grow).className}
              onChange={(event) => edit(index, { label: event.target.value })}
            />
            {fine && index < 9 && (
              <KbdGroup className={stylex.props(styles.fixed).className}>
                <Kbd>⌥</Kbd>
                <Kbd>{index + 1}</Kbd>
              </KbdGroup>
            )}
            <Label className={stylex.props(styles.toggle).className}>
              <Checkbox
                checked={piece.required}
                onCheckedChange={(checked) => edit(index, { required: checked === true })}
              />
              {format(m.supplementPieceRequired)}
            </Label>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pieces.length <= 1}
              onClick={() => remove(index)}
            >
              <XIcon aria-hidden />
              <VisuallyHidden>{format(m.supplementPieceRemove)}</VisuallyHidden>
            </Button>
          </div>
        ))}
        <div {...stylex.props(styles.addRow)}>
          <Button variant="outline" size="sm" onClick={() => add('file')}>
            <PlusIcon aria-hidden />
            {format(m.supplementAddFile)}
            {fine && (
              // Ringed inside, not bordered: the outline button's own wash is
              // the same grey the chip defaults to, and the key vanished into
              // it - but a border adds to the box and made this ⌥ two pixels
              // wider than its siblings in the rows above. A ring is paint.
              <KbdGroup>
                <Kbd className={stylex.props(styles.capOnSurface).className}>⌥</Kbd>
                <Kbd className={stylex.props(styles.capOnSurface).className}>F</Kbd>
              </KbdGroup>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => add('text')}>
            <PlusIcon aria-hidden />
            {format(m.supplementAddText)}
            {fine && (
              <KbdGroup>
                <Kbd className={stylex.props(styles.capOnSurface).className}>⌥</Kbd>
                <Kbd className={stylex.props(styles.capOnSurface).className}>T</Kbd>
              </KbdGroup>
            )}
          </Button>
        </div>
      </div>
    </div>
  )

  if (!fine) {
    return (
      <DecisionSheet
        open={open}
        title={format(m.supplementDialogTitle)}
        hint={format(m.supplementDialogHint)}
        slideLabel={format(m.reviewSlideSupplement)}
        waiting={format(m.reviewSheetFillFirst)}
        ready={ready}
        onClose={onClose}
        onConfirm={confirm}
      >
        {body}
      </DecisionSheet>
    )
  }

  return (
    <FormDialog
      open={open}
      title={format(m.supplementDialogTitle)}
      description={format(m.supplementDialogHint)}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={!ready} onClick={confirm}>
            {format(m.supplementSend)}
            <Kbd className={stylex.props(styles.onSolid).className}>⌘↵</Kbd>
          </Button>
        </div>
      }
    >
      {body}
    </FormDialog>
  )
}
