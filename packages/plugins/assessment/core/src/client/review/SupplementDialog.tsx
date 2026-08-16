import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileIcon, PlusIcon, TypeIcon, XIcon } from 'lucide-react'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import { Textarea } from '@qualy/ui/textarea'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { entryRefusalMessage } from '../entry/refusals.ts'

// Asking for more backing without moving the round. The builder offers two
// shapes and only two - a written answer or files - so an ask can never grow
// into a second form the filing was not written under; anything richer than
// that is a rejection with a suggested version, which is the other door.

interface Piece {
  label: string
  kind: 'text' | 'file'
  required: boolean
}

export function SupplementDialog({
  open,
  instanceId,
  onClose,
  onDone,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  instanceId: string
  onClose: () => void
  onDone: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [instructions, setInstructions] = useState('')
  const [pieces, setPieces] = useState<readonly Piece[]>([
    { label: '', kind: 'file', required: true },
  ])
  const [problem, setProblem] = useState<string | null>(null)

  const send = useMutation({
    mutationFn: () =>
      run(
        api.assessment.requestSupplement({
          params: { instanceId },
          payload: {
            instructions: instructions.trim(),
            requirements: pieces.map((piece) => ({
              label: piece.label.trim(),
              kind: piece.kind,
              required: piece.required,
            })),
          },
        }),
      ),
    onMutate: () => setProblem(null),
    onSuccess: () => {
      toast.success(format(m.supplementSent))
      onDone()
    },
    onError: (error: unknown) => {
      const refusal = entryRefusalMessage(error)
      setProblem(refusal === null ? formatError(error) : format(refusal))
    },
  })

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
      open={open}
      title={format(m.supplementDialogTitle)}
      description={format(m.supplementDialogHint)}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={send.isPending || !ready} onClick={() => send.mutate()}>
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

        <Feedback message={problem} />
      </div>
    </FormDialog>
  )
}
