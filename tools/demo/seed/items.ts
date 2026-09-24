import { Effect } from 'effect'
import type { Principal } from '@qualy/rbac-contract'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { GROUPS, itemsOf, type ItemSpec, type Term } from '../rules.ts'
import type { Story } from './context.ts'
import type { World } from './world.ts'

// A term's questions, turned into the configuration the item service takes.
//
// The review ladder is the same for every question a student files:
//
//   normal      the class lead at the student's class
//   escalation  the three major leads together (all must agree to approve,
//               one refusal refuses), then the grade lead, then a counsellor
//
// Doubts and appeals climb the escalation route. The grade lead is one of the
// three major leads, and the product keeps anybody who already judged a round
// from judging it again, so a round the grade lead sat on as a major lead
// passes straight to a counsellor.

export const reviewPolicyOf = (world: World) => ({
  normal: {
    stages: [
      {
        id: 'class',
        label: '班级审核',
        selector: {
          kind: 'roleAt',
          nodeTypeId: world.types.class,
          roleIds: [world.roles.classLead],
        },
        quorum: { type: 'any' },
      },
    ],
  },
  escalation: {
    stages: [
      {
        id: 'majors',
        label: '专业负责人合议',
        selector: {
          kind: 'roleAt',
          nodeTypeId: world.types.grade,
          roleIds: [world.roles.majorLead],
        },
        quorum: { type: 'all' },
      },
      {
        id: 'grade',
        label: '年级负责人复核',
        selector: {
          kind: 'roleAt',
          nodeTypeId: world.types.grade,
          roleIds: [world.roles.gradeLead],
        },
        quorum: { type: 'any' },
      },
      {
        id: 'counsellor',
        label: '辅导员终审',
        selector: {
          kind: 'roleAt',
          nodeTypeId: world.types.grade,
          roleIds: [world.roles.counsellor],
        },
        quorum: { type: 'any' },
      },
    ],
  },
})

/** the formula versions published so far, by formula key, oldest first */
export type Versions = ReadonlyMap<string, readonly string[]>

export const scoringConfigOf = (spec: ItemSpec, versions: Versions) => {
  const aggregator = { ref: spec.aggregator === 'max' ? 'max@1' : 'sum@1', config: {} }
  const scoring = spec.scoring
  if (scoring.kind === 'fixed') {
    return { calculator: { ref: 'fixed@1', config: { value: scoring.value } }, aggregator }
  }
  const versionId = versions.get(scoring.formula)?.[scoring.version - 1]
  if (versionId === undefined) {
    throw new Error(`formula ${scoring.formula} v${scoring.version} is not published yet`)
  }
  return {
    version: 2,
    calculator: { ref: 'formula@1', config: { versionId } },
    aggregator,
    recognitions: Object.entries(scoring.recognitions).map(([handle, recognition]) => ({
      handle,
      label: recognition.label,
      refinement: null,
      defaultFromFieldId: recognition.fromField ?? null,
    })),
    bindings: {
      ...Object.fromEntries(
        Object.entries(scoring.constants).map(([name, value]) => [
          name,
          { kind: 'constant', value },
        ]),
      ),
      ...Object.fromEntries(
        Object.keys(scoring.recognitions).map((handle) => [
          handle,
          { kind: 'recognition', handle },
        ]),
      ),
    },
  }
}

export interface TermItems {
  /** the item id and its spec, by spec key */
  readonly items: ReadonlyMap<string, { readonly id: string; readonly spec: ItemSpec }>
  readonly groups: ReadonlyMap<string, string>
}

/** the score tree, root first, each child placed once its parent has an id */
const buildGroups = (world: World, batchId: string, story: Story, as: Principal) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const ids = new Map<string, string>()
    const placed: {
      id?: string
      name: string
      parentGroupId: string | null
      cap: string
      floor: string | null
    }[] = []
    for (const level of [0, 1, 2]) {
      const depthOf = (key: string): number => {
        const group = GROUPS.find((one) => one.key === key)!
        return group.parent === null ? 0 : 1 + depthOf(group.parent)
      }
      const wanted = GROUPS.filter((group) => depthOf(group.key) === level)
      if (wanted.length === 0) continue
      for (const group of wanted) {
        placed.push({
          name: group.name,
          parentGroupId: group.parent === null ? null : ids.get(group.parent)!,
          cap: group.cap,
          floor: group.floor,
        })
      }
      const current = yield* assessment.listScoreGroups(world.tenantId, batchId, as)
      const saved = yield* story.step(
        assessment.replaceScoreGroups(
          world.tenantId,
          batchId,
          { groups: placed, expectedVersion: current.version },
          as,
        ),
      )
      for (const [index, row] of saved.groups.entries()) {
        placed[index] = { ...placed[index]!, id: row.id }
        const group = GROUPS.find((one) => one.name === row.name)
        if (group !== undefined) ids.set(group.key, row.id)
      }
    }
    return ids
  })

export const buildTermItems = (
  world: World,
  term: Term,
  batchId: string,
  versions: Versions,
  story: Story,
  /** whoever sets the term up; formulas bind only for their author */
  as: Principal,
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const groups = yield* buildGroups(world, batchId, story, as)
    const items = new Map<string, { id: string; spec: ItemSpec }>()
    for (const [order, spec] of itemsOf(term).entries()) {
      const constant = spec.channel === 'constant'
      const created = yield* story.step(
        assessment.createItem(
          world.tenantId,
          batchId,
          {
            itemType: constant ? 'constant' : 'evidence',
            title: spec.title,
            scoreGroupId: groups.get(spec.group)!,
            maxEntries: spec.maxEntries,
            sortOrder: order,
            config: {
              entryChannels: constant ? [] : [spec.channel],
              formConfig: constant ? {} : { fields: spec.fields },
              scoringConfig: scoringConfigOf(spec, versions),
              reviewPolicy: constant ? { mode: 'none' } : reviewPolicyOf(world),
              ...(spec.description === undefined
                ? {}
                : { displayConfig: { description: spec.description } }),
            },
          },
          as,
        ),
        40,
      )
      yield* story.step(
        assessment.setItemStatus(world.tenantId, created.id, { status: 'active' }, as),
        20,
      )
      items.set(spec.key, { id: created.id, spec })
    }
    return { items, groups } satisfies TermItems
  })
