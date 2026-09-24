import { Effect } from 'effect'
import type { Principal } from '@qualy/rbac-contract'
import { FormulaLibrary } from '@qualy/plugin-assessment-formula/testkit'
import { FORMULAS } from '../formulas.ts'
import type { Story } from './context.ts'

// Every formula the rules use, written and published through the formula
// library the way staff would in the workbench: a draft with its test cases,
// then a named release. A formula with two versions is published twice, the
// second after the first term has run on the first.

/** published version ids, by formula key and version number (1-based) */
export type PublishedFormulas = ReadonlyMap<string, readonly string[]>

export const publishFormula = (
  tenantId: string,
  key: string,
  author: Principal,
  story: Story,
  upTo = Number.POSITIVE_INFINITY,
  existing?: { functionId: string; draftRevision: number; published: number },
) =>
  Effect.gen(function* () {
    const library = yield* FormulaLibrary
    const spec = FORMULAS.find((formula) => formula.key === key)
    if (spec === undefined) return yield* Effect.die(new Error(`no formula ${key}`))
    let functionId = existing?.functionId
    let revision = existing?.draftRevision ?? 1
    if (functionId === undefined) {
      const created = yield* story.step(
        library.createFunction(
          tenantId,
          { name: spec.name, description: spec.description },
          author,
        ),
      )
      functionId = created.id
      revision = created.draftRevision
    }
    const versionIds: string[] = []
    const from = existing?.published ?? 0
    for (const version of spec.versions.slice(from, upTo)) {
      const saved = yield* story.step(
        library.updateDraft(
          tenantId,
          functionId,
          {
            expectedDraftRevision: revision,
            draftSourceTs: version.source,
            draftTests: version.tests,
          },
          author,
        ),
        240,
      )
      revision = saved.draftRevision
      const published = yield* story.step(
        library.publish(
          tenantId,
          functionId,
          {
            expectedDraftRevision: revision,
            releaseName: version.releaseName,
            releaseNotes: version.releaseNotes ?? null,
          },
          author,
        ),
      )
      versionIds.push(published.versionId)
    }
    return { functionId, draftRevision: revision, versionIds }
  })
