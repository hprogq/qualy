import type { MessageCatalog } from '@qualy/i18n-contract'

export default {
  'assessment/error/batch-not-found': '未找到该测评批次。',
  'assessment/error/phase-not-found': '该批次中不存在这个阶段。',
  'assessment/error/template-not-found': '未找到该阶段模板。',
  'assessment/error/template-conflict': '已存在同名的阶段模板。',
  'assessment/error/batch-read-only': '该批次已归档，不能再修改。',
  'assessment/error/batch-status-invalid': '批次当前状态不允许这样切换。',
  'assessment/error/batch-no-user-types': '激活批次前请先选择至少一个用户类型。',
  'assessment/error/batch-reference-invalid': '所选组织范围或用户类型不存在。',
  'assessment/error/plan-invalid': '阶段计划修改被拒绝，请检查列出的问题。',
  'assessment/error/advance-invalid': '不能这样切换阶段。',
} satisfies MessageCatalog
