import { assertNever, formatPlatformFailure as formatError, useLocale } from '@qualy/web-i18n'

import { useApiMutation, useApi, useApiQuery } from '@qualy/web-runtime'
import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2Icon, NetworkIcon, UserRoundXIcon } from 'lucide-react'

import { useIsMobile } from '@qualy/ui/use-mobile'

import { dayAfter } from './entry/model.ts'
import { CheckboxGroup, Feedback, Field, FormDialog, SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { DateRangePicker } from '@qualy/ui/date-range-picker'
import { FieldGroup } from '@qualy/ui/field'
import { Input } from '@qualy/ui/input'
import { Skeleton } from '@qualy/ui/skeleton'
import { Steps } from '@qualy/ui/steps'
import { TreeSelect } from '@qualy/ui/tree-select'

import { assessmentApi } from './api.ts'
import { DialogBlank } from './DialogBlank.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// Creating a batch, one decision at a time: what it is, then who it covers.
//
// Two steps rather than one long form, and the units are chosen in place - a
// picker that opens its own dialog on top of this one buries the thing being
// decided. The options come from this domain's own endpoints, so an
// administrator needs assessment permissions and nothing else.
//
// Nothing here needs a wide screen - a name, a pair of dates, a tree and a
// set of checkboxes - so on a phone it is the same four answers in a panel
// that takes the whole screen, rather than a centred box with the page
// showing round its edges.
const styles = stylex.create({
  scopeTreeFrame: {
    maxHeight: 256,
    overflowY: 'auto',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 8,
  },
  // about the height of a few units and of a row of kinds, so the step
  // does not jump when they land
  waitingTree: { height: 96, width: '100%' },
  waitingKinds: { height: 56, width: '100%' },
})

export function NewBatchDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (batchId: string) => void
}) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()

  const locale = useLocale()

  // asked for when the form is opened, not when the page behind it loads: a
  // reader with no authority to start a round would otherwise be refused twice
  // on arrival, for options they never asked to see
  const nodes = useQuery({ ...query.assessment.listScopeOptions.queryOptions({}), enabled: open })
  const userTypes = useQuery({
    ...query.assessment.listUserTypeOptions.queryOptions({}),
    enabled: open,
  })

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [range, setRange] = useState({ start: '', end: '' })
  const [scopeNodeIds, setScopeNodeIds] = useState<string[]>([])
  const [userTypeIds, setUserTypeIds] = useState<string[]>([])
  const [failure, setFailure] = useState<string | null>(null)

  const reset = () => {
    setStep(0)
    setName('')
    setRange({ start: '', end: '' })
    setScopeNodeIds([])
    setUserTypeIds([])
    setFailure(null)
  }

  const create = useApiMutation({
    mutationFn: () =>
      api.assessment.createBatch({
        payload: {
          name,
          // the picker hands back the last day chosen; the window is
          // stored with its end outside it, so that day has to become the
          // day after or material dated on it is refused
          materialRange: { start: range.start, end: dayAfter(range.end) },
          import: { orgNodeIds: scopeNodeIds, userTypeIds },
        },
      }),
    onMutate: () => setFailure(null),
    onSuccess: async (result: { batch: { id: string } }) => {
      toast.success(m.toast_batchCreated())
      reset()
      await queryClient.invalidateQueries({ queryKey: query.assessment.key() })
      onCreated(result.batch.id)
    },
    onError: (error) => {
      switch (error._tag) {
        case 'ASSESSMENT_BATCH_REFERENCE_INVALID':
          setFailure(m.error_batchReferenceInvalid())
          return
        default:
          assertNever(error._tag)
      }
    },
  })

  // A batch is created with the people it covers, chosen from the units this
  // reader manages and the kinds of people enabled. With no unit, or no kind,
  // nothing typed here can come to a batch, so the dialog says which before
  // the first field rather than after the second step.
  const stuck =
    nodes.data !== undefined && nodes.data.nodes.length === 0
      ? 'no-units'
      : userTypes.data !== undefined && userTypes.data.userTypes.length === 0
        ? 'no-types'
        : null
  const nowhere = stuck !== null
  const optionsFailed = nodes.isError || userTypes.isError

  const basicsReady = name.trim() !== '' && range.start !== '' && range.end !== ''
  const scopeReady = scopeNodeIds.length > 0 && userTypeIds.length > 0

  const close = () => {
    reset()
    onClose()
  }

  const narrow = useIsMobile()

  const footer = nowhere ? (
    <Button variant="outline" onClick={close}>
      {commonMessages.action_close()}
    </Button>
  ) : (
    <>
      {step === 0 ? (
        <Button variant="outline" onClick={close}>
          {m.action_cancel()}
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setStep(0)}>
          {m.action_back()}
        </Button>
      )}
      {step === 0 ? (
        <Button disabled={!basicsReady} onClick={() => setStep(1)}>
          {m.action_next()}
        </Button>
      ) : (
        <Button disabled={create.isPending || !scopeReady} onClick={() => create.mutate()}>
          {m.action_create()}
        </Button>
      )}
    </>
  )

  const body =
    stuck === 'no-units' ? (
      <DialogBlank
        testId="new-batch-stuck"
        kind={stuck}
        icon={<Building2Icon />}
        title={m.batch_newNoUnits()}
        description={m.batch_newNoUnitsHint()}
      />
    ) : stuck === 'no-types' ? (
      <DialogBlank
        testId="new-batch-stuck"
        kind={stuck}
        icon={<UserRoundXIcon />}
        title={m.batch_newNoTypes()}
        description={m.batch_newNoTypesHint()}
      />
    ) : (
      <>
        <Steps steps={[m.batch_stepBasics(), m.batch_stepScope()]} current={step} />
        <Feedback message={failure} />

        {step === 1 && optionsFailed ? (
          // the units or the kinds of people could not be read: said, with the
          // way to ask again, rather than an empty tree that reads as "none"
          <DialogBlank
            testId="new-batch-stuck"
            kind="failed"
            icon={<NetworkIcon />}
            title={m.batch_newOptionsFailed()}
            description={formatError(nodes.error ?? userTypes.error)}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void nodes.refetch()
                  void userTypes.refetch()
                }}
              >
                {commonMessages.action_retry()}
              </Button>
            }
          />
        ) : step === 0 ? (
          <FieldGroup>
            <Field label={m.batch_name()} required>
              {(id, control) => (
                <Input
                  id={id}
                  {...control}
                  value={name}
                  placeholder={m.batch_namePlaceholder()}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>
            <Field label={m.batch_materialRange()} required>
              {(id) => (
                <DateRangePicker
                  id={id}
                  value={range}
                  onChange={setRange}
                  placeholder={m.action_pickDateRange()}
                  localeTag={locale}
                  monthLabel={commonMessages.calendar_month()}
                  yearLabel={commonMessages.calendar_year()}
                />
              )}
            </Field>
          </FieldGroup>
        ) : (
          // The choices wait in their own places while they arrive: an empty
          // tree drawn meanwhile says "there are none", which is not yet known.
          <FieldGroup>
            <Field label={m.batch_scope()} required>
              {() =>
                nodes.data === undefined ? (
                  <div
                    role="status"
                    aria-label={commonMessages.state_loading()}
                    data-testid="new-batch-waiting"
                    {...stylex.props(styles.scopeTreeFrame)}
                  >
                    <Skeleton className={stylex.props(styles.waitingTree).className} />
                  </div>
                ) : (
                  <div {...stylex.props(styles.scopeTreeFrame)}>
                    <TreeSelect
                      value={scopeNodeIds}
                      onChange={setScopeNodeIds}
                      nodes={nodes.data.nodes}
                      emptyLabel={m.batch_scopeEmpty()}
                      emptyHint={m.batch_newNoUnitsHint()}
                    />
                  </div>
                )
              }
            </Field>
            {userTypes.data === undefined ? (
              <Field label={m.batch_userTypes()} required>
                {() => (
                  <div
                    role="status"
                    aria-label={commonMessages.state_loading()}
                    data-testid="new-batch-waiting"
                  >
                    <Skeleton className={stylex.props(styles.waitingKinds).className} />
                  </div>
                )}
              </Field>
            ) : (
              <CheckboxGroup
                legend={m.batch_userTypes()}
                required
                options={userTypes.data.userTypes.map((type) => ({
                  value: type.id,
                  label: type.name,
                }))}
                selected={userTypeIds}
                onChange={setUserTypeIds}
                emptyLabel={m.batch_userTypesEmpty()}
                emptyHint={m.batch_newNoTypesHint()}
              />
            )}
          </FieldGroup>
        )}
      </>
    )

  return narrow ? (
    <SidePanel open={open} title={m.batch_new()} onClose={close} footer={footer}>
      {body}
    </SidePanel>
  ) : (
    <FormDialog open={open} title={m.batch_new()} onClose={close} footer={footer}>
      {body}
    </FormDialog>
  )
}
