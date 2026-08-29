import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { walkFiles } from '../lib/walk.ts'
// by path rather than by package name: these are the files the completeness
// case walks, and a subpath export would let one drift from the other
import { commonErrorMessages } from '../../packages/web/i18n/src/format.ts'
import * as apiKit from '../../packages/core/api-kit/src/schema.ts'
import * as session from '../../packages/plugins/base/auth/src/server/session-contract.ts'
import * as shared from '../../packages/contracts/rbac/src/effect.ts'
import * as auth from '../../packages/plugins/base/auth/src/server/errors.ts'
import * as org from '../../packages/plugins/base/org/src/server/errors.ts'
import * as rbac from '../../packages/plugins/base/rbac/src/server/errors.ts'
import * as authLocal from '../../packages/plugins/base/auth-local/src/api.ts'
import * as assessment from '../../packages/plugins/assessment/core/src/server/errors.ts'
import * as assessmentFormula from '../../packages/plugins/assessment/formula/src/server/errors.ts'
import { errorMessages as authMessages } from '../../packages/plugins/base/auth/src/client/i18n.ts'
import { errorMessages as authLocalMessages } from '../../packages/plugins/base/auth-local/src/client/i18n.ts'
import { errorMessages as orgMessages } from '../../packages/plugins/base/org/src/client/i18n.ts'
import { errorMessages as rbacMessages } from '../../packages/plugins/base/rbac/src/client/i18n.ts'
import { errorMessages as assessmentMessages } from '../../packages/plugins/assessment/core/src/client/i18n.ts'
import { errorMessages as assessmentFormulaMessages } from '../../packages/plugins/assessment/formula/src/client/i18n.ts'

// The rules about error codes that no single package can enforce.
//
// A code is the one part of a failure that crosses every boundary: the service
// raises it, the http layer puts it on the wire, and the browser looks it up to
// find a sentence. Two plugins using one code makes that lookup answer for
// whichever plugin the reader was not thinking about, and the check that used
// to refuse it lived in the oRPC contract aggregator, which no longer exists.
//
// The declarations are read from the classes rather than from source: the tag,
// the schema identifier and the status are all on the class, which is also
// what the running server serves.

const root = fileURLToPath(new URL('../..', import.meta.url))

// Who owns each set of declarations. `common` means every plugin's endpoints
// can return it, because it comes from the request pipeline rather than from a
// domain: the browser translates those centrally and a plugin may not claim
// them.
const SOURCES = [
  { module: apiKit, owner: 'common', file: 'packages/core/api-kit/src/schema.ts' },
  {
    module: session,
    owner: 'common',
    file: 'packages/plugins/base/auth/src/server/session-contract.ts',
  },
  {
    module: shared,
    owner: 'common',
    file: 'packages/contracts/rbac/src/effect.ts',
    // A cross-plugin invariant is declared in the contract both sides depend
    // on, and translated once by the plugin that owns the rule. Only the
    // authorization refusal beside it is everybody's.
    ownedBy: { LAST_ADMINISTRATOR: '@qualy/plugin-rbac' } as Record<string, string>,
  },
  {
    module: auth,
    owner: '@qualy/plugin-auth',
    file: 'packages/plugins/base/auth/src/server/errors.ts',
  },
  {
    module: org,
    owner: '@qualy/plugin-org',
    file: 'packages/plugins/base/org/src/server/errors.ts',
  },
  {
    module: rbac,
    owner: '@qualy/plugin-rbac',
    file: 'packages/plugins/base/rbac/src/server/errors.ts',
  },
  {
    module: authLocal,
    owner: '@qualy/plugin-auth-local',
    file: 'packages/plugins/base/auth-local/src/api.ts',
  },
  {
    module: assessmentFormula,
    owner: '@qualy/plugin-assessment-formula',
    file: 'packages/plugins/assessment/formula/src/server/errors.ts',
  },
  {
    module: assessment,
    owner: '@qualy/plugin-assessment',
    file: 'packages/plugins/assessment/core/src/server/errors.ts',
  },
] as const

// Declarations that are not wire codes. A readiness probe's failure is logged
// and never serialized - the endpoint is outside /api and answers with a
// status and nothing else; the notification transport's failure lives and
// dies inside a server-side listener fiber. Both are named like types rather
// than like codes.
const NOT_A_WIRE_CODE = [
  // schema-tagged because they cross the sandbox PROCESS boundary; the
  // plugin adapter maps them back to host-internal errors, never to HTTP
  'packages/core/sandbox-rpc/src/errors.ts',
  'packages/core/sandbox-rpc/src/authoring.ts',
  'packages/core/sandbox-rpc/src/lsp.ts',
  'apps/server/src/health.ts',
  'packages/plugins/infra/database/src/server/notifications.ts',
]

interface Declared {
  code: string
  identifier: string | undefined
  status: unknown
  owner: string
  file: string
}

