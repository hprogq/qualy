import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { CornerDownLeftIcon, SearchIcon } from 'lucide-react'
import { useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Spinner } from '@qualy/ui/spinner'
import { iamMessages as m } from '../../i18n.ts'
import { authApi } from '../../api.ts'

// Straight to one person, from anywhere on the roster.
//
// Somebody who already knows who they want does not want the tree, the
// filters or the pages: they want to type a name or a number and be there.
// So this is a box and a short list under it, driven from the keyboard -
// arrows move, Enter goes - and it looks across the whole tenant rather than
// the unit the roster happens to be showing.
//
// The box is told in every way a browser listens to that it is not a login
// or an address: a search for other people is exactly what a password
// manager likes to fill with the reader's own name.

const FOUND = 8

const styles = stylex.create({
  box: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 10 },
  list: {
    display: 'flex',
    minHeight: '17rem',
    flexDirection: 'column',
    gap: 2,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  row: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    paddingInline: 10,
    paddingBlock: 7,
    borderRadius: 8,
    cursor: 'pointer',
  },
  rowLit: { backgroundColor: tokens.surfaceMuted },
  face: {
    display: 'inline-flex',
    width: 30,
    height: 30,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 12.5,
    fontWeight: 600,
    color: tokens.surfaceMutedForeground,
  },
  faceLit: { backgroundColor: tokens.surface },
  words: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 1 },
  name: { display: 'flex', minWidth: 0, alignItems: 'baseline', gap: 8, fontSize: 13.5 },
  number: { fontSize: 12, fontVariantNumeric: 'tabular-nums', color: tokens.mutedForeground },
  where: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  go: { width: 13, height: 13, flexShrink: 0, color: tokens.mutedForeground },
  note: { margin: 0, paddingInline: 10, paddingBlock: 12, fontSize: 13, color: tokens.mutedForeground },
  glass: { width: 15, height: 15, color: tokens.mutedForeground },
})

export function UserJump({
  rootNodeId,
  businessNo,
}: {
  /** the unit the search runs under: the top of what this reader may see */
  rootNodeId: string | undefined
  /** the tenant's own word for a person's number */
  businessNo: string
}) {
  const query = useApiQuery(authApi)
  const navigate = usePageNavigate()
  const { format } = useI18n()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [asked, setAsked] = useState('')
  const [lit, setLit] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  // typing should not fire a request per keystroke
  useEffect(() => {
    const timer = setTimeout(() => setAsked(typed.trim()), 200)
    return () => clearTimeout(timer)
  }, [typed])

  const found = useQuery({
    ...query.identity.listUsers.queryOptions({
      query: {
        orgNodeId: rootNodeId ?? '',
        scope: 'subtree',
        search: asked,
        page: '1',
        limit: String(FOUND),
      },
    }),
    enabled: open && rootNodeId !== undefined && asked !== '',
    placeholderData: keepPreviousData,
  })
  const people = asked === '' ? [] : (found.data?.items ?? [])
  useEffect(() => setLit(0), [asked])

  const go = (userId: string) => {
    setOpen(false)
    setTyped('')
    navigate('auth/user-detail', { params: { userId } })
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        data-testid="user-jump-open"
        onClick={() => setOpen(true)}
      >
        <SearchIcon aria-hidden />
        {format(m.jumpOpen)}
      </Button>
      <FormDialog
        open={open}
        size="medium"
        title={format(m.jumpOpen)}
        onClose={() => setOpen(false)}
      >
        <div {...stylex.props(styles.box)} data-testid="user-jump">
          <Input
            autoFocus
            // none of these is a login, an address or a name of the reader's
            // own, and every one of them is a way a browser decides it is
            type="search"
            name="qualy-person-lookup"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            data-form-type="other"
            role="combobox"
            aria-expanded={people.length > 0}
            aria-controls="user-jump-found"
            aria-activedescendant={people[lit] === undefined ? undefined : `user-jump-${people[lit].id}`}
            aria-label={format(m.jumpLabel, { businessNo })}
            placeholder={format(m.jumpLabel, { businessNo })}
            lead={<SearchIcon aria-hidden {...stylex.props(styles.glass)} />}
            tail={found.isFetching ? <Spinner /> : undefined}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (people.length === 0) return
                const next =
                  (lit + (event.key === 'ArrowDown' ? 1 : -1) + people.length) % people.length
                setLit(next)
                listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' })
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const chosen = people[lit]
                if (chosen !== undefined) go(chosen.id)
              }
            }}
          />
          <ul ref={listRef} id="user-jump-found" role="listbox" {...stylex.props(styles.list)}>
            {asked === '' ? (
              <li role="presentation" {...stylex.props(styles.note)}>
                {format(m.jumpHint, { businessNo })}
              </li>
            ) : people.length === 0 && !found.isFetching ? (
              <li role="presentation" {...stylex.props(styles.note)} data-testid="user-jump-none">
                {format(m.jumpNone)}
              </li>
            ) : (
              people.map((person, index) => (
                <li
                  key={person.id}
                  id={`user-jump-${person.id}`}
                  role="option"
                  aria-selected={index === lit}
                  data-testid="user-jump-option"
                  {...stylex.props(styles.row, index === lit && styles.rowLit)}
                  onPointerMove={() => setLit(index)}
                  onClick={() => go(person.id)}
                >
                  <span aria-hidden {...stylex.props(styles.face, index === lit && styles.faceLit)}>
                    {[...person.displayName][0] ?? ''}
                  </span>
                  <span {...stylex.props(styles.words)}>
                    <span {...stylex.props(styles.name)}>
                      <span>{person.displayName}</span>
                      <span {...stylex.props(styles.number)}>
                        {person.businessNo ?? format(m.personNoBusinessNo, { businessNo })}
                      </span>
                    </span>
                    <span {...stylex.props(styles.where)}>
                      {[person.userType?.name, person.primaryOrgNode?.name]
                        .filter((word) => word !== undefined && word !== '')
                        .join('  ')}
                    </span>
                  </span>
                  {index === lit && <CornerDownLeftIcon aria-hidden {...stylex.props(styles.go)} />}
                </li>
              ))
            )}
          </ul>
        </div>
      </FormDialog>
    </>
  )
}
