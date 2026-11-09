'use client'
import * as stylex from '@stylexjs/stylex'
import { Card, CardFoot, SplitFrame, Table, TableHead, TableRow } from '@qualy/ui/screen'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { rosterStyles } from './roster-presentation.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

const styles = stylex.create({
  page: { minHeight: '100cqh' },
  tree: { height: '100%' },
  treeHead: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 6,
    height: 55,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  treeTools: {
    paddingInline: 12,
    paddingBlock: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  branches: { padding: 6 },
  branch: { display: 'flex', alignItems: 'center', gap: 8, height: 34, paddingInline: 12 },
  child: { paddingInlineStart: 34 },
  status: { display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 },
  list: { flexGrow: 1, minHeight: 0 },
  actions: { height: 32, width: 88 },
  control: { height: 36, minWidth: 0, borderRadius: tokens.radiusMd },
  // A query-only fallback also fills the page's room. The full outline uses
  // flex instead, so it follows its own header and toolbar without offsets.
  frame: {
    height: {
      default: 'max(240px, calc(100cqh - 126px))',
      [breakpoints.phone]: 'max(240px, calc(100cqh - 250px))',
    },
    minHeight: 240,
  },
  fill: { height: 0, flexGrow: 1 },
  rows: { position: 'relative', minHeight: 0, flexGrow: 1, overflow: 'hidden' },
  drawn: { position: 'absolute', inset: 0 },
  number: { display: { default: 'flex', [breakpoints.phone]: 'none' }, alignItems: 'center' },
  person: {
    minWidth: 0,
    fontSize: { default: 12.5, [breakpoints.phone]: 13.5 },
    gridColumn: { default: 2, [breakpoints.phone]: 1 },
    gridRow: 1,
  },
  nameLine: { display: 'flex', alignItems: 'center', height: '1lh' },
  unitLine: { display: 'flex', alignItems: 'center', height: 20 },
  phoneFacts: {
    display: { default: 'none', [breakpoints.phone]: 'flex' },
    flexDirection: 'column',
    gap: 3,
    alignItems: 'flex-start',
    fontSize: 12.5,
    gridColumn: 1,
    gridRow: 2,
  },
  numberLine: { display: 'flex', alignItems: 'center', height: '1lh' },
  waitingLine: { display: 'flex', alignItems: 'center', height: 16 },
  waiting: {
    display: {
      default: 'flex',
      [breakpoints.phone]: 'none',
      '@container (min-width: 800px)': 'grid',
    },
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    alignItems: 'center',
    justifyItems: 'center',
    gap: 6,
  },
  kind: { display: { default: 'none', '@container (min-width: 800px)': 'block' } },
  score: {
    gridColumn: { default: 4, [breakpoints.phone]: 2 },
    gridRow: { default: 1, [breakpoints.phone]: '1 / 3' },
  },
  menu: { height: 24, width: 24, borderRadius: 6 },
  foot: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pages: { display: 'flex', gap: 8 },
})

// Twenty visual rows at most, like a real page, clipped to the available
// room by CSS. A tall first paint does not need a guessed viewport in JS or
// hundreds of server-rendered rows. No names, counts or scores are invented.
const ROWS = Array.from({ length: 20 }, (_, index) => index)
const WIDTHS = ['62%', '48%', '72%', '56%']

function WaitingBones() {
  return (
    <span {...stylex.props(styles.waiting)}>
      <Skeleton height={12} width={28} />
      {[0, 1, 2, 3].map((key) => (
        <span key={key} {...stylex.props(styles.kind)}>
          <Skeleton height={12} width={22} />
        </span>
      ))}
    </span>
  )
}

/** The same rows while the server prepares the page and while its query reads. */
export function ParticipantRosterRows({ fill = false }: { fill?: boolean }) {
  return (
    <Card data-testid="roster-skeleton" aria-hidden xstyle={[styles.frame, fill && styles.fill]}>
      <div {...stylex.props(rosterStyles.table)}>
        <Table columns="var(--q-roster-columns)">
          <TableHead>
            <Skeleton height={11} width={48} />
            <Skeleton height={11} width={36} />
            <WaitingBones />
            <span {...stylex.props(rosterStyles.scoreSeat)}>
              <Skeleton height={11} width={36} />
            </span>
            <span />
          </TableHead>
        </Table>
      </div>
      <div {...stylex.props(styles.rows)}>
        <div {...stylex.props(styles.drawn, rosterStyles.table)}>
          <Table columns="var(--q-roster-columns)">
            {ROWS.map((key) => (
              <TableRow key={key} height="compact" data-testid="roster-skeleton-row">
                <span {...stylex.props(styles.number)}>
                  <Skeleton height={13} width="75%" />
                </span>
                <span {...stylex.props(rosterStyles.who, styles.person)}>
                  <span {...stylex.props(styles.nameLine)}>
                    <Skeleton height={13} width={WIDTHS[key % WIDTHS.length]} />
                  </span>
                  <span {...stylex.props(styles.unitLine)}>
                    <Skeleton height={11} width="82%" />
                  </span>
                </span>
                <WaitingBones />
                <span {...stylex.props(styles.phoneFacts)}>
                  <span {...stylex.props(styles.numberLine)}>
                    <Skeleton height={11} width={64} />
                  </span>
                  <span {...stylex.props(styles.waitingLine)}>
                    <Skeleton height={11} width={32} />
                  </span>
                </span>
                <span {...stylex.props(styles.score, rosterStyles.scoreSeat)}>
                  <Skeleton height={16} width={44} />
                </span>
                <span {...stylex.props(rosterStyles.rowAct)}>
                  <Skeleton className={stylex.props(styles.menu).className} />
                </span>
              </TableRow>
            ))}
          </Table>
        </div>
      </div>
      <CardFoot>
        <div {...stylex.props(styles.foot)}>
          <Skeleton height={12} width="30%" />
          <span {...stylex.props(styles.pages)}>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} height={28} width={28} radius={6} />
            ))}
          </span>
        </div>
      </CardFoot>
    </Card>
  )
}

