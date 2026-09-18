import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import { Field, FormDialog } from '@qualy/ui/admin'
import { toast } from '@qualy/ui/toast'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'

// What a formula is called and what it is for.
//
// Both in one place, because they are one fact about the formula rather than
// two: a name nobody can explain and a description attached to nothing are
// each half an answer. Neither is part of the draft - changing them leaves no
// revision and publishes nothing - so this saves on its own the moment it is
// confirmed, and the editor's unsaved state stays about code and examples.

const styles = stylex.create({
  fields: { display: 'flex', flexDirection: 'column', gap: 14 },
  failure: { margin: 0, fontSize: 12, color: tokens.danger },
})

export function FormulaDetailsDialog({
  open,
  functionId,
  draftRevision,
  name,
  description,
  onClose,
  onSaved,
}: {
  readonly open: boolean
  readonly functionId: string
  /** the revision the page holds; the same guard every write to this formula takes */
  readonly draftRevision: number
  readonly name: string
  readonly description: string | null
  readonly onClose: () => void
  readonly onSaved: () => void
}) {
  const api = useApi(formulaApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [written, setWritten] = useState(name)
  const [about, setAbout] = useState(description ?? '')
  const [failure, setFailure] = useState<string | null>(null)

  // every opening starts from what the formula says now
  useEffect(() => {
    if (!open) return
    setWritten(name)
    setAbout(description ?? '')
    setFailure(null)
  }, [open, name, description])

  const save = useMutation({
    mutationFn: () =>
      run(
        api.assessmentFormula.updateFormulaDraft({
          params: { functionId },
          payload: {
            expectedDraftRevision: draftRevision,
            name: written.trim(),
            description: about.trim() === '' ? null : about.trim(),
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      toast.success(format(m.detailsSaved))
      onSaved()
      onClose()
    },
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  return (
    <FormDialog
      open={open}
      title={format(m.detailsTitle)}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button
            data-testid="formula-details-save"
            disabled={save.isPending || written.trim() === ''}
            onClick={() => save.mutate()}
          >
            {format(m.detailsSave)}
          </Button>
        </>
      }
    >
      <div data-testid="formula-details" {...stylex.props(styles.fields)}>
        <Field label={format(m.nameLabel)}>
          {(id) => (
            <Input
              id={id}
              value={written}
              maxLength={255}
              autoFocus
              onChange={(event) => setWritten(event.target.value)}
            />
          )}
        </Field>
        <Field label={format(m.descriptionLabel)} hint={format(m.descriptionHint)}>
          {(id) => (
            <Textarea
              id={id}
              value={about}
              rows={3}
              maxLength={2000}
              onChange={(event) => setAbout(event.target.value)}
            />
          )}
        </Field>
        {failure === null ? null : (
          <p role="alert" data-testid="formula-details-failure" {...stylex.props(styles.failure)}>
            {failure}
          </p>
        )}
      </div>
    </FormDialog>
  )
}
