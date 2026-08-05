# MikroORM + Kysely 纵向验证:阶段 B 中期结果

分支 `spike/mikroorm-kysely`,连真实 PostgreSQL(不是 PGlite,不是内存桩)。
上游依据:`repos/mikro-orm` @ v7.1.10,commit `3066827`。

**目前结论:三类查询全部通过,但迁移系统四问尚未验证,因此还不能给 Go/No-Go。**

---

## 一、跑了什么

14 个用例全绿:7 个连库的纵向切片 + 7 个编译期否定实验。
schema 用的是**产品committed lineage**(经 `@qualy/plugin-database/testkit` 应用),
不是为 MikroORM 另建的表——所以复合租户外键、`ltree` 路径、部分唯一索引都是真的。

### A 类:普通类型化查询

`listTypes`、`countTypes`。两件事得到确认:

- **手写 Row 接口消失了**。`select(['id','code','name','sortOrder'])` 的返回类型即是行类型,
  且 `sortOrder` 按属性名回来(实体元数据实查:`sortOrder→sort_order`,camelCase 自动映射)。
- **`string_to_array` 变通不再需要**。当前 drizzle 版写的是
  `id = any(string_to_array(${typeIds.join(',')}, ',')::uuid[])`;Kysely 编译出的是
  `"id" in ($2, $3)` 带正确参数(已打印 SQL 核对)。

### B 类:PostgreSQL 特有查询

`readSubtree`(ltree `<@`)、`incompatibleChildTypes`(反连接 + NOT EXISTS)。

**这是最有价值的一条:raw SQL 从「整条查询」缩到「一个谓词」。**
整个查询层里只剩 1 处 `sql<boolean>\`path <@ ${path}::ltree\``——表名、列名、join、
返回列、排序全部是 builder 的。`NOT EXISTS` 子查询完全builder 化,不需要任何 raw。

这正是裁决里说的判据:「如果迁完后仍是 `sql\`完整的 40 行查询\``,只是执行器从 Drizzle 换成
Kysely,那么切换价值会显著下降」。**没有发生。**

### C 类:跨插件写事务

`changeNodeType` 的三条路径,全部实测:

| 场景 | 结果 |
| --- | --- |
| 写入后 peer 拒绝 | 抛错,**另一条连接读到的仍是旧值**——回滚成立 |
| 全部 peer 同意 | 提交,另一条连接读到新值 |
| 事务内自读 vs `em.fork()` | 事务内看得见自己未提交的写;fork 出来的看不见 |

第三条是整个移植的基础:peer 在事务内被调用时读到调用方的未提交状态,而任何别的连接读不到。
`em.fork().getKysely()` 确实跳出事务(与源码
`SqlEntityManager.ts:106-125` 读 `getTransactionContext()` 一致)。

### 否定实验:类型系统真正拒绝什么

7 个片段各自**真编译**一次(独立 tsconfig + 真实实体),要求失败:

| 片段 | 结果 |
| --- | --- |
| 正对照:正确查询 | **编译通过**(否则整个 harness 无意义) |
| 列名拼错 `sortOrderr` | 拒绝 |
| 表名拼错 `OrgTypes` | 拒绝 |
| **select 没选却读该字段** | 拒绝 |
| join alias 写错 | 拒绝 |
| uuid 列 `= 42` | 拒绝 |
| update 写入不存在的列 | 拒绝 |

第三条是当前写法**看不见**的那类:从 select 列表里删掉一列,所有读它的地方仍然对着手写的
Row 接口编译通过,运行时才变成 undefined。

---

## 二、一个必须记下的坑

**实体类型不会自己传到 Kysely,断了也不报错。**

第一版我写的是 `MikroORM.init({ entities: entities as never })` 加 `kyselyOf(em: EntityManager)`。
两处都把类型掐断了,而失败方式是**静默的**:`getKysely()` 经
`EntitiesFromManager<this>` 读 `em['~entities']`(`SqlEntityManager.ts:241`),拿不到就退化成
`never`,于是**每一个表名都不合法**,报错指向调用点而不是 wiring。

正确做法:`init` 的 `Entities` 泛型必须一路保留到 `orm.em`(它的类型是
`EM & { '~entities'?: Entities }`,`MikroORM.ts:107`),`kyselyOf` 写成
`<T extends Em>(em: T)`。实体数组必须是 `as const` 元组,widening 成 `EntitySchema[]` 同样会
erase。上游 `discovery:export` 命令生成的就是这个。

**结论:真要迁,这份 wiring 得由装配层生成,不能靠人手写对。**

---

## 三、数字

同一批查询(listTypes / countTypes / incompatibleChildTypes / readSubtree):

| 指标 | 当前 Drizzle | spike Kysely |
| --- | ---: | ---: |
| 这四个查询的行数 | 33 | 约 55 |
| 其中完整 raw SQL 查询数 | 4 | 0 |
| 局部 raw 表达式 | 0 | 1(`<@` 谓词) |

全仓库现状(作为迁移总量的基线):

| 指标 | 数量 |
| --- | ---: |
| `sql\`\`` 片段 | 108 |
| 查询层行数(auth 591 + rbac 652 + org 252) | 1,495 |
| 手写 Row/Record 接口 | 8 |
| **`rows<Row>()` 断言函数的重复副本** | **9** |
| `as unknown as` | 3 |

行数**变多**(33 → 55)是诚实的结果:builder 比字符串啰嗦。换来的是那 4 条查询从
「TypeScript 完全不检查」变成「拼错任何一处都编译失败」。
那 9 份重复的 `rows<Row>()` 是同一个函数被抄了九遍,迁移后整类消失。

---

## 四、尚未验证(不能据此下结论的部分)

裁决要求的迁移系统四问,**一个都还没做**:

1. 多插件聚合 `defineEntity`;
2. disabled/detached 实体仍进 migration metadata(`safe: true` 只兜住「不 DROP」,
   不解决「按 retained order 聚合」);
3. 从当前 schema 生成的 DDL 与现有目标 schema 是否等价;
4. `ltree` extension 能否作为 pre-schema fragment 参与 clean-room migration。

另外未测:typecheck 耗时、冷启动耗时、迁移 diff 等价性、全量测试通过率对比。

**第 3 条是最可能否决整条路线的**——现有 lineage 有 195 条约束、57 个索引、
复合租户外键与部分唯一索引,MikroORM 的 schema generator 能否原样表达,是没验证过的。
