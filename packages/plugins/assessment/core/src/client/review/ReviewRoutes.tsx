import * as stylex from '@stylexjs/stylex'
import type { ApiResult } from '@qualy/web-runtime/api'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Badge } from '@qualy/ui/badge'
import { assessmentApi } from '../api.ts'
import * as m from '#messages'

type Stage = ApiResult<typeof assessmentApi, 'assessment', 'previewReviewRoutes'>['stages'][number]

const styles = stylex.create({
  routes: { display: 'flex', flexDirection: 'column', gap: 24 },
  list: { display: 'flex', flexDirection: 'column', gap: 12, margin: 0, paddingInlineStart: 20 },
  heading: { fontSize: 14, fontWeight: 600, marginBottom: 12 },
  stage: {
    padding: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
  },
  current: { borderColor: tokens.foreground, backgroundColor: tokens.surfaceMuted },
  title: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 500,
  },
  note: { fontSize: 12, color: tokens.mutedForeground, marginTop: 6 },
  people: { display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 13 },
  missing: { color: tokens.warningForeground },
})

export function ReviewRoutes({
  stages,
  currentOnly = false,
}: {
  stages: readonly Stage[]
  currentOnly?: boolean
}) {
  const visible = currentOnly ? stages.filter((stage) => stage.current) : stages
  return (
    <div {...stylex.props(styles.routes)} data-testid="review-routes">
      {(['normal', 'escalation'] as const)
        .filter((route) => !currentOnly || visible.some((stage) => stage.route === route))
        .map((route) => (
          <section key={route}>
            <h4 {...stylex.props(styles.heading)}>
              {(route === 'normal' ? m.review_trackingNormal : m.review_trackingEscalation)()}
            </h4>
            {visible.filter((stage) => stage.route === route).length === 0 ? (
              <p {...stylex.props(styles.note)}>{m.review_trackingNoRoute()}</p>
            ) : (
              <ol {...stylex.props(styles.list)}>
                {visible
                  .filter((stage) => stage.route === route)
                  .map((stage) => (
                    <li
                      key={stage.id}
                      {...stylex.props(styles.stage, stage.current && styles.current)}
                    >
                      <div {...stylex.props(styles.title)}>
                        <span>{stage.label ?? stage.roleNames.join(' / ')}</span>
                        {stage.current && (
                          <Badge variant="outline">{m.review_trackingCurrent()}</Badge>
                        )}
                      </div>
                      <p {...stylex.props(styles.note)}>
                        {[stage.nodeName, ...stage.roleNames].filter(Boolean).join(' / ')}
                      </p>
                      {stage.skipped !== null ? (
                        <p {...stylex.props(styles.note)}>{m.review_trackingSkipped()}</p>
                      ) : stage.reviewers.length === 0 ? (
                        <p {...stylex.props(styles.note, styles.missing)}>
                          {(stage.blockedReason === 'no-independent-reviewer'
                            ? m.review_trackingConflict
                            : m.review_trackingUnstaffed)()}
                        </p>
                      ) : (
                        <div {...stylex.props(styles.people)}>
                          {stage.reviewers.map((person) => (
                            <span key={person.id}>
                              {person.name}
                              {person.businessNo === null ? '' : `（${person.businessNo}）`}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
              </ol>
            )}
          </section>
        ))}
    </div>
  )
}
