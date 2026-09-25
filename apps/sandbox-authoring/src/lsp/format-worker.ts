/**
 * Prettier, away from the process that answers everybody's language
 * requests: formatting runs synchronously to the end of a document once it
 * starts, and some documents take minutes. Here it can only stall this
 * thread, which the formatter terminates when it runs out of time.
 */

import { parentPort } from 'node:worker_threads'
import prettier from 'prettier'

// the formatter is deliberately the REPOSITORY's own style, frozen: a
// formula reads like every example in the docs, and running format twice
// changes nothing
const FORMAT_STYLE = {
  parser: 'typescript',
  semi: false,
  singleQuote: true,
  printWidth: 100,
} as const

interface FormatRequest {
  readonly id: number
  readonly text: string
}

const port = parentPort
if (port === null) throw new Error('the format worker runs as a worker thread')

port.on('message', (request: FormatRequest) => {
  prettier.format(request.text, FORMAT_STYLE).then(
    (formatted) => port.postMessage({ id: request.id, formatted }),
    // a syntactically broken document cannot be formatted; which way it
    // broke is not worth a round trip
    () => port.postMessage({ id: request.id, failed: true }),
  )
})
