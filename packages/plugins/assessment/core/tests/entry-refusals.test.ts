import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReservationInvalidReason, UploadRefusedReason } from '@qualy/plugin-storage/errors'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  entryRefusalMessage,
  entryRefusalReason,
  filingHeldOf,
  holdOf,
  sayBlocked,
  sayEntryFailure,
  sayHeld,
  sayOwnRefusal,
} from '../src/client/entry/refusals.ts'

import type { GateDecision } from '../src/phase/gate.ts'
import * as m from '#messages'

// the page's language, where the sentences below are said
const onPage = (locale: string) => {
  ;(globalThis as { document?: unknown }).document = { documentElement: { dataset: { locale } } }
}
afterEach(() => {
  delete (globalThis as { document?: unknown }).document
})

// One code, ASSESSMENT_ENTRY_ACTION_REFUSED, carries every refused entry
// act; the reason is what a screen can say. A reason the server raises with
// no sentence of its own reaches a person as "not available in its current
// state", which tells them nothing to do next. This holds the server's
// reasons, read from its source, to the browser's table.

const src = fileURLToPath(new URL('../src/', import.meta.url))

const serverFiles = readdirSync(src, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.ts') && !file.startsWith(`client${path.sep}`))
  .map((file) => ({ file, text: readFileSync(path.join(src, file), 'utf8') }))

/** the text between a call's parentheses, from the one that opens at `open` */
const argumentsAt = (text: string, open: number): string => {
  let depth = 1
  let at = open + 1
  while (depth > 0 && at < text.length) {
    if (text[at] === '(') depth += 1
    else if (text[at] === ')') depth -= 1
    at += 1
  }
  return text.slice(open + 1, at - 1)
}

/** splits at the commas that separate arguments, not the ones inside them */
const topLevel = (args: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let at = 0; at < args.length; at += 1) {
    const char = args[at]
    if (char === '(' || char === '{' || char === '[') depth += 1
    else if (char === ')' || char === '}' || char === ']') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(args.slice(from, at))
      from = at + 1
    }
  }
  parts.push(args.slice(from))
  return parts
}

/**
 * The reason literals an expression can evaluate to: what nested calls take
 * and what a comparison tests are not among them.
 */
const reasonLiterals = (expression: string): string[] => {
  let flat = expression
  for (let previous = ''; previous !== flat;) {
    previous = flat
    flat = flat.replace(/\([^()]*\)/g, '')
  }
  flat = flat.replace(/(?:===|!==)\s*'[^']*'/g, '').replace(/'[^']*'\s*(?:===|!==)/g, '')
  return [...flat.matchAll(/'([a-z]+(?:-[a-z]+)*)'/g)].map((found) => found[1]!)
}

const raised = new Map<string, string>()
const note = (reason: string, file: string) => {
  if (!raised.has(reason)) raised.set(reason, file)
}

for (const { file, text } of serverFiles) {
  // new EntryActionRefused({ action, reason })
  for (const found of text.matchAll(/new EntryActionRefused\(/g)) {
    const args = argumentsAt(text, found.index + found[0].length - 1)
    const reason = /reason:\s*([\s\S]*?)\s*}\s*$/.exec(args)
    if (reason !== null) for (const one of reasonLiterals(reason[1]!)) note(one, file)
  }
  // a local shorthand that builds one, called with the reason at its place
  for (const helper of text.matchAll(/const (\w+) = \(([^)]*)\) =>\s*new EntryActionRefused\(/g)) {
    const params = helper[2]!.split(',').map((param) => param.split(':')[0]!.trim())
    const place = params.indexOf('reason')
    expect(place, `${file}: ${helper[1]} names no reason parameter`).toBeGreaterThanOrEqual(0)
    for (const call of text.matchAll(new RegExp(`(?<![\\w.])${helper[1]}\\(`, 'g'))) {
      if (call.index === helper.index + 'const '.length) continue
      const args = topLevel(argumentsAt(text, call.index + call[0].length - 1))
      const argument = args[place]
      if (argument !== undefined) for (const one of reasonLiterals(argument)) note(one, file)
    }
  }
  // the decisions an act is refused through, and the acts a screen shows blocked
  for (const found of text.matchAll(/(?:allowed: false|state: 'blocked'),[^}]*?reason:\s*/g)) {
    const rest = text.slice(found.index + found[0].length)
    const end = rest.search(/\s*}/)
    for (const one of reasonLiterals(rest.slice(0, end))) note(one, file)
  }
}

