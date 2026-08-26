import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { ModeChoice, PickGrid } from '@qualy/ui/screen'
import { Skeleton } from '@qualy/ui/skeleton'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

// A type is created complete, placement policy included. A type created
// without one constrains nothing while looking configured, and the window
// before somebody remembers to set it is exactly when a person gets placed
// where that kind of person should never be.
export function NewUserTypeForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (userTypeId: string) => void
}) {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'unrestricted' | 'allow-list'>('allow-list')
  const [orgTypeIds, setOrgTypeIds] = useState<string[]>([])
  const catalog = useQuery(query.identity.getUserTypeOptions.queryOptions())

  const create = useMutation({
    mutationFn: () =>
      run(
        api.identity.createUserType({
          payload: {
            name,
            placementPolicy:
              mode === 'unrestricted'
                ? { mode: 'unrestricted' }
                : { mode: 'allow-list', orgTypeIds },
          },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async (result) => {
      setName('')
      setOrgTypeIds([])

      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      onCreated(result.id)
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  return (
    <FormDialog
      open={open}
      title={format(m.newUserType)}
      description={format(m.newUserTypeHint)}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button
            type="submit"
            form="new-user-type"
            disabled={
              create.isPending ||
              name.trim() === '' ||
              (mode === 'allow-list' && orgTypeIds.length === 0)
            }
          >
            {format(m.create)}
          </Button>
        </>
      }
    >
      <Feedback message={feedback} />
      <form
        id="new-user-type"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <Field label={format(m.nameLabel)}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <AsyncSection
          pending={catalog.isPending}
          error={catalog.isError ? formatError(catalog.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void catalog.refetch()}
          skeleton={
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-11 w-full rounded-lg" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <ModeChoice
              legend={format(m.placementLegend)}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'unrestricted', label: format(m.placementAnywhere) },
                { value: 'allow-list', label: format(m.placementListed) },
              ]}
            />
            {mode === 'allow-list' && (
              <PickGrid
                columns={2}
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
      </form>
    </FormDialog>
  )
}
