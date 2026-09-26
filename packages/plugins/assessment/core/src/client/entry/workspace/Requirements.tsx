import * as stylex from '@stylexjs/stylex'
import { ArrowRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Portion } from '@qualy/ui/reveal'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../../i18n.ts'
import { recordedOnly, trimAmount, type EntryDto, type ItemDto } from '../model.ts'
import { useCalcLine } from './calc.ts'
import { meterStyles, SectionMeter } from './marks.tsx'
import { chainNamesOf, type StructureRow } from '../standing.ts'
import { chainOf, short, two, type Outline } from './model.ts'

// What one question asks and pays, beside its claims: how much it has
// counted, how many places it has, which sections it adds up in and how full
// they are, what it wants filed, and who looks at it after.
//
// A column of its own at a desk; on a tablet or a phone the same content in
// a sheet the question's header opens.

const styles = stylex.create({
  root: { display: 'flex', flexDirection: 'column' },
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    paddingInline: 20,
    paddingTop: 16,
    paddingBottom: 18,
  },
  ruled: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  first: { paddingTop: 4 },
  label: { margin: 0, fontSize: 12, fontWeight: 600, color: tokens.mutedForeground },
  counted: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    fontVariantNumeric: 'tabular-nums',
  },
  countedValue: { fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' },
  countedZero: { color: tokens.mutedForeground },
  countedNegative: { color: tokens.danger },
  quiet: { fontSize: 13, color: tokens.mutedForeground },
  calc: { margin: 0, fontSize: 13, color: tokens.surfaceMutedForeground },
  quota: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 },
  quotaLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 12.5,
    fontVariantNumeric: 'tabular-nums',
  },
  spacer: { flexGrow: 1 },
  strong: { fontWeight: 600 },
  bar: {
    display: 'flex',
    height: 4,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: tokens.surfaceMuted,
  },
  barFill: { display: 'block', borderRadius: 2 },
  chain: { display: 'flex', flexDirection: 'column', gap: 12 },
  section: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    borderWidth: 0,
    backgroundColor: 'transparent',
    padding: 0,
    textAlign: 'left',
    cursor: 'pointer',
  },
  sectionLine: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
  },
  sectionNo: { flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: tokens.mutedForeground },
  sectionName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 500,
  },
  keep: { flexShrink: 0, whiteSpace: 'nowrap' },
  muted: { color: tokens.mutedForeground },
  elbow: {
    position: 'absolute',
    top: -10,
    height: 18,
    width: 8,
    borderLeftWidth: 1,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    borderBottomLeftRadius: 5,
  },
  prose: {
    margin: 0,
    fontSize: 13.5,
    lineHeight: 1.7,
    color: tokens.surfaceMutedForeground,
    textWrap: 'pretty',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-line',
  },
  route: { display: 'flex', flexDirection: 'column', gap: 6 },
  routeName: { fontSize: 12, color: tokens.mutedForeground },
  steps: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  step: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  stepChip: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 24,
    borderRadius: 7,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 75%, ${tokens.background})`,
    paddingInline: 9,
    fontSize: 12.5,
  },
  arrow: { width: 12, height: 12, color: tokens.mutedForeground },
})

export function Requirements({
  row,
  item,
  outline,
  entries,
  scored,
  onGoto,
}: {
  row: StructureRow
  item: ItemDto
  outline: Outline
  /** the claims standing on it, which use its places */
  entries: readonly EntryDto[]
  scored: boolean
  onGoto: (id: string) => void
}) {
  const { format } = useI18n()
  const calc = useCalcLine()
  const counted = row.right === '' ? 0 : Number(row.right)
  const voided = item.status === 'voided'
  const quiet = item.itemType === 'constant' || recordedOnly(item)
  const used = entries.filter((entry) => entry.status !== 'voided').length
  const description = String(
    (item.currentRevision?.displayConfig as { description?: unknown } | undefined)?.description ??
      '',
  ).trim()
  const chain = chainNamesOf(item)
  const stepName = (label: string | null, index: number) =>
    label ?? format(m.entryFlowStep, { n: index + 1 })
  const routes = quiet
    ? []
    : [
        chain.normal.length > 0
          ? { key: 'normal', name: m.reviewRouteNormal, steps: chain.normal }
          : null,
        chain.escalation.length > 0
          ? { key: 'escalation', name: m.reviewRouteEscalation, steps: chain.escalation }
          : null,
      ].filter((route) => route !== null)
  const sections = chainOf(outline, row)

  return (
    <div {...stylex.props(styles.root)} data-testid="item-requirements">
      <div {...stylex.props(styles.block, styles.first)}>
        <div {...stylex.props(styles.counted)}>
          <span
            data-scored={scored}
            {...stylex.props(
              styles.countedValue,
              (!scored || counted === 0) && styles.countedZero,
              scored && counted < 0 && styles.countedNegative,
            )}
          >
            {scored ? two(counted) : '–'}
          </span>
          <span {...stylex.props(styles.quiet)}>
            {format(counted < 0 ? m.entriesPointsDeducted : m.entriesPointsCounted)}
          </span>
        </div>
        <p {...stylex.props(styles.calc)}>
          {quiet ? format(m.entriesNoFilingNeeded, { calc: calc(item) }) : calc(item)}
        </p>
        {item.maxEntries !== null && !voided && !quiet && (
          <div {...stylex.props(styles.quota)} data-testid="item-quota" data-used={used}>
            <div {...stylex.props(styles.quotaLine)}>
              <span {...stylex.props(styles.muted)}>{format(m.myEntriesQuota)}</span>
              <span {...stylex.props(styles.spacer)} />
              <span {...stylex.props(styles.strong)}>
                {used} / {item.maxEntries}
              </span>
            </div>
            <span {...stylex.props(styles.bar)}>
              <Portion
                share={Math.min(100, (used / Math.max(1, item.maxEntries)) * 100)}
                className={stylex.props(styles.barFill, meterStyles.fill).className}
              />
            </span>
          </div>
        )}
      </div>

      {sections.length > 0 && (
        <div {...stylex.props(styles.block, styles.ruled)}>
          <p {...stylex.props(styles.label)}>{format(m.entriesInSections)}</p>
          <div {...stylex.props(styles.chain)}>
            {sections.map((section, level) => {
              const cap =
                section.cap === null || section.cap === undefined || section.cap === ''
                  ? null
                  : Number(section.cap)
              const got = section.right === '' ? 0 : Number(section.right)
              const full = scored && cap !== null && cap > 0 && got >= cap
              return (
                <button
                  key={section.id}
                  type="button"
                  data-section={section.id}
                  data-full={full}
                  onClick={() => onGoto(section.id)}
                  {...stylex.props(styles.section)}
                  style={{ paddingLeft: `${level * 14}px` }}
                >
                  {level > 0 && (
                    <span
                      aria-hidden
                      {...stylex.props(styles.elbow)}
                      style={{ left: `${(level - 1) * 14 + 2}px` }}
                    />
                  )}
                  <span {...stylex.props(styles.sectionLine)}>
                    <span {...stylex.props(styles.sectionNo)}>
                      {outline.numbers.get(section.id)}
                    </span>
                    <span {...stylex.props(styles.sectionName)}>{section.name}</span>
                    <span {...stylex.props(styles.spacer)} />
                    {full && (
                      <span {...stylex.props(styles.keep, styles.muted)}>
                        {format(m.entriesSectionFull)}
                      </span>
                    )}
                    {/* how full it is, beside its figure as the structure
                        draws it: a bar under each line read as rules */}
                    {scored && cap !== null && cap > 0 && <SectionMeter got={got} cap={cap} />}
                    <span {...stylex.props(styles.keep)} data-scored={scored}>
                      <b>{scored ? short(section.right === '' ? '0' : section.right) : '–'}</b>
                      <span {...stylex.props(styles.muted)}>
                        {cap === null
                          ? ` ${format(m.myEntriesPaperUnit)}`
                          : ` / ${format(m.entriesPoints, { value: trimAmount(String(cap)) })}`}
                      </span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {description !== '' && (
        <div {...stylex.props(styles.block, styles.ruled)}>
          <p {...stylex.props(styles.label)}>{format(m.entriesDescription)}</p>
          <p {...stylex.props(styles.prose)}>{description}</p>
        </div>
      )}

      {routes.length > 0 && !voided && (
        <div {...stylex.props(styles.block, styles.ruled)} data-testid="question-chain">
          <p {...stylex.props(styles.label)}>{format(m.entryFlow)}</p>
          {routes.map((route) => (
            <div key={route.key} {...stylex.props(styles.route)}>
              <span {...stylex.props(styles.routeName)}>{format(route.name)}</span>
              {/* by the names the administrator gave the steps, and only
                  the names: who each step lands on is the round's business */}
              <ol
                aria-label={format(route.name)}
                data-route={route.key}
                {...stylex.props(styles.steps)}
              >
                {route.steps.map((label, index) => (
                  <li key={index} {...stylex.props(styles.step)}>
                    {index > 0 && <ArrowRightIcon aria-hidden {...stylex.props(styles.arrow)} />}
                    <span {...stylex.props(styles.stepChip)}>{stepName(label, index)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {voided && (item.voidReason ?? '').trim() !== '' && (
        <div {...stylex.props(styles.block, styles.ruled)}>
          <p {...stylex.props(styles.label)}>{format(m.entriesVoidReason)}</p>
          <p {...stylex.props(styles.prose)}>{item.voidReason}</p>
        </div>
      )}
    </div>
  )
}
