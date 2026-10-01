import { assertNever } from '@qualy/web-i18n'
import { useApiMutation, useApi } from '@qualy/web-runtime'

import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import { Field, FormDialog } from '@qualy/ui/admin'
import { toast } from '@qualy/ui/toast'
import { formulaApi } from './api.ts'
import * as m from '#messages'

// What a publication is called, and why it was made - after the fact.
//
// These two are a label on a frozen record rather than part of it: the code,
// the examples, the contract and the artifact stay exactly as they were
// proven, and so do the number, the instant and the publisher. Nothing is
// published here, which is why the dialog says so rather than warning: the
// thing people fear when they are told a version is immutable is that they
// are about to change what somebody was scored under, and they are not.

export const RELEASE_NAME_LIMIT = 100
export const RELEASE_NOTES_LIMIT = 1000

const styles = stylex.create({
  // the dialog's body spaces its own children; a group inside it has to
  // say the same spacing again, or the fields land against each other
  fields: { display: 'flex', flexDirection: 'column', gap: 14 },
  says: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  failure: { margin: 0, fontSize: 12, color: tokens.danger },
})

export function VersionInfoDialog({
  open,
  functionId,
  version,
  onClose,
  onSaved,
}: {
  readonly open: boolean
  readonly functionId: string
  readonly version: {
    readonly versionNo: number
    readonly releaseName: string | null
    readonly releaseNotes: string | null
    /** what the label read as when this screen took it; a stale one is refused */
    readonly metadataRevision: number
  } | null
  readonly onClose: () => void
  readonly onSaved: () => void
}) {
  const api = useApi(formulaApi)

  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  // every opening starts from what the publication says now
  useEffect(() => {
    if (!open || version === null) return
    setName(version.releaseName ?? '')
    setNotes(version.releaseNotes ?? '')
    setFailure(null)
  }, [open, version])

  const save = useApiMutation({
    mutationFn: () => {
      if (version === null) throw new Error('no version to relabel')
      return api.assessmentFormula.updateFormulaVersionInfo({
        params: { functionId, versionNo: String(version.versionNo) },
        payload: {
          expectedMetadataRevision: version.metadataRevision,
          releaseName: name.trim(),
          releaseNotes: notes.trim() === '' ? null : notes.trim(),
        },
      })
    },
    onMutate: () => setFailure(null),
    onSuccess: () => {
      toast.success(m.release_infoSaved())
      onSaved()
      onClose()
    },
    onError: (error) => {
      switch (error._tag) {
        case 'ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND':
          setFailure(m.error_functionNotFound())
          return
        case 'ASSESSMENT_FORMULA_RELEASE_NAME_TAKEN':
          setFailure(m.error_releaseNameTaken())
          return
        case 'ASSESSMENT_FORMULA_VERSION_INFO_CONFLICT':
          setFailure(m.error_versionInfoConflict())
          return
        case 'ASSESSMENT_FORMULA_VERSION_NOT_FOUND':
          setFailure(m.error_versionNotFound())
          return
        default:
          assertNever(error)
      }
    },
  })

  return (
    <FormDialog
      open={open && version !== null}
      title={m.release_infoTitle()}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {m.common_cancel()}
          </Button>
          <Button
            data-testid="formula-version-info-save"
            disabled={save.isPending || name.trim() === ''}
            onClick={() => save.mutate()}
          >
            {m.editor_save()}
          </Button>
        </>
      }
    >
      <div data-testid="formula-version-info" {...stylex.props(styles.fields)}>
        <Field label={m.publish_name()} required>
          {(id) => (
            <Input
              id={id}
              value={name}
              maxLength={RELEASE_NAME_LIMIT}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label={m.publish_notes()}>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={notes}
              maxLength={RELEASE_NOTES_LIMIT}
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>
        <p {...stylex.props(styles.says)}>{m.release_infoScope()}</p>
        {failure === null ? null : (
          <p
            role="alert"
            data-testid="formula-version-info-failure"
            {...stylex.props(styles.failure)}
          >
            {failure}
          </p>
        )}
      </div>
    </FormDialog>
  )
}
