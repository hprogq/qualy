import type { ReactNode } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import type { ApiResult } from '@qualy/web-runtime/api'
import { assessmentMessages as m } from '../i18n.ts'
import type { assessmentApi } from '../api.ts'
import { inCatalogOrder, permissionLabel } from './permissions.ts'

// What the organization now says, next to what this round accepted.
//
// Two kinds of difference, and they are not symmetrical. Something gained is
// a proposal: it waits here until somebody accepts it, because a round whose
// staff quietly grew is a round nobody can account for afterwards. Something
// taken away has already happened - it is listed so a reader knows why a
// person lost access, not so they can approve it - which is why that half is
// quiet and has no button.

type SyncPlan = ApiResult<typeof assessmentApi, 'assessment', 'previewAccessSync'>

function Line({
  name,
  role,
  permissions,
}: {
  name: string
  role: string
  permissions: readonly string[]
}) {
  const { format } = useI18n()
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-sm">
      <span className="font-medium">{name}</span>
      {role !== '' && (
        <span className="text-xs text-muted-foreground">{format(m.accessRoleAt, { role })}</span>
      )}
      <span className="flex flex-wrap gap-1">
        {inCatalogOrder(permissions).map((code) => (
          <Badge key={code} variant="outline" className="font-normal">
            {format(permissionLabel(code))}
          </Badge>
        ))}
      </span>
    </li>
  )
}

function Group({
  title,
  hint,
  count,
  children,
}: {
  title: string
  hint?: string
  count: number
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="rounded-lg border bg-background">
      <header className="space-y-0.5 border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">{title}</h4>
          <Badge variant="secondary">{count}</Badge>
        </div>
        {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>
      <ul className="divide-y">{children}</ul>
    </section>
  )
}

export function AccessSyncNotice({
  plan,
  pending,
  onApply,
}: {
  plan: SyncPlan
  pending: boolean
  onApply: () => void
}) {
  const { format } = useI18n()
  const decisions = plan.newSources.length + plan.widened.length
  if (decisions === 0 && plan.lapsed.length === 0) return null

  return (
    <section
      aria-label={format(decisions > 0 ? m.accessSyncTitle : m.accessSyncLapsed)}
      className={cn(
        'space-y-3 rounded-xl border p-4',
        // amber only when somebody has to decide something; a standing fact
        // that never goes away must not look like an alarm that never clears
        decisions > 0 ? 'border-amber-500/40 bg-amber-500/8' : 'bg-muted/40',
      )}
    >
      {decisions > 0 && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-sm font-semibold">{format(m.accessSyncTitle)}</h3>
            <p className="text-xs text-muted-foreground">{format(m.accessSyncHint)}</p>
          </div>
          <Button size="sm" disabled={pending} onClick={onApply}>
            {format(m.accessSyncApply)}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {plan.newSources.length > 0 && (
          <Group title={format(m.accessSyncNew)} count={plan.newSources.length}>
            {plan.newSources.map((row) => (
              <Line
                key={row.assignmentId}
                name={row.displayName}
                role={row.roleName}
                permissions={row.permissions}
              />
            ))}
          </Group>
        )}
        {plan.widened.length > 0 && (
          <Group title={format(m.accessSyncWidened)} count={plan.widened.length}>
            {plan.widened.map((row) => (
              <Line
                key={row.sourceId}
                name={row.displayName}
                role={row.roleName}
                permissions={row.permissions}
              />
            ))}
          </Group>
        )}
        {plan.lapsed.length > 0 && (
          <Group
            title={format(m.accessSyncLapsed)}
            hint={format(m.accessSyncLapsedHint)}
            count={plan.lapsed.length}
          >
            {plan.lapsed.map((row) => (
              <Line
                key={`${row.userId}/${row.roleName}`}
                name={row.displayName}
                role={row.roleName}
                permissions={row.permissions}
              />
            ))}
          </Group>
        )}
      </div>
    </section>
  )
}
