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

**处理**(已裁决):在依赖边界修,不让 5300 行业务查询为它长期付代价。

`patches/@mikro-orm__sql@7.1.10.patch` 把两处「值等于 `true`」改成「属性存在」:

```diff
- : TOptions extends { default: true }
+ : TOptions extends { default: unknown }
-   : TOptions extends { defaultRaw: true }
+   : TOptions extends { defaultRaw: unknown }
```

`unknown` 的语义正是「不关心默认值是什么,只要求这个必填属性在」——没有 `default` 键的类型
不满足 `{ default: unknown }`(目标里该属性是必填),所以无默认值的列照旧必填。

被否掉的三个候选与原因:

1. **在 `kyselyOf` 上做类型重标**——等于在应用层复制一份 MikroORM 的实体→Kysely 推导,
   且只能靠列名或项目约定猜哪些是数据库生成的。猜错的方向是**类型认为可省略、元数据其实没有
   默认值**:编译通过,运行时 NOT NULL。而且要长期跟随上游内部类型漂移。
2. **每条 insert 应用侧生成 ID**——为一个类型 bug 改掉全项目写入模式;UUIDv7 实现与数据库的
   可能不一致、应用时间与数据库时间语义不同、上游修好后还要清理、忘写某个默认字段的可能性
   重新出现。
3. **等上游**——当前 master 未修,等待期间临时代码会先扩散到大量 `.values()` 里。

**门禁**:`packages/plugins/infra/database/tests/kysely-types.test.ts` 是纯类型测试
(`declare const em`,函数从不调用,断言由 `pnpm typecheck` 做)。patch 一旦没生效,
它立刻编译失败——已实测:把已解析的那份 `typings.d.ts` 改回 `true`,typecheck 立刻红。
这一点很重要,因为 pnpm 的 `prepare` 在部分安装下可能被跳过(effect LSP patch 踩过同样的坑)。

上游 issue 草稿:`docs/upstream/mikro-orm-1-kysely-generated-columns.md`。**上游发布修复后
删除 patch**。

## 查询必须走 `query()`,不能裸 `Effect.promise`

`translateConstraints` 是从**错误通道**catch 的(`Effect.catch`),而 `Effect.promise` 把拒绝
变成 defect —— 两者不在同一个通道上。所以 Kysely 查询若写成 `Effect.promise(() => …execute())`,
约束翻译**永远不会触发**,一个被 restrict 外键挡住的删除会答 500 而不是 409,且调用点看不出问题。

`@qualy/plugin-database/server` 因此导出 `query(() => …)`(内部是 `Effect.tryPromise`,
失败包成 `QueryFailed`,驱动错误挂在 `cause` 上,正是 `constraintOf` 已经会走的位置)。
由 orm.test.ts 的「a refused write」一条钉住:把 `query` 换回 `Effect.promise` 立刻红。

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
