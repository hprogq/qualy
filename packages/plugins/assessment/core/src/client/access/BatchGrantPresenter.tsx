import { Skeleton } from '@qualy/ui/skeleton'
import { useQuery } from '@tanstack/react-query'
import type { ResourceGrantContext } from '@qualy/ui-contract'
import { PageLink, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import * as stylex from '@stylexjs/stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// A grant confined to one round, in this plugin's words: which round, and
// the way to it. Rendered by the grants screen for exactly this kind of
// object; it reads the round through this plugin's own api, so a reader
// who may not see the round learns only that it is one.

const styles = stylex.create({
  line: {
    display: 'inline-flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
  },
  link: {
    fontWeight: 500,
    textDecoration: {
      default: 'none',
      ':hover': 'underline',
    },
  },
})

export default function BatchGrantPresenter({ context }: { context: ResourceGrantContext }) {
  const batchId = context.grant.resource.id
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const batch = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    staleTime: 60_000,
    retry: false,
  })
  const name = batch.data?.batch.name

  // The column this sits in is already headed "comes from", so the round's
  // own name is the whole answer, and it is the way to the round. While the
  // name is on its way a bar holds its place: a sentence that is about to be
  // replaced by a different sentence is a flicker, not information.
  return (
    <span data-testid="grant-origin-batch" data-batch-id={batchId} {...stylex.props(styles.line)}>
      {batch.isPending ? (
        <Skeleton height={11} width="8rem" radius={4} />
      ) : name === undefined ? (
        <span>{format(m.grantFromSomeBatch)}</span>
      ) : (
        <PageLink
          page="assessment/batch"
          params={{ batchId }}
          className={stylex.props(styles.link).className}
          // a reader who may not open rounds still reads which one it is
          unavailable={<span>{name}</span>}
        >
          {name}
        </PageLink>
      )}
    </span>
  )
}
