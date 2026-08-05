# @mikro-orm 实查记录

版本以 `pnpm-workspace.yaml` catalog 为准(当前 7.1.10),源码在 `repos/mikro-orm/`。

## `defaultRaw()` 的列在 Kysely 里不是 Generated,插入时必须显式给值

**结论**:`p.uuid().primary().defaultRaw('uuidv7()')` 声明的列,在 `em.getKysely()` 的
`insertInto(...).values(...)` 里**仍然是必填**。`p.datetime().defaultRaw('now()')` 同理。

**证据**(两处对不上):

- `repos/mikro-orm/packages/core/src/entity/defineEntity.ts:139`
  `defaultRaw(defaultRaw: string): PropertyChain<Value, Options & { defaultRaw: string }>`
  —— 记的是 `{ defaultRaw: string }`。
- `repos/mikro-orm/packages/sql/src/typings.ts:461`
  `TOptions extends { defaultRaw: true } ? Generated<TValue> : ...`
  —— 判的是字面量 `true`。

`{ defaultRaw: string }` 永远不满足 `{ defaultRaw: true }`,所以这条分支**从不命中**。
判断本意显然是「这个选项在不在」,却写成了值比较。

同一函数里 `default` 分支(:459)判 `{ default: true }`,而 `.default(v)` 的实现签名记录的是
具体值类型,所以 `.default(raw('uuidv7()'))` 记成 `{ default: RawQueryFragment<string> & symbol }`,
**同样不命中**(实测,不是推断)。也就是说声明层面绕不过去。

`defineEntity.ts:501` 自己写着「Since v4 you should use defaultRaw for SQL functions. e.g. now()」
—— 文档推荐的写法正是不被映射的那个。

**影响面**:本项目每张表的主键都是 `uuidv7()`,时间戳都是 `now()`,所以**每一条 insert** 都受影响。
这与 CLAUDE.md「主键统一 UUIDv7 且数据库侧生成……兜住 psql/ETL 等一切裸写入路径」的意图冲突:
DDL 默认值仍在(灾备与裸写入路径不受影响),但应用侧被类型逼着自己造 ID。

**当前处理**:database 插件的两个 wiring 测试里显式传 `id`,并就地注明原因。**正式 repo 改写前需要
裁决**,候选:

1. 在 `kyselyOf` 的返回类型上做一次类型级重标(把库内约定的「数据库填充列」还原成 `Generated`);
2. 每条 insert 显式传 ID(应用侧生成 UUIDv7,DDL 默认值只作裸写入兜底);
3. 上游修掉之后再动(需要能接受在此之前维持 1 或 2)。

## Kysely 的 pg 错误**不包装**

`em.getKysely()` 抛出的就是 pg 的 `DatabaseError` 本体:`code`、`constraint` 直接在顶层,
`cause` 为空。drizzle 是包一层挂 `cause`,所以 `unwrapPgError` 两种形状都能处理,不需要改。
由 `packages/plugins/infra/database/tests/orm.test.ts` 钉住 —— 上游哪天开始包装,
每个被翻译的约束都会悄悄退化成不透明 500。

## 事务:`getKysely()` 跟随 EM 的事务上下文

`repos/mikro-orm/packages/sql/src/SqlEntityManager.ts:96-104` 明说:事务内的 EM 上
`getKysely()` 走该事务,`em.fork().getKysely()` 走池连接。
`begin/commit/rollback`(`core/src/EntityManager.ts:1701/1716/1736`)把事务绑在 EM 实例上。

因此 `transaction()` 用 `Effect.provideService` 把这个 EM 放进 Effect context,
`entityManager()` 优先取它 —— 跨插件的 peer **不需要接收任何句柄**就落在同一事务上,
与 drizzle 把连接放进 fiber 是同一性质。由
`packages/plugins/infra/database/tests/transaction.test.ts` 钉住(四条,每条都实测能红)。

## Entity Generator 的三个缺陷(spike 期实查,未上报)

见 `spike/mikroorm-kysely` 分支的 `experiments/mikroorm/FINDINGS.md`:
`getEntityDeclaration()` 从不检查 references;`DatabaseTable.ts:299` 的预筛丢掉 `index.where`
而 `:355` 的 `isTrivial` 又把它算进去;`:764` 的 `Array.from(propBaseNames)` 丢索引列顺序。
本次迁移全部手写实体,不依赖该生成器,所以只记录不处理。
