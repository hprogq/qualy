import { readApiExit, type SurfacePrefetch } from '@qualy/web-rsc/request'
import { serverQueries, settle } from '@qualy/web-rsc/queries'
import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { Schema } from 'effect'
import { uuidInput } from '@qualy/api-kit/schema'
import { assessmentApiGroup } from '@qualy/plugin-assessment/api'
import { Api } from '@qualy/api-kit/local'
import { formulaApi } from './api.ts'
const assessmentApi = Api.local(assessmentApiGroup)

export { default } from './CalculatorSummary.tsx'

export const prefetch: SurfacePrefetch = async ({ params, url }) => {
  const batchId = params['batchId']
  const itemId = url.searchParams.get('question') ?? ''
  if (!Schema.is(uuidInput)(batchId) || !Schema.is(uuidInput)(itemId)) return undefined
  const batch = { params: { batchId } }
  const itemsKey = queryKeyOf('assessment', 'listItems', batch)
  const items = settle(
    await readApiExit(assessmentApi, (client) => client.assessment.listItems(batch), {
      key: itemsKey,
    }),
  )
  if (items.kind !== 'answer') return undefined
  const scoring = items.value.items.find((item) => item.id === itemId)?.currentRevision
    ?.scoringConfig as { calculator?: { ref?: string } } | undefined
  if (scoring?.calculator?.ref !== 'formula@1') return undefined
  const input = { ...batch, query: { itemId } }
  const key = queryKeyOf('assessmentFormula', 'listFormulaBindingOptions', input)
  const result = settle(
    await readApiExit(
      formulaApi,
      (client) => client.assessmentFormula.listFormulaBindingOptions(input),
      { key },
    ),
  )
  if (result.kind !== 'answer') return undefined
  const queries = serverQueries()
  queries.hold(key, result.value)
  return { hydration: queries.dehydrated() }
}