// what the phase gate says, and what storage says about an upload, both
// passed through as the refusal's reason; typed so a new one fails here
const gateReasons: Record<Extract<GateDecision, { allowed: false }>['reason'], true> = {
  'no-active-phase': true,
  'phase-closed': true,
  'item-out-of-scope': true,
  'participant-out-of-scope': true,
}
const storageReasons: Record<UploadRefusedReason | ReservationInvalidReason, true> = {
  'file-too-large': true,
  'too-many-reservations': true,
  'owner-quota-exceeded': true,
  'tenant-quota-exceeded': true,
  'rate-limited': true,
  'not-uploaded': true,
  expired: true,
  failed: true,
  'being-cleaned-up': true,
  oversized: true,
}
for (const reason of Object.keys(gateReasons)) note(reason, 'phase/gate.ts')
for (const reason of Object.keys(storageReasons)) note(reason, '@qualy/plugin-storage/errors')

describe('why an entry act was refused', () => {
  it('reads the reasons out of the services, so an empty scan cannot pass', () => {
    // the ones the staff drawer and the workbench meet, among everything else
    for (const reason of ['entry-not-returnable', 'item-not-fileable', 'chain-ends-here']) {
      expect(raised.has(reason), reason).toBe(true)
    }
  })

  it('has a sentence of its own for every reason the server gives', () => {
    const untold = [...raised]
      .filter(([reason]) => entryRefusalReason(reason) === null)
      .map(([reason, file]) => `${reason} (${file})`)
    expect(untold).toEqual([])
  })

  it('tells staff the refusal itself, and anything else the way every error is told', () => {
    onPage('en-US')
    const words = { formatError: () => 'general' }
    expect(
      sayEntryFailure(
        {
          _tag: 'ASSESSMENT_ENTRY_ACTION_REFUSED',
          action: 'return',
          reason: 'entry-not-returnable',
        },
        words,
      ),
    ).toBe(m.entry_refuseNotReturnable())
    expect(sayEntryFailure({ _tag: 'ASSESSMENT_BATCH_READ_ONLY' }, words)).toBe('general')
  })
})

