import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Field } from '@qualy/ui/admin'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { administrativeItemsOf, type ItemDto } from '../entry/model.ts'
import { AdministrativeRecordForm, type RecognitionWire } from './AdministrativeRecordForm.tsx'
import { RecordTargets, type RecordTarget } from './RecordTargets.tsx'
import { ChosenItem, ItemPicker } from './ItemPicker.tsx'
import {
  NoAdministrativeItems,
  RecordColumn,
  RecordSheet,
  SheetBlock,
  SheetLead,
  SheetNotice,
} from './sheet.tsx'

// Writing one administrative fact: which question, about whom, and what the
// office determines by recording it.
//
// What it takes to do that is said before the first field rather than in a
// confirmation afterwards, because by then the reader has already typed
// everything and the only honest answer left is "are you sure".
//
// Which question is asked first and on its own, because it decides what the
// rest of the sheet even is: the fields, the determination, the limits. A
// screen that opened on an empty dropdown and then sprouted a form once it
// was answered was showing the reader nothing, then everything.
//
// The roster is not loaded here. It is walked by cursor and searched in sql
// by the picker, because the first page of a large round is not the round.

const styles = stylex.create({
  waiting: { height: 160, width: '100%' },
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
  const [target, setTarget] = useState<RecordTarget | null>(null)
  // bumped on every successful record: the same question and the same
  // person again is a NEW sheet, never leftovers from the one just filed
  const [attempt, setAttempt] = useState(0)
  const contract = useQuery({
    ...query.assessment.getRecognitionContract.queryOptions({ params: { itemId } }),
    enabled: itemId !== '',
  })
  const wire = (contract.data?.contract ?? null) as RecognitionWire | null

  const administrative = administrativeItemsOf((items.data?.items ?? []) as readonly ItemDto[])
  const item = administrative.find((candidate) => candidate.id === itemId) ?? null
  // Everything typed here is ABOUT one question version, one person, one
  // filing. Remounting the sheet on any part of that identity is the whole
  // reset: evidence payload, basis, recognition drafts, dirty marks and the
  // evidence form's own local drafts all go together - a sheet half-filled
  // for one student must never be filable against another.
  // Everything typed here is ABOUT one question version, one set of people,
  // one filing. Remounting on any part of that identity is the whole reset.
  const who =
    target === null
      ? ''
      : target.kind === 'people'
        ? [...target.participantIds].sort().join(',')
        : [...target.orgNodeIds].sort().join(',')
  const session = `${item?.currentRevision?.id ?? 'no-revision'}:${who}:${attempt}`

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
        <NoAdministrativeItems />
      ) : (
        <RecordColumn testId="manual-record">
          <SheetNotice>{format(m.recordEffectNotice)}</SheetNotice>
          {item === null ? (
            <>
              <SheetLead>{format(m.recordItemPick)}</SheetLead>
              <ItemPicker batchId={batchId} items={administrative} onPick={setItemId} />
            </>
          ) : (
            <>
              <ChosenItem
                item={item}
                onChange={() => {
                  // another question is another sheet; nothing typed for
                  // this one may follow it there
                  setItemId('')
                  setTarget(null)
                }}
              />
              <RecordSheet>
                <SheetBlock>
                  <Field label={format(m.recordTargets)} hideLabel>
                    {() => <RecordTargets batchId={batchId} value={target} onChange={setTarget} />}
                  </Field>
                </SheetBlock>
                <AdministrativeRecordForm
                  key={session}
                  session={session}
                  batchId={batchId}
                  materialRange={materialRange}
                  item={item}
                  target={target}
                  wire={wire}
                  onRecorded={() => {
                    setTarget(null)
                    setAttempt((count) => count + 1)
                  }}
                />
              </RecordSheet>
            </>
          )}
        </RecordColumn>
      )}
    </AsyncSection>
  )
}
