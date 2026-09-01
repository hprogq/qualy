import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import { Field, FormDialog } from '@qualy/ui/admin'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'

// Starting your own formula from somebody else's.
//
// The name is the reader's to choose, prefilled from the source rather than
// invented by the server: what they are about to own should be called what
// they mean to call it, and "copy of" is a word nobody asked for.

export function CopyTemplateDialog({
  versionId,
  suggestedName,
  suggestedDescription,
  onClose,
  onCopied,
}: {
  readonly versionId: string | null
  readonly suggestedName: string
  readonly suggestedDescription?: string | null
  readonly onClose: () => void
  readonly onCopied: (functionId: string) => void
}) {
  const api = useApi(formulaApi)
  const run = useRunApi()
  const query = useApiQuery(formulaApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [name, setName] = useState(suggestedName)
  const [description, setDescription] = useState(suggestedDescription ?? '')
  const [failure, setFailure] = useState<string | null>(null)

  // the dialog opens on a row, so what it offers has to be that row's
  useEffect(() => {
    if (versionId === null) return
    setName(suggestedName)
    setDescription(suggestedDescription ?? '')
    setFailure(null)
  }, [versionId, suggestedName, suggestedDescription])

  const copy = useMutation({
    mutationFn: () =>
      run(
        api.assessmentFormula.copyFormulaTemplate({
          params: { versionId: versionId ?? '' },
          payload: {
            name: name.trim(),
            ...(description.trim() === '' ? {} : { description: description.trim() }),
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async (result: { function: { id: string } }) => {
      await queryClient.invalidateQueries({ queryKey: query.assessmentFormula.key() })
      onCopied(result.function.id)
    },
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  return (
    <FormDialog
      open={versionId !== null}
      title={format(m.templatesCopyTitle)}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button
            disabled={name.trim() === '' || copy.isPending}
            onClick={() => copy.mutate()}
            data-testid="template-copy-confirm"
          >
            {format(m.templatesCopy)}
          </Button>
        </>
      }
    >
      <Field label={format(m.nameLabel)} required>
        {(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />}
      </Field>
      <Field label={format(m.descriptionLabel)}>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        )}
      </Field>
      {failure === null ? null : <p role="alert">{failure}</p>}
    </FormDialog>
  )
}
