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

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`

const styles = stylex.create({
  // What is true of them at a glance, each under its own small word. The
  // rule between two facts is drawn by the second, in the gap before it, and
  // the line clips whatever stands outside it: a fact that wraps to the start
  // of a line takes its rule along to where it cannot be seen, instead of
  // leaving one hanging at the end of the line above.
  facts: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    columnGap: 14,
    rowGap: 6,
    overflow: 'hidden',
  },
  factsWrap: { flexWrap: 'wrap' },
  // one line, the last fact giving way first: the banner above the reader's
  // own pages is held at the height of a name and one line under it
  factsLine: { flexWrap: 'nowrap' },
  fact: {
    position: 'relative',
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 6,
    fontSize: 12.5,
    '::before': {
      content: '""',
      position: 'absolute',
      insetInlineStart: -8,
      top: '50%',
      width: 1,
      height: 10,
      marginTop: -5,
      backgroundColor: `color-mix(in oklab, ${tokens.foreground} 12%, transparent)`,
    },
  },
  factFixed: { flexShrink: 0 },
  factLabel: { flexShrink: 0, color: QUIET },
  factValue: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.surfaceMutedForeground,
  },
  factWarn: { color: tokens.warningForeground },
  factAside: { flexShrink: 0, color: QUIET },
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

/** one fact of a person's banner line */
export interface PersonFact {
  /** stable across renders and locales, for React and for a test to find */
  readonly key: string
  readonly label: string
  readonly value: string
  /** said in the warning colour: something is missing that should not be */
  readonly warn?: boolean
  /** a word after the value, quieter than it: a state of the value itself */
  readonly aside?: string
  /** the whole of a value the line shows only the end of, on hover */
  readonly title?: string
}

/**
 * A person's facts on one line under their name, "label value", a thin rule
 * between each: the same line over the directory's record of them and over
 * their own account, so the two read as one person seen from two sides.
 */
export function PersonFacts({
  facts,
  wrap = false,
}: {
  facts: readonly PersonFact[]
  /** onto further lines when the width runs out, rather than cutting the last */
  wrap?: boolean
}) {
  return (
    <div
      data-testid="person-facts"
      {...stylex.props(styles.facts, wrap ? styles.factsWrap : styles.factsLine)}
    >
      {facts.map((fact, index) => (
        <span
          key={fact.key}
          data-testid="person-fact"
          data-fact={fact.key}
          data-warn={fact.warn === true ? 'yes' : 'no'}
          // every fact but the last keeps its width: the line gives way at its end
          {...stylex.props(styles.fact, index < facts.length - 1 && styles.factFixed)}
        >
          <span {...stylex.props(styles.factLabel)}>{fact.label}</span>
          <span
            title={fact.title ?? fact.value}
            {...stylex.props(styles.factValue, fact.warn === true && styles.factWarn)}
          >
            {fact.value}
          </span>
          {fact.aside !== undefined && (
            <span {...stylex.props(styles.factAside)}>{fact.aside}</span>
          )}
        </span>
      ))}
    </div>
  )
}
