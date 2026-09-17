import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import { InfoIcon } from 'lucide-react'
import { formulaMessages as m } from './i18n.ts'
import { fullWhen } from './library-styles.ts'
import { VersionSharing } from './VersionSharing.tsx'

// What one publication is, beside its line in the history: its name and
// notes, when and by whom, and who it is shared with - where sharing is
// also changed.
//
// It opens under a resting pointer and closes when the pointer leaves, like
// a preview; a press on the mark, or a press anywhere inside, keeps it open
// until a press outside or Escape, so its controls can be used without
// holding the pointer still. On a touch screen the press is the only way in.

export interface ReleaseInfo {
  readonly versionNo: number
  readonly releaseName: string | null
  readonly releaseNotes: string | null
  readonly publishedAt: string
  readonly publishedByName: string | null
}

const OPEN_DELAY_MS = 150
const CLOSE_DELAY_MS = 200

const styles = stylex.create({
  trigger: {
    display: 'inline-flex',
    width: 28,
    height: 28,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 6,
    padding: 0,
    backgroundColor: { default: 'transparent', ':hover': tokens.border },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  triggerOpen: { backgroundColor: tokens.border, color: tokens.foreground },
  // the card's own padding belongs to the hover area too, or the pointer
  // crossing the margin between text and edge would read as leaving
  body: { display: 'flex', flexDirection: 'column', gap: 12, margin: -14, padding: 14 },
  header: { display: 'flex', flexDirection: 'column', gap: 4 },
  name: { margin: 0, fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' },
  rule: { height: 1, marginInline: -14, backgroundColor: tokens.divider },
  unnamed: { color: tokens.mutedForeground, fontWeight: 500 },
  notes: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    color: tokens.surfaceMutedForeground,
  },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    columnGap: 14,
    rowGap: 6,
    margin: 0,
    fontSize: 12.5,
  },
  factLabel: { color: tokens.mutedForeground },
  factValue: { margin: 0, minWidth: 0, overflowWrap: 'anywhere' },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  sub: { margin: 0, fontSize: 12, fontWeight: 600, color: tokens.surfaceMutedForeground },
})

export function ReleaseInfoPopover({
  functionId,
  release,
}: {
  readonly functionId: string
  readonly release: ReleaseInfo
}) {
  const { format, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressed = useRef(false)

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  const after = (ms: number, act: () => void) => {
    cancel()
    timer.current = setTimeout(() => {
      timer.current = null
      act()
    }, ms)
  }
  useEffect(() => cancel, [])

  const close = () => {
    cancel()
    setOpen(false)
    setPinned(false)
  }
  const leave = () => {
    if (!pinned) after(CLOSE_DELAY_MS, close)
  }

  const onOpenChange = (next: boolean) => {
    if (pressed.current) {
      // the mark was pressed: open and keep, keep what hovering opened, or
      // put away what was kept
      pressed.current = false
      cancel()
      if (open && pinned) close()
      else {
        setOpen(true)
        setPinned(true)
      }
      return
    }
    // a press outside, or Escape
    if (next) setOpen(true)
    else close()
  }

  const name = release.releaseName ?? format(m.releaseUnnamed)
  return (
    <Popover open={open} onOpenChange={onOpenChange} trapFocus={pinned}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="formula-release-info"
          aria-label={format(m.releaseInfoOf, { name })}
          onClick={() => {
            pressed.current = true
          }}
          onMouseEnter={() => {
            if (open) cancel()
            else after(OPEN_DELAY_MS, () => setOpen(true))
          }}
          onMouseLeave={leave}
          {...stylex.props(styles.trigger, open && styles.triggerOpen)}
        >
          <InfoIcon size={15} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" width={300}>
        <div
          data-testid="formula-release-card"
          onMouseEnter={cancel}
          onMouseLeave={leave}
          // using what is inside keeps it: a picker's list opens outside the
          // card, and the pointer going there must not close the card
          onPointerDownCapture={() => setPinned(true)}
          onFocusCapture={() => setPinned(true)}
          {...stylex.props(styles.body)}
        >
          <div {...stylex.props(styles.header)}>
            <p {...stylex.props(styles.name, release.releaseName === null && styles.unnamed)}>
              {name}
            </p>
            {release.releaseNotes === null ? null : (
              <p {...stylex.props(styles.notes)}>{release.releaseNotes}</p>
            )}
          </div>
          <div aria-hidden {...stylex.props(styles.rule)} />
          <dl {...stylex.props(styles.facts)}>
            {(
              [
                [m.releaseOrdinalLabel, format(m.releaseOrdinal, { number: release.versionNo })],
                [m.templatesPublishedColumn, fullWhen(release.publishedAt, locale)],
                [m.releasePublisher, release.publishedByName ?? format(m.templatesAuthorUnknown)],
              ] as const
            ).flatMap(([label, value]) => [
              <dt key={`${label.id}-label`} {...stylex.props(styles.factLabel)}>
                {format(label)}
              </dt>,
              <dd key={`${label.id}-value`} {...stylex.props(styles.factValue)}>
                {value}
              </dd>,
            ])}
          </dl>
          <div aria-hidden {...stylex.props(styles.rule)} />
          <div {...stylex.props(styles.section)}>
            <h3 {...stylex.props(styles.sub)}>{format(m.releaseSharing)}</h3>
            <VersionSharing functionId={functionId} versionNo={release.versionNo} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
