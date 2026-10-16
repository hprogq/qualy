import * as stylex from '@stylexjs/stylex'
import { useDocumentContext } from '@qualy/web-runtime'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { SITE_REGISTRATION_CONTEXT, type SiteRegistration } from '../site-registration.ts'
import * as m from '#messages'

const styles = stylex.create({
  links: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 16,
    rowGap: 4,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 1.8,
    color: tokens.mutedForeground,
  },
  link: {
    color: { default: 'inherit', ':hover': tokens.foreground },
    textDecoration: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 3,
    overflowWrap: 'anywhere',
    borderRadius: 2,
    outlineOffset: 3,
  },
  footer: {
    flexShrink: 0,
    paddingInline: 24,
    paddingTop: 12,
    paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
    backgroundColor: tokens.background,
  },
})

export const useSiteRegistration = () =>
  useDocumentContext<SiteRegistration>(SITE_REGISTRATION_CONTEXT)

export const hasSiteRegistration = (registration: SiteRegistration | undefined) =>
  registration?.icp !== undefined || registration?.publicSecurity !== undefined

export function SiteRegistrationLinks({
  registration,
}: {
  registration: SiteRegistration | undefined
}) {
  if (!hasSiteRegistration(registration)) return null
  const links = [
    { kind: 'icp', value: registration?.icp, label: m.footer_icp },
    { kind: 'publicSecurity', value: registration?.publicSecurity, label: m.footer_publicSecurity },
  ]
  return (
    <div data-testid="site-registration" {...stylex.props(styles.links)}>
      {links.map(({ kind, value, label }) =>
        value === undefined ? null : (
          <a
            key={kind}
            href={value.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label({ record: value.record })}
            {...stylex.props(styles.link)}
          >
            {value.record}
          </a>
        ),
      )}
    </div>
  )
}

/** The same deployment identity on anonymous and authenticated pages. */
export function SiteRegistrationFooter() {
  const registration = useSiteRegistration()
  if (!hasSiteRegistration(registration)) return null
  return (
    <footer {...stylex.props(styles.footer)}>
      <SiteRegistrationLinks registration={registration} />
    </footer>
  )
}
