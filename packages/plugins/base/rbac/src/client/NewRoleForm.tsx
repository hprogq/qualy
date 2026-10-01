import { assertNever, getApiErrorCode } from '@qualy/web-i18n'
import { useApiMutation, useApi, useApiQuery } from '@qualy/web-runtime'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import * as stylex from '@stylexjs/stylex'
import { Feedback, Field, FormDialog, RadioGroup } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'

import { accessApi } from './api.ts'
import * as m from '#messages'

// Creation carries identity only: a role starts as a draft and is configured
// in the editor, where completeness is checked when it is activated. The form
// used to collect permissions and eligibility as well and then send none of
// it, which is worse than not offering the fields at all.
//
// The kind is chosen here because it cannot be changed afterwards: it decides
// whether the duty applies tenant-wide or is anchored to a node, and with it
// which capabilities the role may hold.

const styles = stylex.create({
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
})
export function NewRoleForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (roleId: string) => void
}) {
  const api = useApi(accessApi)
  const query = useApiQuery(accessApi)
  const queryClient = useQueryClient()

  const [feedback, setFeedback] = useState<string | null>(null)
  // a name another role already has is the name's to fix, said under it
  const [taken, setTaken] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'tenant' | 'org'>('org')

  const create = useApiMutation({
    mutationFn: () => api.access.createRole({ payload: { name, kind } }),
    onMutate: () => {
      setFeedback(null)
      setTaken(null)
    },
    onSuccess: async (result: { id: string }) => {
      setName('')
      await queryClient.invalidateQueries({ queryKey: query.access.key() })
      onCreated(result.id)
    },
    onError: (error) => {
      let failure: string
      switch (error._tag) {
        case 'ROLE_CONFLICT':
          failure = m.error_roleConflict()
          break
        default:
          assertNever(error._tag)
      }
      return getApiErrorCode(error) === 'ROLE_CONFLICT' ? setTaken(failure) : setFeedback(failure)
    },
  })

  return (
    <FormDialog
      open={open}
      title={m.roles_new()}
      description={m.roles_newHint()}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {m.action_cancel()}
          </Button>
          <Button type="submit" form="new-role" disabled={create.isPending || name.trim() === ''}>
            {m.action_create()}
          </Button>
        </>
      }
    >
      <Feedback message={feedback} />
      <form
        id="new-role"
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
        {/* cards, because the kind cannot be changed afterwards and each
            choice needs the sentence explaining what it commits to */}
        <RadioGroup
          variant="cards"
          legend={m.field_kind()}
          name="role-kind"
          options={[
            { value: 'org', label: m.field_kindOrg(), hint: m.field_kindOrgHint() },
            { value: 'tenant', label: m.field_kindTenant(), hint: m.field_kindTenantHint() },
          ]}
          selected={kind}
          onChange={(value) => setKind(value as 'tenant' | 'org')}
        />
      </form>
    </FormDialog>
  )
}
