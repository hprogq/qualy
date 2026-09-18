import type { HighlightAnswer, HighlightAsk } from './source-highlight.worker.ts'

// TypeScript, coloured for reading.
//
// A template's source is somebody else's code being read to decide whether to
// copy it; the editor's Monaco is a chunk of its own that such a reader should
// never wait for. So this is the reader's half of the pair: a TextMate
// tokenizer and nothing else - no language service, no worker session, no
// diagnostics.
//
// This module is only the way to that tokenizer. It holds no grammar and no
// theme: the whole of Shiki lives in the worker beside it, which is what keeps
// a page that is being read from stalling while its source is coloured, and
// keeps every byte of the tokenizer out of the page's own chunks until a
// source is actually on screen.

/** one coloured piece of a line; `color` is a CSS colour, already themed */
export interface SourceToken {
  readonly text: string
  readonly color?: string
  /** the reader's medium weight, which the theme asks for by TextMate's bold bit */
  readonly strong?: boolean
}

type Waiting = (lines: readonly (readonly SourceToken[])[] | null) => void

const waiting = new Map<number, Waiting>()
let asked = 0
let worker: Worker | null = null
/** a worker that could not be built, or that died, is never tried again */
let refused = false

const giveUp = (): void => {
  refused = true
  worker = null
  for (const settle of waiting.values()) settle(null)
  waiting.clear()
}

const open = (): Worker | null => {
  if (refused) return null
  if (worker !== null) return worker
  try {
    const started = new Worker(new URL('./source-highlight.worker.ts', import.meta.url), {
      type: 'module',
    })
    started.onmessage = (event: MessageEvent<HighlightAnswer>) => {
      const settle = waiting.get(event.data.id)
      if (settle === undefined) return
      waiting.delete(event.data.id)
      settle(event.data.lines)
    }
    // a worker that fails to load or throws leaves the reader with plain text,
    // which is the same answer as a grammar it could not read
    started.onerror = giveUp
    started.onmessageerror = giveUp
    worker = started
    return started
  } catch {
    refused = true
    return null
  }
}

/**
 * The source as coloured lines, or null where it could not be coloured.
 *
 * Null is an ordinary answer: highlighting is an enhancement of a reader that
 * already works, so a failure here leaves plain text on screen and nothing in
 * front of the person reading it.
 */
export const highlightFormulaSource = (
  source: string,
): Promise<readonly (readonly SourceToken[])[] | null> => {
  const started = open()
  if (started === null) return Promise.resolve(null)
  const id = ++asked
  return new Promise<readonly (readonly SourceToken[])[] | null>((resolve) => {
    waiting.set(id, resolve)
    const ask: HighlightAsk = { id, source }
    started.postMessage(ask)
  })
}
