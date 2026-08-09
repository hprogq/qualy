import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { CheckboxGroup, Feedback, Field, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'

// Creating a batch: what it faces, who it enrolls, and which dates the
// materials may carry.
//
// The units and the user types come from this domain's own options endpoints
// rather than from org and iam, so an administrator needs assessment
// permissions and nothing else to fill this in. Everything else about the
// batch is edited afterwards, while it is still a draft.
export function NewBatchForm({ onCreated }: { onCreated: (batchId: string) => void }) {
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
    <Panel title={format(m.newBatch)} description={format(m.newBatchHint)}>
      <Feedback message={failure} />
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <Field label={format(m.nameLabel)}>
          {(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <div className="flex flex-wrap items-end gap-2">
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
          <Field label={format(m.materialTo)} hint={format(m.materialHint)}>
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
        <CheckboxGroup
          legend={format(m.scopeLegend)}
          options={(nodes.data?.nodes ?? []).map((node) => ({
            value: node.id,
            label: node.name,
            hint: node.path,
          }))}
          selected={scopeNodeIds}
          onChange={setScopeNodeIds}
          emptyLabel={format(m.scopeEmpty)}
        />
        <p className="text-xs text-muted-foreground">{format(m.scopeHint)}</p>
        <CheckboxGroup
          legend={format(m.userTypesLegend)}
          options={(userTypes.data?.userTypes ?? []).map((type) => ({
            value: type.id,
            label: type.name,
            hint: type.code,
          }))}
          selected={userTypeIds}
          onChange={setUserTypeIds}
          emptyLabel={format(m.userTypesEmpty)}
        />
        <Button size="sm" type="submit" disabled={create.isPending || !ready}>
          {format(m.create)}
        </Button>
      </form>
    </Panel>
  )
}
