import { useEffect, useMemo, useRef, useState } from 'react'
import { FoldHorizontalIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { Card, CardEmpty, CardHead } from '@qualy/ui/screen'
import { orgMessages as m } from '../i18n.ts'
import { NODE_HEIGHT, NODE_WIDTH, rulesGraphOf, type OrgShape } from '../shape.ts'

// The rules as a picture: each kind once, in the column its longest way down
// puts it in, an arrow from a kind to each kind it may hold. Pressing a kind
// opens it, and the one open is drawn heavier - here and in the table under
// it, which says the same thing in words.
//
// It is drawn at its natural size and scrolls, rather than being squeezed
// into the card: seven levels fitted to one width left every box too small
// to read. The reader sets the size - the buttons, or a pinch (which a
// trackpad reports as a wheel with the control key held) - and "fit" is one
// of the sizes on offer rather than the only one.

const ZOOM_MIN = 0.4
const ZOOM_MAX = 2
const ZOOM_STEP = 0.2
const clamp = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 100) / 100))

const LINE = `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`
const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`

const styles = stylex.create({
  // The picture opens fitted to whatever width it is given, so a phone
  // gets the whole grammar at once rather than nothing: four levels across
  // 358px is a small box, but it is the shape of the rules, and the reader
  // can zoom or drag into any part of it. The table under it still says the
  // same rules in words for anybody who would rather read them.
  card: { display: 'flex' },
  seat: {
    maxHeight: { default: '30rem', [breakpoints.phone]: '18rem' },
    paddingInline: { default: 16, [breakpoints.phone]: 8 },
    paddingTop: 12,
    paddingBottom: 6,
    // a phone drags the picture; the page must not go with it
    touchAction: 'none',
    overflow: 'auto',
    overscrollBehavior: 'contain',
    // No bar: a track across the middle of the card cut the picture in two.
    // The picture is dragged instead, and a trackpad still scrolls it.
    scrollbarWidth: 'none',
    cursor: 'grab',
  },
  seatDragging: { cursor: 'grabbing', userSelect: 'none' },
  // centred while it fits, and scrolled from its start once it does not
  drawing: { display: 'block', flexShrink: 0, marginInline: 'auto' },
  zoom: { display: 'inline-flex', flexShrink: 0, alignItems: 'center', gap: 2 },
  zoomFigure: {
    minWidth: '3rem',
    textAlign: 'center',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
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
  legendLine: {
    width: 24,
    height: 0,
    borderTopWidth: 1.25,
    borderTopStyle: 'solid',
    borderTopColor: LINE,
  },
  legendLineCross: { borderTopStyle: 'dashed' },
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
  const seat = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  // read by the click that follows a drag, which arrives after the state has already been put back
  const dragged = useRef(false)
  const grip = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(
    null,
  )
  const fit = () => {
    const room = (seat.current?.clientWidth ?? 0) - 32
    if (room > 0 && graph.width > 0) setZoom(clamp(Math.min(1, room / graph.width)))
  }
  // A picture wider than the card opens fitted to it, so the whole grammar is
  // on screen first; from there the reader zooms into whichever part they
  // came for. One that fits is left at its natural size.
  const fitted = useRef('')
  useEffect(() => {
    const key = `${String(graph.width)}x${String(graph.nodes.length)}`
    if (fitted.current === key || graph.nodes.length === 0) return
    const room = (seat.current?.clientWidth ?? 0) - 32
    if (room <= 0) return
    fitted.current = key
    if (graph.width > room) setZoom(clamp(room / graph.width))
  }, [graph.width, graph.nodes.length])
  // a pinch arrives as a wheel with ctrl held, and claiming it needs a
  // listener that is not passive, which React's onWheel is
  useEffect(() => {
    const node = seat.current
    if (node === null) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      setZoom((now) => clamp(now * Math.exp(-event.deltaY / 200)))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [graph.nodes.length])
  return (
    <Card xstyle={styles.card} data-testid="rules-graph" data-rules={graph.edges.length}>
      <CardHead title={format(m.rulesTitle)} note={format(m.ruleArrowHint)}>
        <span {...stylex.props(styles.headCount)}>
          {format(m.ruleCount, { count: graph.edges.length })}
        </span>
        {graph.nodes.length > 0 && (
          <span {...stylex.props(styles.zoom)} data-testid="rules-zoom" data-zoom={zoom}>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={format(m.zoomOut)}
              title={format(m.zoomOut)}
              disabled={zoom <= ZOOM_MIN}
              onClick={() => setZoom((now) => clamp(now - ZOOM_STEP))}
            >
              <ZoomOutIcon aria-hidden />
            </Button>
            <span {...stylex.props(styles.zoomFigure)}>{`${String(Math.round(zoom * 100))}%`}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={format(m.zoomIn)}
              title={format(m.zoomIn)}
              disabled={zoom >= ZOOM_MAX}
              onClick={() => setZoom((now) => clamp(now + ZOOM_STEP))}
            >
              <ZoomInIcon aria-hidden />
            </Button>
            {/* arrows closing on a line: drawn in to the width. The corner
                brackets that usually mean "fit" also mean "full screen", which
                is the opposite of what this does to a wide picture */}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={format(m.zoomFit)}
              title={format(m.zoomFit)}
              onClick={fit}
            >
              <FoldHorizontalIcon aria-hidden />
            </Button>
          </span>
        )}
      </CardHead>
      {graph.nodes.length === 0 ? (
        <CardEmpty>{format(m.typeListEmpty)}</CardEmpty>
      ) : (
        <>
          <div
            ref={seat}
            {...stylex.props(styles.seat, dragging && styles.seatDragging)}
            onPointerDown={(event) => {
              const node = seat.current
              if (node === null || event.button !== 0) return
              grip.current = {
                x: event.clientX,
                y: event.clientY,
                left: node.scrollLeft,
                top: node.scrollTop,
                moved: false,
              }
            }}
            onPointerMove={(event) => {
              const node = seat.current
              const held = grip.current
              if (node === null || held === null) return
              const dx = event.clientX - held.x
              const dy = event.clientY - held.y
              // a press that barely moves is a press on a box, not a drag
              if (!held.moved && Math.hypot(dx, dy) < 4) return
              held.moved = true
              setDragging(true)
              node.scrollLeft = held.left - dx
              node.scrollTop = held.top - dy
            }}
            onPointerUp={() => {
              dragged.current = grip.current?.moved ?? false
              grip.current = null
              setDragging(false)
            }}
            onPointerLeave={() => {
              grip.current = null
              setDragging(false)
            }}
            // the press that ended a drag is not a press on whatever was under it
            onClickCapture={(event) => {
              if (!dragged.current) return
              dragged.current = false
              event.stopPropagation()
            }}
          >
            <svg
              viewBox={`0 0 ${graph.width} ${graph.height}`}
              width={graph.width * zoom}
              height={graph.height * zoom}
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
                  <g
                    key={node.id}
                    data-type-node={node.id}
                    data-open={open}
                    onClick={() => onOpen(node.id)}
                  >
                    <rect
                      x={node.x}
                      y={node.y}
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx={10}
                      {...stylex.props(styles.box, open && styles.boxOpen)}
                    />
                    <text
                      x={node.x + 14}
                      y={node.y + 20}
                      {...stylex.props(styles.name, open && styles.nameOpen)}
                    >
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
          </div>
        </>
      )}
    </Card>
  )
}
