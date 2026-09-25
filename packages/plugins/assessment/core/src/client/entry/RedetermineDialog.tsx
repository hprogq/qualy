import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import type { AtomicSchema } from '@qualy/value-schema'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { usePickerWords } from '@qualy/web-i18n/picker-words'
import { ValueFieldsForm } from '@qualy/web-value-form/InputValueForm'
import { draftsFromFields, materializeFields, type FieldDraft } from '@qualy/web-value-form/model'
import { Feedback, Field, FormDialog, RadioGroup } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Textarea } from '@qualy/ui/textarea'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// Correcting a concluded claim, as the person holding that power answers it:
// the reviewer's own question - does it pass, and when it does, what is it
// recognised as - and why. Whether that corrects, revokes or overturns the
// result is the server's to say from where the claim stands; nobody picks
// it here.

const styles = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 16 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  warning: { margin: 0, fontSize: 13, color: tokens.warning },
})

export interface RedetermineInput {
  readonly decision: 'approve' | 'reject'
  readonly recognition?: { readonly values: Record<string, unknown> }
  readonly reason: string
}

export function RedetermineDialog({
  open,
  itemId,
  standing,
  running,
  busy,
  problem,
  onConfirm,
  onClose,
}: {
  open: boolean
  itemId: string
  /** where the claim stands now, and the determination it stands on */
  standing: { readonly status: string; readonly values: Record<string, unknown> | null }
  /** a round still contesting the claim, which confirming ends */
  running: boolean
  busy: boolean
  /** what the last attempt was refused for, in the reader's words */
  problem: string | null
  onConfirm: (input: RedetermineInput) => void
  onClose: () => void
}) {
  const { format, locale } = useI18n()
  const words = usePickerWords()
  const query = useApiQuery(assessmentApi)
  const contract = useQuery({
    ...query.assessment.getRecognitionContract.queryOptions({ params: { itemId } }),
    enabled: open,
    staleTime: 60_000,
  })
  const [decision, setDecision] = useState<'approve' | 'reject'>(
    standing.status === 'approved' ? 'approve' : 'reject',
  )
  const [reason, setReason] = useState('')
  const fields = useMemo(
    () =>
      (contract.data?.contract?.fields ?? []).map((field) => ({
        id: field.id,
        schema: field.schema as AtomicSchema,
      })),
    [contract.data],
  )
  // starts from what the claim stands recognised as, so a correction is a
  // change somebody made rather than a form somebody refilled
  const [drafts, setDrafts] = useState<Record<string, FieldDraft> | null>(null)
  const shown = drafts ?? draftsFromFields(fields, standing.values ?? {})
  const materialized = useMemo(() => materializeFields(fields, shown), [fields, shown])
  const recognitionReady = decision === 'reject' || materialized.value !== null
  const ready =
    reason.trim() !== '' && recognitionReady && (decision === 'reject' || !contract.isPending)

  return (
    <FormDialog
      open={open}
      title={format(m.staffRedetermineTitle)}
      description={format(m.staffRedetermineHint)}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button
            disabled={busy || !ready}
            onClick={() =>
              onConfirm({
                decision,
                reason: reason.trim(),
                ...(decision === 'approve' && materialized.value !== null
                  ? { recognition: { values: materialized.value } }
                  : {}),
              })
            }
          >
            {format(m.staffRedetermine)}
          </Button>
        </div>
      }
    >
      <div {...stylex.props(styles.body)} data-testid="redetermine-form" data-decision={decision}>
        <RadioGroup
          legend={format(m.staffRedetermineDecision)}
          name="redetermine-decision"
          variant="cards"
          selected={decision}
          onChange={(next) => setDecision(next === 'approve' ? 'approve' : 'reject')}
          options={[
            { value: 'approve', label: format(m.reviewApprove) },
            { value: 'reject', label: format(m.staffRedetermineReject) },
          ]}
        />
        {decision === 'approve' && fields.length > 0 && (
          <ValueFieldsForm
            words={words}
            fields={fields}
            drafts={shown}
            onDraft={(id, draft) => setDrafts({ ...shown, [id]: draft })}
            locale={locale}
            scope="redetermine"
          />
        )}
        <Field label={format(m.staffRedetermineReason)}>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        {running && (
          <p {...stylex.props(styles.warning)} data-testid="redetermine-ends-round">
            {format(m.staffRedetermineEndsRound)}
          </p>
        )}
        <Feedback message={problem} />
      </div>
    </FormDialog>
  )
}
