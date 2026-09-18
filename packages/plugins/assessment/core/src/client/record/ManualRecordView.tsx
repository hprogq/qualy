import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { administrativeItemsOf, type ItemDto } from '../entry/model.ts'
import { RecordSteps, type RecognitionWire } from './RecordSteps.tsx'
import { ItemPicker } from './ItemPicker.tsx'
import {
  NoAdministrativeItems,
  Wizard,
  WizardBody,
  WizardFoot,
  WizardRail,
} from './wizard.tsx'

// Writing one administrative fact: which question, about whom, and what the
// office determines by recording it.
//
// Three moves. Which question comes first and on its own, because it decides
// what the rest even is - the fields, the determination, the limits. Then
// the finding itself. Then it is read back, because it takes effect the
// moment it is filed and there is no reviewer downstream to catch anything.
//
// The roster is not loaded here. It is walked by cursor and searched in sql
// by the picker, because the first page of a large round is not the round.

const styles = stylex.create({
  // the errand is as tall as the panel that holds it, whichever branch is
  // showing: the rail and the keys are pinned and only the middle scrolls
  fill: { display: 'flex', minHeight: 0, minWidth: 0, flexGrow: 1, flexDirection: 'column' },
})

export function ManualRecordView({
  batchId,
  materialRange,
  onDone,
}: {
  batchId: string
  materialRange: { start: string; end: string }
  /** the errand is over; whoever opened it decides what that means */
  onDone?: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const [itemId, setItemId] = useState('')
  const [at, setAt] = useState(0)
  // bumped on every successful record: the same question again is a NEW
  // sheet, never leftovers from the one just filed
  const [attempt, setAttempt] = useState(0)
  const contract = useQuery({
    ...query.assessment.getRecognitionContract.queryOptions({ params: { itemId } }),
    enabled: itemId !== '',
  })
  const wire = (contract.data?.contract ?? null) as RecognitionWire | null

  const administrative = administrativeItemsOf((items.data?.items ?? []) as readonly ItemDto[])
  const item = administrative.find((candidate) => candidate.id === itemId) ?? null
  // Everything filled in is ABOUT one question version and one filing.
  // Remounting on either is the whole reset: evidence payload, basis,
  // recognition drafts, dirty marks and the evidence form's own local drafts
  // all go together, so a sheet half-filled for one question can never be
  // filed against another.
  const session = `${item?.currentRevision?.id ?? 'no-revision'}:${attempt}`

  const steps = [
    format(m.recordStepItem),
    format(m.recordStepFill),
    format(m.recordStepConfirm),
  ]

  return (
    <AsyncSection
      pending={items.isPending}
      error={items.error ? formatError(items.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void items.refetch()}
      xstyle={styles.fill}
    >
      {administrative.length === 0 ? (
        <NoAdministrativeItems />
      ) : (
        <Wizard testId="manual-record">
          <WizardRail steps={steps} at={at} onGo={setAt} />
          {at === 0 || item === null ? (
            <>
              <WizardBody>
                <ItemPicker
                  batchId={batchId}
                  items={administrative}
                  value={itemId}
                  onPick={setItemId}
                />
              </WizardBody>
              <WizardFoot>
                <Button
                  disabled={item === null}
                  onClick={() => setAt(1)}
                  data-testid="record-step-next"
                >
                  {format(m.recordStepNext)}
                </Button>
              </WizardFoot>
            </>
          ) : (
            <RecordSteps
              key={session}
              at={at}
              session={session}
              batchId={batchId}
              materialRange={materialRange}
              item={item}
              wire={wire}
              onGo={setAt}
              onRecorded={() => {
                setAttempt((count) => count + 1)
                setAt(0)
                onDone?.()
              }}
            />
          )}
        </Wizard>
      )}
    </AsyncSection>
  )
}
