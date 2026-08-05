# MikroORM + Kysely 纵向验证:阶段 B 中期结果

分支 `spike/mikroorm-kysely`,连真实 PostgreSQL(不是 PGlite,不是内存桩)。
上游依据:`repos/mikro-orm` @ v7.1.10,commit `3066827`。

**结论:24 个用例全绿。Go 已确认,org 四张表的 schema parity 已实测通过。**

---

## 一、跑了什么

24 个用例全绿:7 个连库的纵向切片、7 个编译期否定实验、3 个双库对照、6 个 schema 生成、1 个整库 parity。
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

## 二之二、双库对照:同一个错误,两边各给一次机会

单边测「Kysely 拒绝什么」证明不了交换的价值——被替换的那个可能也拒绝。所以每个错误在**两种
写法里各编译一次**,对着同一批真实表(org 的 drizzle schema 与同库导出的实体)。

案例取自一篇对比这三个库的讨论(thetutlage/meta#8)点名的 drizzle 盲区:

| 错误 | Drizzle 编译期 | Kysely 编译期 |
| --- | --- | --- |
| 选了一个**没 join 的表**的列 | **通过** | 拒绝 |
| join 条件引用**不在查询里的表** | **通过** | 拒绝 |
| 列名拼错(控制组) | 拒绝 | 拒绝 |

控制组是必须的:如果两边都"拒绝一切",上面两行说的就是这个测试文件而不是这两个库。

**实测修正了那篇文章的论断。** 第一条我实际构建了查询,drizzle v1 **在运行时是有检查的**:

```
Error: Your "typeName" field references a column "org_types"."name",
       but the table "org_types" is not part of the query! Did you forget to join it?
```

消息清晰、指名道姓。所以真实差异是**发现时机**(编译期 vs 运行时),不是「被挡住 vs 悄悄出错」。
这比文章的说法弱。仍然是真实差异:运行时检查只在测试真正走到那条路径时才触发,而编译期检查
是无条件的——本仓库 1,495 行查询层里,有多少条路径被测试执行过,是个没人回答过的问题。

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

## 四、迁移系统四问:全部实测

裁决要求的四问,答案都来自生成的 DDL,不是文档。

### 1. 多插件聚合 `defineEntity` —— 成立

实体集合就是数组拼接,metadata 忠实反映传入的集合。没有隐藏的发现机制。

### 2. disabled/detached 仍进 metadata —— **控制权留在 Qualy**

MikroORM 不理解「插件被停用」,**也不需要理解**:它 diff 的 schema 就是被交给它的那个集合。
所以现有规则原封不动地活下来——database capability 交出的是 **retained order**
(active + disabled + detached)而不是 active 集。实测:传 retained 集,detached 插件的表在 DDL 里;
传 active 集,那张表直接消失——在 diff 型生成器下,那就是数据被 DROP 的路径。

这与现在 `schemaEntries()` 按 `state.order` 读 retained 集是同构的,不是新机制。

### 3. DDL 等价 —— **全部可表达**,包括最担心的那条

| 结构 | 现有数量 | MikroORM 能否生成 |
| --- | ---: | --- |
| check 约束 | 30 | 可,表达式原样保留 |
| 部分唯一索引 | 8 | 可(`where code is not null`) |
| **租户作用域复合外键** | 19 | **可**,且**约束名可指定** |
| 数据库侧默认值 | 11 | 可(`default uuidv7()`) |
| ltree 列 / GiST 索引 | — | 可 |

约束名可指定这一条是决定性的:pg 错误按**约束名**翻译成域错误,而
`scripts/tests/constraint-names.test.ts` 拿翻译表里的名字去比对 lineage。名字若由 ORM 自动生成
(`org_nodes_tenant_id_org_type_id_foreign`),那 30 处翻译与这道门禁一起报废。实测
`.foreignKeyName('fk_org_nodes_org_type')` 生成的正是原名。

### 4. ltree extension —— **仍然需要 baselineDir,而且它原样可用**

生成的 DDL 有 `"path" ltree not null`,**没有** `create extension ltree`。换 ORM 不改变这一点。
好消息是 `baselineDir` 机制与 ORM 无关:它把纯 SQL 片段编进 lineage,从来不关心结构 SQL 是谁生成的。

---

## 五、必须记下的两个陷阱

**一、`persist(false)` 会静默删掉外键。** 把一个 FK 关系标成「这列由别处管理」——对一个列已经
以普通属性存在的外键来说,这是最自然的建模方式——生成的 DDL 里**一条 foreign key 都没有**。
租户隔离就这么没了,没有任何警告。已固化为测试。

**二、实体类型不会自己传到 Kysely,断了也不报错**(见第二节)。

两个都是同一类问题:**失败是静默的,而且看起来像正确的写法**。

---

## 六、建议:Go,附三个条件

三类查询全部通过,四问全部可表达,没有发现否决项。建议切换,但以下三条必须同时接受:

1. **实体与 Kysely 的 wiring 由装配层生成,不手写。** 类型链断掉不报错、外键静默消失,
   这两个陷阱都不该靠人记得避开。现在 `schemaEntries()` 生成 drizzle 聚合的位置,
   改成生成 entities 元组 + 每插件的本地类型视图。
2. **约束名全部显式指定。** 30 处约束翻译和 constraint-names 门禁依赖它们。
3. **clean-room parity 测试先于迁移改造。** 现在那份(`clean-room-parity.test.ts`)比较的是
   「从插件重建的 lineage」与「committed lineage」的 129 列/195 约束/57 索引/80 函数触发器。
   迁移期间它必须一直绿,否则等于在没有对照的情况下换数据层。

**行数会变多**(实测这批查询 33 → 55 行)。换来的是那 4 条查询从「TypeScript 完全不检查」
变成「拼错任何一处都编译失败」,以及 9 份重复的 `rows<Row>()` 断言函数整类消失。

---

## 七、org 四张表的整库 parity:**通过**

Go 之后做的第一件事,因为它是迁移前风险最高的一项。

方法与主线那道 clean-room 门禁相同:建两个库,一个跑 committed lineage,另一个把 org 四张表
drop 掉、纯从实体声明重建,然后逐对象比较。

| 类别 | 结果 |
| --- | --- |
| 列(名/类型/可空/默认) | 完全一致 |
| 约束(23 条) | 完全一致 |
| 索引 | 完全一致 |

**全部 check 约束连 PostgreSQL 回写的类型转换与括号都逐字节相同**,例如
`CHECK (((code IS NULL) OR ((code)::text ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text)))`。
四个部分唯一索引、GiST 索引、租户作用域复合外键(含 org_nodes 的自引用)全部一致。

唯一一处差异是**复合主键的名字**:lineage 叫 `pk_org_type_rules`,MikroORM 按
`<table>_pkey` 生成。改 schema 去迁就 ORM 是一次「查询看不到任何变化」的迁移,且在两半不一致的
窗口里会破坏错误翻译,所以反过来:用 `NamingStrategy.indexName(..., 'primary')` 把既有名字教给
生成器。这也说明**命名策略是这次迁移必须先写的东西之一**,和第 2 个条件同源。

### 仍未测

typecheck 耗时、冷启动耗时,以及**另外 12 张表的 parity**(auth 6 张、rbac 6 张)。
org 是最复杂的一组(ltree、自引用复合外键、四个部分索引),方法论已经验证;剩下的是重复劳动,
但**必须逐张做完**才能开始改生产代码——否则就是在没有对照的情况下换数据层,正是第 3 个条件禁止的。
