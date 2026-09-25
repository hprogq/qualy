import { Data, Effect, Result, Schema } from 'effect'
import { transaction, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import type { EpochMillis } from '../phase/engine/types.ts'
import { ScoringAuthoringPolicyCatalog, ScoringRuntimeCatalog, type RuntimeRef } from '../plugin.ts'
import {
  ItemActionRefused,
  BatchNotFound,
  BatchReadOnly,
  ItemChangeDecisionRequired,
  ItemConfigInvalid,
  ItemNotFound,
  ItemRevisionConflict,
  ItemScoringIncompatible,
  ScoreGroupInvalid,
  ScoreGroupVersionConflict,
  ScoringUnavailable,
} from '../errors.ts'
import { lockBatch, oneBatch } from '../server/db.ts'
import { announce } from '../live/events.ts'
import { bumpParticipantAttention } from '../entry/db.ts'
import { scaledAmount } from '../scoring/builtins.ts'
import {
  carriesInto,
  compileScoringPlan,
  contractOf,
  readScoringPlan,
  recognitionEvaluationHash,
  recognitionSourceOf,
  type PlanIssue,
  type ScoringPlan,
} from '../scoring/plan.ts'
import {
  trialDerivedGrant,
  trialRefuses,
  trialScoringImpact,
  type ScoringTrial,
  type StandingDetermination,
} from '../scoring/impact-probe.ts'
import { probeIdentity, type FailureSite } from '../scoring/failure-boundary.ts'
import {
  judgeRecognition,
  recognitionFormFields,
  type RecognitionValues,
} from '../scoring/recognition.ts'
import { kindOf, type NormalizedAtomicSchema } from '@qualy/value-schema'
import { patternWeightIssues } from '@qualy/value-schema/regex'
import { normalizeScoringAuthoring } from '../scoring/authoring.ts'
import { policyModeOf } from '../review/chain.ts'
import type { EntryChannel } from './channels.ts'
import {
  ITEMS_PER_BATCH_MOST,
  validateItemConfig,
  weightIssues,
  type Catalogs,
  type ItemConfigInput,
} from './config.ts'
import {
  cancelReviewInstance,
  insertEntryEvent,
  insertReviewEvent,
  insertReviewInstance,
  nextRoundNo,
  nodePathOf,
  openEntriesOfItem,
  participantOf,
  repointReviewRound,
  setEntryState,
  VOIDED_WITH_ITEM,
} from '../entry/db.ts'
import {
  enterableFrom,
  isPanelStage,
  readPolicy,
  resolvePolicy,
  routeOf,
  stageArrival,
  stageStaffing,
  type ResolvedPolicy,
} from '../review/chain.ts'
import { createPanel } from '../review/db.ts'
import {
  candidateImpactHashOf,
  decisionNeeded,
  impactOf,
  missingDecisions,
  unchangedScoring,
  type ChangeEffects,
  type ChangeImpact,
  type Incompatible,
  type ScoringImpact,
} from './impact.ts'
import {
  bumpScoreGroupsVersion,
  deleteGroups,
  deleteItemRows,
  groupsOf,
  insertGroup,
  insertItem,
  insertItemRevision,
  mintRecognitionIds,
  itemAloneInPhaseScope,
  itemCountOf,
  itemHasEntries,
  itemOf,
  itemsOf,
  frozenProposalsOfItem,
  liveEntryPayloads,
  nextRevisionNo,
  openRoundsOfItem,
  revisionOf,
  revisionsOf,
  scoreGroupsVersionOf,
  setCurrentRevision,
  setItemLifecycle,
  updateGroup,
  updateItemFields,
  type ItemRevisionRow,
  type ItemRow,
  type OpenRoundRow,
} from './db.ts'

// What a batch asks, managed: the score tree (one level of it), the items on
// it, and the immutable revisions their configuration moves through.
//
// The save algorithm is the whole point of the module. A configuration is
// checked against everything it cites - driver, scoring references, review
// policy - and then against every live entry that would have to be read
// under it; only then does it become the next revision. Nothing is ever
// updated in place: fixing a configuration is appending the next one.

export interface MaterialRange {
  readonly start: string
  readonly end: string
}

export interface ItemRevisionView {
  readonly id: string
  readonly revisionNo: number
  readonly entryChannels: readonly EntryChannel[]
  readonly formConfig: unknown
  readonly scoringConfig: unknown
  readonly reviewPolicy: unknown
  readonly displayConfig: unknown
  readonly reason: string | null
  readonly createdAt: EpochMillis
}

export interface ItemView {
  readonly id: string
  readonly batchId: string
  readonly itemType: string
  readonly title: string
  readonly scoreGroupId: string
  readonly maxEntries: number | null
  readonly sortOrder: number
  readonly status: 'draft' | 'active' | 'voided'
  /** why the question was withdrawn; a withdrawn question says so wherever
   * it is read, and a reason nobody can see is a reason nobody trusts */
  readonly voidReason: string | null
  readonly currentRevision: ItemRevisionView | null
  readonly createdAt: EpochMillis
}

export interface ScoreGroupView {
  readonly id: string
  readonly parentGroupId: string | null
  readonly name: string
  readonly cap: string | null
  readonly floor: string | null
  readonly sortOrder: number
  readonly itemCount: number
}

export interface CreateItemInput {
  readonly itemType: string
  readonly title: string
  readonly scoreGroupId: string
  readonly maxEntries: number | null
  readonly sortOrder?: number
  readonly config: ItemConfigInput
}

export interface UpdateItemInput {
  readonly title?: string
  /**
   * What kind of question this is, for a question nothing has happened to
   * yet: a draft with no filings may still become a derived question or
   * stop being one. Refused once anything stands under it.
   */
  readonly itemType?: string
  readonly scoreGroupId?: string
  readonly maxEntries?: number | null
  readonly sortOrder?: number
  readonly config?: ItemConfigInput
  readonly reason?: string
  /** which version this edit was composed against; a stale one is refused */
  readonly expectedRevisionId?: string | null
  /** what should happen to work already under way (§32.62) */
  readonly effects?: ChangeEffects
}

export interface ScoreGroupSpec {
  readonly id?: string
  /**
   * The group this one adds up into. A tree, because the rules are one: a
   * sports cap inside a wider activities cap is how a real regulation reads
   * (§8.5 amended), and a flat list can only say one of the two.
   *
   * Never absent: leaving it out used to read as "top level", which turned a
   * partial payload into a flattening of the whole tree.
   */
  readonly parentGroupId: string | null
  readonly name: string
  readonly cap: string | null
  readonly floor: string | null
  readonly sortOrder?: number
}

export interface ReplaceScoreGroupsInput {
  readonly groups: readonly ScoreGroupSpec[]
  /** the tree's version as the caller read it; a stale one is refused */
  readonly expectedVersion: number
  readonly reason?: string
}

export type CreateItemError = BatchNotFound | BatchReadOnly | AccessDenied | ItemConfigInvalid
export type ItemLifecycleError = ItemNotFound | BatchReadOnly | AccessDenied | ItemActionRefused
/**
 * Putting a question on the round runs its configuration through the same
 * trial a saved one faces, so it refuses in the same words rather than in a
 * second vocabulary for the same problem.
 */
export type ItemStatusError =
  | ItemLifecycleError
  | ItemConfigInvalid
  | ItemScoringIncompatible
  | ScoringUnavailable
  | ItemRevisionConflict
export type UpdateItemError =
  | ItemNotFound
  | BatchNotFound
  | BatchReadOnly
  | AccessDenied
  | ItemChangeDecisionRequired
  | ItemConfigInvalid
  | ItemScoringIncompatible
  | ScoringUnavailable
export type ReplaceGroupsError =
  | BatchNotFound
  | BatchReadOnly
  | AccessDenied
  | ScoreGroupInvalid
  | ScoreGroupVersionConflict

export interface ItemMethods {
  readonly listItems: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<
    { items: readonly ItemView[]; capabilities: { canManage: boolean } },
    BatchNotFound | AccessDenied
  >
  readonly createItem: (
    tenantId: string,
    batchId: string,
    input: CreateItemInput,
    as: Principal,
  ) => Effect.Effect<
    ItemView,
    CreateItemError,
    ScoringRuntimeCatalog | ScoringAuthoringPolicyCatalog
  >
  readonly getRecognitionContract: (
    tenantId: string,
    itemId: string,
    as: Principal,
  ) => Effect.Effect<RecognitionContractView | null, ItemNotFound | AccessDenied>
  readonly getItem: (
    tenantId: string,
    itemId: string,
    as: Principal,
  ) => Effect.Effect<ItemView & { manageable: boolean }, ItemNotFound | AccessDenied>
  readonly updateItem: (
    tenantId: string,
    itemId: string,
    input: UpdateItemInput,
    as: Principal,
  ) => Effect.Effect<
    ItemView,
    UpdateItemError,
    ScoringRuntimeCatalog | ScoringAuthoringPolicyCatalog
  >
  readonly deleteItem: (
    tenantId: string,
    itemId: string,
    as: Principal,
  ) => Effect.Effect<void, ItemLifecycleError>
  readonly setItemStatus: (
    tenantId: string,
    itemId: string,
    input: { status: 'voided'; reason: string } | { status: 'active' },
    as: Principal,
  ) => Effect.Effect<ItemView, ItemStatusError, ScoringRuntimeCatalog>
  readonly listScoreGroups: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<
    {
      groups: readonly ScoreGroupView[]
      version: number
      capabilities: { canManage: boolean }
    },
    BatchNotFound | AccessDenied
  >
  readonly replaceScoreGroups: (
    tenantId: string,
    batchId: string,
    input: ReplaceScoreGroupsInput,
    as: Principal,
  ) => Effect.Effect<{ groups: readonly ScoreGroupView[]; version: number }, ReplaceGroupsError>
  readonly previewScoring: (
    tenantId: string,
    batchId: string,
    input: ScoringPreviewInput,
    as: Principal,
  ) => Effect.Effect<
    ScoringPreviewView,
    BatchNotFound | AccessDenied | ItemConfigInvalid,
    ScoringRuntimeCatalog | ScoringAuthoringPolicyCatalog
  >
  readonly checkItem: (
    tenantId: string,
    batchId: string,
    input: ItemCheckInput,
    as: Principal,
  ) => Effect.Effect<
    ItemCheckView,
    BatchNotFound | AccessDenied,
    ScoringRuntimeCatalog | ScoringAuthoringPolicyCatalog
  >
}

/**
 * A whole candidate question, asked what a save would say about it.
 *
 * The same fields a save carries, and nothing a save would not: `itemId`
 * names the question being edited, so that what is frozen on it - the doors
 * entries came in through, the kind it has been since somebody filed - is
 * judged against the candidate the way a save would judge it.
 */
export interface ItemCheckInput {
  readonly itemId?: string
  readonly itemType: string
  readonly scoreGroupId: string
  readonly config: ItemConfigInput
}

/**
 * Every reason a save would refuse this candidate, all at once.
 *
 * `handle` is set on an issue about a determination the draft has not saved
 * yet: the path names it by the identity a save would mint, which the screen
 * has never seen, so the handle it composed it under rides along.
 */
/** why a standing determination, or a round still open, does not fit a candidate */
export type StrandingReason =
  // a value somebody determined is outside what the candidate admits
  | 'strands-determined-value'
  // the candidate asks for a determination the standing ones never made
  | 'strands-determination-missing'
  // the candidate no longer has a determination the standing ones carry
  | 'strands-determination-removed'
  // a round is open under the wider contract and may still settle anywhere in it
  | 'strands-open-round'

export interface StrandingCause {
  readonly recognitionId: string
  readonly reason: StrandingReason
  /** how many claims hang on it */
  readonly count: number
  /** the determined values the candidate would not read, where there are any to name */
  readonly values: readonly string[]
}

export interface Stranding {
  readonly entries: readonly string[]
  readonly causes: readonly StrandingCause[]
}

const NO_STRANDING: Stranding = { entries: [], causes: [] }

/** a refusal names values so that they can be put back, not so that it can list a register */
const STRANDED_VALUES_MOST = 20

/** as many determined values as a list of options could plausibly have */
const STANDING_VALUES_MOST = 200

export interface ItemCheckView {
  readonly issues: readonly {
    readonly path: string
    readonly reason: string
    readonly handle?: string
    /** how many claims the issue is about, when it is about claims */
    readonly count?: number
    /** the values it is about, where there are any to name */
    readonly values?: readonly string[]
  }[]
  /**
   * What the question may not let go of, per determination it already has:
   * the editor holds these shut rather than letting them be narrowed away
   * and refusing afterwards.
   */
  readonly standing: readonly {
    readonly recognitionId: string
    /** claims that stand determined under it */
    readonly records: number
    /** rounds still open, which may settle on anything their contract admits */
    readonly openRounds: number
    /** values somebody has determined */
    readonly determined: readonly string[]
  }[]
}

/**
 * A candidate configuration, asked what its calculator would need.
 *
 * `itemId` is the question being edited, when there is one. It is not a
 * claim about history - the server reads that question's own frozen plan -
 * and one that is not in this batch simply is not this question.
 */
export interface ScoringPreviewInput {
  readonly itemType: string
  readonly formConfig: unknown
  readonly calculator: { readonly ref: string; readonly config: unknown }
  readonly itemId?: string
}

/**
 * The contract a screen binds parameters against, and what it may bind them to.
 *
 * The two halves are answered independently on purpose. What a calculator
 * needs is a fact about the calculator, and a screen has to know it BEFORE
 * the form exists - a question is now composed by choosing the arithmetic,
 * seeing its parameters, and letting the parameters that are filled in from
 * a form say which fields the form must have. So a form this driver cannot
 * yet read is reported as `form.valid: false` with nothing to bind, not as
 * a refusal of the whole request.
 *
 * Saving is unaffected: `validateItemConfig` still judges the form strictly,
 * and a question whose form never became legal cannot be written.
 */
export interface ScoringPreviewView {
  readonly calculator: { readonly ref: string; readonly contractHash: string }
  readonly inputSchema: unknown
  readonly outputSchema: unknown
  /** how the form stands right now, and why it does not stand */
  readonly form: {
    readonly valid: boolean
    readonly issues: readonly { readonly path: string; readonly reason: string }[]
  }
  readonly bindableFields: readonly {
    readonly fieldId: string
    readonly payloadKey: string
    readonly schema: unknown
    readonly always: boolean
  }[]
}

/** what the item methods borrow from the service that owns authorization */
/**
 * What a registrar's screen needs to collect a determination: the frozen
 * contract's fields, and how each default is derived from the material -
 * the payload address it reads and the one named conversion it may apply.
 * Never the calculator, the constants or anything else of the execution
 * plan: the screen pre-fills a form, it does not score.
 */
export interface RecognitionContractView {
  readonly itemRevisionId: string
  readonly fields: readonly { readonly id: string; readonly schema: unknown }[]
  readonly defaults: readonly {
    readonly recognitionId: string
    readonly payloadKey: string
    readonly assignment:
      | { readonly kind: 'direct' }
      | { readonly kind: 'convert'; readonly converter: 'integer-to-decimal@1' }
  }[]
}

export interface ItemDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  readonly requireBatchVisible: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<void, AccessDenied>
  readonly requireRosterReach: (
    as: Principal,
    tenantId: string,
    batchId: string,
  ) => Effect.Effect<void, AccessDenied>
  readonly recordConfigChange: (
    tenantId: string,
    batchId: string,
    status: string,
    diff: Record<string, unknown>,
    actorId: string | null,
    reason: string | null,
  ) => Effect.Effect<void, QueryFailed, Orm>
  readonly parseRange: (text: string) => MaterialRange
  /** whether this person holds the record authority inside the batch */
  readonly hasRecordAuthority: (
    tenantId: string,
    batchId: string,
    userId: string,
  ) => Effect.Effect<boolean>
  readonly catalogs: Catalogs
}

