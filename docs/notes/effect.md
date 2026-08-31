# effect(v4 beta)实查笔记

## Schema 对多余对象键的行为(2026-08-31,rc.111)

`Schema.decodeUnknownEffect(schema)(value, options)` 的 `ParseOptions.onExcessProperty`
默认 `"ignore"`(未声明的键**静默剥除**),`"error"` 才失败,另有 `"preserve"`。
依据:repos/effect/packages/effect/src/SchemaAST.ts:445(文档)与 :484(类型),
:2229-2243(实现:仅当 `"error"`/`"preserve"` 时逐键比对 index)。

因此任何「未知键必须 fail closed」的持久化 envelope(如 ScoringPlan V2 的
persistedPlanShapeV2)必须显式传 `{ onExcessProperty: 'error' }`,不能依赖默认行为。
该 option 作用于整棵 decode 树的每个 TypeLiteral;`Schema.Unknown` 位置(config、
schema 体)不做对象结构解析,不受影响——恰好实现「envelope 严格、owner 语言自治」。
仓库先例:database/web/storage 的 config loader 已用 `onExcessProperty: 'error'`。
