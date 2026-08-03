import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import { iamMessages as m } from '../i18n.ts'
import { AdminPanel, Feedback, QueryState } from './shared.tsx'

// user types: the sign-in policy and tenant-wide permission grants of a
// class of people. Deliberately small — the tenant has a handful of them.
export default function UserTypesPage() {
  const api = useApi()
  const orpc = useApiQuery()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')

  const types = useQuery(orpc.iam.listUserTypes.queryOptions())
  // only this plugin's queries are invalidated; other plugins keep theirs
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.iam.key() })
  const mutate = <T,>(run: () => Promise<T>) =>
    ({
      mutationFn: run,
      onSuccess: () => {
        setFeedback(null)
        return refresh()
      },
      onError: (error: unknown) => setFeedback(formatError(error)),
    }) as const

  const create = useMutation(
    mutate(async () => {
      await api.iam.createUserType({ code, name })
      setCode('')
      setName('')
    }),
  )
  const setEnabled = useMutation({
    mutationFn: (input: { userTypeId: string; enabled: boolean }) =>
      api.iam.setUserTypeEnabled(input),
    onSuccess: () => {
      setFeedback(null)
      return refresh()
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })
  const remove = useMutation({
    mutationFn: (userTypeId: string) => api.iam.deleteUserType({ userTypeId }),
    onSuccess: () => {
      setFeedback(null)
      return refresh()
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  return (
    <div className="space-y-4 p-4">
      <Feedback message={feedback} />
      <AdminPanel title={format(m.userTypesTitle)}>
        <QueryState
          pending={types.isPending}
          error={types.isError ? types.error : null}
          onRetry={() => void types.refetch()}
        >
          <ul className="divide-y">
            {(types.data?.userTypes ?? []).map((type) => (
              <li key={type.id} className="flex items-center justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {type.name}
                    <span className="ml-2 text-xs text-muted-foreground">{type.code}</span>
                    {type.isSystem && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {format(m.systemBadge)}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(m.userCount, { count: type.userCount })}
                    {type.permissions.length > 0 && ` · ${type.permissions.join(', ')}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={setEnabled.isPending}
                    onClick={() =>
                      setEnabled.mutate({ userTypeId: type.id, enabled: !type.enabled })
                    }
                  >
                    {format(type.enabled ? m.disable : m.enable)}
                  </Button>
                  {!type.isSystem && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(format(m.confirmDelete))) remove.mutate(type.id)
                      }}
                    >
                      {format(m.delete)}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </QueryState>
      </AdminPanel>

      <AdminPanel title={format(m.newUserType)}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="user-type-code">{format(m.codeLabel)}</Label>
            <Input
              id="user-type-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-type-name">{format(m.nameLabel)}</Label>
            <Input
              id="user-type-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={create.isPending || code.trim() === '' || name.trim() === ''}
            onClick={() => create.mutate()}
          >
            {format(m.create)}
          </Button>
        </div>
      </AdminPanel>
    </div>
  )
}
