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

## 空 Struct 对多余键不报错(2026-09-17,rc.115)

`Schema.decodeUnknownEffect(Schema.Struct({}))(value, { onExcessProperty: 'error' })` 对
`{ migrationsFolder: 'x' }` **Success**;同一 option 下 `Schema.Struct({ a: Schema.optional(Schema.String) })`
才 Failure(node -e 实查)。多余键的比对只在 TypeLiteral 的 `fallback` parser 里做
(repos/effect/packages/effect/src/SchemaAST.ts:2905-2925,`onExcessPropertyError` 分支),
一个没有任何 property/index signature 的 TypeLiteral 走的不是这条路,于是「任意对象」都通过。

后果:`decodePluginConfig(Schema.Struct({}), block)` 不能表达「这个插件不读任何清单配置」——
它会把整块静默放行,正是该 helper 要防的失败。database 插件的 `server/config.ts` 因此在 decode 之后
自己检查 `Object.keys(block)` 非空即拒绝并指路。其他想声明「零配置」的插件照此办理,不要依赖空 Struct。
