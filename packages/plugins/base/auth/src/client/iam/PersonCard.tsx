import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useQuery } from '@tanstack/react-query'
import type { PersonCardContext } from '@qualy/ui-contract'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@qualy/ui/hover-card'
import { PersonCell } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import { authApi } from '../api.ts'
import { authMessages as m } from '../i18n.ts'

// A person, wherever another screen names one.
//
// Every list of people in the product renders this instead of printing a
// name, so what a reader may learn about somebody is decided once, here,
// by the plugin that owns people - and so a screen listing names needs no
// authority over people beyond its own.
//
// Nothing is fetched until somebody points at a row: a table of a hundred
// names would otherwise be a hundred requests for a card nobody opened.

const styles = stylex.create({
  trigger: {
    borderRadius: tokens.radiusMd,
    textAlign: 'left',
    outlineStyle: 'none',
    boxShadow: { default: null, ':focus-visible': `0 0 0 2px ${tokens.focusRing}` },
  },
  // the card's own rhythm; its width is the adapter's
  card: { display: 'flex', flexDirection: 'column', gap: 12 },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  waiting: { display: 'flex', flexDirection: 'column', gap: 8 },
  waitingLine: { height: 16, width: 128 },
  waitingWide: { height: 16, width: '100%' },
  waitingBlock: { height: 96, width: '100%' },
  who: { display: 'flex', flexDirection: 'column', gap: 4 },
  name: { fontSize: 14, lineHeight: '1.25rem', fontWeight: 500 },
  aside: { fontSize: 12, lineHeight: '1rem', color: tokens.mutedForeground },
  facts: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, lineHeight: '1rem' },
  cardAction: { width: '100%' },
  // the dialog's own rhythm and this card's, as they have always stacked
  body: { gap: 44 },
  pairs: {
    display: 'grid',
    columnGap: 24,
    rowGap: 8,
    fontSize: 14,
    lineHeight: '1.25rem',
    gridTemplateColumns: {
      default: null,
      '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))',
    },
  },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionTitle: { fontSize: 14, lineHeight: '1.25rem', fontWeight: 500 },
  // spelled from the top: a class name alone says which class but never whose
  path: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    fontSize: 14,
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  step: { display: 'flex', alignItems: 'center', gap: 6 },
  here: { color: tokens.foreground },
  roles: { display: 'flex', flexDirection: 'column', gap: 6 },
  role: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  roleName: { fontSize: 14, lineHeight: '1.25rem' },
  row: { display: 'flex', gap: 8 },
  rowLabel: { flexShrink: 0, color: tokens.mutedForeground },
  rowValue: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
})

export default function PersonCard({ context }: { context: PersonCardContext }) {
  const [hovered, setHovered] = useState(false)
  const [open, setOpen] = useState(false)
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()

  const detail = useQuery({
    ...query.identity.getUser.queryOptions({ params: { userId: context.userId } }),
    enabled: hovered || open,
    staleTime: 60_000,
  })

  const person = detail.data ?? undefined

  return (
    <>
      <HoverCard openDelay={200} disabled={open} onOpenChange={(next) => next && setHovered(true)}>
        <HoverCardTrigger asChild>
          <button type="button" {...stylex.props(styles.trigger)} onFocus={() => setHovered(true)}>
            {/* the same two lines the plain cell draws: saying nothing where
                the id would be made the second line vanish a beat after the
                card arrived, and the row jump with it */}
            <PersonCell
              name={context.displayName}
              secondary={context.businessNo ?? format(m.personNoBusinessNo)}
            />
          </button>
        </HoverCardTrigger>
        <HoverCardContent xstyle={styles.card}>
          {detail.isError ? (
            <p {...stylex.props(styles.quiet)}>{formatError(detail.error)}</p>
          ) : person === undefined ? (
            <div {...stylex.props(styles.waiting)}>
              <Skeleton className={stylex.props(styles.waitingLine).className} />
              <Skeleton className={stylex.props(styles.waitingWide).className} />
            </div>
          ) : (
            <>
              <div {...stylex.props(styles.who)}>
                <p {...stylex.props(styles.name)}>{person.user.displayName}</p>
                <p {...stylex.props(styles.aside)}>
                  {person.user.businessNo ?? format(m.personNoBusinessNo)}
                </p>
              </div>
              <dl {...stylex.props(styles.facts)}>
                <Row label={format(m.personUserType)} value={person.user.userType?.name ?? '—'} />
                <Row
                  label={format(m.personPlacement)}
                  value={person.orgPath.map((node) => node.name).join(' / ')}
                />
              </dl>
              {person.user.status === 'disabled' && (
                <Badge variant="secondary">{format(m.personDisabled)}</Badge>
              )}
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            className={stylex.props(styles.cardAction).className}
            onClick={() => setOpen(true)}
          >
            {format(m.personOpenDetail)}
          </Button>
        </HoverCardContent>
      </HoverCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{context.displayName}</DialogTitle>
          </DialogHeader>
          <DialogBody xstyle={styles.body}>
            {detail.isError ? (
              <p {...stylex.props(styles.quiet)}>{formatError(detail.error)}</p>
            ) : person === undefined ? (
              <Skeleton className={stylex.props(styles.waitingBlock).className} />
            ) : (
              <>
                <dl {...stylex.props(styles.pairs)}>
                  <Row
                    label={format(m.personBusinessNo)}
                    value={person.user.businessNo ?? format(m.personNoBusinessNo)}
                  />
                  <Row label={format(m.personUserType)} value={person.user.userType?.name ?? '—'} />
                  <Row
                    label={format(m.personStatus)}
                    value={format(
                      person.user.status === 'disabled' ? m.personDisabled : m.personActive,
                    )}
                  />
                </dl>

                <section {...stylex.props(styles.section)}>
                  <h4 {...stylex.props(styles.sectionTitle)}>{format(m.personPlacement)}</h4>
                  {/* spelled from the top: a class name alone says which class
                      but never whose */}
                  <ol {...stylex.props(styles.path)}>
                    {person.orgPath.map((node, at) => (
                      <li key={node.id} {...stylex.props(styles.step)}>
                        {at > 0 && <span aria-hidden>/</span>}
                        <span {...stylex.props(at === person.orgPath.length - 1 && styles.here)}>
                          {node.name}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>

                <section {...stylex.props(styles.section)}>
                  <h4 {...stylex.props(styles.sectionTitle)}>{format(m.personRoles)}</h4>
                  {person.roles.length === 0 ? (
                    <p {...stylex.props(styles.quiet)}>{format(m.personNoRoles)}</p>
                  ) : (
                    <ul {...stylex.props(styles.roles)}>
                      {person.roles.map((role) => (
                        <li key={role.grantId} {...stylex.props(styles.role)}>
                          <span {...stylex.props(styles.roleName)}>{role.roleName}</span>
                          <span {...stylex.props(styles.aside)}>
                            {role.orgNodeName === null
                              ? format(m.personRoleTenantWide)
                              : format(
                                  role.coverage === 'subtree'
                                    ? m.personRoleSubtree
                                    : m.personRoleHere,
                                  { node: role.orgNodeName },
                                )}
                          </span>
                          {role.scoped && (
                            <Badge variant="outline">{format(m.personRoleScoped)}</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {format(commonMessages.close)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div {...stylex.props(styles.row)}>
      <dt {...stylex.props(styles.rowLabel)}>{label}</dt>
      <dd {...stylex.props(styles.rowValue)}>{value}</dd>
    </div>
  )
}
