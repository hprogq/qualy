import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Card, CardEmpty, SectionHead, TableSkeleton, Tag } from '@qualy/ui/screen'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { rbacMessages as m } from './i18n.ts'
import { accessApi } from './api.ts'
import { GrantOrigin } from './GrantOrigin.tsx'
import { useMoment } from './when.ts'

// The reader's own roles, read-only: each role they hold, where it holds and
// for how long, and what it lets them do, by name. What a reader can act on
// here is nothing - who holds what is decided elsewhere - so it answers the
// one question somebody brings: why can I do this, or why can I not.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingInline: 16,
    paddingBlock: 14,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  head: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 4 },
  name: { fontSize: 14.5, fontWeight: 600 },
  where: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 2,
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  powers: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  toggle: { alignSelf: 'flex-start', marginInlineStart: -8 },
})

type Role = ApiResult<typeof accessApi, 'access', 'listSelfRoles'>['roles'][number]

export default function AccountRolesPage() {
  const query = useApiQuery(accessApi)
  const { format, formatError } = useI18n()
  const roles = useQuery(query.access.listSelfRoles.queryOptions({}))
  const items = roles.data?.roles ?? []
  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead title={format(m.accountRolesTitle)} />
      <AsyncSection
        pending={roles.isPending}
        error={roles.isError ? formatError(roles.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void roles.refetch()}
        skeleton={
          <Card>
            <TableSkeleton rows={2} />
          </Card>
        }
      >
        <Card data-testid="account-roles">
          {items.length === 0 ? (
            <CardEmpty>{format(m.accountRolesEmpty)}</CardEmpty>
          ) : (
            items.map((role) => <RoleRow key={role.grantId} role={role} />)
          )}
        </Card>
      </AsyncSection>
    </div>
  )
}

/** how many of a role's powers show before the rest are asked for */
const SHOWN = 8

function RoleRow({ role }: { role: Role }) {
  const { format, formatText } = useI18n()
  const moment = useMoment()
  const [open, setOpen] = useState(false)
  const where =
    role.target.kind === 'tenant'
      ? format(m.tenantWide)
      : role.target.coverage === 'subtree'
        ? format(m.atSubtree, { node: role.target.orgNodeName })
        : format(m.atNode, { node: role.target.orgNodeName })
  const powers = open ? role.permissions : role.permissions.slice(0, SHOWN)
  return (
    <div
      data-testid="account-role"
      data-confined={role.resource !== null}
      data-all={role.allPermissions}
      {...stylex.props(styles.row)}
    >
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.name)}>{role.roleName}</span>
        <span {...stylex.props(styles.where)}>
          {role.resource === null ? (
            <span>{where}</span>
          ) : (
            <GrantOrigin
              grant={{
                id: role.grantId,
                roleName: role.roleName,
                resource: role.resource,
                validFrom: role.validFrom,
                validUntil: role.validUntil,
              }}
            />
          )}
          {role.validFrom !== null && new Date(role.validFrom).getTime() > Date.now() && (
            <span>{format(m.validFrom, { when: moment(role.validFrom) })}</span>
          )}
          {role.validUntil !== null && (
            <span>{format(m.validUntil, { when: moment(role.validUntil) })}</span>
          )}
        </span>
      </div>
      {role.allPermissions ? (
        <span {...stylex.props(styles.where)}>{format(m.accountRolesAll)}</span>
      ) : role.permissions.length === 0 ? null : (
        <>
          <div {...stylex.props(styles.powers)}>
            {powers.map((power) => (
              <Tag key={power.code}>{formatText(power.name)}</Tag>
            ))}
          </div>
          {role.permissions.length > SHOWN && (
            <Button
              size="xs"
              variant="ghost"
              className={stylex.props(styles.toggle).className}
              onClick={() => setOpen((was) => !was)}
            >
              {open
                ? format(m.accountRolesFewer)
                : format(m.accountRolesMore, { count: role.permissions.length - SHOWN })}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
