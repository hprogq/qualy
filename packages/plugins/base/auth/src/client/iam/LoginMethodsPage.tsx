import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import {
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
  GripVerticalIcon,
  PlusIcon,
} from 'lucide-react'
import { MAX_PRIMARY_LOGIN_METHODS } from '@qualy/auth-contract/login-icons'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { useIsBelow } from '@qualy/ui/use-mobile'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { toast } from '@qualy/ui/toast'
import { useApi, useApiQuery, usePageQueryState, useRunApi } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { useLingering } from '@qualy/ui/use-lingering'
import { Badge } from '@qualy/ui/badge'
import {
  BandAction,
  BandActions,
  Card,
  CardEmpty,
  CardHead,
  Cell,
  LeadWord,
  Screen,
  Status,
  Table,
  TableSkeleton,
  TableHead,
  TableRow,
} from '@qualy/ui/screen'
import { iamMessages as m } from '../i18n.ts'
import { MethodSheet } from './methods/MethodSheet.tsx'
import { NewMethodDialog } from './methods/NewMethodDialog.tsx'
import { authApi } from '../api.ts'
import { LoginMethodGlyph } from '../sign-in/glyph.tsx'
import { gapped } from '../sign-in/gapped.ts'

// The tenant's doors, and who each one lets through.
//
// The audience lives on the door rather than on the user type, because that
// is where the question is actually decided: "can a student sign in" has no
// answer until you say through which entrance. The password door is the
// platform's; doors of the other kinds the assembly offers are added here,
// set up on their own sheet, and deleted there.

// the status column holds its longest word, "setup incomplete" with its mark, uncut
const COLUMNS = '1.5rem minmax(0, 0.8fr) 6rem minmax(0, 1.4fr) 6.5rem 7.5rem'