// A stage holding one of the owner's acts is said with the act named - and
// the stage, where the round names it. What is held here is which sentence
// is chosen and what fills it: each is compared with the sentence it should
// be, said the same way, never with words written into the test.
describe('why a stage holds the owner’s act', () => {
  const words = { locale: 'en-US' }
  const acts = (...said: string[]) =>
    new Intl.ListFormat('en-US', { type: 'disjunction' }).format(
      said.map((act) => m.entry_heldAct({ act })),
    )
  const during = { status: 'active', phaseName: ' 材料审核 ' }
  const refused = (action: string, reason: string) => ({
    _tag: 'ASSESSMENT_ENTRY_ACTION_REFUSED',
    action,
    reason,
  })
  beforeEach(() => onPage('en-US'))

  it('reads the gate’s reason against where the round stands', () => {
    expect(holdOf('phase-closed', during)).toEqual({ why: 'phase', phase: '材料审核' })
    expect(holdOf('phase-closed', { status: 'active', phaseName: null })).toEqual({ why: 'stage' })
    expect(holdOf('phase-closed', null)).toEqual({ why: 'stage' })
    expect(holdOf('no-active-phase', { status: 'archived', phaseName: null })).toEqual({
      why: 'archived',
    })
    expect(holdOf('no-active-phase', { status: 'draft', phaseName: null })).toEqual({
      why: 'unstarted',
    })
    expect(holdOf('no-active-phase', { status: 'active', phaseName: null })).toEqual({
      why: 'idle',
    })
    expect(holdOf('item-out-of-scope', during)).toEqual({ why: 'item' })
    expect(holdOf('participant-out-of-scope', during)).toEqual({ why: 'people' })
    // a reason that is not the stage's is no hold
    expect(holdOf('review-under-way', during)).toBeNull()
    expect(holdOf(null, during)).toBeNull()
  })

  it('names every act one stage holds, once, in the reader’s own list', () => {
    expect(sayHeld({ why: 'phase', phase: '材料审核' }, ['edit', 'submit'], words)).toBe(
      m.entry_held({ why: 'phase', phase: '材料审核', acts: acts('edit', 'submit') }),
    )
    expect(sayHeld({ why: 'archived' }, ['abandon'], words)).toBe(
      m.entry_held({ why: 'archived', phase: '', acts: acts('abandon') }),
    )
  })

  it('says a refused press by the act the server refused and the stage that holds it', () => {
    expect(sayOwnRefusal(refused('withdraw', 'phase-closed'), during, words)).toBe(
      m.entry_held({ why: 'phase', phase: '材料审核', acts: acts('withdraw') }),
    )
    expect(
      sayOwnRefusal(refused('appeal', 'no-active-phase'), { ...during, status: 'archived' }, words),
    ).toBe(m.entry_held({ why: 'archived', phase: '', acts: acts('appeal') }))
    // starting a claim is said the way its question says it
    expect(sayOwnRefusal(refused('create', 'phase-closed'), during, words)).toBe(
      m.entries_heldPhase({ phase: '材料审核' }),
    )
    // a refusal that is not the stage's keeps its own sentence
    expect(sayOwnRefusal(refused('withdraw', 'review-under-way'), during, words)).toBe(
      m.entry_refuseReviewUnderWay(),
    )
    // an act that is not the owner's keeps the general sentence
    expect(sayOwnRefusal(refused('return', 'phase-closed'), during, words)).toBe(
      m.entry_refusePhaseClosed(),
    )
    expect(sayOwnRefusal({ _tag: 'ASSESSMENT_BATCH_READ_ONLY' }, during, words)).toBeNull()
  })

  it('hints at a shut key with its act, or with the refusal it carries', () => {
    expect(sayBlocked('submit', 'phase-closed', during, words)).toBe(
      m.entry_held({ why: 'phase', phase: '材料审核', acts: acts('submit') }),
    )
    expect(sayBlocked('submit', 'must-revise-first', during, words)).toBe(
      m.entry_refuseNeedsRevision(),
    )
    expect(sayBlocked('edit', null, during, words)).toBe(m.entry_blockedNow())
  })

  // A route with nowhere to stand for the reader is not the stage's doing,
  // and waiting for another stage would not mend it: the place where the
  // next claim would start says so, and who can mend it.
  it('says a route with nowhere to stand where the next claim would start', () => {
    expect(filingHeldOf('review-level-missing', during).message).toBe(m.entries_heldRoute)
    expect(filingHeldOf('review-level-missing', null).message).toBe(m.entries_heldRoute)
    // sending names the review route; the submit key says so
    expect(sayBlocked('submit', 'review-level-missing', during, words)).toBe(
      m.entry_refuseReviewLevelMissing(),
    )
  })

  // An appeal walks the route above the ordinary one, and the staff's
  // reopening walks it too: where that route has nowhere to stand, the
  // sentence names that route and the act it held, not "sending for review".
  it('says an appeal route with nowhere to stand as an appeal', () => {
    expect(sayBlocked('appeal', 'review-level-missing', during, words)).toBe(
      m.entry_refuseAppealRouteMissing(),
    )
    expect(sayOwnRefusal(refused('appeal', 'review-level-missing'), during, words)).toBe(
      m.entry_refuseAppealRouteMissing(),
    )
    expect(entryRefusalMessage(refused('reopen', 'review-level-missing'))).toBe(
      m.entry_refuseReopenRouteMissing,
    )
    // and a claim being sent keeps the review route's own sentence
    expect(entryRefusalMessage(refused('submit', 'review-level-missing'))).toBe(
      m.entry_refuseReviewLevelMissing,
    )
  })
})