export const makeItemMethods = (deps: ItemDeps): ItemMethods => {
  const { withDb, catalogs } = deps

  const toRevisionView = (row: ItemRevisionRow): ItemRevisionView => ({
    id: row.id,
    revisionNo: row.revisionNo,
    entryChannels: row.entryChannels,
    formConfig: row.formConfig,
    scoringConfig: row.scoringConfig,
    reviewPolicy: row.reviewPolicy,
    displayConfig: row.displayConfig,
    reason: row.reason,
    createdAt: row.createdAt,
  })

  const toView = (row: ItemRow, revision: ItemRevisionRow | null): ItemView => ({
    id: row.id,
    batchId: row.batchId,
    itemType: row.itemType,
    title: row.title,
    scoreGroupId: row.scoreGroupId,
    maxEntries: row.maxEntries,
    sortOrder: row.sortOrder,
    status: row.status,
    voidReason: row.voidReason,
    currentRevision: revision === null ? null : toRevisionView(revision),
    createdAt: row.createdAt,
  })

  // jsonb hands objects back with keys re-sorted, so equality has to be
  // order-blind: stringify with keys canonically sorted at every level
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>
      const keys = Object.keys(record).sort()
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
    }
    return JSON.stringify(value) ?? 'null'
  }
  const sameJson = (left: unknown, right: unknown) =>
    canonical(left ?? null) === canonical(right ?? null)

  /** whether a submitted configuration differs from the stored current one */
  const configChanged = (current: ItemRevisionRow, config: ItemConfigInput) =>
    !sameJson([...current.entryChannels], [...config.entryChannels]) ||
    !sameJson(current.formConfig, config.formConfig) ||
    !sameJson(current.scoringConfig, config.scoringConfig) ||
    !sameJson(current.reviewPolicy, config.reviewPolicy) ||
    !sameJson(current.displayConfig, config.displayConfig ?? {})

  /** whether this person could administer the batch, as a plain answer */
  const canManage = (as: Principal, tenantId: string, batchId: string) =>
    deps.requireRosterReach(as, tenantId, batchId).pipe(
      Effect.as(true),
      Effect.catchTag('ACCESS_DENIED', () => Effect.succeed(false)),
    )

  /**
   * The §6.3 gauntlet for one configuration: everything it cites, the window
   * it has to fit inside, and every live entry it would have to read.
   *
   * Runs inside the caller's transaction, after the batch row is locked.
   *
   * Every road to a live question goes through here - writing a configuration,
   * and putting one on the round by publishing or restoring the question that
   * holds it - because the window a form has to fit can move while a question
   * that is not live is not being looked at.
   *
   * What it no longer does is refuse a configuration because a live entry
   * could not be read under it. That was a hard gate whose only way forward
   * was void-and-replace; it is now an impact report the administrator
   * answers (§32.62, and `impactUnder` below).
   */
  const issuesOf = (input: {
    tenantId: string
    item: ItemRow
    current: ItemRevisionRow | null
    materialRange: MaterialRange
    config: ItemConfigInput
  }) =>
    Effect.gen(function* () {
      const issues = [...(yield* validateItemConfig(catalogs, input.item.itemType, input.config))]
      // a configuration too large to keep is not read any further
      if (issues.some((issue) => issue.reason === 'config-too-large')) return issues
      // once anything has been filed against the item, a door it came in
      // through may not be shut: the resource policy reads the doors from
      // the current revision, and closing one would strand every entry that
      // used it on a path that no longer exists. Opening another door is
      // harmless. Void and replace is the way to change what kind of
      // question this is.
      if (
        input.current !== null &&
        input.current.entryChannels.some(
          (channel) => !input.config.entryChannels.includes(channel),
        ) &&
        (yield* itemHasEntries(input.tenantId, input.item.id))
      ) {
        issues.push({ path: 'entryChannels', reason: 'entry-channels-frozen' })
      }
      const driver = catalogs.itemTypes.get(input.item.itemType)
      if (driver?.configIssues !== undefined) {
        issues.push(
          ...driver
            .configIssues(input.config.formConfig, { materialRange: input.materialRange })
            .map((issue) => ({ path: issue.path, reason: issue.reason })),
        )
      }
      // The patterns a new form carries, together, held to what a new
      // contract's patterns may weigh: every one of them is compiled when an
      // answer is read. Only a form being written is weighed - one already
      // stored keeps meaning what it meant, so publishing or restoring the
      // question, or saving its form again unchanged, weighs nothing.
      const formWritten =
        input.current === null || !sameJson(input.current.formConfig, input.config.formConfig)
      if (issues.length === 0 && formWritten && driver?.bindableFields !== undefined) {
        const fields = driver.bindableFields(input.config.formConfig, {
          materialRange: input.materialRange,
        })
        const heavy = patternWeightIssues({
          properties: Object.fromEntries(fields.map((one) => [one.payloadKey, one.schema])),
        })[0]
        if (heavy !== undefined) {
          const key = /^properties\.(.+)\.pattern$/.exec(heavy.path)?.[1]
          issues.push({
            path: key === undefined ? 'formConfig' : `formConfig.fields.${key}`,
            reason: 'pattern-too-complex',
          })
        }
      }
      // the browser mints a fresh identity on retype; this is the server
      // holding the same rule against whoever speaks the api directly
      if (input.current !== null && driver?.transitionIssues !== undefined) {
        issues.push(
          ...driver
            .transitionIssues(input.current.formConfig, input.config.formConfig, {
              materialRange: input.materialRange,
            })
            .map((issue) => ({ path: issue.path, reason: issue.reason })),
        )
      }
      return issues
    })

  /**
   * What this configuration would disturb, counted from the state under the
   * batch lock (§32.62).
   *
   * Every live answer is read through the form it was written under before
   * being offered to the new one, so a deletion or a reordering is the no-op
   * it actually is; only what still fails is work this change would strand.
   */
  /**
   * The candidate configuration's plan, compiled exactly once per save.
   *
   * With a service-backed calculator, compiling is reading runtime facts;
   * doing it twice in one save is reading them at two moments that may
   * disagree about what was frozen. The impact trial and the appended
   * revision are both fed THIS result.
   */
  /**
   * Whether this principal may point the question at this configuration.
   *
   * Asked of whoever owns the calculator, before anything is compiled and
   * under the same batch lock the write holds - so a screen's preview and
   * the save it leads to give one answer. A continuation is never asked
   * about: the question already runs this exact program, and a rule about
   * who may START a binding must not become a rule about who may keep a
   * question working.
   */
  const vetBinding = (input: {
    tenantId: string
    batchId: string
    ref: string
    config: unknown
    previousRuntimeRef: RuntimeRef | undefined
    as: Principal
  }) =>
    Effect.gen(function* () {
      const policies = yield* ScoringAuthoringPolicyCatalog
      return yield* policies.authorize(input.ref, {
        tenantId: input.tenantId,
        batchId: input.batchId,
        principal: input.as,
        config: input.config,
        ...(input.previousRuntimeRef === undefined
          ? {}
          : { previousRuntimeRef: input.previousRuntimeRef }),
      })
    })

  /** the compiler's path into a submitted configuration, as the preview's
   *  payload spells it - a preview is asked about a candidate, not about a
   *  question's stored scoring */
  const payloadPath = (path: string) => path.replace(/^scoringConfig\./, '')

  /** the calculator a submitted configuration names, without decoding it */
  const submittedRef = (scoringConfig: unknown): string | undefined => {
    const ref =
      scoringConfig !== null && typeof scoringConfig === 'object' && !Array.isArray(scoringConfig)
        ? (scoringConfig as { calculator?: { ref?: unknown } }).calculator?.ref
        : undefined
    return typeof ref === 'string' ? ref : undefined
  }

  /** the runtime identity a question's current plan froze, when the SAME
   *  calculator is being recompiled - the one discriminator both the compile
   *  and the authoring seam read */
  const continuationOf = (previous: ItemRevisionRow | null, ref: string | undefined) =>
    Effect.gen(function* () {
      if (previous === null) return undefined
      // fail closed, never option: a current revision whose plan cannot be
      // read is an operational invariant failure, and reading it as "no
      // previous runtime" would quietly turn a broken continuation into a
      // brand-new binding
      const plan = yield* readScoringPlan(previous).pipe(Effect.orDie)
      return plan.version === 2 && plan.calculator.ref === ref
        ? plan.calculator.runtimeRef
        : undefined
    })

  const compiledCandidate = (input: {
    tenantId: string
    item: ItemRow
    materialRange: MaterialRange
    config: ItemConfigInput
    /** the revision being replaced; its frozen plan carries the previous
     *  runtime identity when the same calculator is recompiled */
    previous: ItemRevisionRow | null
    /** who is saving: the authoring seam's question, never the compiler's */
    as: Principal
  }) =>
    Effect.gen(function* () {
      const runtime = yield* ScoringRuntimeCatalog
      const ref = submittedRef(input.config.scoringConfig)
      const previousRuntimeRef = yield* continuationOf(input.previous, ref)
      // whoever owns the arithmetic gets asked BEFORE it is compiled: a
      // refusal here is about who is asking, and it must not be reachable
      // only through a calculator that has already read a program
      if (ref !== undefined) {
        yield* vetBinding({
          tenantId: input.tenantId,
          batchId: input.item.batchId,
          ref,
          config: (input.config.scoringConfig as { calculator?: { config?: unknown } } | null)
            ?.calculator?.config,
          previousRuntimeRef,
          as: input.as,
        }).pipe(Effect.catch((issue) => new ItemConfigInvalid({ issues: [issue] })))
      }
      return yield* compileScoringPlan({
        definitions: { calculators: catalogs.calculators, aggregators: catalogs.aggregators },
        compile: runtime.compile,
        host: {
          tenantId: input.tenantId,
          batchId: input.item.batchId,
          ...(previousRuntimeRef === undefined ? {} : { previousRuntimeRef }),
        },
        itemType: deps.catalogs.itemTypes.get(input.item.itemType),
        formConfig: input.config.formConfig,
        scoringConfig: input.config.scoringConfig,
        batch: { materialRange: input.materialRange },
        recognitionSource: recognitionSourceOf({
          interaction: deps.catalogs.itemTypes.get(input.item.itemType)?.interaction,
          entryChannels: input.config.entryChannels,
          reviewMode: policyModeOf(input.config.reviewPolicy),
        }),
      })
    })

  /**
   * What already stands determined under this question, and what the
   * candidate would make of it.
   *
   * Scoring reads the question's CURRENT plan against a determination made
   * under an older one, so an administrator renaming a recognition,
   * narrowing its type or dropping it entirely would leave every approved
   * claim approved and unscorable - and nothing would say so until somebody
   * opened a results page. The determinations a sitting has already frozen
   * count too: they are what an open round would settle on if it concluded.
   *
   * The answer names the claims, and - because a list of claims tells an
   * administrator nothing about what to put back - the determination each
   * one hangs on and the way it no longer fits. Read-only, so the editor
   * can ask it while the narrowing is still being composed.
   */
  const strandingUnder = (input: {
    tenantId: string
    itemId: string
    schemas: Readonly<Record<string, NormalizedAtomicSchema>>
    live: readonly { readonly entryId: string; readonly recognition: RecognitionValues | null }[]
    rounds: readonly { readonly entryId: string; readonly recognitionRevisionId: string }[]
  }) =>
    Effect.gen(function* () {
      const entries: string[] = []
      const causes = new Map<
        string,
        {
          recognitionId: string
          reason: StrandingReason
          entries: Set<string>
          values: Set<string>
        }
      >()
      const blame = (
        recognitionId: string,
        reason: StrandingReason,
        entryId: string,
        value?: unknown,
      ) => {
        const key = `${recognitionId}\u0000${reason}`
        const held = causes.get(key) ?? {
          recognitionId,
          reason,
          entries: new Set<string>(),
          values: new Set<string>(),
        }
        held.entries.add(entryId)
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          held.values.add(String(value))
        }
        causes.set(key, held)
      }
      const judge = (entryId: string, values: unknown) => {
        const wrong = judgeRecognition(input.schemas, values)
        if (wrong.length === 0) return
        if (!entries.includes(entryId)) entries.push(entryId)
        for (const issue of wrong) {
          if (issue.recognitionId === '') continue
          if (issue.reason === 'missing')
            blame(issue.recognitionId, 'strands-determination-missing', entryId)
          else if (issue.reason === 'unknown')
            blame(issue.recognitionId, 'strands-determination-removed', entryId)
          // the value is named only where the value is the fault
          else {
            blame(
              issue.recognitionId,
              'strands-determined-value',
              entryId,
              (values as Record<string, unknown>)[issue.recognitionId],
            )
          }
        }
      }
      for (const row of input.live) {
        if (row.recognition !== null) judge(row.entryId, row.recognition)
      }
      for (const proposal of yield* frozenProposalsOfItem(input.tenantId, input.itemId)) {
        judge(proposal.entryId, proposal.values)
      }
      // And the rounds still open, which have determined nothing yet.
      //
      // A round judges by the contract it opened with, whatever the
      // question says today - that is what keeps a reviewer from being
      // asked something different halfway through. So the determination
      // it settles on tomorrow is one THAT contract admits, and if the new
      // plan cannot read every such determination, the round is walking
      // toward a claim that will be approved and unscorable.
      const contracts = new Map<string, string[]>()
      for (const round of input.rounds) {
        const under = contracts.get(round.recognitionRevisionId)
        if (under === undefined) contracts.set(round.recognitionRevisionId, [round.entryId])
        else under.push(round.entryId)
      }
      for (const [revisionId, entryIds] of contracts) {
        const frozen = yield* revisionOf(input.tenantId, revisionId)
        if (frozen === null) continue
        const under = yield* readScoringPlan(frozen).pipe(Effect.option)
        if (under._tag === 'Some' && carriesInto(under.value.recognitionSchemas, input.schemas))
          continue
        const before = under._tag === 'Some' ? under.value.recognitionSchemas : {}
        // What an open round stops is a change of SHAPE: a name taken away,
        // a name added, a kind swapped - its reviewer would be answering a
        // form the new plan cannot read at all. Narrowing the values of a
        // name both sides keep does not stop here. Rounds keep opening for
        // as long as claims are filed, so waiting for none to be open is
        // waiting for ever; and the decision proves every determination
        // against the plan as it stands that day before writing it, so a
        // value narrowed away is refused at the moment it would be settled.
        const reshaped: [string, StrandingReason][] = []
        for (const name of Object.keys(before)) {
          if (!Object.hasOwn(input.schemas, name))
            reshaped.push([name, 'strands-determination-removed'])
          else if (kindOf(before[name]!) !== kindOf(input.schemas[name]!)) {
            reshaped.push([name, 'strands-open-round'])
          }
        }
        for (const name of Object.keys(input.schemas)) {
          if (!Object.hasOwn(before, name)) reshaped.push([name, 'strands-open-round'])
        }
        if (reshaped.length === 0) continue
        for (const entryId of entryIds) {
          if (!entries.includes(entryId)) entries.push(entryId)
          for (const [name, reason] of reshaped) blame(name, reason, entryId)
        }
      }
      return {
        entries: entries,
        causes: [...causes.values()].map((one) => ({
          recognitionId: one.recognitionId,
          reason: one.reason,
          count: one.entries.size,
          values: [...one.values].sort().slice(0, STRANDED_VALUES_MOST),
        })),
      }
    })

  /**
   * What the question's determinations may not let go of.
   *
   * A value somebody has already determined holds the determination open.
   * What a round still open MAY settle on does not: rounds keep opening for
   * as long as claims are filed, and the decision proves each determination
   * against the plan of the day, so a value narrowed away is refused when it
   * would be settled rather than kept on offer for ever.
   */
  const standingUnder = (input: {
    tenantId: string
    itemId: string
    live: readonly { readonly entryId: string; readonly recognition: RecognitionValues | null }[]
    rounds: readonly { readonly entryId: string; readonly recognitionRevisionId: string }[]
  }) =>
    Effect.gen(function* () {
      const held = new Map<
        string,
        { records: Set<string>; rounds: Set<string>; determined: Set<string> }
      >()
      const of = (recognitionId: string) => {
        const known = held.get(recognitionId)
        if (known !== undefined) return known
        const fresh = {
          records: new Set<string>(),
          rounds: new Set<string>(),
          determined: new Set<string>(),
        }
        held.set(recognitionId, fresh)
        return fresh
      }
      const take = (entryId: string, values: unknown) => {
        if (typeof values !== 'object' || values === null || Array.isArray(values)) return
        for (const [recognitionId, value] of Object.entries(values as Record<string, unknown>)) {
          const under = of(recognitionId)
          under.records.add(entryId)
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            if (under.determined.size < STANDING_VALUES_MOST) under.determined.add(String(value))
          }
        }
      }
      for (const row of input.live) if (row.recognition !== null) take(row.entryId, row.recognition)
      for (const proposal of yield* frozenProposalsOfItem(input.tenantId, input.itemId)) {
        take(proposal.entryId, proposal.values)
      }
      const contracts = new Map<string, string[]>()
      for (const round of input.rounds) {
        const under = contracts.get(round.recognitionRevisionId)
        if (under === undefined) contracts.set(round.recognitionRevisionId, [round.entryId])
        else under.push(round.entryId)
      }
      for (const [revisionId, entryIds] of contracts) {
        const frozen = yield* revisionOf(input.tenantId, revisionId)
        if (frozen === null) continue
        const plan = yield* readScoringPlan(frozen).pipe(Effect.option)
        if (plan._tag !== 'Some') continue
        for (const recognitionId of Object.keys(plan.value.recognitionSchemas)) {
          const under = of(recognitionId)
          for (const entryId of entryIds) under.rounds.add(entryId)
        }
      }
      return [...held.entries()].map(([recognitionId, under]) => ({
        recognitionId,
        records: under.records.size,
        openRounds: under.rounds.size,
        determined: [...under.determined].sort(),
      }))
    })

  /** the refusal a stranding save is answered with: why, per determination, and then which claims */
  const strandingIssues = (stranding: Stranding) => [
    ...stranding.causes.map((cause) => ({
      path: `scoringConfig.recognitions.${cause.recognitionId}`,
      reason: cause.reason,
      count: cause.count,
      ...(cause.values.length === 0 ? {} : { values: cause.values }),
    })),
    ...stranding.entries.map((entryId) => ({
      path: `scoringConfig.recognitions:${entryId}`,
      reason: 'strands-existing-recognition',
    })),
  ]

  const impactUnder = (input: {
    tenantId: string
    item: ItemRow
    current: ItemRevisionRow | null
    materialRange: MaterialRange
    config: ItemConfigInput
    /** the one compilation of this save, shared with appendRevision */
    nextPlan: { readonly plan: ScoringPlan } | { readonly issues: readonly PlanIssue[] }
    /** which candidate this report is about; see `candidateImpactHashOf` */
    candidateImpactHash: string
    /** what running the candidate over what stands found; unchanged until it ran */
    scoring: (approvedTotal: number) => ScoringImpact
  }) =>
    Effect.gen(function* () {
      const driver = catalogs.itemTypes.get(input.item.itemType)
      const live = yield* liveEntryPayloads(input.tenantId, input.item.id)
      const rounds = yield* openRoundsOfItem(input.tenantId, input.item.id)
      const refusals: Incompatible[] = []
      if (driver !== undefined) {
        for (const row of live) {
          // An administrative fact keeps reading under the form it was
          // recorded with (§32.62). It is never one of the claims a save can
          // send back: nobody could answer it, and it would stop counting
          // until somebody voided it and recorded it again.
          if (row.administrative) continue
          const carried =
            driver.projectPayload === undefined
              ? row.payload
              : driver.projectPayload(row.formConfig, input.config.formConfig, row.payload)
          const decoded = yield* Effect.result(
            driver.decodePayload(input.config.formConfig, carried, {
              materialRange: input.materialRange,
            }),
          )
          if (Result.isFailure(decoded)) refusals.push({ entryId: row.entryId, status: row.status })
        }
      }

      // What the new arithmetic would make of what is already recognised.
      //
      // Scoring reads the question's CURRENT plan against a determination
      // made under an older one, so an administrator renaming a recognition,
      // narrowing its type or dropping it entirely would leave every
      // approved claim approved and unscorable - and nothing would say so
      // until somebody opened a results page. The determinations a sitting
      // has already frozen count too: they are what an open round would
      // settle on if it concluded.
      const stranding =
        'plan' in input.nextPlan
          ? yield* strandingUnder({
              tenantId: input.tenantId,
              itemId: input.item.id,
              schemas: input.nextPlan.plan.recognitionSchemas,
              live,
              rounds,
            })
          : NO_STRANDING
      const stranded = stranding.entries
      return {
        live,
        rounds,
        stranded: stranded,
        stranding,
        incompatible: refusals,
        impact: impactOf({
          candidateImpactHash: input.candidateImpactHash,
          scoring: input.scoring(live.filter((row) => row.status === 'approved').length),
          currentRevisionId: input.current?.id ?? null,
          currentConfig: input.current,
          nextConfig: input.config,
          live,
          rounds,
          incompatible: refusals,
        }),
      }
    })

  /**
   * The answer, carried out.
   *
   * Order is fixed and not negotiable: sending a claim back happens first,
   * and a claim sent back is never also re-routed. It is going to be filed
   * again, and the round that opens then walks the policy in force at that
   * moment - re-routing the round it is leaving would be work nobody ever
   * sees.
   */
  const propagate = (input: {
    tenantId: string
    item: ItemRow
    newRevisionId: string
    effects: ChangeEffects
    live: readonly { entryId: string; status: 'in_review' | 'approved' }[]
    rounds: readonly OpenRoundRow[]
    incompatible: readonly Incompatible[]
    nextPolicy: unknown
    actorId: string
    reason: string | null
  }) =>
    Effect.gen(function* () {
      const form = input.effects.form
      const sendBack = new Set(
        input.incompatible
          .filter((row) =>
            row.status === 'in_review' ? form?.inReview === 'return' : form?.approved === 'return',
          )
          .map((row) => row.entryId),
      )

      let returnedInReview = 0
      let returnedApproved = 0
      for (const row of input.live) {
        if (!sendBack.has(row.entryId)) continue
        const open = input.rounds.find((round) => round.entryId === row.entryId)
        if (open !== undefined) {
          const ended = yield* cancelReviewInstance({
            tenantId: input.tenantId,
            instanceId: open.id,
            outcome: 'superseded',
          })
          if (ended) {
            yield* insertReviewEvent({
              tenantId: input.tenantId,
              reviewInstanceId: open.id,
              kind: 'returned-for-revision',
              actorId: input.actorId,
              route: open.route,
              stageId: open.stageId,
              comment: input.reason,
            })
          }
        }
        const moved = yield* setEntryState({
          tenantId: input.tenantId,
          entryId: row.entryId,
          from: ['in_review', 'approved'],
          to: 'needs_revision',
          currentReviewInstanceId: null,
        })
        if (!moved) continue
        yield* insertEntryEvent({
          tenantId: input.tenantId,
          entryId: row.entryId,
          kind: 'revision-required',
          actorId: input.actorId,
          reason: input.reason,
          causeRevisionId: input.newRevisionId,
        })
        yield* bumpParticipantAttention(input.tenantId, row.entryId)
        if (row.status === 'in_review') returnedInReview += 1
        else returnedApproved += 1
      }

      const choice = input.effects.review?.open ?? 'keep'
      const moving =
        choice === 'keep'
          ? []
          : input.rounds
              .filter((round) => !sendBack.has(round.entryId))
              .filter((round) => choice === 'reroute-all' || round.state === 'blocked')

      let rerouted = 0
      let keptOnOldPolicy = 0
      // What the rounds of one question keep re-asking, answered once and
      // held for the length of the move: the policy is read once rather than
      // per round, the chain is resolved once per distinct lineage (a class
      // of forty shares one), a landing unit's live path is read once, and a
      // step's membership is asked once. Nothing written below changes any
      // of those answers - no appointment, no move of the tree - and the
      // whole move is one transaction holding the batch row, so every
      // statement saved is time the batch is not stopped.
      const policy = readPolicy(input.nextPolicy)
      const chains = new Map<string, ResolvedPolicy>()
      const paths = new Map<string, string | null>()
      const staffing = stageStaffing()
      for (const round of moving) {
        const participant = yield* participantOf(
          input.tenantId,
          input.item.batchId,
          round.participantId,
        )
        if (participant === null) {
          keptOnOldPolicy += 1
          continue
        }
        const lineageKey = participant.anchorLineage
          .map((step) => `${step.nodeId}:${step.nodeTypeId}`)
          .join('>')
        let resolved = chains.get(lineageKey)
        if (resolved === undefined) {
          resolved = yield* resolvePolicy({
            tenantId: input.tenantId,
            batchId: input.item.batchId,
            policy,
            lineage: participant.anchorLineage,
          })
          chains.set(lineageKey, resolved)
        }
        // the step it is standing at, by name. If the new policy still has
        // it, the round carries on from there - which is the whole point of
        // "this level has nobody, so I am editing this level". The
        // administrator may instead send every migrated round back to the
        // start of its own route: a full re-review under the new policy,
        // route by route - a round already in escalation restarts
        // escalation, never the ordinary chain.
        const here = routeOf(resolved, round.route).find((stage) => stage.id === round.stageId)
        const landing =
          input.effects.review?.landing === 'route-start'
            ? enterableFrom(resolved, round.route, 0)
            : here !== undefined && here.nodeId !== null
              ? here
              : here !== undefined
                ? enterableFrom(resolved, round.route, here.index)
                : input.effects.review?.missingCurrentStage === 'refuse'
                  ? null
                  : input.effects.review?.missingCurrentStage === 'restart-route'
                    ? enterableFrom(resolved, round.route, 0)
                    : null
        if (landing === null) {
          // no guessing: a round whose step is gone stays where it is unless
          // the administrator said to start its route over
          keptOnOldPolicy += 1
          continue
        }
        // A vacant step is a place the new round can stand, blocked, the
        // same as every other entry to a step nobody holds (ADR 0007); only
        // a unit whose path is gone keeps the round on its old policy.
        let nodePath: string | null = null
        if (landing.nodeId !== null) {
          const known = paths.get(landing.nodeId)
          nodePath = known === undefined ? yield* nodePathOf(input.tenantId, landing.nodeId) : known
          paths.set(landing.nodeId, nodePath)
          if (nodePath === null) {
            keptOnOldPolicy += 1
            continue
          }
        }
        // An open round its claim no longer stands on was left behind by
        // an older path that moved the claim without ending the round.
        // Moving it would build a replacement nothing points at, so it stays
        // where it is, counted as kept, and is said in the log for whoever
        // tidies such rounds up; the save goes through.
        if (!round.claimStandsOnIt) {
          yield* Effect.logWarning(
            'review round left on its old policy: its claim stands elsewhere',
            {
              reviewInstanceId: round.id,
              entryId: round.entryId,
            },
          )
          keptOnOldPolicy += 1
          continue
        }
        const ended = yield* cancelReviewInstance({
          tenantId: input.tenantId,
          instanceId: round.id,
          outcome: 'superseded',
        })
        if (!ended) {
          keptOnOldPolicy += 1
          continue
        }
        yield* insertReviewEvent({
          tenantId: input.tenantId,
          reviewInstanceId: round.id,
          kind: 'rerouted',
          actorId: input.actorId,
          route: round.route,
          stageId: round.stageId,
          comment: input.reason,
        })
        // a re-route is a fresh round: the old round's judges carry no
        // exclusion into it, the same as an appeal's do not. The filing's
        // own author still does - a claim written by a proxy must not be
        // judged by that proxy, and passing the subject twice collapsed the
        // conflict set to one person and seated them.
        const arrived = yield* stageArrival({
          tenantId: input.tenantId,
          batchId: input.item.batchId,
          stage: landing,
          subjectUserId: participant.userId,
          actorId: round.actorId,
          staffing,
        })
        const roundNo = yield* nextRoundNo(input.tenantId, round.entryId)
        // a new round, never an edit to the old one: "why did it go there"
        // has to survive the change that moved it
        const opened = yield* insertReviewInstance({
          tenantId: input.tenantId,
          entryId: round.entryId,
          revisionId: round.revisionId,
          roundNo,
          // A round keeps what it is across a re-route. An appeal moved onto
          // a newer chain is still an appeal: withdrawal reads origin off
          // the round a claim currently stands on, and a replacement that
          // called itself an ordinary re-route made a contested verdict
          // withdrawable, which would wash it back to a draft - and the
          // conclusion it reaches would have looked appealable again. A
          // staff reopening stays one for the same reasons.
          origin: round.origin === 'appeal' || round.origin === 'reopen' ? round.origin : 'reroute',
          // and what it was contesting travels with it - whichever pointer
          // it held. An appeal against an administrative determination that
          // lost this on a re-route would quietly re-seed from the filing,
          // which is the exact thing the pointer exists to prevent.
          ...(round.appealedInstanceId !== null
            ? { appealedInstanceId: round.appealedInstanceId }
            : {}),
          ...(round.appealedRecognitionId !== null
            ? { appealedRecognitionId: round.appealedRecognitionId }
            : {}),
          ...(round.appealedEventId !== null ? { appealedEventId: round.appealedEventId } : {}),
          initiator: 'staff',
          supersedesInstanceId: round.id,
          policyRevisionId: input.newRevisionId,
          recognitionRevisionId: input.newRevisionId,
          effectivePolicy: resolved,
          route: landing.route,
          stageId: landing.id,
          roleIds: landing.roleIds,
          nodeId: landing.nodeId,
          nodePath,
          state: arrived.state,
          blockedReason: arrived.blockedReason,
        })
        // The old round's `rerouted` event is the administrator's one act;
        // the new round says how it began through origin + supersedes, and a
        // second identical event here read as the same thing done twice.
        if (arrived.state === 'blocked') {
          yield* insertReviewEvent({
            tenantId: input.tenantId,
            reviewInstanceId: opened,
            kind: 'assignee-not-found',
            actorId: null,
            route: landing.route,
            stageId: landing.id,
          })
        } else if (isPanelStage(landing)) {
          // the landing is a sitting: constitute it from whoever is
          // eligible on arrival, the same as any other entry to the stage
          yield* createPanel({
            tenantId: input.tenantId,
            reviewInstanceId: opened,
            route: landing.route,
            stageId: landing.id,
            members: arrived.eligible,
          })
        }
        // The claim follows its round onto the replacement, whatever it
        // reads: a first round's claim is `in_review`, an appeal's keeps the
        // approval or refusal it had (§32.21). Asked by status, an appeal's
        // claim went on pointing at the round just superseded - the card
        // said nothing was open, and the claim could never be appealed
        // again. A claim that was not standing on the round moved here is
        // data this save must not build on, so the whole save fails.
        const followed = yield* repointReviewRound({
          tenantId: input.tenantId,
          entryId: round.entryId,
          from: round.id,
          to: opened,
        })
        if (!followed) {
          return yield* Effect.die(
            new Error(
              `review round ${round.id} was re-routed, but its entry ${round.entryId} was not standing on it`,
            ),
          )
        }
        rerouted += 1
      }

      return { returnedInReview, returnedApproved, rerouted, keptOnOldPolicy }
    })

  /**
   * One configuration through the gauntlet, ending in the next revision.
   * Nothing is ever updated in place: fixing a configuration is appending the
   * next one.
   */
  const appendRevision = (input: {
    tenantId: string
    item: ItemRow
    current: ItemRevisionRow | null
    materialRange: MaterialRange
    config: ItemConfigInput
    /** the one compilation of this save; never recompiled here */
    compiled: { readonly plan: ScoringPlan } | { readonly issues: readonly PlanIssue[] }
    actorId: string
    reason: string | null
  }) =>
    Effect.gen(function* () {
      const issues = yield* issuesOf(input)
      if (issues.length > 0) return yield* new ItemConfigInvalid({ issues })

      // a byte-identical configuration is not a new version of anything:
      // appending it would move current_revision_id and the audit counter to
      // say that nothing happened
      if (input.current !== null && !configChanged(input.current, input.config)) {
        return { revisionId: input.current.id, changed: false as const }
      }

      // the arithmetic was compiled once, by the caller, and is frozen onto
      // the revision here: what an entry gets scored by is then a stored
      // fact rather than a decision the scorer re-derives per reading
      const compiled = input.compiled
      if ('issues' in compiled) return yield* new ItemConfigInvalid({ issues: compiled.issues })

      const revisionNo = yield* nextRevisionNo(input.tenantId, input.item.id)
      const revisionId = yield* insertItemRevision({
        tenantId: input.tenantId,
        itemId: input.item.id,
        revisionNo,
        entryChannels: input.config.entryChannels,
        formConfig: input.config.formConfig,
        scoringConfig: input.config.scoringConfig,
        scoringPlan: compiled.plan,
        reviewPolicy: input.config.reviewPolicy,
        displayConfig: input.config.displayConfig ?? {},
        createdBy: input.actorId,
        reason: input.reason,
      })
      yield* setCurrentRevision(input.tenantId, input.item.id, revisionId)
      return { revisionId, changed: true as const }
    })

  const groupsView = (tenantId: string, batchId: string) =>
    groupsOf(tenantId, batchId).pipe(
      Effect.map((rows) =>
        rows.map((row): ScoreGroupView => ({
          id: row.id,
          parentGroupId: row.parentGroupId,
          name: row.name,
          cap: row.cap,
          floor: row.floor,
          sortOrder: row.sortOrder,
          // the questions the group asks, not the ones filed under it: this
          // view reaches everybody who may read the round, and a draft is
          // neither theirs to see nor worth anything against the cap
          itemCount: row.activeItemCount,
        })),
      ),
    )

  const listItems: ItemMethods['listItems'] = Effect.fn('Assessment.listItems')(
    function* (tenantId, batchId, as) {
      yield* deps.requireBatchVisible(tenantId, batchId, as)
      return yield* withDb(
        Effect.gen(function* () {
          const manage = yield* canManage(as, tenantId, batchId)
          // a draft question is not yet asked of anybody: whoever composes
          // the paper sees it, nobody else learns it exists
          const rows = (yield* itemsOf(tenantId, batchId)).filter(
            (row) => manage || row.status !== 'draft',
          )
          const revisions = yield* revisionsOf(
            tenantId,
            rows.map((row) => row.id),
          )
          return {
            items: rows.map((row) => toView(row, revisions.get(row.id) ?? null)),
            capabilities: { canManage: manage },
          }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  const createItem: ItemMethods['createItem'] = Effect.fn('Assessment.createItem')(
    function* (tenantId, batchId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* deps.requireRosterReach(as, tenantId, batchId)
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            // counted under the batch lock, so two creations cannot both
            // take the last place
            if ((yield* itemCountOf(tenantId, batchId)) >= ITEMS_PER_BATCH_MOST) {
              return yield* new ItemConfigInvalid({
                issues: [{ path: 'batch', reason: 'too-many-items' }],
              })
            }
            const heavy = weightIssues(input.config)
            if (heavy.length > 0) return yield* new ItemConfigInvalid({ issues: heavy })
            const batch = yield* oneBatch(tenantId, batchId)
            const groups = yield* groupsOf(tenantId, batchId)
            if (!groups.some((group) => group.id === input.scoreGroupId)) {
              return yield* new ItemConfigInvalid({
                issues: [{ path: 'scoreGroupId', reason: 'group-not-in-batch' }],
              })
            }
            const itemId = yield* insertItem({
              tenantId,
              batchId,
              itemType: input.itemType,
              title: input.title,
              scoreGroupId: input.scoreGroupId,
              maxEntries: input.maxEntries,
              sortOrder: input.sortOrder ?? 0,
            })
            const item = (yield* itemOf(tenantId, itemId))!
            const materialRange = deps.parseRange(String(batch!.materialRange))
            // the first revision stores the normalized form too: identities
            // are minted at creation, not at some later edit
            const normalized = yield* normalizeScoringAuthoring({
              current: null,
              submitted: input.config.scoringConfig,
              mint: mintRecognitionIds,
            })
            if ('issues' in normalized) {
              return yield* new ItemConfigInvalid({ issues: normalized.issues })
            }
            const config = { ...input.config, scoringConfig: normalized.config }
            const appended = yield* appendRevision({
              tenantId,
              item,
              current: null,
              materialRange,
              config,
              compiled: yield* compiledCandidate({
                tenantId,
                item,
                materialRange,
                config,
                previous: null,
                as,
              }),
              actorId: as.userId,
              reason: null,
            })
            yield* deps.recordConfigChange(
              tenantId,
              batchId,
              locked.status,
              {
                itemCreated: {
                  itemId: item.id,
                  title: item.title,
                  revisionId: appended.revisionId,
                },
              },
              as.userId,
              null,
            )
            yield* announce(tenantId, item.batchId, [{ kind: 'item-changed' }])
            const written = (yield* itemOf(tenantId, itemId))!
            const revision =
              written.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, written.currentRevisionId)
            return toView(written, revision)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  const getRecognitionContract: ItemMethods['getRecognitionContract'] = Effect.fn(
    'Assessment.getRecognitionContract',
  )(function* (tenantId, itemId, as) {
    const found = yield* withDb(
      itemOf(tenantId, itemId).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
    )
    if (found === null) return yield* new ItemNotFound()
    yield* deps.requireBatchVisible(tenantId, found.batchId, as)
    // the same standing the record page itself requires: this is the form a
    // registrar fills, and nobody else has business with the pre-fill map
    if (!(yield* deps.hasRecordAuthority(tenantId, found.batchId, as.userId))) {
      return yield* new AccessDenied({ reason: 'cannot record against this batch' })
    }
    if (found.currentRevisionId === null) return null
    return yield* withDb(
      Effect.gen(function* () {
        const revision = yield* revisionOf(tenantId, found.currentRevisionId!)
        if (revision === null) return null
        const plan = yield* Effect.orDie(readScoringPlan(revision))
        const fields = recognitionFormFields(plan)
        if (fields === null) return null
        return {
          itemRevisionId: revision.id,
          fields,
          defaults: Object.entries(plan.defaultBindings).flatMap(([recognitionId, binding]) =>
            binding.assignment.kind === 'incompatible'
              ? []
              : [
                  {
                    recognitionId,
                    payloadKey: binding.payloadKey ?? binding.fieldId,
                    assignment: binding.assignment,
                  },
                ],
          ),
        } satisfies RecognitionContractView
      }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
    )
  })

  const getItem: ItemMethods['getItem'] = Effect.fn('Assessment.getItem')(
    function* (tenantId, itemId, as) {
      const found = yield* withDb(
        itemOf(tenantId, itemId).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
      if (found === null) return yield* new ItemNotFound()
      yield* deps.requireBatchVisible(tenantId, found.batchId, as)
      return yield* withDb(
        Effect.gen(function* () {
          const manage = yield* canManage(as, tenantId, found.batchId)
          // the rule the list applies, applied to the one: a draft question is
          // not yet asked of anybody, so to a reader who does not compose the
          // paper it does not exist - naming its id must not be a way in
          if (found.status === 'draft' && !manage) return yield* new ItemNotFound()
          const revision =
            found.currentRevisionId === null
              ? null
              : yield* revisionOf(tenantId, found.currentRevisionId)
          return { ...toView(found, revision), manageable: manage }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  /**
   * The trial a scoring change owes, and the facts it needs.
   *
   * Raised inside the first pass of a save that has to run the candidate
   * arithmetic over what already stands determined: the pass rolls back
   * having written nothing, the trial runs outside any transaction, and
   * the save goes on from what it found. `token` names the state the
   * trial was drawn for, so the second pass can tell whether it still
   * applies.
   */
  class TrialNeeded extends Data.TaggedError('TrialNeeded')<{
    readonly trial: ScoringTrial
    /** the report as counted before the trial, whose token names the state */
    readonly impact: ChangeImpact
  }> {}

  /** what a trial found for one state, carried into the second pass */
  interface TrialReceipt {
    readonly token: string
    readonly scoring: ScoringImpact
  }

  const updateItem: ItemMethods['updateItem'] = Effect.fn('Assessment.updateItem')(
    function* (tenantId, itemId, input, as) {
      const runtime = yield* ScoringRuntimeCatalog

      /**
       * One pass through the save.
       *
       * With no receipt it either completes - a save that changes no
       * arithmetic, or one whose arithmetic nobody stands under - or stops
       * where it would have to run the candidate over what stands, and
       * says what to try. With a receipt for THIS state it completes,
       * judging by what the trial found; with one for another state it
       * hands back the report drawn afresh, because the answer it carries
       * was given to a question that has since changed.
       */
      const pass = (receipt: TrialReceipt | null) =>
        withDb(
          transaction(
            Effect.gen(function* () {
              const located = yield* itemOf(tenantId, itemId)
              if (located === null) return yield* new ItemNotFound()
              const locked = yield* lockBatch(tenantId, located.batchId)
              if (!locked) return yield* new BatchNotFound()
              yield* deps.requireRosterReach(as, tenantId, located.batchId)
              if (locked.status === 'archived') return yield* new BatchReadOnly()
              // only the state read under the lock is trusted: a void landing
              // between the locate read and the lock must be seen, or an edit
              // would quietly reconfigure a question that no longer runs
              const item = yield* itemOf(tenantId, itemId)
              if (item === null) return yield* new ItemNotFound()
              // a voided question keeps its history; un-voiding it is its own
              // act, not a side effect of an edit
              if (item.status === 'voided') {
                return yield* new ItemConfigInvalid({
                  issues: [{ path: 'item', reason: 'item-voided' }],
                })
              }
              if (input.scoreGroupId !== undefined) {
                const groups = yield* groupsOf(tenantId, item.batchId)
                if (!groups.some((group) => group.id === input.scoreGroupId)) {
                  return yield* new ItemConfigInvalid({
                    issues: [{ path: 'scoreGroupId', reason: 'group-not-in-batch' }],
                  })
                }
              }
              // What kind of question it is may still move while nothing has
              // happened to it: a draft nobody has filed into. Anything more
              // is a void and a replacement, because every filing, round and
              // determination stands under the kind it was made for.
              let target = item
              if (input.itemType !== undefined && input.itemType !== item.itemType) {
                if (!catalogs.itemTypes.has(input.itemType)) {
                  return yield* new ItemConfigInvalid({
                    issues: [{ path: 'itemType', reason: 'item-type-not-installed' }],
                  })
                }
                if (item.status !== 'draft' || (yield* itemHasEntries(tenantId, itemId))) {
                  return yield* new ItemConfigInvalid({
                    issues: [{ path: 'itemType', reason: 'item-type-frozen' }],
                  })
                }
                target = { ...item, itemType: input.itemType }
              }
              const current =
                item.currentRevisionId === null
                  ? null
                  : yield* revisionOf(tenantId, item.currentRevisionId)
              // Which version this edit was composed against. Without it two
              // administrators with the same question open both save, and the
              // second is answering an impact report drawn from a state that
              // stopped existing while they were reading it. Checked before
              // anything reads or gates on the submitted configuration.
              if (
                input.expectedRevisionId !== undefined &&
                input.expectedRevisionId !== (item.currentRevisionId ?? null)
              ) {
                return yield* new ItemConfigInvalid({
                  issues: [{ path: 'expectedRevisionId', reason: 'item-revision-conflict' }],
                })
              }
              // The submitted scoring language is normalized BEFORE anything
              // compares or gates on it: change detection, the reason gate,
              // compilation, impact and the appended revision all consume the
              // one stored form - so a client re-spelling its draft handles is
              // not a change, and a stored form re-submitted is a no-op.
              let config: ItemConfigInput | undefined
              if (input.config !== undefined) {
                const heavy = weightIssues(input.config)
                if (heavy.length > 0) return yield* new ItemConfigInvalid({ issues: heavy })
                const normalized = yield* normalizeScoringAuthoring({
                  current: current?.scoringConfig ?? null,
                  submitted: input.config.scoringConfig,
                  mint: mintRecognitionIds,
                })
                if ('issues' in normalized) {
                  return yield* new ItemConfigInvalid({ issues: normalized.issues })
                }
                config = { ...input.config, scoringConfig: normalized.config }
              }

              const fieldDiff: Record<string, unknown> = {}
              if (input.title !== undefined && input.title !== item.title) {
                fieldDiff['title'] = [item.title, input.title]
              }
              if (target.itemType !== item.itemType) {
                fieldDiff['itemType'] = [item.itemType, target.itemType]
              }
              if (input.scoreGroupId !== undefined && input.scoreGroupId !== item.scoreGroupId) {
                fieldDiff['scoreGroupId'] = [item.scoreGroupId, input.scoreGroupId]
              }
              if (input.maxEntries !== undefined && input.maxEntries !== item.maxEntries) {
                fieldDiff['maxEntries'] = [item.maxEntries, input.maxEntries]
              }
              if (input.sortOrder !== undefined && input.sortOrder !== item.sortOrder) {
                fieldDiff['sortOrder'] = [item.sortOrder, input.sortOrder]
              }

              // On a running round, changing what a question is worth needs a
              // sentence saying why (assessment-design §32.8): the scoring
              // references, and which group's caps the item answers to, are
              // scoring semantics. A title is not.
              const scoringChanged =
                config !== undefined &&
                current !== null &&
                !sameJson(current.scoringConfig, config.scoringConfig)
              const semanticChange = scoringChanged || fieldDiff['scoreGroupId'] !== undefined
              const reason = input.reason?.trim() ?? ''
              // A question nobody has been asked yet has produced no facts to
              // explain (§32.60), so composing one inside a running round is
              // still just composing.
              if (
                locked.status === 'active' &&
                item.status !== 'draft' &&
                semanticChange &&
                reason === ''
              ) {
                return yield* new ItemConfigInvalid({
                  issues: [{ path: 'reason', reason: 'reason-required' }],
                })
              }

              // the plain fields are written only once every gate below has
              // let the save through: a pass that stops to ask must leave
              // nothing behind, and this one may stop twice
              const applyFields = Effect.suspend(() =>
                Object.keys(fieldDiff).length === 0
                  ? Effect.void
                  : updateItemFields({
                      tenantId,
                      itemId,
                      fields: {
                        ...(input.title !== undefined ? { title: input.title } : {}),
                        ...(target.itemType !== item.itemType ? { itemType: target.itemType } : {}),
                        ...(input.scoreGroupId !== undefined
                          ? { scoreGroupId: input.scoreGroupId }
                          : {}),
                        ...(input.maxEntries !== undefined ? { maxEntries: input.maxEntries } : {}),
                        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
                      },
                    }),
              )
              if (config !== undefined) {
                const batch = yield* oneBatch(tenantId, item.batchId)
                const materialRange = deps.parseRange(String(batch!.materialRange))
                const nextPlan = yield* compiledCandidate({
                  tenantId,
                  item: target,
                  materialRange,
                  config,
                  previous: current,
                  as,
                })
                // the candidate as the administrator keeps sending it, and
                // what it resolved to - never the identities minted for it
                // on this request, which the next request mints afresh
                const candidateImpactHash = candidateImpactHashOf({
                  formConfig: input.config!.formConfig,
                  reviewPolicy: input.config!.reviewPolicy,
                  scoringIntent: input.config!.scoringConfig,
                  calculatorContract: 'plan' in nextPlan ? nextPlan.plan.calculator : null,
                })
                const currentPlan =
                  current === null ? null : yield* readScoringPlan(current).pipe(Effect.orDie)
                // Whether the arithmetic a determination meets on its own has
                // moved. Presentation, admission and the aggregator stay out:
                // renaming a fact, narrowing what may be determined, or
                // folding amounts differently changes nothing about what any
                // one determination is worth, so no trial is owed for them.
                const arithmeticMoved =
                  'plan' in nextPlan &&
                  currentPlan !== null &&
                  recognitionEvaluationHash(currentPlan) !==
                    recognitionEvaluationHash(nextPlan.plan)
                const derived =
                  deps.catalogs.itemTypes.get(target.itemType)?.interaction === 'derived'
                const counted = yield* impactUnder({
                  tenantId,
                  item: target,
                  current,
                  materialRange,
                  config,
                  nextPlan,
                  candidateImpactHash,
                  scoring: (approvedTotal) =>
                    receipt !== null && arithmeticMoved
                      ? receipt.scoring
                      : unchangedScoring(approvedTotal),
                })
                // A determination somebody already made is not something a
                // dialog can offer to handle. Scoring reads the question's
                // CURRENT plan, so a configuration the standing determinations
                // do not fit leaves those claims approved and unscorable -
                // and there is no remedy a student or a reviewer could carry
                // out. It is refused at the save, which is the only moment
                // anybody is looking (§35).
                if (counted.stranded.length > 0) {
                  return yield* new ItemConfigInvalid({
                    issues: strandingIssues(counted.stranding),
                  })
                }
                // What stands determined, and whether the candidate rule can
                // take it. The shape check above says the values still fit
                // the contract; only running the rule says whether it scores
                // them, and what it makes of them. That run is owed whenever
                // the arithmetic moved and anything stands under it, and it
                // happens outside this transaction: the pass stops here with
                // nothing written and asks for it, unless it already carries
                // the answer for exactly this state.
                const standing: StandingDetermination[] = counted.live
                  .filter((row) => row.status === 'approved' && row.recognition !== null)
                  .map((row) => ({ entryId: row.entryId, recognition: row.recognition! }))
                const trialOwed = arithmeticMoved && (standing.length > 0 || derived)
                if (
                  trialOwed &&
                  'plan' in nextPlan &&
                  currentPlan !== null &&
                  (receipt === null || receipt.token !== counted.impact.impactToken)
                ) {
                  return yield* new TrialNeeded({
                    impact: counted.impact,
                    trial: {
                      tenantId,
                      batchId: item.batchId,
                      itemId,
                      current: currentPlan,
                      candidate: nextPlan.plan,
                      standing,
                      derived,
                    },
                  })
                }
                // a rule that cannot take what stands is not a choice the
                // dialog can offer either: the save is refused, with the
                // counts, and the entries are named in the log
                if (trialRefuses(counted.impact.scoring)) {
                  yield* Effect.logWarning('a candidate scoring rule cannot take what stands', {
                    itemId,
                    approved: counted.impact.scoring.approved,
                    derived: counted.impact.scoring.derived,
                  })
                  return yield* new ItemScoringIncompatible({
                    itemId,
                    approved: {
                      total: counted.impact.scoring.approved.total,
                      refused: counted.impact.scoring.approved.refused,
                      executionFailed: counted.impact.scoring.approved.executionFailed,
                    },
                    derived:
                      counted.impact.scoring.derived === null
                        ? null
                        : {
                            refused: counted.impact.scoring.derived.refused,
                            executionFailed: counted.impact.scoring.derived.executionFailed,
                          },
                  })
                }
                // A save that would disturb work under way comes back with what
                // it would disturb rather than going ahead or refusing. The
                // whole transaction rolls back, so nothing was half done while
                // the question was being asked.
                if (missingDecisions(counted.impact, input.effects)) {
                  return yield* new ItemChangeDecisionRequired(counted.impact)
                }
                // and the answer is only carried out against the state it was
                // drawn from: reviewers keep working while a dialog is open
                if (
                  input.effects !== undefined &&
                  input.effects.impactToken !== counted.impact.impactToken
                ) {
                  return yield* new ItemChangeDecisionRequired(counted.impact)
                }
                yield* applyFields
                const appended = yield* appendRevision({
                  tenantId,
                  item: target,
                  current,
                  materialRange,
                  config,
                  compiled: nextPlan,
                  actorId: as.userId,
                  reason: input.reason ?? null,
                })
                if (appended.changed) {
                  fieldDiff['config'] = {
                    oldRevisionId: current?.id ?? null,
                    newRevisionId: appended.revisionId,
                  }
                  if (counted.impact.scoring.changed) {
                    // what the trial found, on the record beside the change
                    // it belongs to; never which determinations, and never
                    // the rule's words for them
                    fieldDiff['scoringImpact'] = {
                      approved: {
                        total: counted.impact.scoring.approved.total,
                        amountChanged: counted.impact.scoring.approved.amountChanged,
                      },
                      derived:
                        counted.impact.scoring.derived === null
                          ? null
                          : { amountChanged: counted.impact.scoring.derived.amountChanged },
                    }
                  }
                  const decided = decisionNeeded(counted.impact)
                  if (input.effects !== undefined && (decided.form || decided.review)) {
                    const result = yield* propagate({
                      tenantId,
                      item,
                      newRevisionId: appended.revisionId,
                      effects: input.effects,
                      live: counted.live,
                      rounds: counted.rounds,
                      incompatible: counted.incompatible,
                      nextPolicy: config.reviewPolicy,
                      actorId: as.userId,
                      reason: input.reason ?? null,
                    })
                    // one change, one line: what was chosen and what it did
                    fieldDiff['propagation'] = {
                      form: input.effects.form ?? null,
                      review: input.effects.review ?? null,
                    }
                    fieldDiff['propagationResult'] = result
                  }
                }
              } else {
                yield* applyFields
              }
              // an update that changed nothing leaves no event and moves no
              // counter; recordConfigChange skips the empty diff
              yield* deps.recordConfigChange(
                tenantId,
                item.batchId,
                locked.status,
                Object.keys(fieldDiff).length > 0 ? { itemId, ...fieldDiff } : {},
                as.userId,
                input.reason ?? null,
              )
              // coarse on purpose: an edit may have swept rounds and standing
              // along with the paper, and a wake-up says only "look again"
              yield* announce(tenantId, item.batchId, [
                { kind: 'item-changed' },
                { kind: 'entries-changed' },
                { kind: 'review-inbox-changed' },
                { kind: 'review-instance-changed' },
                { kind: 'result-changed' },
              ])
              const written = (yield* itemOf(tenantId, itemId))!
              const revision =
                written.currentRevisionId === null
                  ? null
                  : yield* revisionOf(tenantId, written.currentRevisionId)
              return toView(written, revision)
            }),
          ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
        )

      // The save, in as many passes as the trial needs and never more than
      // two: the first stops to ask, the trial answers outside any
      // transaction, the second carries the answer. A second pass that
      // finds the state moved asks once more - and that answer is not
      // carried out either, only reported, because the report is what the
      // administrator is owed and the next submission will ask again.
      const first = yield* Effect.result(pass(null))
      if (Result.isSuccess(first)) return first.success
      if (!(first.failure instanceof TrialNeeded)) return yield* Effect.fail(first.failure)
      const tried = yield* trialScoringImpact(runtime, first.failure.trial)
      const second = yield* Effect.result(
        pass({ token: first.failure.impact.impactToken, scoring: tried }),
      )
      if (Result.isSuccess(second)) return second.success
      if (!(second.failure instanceof TrialNeeded)) return yield* Effect.fail(second.failure)
      // the state moved while the trial ran: the answer the caller carried
      // no longer applies, so what they get is the report drawn afresh -
      // tried again, outside any transaction, and only reported
      const retried = yield* trialScoringImpact(runtime, second.failure.trial)
      return yield* new ItemChangeDecisionRequired({
        ...second.failure.impact,
        scoring: retried,
      })
    },
  )

  const listScoreGroups: ItemMethods['listScoreGroups'] = Effect.fn('Assessment.listScoreGroups')(
    function* (tenantId, batchId, as) {
      yield* deps.requireBatchVisible(tenantId, batchId, as)
      return yield* withDb(
        Effect.gen(function* () {
          const version = yield* scoreGroupsVersionOf(tenantId, batchId)
          if (version === null) return yield* new BatchNotFound()
          return {
            groups: yield* groupsView(tenantId, batchId),
            version,
            capabilities: { canManage: yield* canManage(as, tenantId, batchId) },
          }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  /** an amount as the engine's integer, or null; the schema already vetted it */
  const scaled = (value: string | null) => (value === null ? null : scaledAmount(value))

  const replaceScoreGroups: ItemMethods['replaceScoreGroups'] = Effect.fn(
    'Assessment.replaceScoreGroups',
  )(function* (tenantId, batchId, input, as) {
    const specs = input.groups
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const locked = yield* lockBatch(tenantId, batchId)
          if (!locked) return yield* new BatchNotFound()
          yield* deps.requireRosterReach(as, tenantId, batchId)
          if (locked.status === 'archived') return yield* new BatchReadOnly()
          // the whole tree arrives at once, so a payload composed against an
          // older one silently removes whatever it never saw; refused before
          // anything in it is read
          const version = locked.scoreGroupsVersion
          if (version !== input.expectedVersion) {
            return yield* new ScoreGroupVersionConflict({ currentVersion: version })
          }

          const existing = yield* groupsOf(tenantId, batchId)
          const existingById = new Map(existing.map((group) => [group.id, group]))
          const refusals: { reason: string; groupId: string | null; index?: number }[] = []
          for (const [index, spec] of specs.entries()) {
            if (spec.id !== undefined && !existingById.has(spec.id)) {
              refusals.push({ reason: 'group-not-found', groupId: spec.id, index })
            }
            // compared as the engine's own integers: a float comparison here
            // would be a second arithmetic beside the scoring one
            if (
              spec.cap !== null &&
              spec.floor !== null &&
              scaled(spec.floor)! > scaled(spec.cap)!
            ) {
              refusals.push({ reason: 'floor-above-cap', groupId: spec.id ?? null, index })
            }
          }
          // a group may only sit inside one of this batch's own, and the
          // nesting has to be a tree: a cycle would make "what does this
          // group add up to" a question with no answer
          const known = new Set([
            ...existingById.keys(),
            ...specs.flatMap((spec) => (spec.id ? [spec.id] : [])),
          ])
          const parentOf = new Map<string, string | null>()
          for (const [index, spec] of specs.entries()) {
            const parent = spec.parentGroupId
            if (parent !== null && !known.has(parent)) {
              refusals.push({ reason: 'parent-not-in-batch', groupId: spec.id ?? null, index })
            }
            if (parent !== null && spec.id !== undefined && parent === spec.id) {
              refusals.push({ reason: 'parent-is-self', groupId: spec.id, index })
            }
            if (spec.id !== undefined) parentOf.set(spec.id, parent)
          }
          for (const [index, spec] of specs.entries()) {
            if (spec.id === undefined) continue
            const seen = new Set<string>([spec.id])
            let step = parentOf.get(spec.id) ?? null
            while (step !== null) {
              if (seen.has(step)) {
                refusals.push({ reason: 'parent-cycle', groupId: spec.id, index })
                break
              }
              seen.add(step)
              step = parentOf.get(step) ?? null
            }
          }

          // The round has one paper, and the paper is the group everything
          // else sits inside: its ceiling is what the whole round is worth.
          // A second group with no parent would be a second paper.
          if (specs.filter((spec) => (spec.parentGroupId ?? null) === null).length > 1) {
            refusals.push({ reason: 'one-paper-only', groupId: null })
          }

          const submitted = new Set(specs.flatMap((spec) => (spec.id ? [spec.id] : [])))
          const removed = existing.filter((group) => !submitted.has(group.id))
          for (const group of removed) {
            // every question counts here, and not the number the same group
            // shows a reader: one still being composed is as good a reason to
            // keep the group as one already asked
            if (group.heldItemCount > 0) {
              refusals.push({ reason: 'group-has-items', groupId: group.id })
            }
            if (specs.some((spec) => spec.parentGroupId === group.id)) {
              refusals.push({ reason: 'group-has-children', groupId: group.id })
            }
          }

          // the audit diff, computed before anything is written: which rows
          // appeared, which went, and field by field what changed on the rest
          const changed: Record<string, unknown>[] = []
          let limitsChanged = false
          for (const [index, spec] of specs.entries()) {
            if (spec.id === undefined) continue
            const before = existingById.get(spec.id)
            if (before === undefined) continue
            const delta: Record<string, unknown> = { groupId: spec.id }
            if (before.name !== spec.name) delta['name'] = [before.name, spec.name]
            if (scaled(before.cap) !== scaled(spec.cap)) {
              delta['cap'] = [before.cap, spec.cap]
              limitsChanged = true
            }
            if (scaled(before.floor) !== scaled(spec.floor)) {
              delta['floor'] = [before.floor, spec.floor]
              limitsChanged = true
            }
            const order = spec.sortOrder ?? index
            if (before.sortOrder !== order) delta['sortOrder'] = [before.sortOrder, order]
            const parent = spec.parentGroupId
            if (before.parentGroupId !== parent) {
              delta['parentGroupId'] = [before.parentGroupId, parent]
              // moving a group inside another changes what a cap applies to
              limitsChanged = true
            }
            if (Object.keys(delta).length > 1) changed.push(delta)
          }
          const added = specs.filter((spec) => spec.id === undefined).map((spec) => spec.name)
          const isNoOp = added.length === 0 && removed.length === 0 && changed.length === 0

          // a cap or floor on a running round is scoring semantics: moving
          // one without a sentence saying why is refused (§32.8)
          const reason = input.reason?.trim() ?? ''
          if (locked.status === 'active' && limitsChanged && reason === '') {
            refusals.push({ reason: 'reason-required', groupId: null })
          }
          if (refusals.length > 0) return yield* new ScoreGroupInvalid({ refusals })
          if (isNoOp) return { groups: yield* groupsView(tenantId, batchId), version }

          // the surviving rows move first, the departing ones go last: the
          // parent key is RESTRICT and not deferrable, so a group whose child
          // is being reparented away can only leave once that child has
          // actually moved. Nothing points the other way - a spec naming a
          // removed group as its parent is refused above, and a group being
          // inserted has no id for anything to name yet.
          for (const [index, spec] of specs.entries()) {
            if (spec.id === undefined) {
              yield* insertGroup({
                tenantId,
                batchId,
                parentGroupId: spec.parentGroupId,
                name: spec.name,
                cap: spec.cap,
                floor: spec.floor,
                sortOrder: spec.sortOrder ?? index,
              })
            } else {
              yield* updateGroup({
                tenantId,
                batchId,
                id: spec.id,
                parentGroupId: spec.parentGroupId,
                name: spec.name,
                cap: spec.cap,
                floor: spec.floor,
                sortOrder: spec.sortOrder ?? index,
              })
            }
          }
          yield* deleteGroups(
            tenantId,
            batchId,
            removed.map((group) => group.id),
          )
          yield* bumpScoreGroupsVersion(tenantId, batchId)
          yield* deps.recordConfigChange(
            tenantId,
            batchId,
            locked.status,
            {
              scoreGroups: {
                ...(added.length > 0 ? { added } : {}),
                ...(removed.length > 0
                  ? { removed: removed.map((group) => ({ groupId: group.id, name: group.name })) }
                  : {}),
                ...(changed.length > 0 ? { changed } : {}),
              },
            },
            as.userId,
            reason === '' ? null : reason,
          )
          // A cap or a floor moves every participant's total, and the paper
          // is built out of these groups - so every screen showing either is
          // now showing the old arithmetic. Said inside the transaction, the
          // way the other configuration writes announce theirs.
          yield* announce(tenantId, batchId, [{ kind: 'item-changed' }, { kind: 'result-changed' }])
          return { groups: yield* groupsView(tenantId, batchId), version: version + 1 }
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
    )
  })

  const refuse = (action: string, reason: string) => new ItemActionRefused({ action, reason })

  const deleteItem: ItemMethods['deleteItem'] = Effect.fn('Assessment.deleteItem')(
    function* (tenantId, itemId, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const located = yield* itemOf(tenantId, itemId)
            if (located === null) return yield* new ItemNotFound()
            yield* deps
              .requireBatchVisible(tenantId, located.batchId, as)
              .pipe(Effect.catchTag('ACCESS_DENIED', () => new ItemNotFound()))
            const locked = yield* lockBatch(tenantId, located.batchId)
            // a question cannot outlive the round it belongs to, so a round
            // that is gone answers the only question asked here
            if (locked === null) return yield* new ItemNotFound()
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            yield* deps.requireRosterReach(as, tenantId, located.batchId)
            // only the state read under the lock decides: a publish landing
            // between the locate read and the lock must be seen, or a question
            // that has since been asked would be deleted on the strength of
            // having been a draft a moment ago
            const item = yield* itemOf(tenantId, itemId)
            if (item === null) return yield* new ItemNotFound()
            // deletion is for questions nothing ever happened to: one never
            // published, or any question in a round that has not started -
            // and in neither case with a single entry against it. Anything
            // more is a void, which keeps the record.
            if (item.status !== 'draft' && locked.status !== 'draft') {
              return yield* refuse('delete', 'item-published')
            }
            if (yield* itemHasEntries(tenantId, itemId)) {
              return yield* refuse('delete', 'item-has-entries')
            }
            // a supplementary phase that opens only this question would be
            // left with an empty allowance, which opens every question in the
            // round instead. Widening a phase is the plan's decision to make,
            // never a side effect of removing a question
            if (yield* itemAloneInPhaseScope(tenantId, itemId)) {
              return yield* refuse('delete', 'item-last-in-phase-scope')
            }
            yield* deleteItemRows(tenantId, itemId)
            // The two things every other write here does and this one did
            // not. A question removed from a running round stayed on the
            // screens of everybody else looking at it, and the round's
            // configuration log kept a creation with nothing beside it -
            // which reads as a question that is still there.
            yield* deps.recordConfigChange(
              tenantId,
              item.batchId,
              locked.status,
              { deletedItem: itemId },
              as.userId,
              null,
            )
            yield* announce(tenantId, item.batchId, [{ kind: 'item-changed' }])
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  /**
   * A granted question on its way to being scored, whose rule has not been
   * tried against the amount it grants.
   *
   * Raised inside the transaction, so nothing written on the way survives:
   * the rule is tried outside it and the write runs again carrying the
   * identity it was tried for.
   */
  class GrantTrialNeeded extends Data.TaggedError('GrantTrialNeeded')<{
    readonly site: FailureSite
    readonly revisionId: string
    readonly identity: string
  }> {}

  const setItemStatus: ItemMethods['setItemStatus'] = Effect.fn('Assessment.setItemStatus')(
    function* (tenantId, itemId, input, as) {
      const runtime = yield* ScoringRuntimeCatalog
      // what the granted question's rule was tried for, once it has been;
      // the write below reads it each time it runs
      let tried: string | null = null
      const write = withDb(
        transaction(
          Effect.gen(function* () {
            const located = yield* itemOf(tenantId, itemId)
            if (located === null) return yield* new ItemNotFound()
            yield* deps
              .requireBatchVisible(tenantId, located.batchId, as)
              .pipe(Effect.catchTag('ACCESS_DENIED', () => new ItemNotFound()))
            const locked = yield* lockBatch(tenantId, located.batchId)
            // a question cannot outlive the round it belongs to
            if (locked === null) return yield* new ItemNotFound()
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            yield* deps.requireRosterReach(as, tenantId, located.batchId)
            // where the question stands is read under the lock, never before
            // it: whether this call publishes or restores, what it may say no
            // to, and what it writes down afterwards all follow from that one
            // answer, and the locate read above can already be out of date
            const item = yield* itemOf(tenantId, itemId)
            if (item === null) return yield* new ItemNotFound()
            if (input.status === 'voided' && locked.status === 'draft') {
              // a draft round has no facts to keep; the ceremony would
              // record nothing - delete instead
              return yield* refuse('void', 'batch-draft')
            }

            if (input.status === 'voided') {
              const reason = input.reason.trim()
              if (reason === '') return yield* refuse('void', 'reason-required')
              const moved = yield* setItemLifecycle({
                tenantId,
                itemId,
                to: 'voided',
                actorId: as.userId,
                reason,
              })
              if (!moved) return yield* refuse('void', 'item-not-active')
              // open work dies with the question; decided work stands
              for (const entry of yield* openEntriesOfItem(tenantId, itemId)) {
                let told = false
                if (entry.status === 'in_review' && entry.currentReviewInstanceId !== null) {
                  const cancelled = yield* cancelReviewInstance({
                    tenantId,
                    instanceId: entry.currentReviewInstanceId,
                    outcome: 'cancelled',
                  })
                  if (cancelled) {
                    // the why travels with it, as it does on the claims no
                    // round was open for
                    yield* insertReviewEvent({
                      tenantId,
                      reviewInstanceId: entry.currentReviewInstanceId,
                      kind: 'cancelled-item-voided',
                      actorId: as.userId,
                      comment: reason,
                    })
                    told = true
                  }
                }
                const voided = yield* setEntryState({
                  tenantId,
                  entryId: entry.id,
                  from: ['draft', 'in_review', 'needs_revision'],
                  to: 'voided',
                })
                if (!voided) continue
                // A claim with no round to say it is told on its own trail,
                // so a draft that went with its question is never mistaken
                // for one its owner gave up; either way its owner hears.
                if (!told) {
                  yield* insertEntryEvent({
                    tenantId,
                    entryId: entry.id,
                    kind: VOIDED_WITH_ITEM,
                    actorId: as.userId,
                    reason,
                  })
                }
                yield* bumpParticipantAttention(tenantId, entry.id)
              }
              // An appeal is open work too, on a decided claim: the claim
              // keeps the standing it had while it is appealed (§32.21), so
              // it is not among the entries above, and its round is found
              // by the round. The round ends as the question's others did;
              // the claim, which stands, goes back to standing on the
              // decision the appeal was contesting - left on a cancelled
              // round, it could never be appealed again once the question
              // is restored.
              for (const round of yield* openRoundsOfItem(tenantId, itemId)) {
                const cancelled = yield* cancelReviewInstance({
                  tenantId,
                  instanceId: round.id,
                  outcome: 'cancelled',
                })
                if (!cancelled) continue
                yield* insertReviewEvent({
                  tenantId,
                  reviewInstanceId: round.id,
                  kind: 'cancelled-item-voided',
                  actorId: as.userId,
                  comment: reason,
                })
                yield* repointReviewRound({
                  tenantId,
                  entryId: round.entryId,
                  from: round.id,
                  to: round.appealedInstanceId,
                })
              }
              yield* deps.recordConfigChange(
                tenantId,
                item.batchId,
                locked.status,
                { voidedItem: itemId },
                as.userId,
                reason,
              )
            } else {
              // Publishing asks the question of the round for the first time;
              // restoring reopens one that was withdrawn. Both are the same
              // write, and neither reaches backwards: entries voided with a
              // question stay voided, cancelled rounds stay cancelled.
              const publishing = item.status === 'draft'
              // Both are also the moment the configuration becomes live, and
              // it has never been judged as a live one: a draft was composed
              // under no such trial, and the round's window is re-read only
              // against the questions it is already asking. So it faces the
              // save's own gauntlet here, and is refused in the save's own
              // words.
              const current =
                item.currentRevisionId === null
                  ? null
                  : yield* revisionOf(tenantId, item.currentRevisionId)
              if (current === null) {
                return yield* refuse(publishing ? 'publish' : 'restore', 'item-not-configured')
              }
              const batch = yield* oneBatch(tenantId, item.batchId)
              const issues = yield* issuesOf({
                tenantId,
                item,
                current,
                materialRange: deps.parseRange(String(batch!.materialRange)),
                config: {
                  entryChannels: current.entryChannels,
                  formConfig: current.formConfig,
                  scoringConfig: current.scoringConfig,
                  reviewPolicy: current.reviewPolicy,
                  displayConfig: current.displayConfig,
                },
              })
              if (issues.length > 0) return yield* new ItemConfigInvalid({ issues })
              // A granted question is scored at every read of every account
              // in the round, on the amount its rule pays, and a failure
              // there is taken for a state that cannot happen. So the rule
              // pays it once before the question counts - whether it was
              // never asked before or is being asked again.
              if (deps.catalogs.itemTypes.get(item.itemType)?.interaction === 'derived') {
                const plan = yield* readScoringPlan(current).pipe(Effect.orDie)
                const identity = probeIdentity({ revisionId: current.id, planHash: plan.planHash })
                if (tried !== identity) {
                  return yield* new GrantTrialNeeded({
                    site: { tenantId, batchId: item.batchId, itemId, plan },
                    revisionId: current.id,
                    identity,
                  })
                }
              }
              const moved = yield* setItemLifecycle({ tenantId, itemId, to: 'active' })
              if (!moved) {
                return yield* refuse(
                  publishing ? 'publish' : 'restore',
                  publishing ? 'item-not-draft' : 'item-not-voided',
                )
              }
              yield* deps.recordConfigChange(
                tenantId,
                item.batchId,
                locked.status,
                publishing ? { publishedItem: itemId } : { restoredItem: itemId },
                as.userId,
                null,
              )
            }
            yield* announce(tenantId, item.batchId, [
              { kind: 'item-changed' },
              { kind: 'entries-changed' },
              { kind: 'review-inbox-changed' },
              { kind: 'review-instance-changed' },
              { kind: 'result-changed' },
            ])
            const written = (yield* itemOf(tenantId, itemId))!
            const revision =
              written.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, written.currentRevisionId)
            return toView(written, revision)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )

      // As many passes as the trial needs and never more than two: the
      // first stops to ask, the rule is tried outside any transaction, the
      // second carries what it was tried for. A second pass that finds the
      // question's configuration moved meanwhile is told so, not tried again.
      const first = yield* Effect.result(write)
      if (Result.isSuccess(first)) return first.success
      if (!(first.failure instanceof GrantTrialNeeded)) return yield* first.failure
      const grant = yield* trialDerivedGrant(runtime, first.failure.site)
      if (grant.refused || grant.executionFailed) {
        yield* Effect.logWarning('a granted question cannot pay its own amount', {
          itemId,
          derived: grant,
        })
        return yield* new ItemScoringIncompatible({
          itemId,
          approved: { total: 0, refused: 0, executionFailed: 0 },
          derived: grant,
        })
      }
      tried = first.failure.identity
      const second = yield* Effect.result(write)
      if (Result.isSuccess(second)) return second.success
      if (second.failure instanceof GrantTrialNeeded) {
        return yield* new ItemRevisionConflict({
          itemId,
          currentRevisionId: second.failure.revisionId,
        })
      }
      return yield* second.failure
    },
  )

  /**
   * What a save would say about this candidate, without saving it.
   *
   * The same gauntlet a save runs, in the same order, under the same batch
   * lock: the group, the kind, the authored scoring normalized against the
   * stored one, the driver's reading of the form, the policy, the doors, and
   * the one real compile. Nothing is written - the identities a draft's new
   * determinations would be given are placeholders that never leave this
   * call - and every reason is gathered rather than the first one raised,
   * because a screen that is told one thing at a time is corrected one press
   * at a time.
   *
   * What it does not ask is what only a save can be asked: whether somebody
   * else saved first, and why a running round's arithmetic is being moved.
   */
  const checkItem: ItemMethods['checkItem'] = Effect.fn('Assessment.checkItem')(
    function* (tenantId, batchId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* deps.requireRosterReach(as, tenantId, batchId)
            const batch = yield* oneBatch(tenantId, batchId)
            const materialRange = deps.parseRange(String(batch!.materialRange))
            const issues: {
              path: string
              reason: string
              handle?: string
              count?: number
              values?: readonly string[]
            }[] = []

            const groups = yield* groupsOf(tenantId, batchId)
            if (!groups.some((group) => group.id === input.scoreGroupId)) {
              issues.push({ path: 'scoreGroupId', reason: 'group-not-in-batch' })
            }

            const stored = input.itemId === undefined ? null : yield* itemOf(tenantId, input.itemId)
            const existing = stored !== null && stored.batchId === batchId ? stored : null
            if (existing?.status === 'voided') {
              return { issues: [{ path: 'item', reason: 'item-voided' }], standing: [] }
            }
            const heavy = weightIssues(input.config)
            if (heavy.length > 0) return { issues: [...heavy], standing: [] }
            if (!catalogs.itemTypes.has(input.itemType)) {
              return {
                issues: [...issues, { path: 'itemType', reason: 'item-type-not-installed' }],
                standing: [],
              }
            }
            if (
              existing !== null &&
              input.itemType !== existing.itemType &&
              (existing.status !== 'draft' || (yield* itemHasEntries(tenantId, existing.id)))
            ) {
              issues.push({ path: 'itemType', reason: 'item-type-frozen' })
            }
            // a question nobody has saved yet is judged as the draft it
            // would be created as; nothing reads this row but the gauntlet
            const item: ItemRow =
              existing !== null
                ? { ...existing, itemType: input.itemType }
                : {
                    id: '00000000-0000-7000-8000-000000000000',
                    batchId,
                    itemType: input.itemType,
                    title: '',
                    scoreGroupId: input.scoreGroupId,
                    maxEntries: null,
                    sortOrder: 0,
                    status: 'draft',
                    voidReason: null,
                    currentRevisionId: null,
                    createdAt: 0,
                  }
            const current =
              existing === null || existing.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, existing.currentRevisionId)

            // placeholders in ordinal order, exactly as a save would mint
            // them, so that an issue about one can be handed back under the
            // handle the screen composed it with
            const placeholder = (index: number) =>
              `00000000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`
            const normalized = yield* normalizeScoringAuthoring({
              current: current?.scoringConfig ?? null,
              submitted: input.config.scoringConfig,
              mint: (count) =>
                Effect.succeed(
                  Array.from({ length: count }, (_unused, index) => placeholder(index)),
                ),
            })
            // what stands under the question is a fact about the question,
            // whatever is being composed over it
            const live = existing === null ? [] : yield* liveEntryPayloads(tenantId, existing.id)
            const rounds = existing === null ? [] : yield* openRoundsOfItem(tenantId, existing.id)
            const standing =
              existing === null
                ? []
                : yield* standingUnder({ tenantId, itemId: existing.id, live, rounds })
            if ('issues' in normalized) {
              return { issues: [...issues, ...normalized.issues], standing }
            }
            const handleOf = new Map<string, string>()
            const submitted = (input.config.scoringConfig as { recognitions?: unknown } | null)
              ?.recognitions
            if (Array.isArray(submitted)) {
              let minted = 0
              for (const one of submitted as { handle?: unknown; id?: unknown }[]) {
                if (typeof one?.handle !== 'string') continue
                handleOf.set(
                  typeof one.id === 'string' ? one.id : placeholder(minted++),
                  one.handle,
                )
              }
            }
            const config = { ...input.config, scoringConfig: normalized.config }

            issues.push(...(yield* issuesOf({ tenantId, item, current, materialRange, config })))
            const compiled = yield* compiledCandidate({
              tenantId,
              item,
              materialRange,
              config,
              previous: current,
              as,
            }).pipe(
              // whoever owns the arithmetic refusing this principal is one
              // more reason, not a different kind of answer
              Effect.catchTag('ASSESSMENT_ITEM_CONFIG_INVALID', (refused) =>
                Effect.succeed({ issues: refused.issues }),
              ),
            )
            if ('issues' in compiled) issues.push(...compiled.issues)
            // the same judgment a save makes of what already stands, asked
            // while the narrowing is still being composed: the claims
            // themselves are of no use to a screen, the causes are
            else if (existing !== null) {
              const stranding = yield* strandingUnder({
                tenantId,
                itemId: existing.id,
                schemas: compiled.plan.recognitionSchemas,
                live,
                rounds,
              })
              issues.push(
                ...strandingIssues(stranding).filter(
                  (issue) => issue.reason !== 'strands-existing-recognition',
                ),
              )
            }

            const seen = new Set<string>()
            return {
              standing,
              issues: issues.flatMap((issue) => {
                const key = `${issue.path}\u0000${issue.reason}`
                if (seen.has(key)) return []
                seen.add(key)
                const at = /^scoringConfig\.recognitions\.([^.]+)$/.exec(issue.path)
                const handle = at === null ? undefined : handleOf.get(at[1]!)
                return [handle === undefined ? issue : { ...issue, handle }]
              }),
            }
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  /**
   * What this candidate configuration's calculator would need (§9.8).
   *
   * A real compile, under the batch lock, through the same seam a save
   * uses - so the answer a screen shows is the answer the save will give,
   * and not a second, kinder judgment that lets somebody bind what cannot
   * be bound. Short on purpose: nothing is written, and the lock is held
   * only for as long as the compile takes.
   *
   * The previous runtime identity is derived here, from the named
   * question's own frozen plan and only when the SAME calculator is being
   * recompiled. A caller who names another round's question is previewing
   * a new binding, which is exactly what they would be saving.
   */
  const previewScoring: ItemMethods['previewScoring'] = Effect.fn('Assessment.previewScoring')(
    function* (tenantId, batchId, input, as) {
      const runtime = yield* ScoringRuntimeCatalog
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* deps.requireRosterReach(as, tenantId, batchId)
            const batch = yield* oneBatch(tenantId, batchId)
            const materialRange = deps.parseRange(String(batch!.materialRange))

            const driver = catalogs.itemTypes.get(input.itemType)
            if (driver === undefined) {
              return yield* new ItemConfigInvalid({
                issues: [{ path: 'itemType', reason: 'item-type-not-installed' }],
              })
            }
            // The driver's own codec decides what a form IS, and what it
            // produces is what the bindable fields are read from. A form it
            // cannot read yet is reported rather than refused: the screen
            // asks this question while the form is still being built out of
            // the very parameters this call is here to name. A driver that
            // can read a form field by field says which fields it could
            // read and names the others one by one, so one field without a
            // name yet does not make every other field disappear.
            const form = yield* Effect.gen(function* () {
              if (driver.draftFields !== undefined) {
                return driver.draftFields(input.formConfig, { materialRange })
              }
              const formConfig = yield* Effect.match(
                Schema.decodeUnknownEffect(driver.configSchema as Schema.Codec<unknown>)(
                  input.formConfig,
                ),
                { onSuccess: (value: unknown) => ({ value }), onFailure: () => null },
              )
              if (formConfig === null) {
                return {
                  issues: [{ path: 'formConfig', reason: 'form-config-invalid' }],
                  bindableFields: [],
                }
              }
              const issues =
                driver.configIssues?.(formConfig.value, { materialRange })?.map((issue) => ({
                  path: issue.path,
                  reason: issue.reason,
                })) ?? []
              return {
                issues,
                bindableFields:
                  issues.length > 0
                    ? []
                    : (driver.bindableFields?.(formConfig.value, { materialRange }) ?? []),
              }
            })

            const calculator = catalogs.calculators.get(input.calculator.ref)
            if (calculator === undefined) {
              return yield* new ItemConfigInvalid({
                issues: [{ path: 'calculator.ref', reason: 'calculator-not-installed' }],
              })
            }
            // history comes from the question, never from the payload
            const previousRuntimeRef = yield* Effect.gen(function* () {
              if (input.itemId === undefined) return undefined
              const item = yield* itemOf(tenantId, input.itemId)
              if (item === null || item.batchId !== batchId) return undefined
              if (item.currentRevisionId === null) return undefined
              const revision = yield* revisionOf(tenantId, item.currentRevisionId)
              return yield* continuationOf(revision, input.calculator.ref)
            })

            // the same question the save asks, at the moment somebody can
            // still do something about the answer
            yield* vetBinding({
              tenantId,
              batchId,
              ref: input.calculator.ref,
              config: input.calculator.config,
              previousRuntimeRef,
              as,
            }).pipe(
              // the policy speaks the compiler's paths; a preview is asked
              // about a candidate, so the paths are the payload's
              Effect.catch((issue) =>
                Effect.fail(
                  new ItemConfigInvalid({
                    issues: [{ path: payloadPath(issue.path), reason: issue.reason }],
                  }),
                ),
              ),
            )

            const compiled = yield* contractOf({
              calculator,
              compile: runtime.compile,
              host: {
                tenantId,
                batchId,
                ...(previousRuntimeRef === undefined ? {} : { previousRuntimeRef }),
              },
              config: input.calculator.config,
            })
            if ('issues' in compiled) {
              return yield* new ItemConfigInvalid({
                issues: compiled.issues.map((issue) => ({
                  path: payloadPath(issue.path),
                  reason: issue.reason,
                })),
              })
            }
            return {
              calculator: {
                ref: input.calculator.ref,
                contractHash: compiled.contract.contractHash,
              },
              inputSchema: compiled.contract.inputSchema,
              outputSchema: compiled.contract.outputSchema,
              form: {
                valid: form.issues.length === 0,
                issues: form.issues.map((issue) => ({ path: issue.path, reason: issue.reason })),
              },
              // what could be read is offered for binding; the parameters
              // are named either way, which is the point
              bindableFields: form.bindableFields.map((field) => ({
                fieldId: field.fieldId,
                payloadKey: field.payloadKey,
                schema: field.schema,
                always: field.always,
              })),
            }
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  return {
    listItems,
    createItem,
    getItem,
    getRecognitionContract,
    updateItem,
    deleteItem,
    setItemStatus,
    listScoreGroups,
    replaceScoreGroups,
    previewScoring,
    checkItem,
  }
}
