import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n, useLocale } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { CheckboxGroup, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { DateRangePicker } from '@qualy/ui/date-range-picker'
import { FieldGroup } from '@qualy/ui/field'
import { Input } from '@qualy/ui/input'
import { Steps } from '@qualy/ui/steps'
import { TreeSelect } from '@qualy/ui/tree-select'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'

// Creating a batch, one decision at a time: what it is, then who it covers.
//
// Two steps rather than one long form, and the units are chosen in place - a
// picker that opens its own dialog on top of this one buries the thing being
// decided. The options come from this domain's own endpoints, so an
// administrator needs assessment permissions and nothing else.
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
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [locale] = useLocale()

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

  const create = useMutation({
    mutationFn: () =>
      run(
        api.assessment.createBatch({
          payload: {
            name,
            materialRange: range,
            import: { orgNodeIds: scopeNodeIds, userTypeIds },
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async (result: { batch: { id: string } }) => {
      toast.success(format(m.toastBatchCreated))
      reset()
      await queryClient.invalidateQueries({ queryKey: query.assessment.key() })
      onCreated(result.batch.id)
    },
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  const basicsReady = name.trim() !== '' && range.start !== '' && range.end !== ''
  const scopeReady = scopeNodeIds.length > 0 && userTypeIds.length > 0

  const close = () => {
    reset()
    onClose()
  }

  return (
    <FormDialog
      open={open}
      title={format(m.newBatch)}
      onClose={close}
      footer={
        <>
          {step === 0 ? (
            <Button variant="outline" onClick={close}>
              {format(m.cancel)}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setStep(0)}>
              {format(m.back)}
            </Button>
          )}
          {step === 0 ? (
            <Button disabled={!basicsReady} onClick={() => setStep(1)}>
              {format(m.next)}
            </Button>
          ) : (
            <Button disabled={create.isPending || !scopeReady} onClick={() => create.mutate()}>
              {format(m.create)}
            </Button>
          )}
        </>
      }
    >
      <Steps steps={[format(m.stepBasics), format(m.stepScope)]} current={step} />
      <Feedback message={failure} />

      {step === 0 ? (
        <FieldGroup>
          <Field label={format(m.nameLabel)}>
            {(id) => (
              <Input
                id={id}
                value={name}
                placeholder={format(m.namePlaceholder)}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label={format(m.materialRange)}>
            {(id) => (
              <DateRangePicker
                id={id}
                value={range}
                onChange={setRange}
                placeholder={format(m.pickDateRange)}
                localeTag={locale}
                monthLabel={format(commonMessages.calendarMonth)}
                yearLabel={format(commonMessages.calendarYear)}
              />
            )}
          </Field>
        </FieldGroup>
      ) : (
        <FieldGroup>
          <Field label={format(m.scopeLegend)}>
            {() => (
              <div className="max-h-64 overflow-y-auto rounded-md border p-2">
                <TreeSelect
                  value={scopeNodeIds}
                  onChange={setScopeNodeIds}
                  nodes={nodes.data?.nodes ?? []}
                  emptyLabel={format(m.scopeEmpty)}
                />
              </div>
            )}
          </Field>
          <CheckboxGroup
            legend={format(m.userTypesLegend)}
            options={(userTypes.data?.userTypes ?? []).map((type) => ({
              value: type.id,
              label: type.name,
            }))}
            selected={userTypeIds}
            onChange={setUserTypeIds}
            emptyLabel={format(m.userTypesEmpty)}
          />
        </FieldGroup>
      )}
    </FormDialog>
  )
}
