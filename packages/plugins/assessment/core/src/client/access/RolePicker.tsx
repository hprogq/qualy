import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'

// The roles that were considered, including the ones that cannot be given.
//
// A refused role is shown greyed with the reason beside it, because the
// reason is usually something somebody can act on - the wrong kind of person
// for this role, or a role nobody but a tenant administrator hands out. A
// list that merely omitted them says "no" about a subject the reader cannot
// see, and the usual next move is to go looking for a role that is not there.

export interface RoleCandidate {
  id: string
  name: string
  refusal: 'user-type' | 'authority' | 'unavailable' | 'beyond-batch' | null
}

const REASONS = {
  'user-type': m.roleRefusedUserType,
  authority: m.roleRefusedAuthority,
  unavailable: m.roleRefusedUnavailable,
  'beyond-batch': m.roleRefusedBeyondBatch,
} as const

export function RolePicker({
  roles,
  value,
  emptyLabel,
  onChange,
}: {
  roles: readonly RoleCandidate[]
  value: string | null
  emptyLabel: string
  onChange: (roleId: string) => void
}) {
  const { format } = useI18n()
  if (roles.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <ul className="max-h-64 divide-y overflow-auto rounded-md border">
      {roles.map((role) => {
        const refused = role.refusal !== null
        return (
          <li key={role.id}>
            <button
              type="button"
              disabled={refused}
              aria-pressed={value === role.id}
              onClick={() => onChange(role.id)}
              className={cn(
                'flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left outline-none',
                refused
                  ? 'cursor-not-allowed text-muted-foreground'
                  : 'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                value === role.id && 'bg-accent',
              )}
            >
              <span className="text-sm">{role.name}</span>
              {role.refusal !== null && (
                <Badge variant="outline" className="font-normal">
                  {format(REASONS[role.refusal])}
                </Badge>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
