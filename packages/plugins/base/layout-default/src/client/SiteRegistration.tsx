import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { ColophonProps } from '@qualy/ui/screen'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import type { SiteRegistration } from '../site-registration.ts'
import { publicSecurityEmblem } from './public-security-emblem.ts'
import { hasSiteRegistration, useSiteRegistration } from './site-registration.ts'
import * as m from '#messages'

// The deployment's filing records, said where a visitor arrives: on the
// sign-in page at every width, and in the foot of the applications' own
// pages where that foot is drawn. A workspace or a record somebody has
// opened does not repeat them on every screen.
//
// Centred, they are one line where there is room and one record to a line
// on a phone, so a record never breaks in the middle of its number. Set
// flush to the start edge, under a name that stands there too, they are one
// record to a line at every width.

const styles = stylex.create({
  links: {
    display: 'flex',
    flexDirection: { default: 'row', [breakpoints.phone]: 'column' },
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 24,
    rowGap: 6,
    minWidth: 0,
    fontSize: 12,
    lineHeight: '18px',
    // A record is Han, Latin and a long run of digits in one word. Spaced a
    // little, and with the browser's own gap between the scripts, the
    // number reads as a number rather than as a bar of ink.
    letterSpacing: '0.04em',
    textAutospace: 'normal',
    color: tokens.mutedForeground,
  },
  // as tall as the two lines of a choice set across from them
  start: { flexDirection: 'column', alignItems: 'flex-start', rowGap: 4 },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    color: { default: 'inherit', ':hover': tokens.foreground },
    textDecoration: 'none',
    borderRadius: 2,
    outlineOffset: 3,
  },
  record: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    textDecoration: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 3,
  },
  emblem: { display: 'block', flexShrink: 0, width: 'auto', height: 16 },
})

export function SiteRegistrationLinks({
  registration,
  align = 'center',
  xstyle,
}: {
  registration: SiteRegistration | undefined
  align?: ColophonProps['align']
  xstyle?: stylex.StyleXStyles
}) {
  if (!hasSiteRegistration(registration)) return null
  const links: {
    kind: string
    value: SiteRegistration['icp']
    label: (inputs: { record: string }) => string
    lead?: ReactNode
  }[] = [
    { kind: 'icp', value: registration?.icp, label: m.footer_icp },
    {
      kind: 'publicSecurity',
      value: registration?.publicSecurity,
      label: m.footer_publicSecurity,
      lead: (
        <img
          src={publicSecurityEmblem}
          alt=""
          width={36}
          height={40}
          {...stylex.props(styles.emblem)}
        />
      ),
    },
  ]
  return (
    <div
      data-testid="site-registration"
      {...stylex.props(styles.links, align === 'start' && styles.start, xstyle)}
    >
      {links.map(({ kind, value, label, lead }) =>
        value === undefined ? null : (
          <a
            key={kind}
            href={value.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label({ record: value.record })}
            {...stylex.props(styles.link)}
          >
            {lead}
            <span {...stylex.props(styles.record)}>{value.record}</span>
          </a>
        ),
      )}
    </div>
  )
}

/** the records, for a shell to hand to a page that places its own last line */
export function SiteRegistrationColophon({ align }: ColophonProps) {
  return <SiteRegistrationLinks registration={useSiteRegistration()} align={align} />
}
