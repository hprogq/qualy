import { useMemo } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Card, CardEmpty, CardHead } from '@qualy/ui/screen'
import { orgMessages as m } from '../i18n.ts'
import { NODE_HEIGHT, NODE_WIDTH, rulesGraphOf, type OrgShape } from '../shape.ts'

// The rules as a picture: each kind once, in the column its longest way down
// puts it in, an arrow from a kind to each kind it may hold. Pressing a kind
// opens it, and the one open is drawn heavier - here and in the table under
// it, which says the same thing in words.

const LINE = `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`
const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`

const styles = stylex.create({
  // the picture is for a screen wide enough to hold four columns of boxes;
  // on a phone the table under it carries the same rules as words
  card: { display: { default: 'flex', [breakpoints.phone]: 'none' } },
  seat: { paddingInline: 16, paddingTop: 12, paddingBottom: 6, overflowX: 'auto' },
  drawing: { display: 'block', width: '100%', minWidth: 640 },
  line: { fill: 'none', stroke: LINE, strokeWidth: 1.25 },
  lineCross: { strokeDasharray: '4 4' },
  arrow: { fill: LINE },
  box: { fill: tokens.surface, stroke: tokens.border, strokeWidth: 1, cursor: 'pointer' },
  boxOpen: { stroke: tokens.foreground, strokeWidth: 1.5 },
  name: { fontSize: 13, fontWeight: 500, fill: tokens.foreground, pointerEvents: 'none' },
  nameOpen: { fontWeight: 600 },
  count: { fontSize: 11, fill: QUIET, pointerEvents: 'none' },
  headCount: { flexShrink: 0, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: QUIET },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 18,
    rowGap: 4,
    paddingInline: 16,
    paddingBottom: 12,
    fontSize: 11,
    color: QUIET,
  },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  legendLine: { width: 24, height: 0, borderTopWidth: 1.25, borderTopStyle: 'solid', borderTopColor: LINE },
  legendLineCross: { borderTopStyle: 'dashed' },
  spacer: { flexGrow: 1 },
})

export function RulesGraph({
  shape,
  openId,
  onOpen,
}: {
  shape: OrgShape
  openId: string | null
  onOpen: (typeId: string) => void
}) {
  const { format } = useI18n()
  const graph = useMemo(() => rulesGraphOf(shape), [shape])
  const crossing = graph.edges.some((edge) => edge.cross)
  return (
    <Card xstyle={styles.card} data-testid="rules-graph" data-rules={graph.edges.length}>
      <CardHead title={format(m.rulesTitle)} note={format(m.ruleArrowHint)}>
        <span {...stylex.props(styles.headCount)}>{format(m.ruleCount, { count: graph.edges.length })}</span>
      </CardHead>
      {graph.nodes.length === 0 ? (
        <CardEmpty>{format(m.typeListEmpty)}</CardEmpty>
      ) : (
        <>
          <div {...stylex.props(styles.seat)}>
            <svg
              viewBox={`0 0 ${graph.width} ${graph.height}`}
              height={graph.height}
              role="img"
              aria-label={format(m.ruleGraphTitle)}
              {...stylex.props(styles.drawing)}
            >
              <defs>
                <marker
                  id="org-rule-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 9 5 L 0 9 z" {...stylex.props(styles.arrow)} />
                </marker>
              </defs>
              {graph.edges.map((edge) => (
                <path
                  key={edge.key}
                  d={edge.path}
                  markerEnd="url(#org-rule-arrow)"
                  data-rule={edge.key}
                  data-cross={edge.cross}
                  {...stylex.props(styles.line, edge.cross && styles.lineCross)}
                />
              ))}
              {graph.nodes.map((node) => {
                const open = node.id === openId
                return (
                  <g key={node.id} data-type-node={node.id} data-open={open} onClick={() => onOpen(node.id)}>
                    <rect
                      x={node.x}
                      y={node.y}
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx={10}
                      {...stylex.props(styles.box, open && styles.boxOpen)}
                    />
                    <text x={node.x + 14} y={node.y + 20} {...stylex.props(styles.name, open && styles.nameOpen)}>
                      {node.name}
                    </text>
                    <text x={node.x + 14} y={node.y + 35} {...stylex.props(styles.count)}>
                      {format(m.typeNodeCount, { count: node.count })}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
          <div {...stylex.props(styles.legend)}>
            <span {...stylex.props(styles.legendItem)}>
              <span aria-hidden {...stylex.props(styles.legendLine)} />
              {format(m.ruleLegendNear)}
            </span>
            {crossing && (
              <span {...stylex.props(styles.legendItem)}>
                <span aria-hidden {...stylex.props(styles.legendLine, styles.legendLineCross)} />
                {format(m.ruleLegendCross)}
              </span>
            )}
            <span {...stylex.props(styles.spacer)} />
            <span>{format(m.ruleLegendLayers)}</span>
          </div>
        </>
      )}
    </Card>
  )
}
