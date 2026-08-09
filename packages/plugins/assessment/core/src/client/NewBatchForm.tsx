import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { CheckboxGroup, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
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

  const nodes = useQuery(query.assessment.listScopeOptions.queryOptions({}))
  const userTypes = useQuery(query.assessment.listUserTypeOptions.queryOptions({}))

  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [until, setUntil] = useState('')
  const [scopeNodeIds, setScopeNodeIds] = useState<string[]>([])
  const [userTypeIds, setUserTypeIds] = useState<string[]>([])
  const [failure, setFailure] = useState<string | null>(null)

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
          <Button size="sm" variant="outline" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button size="sm" disabled={create.isPending || !ready} onClick={() => create.mutate()}>
            {format(m.create)}
          </Button>
        </>
      }
    >
      <Feedback message={failure} />
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
      <div className="grid grid-cols-2 gap-3">
        <Field label={format(m.materialFrom)}>
          {(id) => (
            <Input
              id={id}
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          )}
        </Field>
        <Field label={format(m.materialTo)}>
          {(id) => (
            <Input
              id={id}
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          )}
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">{format(m.materialHint)}</p>
      <div className="space-y-1">
        <div className="max-h-48 overflow-y-auto rounded-md border p-3">
          <CheckboxGroup
            legend={format(m.scopeLegend)}
            options={(nodes.data?.nodes ?? []).map((node) => ({
              value: node.id,
              label: node.name,
            }))}
            selected={scopeNodeIds}
            onChange={setScopeNodeIds}
            emptyLabel={format(m.scopeEmpty)}
          />
        </div>
        <p className="text-xs text-muted-foreground">{format(m.scopeHint)}</p>
      </div>
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
    </FormDialog>
  )
}
