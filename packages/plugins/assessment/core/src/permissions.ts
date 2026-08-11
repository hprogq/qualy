// The assessment domain's permission catalog, and beside it the phase gate's
// own registry of which of these codes a phase profile may open.
//
// PHASE_GATED lives here rather than on PermissionDefinition on purpose:
// "which codes are gated" is a property of the gate, not of the permission
// (rbac stays untouched). Every member is a code this plugin declares, so a
// global code can never appear in a phase editor - asserted below at import
// time, which is boot and resolve alike.
import type { PermissionDefinition } from '@qualy/rbac-contract'

export const permissions = [
  {
    code: 'assessment.batch.manage',
    name: '管理测评批次',
    description: '批次、阶段、题目与花名册的全生命周期管理',
    target: 'org-node',
  },
  {
    code: 'assessment.batch.force-advance',
    name: '强制切换阶段',
    description: '跳过守卫条件切换批次阶段，必须填写理由',
    target: 'org-node',
  },
  {
    code: 'assessment.publication.manage',
    name: '管理成绩公示',
    description: '公示全生命周期，含预告、发布与撤回',
    target: 'org-node',
  },
  {
    code: 'assessment.result.view-self',
    name: '查看本人成绩',
    target: 'tenant',
  },
  {
    code: 'assessment.entry.create',
    name: '新增申报条目',
    target: 'tenant',
  },
  {
    code: 'assessment.entry.edit',
    name: '编辑申报条目',
    target: 'tenant',
  },
  {
    code: 'assessment.entry.submit',
    name: '提交申报条目',
    target: 'tenant',
  },
  {
    code: 'assessment.entry.withdraw',
    name: '撤回申报条目',
    target: 'tenant',
  },
  {
    code: 'assessment.entry.proxy',
    name: '代录申报材料',
    description: '替学生提交其本可自行提交的漏报材料，走完整审核链',
    target: 'org-node',
  },
  {
    code: 'assessment.entry.record',
    name: '录入行政认定',
    description: '录入组织权威认定的扣分与特殊加分，直接生效不走审核',
    target: 'org-node',
  },
  {
    code: 'assessment.entry.resubmit',
    name: '对终态条目发起复议',
    description: '在开放窗口内对已有终局结果的条目发起新一轮审核',
    target: 'tenant',
  },
  {
    code: 'assessment.review.process',
    name: '处理审核任务',
    target: 'org-node',
  },
  {
    code: 'assessment.review.reopen',
    name: '发起工作组复查',
    description: '对已定结果直达链条终点的主动复查',
    target: 'org-node',
  },
  {
    code: 'assessment.result.view-peers',
    name: '查看他人公示成绩',
    target: 'tenant',
  },
  {
    code: 'assessment.ranking.view',
    name: '查看排名',
    target: 'tenant',
  },
] as const satisfies readonly PermissionDefinition[]

/**
 * The codes a phase's permission profile can open or withhold, in the order
 * the phase editor lists them.
 *
 * Anything outside this set passes the gate unconditionally; anything inside
 * it fails closed when absent from the current profile. A tuple rather than a
 * bare set because the editor's label map is keyed by it: a code added here
 * without a translation stops compiling.
 */
/**
 * What being on the roster is worth.
 *
 * A participant's capabilities come from membership, not from rows: five
 * hundred students times five permissions is two and a half thousand records
 * saying the same thing, and the roster already says it once.
 */
export const PARTICIPANT_CODES = [
  'assessment.entry.create',
  'assessment.entry.edit',
  'assessment.entry.submit',
  'assessment.entry.withdraw',
  'assessment.result.view-self',
] as const

/**
 * What a batch copies out of the tenant's authority when it is created.
 *
 * The work staff do inside a round, and only that. Administering the batch
 * itself (`assessment.batch.manage`, forcing a boundary) deliberately stays
 * live tenant authority: it is the capability that decides who may edit this
 * very list, and freezing it at creation would leave an administrator
 * appointed afterwards unable to touch rounds that already exist.
 */
export const STAFF_CODES = [
  'assessment.entry.proxy',
  'assessment.entry.record',
  'assessment.entry.resubmit',
  'assessment.review.process',
  'assessment.review.reopen',
  'assessment.result.view-peers',
  'assessment.ranking.view',
  'assessment.publication.manage',
] as const

export const PHASE_GATED_CODES = [
  'assessment.entry.create',
  'assessment.entry.edit',
  'assessment.entry.submit',
  'assessment.entry.withdraw',
  'assessment.entry.proxy',
  'assessment.entry.record',
  'assessment.entry.resubmit',
  'assessment.review.process',
  'assessment.review.reopen',
  'assessment.result.view-peers',
  'assessment.ranking.view',
] as const

export type PhaseGatedCode = (typeof PHASE_GATED_CODES)[number]

export const PHASE_GATED: ReadonlySet<string> = new Set(PHASE_GATED_CODES)

const declared = new Set<string>(permissions.map((definition) => definition.code))
for (const code of [...PARTICIPANT_CODES, ...STAFF_CODES]) {
  if (!declared.has(code)) {
    throw new Error(`assessment: ${code} is not a declared permission`)
  }
}
for (const code of PHASE_GATED) {
  if (!declared.has(code)) {
    throw new Error(`PHASE_GATED lists '${code}', which @qualy/plugin-assessment does not declare`)
  }
}
