import { CheckIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
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
  refusal: 'user-type' | 'authority' | 'self-escalation' | 'unavailable' | 'beyond-batch' | null
}

const styles = stylex.create({
  empty: {
    fontSize: 14,
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  list: {
    maxHeight: '16rem',
    overflow: 'auto',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  divided: {
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
  },
  row: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    paddingInline: 12,
    paddingBlock: 10,
    textAlign: 'left',
    outlineStyle: 'none',
  },
  rowOpen: {
    backgroundColor: { default: null, ':hover': tokens.surfaceMuted },
    outline: { default: null, ':focus-visible': `2px solid ${tokens.focusRing}` },
    outlineOffset: { default: null, ':focus-visible': -2 },
  },
  // a role that cannot be given says so in its own weight, and answers
  // nothing the pointer does
  rowRefused: {
    cursor: 'not-allowed',
    color: tokens.mutedForeground,
  },
  rowChosen: {
    backgroundColor: tokens.surfaceMuted,
  },
  // the mark keeps its space whether or not it is drawn: a row that shifts
  // when it is chosen reads as a different row
  mark: {
    display: 'flex',
    width: 16,
    height: 16,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
  },
  markChosen: {
    borderColor: tokens.primary,
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
  },
  tick: {
    width: 12,
    height: 12,
  },
  name: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    fontSize: 14,
    lineHeight: '1.25rem',
  },
  nameChosen: {
    fontWeight: 500,
  },
  reason: {
    flexShrink: 0,
    fontWeight: 400,
  },
})

const REASONS = {
  'user-type': m.roleRefusedUserType,
  authority: m.roleRefusedAuthority,
  'self-escalation': m.roleRefusedSelfEscalation,
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
    return <p {...stylex.props(styles.empty)}>{emptyLabel}</p>
  }
  return (
    <ul role="radiogroup" {...stylex.props(styles.list)}>
      {roles.map((role) => {
        const refused = role.refusal !== null
        return (
          <li key={role.id} {...stylex.props(styles.divided)}>
            <button
              type="button"
              disabled={refused}
              role="radio"
              aria-checked={value === role.id}
              onClick={() => onChange(role.id)}
              {...stylex.props(
                styles.row,
                refused ? styles.rowRefused : styles.rowOpen,
                value === role.id && styles.rowChosen,
              )}
            >
              <span
                aria-hidden
                {...stylex.props(styles.mark, value === role.id && styles.markChosen)}
              >
                {value === role.id && <CheckIcon {...stylex.props(styles.tick)} />}
              </span>
              <span {...stylex.props(styles.name, value === role.id && styles.nameChosen)}>
                {role.name}
              </span>
              {role.refusal !== null && (
                <Badge variant="outline" className={stylex.props(styles.reason).className}>
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
