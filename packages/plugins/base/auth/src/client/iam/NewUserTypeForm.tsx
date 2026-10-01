import { assertNever, getApiErrorCode } from '@qualy/web-i18n'
import { useApiMutation, useApi, useApiQuery, useLoadFailure } from '@qualy/web-runtime'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useState } from 'react'

import { AsyncSection, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { ModeChoice, PickGrid } from '@qualy/ui/screen'
import { Skeleton } from '@qualy/ui/skeleton'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'

import { authApi } from '../api.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// A type is created complete, placement policy included. A type created
// without one constrains nothing while looking configured, and the window
// before somebody remembers to set it is exactly when a person gets placed
// where that kind of person should never be.
const styles = stylex.create({
  form: { display: 'flex', flexDirection: 'column', gap: 20 },
  waiting: { display: 'flex', flexDirection: 'column', gap: 8 },
  waitingLabel: { height: 20, width: 128 },
  waitingChoice: { height: 44, width: '100%', borderRadius: tokens.radiusLg },
  choices: { display: 'flex', flexDirection: 'column', gap: 12 },
})

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
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()

  const describe = useLoadFailure()
  const [feedback, setFeedback] = useState<string | null>(null)
  // a name another type already has is the name's to fix, said under it
  const [taken, setTaken] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'unrestricted' | 'allow-list'>('allow-list')
  const [orgTypeIds, setOrgTypeIds] = useState<string[]>([])
  const catalog = useQuery(query.identity.getUserTypeOptions.queryOptions())

  const create = useApiMutation({
    mutationFn: () =>
      api.identity.createUserType({
        payload: {
          name,
          placementPolicy:
            mode === 'unrestricted' ? { mode: 'unrestricted' } : { mode: 'allow-list', orgTypeIds },
        },
      }),
    onMutate: () => {
      setFeedback(null)
      setTaken(null)
    },
    onSuccess: async (result) => {
      setName('')
      setOrgTypeIds([])

      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      onCreated(result.id)
    },
    onError: (error) => {
      let failure: string
      switch (error._tag) {
        case 'USER_TYPE_CONFLICT':
          failure = m.error_userTypeConflict()
          break
        case 'USER_TYPE_ORG_TYPE_NOT_FOUND':
          failure = m.error_userTypeOrgTypeNotFound()
          break
        default:
          assertNever(error)
      }
      return getApiErrorCode(error) === 'USER_TYPE_CONFLICT'
        ? setTaken(failure)
        : setFeedback(failure)
    },
  })

  return (
    <FormDialog
      open={open}
      title={m.userTypes_new()}
      description={m.userTypes_newHint()}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {m.action_cancel()}
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
            {m.action_create()}
          </Button>
        </>
      }
    >
      <Feedback message={feedback} />
      <form
        id="new-user-type"
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <Field label={m.field_name()} required error={taken}>
          {(id, control) => (
            <Input
              id={id}
              {...control}
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setTaken(null)
              }}
            />
          )}
        </Field>
        <AsyncSection
          pending={catalog.isPending}
          error={catalog.isError ? describe.of(catalog.error) : null}
          retrying={catalog.isFetching}
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
          onRetry={() => void catalog.refetch()}
          skeleton={
            <div {...stylex.props(styles.waiting)}>
              <Skeleton className={stylex.props(styles.waitingLabel).className} />
              <Skeleton className={stylex.props(styles.waitingChoice).className} />
              <Skeleton className={stylex.props(styles.waitingChoice).className} />
            </div>
          }
        >
          <div {...stylex.props(styles.choices)}>
            <ModeChoice
              legend={m.userTypes_placementLegend()}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'unrestricted', label: m.userTypes_placementAnywhere() },
                { value: 'allow-list', label: m.userTypes_placementListed() },
              ]}
            />
            {mode === 'allow-list' && (
              <PickGrid
                columns={2}
                legend={m.field_allowedOrgTypes()}
                emptyLabel={m.field_noOptions()}
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
