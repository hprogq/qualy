import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import { Field, FormDialog } from '@qualy/ui/admin'

import { ToneDot, type Tone } from './WorkbenchLayout.tsx'
import * as m from '#messages'

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
      title={m.publish_title()}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {m.common_cancel()}
          </Button>
          <Button
            data-testid="formula-publish-confirm"
            disabled={!ready}
            onClick={() => onPublish({ name: name.trim(), notes: notes.trim() })}
          >
            {(pending
              ? m.editor_draftPublishing
              : dirty
                ? m.publish_saveAndConfirm
                : m.publish_confirm)()}
          </Button>
        </>
      }
    >
      <Field label={m.publish_name()} required error={nameProblem}>
        {(id, control) => (
          <Input
            id={id}
            {...control}
            value={name}
            maxLength={RELEASE_NAME_LIMIT}
            placeholder={m.publish_namePlaceholder()}
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
      <p {...stylex.props(styles.lasting)}>{m.publish_lasting()}</p>
      {failure === null ? null : (
        <p role="alert" {...stylex.props(styles.failure)}>
          {failure}
        </p>
      )}
    </FormDialog>
  )
}
