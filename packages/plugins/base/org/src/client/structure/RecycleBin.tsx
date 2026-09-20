import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { CardEmpty, DetailSheet, Tag } from '@qualy/ui/screen'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { orgMessages as m } from '../i18n.ts'
import { orgApi } from '../api.ts'
import type { Api, OrgShape, Run } from '../shape.ts'

// The units taken out of the structure, and the way back for each. A unit is
// put back where it stood, so one whose own parent is in here too waits for
// the parent.

const styles = stylex.create({
  list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyleType: 'none' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingBlock: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  words: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 2 },
  nameLine: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  note: { fontSize: 12.5, color: tokens.mutedForeground },
  bones: { display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 },
})

export function RecycleBin({
  open,
  shape,
  api,
  run,
  onClose,
}: {
  open: boolean
  shape: OrgShape
  api: Api
  run: Run
  onClose: () => void
}) {
  const { format, locale } = useI18n()
  const query = useApiQuery(orgApi)
  const binned = useQuery({
    ...query.org.listDeletedNodes.queryOptions({}),
    enabled: open,
  })
  const when = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const nodes = binned.data?.nodes ?? []
  return (
    <DetailSheet
      open={open}
      onClose={onClose}
      title={format(m.binTitle)}
      meta={<span {...stylex.props(styles.note)}>{format(m.binHint)}</span>}
      closeLabel={format(commonMessages.close)}
      testId="org-bin"
    >
      {binned.isPending ? (
        <div {...stylex.props(styles.bones)}>
          <Skeleton height={16} width="70%" radius={4} />
          <Skeleton height={16} width="55%" radius={4} />
          <Skeleton height={16} width="62%" radius={4} />
        </div>
      ) : nodes.length === 0 ? (
        <CardEmpty>{format(m.binEmpty)}</CardEmpty>
      ) : (
        <ul {...stylex.props(styles.list)} data-count={nodes.length}>
          {nodes.map((node) => (
            <li
              key={node.id}
              {...stylex.props(styles.row)}
              data-testid="bin-row"
              data-restorable={node.restorable}
            >
              <span {...stylex.props(styles.words)}>
                <span {...stylex.props(styles.nameLine)}>
                  <span {...stylex.props(styles.name)}>{node.name}</span>
                  <Tag>{shape.types.find((type) => type.id === node.orgTypeId)?.name ?? ''}</Tag>
                </span>
                <span {...stylex.props(styles.note)}>
                  {format(m.binWhere, {
                    parent: node.parentName ?? '',
                    when: when.format(new Date(node.deletedAt)),
                  })}
                </span>
                {!node.restorable && (
                  <span {...stylex.props(styles.note)}>{format(m.binParentFirst)}</span>
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!node.restorable}
                onClick={() =>
                  void run(
                    api.org.restoreNode({
                      params: { nodeId: node.id },
                      payload: { status: 'active' },
                    }),
                  ).catch(() => undefined)
                }
              >
                {format(m.binRestore)}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </DetailSheet>
  )
}
