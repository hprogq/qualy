import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Blank, EditorSkeleton, RailSkeleton, Screen } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { PlusIcon, UsersRoundIcon } from 'lucide-react'
import { iamMessages as m } from '../i18n.ts'
import { UserTypeEditor } from './UserTypeEditor.tsx'
import { NewUserTypeForm } from './NewUserTypeForm.tsx'
import { authApi } from '../api.ts'

// User types: the placement policy and standing of a class of people. A
// handful of rows, so the list stays beside the one being edited; the
// selection lives in the query string so it stays linkable.
const styles = stylex.create({
  // the list beside what it opens, once there is room for both
  frame: {
    display: 'grid',
    alignItems: 'start',
    gap: 24,
    gridTemplateColumns: {
      default: null,
      '@media (min-width: 1024px)': '19rem minmax(0, 1fr)',
    },
  },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  list: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  row: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 10,
    textAlign: 'left',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  rowOpen: { backgroundColor: tokens.surfaceMuted },
  rowHead: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  nameOpen: { fontWeight: 600 },
  mark: { flexShrink: 0, fontSize: 12, lineHeight: '1rem', color: tokens.mutedForeground },
  markOff: { flexShrink: 0, fontSize: 12, lineHeight: '1rem', color: tokens.danger },
  spacer: { flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  count: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: '1rem',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  summary: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
})

export default function UserTypesPage() {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const [selected, setSelected] = usePageQueryState('type')
  const [creating, setCreating] = useState(false)

  const types = useQuery(query.identity.listUserTypes.queryOptions({}))
  const canManage = types.data?.capabilities.canManage ?? false
  const current = types.data?.userTypes.find((type) => type.id === selected)

  return (
    <Screen
      title={format(m.userTypesTitle)}
      description={format(m.userTypesHint)}
      actions={
        canManage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden />
            {format(m.newUserType)}
          </Button>
        )
      }
    >
      <AsyncSection
        pending={types.isPending}
        error={types.isError ? formatError(types.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void types.refetch()}
      >
        <div {...stylex.props(styles.frame)}>
          {(types.data?.userTypes ?? []).length === 0 ? (
            <p {...stylex.props(styles.quiet)}>{format(m.userTypesEmpty)}</p>
          ) : (
            <div {...stylex.props(styles.list)}>
              {(types.data?.userTypes ?? []).map((type) => (
                <button
                  key={type.id}
                  type="button"
                  aria-current={type.id === selected}
                  {...stylex.props(styles.row, type.id === selected && styles.rowOpen)}
                  onClick={() => setSelected(type.id === selected ? '' : type.id)}
                >
                  <span {...stylex.props(styles.rowHead)}>
                    <span {...stylex.props(styles.name, type.id === selected && styles.nameOpen)}>
                      {type.name}
                    </span>
                    {type.isSystem && (
                      <span {...stylex.props(styles.mark)}>{format(m.systemBadge)}</span>
                    )}
                    {type.status === 'disabled' && (
                      <span {...stylex.props(styles.markOff)}>{format(m.disabledBadge)}</span>
                    )}
                    <span {...stylex.props(styles.spacer)} />
                    <span {...stylex.props(styles.count)}>
                      {format(m.userCount, { count: type.userCount })}
                    </span>
                  </span>
                  <span
                    data-testid="type-summary"
                    data-users={String(type.userCount)}
                    data-placement={type.placementPolicy.mode}
                    {...stylex.props(styles.summary)}
                  >
                    {type.placementPolicy.mode === 'allow-list'
                      ? format(m.placementCount, {
                          count: type.placementPolicy.orgTypeIds.length,
                        })
                      : format(
                          type.placementPolicy.mode === 'tenant-root'
                            ? m.placementTenantRoot
                            : m.placementUnrestricted,
                        )}
                  </span>
                </button>
              ))}
            </div>
          )}

          {current ? (
            <UserTypeEditor userType={current} canManage={canManage} />
          ) : (
            <Blank
              icon={<UsersRoundIcon />}
              title={format(m.pickTypeTitle)}
              description={format(m.pickTypeBody)}
            />
          )}
        </div>
      </AsyncSection>

      {canManage && (
        <NewUserTypeForm
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setSelected(id)
          }}
        />
      )}
    </Screen>
  )
}
