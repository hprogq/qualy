import { assertNever, formatPlatformFailure, isUseCaseApiFailure } from '@qualy/web-i18n'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import {
  useApi,
  useApiQuery,
  useLoadFailure,
  usePageQueryState,
  usePageQueryUpdate,
  useRunApi,
} from '@qualy/web-runtime'

import * as stylex from '@stylexjs/stylex'
import { AsyncSection } from '@qualy/ui/admin'
import {
  BandAction,
  BandActions,
  DetailSheet,
  EditorSkeleton,
  Screen,
  Segmented,
  Spacer,
  Tag,
} from '@qualy/ui/screen'
import { useLingering } from '@qualy/ui/use-lingering'
import { toast } from '@qualy/ui/toast'
import { Button } from '@qualy/ui/button'
import { useIsBelow } from '@qualy/ui/use-mobile'

import { orgApi } from './api.ts'
import { shapeOf, type Run } from './shape.ts'
import { NodeDialogs, type NodeTask } from './structure/NodeDialogs.tsx'
import { NodePanel } from './structure/NodePanel.tsx'
import { RecycleBin } from './structure/RecycleBin.tsx'
import { TreeTable } from './structure/TreeTable.tsx'
import { NewTypeDialog } from './types/NewTypeDialog.tsx'
import { TypesView } from './types/TypesView.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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

  const failures = useLoadFailure()
  const queryClient = useQueryClient()
  const [view, setView] = usePageQueryState('view')
  const [selectedId, setSelectedId] = usePageQueryState('node')
  const [selectedTypeId, setSelectedTypeId] = usePageQueryState('type')
  const [creatingType, setCreatingType] = useState(false)
  const [binOpen, setBinOpen] = useState(false)
  // where the row stacks rather than laying itself across the card
  const narrow = useIsBelow(768)
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
  const refresh = () => queryClient.invalidateQueries({ queryKey: query.org.key() })
  // the one crossing from an effect to a promise on this screen; typed api
  // errors localize from their code, the english message is the last resort.
  // What the call answered is handed on: whoever created something needs the
  // thing created, not the fact that the lists were read again.
  //
  // A refusal is said in a toast: every write here is made from a dialog or a
  // sheet that stays up when it fails, and a note on the page would sit under
  // the overlay where nobody can read it.
  const run: Run = (work, own) =>
    runApi(work)
      .then(async (answer) => {
        await refresh()
        return answer
      })
      .catch((error: import('./shape.ts').OrgFailure) => {
        if (own?.(error) === true) throw error
        if (!isUseCaseApiFailure(error)) {
          toast.error(formatPlatformFailure(error))
          throw error
        }
        let failure: string
        switch (error._tag) {
          case 'ORG_TYPE_NOT_FOUND':
            failure = m.error_typeNotFound()
            break
          case 'ORG_RULE_NOT_FOUND':
            failure = m.error_ruleNotFound()
            break
          case 'ORG_NODE_NOT_FOUND':
            failure = m.error_nodeNotFound()
            break
          case 'ORG_TYPE_CONFLICT':
            failure = m.error_typeConflict()
            break
          case 'ORG_NODE_CONFLICT':
            failure = m.error_nodeConflict()
            break
          case 'ORG_TYPE_IN_USE':
            failure = m.error_typeInUse({
              where: error.reason === 'deleted-nodes' ? 'bin' : 'tree',
            })
            break
          case 'ORG_RULE_IN_USE':
            failure = m.error_ruleInUse()
            break
          case 'ORG_NODE_IN_USE':
            failure = m.error_nodeInUse()
            break
          case 'ORG_NODE_IS_ROOT':
            failure = m.error_nodeIsRoot()
            break
          case 'ORG_NODE_PARENT_DELETED':
            failure = m.error_nodeParentDeleted()
            break
          case 'ORG_NODE_HAS_CHILDREN':
            failure = m.error_nodeHasChildren()
            break
          case 'ORG_NODE_PLACEMENT_INCOMPATIBLE':
            failure = m.error_placementIncompatible({ userCount: error.userCount })
            break
          case 'ORG_NODE_ASSIGNMENT_INCOMPATIBLE':
            failure = m.error_assignmentIncompatible({ assignmentCount: error.assignmentCount })
            break
          case 'ORG_RULE_INVALID':
            failure = m.error_ruleInvalid()
            break
          case 'ORG_RULE_CYCLE':
            failure = m.error_ruleCycle()
            break
          case 'ORG_NODE_RULE_VIOLATION':
            failure = m.error_ruleViolation()
            break
          case 'ORG_NODE_INVALID_MOVE':
            failure = m.error_invalidMove()
            break
          default:
            assertNever(error)
        }
        toast.error(failure)
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
      title={m.tree_title()}
      description={(types ? m.page_typesHint : m.page_structureHint)()}
      // one width for both faces, and the switch beside the title: at the far
      // end it slid sideways whenever the face under it changed the band's
      // width or brought an action of its own
      size="broad"
      titleAside={
        <Segmented
          xstyle={styles.viewSwitch}
          label={m.view_structure()}
          value={types ? 'types' : 'structure'}
          onChange={(next) => setView(next === 'types' ? 'types' : '')}
          options={[
            { value: 'structure', label: m.view_structure() },
            { value: 'types', label: m.view_types() },
          ]}
        />
      }
      actions={
        rootManageable && (
          <BandActions
            moreLabel={m.tree_rowMore({ name: m.tree_units() })}
            primary={
              types ? (
                <BandAction
                  variant="primary"
                  icon={<PlusIcon aria-hidden />}
                  onSelect={() => setCreatingType(true)}
                >
                  {m.type_new()}
                </BandAction>
              ) : undefined
            }
            rest={
              types ? undefined : (
                // where things go when they are deleted is not an act
                // somebody came to this page to perform, and a lone
                // dustbin standing in a heading looks like one
                <BandAction
                  testId="org-bin-open"
                  icon={<Trash2Icon aria-hidden />}
                  onSelect={() => setBinOpen(true)}
                >
                  {m.bin_title()}
                </BandAction>
              )
            }
          />
        )
      }
    >
      <AsyncSection
        pending={treeQuery.isPending || typesQuery.isPending || rulesQuery.isPending}
        error={
          treeQuery.isError || typesQuery.isError || rulesQuery.isError
            ? failures.of(treeQuery.error ?? typesQuery.error ?? rulesQuery.error)
            : null
        }
        framed
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
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
            narrow={narrow}
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
          closeLabel={commonMessages.action_close()}
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
                  {m.node_rename()}
                </Button>
                {shown.parentId !== null && shown.subtreeManageable && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTask({ kind: 'move', nodeId: shown.id })}
                  >
                    {m.node_moveTo()}
                  </Button>
                )}
                {shape.rules.some((rule) => rule.parentTypeId === shown.orgTypeId) && (
                  <Button size="sm" onClick={() => setTask({ kind: 'create', nodeId: shown.id })}>
                    <PlusIcon aria-hidden />
                    {m.node_createChild()}
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
