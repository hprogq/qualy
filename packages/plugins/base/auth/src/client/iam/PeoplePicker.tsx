import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useQuery } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import type { PeoplePickerContext } from '@qualy/ui-contract'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { PersonCell } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { authApi } from '../api.ts'
import { authMessages as m } from '../i18n.ts'
import { OrgTree } from './OrgTree.tsx'

// Choosing people, from the side that owns them.
//
// The organization is on the left because that is how somebody who does not
// know a name finds one; the people standing there are on the right, one page
// at a time, because a university is not a list anybody scrolls. What is
// chosen is people - ticking a unit would be choosing a shape, and the shape
// changes underneath afterwards.
//
// Everything it can show is what the server will show it: the tree is the
// caller's own reach and the list is filtered by the same authority, so this
// screen has no idea a wider organization exists.

const PAGE = 25

// a select cannot hold the empty string as a value, so "any" needs a word
const ANY = 'any'

const styles = stylex.create({
  // the units on one side, the people on the other once there is room
  frame: {
    display: 'grid',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    gap: 16,
    gridTemplateColumns: {
      default: null,
      '@media (min-width: 640px)': 'minmax(0, 1fr) minmax(0, 1.4fr)',
    },
  },
  side: { display: 'flex', minHeight: 0, minWidth: 0, flexDirection: 'column', gap: 8 },
  sideWide: { display: 'flex', minHeight: 0, minWidth: 0, flexDirection: 'column', gap: 12 },
  heading: { fontSize: 14, lineHeight: '1.25rem', fontWeight: 500 },
  tree: {
    minHeight: '14rem',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'auto',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 4,
  },
  aside: { fontSize: 12, lineHeight: '1rem', color: tokens.mutedForeground },
  controls: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  search: { height: 32, minWidth: 160, flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  typeField: { width: 'auto' },
  results: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  waiting: { minHeight: '10rem', width: '100%', flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  nobody: {
    display: 'flex',
    minHeight: '10rem',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    fontSize: 14,
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  list: {
    minHeight: '10rem',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'auto',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingInline: 12,
    paddingBlock: 8,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
  },
  rowName: { minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  foot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pager: { display: 'flex', alignItems: 'center', gap: 4 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: { gap: 4, fontWeight: 400 },
  chipDrop: { width: 12, height: 12 },
  quiet: { fontWeight: 400 },
})

export default function PeoplePicker({ context }: { context: PeoplePickerContext }) {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()

  const [node, setNode] = useState<{ id: string; name: string } | null>(null)
  const [scope, setScope] = useState<'self' | 'subtree'>('subtree')
  const [userTypeId, setUserTypeId] = useState('')
  const [search, setSearch] = useState('')
  const [settled, setSettled] = useState('')
  // the cursor stack carries the question it belongs to, so a filter change
  // cannot send the previous question's cursor: the server refuses one that
  // did not come from the question being asked, and rightly
  const [paging, setPaging] = useState<{
    question: string
    cursors: readonly (string | undefined)[]
    at: number
  }>({ question: '', cursors: [undefined], at: 0 })

  useEffect(() => {
    const timer = setTimeout(() => setSettled(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))
  const nodes = options.data?.nodes ?? []
  const here = node ?? (nodes[0] ? { id: nodes[0].orgNodeId, name: nodes[0].name } : null)

  const question = `${here?.id ?? ''}:${scope}:${settled}:${userTypeId}`
  const page = paging.question === question ? paging : { question, cursors: [undefined], at: 0 }
  const { cursors, at } = page

  const people = useQuery({
    ...query.identity.listUsers.queryOptions({
      query: {
        orgNodeId: here?.id ?? '',
        scope,
        ...(settled !== '' ? { search: settled } : {}),
        ...(userTypeId !== '' ? { userTypeId } : {}),
        ...(cursors[at] !== undefined ? { cursor: cursors[at] } : {}),
        limit: String(PAGE),
      },
    }),
    enabled: here !== null,
  })

  const nextCursor = people.data?.nextCursor ?? null
  useEffect(() => {
    if (nextCursor === null || cursors[at + 1] === nextCursor) return
    setPaging({ question, cursors: [...cursors.slice(0, at + 1), nextCursor], at })
  }, [nextCursor, at, cursors, question])

  const chosen = new Set(context.value)
  const blocked = new Set(context.disabled ?? [])
  const rows = people.data?.items ?? []

  const toggle = (userId: string) => {
    if (blocked.has(userId)) return
    if (context.single === true) {
      context.onChange(chosen.has(userId) ? [] : [userId])
      return
    }
    const next = new Set(chosen)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    context.onChange([...next])
  }

  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.side)}>
        <p {...stylex.props(styles.heading)}>{format(m.pickerUnits)}</p>
        <div {...stylex.props(styles.tree)}>
          <OrgTree
            nodes={nodes.map((row) => ({
              id: row.orgNodeId,
              name: row.name,
              parentId: row.parentId,
            }))}
            emptyLabel={format(m.pickerNoUnits)}
            expandLabel={format(m.pickerExpand)}
            selected={here?.id ?? null}
            onSelect={(picked) => setNode({ id: picked.id, name: picked.name })}
          />
        </div>
        {options.data?.truncated === true && (
          <p {...stylex.props(styles.aside)}>{format(commonMessages.moreResults)}</p>
        )}
      </div>

      <div {...stylex.props(styles.sideWide)}>
        <div {...stylex.props(styles.controls)}>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={format(m.pickerSearch)}
            className={stylex.props(styles.search).className}
          />
          <Select
            value={userTypeId === '' ? ANY : userTypeId}
            onValueChange={(next) => setUserTypeId(next === ANY ? '' : next)}
          >
            <SelectTrigger
              size="sm"
              xstyle={styles.typeField}
              aria-label={format(m.personUserType)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{format(m.pickerAnyType)}</SelectItem>
              {(options.data?.userTypes ?? []).map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            value={scope}
            onValueChange={(next) => next && setScope(next as 'self' | 'subtree')}
          >
            <ToggleGroupItem value="self">{format(m.pickerScopeSelf)}</ToggleGroupItem>
            <ToggleGroupItem value="subtree">{format(m.pickerScopeSubtree)}</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <AsyncSection
          xstyle={styles.results}
          pending={people.isPending && here !== null}
          error={people.isError ? formatError(people.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void people.refetch()}
          skeleton={<Skeleton className={stylex.props(styles.waiting).className} />}
        >
          {rows.length === 0 ? (
            <p {...stylex.props(styles.nobody)}>{format(m.pickerNobody)}</p>
          ) : (
            <ul {...stylex.props(styles.list)}>
              {rows.map((row) => (
                <li key={row.id} {...stylex.props(styles.row)}>
                  <Checkbox
                    checked={chosen.has(row.id)}
                    disabled={blocked.has(row.id)}
                    aria-label={row.displayName}
                    onCheckedChange={() => toggle(row.id)}
                  />
                  <span {...stylex.props(styles.rowName)}>
                    <PersonCell
                      name={row.displayName}
                      secondary={row.businessNo ?? format(m.personNoBusinessNo)}
                    />
                  </span>
                  {blocked.has(row.id) ? (
                    <Badge variant="secondary">{format(m.pickerAlreadyIn)}</Badge>
                  ) : (
                    <span {...stylex.props(styles.aside)}>{row.userType?.name ?? '—'}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>

        <div {...stylex.props(styles.foot)}>
          <span {...stylex.props(styles.aside)}>
            {format(m.pickerChosen, { count: context.value.length })}
          </span>
          <div {...stylex.props(styles.pager)}>
            <Button
              disabled={at === 0}
              onClick={() => setPaging({ question, cursors, at: Math.max(0, at - 1) })}
            >
              {format(m.pickerPrevious)}
            </Button>
            <Button
              disabled={nextCursor === null}
              onClick={() => setPaging({ question, cursors, at: at + 1 })}
            >
              {format(m.pickerNext)}
            </Button>
          </div>
        </div>

        {context.value.length > 0 && context.single !== true && (
          <div {...stylex.props(styles.chips)}>
            {rows
              .filter((row) => chosen.has(row.id))
              .map((row) => (
                <Badge
                  key={row.id}
                  variant="secondary"
                  className={stylex.props(styles.chip).className}
                >
                  {row.displayName}
                  <button
                    type="button"
                    aria-label={format(m.pickerRemove, { name: row.displayName })}
                    onClick={() => toggle(row.id)}
                  >
                    <XIcon {...stylex.props(styles.chipDrop)} />
                  </button>
                </Badge>
              ))}
            {/* whoever was chosen on another page is counted, not named: the
                list only holds what this page fetched */}
            {context.value.length > rows.filter((row) => chosen.has(row.id)).length && (
              <Badge variant="outline" className={stylex.props(styles.quiet).className}>
                {format(m.pickerChosenElsewhere, {
                  count: context.value.length - rows.filter((row) => chosen.has(row.id)).length,
                })}
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
