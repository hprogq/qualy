import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import {
  useApi,
  useRunApi,
  useApiQuery,
  usePageQueryState,
  usePageQueryUpdate,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import { DetailSheet, EditorSkeleton, Screen, Segmented, Spacer, Tag } from '@qualy/ui/screen'
import { useLingering } from '@qualy/ui/use-lingering'
import { Button } from '@qualy/ui/button'
import { orgMessages as m } from './i18n.ts'
import { orgApi } from './api.ts'
import { shapeOf, type Run } from './shape.ts'
import { NodeDialogs, type NodeTask } from './structure/NodeDialogs.tsx'
import { NodePanel } from './structure/NodePanel.tsx'
import { RecycleBin } from './structure/RecycleBin.tsx'
import { TreeTable } from './structure/TreeTable.tsx'
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
  viewSwitch: { marginLeft: 8 },
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
  const [binOpen, setBinOpen] = useState(false)
  const [task, setTask] = useState<NodeTask | null>(null)
  // two address keys in one write: separate writes from one press race
  const writeAddress = usePageQueryUpdate()

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

  // A unit opens beside the tree only when somebody asks for one; the tree
  // itself is what the page is for.
  const open = selectedId ? shape.byId.get(selectedId) : undefined
  // kept while its sheet slides away, so the sheet does not empty first
  const shown = useLingering(open ?? null)
  const rootManageable = shape.nodes.some((node) => !node.parentId && node.manageable)
  const types = view === 'types'

  return (
    <Screen
      title={format(m.treeTitle)}
      description={format(types ? m.typesHint : m.structureHint)}
      // one width for both faces, and the switch beside the title: at the far
      // end it slid sideways whenever the face under it changed the band's
      // width or brought an action of its own
      size="broad"
      titleAside={
        <Segmented
          xstyle={styles.viewSwitch}
          label={format(m.viewStructure)}
          value={types ? 'types' : 'structure'}
          onChange={(next) => setView(next === 'types' ? 'types' : '')}
          options={[
            { value: 'structure', label: format(m.viewStructure) },
            { value: 'types', label: format(m.viewTypes) },
          ]}
        />
      }
      actions={
        rootManageable &&
        (types ? (
          <Button onClick={() => setCreatingType(true)}>
            <PlusIcon aria-hidden />
            {format(m.newTypeTitle)}
          </Button>
        ) : (
          <Button variant="ghost" data-testid="org-bin-open" onClick={() => setBinOpen(true)}>
            <Trash2Icon aria-hidden />
            {format(m.binTitle)}
          </Button>
        ))
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
        skeleton={<EditorSkeleton />}
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
          <TreeTable
            shape={shape}
            openId={open?.id ?? null}
            onOpen={setSelectedId}
            headcountOf={headcountOf}
            headcountKnown={headcountsKnown}
            onTask={setTask}
          />
        )}
      </AsyncSection>
      <RecycleBin
        open={binOpen}
        shape={shape}
        api={api}
        run={run}
        onClose={() => setBinOpen(false)}
      />
      {shown !== null && (
        <DetailSheet
          open={open !== undefined && !types}
          onClose={() => setSelectedId('')}
          width="wide"
          title={shown.name}
          titleAside={
            <Tag>{shape.types.find((type) => type.id === shown.orgTypeId)?.name ?? ''}</Tag>
          }
          closeLabel={format(commonMessages.close)}
          testId="node-sheet"
          // what is done to the unit sits at the foot of its sheet, where a
          // sheet's actions go; removing it stays in the body, at the end of
          // the list that says whether it can be
          footer={
            shown.manageable ? (
              <>
                <Spacer />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTask({ kind: 'rename', nodeId: shown.id })}
                >
                  {format(m.rename)}
                </Button>
                {shown.parentId !== null && shown.subtreeManageable && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTask({ kind: 'move', nodeId: shown.id })}
                  >
                    {format(m.moveTo)}
                  </Button>
                )}
                {shape.rules.some((rule) => rule.parentTypeId === shown.orgTypeId) && (
                  <Button size="sm" onClick={() => setTask({ kind: 'create', nodeId: shown.id })}>
                    <PlusIcon aria-hidden />
                    {format(m.createChild)}
                  </Button>
                )}
              </>
            ) : undefined
          }
        >
          <NodePanel
            key={shown.id}
            inSheet
            node={shown}
            shape={shape}
            api={api}
            run={run}
            onOpen={setSelectedId}
            onDeleted={() => setSelectedId('')}
            onTask={setTask}
            headcount={headcountOf(shown.id)}
            headcountOf={headcountOf}
            headcountKnown={headcountsKnown}
          />
        </DetailSheet>
      )}
      <NodeDialogs
        task={task}
        shape={shape}
        api={api}
        run={run}
        onDone={() => setTask(null)}
        onOpenRules={(orgTypeId) => writeAddress({ view: 'types', type: orgTypeId, node: '' })}
      />
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
