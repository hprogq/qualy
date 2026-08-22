import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, CheckboxGroup, Feedback, Field, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

// A type is created complete, placement policy included. A type created
// without one constrains nothing while looking configured, and the window
// before somebody remembers to set it is exactly when a person gets placed
// where that kind of person should never be.
export function NewUserTypeForm({ onCreated }: { onCreated: (userTypeId: string) => void }) {
  const api = useApi(authApi)
  const run = useRunApi()
  const orpc = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [channels, setChannels] = useState<string[]>(['local'])
  const [unrestricted, setUnrestricted] = useState(false)
  const [orgTypeIds, setOrgTypeIds] = useState<string[]>([])
  const catalog = useQuery(orpc.identity.getUserTypeOptions.queryOptions())

  const create = useMutation({
    mutationFn: () =>
      run(
        api.identity.createUserType({
          payload: {
            code,
            name,
            allowLocalLogin: channels.includes('local'),
            allowSsoLogin: channels.includes('sso'),
            placementPolicy: unrestricted
              ? { mode: 'unrestricted' }
              : { mode: 'allow-list', orgTypeIds },
          },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async (result) => {
      setCode('')
      setName('')
      setOrgTypeIds([])

      await queryClient.invalidateQueries({ queryKey: orpc.identity.key() })
      onCreated(result.id)
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  return (
    <Panel title={format(m.newUserType)} description={format(m.newUserTypeHint)}>
      <Feedback message={feedback} />
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <Field label={format(m.codeLabel)}>
            {(id) => (
              <Input id={id} value={code} onChange={(event) => setCode(event.target.value)} />
            )}
          </Field>
          <Field label={format(m.nameLabel)}>
            {(id) => (
              <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
        </div>
        <CheckboxGroup
          legend={format(m.loginChannels)}
          emptyLabel={format(m.noOptions)}
          options={[
            { value: 'local', label: format(m.allowLocalLogin) },
            { value: 'sso', label: format(m.allowSsoLogin) },
          ]}
          selected={channels}
          onChange={setChannels}
        />
        <AsyncSection
          pending={catalog.isPending}
          error={catalog.isError ? formatError(catalog.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void catalog.refetch()}
        >
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{format(m.placementHint)}</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={unrestricted}
                onChange={(event) => setUnrestricted(event.target.checked)}
              />
              {format(m.placementUnrestricted)}
            </label>
            {!unrestricted && (
              <CheckboxGroup
                legend={format(m.allowedOrgTypesLegend)}
                emptyLabel={format(m.noOptions)}
                options={(catalog.data?.orgTypes ?? []).map((type) => ({
                  value: type.id,
                  label: type.name,
                }))}
                selected={orgTypeIds}
                onChange={setOrgTypeIds}
              />
            )}
          </div>
        </AsyncSection>
        <Button
          size="sm"
          type="submit"
          disabled={
            create.isPending ||
            code.trim() === '' ||
            name.trim() === '' ||
            (!unrestricted && orgTypeIds.length === 0)
          }
        >
          {format(m.create)}
        </Button>
      </form>
    </Panel>
  )
}
