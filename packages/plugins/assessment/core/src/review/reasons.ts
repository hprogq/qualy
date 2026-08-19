/**
 * The review reasons a fresh batch starts with.
 *
 * Copied onto the batch at creation - a starting point, not a live
 * reference: from that moment the lists belong to the batch, its
 * administrators add and remove freely, and later changes to these
 * defaults reach only batches created later. The chosen label is copied
 * again onto each review event, so no edit anywhere rewrites what a
 * reviewer already said.
 *
 * Business data, not interface copy: these strings live in the batch's
 * configuration the same way a batch name does, in the product's operating
 * language, and an administrator edits them as text. That is why they are
 * not i18n messages.
 *
 * Both lists end in an open reason on purpose: the server refuses any
 * label outside the configured list, and a fixed list without a way out
 * corners the reviewer whose case none of the presets fit.
 */
export const DEFAULT_REVIEW_REASONS: {
  readonly reject: readonly string[]
  readonly escalate: readonly string[]
} = {
  reject: [
    '申报信息不完整',
    '证明材料无法清晰辨识',
    '申报内容与证明材料不一致',
    '现有材料不足以支持申报内容',
    '不符合本项认定条件',
    '相关时间不在有效范围内',
    '与已有申报重复',
    '其他原因',
  ],
  escalate: ['材料真实性存疑', '认定标准存在争议', '超出当前审核范围', '其他原因'],
}
