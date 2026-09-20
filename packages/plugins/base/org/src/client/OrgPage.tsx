import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { useApi, useRunApi, useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import { EditorSkeleton, RailSkeleton, Screen, Segmented } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { orgMessages as m } from './i18n.ts'
import { orgApi } from './api.ts'
import { shapeOf, type Run } from './shape.ts'
import { NodePanel } from './structure/NodePanel.tsx'
import { NodeTree } from './structure/NodeTree.tsx'
import { NewTypeDialog } from './types/NewTypeDialog.tsx'
import { TypesView } from './types/TypesView.tsx'

// The organization, with two faces over one skeleton.
//
// Structure is a tree and the unit it has open: where that unit sits, what
// stands under it, and what may be created there. Types is the grammar the
// structure obeys - asked as "what may a college contain", because that is
// the question somebody has, rather than as a list of parent-child pairs
// nobody thinks in.

const styles = stylex.create({
  split: {
    display: 'grid',
    alignItems: 'start',
    gap: 20,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [breakpoints.desktop]: '300px minmax(0, 1fr)',
    },
  },
})

export default function OrgPage() {
  const api = useApi(orgApi)
  const runApi = useRunApi()
  const query = useApiQuery(orgApi)
  const { format, formatError } = useI18n()
  const queryClient = useQueryClient()
  const [view, setView] = usePageQueryState('view')
  const [selectedId, setSelectedId] = usePageQueryState('node')
  const [selectedTypeId, setSelectedTypeId] = usePageQueryState('type')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [creatingType, setCreatingType] = useState(false)

  const treeQuery = useQuery(query.org.getTree.queryOptions({ query: {} }))
  const typesQuery = useQuery(query.org.listTypes.queryOptions())
  const rulesQuery = useQuery(query.org.listRules.queryOptions())
  // how many people stand at each unit. Allowed to fail: reading people is a
  // grant of its own, and an organization administrator without it should
  // still get the tree
  const headcounts = useQuery({
    ...query.identity.getUserOptions.queryOptions({ query: {} }),
    retry: false,
  })
  const headcountOf = (orgNodeId: string) =>
    headcounts.data?.nodes.find((node) => node.orgNodeId === orgNodeId)?.userCount ?? 0
  // and whether that zero is an answer. Failing is allowed, so a reader
  // without the people grant saw zero everywhere - which reads exactly like
  // an empty unit, and is how a delete came to be offered on units full of
  // people
  const headcountsKnown = headcounts.isSuccess

  // targeted invalidation: only this plugin's queries, never the whole cache
  const refresh = () => {
    setFeedback(null)
    return queryClient.invalidateQueries({ queryKey: query.org.key() })
  }
  // the one crossing from an effect to a promise on this screen; typed api
  // errors localize from their code, the english message is the last resort.
  // What the call answered is handed on: whoever created something needs the
  // thing created, not the fact that the lists were read again.
  const run: Run = (work) =>
    runApi(work)
      .then(async (answer) => {
        await refresh()
        return answer
      })
      .catch((error: unknown) => {
        setFeedback(formatError(error))
        throw error
      })

  const shape = useMemo(
    () =>
      shapeOf({
        nodes: treeQuery.data?.nodes ?? [],
        rootIds: treeQuery.data?.roots ?? [],
        types: typesQuery.data?.types ?? [],
        rules: rulesQuery.data?.rules ?? [],
      }),
    [treeQuery.data, typesQuery.data, rulesQuery.data],
  )

  // A page that opens on nothing asks the reader to make a choice before it
  // will say anything, and the choice it wants is nearly always the one it
  // could have made itself. So the root stands open until another is picked.
  const selected = (selectedId ? shape.byId.get(selectedId) : undefined) ?? shape.roots[0]
  const rootManageable = shape.nodes.some((node) => !node.parentId && node.manageable)
  const types = view === 'types'

  return (
    <Screen
      title={format(m.treeTitle)}
      description={format(types ? m.typesHint : m.structureHint)}
      size={types ? 'default' : 'broad'}
      actions={
        <>
          <Segmented
            label={format(m.viewStructure)}
            value={types ? 'types' : 'structure'}
            onChange={(next) => setView(next === 'types' ? 'types' : '')}
            options={[
              { value: 'structure', label: format(m.viewStructure) },
              { value: 'types', label: format(m.viewTypes) },
            ]}
          />
          {/* after the view switch, which therefore never moves: the one
              action only one face offers comes and goes at the far end */}
          {rootManageable && types && (
            <Button onClick={() => setCreatingType(true)}>
              <PlusIcon aria-hidden />
              {format(m.newTypeTitle)}
            </Button>
          )}
        </>
      }
    >
      <Feedback message={feedback} />
      <AsyncSection
        pending={treeQuery.isPending || typesQuery.isPending || rulesQuery.isPending}
        error={
          treeQuery.isError || typesQuery.isError || rulesQuery.isError
            ? format(m.loadFailedHint)
            : null
        }
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void refresh()}
        skeleton={
          <div {...stylex.props(styles.split)}>
            <RailSkeleton rows={7} />
            <EditorSkeleton />
          </div>
        }
      >
        {types ? (
          <TypesView
            shape={shape}
            openId={selectedTypeId}
            onOpen={setSelectedTypeId}
            api={api}
            run={run}
            canManage={rootManageable}
          />
        ) : (
          <div {...stylex.props(styles.split)}>
            <NodeTree
              shape={shape}
              openId={selected?.id ?? null}
              onOpen={setSelectedId}
              headcountOf={headcountOf}
            />
            {selected !== undefined && (
              <NodePanel
                key={selected.id}
                node={selected}
                shape={shape}
                api={api}
                run={run}
                onOpen={setSelectedId}
                headcount={headcountOf(selected.id)}
                headcountOf={headcountOf}
                headcountKnown={headcountsKnown}
              />
            )}
          </div>
        )}
      </AsyncSection>
      <NewTypeDialog
        open={creatingType}
        api={api}
        run={run}
        onCreated={setSelectedTypeId}
        onClose={() => setCreatingType(false)}
      />
    </Screen>
  )
}
