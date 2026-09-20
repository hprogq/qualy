import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { XIcon } from 'lucide-react'
import type { PeoplePickerViewContext } from '@qualy/ui-contract'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
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
import { authMessages as m } from '../i18n.ts'
import { OrgTree } from './OrgTree.tsx'

// Choosing people: the drawing, without the people.
//
// The organization is on the left because that is how somebody who does not
// know a name finds one; the people standing there are on the right, one page
// at a time, because a university is not a list anybody scrolls. What is
// chosen is people - ticking a unit would be choosing a shape, and the shape
// changes underneath afterwards.
//
// Nothing here knows where a row came from. Whoever mounts it has already
// asked their own server for a page they are allowed to show, so this file
// has no API call, no notion of a wider organization, and no say in who may
// be seen. That is what lets the same drawing serve the directory and a
// single round's roster without either one inheriting the other's authority.
//
// The one piece of state it does keep is the half-typed search: settling it
// is a property of the input, not of any caller, and two callers debouncing
// the same keystrokes separately would be two answers to one question.

const ANY = 'any'

const styles = stylex.create({
  // the units on one side, the people on the other once there is room
  // A height of its own, so the tree and the list each scroll inside it and
  // the pager under the list stays where it is: grown to whatever it held, a
  // long tree made the whole picker screens tall and put "next page" several
  // scrolls below the people it turns. The tree is the narrower half - it is
  // a way to narrow the list, and the list is what is being chosen from.
  frame: {
    display: 'grid',
    minHeight: 0,
    gap: 16,
    height: { default: null, [breakpoints.tablet]: 'min(62vh, 30rem)', [breakpoints.desktop]: 'min(62vh, 30rem)' },
    gridTemplateColumns: {
      default: null,
      [breakpoints.tablet]: 'minmax(0, 15rem) minmax(0, 1fr)',
      [breakpoints.desktop]: 'minmax(0, 17rem) minmax(0, 1fr)',
    },
  },
  side: { display: 'flex', minHeight: 0, minWidth: 0, flexDirection: 'column', gap: 8 },
  sideWide: { display: 'flex', minHeight: 0, minWidth: 0, flexDirection: 'column', gap: 12 },
  heading: { fontSize: 14, lineHeight: '1.25rem', fontWeight: 500 },
  tree: {
    minHeight: '10rem',
    // stacked on a phone there is no frame to fill, so it keeps to a share
    maxHeight: { default: '14rem', [breakpoints.tablet]: 'none', [breakpoints.desktop]: 'none' },
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

export default function PeoplePickerView({ context }: { context: PeoplePickerViewContext }) {
  const { format } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const [typed, setTyped] = useState(context.search)

  // the caller hears about the search once it has stopped moving; it is the
  // one that has to go and fetch on the strength of it
  const { search, onSearchChange } = context
  useEffect(() => {
    if (typed.trim() === search) return
    const timer = setTimeout(() => onSearchChange(typed.trim()), 300)
    return () => clearTimeout(timer)
  }, [typed, search, onSearchChange])

  const chosen = new Set(context.value)
  const blocked = new Set(context.disabled ?? [])
  const named = context.rows.filter((row) => chosen.has(row.id))

  return (
    <div {...stylex.props(styles.frame)} data-testid="people-picker">
      <div {...stylex.props(styles.side)}>
        <p {...stylex.props(styles.heading)}>{format(m.pickerUnits)}</p>
        <div {...stylex.props(styles.tree)}>
          <OrgTree
            nodes={context.nodes}
            emptyLabel={format(m.pickerNoUnits)}
            expandLabel={format(m.pickerExpand)}
            selected={context.nodeId}
            onSelect={(picked) => context.onNodeChange(picked.id)}
          />
        </div>
        {context.nodesTruncated === true && (
          <p {...stylex.props(styles.aside)}>{format(commonMessages.moreResults)}</p>
        )}
      </div>

      <div {...stylex.props(styles.sideWide)}>
        <div {...stylex.props(styles.controls)}>
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={format(m.pickerSearch, { businessNo })}
            className={stylex.props(styles.search).className}
          />
          <Select
            value={context.userTypeId === '' ? ANY : context.userTypeId}
            onValueChange={(next) => context.onUserTypeChange(next === ANY ? '' : next)}
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
              {context.userTypes.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            value={context.scope}
            onValueChange={(next) => next && context.onScopeChange(next as 'self' | 'subtree')}
          >
            <ToggleGroupItem value="self">{format(m.pickerScopeSelf)}</ToggleGroupItem>
            <ToggleGroupItem value="subtree">{format(m.pickerScopeSubtree)}</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <AsyncSection
          xstyle={styles.results}
          pending={context.pending}
          error={context.error ?? null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={context.onRetry}
          skeleton={<Skeleton className={stylex.props(styles.waiting).className} />}
        >
          {context.rows.length === 0 ? (
            <p {...stylex.props(styles.nobody)}>{format(m.pickerNobody)}</p>
          ) : (
            <ul {...stylex.props(styles.list)}>
              {context.rows.map((row) => (
                <li key={row.id} {...stylex.props(styles.row)} data-testid="people-picker-row">
                  <Checkbox
                    checked={chosen.has(row.id)}
                    disabled={blocked.has(row.id)}
                    aria-label={row.displayName}
                    onCheckedChange={() => context.onToggle(row.id)}
                  />
                  <span {...stylex.props(styles.rowName)}>
                    <PersonCell
                      name={row.displayName}
                      secondary={row.businessNo ?? format(m.personNoBusinessNo, { businessNo })}
                    />
                  </span>
                  {blocked.has(row.id) && context.disabledLabel !== undefined ? (
                    <Badge variant="secondary">{context.disabledLabel}</Badge>
                  ) : (
                    <span {...stylex.props(styles.aside)}>{row.userTypeName ?? ''}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>

        <div {...stylex.props(styles.foot)}>
          <span {...stylex.props(styles.aside)} data-testid="people-picker-count">
            {format(m.pickerChosen, { count: context.value.length })}
          </span>
          <div {...stylex.props(styles.pager)}>
            <Button disabled={!context.hasPrevious} onClick={context.onPrevious}>
              {format(m.pickerPrevious)}
            </Button>
            <Button disabled={!context.hasNext} onClick={context.onNext}>
              {format(m.pickerNext)}
            </Button>
          </div>
        </div>

        {context.value.length > 0 && context.single !== true && (
          <div {...stylex.props(styles.chips)}>
            {named.map((row) => (
              <Badge
                key={row.id}
                variant="secondary"
                className={stylex.props(styles.chip).className}
              >
                {row.displayName}
                <button
                  type="button"
                  aria-label={format(m.pickerRemove, { name: row.displayName })}
                  onClick={() => context.onToggle(row.id)}
                >
                  <XIcon {...stylex.props(styles.chipDrop)} />
                </button>
              </Badge>
            ))}
            {/* whoever was chosen on another page is counted, not named: the
                list only holds what this page was given */}
            {context.value.length > named.length && (
              <Badge variant="outline" className={stylex.props(styles.quiet).className}>
                {format(m.pickerChosenElsewhere, { count: context.value.length - named.length })}
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
