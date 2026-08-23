import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Feedback, Field, FormDialog, RadioGroup } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { rbacMessages as m } from './i18n.ts'
import { accessApi } from './api.ts'

// Creation carries identity only: a role starts as a draft and is configured
// in the editor, where completeness is checked when it is activated. The form
// used to collect permissions and eligibility as well and then send none of
// it, which is worse than not offering the fields at all.
//
// The kind is chosen here because it cannot be changed afterwards: it decides
// whether the duty applies tenant-wide or is anchored to a node, and with it
// which capabilities the role may hold.
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
  const run = useRunApi()
  const orpc = useApiQuery(accessApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'tenant' | 'org'>('org')

  const create = useMutation({
    mutationFn: () => run(api.access.createRole({ payload: { code, name, kind } })),
    onMutate: () => setFeedback(null),
    onSuccess: async (result: { id: string }) => {
      setCode('')
      setName('')
      await queryClient.invalidateQueries({ queryKey: orpc.access.key() })
      onCreated(result.id)
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  return (
    <FormDialog
      open={open}
      title={format(m.newRole)}
      description={format(m.newRoleHint)}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button
            type="submit"
            form="new-role"
            disabled={create.isPending || code.trim() === '' || name.trim() === ''}
          >
            {format(m.create)}
          </Button>
        </>
      }
    >
      <Feedback message={feedback} />
      <form
        id="new-role"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
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
        <RadioGroup
          legend={format(m.kindLegend)}
          name="role-kind"
          options={[
            { value: 'org', label: format(m.kindOrg), hint: format(m.kindOrgHint) },
            { value: 'tenant', label: format(m.kindTenant), hint: format(m.kindTenantHint) },
          ]}
          selected={kind}
          onChange={(value) => setKind(value as 'tenant' | 'org')}
        />
      </form>
    </FormDialog>
  )
}
