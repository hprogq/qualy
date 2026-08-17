import { useState } from 'react'
import { FileIcon, PlusIcon, TypeIcon, XIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import { Textarea } from '@qualy/ui/textarea'
import { assessmentMessages as m } from '../i18n.ts'

// Asking for more backing without moving the round. The builder offers two
// shapes and only two - a written answer or files - so an ask can never grow
// into a second form the filing was not written under; anything richer than
// that is a rejection with a suggested version, which is the other door.
//
// The dialog composes the ask and hands it back; it does not send it. Asking
// is a disposition like approving, so it goes out through the same five
// second window - which is also the only way to take back a wording nobody
// should have been shown.

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
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (worded: WordedSupplement) => void
}) {
  const { format } = useI18n()
  const [instructions, setInstructions] = useState('')
  const [pieces, setPieces] = useState<readonly Piece[]>([
    { label: '', kind: 'file', required: true },
  ])

  const edit = (index: number, next: Partial<Piece>) =>
    setPieces((current) =>
      current.map((piece, at) => (at === index ? { ...piece, ...next } : piece)),
    )
  const add = (kind: Piece['kind']) =>
    setPieces((current) => [...current, { label: '', kind, required: true }])
  const remove = (index: number) => setPieces((current) => current.filter((_, at) => at !== index))

  const ready =
    instructions.trim() !== '' &&
    pieces.length > 0 &&
    pieces.every((piece) => piece.label.trim() !== '')

  return (
    <FormDialog
      open
      title={format(m.supplementDialogTitle)}
      description={format(m.supplementDialogHint)}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button
            disabled={!ready}
            onClick={() =>
              onConfirm({
                instructions: instructions.trim(),
                requirements: pieces.map((piece) => ({
                  label: piece.label.trim(),
                  kind: piece.kind,
                  required: piece.required,
                })),
              })
            }
          >
            {format(m.supplementSend)}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={format(m.supplementInstructionsLabel)} required>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              autoFocus
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{format(m.supplementPiecesLabel)}</p>
          {pieces.map((piece, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                {piece.kind === 'file' ? (
                  <FileIcon aria-hidden className="size-3.5" />
                ) : (
                  <TypeIcon aria-hidden className="size-3.5" />
                )}
                {format(piece.kind === 'file' ? m.supplementAddFile : m.supplementAddText)}
              </span>
              <Input
                value={piece.label}
                placeholder={format(m.supplementPieceLabel)}
                className="flex-1"
                onChange={(event) => edit(index, { label: event.target.value })}
              />
              <Label className="flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap">
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
                <span className="sr-only">{format(m.supplementPieceRemove)}</span>
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => add('file')}>
              <PlusIcon aria-hidden />
              {format(m.supplementAddFile)}
            </Button>
            <Button variant="outline" size="sm" onClick={() => add('text')}>
              <PlusIcon aria-hidden />
              {format(m.supplementAddText)}
            </Button>
          </div>
        </div>
      </div>
    </FormDialog>
  )
}
