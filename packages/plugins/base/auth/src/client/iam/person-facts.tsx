import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Cell, Status } from '@qualy/ui/screen'
import { iamMessages as m } from '../i18n.ts'

// Facts about one person that read the same whoever is looking: somebody
// administering them in the directory, or the person on their own account.
// The screens around them differ in who may do what; these do not.

const styles = stylex.create({
  emailLine: {
    display: 'inline-flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  code: { fontFamily: "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace", fontSize: 12 },
  account: { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 },
  aside: { fontSize: 12, color: tokens.mutedForeground },
})

/** an email, and whether its owner has shown they receive it */
export function EmailWithStanding({
  email,
  verified,
}: {
  email: string | null
  verified: boolean
}) {
  const { format } = useI18n()
  if (email === null) return <>{format(m.emailNone)}</>
  return (
    <span {...stylex.props(styles.emailLine)}>
      {email}
      <Status
        tone={verified ? 'ok' : 'plain'}
        data-testid="email-verified"
        data-verified={verified ? 'yes' : 'no'}
      >
        {format(verified ? m.emailVerified : m.emailUnverified)}
      </Status>
    </span>
  )
}

/** how one door knows the person, in the words of the door's own kind */
export interface EntranceStanding {
  readonly admits?: boolean
  readonly resolution:
    | { readonly mode: 'user-field'; readonly field: 'email' | 'businessNo' }
    | { readonly mode: 'binding-subject' }
    | null
  readonly binding: { readonly mode: 'managed' | 'self' } | null
  readonly bound: {
    readonly subject: string | null
    readonly displayLabel: string | null
    readonly hasCredential: boolean
  } | null
}

/**
 * The account column of a way in: the field of the person's own a door finds
 * them by, with whether a password is set where one is managed, or the
 * account they bound where they bind one.
 */
export function EntranceAccount({
  entrance,
  person,
  unbound,
}: {
  entrance: EntranceStanding
  person: { readonly email: string | null; readonly businessNo: string | null }
  /** what an account nobody bound yet is called, in the reader's own voice */
  unbound?: string
}) {
  const { format } = useI18n()
  const businessNoWord = useTerm(authTerms.businessNumber)
  if (entrance.admits === false) return <Cell tone="quiet">{format(m.entranceNotAdmitted)}</Cell>
  const resolution = entrance.resolution
  if (resolution === null) return <Cell tone="quiet">{format(m.driverMissing)}</Cell>
  if (resolution.mode === 'binding-subject') {
    const bound = entrance.bound
    return bound === null ? (
      <Cell tone="quiet">{unbound ?? format(m.entranceSelf)}</Cell>
    ) : (
      <Cell tone="plain" unlabelled title={bound.subject ?? undefined}>
        <span {...stylex.props(styles.code)}>{bound.displayLabel ?? bound.subject}</span>
      </Cell>
    )
  }
  const value = resolution.field === 'email' ? person.email : person.businessNo
  if (value === null) {
    return (
      <Cell tone="warn">
        {resolution.field === 'email'
          ? format(m.emailMissing)
          : format(m.businessNoMissing, { businessNo: businessNoWord })}
      </Cell>
    )
  }
  return (
    <Cell tone="plain" unlabelled title={value}>
      <span {...stylex.props(styles.account)}>
        <span {...stylex.props(styles.code)}>{value}</span>
        {entrance.binding?.mode === 'managed' ? (
          <Status tone={entrance.bound?.hasCredential === true ? 'ok' : 'warn'}>
            {format(entrance.bound?.hasCredential === true ? m.credentialSet : m.credentialUnset)}
          </Status>
        ) : (
          <span {...stylex.props(styles.aside)}>
            {resolution.field === 'email'
              ? format(m.fromEmail)
              : format(m.byBusinessNo, { businessNo: businessNoWord })}
          </span>
        )}
      </span>
    </Cell>
  )
}