const styles = stylex.create({
  // The two groups ARE the sign-in page - the ways listed in full, then the
  // rest - so a door is placed by putting its row where it belongs, in its
  // group or into the other. Dragging is a pointer's way and does not exist
  // on a touch screen at all, so a phone gets a menu and a pointer the handle.
  order: { display: 'flex', alignItems: 'center', gap: 2 },
  // stacked, it rides in the same cell as the standing, just before it: one
  // thing at the row's end, centred against the whole row
  standing: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  step: {
    display: 'inline-flex',
    width: { default: 30, [breakpoints.phone]: 36 },
    height: { default: 30, [breakpoints.phone]: 36 },
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: {
      default: tokens.mutedForeground,
      ':disabled': `color-mix(in oklab, ${tokens.mutedForeground} 45%, transparent)`,
    },
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
  stepGlyph: { width: 15, height: 15 },
  grip: {
    display: { default: 'inline-flex', [breakpoints.phone]: 'none' },
    width: 20,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderWidth: 0,
    borderRadius: 5,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: tokens.mutedForeground,
    cursor: 'grab',
  },
  gripGlyph: { width: 14, height: 14 },
  over: { boxShadow: `inset 0 2px 0 ${tokens.foreground}` },
  lifted: { opacity: 0.45 },
  groups: { display: 'flex', flexDirection: 'column', gap: 16 },
  fill: { fontSize: 13, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  // an empty group is still somewhere to put a door
  drop: {
    marginInline: 16,
    marginBottom: 16,
    paddingBlock: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.border,
    textAlign: 'center',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  dropOver: { borderColor: tokens.foreground, color: tokens.foreground },
})

export default function LoginMethodsPage() {
  const query = useApiQuery(authApi)
  const { format, formatText, formatError, locale } = useI18n()
  const listJoin = useList()
  const [selected, setSelected] = usePageQueryState('provider')

  const api = useApi(authApi)
  const runApi = useRunApi()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const phone = useIsBelow(768)
  const [lifted, setLifted] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const providers = useQuery(query.identity.listAuthProviders.queryOptions())
  const kinds = useQuery({ ...query.identity.listAuthProviderKinds.queryOptions(), retry: false })
  const types = useQuery(query.identity.listUserTypes.queryOptions())
  const rows = providers.data?.providers ?? []
  const userTypes = types.data?.userTypes ?? []
  const open = rows.find((provider) => provider.id === selected)
  const shown = useLingering(open ?? null)
  const canManage = types.data?.capabilities.canManage ?? false
  const primaryRows = rows.filter((row) => row.prominence === 'primary')
  const secondaryRows = rows.filter((row) => row.prominence === 'secondary')
  const arrange = useMutation({
    mutationFn: (arrangement: { primary: string[]; secondary: string[] }) =>
      runApi(api.identity.setAuthProviderOrder({ payload: arrangement })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: query.identity.key() }),
    onError: (error: unknown) => toast.error(formatError(error)),
  })
  type Group = 'primary' | 'secondary'
  const groups = () => ({
    primary: primaryRows.map((row) => row.id),
    secondary: secondaryRows.map((row) => row.id),
  })
  /**
   * The sign-in page with one door taken out and put back in front of
   * another, or at the end of a group. Into a full group of main ways in it
   * does not go: the page has room for three, and saying so beats a refusal.
   */
  const place = (moving: string, into: Group, before: string | null) => {
    const next = groups()
    const from: Group = next.primary.includes(moving) ? 'primary' : 'secondary'
    if (
      into === 'primary' &&
      from !== 'primary' &&
      next.primary.length >= MAX_PRIMARY_LOGIN_METHODS
    ) {
      toast.error(format(m.methodsPrimaryFull, { most: MAX_PRIMARY_LOGIN_METHODS }))
      return
    }
    next[from] = next[from].filter((id) => id !== moving)
    const at = before === null ? -1 : next[into].indexOf(before)
    if (at === -1) next[into].push(moving)
    else next[into].splice(at, 0, moving)
    arrange.mutate(next)
  }
  /** one step up or down inside its own group */
  const step = (id: string, by: 1 | -1) => {
    const next = groups()
    const group: Group = next.primary.includes(id) ? 'primary' : 'secondary'
    const ids = next[group]
    const at = ids.indexOf(id)
    const to = at + by
    if (to < 0 || to >= ids.length) return
    ;[ids[at], ids[to]] = [ids[to]!, ids[at]!]
    arrange.mutate(next)
  }

  /**
   * The one press that moves a method, on a phone.
   *
   * Two arrows of six-and-twenty pixels inside a row that itself opens the
   * method were a pair of targets a thumb could not tell apart, and a
   * mis-hit silently reordered the sign-in page. A mis-hit opens a menu now.
   * A pointer drags the handle and a keyboard walks it with the arrow keys.
   */
  const order = (
    provider: { id: string; name: string; prominence: Group },
    index: number,
    count: number,
  ) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={format(m.methodMove, { name: gapped(provider.name, locale) })}
          data-testid="method-order"
          {...stylex.props(styles.step)}
        >
          <ChevronsUpDownIcon aria-hidden {...stylex.props(styles.stepGlyph)} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={index === 0}
          data-testid="method-up"
          onSelect={() => step(provider.id, -1)}
        >
          <ChevronUpIcon aria-hidden />
          {format(m.methodMoveUp, { name: gapped(provider.name, locale) })}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === count - 1}
          data-testid="method-down"
          onSelect={() => step(provider.id, 1)}
        >
          <ChevronDownIcon aria-hidden />
          {format(m.methodMoveDown, { name: gapped(provider.name, locale) })}
        </DropdownMenuItem>
        {provider.prominence === 'secondary' ? (
          <DropdownMenuItem
            disabled={primaryRows.length >= MAX_PRIMARY_LOGIN_METHODS}
            data-testid="method-to-primary"
            onSelect={() => place(provider.id, 'primary', null)}
          >
            <ArrowUpToLineIcon aria-hidden />
            {format(m.methodToPrimary, { name: gapped(provider.name, locale) })}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            data-testid="method-to-secondary"
            onSelect={() => place(provider.id, 'secondary', null)}
          >
            <ArrowDownToLineIcon aria-hidden />
            {format(m.methodToSecondary, { name: gapped(provider.name, locale) })}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  /** one group of the sign-in page, in its order, and somewhere to drop a door into it */
  const group = (into: Group, members: typeof rows) => {
    const full = into === 'primary' && members.length >= MAX_PRIMARY_LOGIN_METHODS
    const refuses = (id: string | null) =>
      id !== null && full && !members.some((member) => member.id === id)
    return (
      <Card
        data-testid={`method-group-${into}`}
        data-count={members.length}
        onDragOver={(event) => {
          if (lifted === null || refuses(lifted)) return
          event.preventDefault()
          if (members.length === 0) setOver(`group:${into}`)
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (lifted !== null && !refuses(lifted)) place(lifted, into, null)
          setLifted(null)
          setOver(null)
        }}
      >
        <CardHead
          title={format(into === 'primary' ? m.methodsPrimaryTitle : m.methodsSecondaryTitle)}
          sub={format(into === 'primary' ? m.methodsPrimaryHint : m.methodsSecondaryHint)}
        >
          {/* how full the group is, at the far end where a count is read */}
          {into === 'primary' && (
            <span data-testid="method-primary-count" {...stylex.props(styles.fill)}>
              {format(m.methodsPrimaryNote, {
                count: members.length,
                most: MAX_PRIMARY_LOGIN_METHODS,
              })}
            </span>
          )}
        </CardHead>
        {members.length === 0 ? (
          <div
            data-testid={`method-drop-${into}`}
            {...stylex.props(styles.drop, over === `group:${into}` && styles.dropOver)}
          >
            {format(canManage ? m.methodsDropHere : m.loginMethodsEmpty)}
          </div>
        ) : (
          // a kind and who may use it read as one line under the name; the
          // one that runs out of room loses its end rather than the row
          // gaining a line
          <Table columns={COLUMNS} openable facts="line">
            <TableHead>
              <span />
              <span>{format(m.loginMethodsTitle)}</span>
              <span>{format(m.providerKindLabel)}</span>
              <span>{format(m.audienceLegend)}</span>
              <span>{format(m.providerOrderLabel)}</span>
              <span>{format(m.columnStatus)}</span>
            </TableHead>
            {members.map((provider, index) => {
              const nobody =
                provider.audience.mode === 'allow-list' &&
                provider.audience.userTypeIds.length === 0
              return (
                <TableRow
                  key={provider.id}
                  nested
                  xstyle={[
                    over === provider.id && styles.over,
                    lifted === provider.id && styles.lifted,
                  ]}
                  onDragOver={(event) => {
                    if (lifted === null || lifted === provider.id || refuses(lifted)) return
                    event.preventDefault()
                    event.stopPropagation()
                    setOver(provider.id)
                  }}
                  onDragLeave={() => setOver((now) => (now === provider.id ? null : now))}
                  onDrop={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (lifted !== null && lifted !== provider.id && !refuses(lifted)) {
                      place(lifted, into, provider.id)
                    }
                    setLifted(null)
                    setOver(null)
                  }}
                  onOpen={() => setSelected(provider.id)}
                  selected={provider.id === open?.id}
                  data-testid="method-row"
                  data-code={provider.code}
                  data-prominence={provider.prominence}
                  data-recommended={provider.recommended}
                  data-status={provider.status}
                  data-setup={provider.setup}
                  data-audience={
                    provider.audience.mode === 'unrestricted'
                      ? 'everyone'
                      : String(provider.audience.userTypeIds.length)
                  }
                >
                  {/* the column the drag handle rides in is a pointer's;
                      stacked there is no such column, and a seat held open
                      for it opened a row of its own under the facts */}
                  {phone ? null : canManage ? (
                    <span {...stylex.props(styles.order)}>
                      <button
                        type="button"
                        draggable
                        aria-label={format(m.methodMove, { name: gapped(provider.name, locale) })}
                        data-testid="method-grip"
                        {...stylex.props(styles.grip)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', provider.id)
                          setLifted(provider.id)
                        }}
                        onDragEnd={() => {
                          setLifted(null)
                          setOver(null)
                        }}
                        // the same move without a pointer
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowUp') step(provider.id, -1)
                          else if (event.key === 'ArrowDown') step(provider.id, 1)
                          else return
                          event.preventDefault()
                        }}
                      >
                        <GripVerticalIcon aria-hidden {...stylex.props(styles.gripGlyph)} />
                      </button>
                    </span>
                  ) : (
                    <span />
                  )}
                  <Cell lead>
                    <LoginMethodGlyph
                      code={provider.code}
                      name={provider.name}
                      icon={provider.icon}
                      size={18}
                    />
                    <LeadWord>{provider.name}</LeadWord>
                    {provider.recommended && (
                      <Badge variant="secondary">{format(m.methodRecommendedBadge)}</Badge>
                    )}
                  </Cell>
                  {/* the kind as the driver names itself; its code only
                      where no installed driver claims it */}
                  <Cell tone="muted" unlabelled>
                    {provider.kindLabel === null ? provider.type : formatText(provider.kindLabel)}
                  </Cell>
                  <Cell tone={nobody ? 'warn' : 'muted'}>
                    {provider.audience.mode === 'unrestricted' ? (
                      format(m.audienceEveryone)
                    ) : nobody ? (
                      <Status tone="warn">{format(m.audienceSummary, { count: 0 })}</Status>
                    ) : (
                      listJoin(
                        userTypes
                          .filter(
                            (type) =>
                              provider.audience.mode === 'allow-list' &&
                              provider.audience.userTypeIds.includes(type.id),
                          )
                          .map((type) => type.name),
                      )
                    )}
                  </Cell>
                  {/* the place in its group, a table's fact and not a phone's */}
                  <Cell tone="muted" numeric narrow="drop">
                    {index + 1}
                  </Cell>
                  <Cell tone="muted" narrow="end" unlabelled>
                    <span {...stylex.props(styles.standing)}>
                      {canManage && phone && order(provider, index, members.length)}
                      <Status tone={provider.status === 'active' ? 'plain' : 'bad'}>
                        {format(
                          provider.status === 'active'
                            ? m.typeEnabled
                            : provider.setup === 'complete'
                              ? m.statusDisabled
                              : m.methodSetupShort,
                        )}
                      </Status>
                    </span>
                  </Cell>
                </TableRow>
              )
            })}
          </Table>
        )}
      </Card>
    )
  }

  return (
    <Screen
      title={format(m.loginMethodsTitle)}
      description={format(m.loginMethodsHint)}
      actions={
        canManage &&
        (kinds.data?.kinds.length ?? 0) > 0 && (
          <BandActions
            moreLabel={format(commonMessages.bandMore)}
            primary={
              <BandAction
                variant="primary"
                icon={<PlusIcon aria-hidden />}
                onSelect={() => setCreating(true)}
              >
                {format(m.methodNew)}
              </BandAction>
            }
          />
        )
      }
    >
      <AsyncSection
        pending={providers.isPending}
        error={providers.isError ? formatError(providers.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void providers.refetch()}
        skeleton={<TableSkeleton />}
      >
        {rows.length === 0 ? (
          <Card>
            <CardEmpty>{format(m.loginMethodsEmpty)}</CardEmpty>
          </Card>
        ) : (
          <div {...stylex.props(styles.groups)}>
            {group('primary', primaryRows)}
            {group('secondary', secondaryRows)}
          </div>
        )}
      </AsyncSection>

      {shown !== null && (
        <MethodSheet
          key={shown.id}
          open={open !== undefined}
          provider={shown}
          position={
            (shown.prominence === 'primary' ? primaryRows : secondaryRows).findIndex(
              (provider) => provider.id === shown.id,
            ) + 1
          }
          userTypes={userTypes}
          kind={kinds.data?.kinds.find((kind) => kind.type === shown.type)}
          canManage={canManage}
          onClose={() => setSelected('')}
        />
      )}
      <NewMethodDialog
        open={creating}
        kinds={kinds.data?.kinds ?? []}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          setSelected(id)
        }}
      />
    </Screen>
  )
}
