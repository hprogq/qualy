import { Schema } from 'effect'
import { uuidInput } from '@qualy/api-kit/schema'
import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { readApiExit } from '@qualy/web-rsc/request'
import { assessmentApi } from '../api.ts'

// The open batch, as the server-drawn parts of its workspace read it
// (docs/adr/0012-rsc-data-mode.md).
//
// The bar over the workspace, the rail's badges and the page under them all
// stand on the same batch. Each reads it here, under the key the browser
// reads it with, and the request makes the read once however many of them
// ask (@qualy/web-rsc/request `readApiExit` with a key).

const recordId = Schema.is(uuidInput)

/** the batch the address names, or nothing for an address that cannot name one */
export const batchIdOf = (params: Readonly<Record<string, string | undefined>>) => {
  const batchId = params['batchId']
  return batchId !== undefined && recordId(batchId) ? batchId : undefined
}

/** the batch, read once for the request, with the key the page holds it under */
export const readBatch = (batchId: string) => {
  const input = { params: { batchId } }
  const key = queryKeyOf('assessment', 'getBatch', input)
  return {
    key,
    exit: readApiExit(assessmentApi, (client) => client.assessment.getBatch(input), { key }),
  }
}
