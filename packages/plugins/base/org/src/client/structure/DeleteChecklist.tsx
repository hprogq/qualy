import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, XIcon } from 'lucide-react'
import { PageLink, useApiQuery, usePageHref } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Card, CardHead } from '@qualy/ui/screen'
import type { NamespacedId } from '@qualy/ui-contract'
import { Skeleton } from '@qualy/ui/skeleton'
import { orgMessages as m } from '../i18n.ts'
import { orgApi } from '../api.ts'

// What has to be true before a unit can go, as a list that says which of it
// already is.
//
// The old line said people and grants "are checked on delete", and then the
// delete failed saying something still used the unit - leaving the reader to
// search the product for a reference no screen would show them. Everything
// that holds the unit is asked for up front instead, each with how many, a
// few by name, and the way to where they can be dealt with. The button is
// live only once every line is clear.

const styles = stylex.create({
  list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
  line: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    paddingInline: 16,
    paddingBlock: 9,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  mark: {
    display: 'inline-flex',
    width: 16,
    height: 16,
    marginTop: 1,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
  },
  markClear: { color: tokens.success },
  markHeld: { color: tokens.danger },
  glyph: { width: 13, height: 13 },
  words: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 2 },
  what: { fontSize: 13 },
  which: { fontSize: 12, lineHeight: 1.5, color: tokens.mutedForeground },
  way: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.surfaceMutedForeground,
    textDecorationLine: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 3,
  },
  foot: { display: 'flex', alignItems: 'center', gap: 12, paddingInline: 16, paddingBlock: 12 },
  verdict: {
    minWidth: 0,
    flexGrow: 1,
    fontSize: 12,
    lineHeight: 1.5,
    color: tokens.mutedForeground,
  },
  bone: { marginInline: 16, marginBlock: 12 },
})

function Way({
  pageId,
  params,
  search,
  children,
}: {
  pageId: string
  params: Readonly<Record<string, string>>
  search: Readonly<Record<string, string>>
  children: string
}) {
  // a page this reader may not open is not offered as a way
  const href = usePageHref(pageId as NamespacedId, { params, search })
  if (href === undefined) return null
  return (
    <PageLink
      page={pageId as NamespacedId}
      params={params}
      search={search}
      className={stylex.props(styles.way).className}
    >
      {children}
    </PageLink>
  )
}

export function DeleteChecklist({
  nodeId,
  childCount,
  onDelete,
}: {
  nodeId: string
  /** as the tree on screen has it, so the first line is right before the answer arrives */
  childCount: number
  onDelete: () => void
}) {
  const { format, formatText } = useI18n()
  const listJoin = useList()
  const query = useApiQuery(orgApi)
  const usage = useQuery(query.org.getNodeUsage.queryOptions({ params: { nodeId } }))
  const children = usage.data?.children ?? childCount
  // only what still stands on the unit holds it: a closed round or a grant
  // long withdrawn merely remembers it, and the unit is kept for them
  const held = (usage.data?.usage ?? []).filter((one) => one.clearable)
  const clear = usage.isSuccess && children === 0 && held.length === 0

  return (
    <Card
      data-testid="node-delete"
      data-removable={clear}
      data-holds={held.length + (children > 0 ? 1 : 0)}
    >
      <CardHead title={format(m.deleteNode)} />
      <ul {...stylex.props(styles.list)}>
        <li {...stylex.props(styles.line)} data-hold="children" data-count={children}>
          <span {...stylex.props(styles.mark, children === 0 ? styles.markClear : styles.markHeld)}>
            {children === 0 ? (
              <CheckIcon aria-hidden {...stylex.props(styles.glyph)} />
            ) : (
              <XIcon aria-hidden {...stylex.props(styles.glyph)} />
            )}
          </span>
          <span {...stylex.props(styles.words)}>
            <span {...stylex.props(styles.what)}>
              {children === 0
                ? format(m.holdNoChildren)
                : format(m.holdChildren, { count: children })}
            </span>
          </span>
        </li>
        {usage.isPending ? (
          <Skeleton
            height={14}
            width="60%"
            radius={4}
            className={stylex.props(styles.bone).className}
          />
        ) : usage.isError ? (
          <li {...stylex.props(styles.line)}>
            <span {...stylex.props(styles.which)}>{format(m.holdUnknown)}</span>
          </li>
        ) : held.length === 0 ? (
          <li {...stylex.props(styles.line)} data-hold="none">
            <span {...stylex.props(styles.mark, styles.markClear)}>
              <CheckIcon aria-hidden {...stylex.props(styles.glyph)} />
            </span>
            <span {...stylex.props(styles.words)}>
              <span {...stylex.props(styles.what)}>{format(m.holdNothingElse)}</span>
            </span>
          </li>
        ) : (
          held.map((one) => (
            <li
              key={one.kind}
              {...stylex.props(styles.line)}
              data-hold={one.kind}
              data-count={one.count}
              data-clearable={one.clearable}
            >
              <span {...stylex.props(styles.mark, styles.markHeld)}>
                <XIcon aria-hidden {...stylex.props(styles.glyph)} />
              </span>
              <span {...stylex.props(styles.words)}>
                <span {...stylex.props(styles.what)}>
                  {format(m.holdLine, { label: formatText(one.label), count: one.count })}
                </span>
                {one.examples.length > 0 && (
                  <span {...stylex.props(styles.which)}>
                    {one.count > one.examples.length
                      ? format(m.holdExamplesMore, { names: listJoin(one.examples) })
                      : listJoin(one.examples)}
                  </span>
                )}
              </span>
              {one.target !== null && (
                <Way
                  pageId={one.target.pageId}
                  params={one.target.params}
                  search={one.target.search}
                >
                  {format(m.holdGo)}
                </Way>
              )}
            </li>
          ))
        )}
      </ul>
      <div {...stylex.props(styles.foot)}>
        <span {...stylex.props(styles.verdict)}>
          {format(clear ? m.holdVerdictClear : m.holdVerdictHeld)}
        </span>
        <Button size="sm" variant="outline" disabled={!clear} onClick={onDelete}>
          {format(m.deleteNode)}
        </Button>
      </div>
    </Card>
  )
}
