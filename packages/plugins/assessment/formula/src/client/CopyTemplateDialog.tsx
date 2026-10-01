import { assertNever } from '@qualy/web-i18n'
import { useApiMutation, useApi, useApiQuery } from '@qualy/web-runtime'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import { Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { formulaApi } from './api.ts'
import * as m from '#messages'

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
  const query = useApiQuery(formulaApi)
  const queryClient = useQueryClient()

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

  const copy = useApiMutation({
    mutationFn: () =>
      api.assessmentFormula.copyFormulaTemplate({
        params: { versionId: versionId ?? '' },
        payload: {
          name: name.trim(),
          ...(description.trim() === '' ? {} : { description: description.trim() }),
        },
      }),
    onMutate: () => setFailure(null),
    onSuccess: async (result: { function: { id: string } }) => {
      await queryClient.invalidateQueries({ queryKey: query.assessmentFormula.key() })
      onCopied(result.function.id)
    },
    onError: (error) => {
      switch (error._tag) {
        case 'ASSESSMENT_FORMULA_AUTHORING_BUSY':
          setFailure(m.error_authoringBusy())
          return
        case 'ASSESSMENT_FORMULA_SOURCE_TOO_LARGE':
          setFailure(m.error_sourceTooLarge())
          return
        case 'ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND':
          setFailure(m.error_templateNotFound())
          return
        default:
          assertNever(error)
      }
    },
  })

  return (
    <FormDialog
      open={versionId !== null}
      title={m.templates_copyTitle()}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {m.common_cancel()}
          </Button>
          <Button
            disabled={name.trim() === '' || copy.isPending}
            onClick={() => copy.mutate()}
            data-testid="template-copy-confirm"
          >
            {m.templates_copy()}
          </Button>
        </>
      }
    >
      <Field label={m.field_name()} required>
        {(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />}
      </Field>
      <Field label={m.field_description()}>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        )}
      </Field>
      {/* the same refusal every form in the product says under its fields */}
      <Feedback message={failure} />
    </FormDialog>
  )
}
