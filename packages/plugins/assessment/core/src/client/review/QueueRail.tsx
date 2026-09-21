import { memo, useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Kbd } from '@qualy/ui/kbd'
import { CardEmpty, DetailSheet, FootNote } from '@qualy/ui/screen'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { useDayClock, type InboxItemDto } from './model.ts'

const styles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    marginBlock: 0,
    marginInline: -6,
    padding: 0,
    listStyleType: 'none',
  },
  row: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    borderWidth: 0,
    borderRadius: 10,
    paddingInline: 10,
    paddingBlock: 10,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceInset },
    fontFamily: 'inherit',
    textAlign: 'left',
    color: 'inherit',
    cursor: 'pointer',
    outlineStyle: 'none',
  },
  // where the arrow keys stand: the same ground a pointer leaves
  rowAt: { backgroundColor: tokens.surfaceMuted },
  face: { width: 32, height: 32, flexShrink: 0 },
  faceText: { fontSize: 13, fontWeight: 500 },
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
  item: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  clock: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  count: { fontSize: 13, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  keys: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  spacer: { flexGrow: 1 },
})

/**
 * Who else is waiting in this run, brought out from the side.
 *
 * A filing leaves the list the moment its disposition is staged, not when
 * the five seconds are up: from the reviewer's side it is dealt with, and a
 * row that lingers greyed out for five seconds reads as one that did not
 * take. Taking it back with ⌘Z puts it back, because then it really was not
 * dealt with.
 *
 * Beside the workbench it stood there all session to be used a few times in
 * it, and took a column from the three that are read on every filing. So it
 * is a sheet, and like the rest of the workbench it answers to the keyboard:
 * the arrows (or J and K) walk it, Enter opens the one stood on.
 */
// Memoized: the root re-renders on every keystroke in the decision bar and
// on every overlay opening or closing.
export const QueueRail = memo(function QueueRail({
  rows,
  currentId,
  remainingCount,
  open,
  onToggle,
  onOpen,
  onBack,
}: {
  rows: readonly InboxItemDto[]
  currentId: string
  remainingCount: number
  open: boolean
  onToggle: () => void
  onOpen: (id: string) => void
  onBack: () => void
}) {
  const { format } = useI18n()
  const dayClock = useDayClock()
  const [at, setAt] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  // opening stands on the filing being read, which is where a jump starts from
  useEffect(() => {
    if (!open) return
    const found = rows.findIndex((row) => row.instanceId === currentId)
    setAt(found === -1 ? 0 : found)
    // rows and currentId are read at the moment of opening only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // The row stood on holds the focus, not the corner the sheet opened on:
  // with the ring left on the close button, walking the list moved a tint
  // down the rows while the ring stayed in the corner - two answers to
  // "where am I" on one screen, and the wrong one was the loud one.
  useEffect(() => {
    if (!open) return
    const row = list.current?.querySelector<HTMLElement>(`[data-queue-index="${at}"]`)
    row?.scrollIntoView({ block: 'nearest' })
    row?.focus({ preventScroll: true })
  }, [open, at])

  useEffect(() => {
    if (!open) return
    const down = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const step =
        event.key === 'ArrowDown' || event.key === 'j' || event.key === 'J'
          ? 1
          : event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K'
            ? -1
            : 0
      if (step !== 0) {
        event.preventDefault()
        setAt((current) => Math.min(Math.max(current + step, 0), Math.max(rows.length - 1, 0)))
        return
      }
      if (event.key === 'Enter') {
        const row = rows[at]
        if (row === undefined) return
        event.preventDefault()
        onOpen(row.instanceId)
        onToggle()
        return
      }
      if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault()
        onToggle()
      }
      // No second letter for leaving: Esc shuts every sheet in the product,
      // and a key printed beside "返回待审核列表" was read as the way to shut
      // this one - which it was not.
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [open, rows, at, onOpen, onToggle, onBack])

  return (
    <DetailSheet
      open={open}
      onClose={onToggle}
      title={format(m.reviewQueueTitle)}
      titleAside={<span {...stylex.props(styles.count)}>{remainingCount}</span>}
      width="narrow"
      closeLabel={format(commonMessages.close)}
      testId="queue-sheet"
      footer={
        <>
          <FootNote>
            <span {...stylex.props(styles.keys)}>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              {format(m.reviewQueueKeysMove)}
              <Kbd>↵</Kbd>
              {format(m.reviewQueueKeysOpen)}
              <Kbd>Esc</Kbd>
              {format(commonMessages.close)}
            </span>
          </FootNote>
          <span {...stylex.props(styles.spacer)} />
          <Button variant="outline" size="sm" onClick={onBack}>
            {format(m.reviewBackToQueue)}
          </Button>
        </>
      }
    >
      {rows.length === 0 ? (
        <CardEmpty>{format(m.reviewQueueEmpty)}</CardEmpty>
      ) : (
        <ul ref={list} {...stylex.props(styles.list)}>
          {rows.map((row, index) => {
            const current = row.instanceId === currentId
            return (
              <li key={row.instanceId}>
                <button
                  type="button"
                  data-testid="queue-row"
                  data-queue-index={index}
                  data-current={current}
                  data-at={index === at}
                  aria-current={current || undefined}
                  onPointerMove={() => setAt(index)}
                  onClick={() => {
                    onOpen(row.instanceId)
                    onToggle()
                  }}
                  {...stylex.props(styles.row, index === at && styles.rowAt)}
                >
                  <Avatar className={stylex.props(styles.face).className}>
                    <AvatarFallback className={stylex.props(styles.faceText).className}>
                      {row.participantName.slice(0, 1)}
                    </AvatarFallback>
                  </Avatar>
                  <span {...stylex.props(styles.words)}>
                    <span {...stylex.props(styles.nameLine)}>
                      <span {...stylex.props(styles.name)}>{row.participantName}</span>
                      {current && <Badge variant="secondary">{format(m.reviewQueueCurrent)}</Badge>}
                    </span>
                    <span {...stylex.props(styles.item)}>{row.itemTitle}</span>
                  </span>
                  <span {...stylex.props(styles.clock)}>{dayClock(row.submittedAt)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </DetailSheet>
  )
})
