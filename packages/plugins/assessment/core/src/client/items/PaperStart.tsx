import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { useLingering } from '@qualy/ui/use-lingering'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

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

export function PaperStart({ batchId, onCreated }: { batchId: string; onCreated: () => void }) {
  const { format } = useI18n()
  const [wizard, setWizard] = useState(false)
  const [blank, setBlank] = useState(false)
  const opened = useLingering(wizard ? 'guided' : blank ? 'blank' : null)

  return (
    <div {...stylex.props(styles.screen)}>
      <div {...stylex.props(styles.words)}>
        <h3 {...stylex.props(styles.title)}>{format(m.paperStartTitle)}</h3>
        <p {...stylex.props(styles.hint)}>{format(m.paperStartHint)}</p>
      </div>

      <div {...stylex.props(styles.cardRow)}>
        {/* the suggested route carries the darker edge and the filled button;
            two identical cards make the reader choose before they know what
            either one does */}
        <div {...stylex.props(styles.card, styles.cardSuggested)}>
          <p {...stylex.props(styles.cardTitleRow)}>
            <span {...stylex.props(styles.cardTitle)}>{format(m.paperStartGuided)}</span>
            <Badge>{format(m.paperStartSuggested)}</Badge>
          </p>
          <p {...stylex.props(styles.cardHint)}>{format(m.paperStartGuidedHint)}</p>
          <Button
            className={stylex.props(styles.fullWidth).className}
            onClick={() => setWizard(true)}
          >
            {format(m.paperStartAction)}
          </Button>
        </div>

        <div {...stylex.props(styles.card)}>
          <p {...stylex.props(styles.cardTitle)}>{format(m.paperStartBlank)}</p>
          <p {...stylex.props(styles.cardHint)}>{format(m.paperStartBlankHint)}</p>
          <Button
            variant="outline"
            className={stylex.props(styles.fullWidth).className}
            onClick={() => setBlank(true)}
          >
            {format(m.itemsGroupNew)}
          </Button>
        </div>
      </div>

      {/* kept mounted while it shuts, or it would vanish rather than close */}
      {opened !== null && (
        <PaperWizard
          open={wizard || blank}
          batchId={batchId}
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
  capped,
  onClose,
  onCreated,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  batchId: string
  capped: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [name, setName] = useState(format(m.paperDefaultName))
  const [cap, setCap] = useState(capped ? '100.00' : '')

  const create = useMutation({
    mutationFn: () =>
      run(
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
            expectedVersion: 1,
          },
        }),
      ),
    onSuccess: () => {
      onCreated()
      onClose()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  return (
    <FormDialog
      open={open}
      title={format(m.paperCreateTitle)}
      description={format(m.paperCreateHint)}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={create.isPending || name.trim() === ''} onClick={() => create.mutate()}>
            {format(m.paperCreate)}
          </Button>
        </div>
      }
    >
      <div {...stylex.props(styles.wizardFields)}>
        <Field label={format(m.itemsGroupName)}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label={format(m.paperTotal)} hint={format(m.paperTotalHint)}>
          {(id) => <Input id={id} value={cap} onChange={(event) => setCap(event.target.value)} />}
        </Field>
      </div>
    </FormDialog>
  )
}
