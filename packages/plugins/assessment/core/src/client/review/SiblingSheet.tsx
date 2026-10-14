import { useLocale } from '@qualy/web-i18n'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, useLoadFailure } from '@qualy/web-runtime'
import { AsyncSection } from '@qualy/ui/admin'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@qualy/ui/dialog'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import { assessmentApi } from '../api.ts'
import { useBatchZone } from '../batch/zone.ts'
import { AttachmentLink } from '../entry/AttachmentLink.tsx'
import {
  answerOf,
  displayValueOf,
  entryStatusMessage,
  fieldsOf,
  type EntryDto,
} from '../entry/model.ts'
import { idsOf, timeLabel, valueOf } from './model.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

const REVIEW_NOT_FOUND = 'ASSESSMENT_REVIEW_NOT_FOUND'

const styles = stylex.create({
  title: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 14,
    lineHeight: '1.25rem',
  },
  standing: {
    fontSize: 12,
    fontWeight: 400,
    color: tokens.mutedForeground,
  },
  version: {
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  fieldList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  fieldRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  fieldName: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 10,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  anywhere: {
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  filesCount: {
    flexShrink: 0,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  fieldValue: {
    minWidth: 0,
    fontSize: 14,
    lineHeight: 1.625,
    overflowWrap: 'anywhere',
  },
  fileRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  mutedInk: {
    color: tokens.mutedForeground,
  },
  skeleton: {
    height: '8rem',
    width: '100%',
  },
})

/**
 * Another claim the participant holds on the same question, read whole.
 *
 * Fetched when opened rather than shipped with the round: the strip only
 * needs each claim's summary to be told apart, and the whole filing - every
 * field, every file - is wanted for the one claim somebody actually opens.
 * Drawn the way the judged filing is, field by field with files in their own
 * places, so the two read against each other.
 */
export function SiblingSheet({
  open,
  instanceId,
  itemTitle,
  entryId,
  onClose,
}: {
  open: boolean
  instanceId: string
  itemTitle: string
  /** null once the claim it named is gone; the panel is shutting anyway */
  entryId: string | null
  onClose: () => void
}) {
  return (
    <Dialog open={open && entryId !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="36rem">
        {/* mounted only while open, so nothing is asked before it is */}
        {entryId !== null && (
          <SiblingFiling instanceId={instanceId} itemTitle={itemTitle} entryId={entryId} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SiblingFiling({
  instanceId,
  itemTitle,
  entryId,
}: {
  instanceId: string
  itemTitle: string
  entryId: string
}) {
  const locale = useLocale()
  const zone = useBatchZone()
  const query = useApiQuery(assessmentApi)
  const loadFailure = useLoadFailure()
  const sibling = useQuery({
    ...query.assessment.getReviewSibling.queryOptions({ params: { instanceId, entryId } }),
    staleTime: 30_000,
  })
  const filing = sibling.data?.sibling
  const fields = fieldsOf(filing?.form.formConfig)
  const record = (filing?.revision.payload ?? {}) as Record<string, unknown>
  const words = { yes: m.recognition_yes(), no: m.recognition_no() }
  return (
    <>
      <DialogHeader>
        <DialogTitle className={stylex.props(styles.title).className}>
          {itemTitle}
          <span {...stylex.props(styles.standing)}>
            {filing === undefined
              ? ''
              : (entryStatusMessage[filing.status as EntryDto['status']] ?? m.event_other)()}
          </span>
        </DialogTitle>
        {filing !== undefined && (
          <p {...stylex.props(styles.version)}>
            {m.review_filedVersion({
              no: filing.revision.revisionNo,
              at: timeLabel(filing.submittedAt, locale, zone),
            })}
          </p>
        )}
      </DialogHeader>
      <AsyncSection
        pending={sibling.isPending}
        error={
          sibling.error ? loadFailure.of(sibling.error, { missing: [REVIEW_NOT_FOUND] }) : null
        }
        retrying={sibling.isFetching}
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() => void sibling.refetch()}
        skeleton={<Skeleton className={stylex.props(styles.skeleton).className} />}
      >
        <dl {...stylex.props(styles.fieldList)}>
          {fields.map((field) => {
            const raw = answerOf(record, field.key)
            const cited = field.type === 'attachment' ? idsOf(raw) : []
            const shown = displayValueOf(field, raw, words) || valueOf(raw)
            return (
              <div key={field.key} {...stylex.props(styles.fieldRow)}>
                <dt {...stylex.props(styles.fieldName)}>
                  <span {...stylex.props(styles.anywhere)}>{field.label}</span>
                  {cited.length > 0 && (
                    <span {...stylex.props(styles.filesCount)}>
                      {m.review_filesCount({ count: cited.length })}
                    </span>
                  )}
                </dt>
                <dd {...stylex.props(styles.fieldValue)}>
                  {field.type === 'attachment' ? (
                    cited.length === 0 ? (
                      <span {...stylex.props(styles.mutedInk)}>–</span>
                    ) : (
                      <span {...stylex.props(styles.fileRow)}>
                        {cited.map((attachmentId) => (
                          <AttachmentLink
                            key={attachmentId}
                            attachmentId={attachmentId}
                            variant="card"
                          />
                        ))}
                      </span>
                    )
                  ) : shown === '' ? (
                    <span {...stylex.props(styles.mutedInk)}>–</span>
                  ) : (
                    shown
                  )}
                </dd>
              </div>
            )
          })}
          {filing !== undefined && filing.revision.note !== null && (
            <div {...stylex.props(styles.fieldRow)}>
              <dt {...stylex.props(styles.fieldName)}>{m.entry_note()}</dt>
              <dd {...stylex.props(styles.fieldValue)}>{filing.revision.note}</dd>
            </div>
          )}
        </dl>
      </AsyncSection>
    </>
  )
}
