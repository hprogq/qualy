'use client'
import * as stylex from '@stylexjs/stylex'
import { ScreenFill, useScreenAsideOffered } from '@qualy/web-runtime'
import { ParticipantRosterSkeleton } from './ParticipantRosterSkeleton.tsx'
import { Skeleton } from '@qualy/ui/skeleton'
import { AtWidth } from '@qualy/ui/at-width'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import * as commonMessages from '@qualy/web-i18n/messages'
import { WorkspaceSkeleton } from '../entry/workspace/WorkspaceSkeleton.tsx'
import { ParticipantAccountLayout } from './ParticipantAccountLayout.tsx'

const styles = stylex.create({
  panel: { display: 'flex', flexDirection: 'column', gap: 20, padding: 16 },
  line: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  facts: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 },
  fact: { display: 'flex', flexDirection: 'column', gap: 6 },
  head: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  room: { display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 },
})

/** A read-only outline: no queries or live subscriptions in a streaming fallback. */
export function ParticipantResultsPending({ detail }: { detail: boolean }) {
  const column = useScreenAsideOffered()
  if (!detail) return <ParticipantRosterSkeleton />
  const head = (
    <header data-testid="participant-head" {...stylex.props(styles.head)}>
      <Skeleton height={14} width={90} />
      <Skeleton height={22} width={160} />
      <div {...stylex.props(styles.line)}>
        <Skeleton height={28} width={70} />
        <Skeleton height={28} width={70} />
      </div>
    </header>
  )
  return (
    <ParticipantAccountLayout
      pending
      aside={
        column ? (
          <div {...stylex.props(styles.panel)}>
            <div {...stylex.props(styles.line)}>
              <Skeleton height={14} width={80} />
              <Skeleton height={14} width={64} />
            </div>
            <Skeleton height={24} width={100} />
            <Skeleton height={22} width={48} />
            <div {...stylex.props(styles.facts)}>
              {[0, 1, 2, 3].map((key) => (
                <div key={key} {...stylex.props(styles.fact)}>
                  <Skeleton height={12} width="45%" />
                  <Skeleton height={16} width="80%" />
                </div>
              ))}
            </div>
            <Skeleton height={32} />
            <Skeleton height={32} />
            {[0, 1, 2, 3, 4, 5, 6].map((key) => (
              <div key={key} {...stylex.props(styles.line)}>
                <Skeleton height={14} width="40%" />
                <Skeleton height={12} width="30%" />
              </div>
            ))}
          </div>
        ) : undefined
      }
    >
      <div
        data-testid="participant-pending"
        role="status"
        aria-label={commonMessages.state_loading()}
        {...stylex.props(styles.room)}
      >
        <ScreenFill from="tablet" />
        {column ? <AtWidth below={1024}>{head}</AtWidth> : head}
        <WorkspaceSkeleton viewer="staff" open={false} />
      </div>
    </ParticipantAccountLayout>
  )
}