/** Read-only streaming outline, sized by the shell's CSS scroll container. */
export function ParticipantRosterSkeleton() {
  return (
    <div data-testid="roster-pending" aria-busy {...stylex.props(rosterStyles.panel, styles.page)}>
      <header {...stylex.props(rosterStyles.head)}>
        <h1 {...stylex.props(rosterStyles.title)}>{m.participantResults_tab()}</h1>
        <Skeleton aria-hidden height={13} width={64} />
        <span aria-hidden {...stylex.props(rosterStyles.actions)}>
          <Skeleton className={stylex.props(styles.actions).className} />
          <Skeleton className={stylex.props(styles.actions).className} />
        </span>
      </header>
      <div
        role="status"
        aria-label={commonMessages.state_loading()}
        {...stylex.props(styles.status)}
      >
        <SplitFrame
          preference="assessment-roster-tree-width"
          grow
          side={
            <Card aria-hidden data-testid="roster-skeleton-tree" xstyle={styles.tree}>
              <div {...stylex.props(styles.treeHead)}>
                <Skeleton height={13} width="35%" />
                <Skeleton height={12} width="55%" />
              </div>
              <div {...stylex.props(styles.treeTools)}>
                <Skeleton height={36} radius={6} />
              </div>
              <div {...stylex.props(styles.branches)}>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => (
                  <div key={key} {...stylex.props(styles.branch, key % 3 !== 0 && styles.child)}>
                    <Skeleton height={12} width={12} />
                    <Skeleton height={13} width={WIDTHS[key % WIDTHS.length]} />
                  </div>
                ))}
              </div>
            </Card>
          }
        >
          <div {...stylex.props(rosterStyles.listColumn, styles.list)}>
            <div aria-hidden {...stylex.props(rosterStyles.toolbar)}>
              <Skeleton
                className={stylex.props(styles.control, rosterStyles.unitControlWidth).className}
              />
              <Skeleton className={stylex.props(styles.control, rosterStyles.search).className} />
              {[0, 1, 2].map((key) => (
                <Skeleton
                  key={key}
                  className={stylex.props(styles.control, rosterStyles.choice).className}
                />
              ))}
            </div>
            <ParticipantRosterRows fill />
          </div>
        </SplitFrame>
      </div>
    </div>
  )
}