const declarationsOf = (source: (typeof SOURCES)[number]): Declared[] =>
  Object.values(source.module as Record<string, unknown>).flatMap((exported) => {
    const candidate = exported as { fields?: Record<string, { ast?: { literal?: unknown } }> } & {
      ast?: { annotations?: { identifier?: string; httpApiStatus?: unknown } }
    }
    const code = candidate?.fields?._tag?.ast?.literal
    if (typeof code !== 'string') return []
    return [
      {
        code,
        identifier: candidate.ast?.annotations?.identifier,
        status: candidate.ast?.annotations?.httpApiStatus,
        owner: ('ownedBy' in source ? source.ownedBy[code] : undefined) ?? source.owner,
        file: source.file,
      },
    ]
  })

const declared = SOURCES.flatMap(declarationsOf)

/** every code a plugin's own catalog translates */
const translations: Record<string, readonly string[]> = {
  '@qualy/plugin-auth': Object.keys(authMessages),
  '@qualy/plugin-org': Object.keys(orgMessages),
  '@qualy/plugin-rbac': Object.keys(rbacMessages),
  '@qualy/plugin-auth-local': Object.keys(authLocalMessages),
  '@qualy/plugin-assessment': Object.keys(assessmentMessages),
  '@qualy/plugin-assessment-formula': Object.keys(assessmentFormulaMessages),
}

describe('error codes across the assembly', () => {
  it('declares them all somewhere this test can see', () => {
    // a module that declares failures without being listed here is invisible to
    // every rule below, which is the failure mode of a hand-written list
    const known = new Set<string>([...SOURCES.map((source) => source.file), ...NOT_A_WIRE_CODE])
    const walk = (dir: string) => walkFiles(dir, ['tests']).filter((file) => file.endsWith('.ts'))
    const declaring = [...walk(path.join(root, 'packages')), ...walk(path.join(root, 'apps'))]
      .filter((file) => fs.readFileSync(file, 'utf8').includes('TaggedError<'))
      .map((file) => path.relative(root, file))
    expect(declaring.filter((file) => !known.has(file))).toEqual([])
  })

  it('gives every code one owner', () => {
    const owners = new Map<string, Declared>()
    const collisions: string[] = []
    for (const entry of declared) {
      const previous = owners.get(entry.code)
      if (previous) {
        collisions.push(`${entry.code}: ${previous.owner} and ${entry.owner}`)
      } else {
        owners.set(entry.code, entry)
      }
    }
    expect(collisions).toEqual([])
  })

  it('spells every code the one way a client can recognize', () => {
    // the browser tells a declared failure from Effect's own tagged internals
    // by this shape, so a lowercase or PascalCase code is not translated at all
    const wrong = declared.filter((entry) => !/^[A-Z][A-Z0-9_]*$/.test(entry.code))
    expect(wrong.map((entry) => entry.code)).toEqual([])
  })

  it('gives every code a status and a readable identifier', () => {
    // the identifier is what the openapi document shows; without it the schema
    // is named after its shape and two errors with the same fields collapse
    const incomplete = declared.filter(
      (entry) =>
        entry.identifier === undefined ||
        typeof entry.status !== 'number' ||
        entry.status < 400 ||
        entry.status > 599,
    )
    expect(incomplete.map((entry) => entry.code)).toEqual([])
  })

  it('translates every code exactly once, by whoever owns it', () => {
    const common = new Set(Object.keys(commonErrorMessages))
    const problems: string[] = []
    for (const entry of declared) {
      const translated = Object.entries(translations).filter(([, codes]) =>
        codes.includes(entry.code),
      )
      if (entry.owner === 'common') {
        if (!common.has(entry.code)) problems.push(`${entry.code} is common but untranslated`)
        for (const [plugin] of translated) {
          problems.push(`${entry.code} is common but ${plugin} translates it`)
        }
        continue
      }
      if (common.has(entry.code)) problems.push(`${entry.code} is ${entry.owner}'s but also common`)
      if (translated.length === 0) problems.push(`${entry.code} has no translation`)
      for (const [plugin] of translated.filter(([plugin]) => plugin !== entry.owner)) {
        problems.push(`${entry.code} belongs to ${entry.owner} but ${plugin} translates it`)
      }
    }
    expect(problems).toEqual([])
  })

  it('translates nothing that cannot happen', () => {
    // the shape of the drift this replaced: two codes were still being
    // translated into two languages after nothing could raise them
    const codes = new Set(declared.map((entry) => entry.code))
    const orphans = Object.entries(translations).flatMap(([plugin, translated]) =>
      translated.filter((code) => !codes.has(code)).map((code) => `${plugin}: ${code}`),
    )
    expect(orphans).toEqual([])
  })

  it('keeps the common table to codes something can raise', () => {
    const codes = new Set(declared.filter((entry) => entry.owner === 'common').map((e) => e.code))
    const orphans = Object.keys(commonErrorMessages).filter((code) => !codes.has(code))
    expect(orphans).toEqual([])
  })
})
