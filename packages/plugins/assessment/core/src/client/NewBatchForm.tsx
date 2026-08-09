import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n, useLocale } from '@qualy/web-i18n'
import { CheckboxGroup, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { FieldGroup } from '@qualy/ui/field'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { DatePicker } from '@qualy/ui/date-picker'
import { Input } from '@qualy/ui/input'
import { TreeSelectDialog } from '@qualy/ui/tree-select'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'

// Creating a batch, in a dialog: what to call it, which dates the materials
// may carry, which units take part and who inside them.
//
// The units and the user types come from this domain's own options endpoints,
// so an administrator needs assessment permissions and nothing else to fill
// this in. Everything else about the batch is shaped afterwards, while it is
// still a draft.
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

  const nodes = useQuery(query.assessment.listScopeOptions.queryOptions({}))
  const userTypes = useQuery(query.assessment.listUserTypeOptions.queryOptions({}))

  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [until, setUntil] = useState('')
  const [scopeNodeIds, setScopeNodeIds] = useState<string[]>([])
  const [userTypeIds, setUserTypeIds] = useState<string[]>([])
  const [choosingUnits, setChoosingUnits] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const nodeById = new Map((nodes.data?.nodes ?? []).map((node) => [node.id, node]))

  const create = useMutation({
    mutationFn: () =>
      run(
        api.assessment.createBatch({
          payload: {
            name,
            scopeNodeIds,
            materialRange: { start: from, end: until },
            userTypeIds,
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async (result: { batch: { id: string } }) => {
      setName('')
      setFrom('')
      setUntil('')
      setScopeNodeIds([])
      setUserTypeIds([])
      await queryClient.invalidateQueries({ queryKey: query.assessment.key() })
      onCreated(result.batch.id)
    },
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  const ready =
    name.trim() !== '' &&
    from !== '' &&
    until !== '' &&
    scopeNodeIds.length > 0 &&
    userTypeIds.length > 0

  return (
    <FormDialog
      open={open}
      title={format(m.newBatch)}
      description={format(m.newBatchHint)}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button disabled={create.isPending || !ready} onClick={() => create.mutate()}>
            {format(m.create)}
          </Button>
        </>
      }
    >
      <Feedback message={failure} />
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
        <div className="grid grid-cols-2 gap-4">
          <Field label={format(m.materialFrom)}>
            {(id) => (
              <DatePicker
                id={id}
                value={from}
                onChange={setFrom}
                placeholder={format(m.pickDate)}
                localeTag={locale}
              />
            )}
          </Field>
          <Field label={format(m.materialTo)} hint={format(m.materialHint)}>
            {(id) => (
              <DatePicker
                id={id}
                value={until}
                onChange={setUntil}
                placeholder={format(m.pickDate)}
                localeTag={locale}
              />
            )}
          </Field>
        </div>
        <Field label={format(m.scopeLegend)} hint={format(m.scopeHint)}>
          {(id) => (
            <div className="flex flex-col gap-2">
              <Button
                id={id}
                type="button"
                variant="outline"
                className="w-fit"
                onClick={() => setChoosingUnits(true)}
              >
                {format(m.chooseUnits)}
              </Button>
              {scopeNodeIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {scopeNodeIds.map((nodeId) => (
                    <Badge key={nodeId} variant="secondary">
                      {nodeById.get(nodeId)?.name ?? nodeId}
                    </Badge>
                  ))}
                </div>
              )}
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
      <TreeSelectDialog
        open={choosingUnits}
        onClose={() => setChoosingUnits(false)}
        onConfirm={(next) => {
          setScopeNodeIds(next)
          setChoosingUnits(false)
        }}
        title={format(m.chooseUnits)}
        description={format(m.scopeHint)}
        confirmLabel={format(m.confirm)}
        cancelLabel={format(m.cancel)}
        emptyLabel={format(m.scopeEmpty)}
        nodes={nodes.data?.nodes ?? []}
        value={scopeNodeIds}
      />
    </FormDialog>
  )
}
