import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Field } from '@qualy/ui/admin'
import { NativeSelect } from '@qualy/ui/native-select'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import type { ItemDto } from '../entry/model.ts'
import { AdministrativeRecordForm, type RecognitionWire } from './AdministrativeRecordForm.tsx'
import { ParticipantPicker, type PickedParticipant } from './ParticipantPicker.tsx'

// Writing one administrative fact: which question, about whom, and what the
// office determines by recording it.
//
// The roster is not loaded here. It is walked by cursor and searched in sql
// by the picker, because the first page of a large round is not the round.

const styles = stylex.create({
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  waiting: { height: 160, width: '100%' },
  form: { display: 'flex', maxWidth: '36rem', flexDirection: 'column', gap: 16 },
})

export function ManualRecordView({
  batchId,
  materialRange,
}: {
  batchId: string
  materialRange: { start: string; end: string }
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const [itemId, setItemId] = useState('')
  const [participant, setParticipant] = useState<PickedParticipant | null>(null)
  // bumped on every successful record: the same question and the same
  // person again is a NEW sheet, never leftovers from the one just filed
  const [attempt, setAttempt] = useState(0)
  const contract = useQuery({
    ...query.assessment.getRecognitionContract.queryOptions({ params: { itemId } }),
    enabled: itemId !== '',
  })
  const wire = (contract.data?.contract ?? null) as RecognitionWire | null

  const administrative = ((items.data?.items ?? []) as readonly ItemDto[]).filter(
    (item) => item.status === 'active' && item.currentRevision?.entrySource === 'administrative',
  )
  const item = administrative.find((candidate) => candidate.id === itemId) ?? null
  // Everything typed here is ABOUT one question version, one person, one
  // filing. Remounting the sheet on any part of that identity is the whole
  // reset: evidence payload, basis, recognition drafts, dirty marks and the
  // evidence form's own local drafts all go together - a sheet half-filled
  // for one student must never be filable against another.
  const session = `${item?.currentRevision?.id ?? 'no-revision'}:${participant?.id ?? ''}:${attempt}`

  return (
    <AsyncSection
      pending={items.isPending}
      error={items.error ? formatError(items.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void items.refetch()}
      skeleton={<Skeleton className={stylex.props(styles.waiting).className} />}
    >
      {administrative.length === 0 ? (
        <p {...stylex.props(styles.quiet)}>{format(m.recordEmpty)}</p>
      ) : (
        <div {...stylex.props(styles.form)}>
          <Field label={format(m.recordItem)}>
            {(id) => (
              <NativeSelect
                id={id}
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
              >
                <option value="" />
                {administrative.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={format(m.recordWho)}>
            {(id) => (
              <ParticipantPicker
                id={id}
                batchId={batchId}
                value={participant}
                onChange={setParticipant}
                label={format(m.recordWho)}
              />
            )}
          </Field>
          {item !== null && (
            <AdministrativeRecordForm
              key={session}
              session={session}
              batchId={batchId}
              materialRange={materialRange}
              item={item}
              participantId={participant?.id ?? ''}
              wire={wire}
              onRecorded={() => {
                setParticipant(null)
                setAttempt((count) => count + 1)
              }}
            />
          )}
        </div>
      )}
    </AsyncSection>
  )
}
