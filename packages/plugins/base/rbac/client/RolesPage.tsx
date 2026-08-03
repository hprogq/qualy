import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Alert, AlertDescription } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@qualy/ui/card'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import { Spinner } from '@qualy/ui/spinner'
import { commonMessages } from '@qualy/web-i18n/messages'
import { rbacMessages as m } from './i18n.ts'

// roles and what they may hold. Allowed sets and assignments are edited
// elsewhere per user; this screen owns the role catalog itself.
export default function RolesPage() {
  const api = useApi()
  const orpc = useApiQuery()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')

  const roles = useQuery(orpc.rbacAdmin.listRoles.queryOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.rbacAdmin.key() })
  const onError = (error: unknown) => setFeedback(formatError(error))

  const create = useMutation({
    mutationFn: () => api.rbacAdmin.createOrgRole({ code, name }),
    onSuccess: () => {
      setFeedback(null)
      setCode('')
      setName('')
      return refresh()
    },
    onError,
  })
  const setEnabled = useMutation({
    mutationFn: (input: { roleId: string; enabled: boolean }) => api.rbacAdmin.setRoleEnabled(input),
    onSuccess: () => {
      setFeedback(null)
      return refresh()
    },
    onError,
  })
  const remove = useMutation({
    mutationFn: (roleId: string) => api.rbacAdmin.deleteRole({ roleId }),
    onSuccess: () => {
      setFeedback(null)
      return refresh()
    },
    onError,
  })

  return (
    <div className="space-y-4 p-4">
      {feedback && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{format(m.rolesTitle)}</CardTitle>
        </CardHeader>
        <CardContent>
          {roles.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner aria-label={format(commonMessages.loading)} />
            </div>
          ) : roles.isError ? (
            <Alert variant="destructive">
              <AlertDescription className="space-y-3">
                <p>{formatError(roles.error)}</p>
                <Button variant="outline" size="sm" onClick={() => void roles.refetch()}>
                  {format(commonMessages.retry)}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <ul className="divide-y">
              {roles.data.roles.map((role) => (
                <li key={role.id} className="flex items-center justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {role.name}
                      <span className="ml-2 text-xs text-muted-foreground">{role.code}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {format(role.kind === 'tenant' ? m.tenantKind : m.orgKind)}
                      </span>
                      {role.isSystem && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {format(m.systemBadge)}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(m.assignmentCount, { count: role.assignmentCount })}
                      {role.permissions.length > 0 && ` · ${role.permissions.join(', ')}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={setEnabled.isPending || role.isSystem}
                      onClick={() => setEnabled.mutate({ roleId: role.id, enabled: !role.enabled })}
                    >
                      {format(role.enabled ? m.disable : m.enable)}
                    </Button>
                    {!role.isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (confirm(format(m.confirmDelete))) remove.mutate(role.id)
                        }}
                      >
                        {format(m.delete)}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{format(m.newRole)}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="role-code">{format(m.codeLabel)}</Label>
            <Input id="role-code" value={code} onChange={(event) => setCode(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-name">{format(m.nameLabel)}</Label>
            <Input id="role-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <Button
            size="sm"
            disabled={create.isPending || code.trim() === '' || name.trim() === ''}
            onClick={() => create.mutate()}
          >
            {format(m.create)}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
