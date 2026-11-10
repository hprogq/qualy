import { Suspense } from 'react'
import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { answersOf, settle, within } from '@qualy/web-rsc/queries'
import { readApiExit, renderRequest, type SurfacePrefetch } from '@qualy/web-rsc/request'
import { assessmentApi } from '../api.ts'
import { batchIdOf, keyed, namesRecord } from '../batch/batch-reads.server.ts'
import { calculatorSummarySlot, calculatorEditorSlot } from '../../surfaces.ts'
import { configOf, draftOf, itemTypeOf, type Contract } from './editor/model.ts'
import { coverageRequestsOf } from './editor/coverage.ts'
import ItemSettingsPage from './ItemSettingsPage.tsx'

export const prefetch: SurfacePrefetch = async ({ url, manifest }) => {
  const question = url.searchParams.get('question') ?? ''
  if (!namesRecord(question)) return undefined
  return {
    slotReferences: [calculatorSummarySlot, calculatorEditorSlot].flatMap((slot) =>
      (manifest.slots[slot.key] ?? []).map(({ id }) => ({
        kind: 'slot' as const,
        slot: slot.key,
        id,
      })),
    ),
  }
}

async function prepare(params: Readonly<Record<string, string | undefined>>) {
  const batchId = batchIdOf(params)
  if (batchId === undefined) return null
  const batch = { params: { batchId } }
  const groups = keyed('listScoreGroups', batch, (client) =>
    client.assessment.listScoreGroups(batch),
  )
  const items = keyed('listItems', batch, (client) => client.assessment.listItems(batch))
  const options = keyed('itemOptions', batch, (client) => client.assessment.itemOptions(batch))
  const alerts = keyed('reviewAlerts', batch, (client) => client.assessment.reviewAlerts(batch))
  const reads: {
    key: readonly unknown[]
    exit: Promise<import('effect').Exit.Exit<unknown, unknown>>
  }[] = [groups, items, options, alerts]
  const question = renderRequest().url.searchParams.get('question') ?? ''
  if (namesRecord(question)) {
    const [groupExit, itemExit, optionExit] = await Promise.all([
      groups.exit,
      items.exit,
      options.exit,
    ])
    const groupResult = settle(groupExit)
    const itemResult = settle(itemExit)
    const optionResult = settle(optionExit)
    if (
      groupResult.kind === 'answer' &&
      itemResult.kind === 'answer' &&
      optionResult.kind === 'answer'
    ) {
      const item = itemResult.value.items.find((candidate) => candidate.id === question)
      if (item !== undefined) {
        const locale = renderRequest().locale
        const draft = draftOf(item, groupResult.value.groups, optionResult.value)
        const formConfig = configOf(draft, item, null, locale).formConfig
        const calculator =
          draft.scoring.language === 'v2'
            ? draft.scoring.calculator
            : { ref: 'fixed@1', config: { value: draft.fixedValue } }
        let contract: Contract | null = null
        if (draft.scoring.language === 'v2' && draft.scoring.configured) {
          const key = [
            'assessment',
            'scoring-preview',
            batchId,
            item.id,
            itemTypeOf(draft, item),
            JSON.stringify(formConfig),
            calculator.ref,
            JSON.stringify(calculator.config),
          ]
          const exit = readApiExit(
            assessmentApi,
            (client) =>
              client.assessment.previewScoring({
                ...batch,
                payload: {
                  itemId: item.id,
                  itemType: itemTypeOf(draft, item),
                  formConfig,
                  calculator,
                },
              }),
            { key },
          )
          reads.push({ key, exit })
          const answer = settle(await exit)
          if (answer.kind === 'answer') contract = answer.value as Contract
        }
        const config = configOf(draft, item, contract, locale)
        const checkKey = JSON.stringify([itemTypeOf(draft, item), draft.scoreGroupId, config])
        const key = ['assessment', 'item-check', batchId, item.id, checkKey]
        reads.push({
          key,
          exit: readApiExit(
            assessmentApi,
            (client) =>
              client.assessment.checkItem({
                ...batch,
                payload: {
                  itemId: item.id,
                  itemType: itemTypeOf(draft, item),
                  scoreGroupId: draft.scoreGroupId,
                  config,
                },
              }),
            { key },
          ),
        })
        for (const { input } of coverageRequestsOf(batchId, draft.stages))
          reads.push(
            keyed('reviewCoverage', input, (client) => client.assessment.reviewCoverage(input)),
          )
      }
    }
  }
  // A partially populated editor falsely calls an unavailable contract a
  // configuration fault. Keep its outline until all initial readings settle.
  await Promise.all(reads.map((read) => read.exit))
  return answersOf(reads)
}

async function Ready({ prepared }: { prepared: ReturnType<typeof prepare> }) {
  const handed = await prepared
  return handed === null ? (
    <ItemSettingsPage />
  ) : (
    <QueryHydration {...handed}>
      <ItemSettingsPage />
    </QueryHydration>
  )
}

export default async function ItemSettings({
  params = {},
}: {
  params?: Readonly<Record<string, string | undefined>>
}) {
  const prepared = prepare(params)
  const first = await within(prepared)
  if (first !== undefined)
    return first === null ? (
      <ItemSettingsPage />
    ) : (
      <QueryHydration {...first}>
        <ItemSettingsPage />
      </QueryHydration>
    )
  return (
    <Suspense fallback={<ItemSettingsPage />}>
      <Ready prepared={prepared} />
    </Suspense>
  )
}
