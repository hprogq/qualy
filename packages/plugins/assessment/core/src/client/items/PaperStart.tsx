import { assertNever } from '@qualy/web-i18n'
import { useApiMutation, useApi } from '@qualy/web-runtime'
import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { useLingering } from '@qualy/ui/use-lingering'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// A round with no paper yet.
//
// The paper is the outermost group: everything a round asks sits inside it,
// and its ceiling is what the whole round is worth. Until it exists there is
// nothing to arrange, so this screen is about starting one rather than an
// empty list with an add button somewhere in it.

const styles = stylex.create({
  screen: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingBlock: 64,
  },
  words: {
    display: 'flex',
    maxWidth: 560,
    flexDirection: 'column',
    gap: 8,
    textAlign: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
  },
  hint: {
    fontSize: 14,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
  cardRow: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
  },
  card: {
    display: 'flex',
    width: 296,
    flexDirection: 'column',
    gap: 12,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 16,
  },
  cardSuggested: {
    borderColor: `color-mix(in oklab, ${tokens.foreground} 20%, transparent)`,
    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  },
  cardTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  cardHint: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    fontSize: 14,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  fullWidth: {
    width: '100%',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  wizardFields: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
})

export function PaperStart({
  batchId,
  version,
  onCreated,
}: {
  batchId: string
  /**
   * The score groups' version as this screen last read it.
   *
   * Not 1. A round whose paper was set up and then removed is on its second
   * version or later, and writing the first one back is a conflict every
   * time - which left the only door to a paper permanently shut.
   */
  version: number
  onCreated: () => void
}) {
  const [wizard, setWizard] = useState(false)
  const [blank, setBlank] = useState(false)
  const opened = useLingering(wizard ? 'guided' : blank ? 'blank' : null)

  return (
    <div {...stylex.props(styles.screen)}>
      <div {...stylex.props(styles.words)}>
        <h3 {...stylex.props(styles.title)}>{m.items_paperStartTitle()}</h3>
        <p {...stylex.props(styles.hint)}>{m.items_paperStartHint()}</p>
      </div>

      <div {...stylex.props(styles.cardRow)}>
        {/* the suggested route carries the darker edge and the filled button;
            two identical cards make the reader choose before they know what
            either one does */}
        <div {...stylex.props(styles.card, styles.cardSuggested)}>
          <p {...stylex.props(styles.cardTitleRow)}>
            <span {...stylex.props(styles.cardTitle)}>{m.items_paperStartGuided()}</span>
            <Badge>{m.items_paperStartSuggested()}</Badge>
          </p>
          <p {...stylex.props(styles.cardHint)}>{m.items_paperStartGuidedHint()}</p>
          <Button
            className={stylex.props(styles.fullWidth).className}
            onClick={() => setWizard(true)}
          >
            {m.items_paperStartAction()}
          </Button>
        </div>

        <div {...stylex.props(styles.card)}>
          <p {...stylex.props(styles.cardTitle)}>{m.items_paperStartBlank()}</p>
          <p {...stylex.props(styles.cardHint)}>{m.items_paperStartBlankHint()}</p>
          <Button
            variant="outline"
            className={stylex.props(styles.fullWidth).className}
            onClick={() => setBlank(true)}
          >
            {m.items_groupNew()}
          </Button>
        </div>
      </div>

      {/* kept mounted while it shuts, or it would vanish rather than close */}
      {opened !== null && (
        <PaperWizard
          open={wizard || blank}
          batchId={batchId}
          version={version}
          /* the blank route asks the same two things and simply leaves the
             ceiling empty; a second dialog for that would be a second answer
             to one question */
          capped={opened === 'guided'}
          onClose={() => {
            setWizard(false)
            setBlank(false)
          }}
          onCreated={onCreated}
        />
      )}
    </div>
  )
}

function PaperWizard({
  open,
  batchId,
  version,
  capped,
  onClose,
  onCreated,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  batchId: string
  version: number
  capped: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const api = useApi(assessmentApi)

  const [name, setName] = useState(m.items_paperDefaultName())
  const [cap, setCap] = useState(capped ? '100.00' : '')

  const create = useApiMutation({
    mutationFn: () =>
      api.assessment.replaceScoreGroups({
        params: { batchId },
        payload: {
          groups: [
            {
              parentGroupId: null,
              name: name.trim(),
              cap: cap.trim() === '' ? null : cap.trim(),
              floor: null,
            },
          ],
          expectedVersion: version,
        },
      }),
    onSuccess: () => {
      onCreated()
      onClose()
    },
    onError: (error) => {
      switch (error._tag) {
        case 'ASSESSMENT_BATCH_NOT_FOUND':
          toast.error(m.error_batchNotFound())
          return
        case 'ASSESSMENT_BATCH_READ_ONLY':
          toast.error(m.error_batchReadOnly())
          return
        case 'ASSESSMENT_SCORE_GROUP_INVALID':
          toast.error(m.error_scoreGroupInvalid())
          return
        case 'ASSESSMENT_SCORE_GROUP_VERSION_CONFLICT':
          toast.error(m.error_scoreGroupVersionConflict())
          return
        default:
          assertNever(error)
      }
    },
  })

  return (
    <FormDialog
      open={open}
      title={m.items_paperCreateTitle()}
      description={m.items_paperCreateHint()}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {commonMessages.action_cancel()}
          </Button>
          <Button disabled={create.isPending || name.trim() === ''} onClick={() => create.mutate()}>
            {m.items_paperCreate()}
          </Button>
        </div>
      }
    >
      <div {...stylex.props(styles.wizardFields)}>
        <Field label={m.items_groupName()} required>
          {(id, control) => (
            <Input
              id={id}
              {...control}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label={m.items_paperTotal()} hint={m.items_paperTotalHint()}>
          {(id) => <Input id={id} value={cap} onChange={(event) => setCap(event.target.value)} />}
        </Field>
      </div>
    </FormDialog>
  )
}
