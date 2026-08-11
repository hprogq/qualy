import { useState } from 'react'
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
      <HoverCard openDelay={200} onOpenChange={(next) => next && setHovered(true)}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            className="rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onFocus={() => setHovered(true)}
          >
            <PersonCell name={context.displayName} secondary={context.businessNo ?? undefined} />
          </button>
        </HoverCardTrigger>
        <HoverCardContent className="w-72 space-y-3">
          {detail.isError ? (
            <p className="text-sm text-muted-foreground">{formatError(detail.error)}</p>
          ) : person === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-sm font-medium">{person.user.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {person.user.businessNo ?? format(m.personNoBusinessNo)}
                </p>
              </div>
              <dl className="space-y-1.5 text-xs">
                <Row label={format(m.personUserType)} value={person.user.userType.name} />
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
          <Button size="sm" variant="outline" className="w-full" onClick={() => setOpen(true)}>
            {format(m.personOpenDetail)}
          </Button>
        </HoverCardContent>
      </HoverCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{context.displayName}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {detail.isError ? (
              <p className="text-sm text-muted-foreground">{formatError(detail.error)}</p>
            ) : person === undefined ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <Row
                    label={format(m.personBusinessNo)}
                    value={person.user.businessNo ?? format(m.personNoBusinessNo)}
                  />
                  <Row label={format(m.personUserType)} value={person.user.userType.name} />
                  <Row
                    label={format(m.personStatus)}
                    value={format(
                      person.user.status === 'disabled' ? m.personDisabled : m.personActive,
                    )}
                  />
                </dl>

                <section className="space-y-2">
                  <h4 className="text-sm font-medium">{format(m.personPlacement)}</h4>
                  {/* spelled from the top: a class name alone says which class
                      but never whose */}
                  <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                    {person.orgPath.map((node, at) => (
                      <li key={node.id} className="flex items-center gap-1.5">
                        {at > 0 && <span aria-hidden>/</span>}
                        <span className={at === person.orgPath.length - 1 ? 'text-foreground' : ''}>
                          {node.name}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="space-y-2">
                  <h4 className="text-sm font-medium">{format(m.personRoles)}</h4>
                  {person.roles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{format(m.personNoRoles)}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {person.roles.map((role) => (
                        <li key={role.grantId} className="flex flex-wrap items-center gap-2">
                          <span className="text-sm">{role.roleName}</span>
                          <span className="text-xs text-muted-foreground">
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
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  )
}
