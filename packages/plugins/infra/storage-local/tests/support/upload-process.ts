import { Effect } from 'effect'
import { localReceiver } from '../../src/server/backend.ts'

const [root, reservationId, key, label] = process.argv.slice(2)
if (!root || !reservationId || !key || !label) throw new Error('missing upload fixture arguments')
const finish = new Promise<void>((resolve) => {
  process.once('message', () => resolve())
})
const result = await Effect.runPromiseExit(
  localReceiver(root).receive({
    reservationId,
    key,
    maxBytes: 64n,
    body: (async function* () {
      yield Buffer.from(label)
      process.send?.('ready')
      await finish
      yield Buffer.from('-complete')
    })(),
  }),
)
process.send?.(result._tag)
process.disconnect()
