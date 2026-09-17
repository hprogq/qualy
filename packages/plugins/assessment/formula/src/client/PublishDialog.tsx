import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import { Field, FormDialog } from '@qualy/ui/admin'
import { formulaMessages as m } from './i18n.ts'
import { ToneDot, type Tone } from './WorkbenchLayout.tsx'

// Publishing the draft: naming what is about to be frozen, and seeing what it
// stands on before pressing the one button that cannot be taken back.
//
// The checks are the screen's own reading of the draft - saved or not, how its
// examples stand, whether it compiles and what its contract says. The server
// asks all of it again; this only lets the author see where it would stop.

export interface PublishCheck {
  readonly key: string
  readonly tone: Tone
  readonly words: string
}

const RELEASE_NAME_LIMIT = 100
const RELEASE_NOTES_LIMIT = 1000

const styles = stylex.create({
  checks: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    margin: 0,
    padding: 12,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
    listStyle: 'none',
  },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 },
  lasting: { margin: 0, fontSize: 12, lineHeight: 1.6, color: tokens.mutedForeground },
  failure: { margin: 0, fontSize: 13, color: tokens.danger },
})

export function PublishDialog({
  open,
  dirty,
  checks,
  pending,
  failure,
  nameProblem,
  onClose,
  onPublish,
}: {
  readonly open: boolean
  /** the draft holds edits that publishing will save first */
  readonly dirty: boolean
  readonly checks: readonly PublishCheck[]
  readonly pending: boolean
  readonly failure: string | null
  /** the words for what is wrong with the name, when the server said */
  readonly nameProblem: string | null
  readonly onClose: () => void
  readonly onPublish: (release: { name: string; notes: string }) => void
}) {
  const { format } = useI18n()
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  // every opening starts a new publication; a name typed for the last one is
  // not this one's
  useEffect(() => {
    if (!open) return
    setName('')
    setNotes('')
  }, [open])

  const ready = name.trim() !== '' && !pending
  return (
    <FormDialog
      open={open}
      title={format(m.publishTitle)}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {format(m.cancel)}
          </Button>
          <Button
            data-testid="formula-publish-confirm"
            disabled={!ready}
            onClick={() => onPublish({ name: name.trim(), notes: notes.trim() })}
          >
            {format(
              pending ? m.draftPublishing : dirty ? m.publishSaveAndConfirm : m.publishConfirm,
            )}
          </Button>
        </>
      }
    >
      <Field label={format(m.releaseNameLabel)} required>
        {(id) => (
          <Input
            id={id}
            value={name}
            maxLength={RELEASE_NAME_LIMIT}
            placeholder={format(m.releaseNamePlaceholder)}
            aria-invalid={nameProblem !== null}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      {nameProblem === null ? null : (
        <p role="alert" {...stylex.props(styles.failure)}>
          {nameProblem}
        </p>
      )}
      <Field label={format(m.releaseNotesLabel)}>
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
      <ul data-testid="formula-publish-checks" {...stylex.props(styles.checks)}>
        {checks.map((check) => (
          <li
            key={check.key}
            data-check={check.key}
            data-tone={check.tone}
            {...stylex.props(styles.check)}
          >
            <ToneDot tone={check.tone} />
            {check.words}
          </li>
        ))}
      </ul>
      <p {...stylex.props(styles.lasting)}>{format(m.publishLasting)}</p>
      {failure === null ? null : (
        <p role="alert" {...stylex.props(styles.failure)}>
          {failure}
        </p>
      )}
    </FormDialog>
  )
}
