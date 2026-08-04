# Effect 迁移阶段性总结(截至 2026-08-05)

> 分支 `refactor/effect-platform`(已推 origin),基线 tag `p1-capability-boundary`,23 个 commit。
> 验收状态:`pnpm typecheck` 零错误,`pnpm test` **47 文件 324 例全过**,`pnpm build` 通过,真进程实跑正常。
>
> 本文只讲**已完成什么、要点是什么**。设计与实测细节在 docs/effect-migration.md,裁决在 docs/adr/0001-0003,
> 逐会话进度在 STATUS.md。

## 1. 进度总览

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M0 / M0.5 | 依赖栈、effect 与 drizzle 源码 vendoring、agent 指令剥离 | `e4ca3d5` |
| M1a | 数据库切片实测 | `3f2fac8` `076bfea` |
| M1b | HTTP 切片实测 | `13c8016` |
| — | Effect LSP 进 tsc,并用会失败的 fixture 守住 patch 还在 | `3d3f7a1` |
| M2 | 应用外壳(健康探针、配置、组合根、优雅关闭) | `b989041` |
| — | cookie 会话 + middleware,**ADR 0003 放行条件全部满足** | `603f7ad` |
| M3 | `@qualy/api` 包边界 + ping 迁 HttpApi + 类型化 client | `4cacac6` |
| M4 前置 | 拓扑分层装配、环的说法纠错、插件孤立编译门禁、事务实测 | `cb11091` `58ff9c2` `ab95aa1` `85b6f9b` `9fd2d03` `fb4bf88` |
| M4 CUT 1 | 权限目录改为装配期聚合 | `90e66e0` |
| M4 CUT 2/3 | 端口包:`rbac-contract/effect` + 新建 `@qualy/auth-contract` | `6fb2217` |
| M4 CUT 5 | UiAuthorizer 改必需服务 | `3755442` |
| M4 审计整改 | 见第 8 节:4 个 P0 + 架构门禁 | `13a1b93` `08217f0` `7d7152b` `1d788aa` |
| **M4 剩余** | rbac / auth / org 三个 Effect layer、API group | **未开始** |
| M5 / M6 / M7 | 其余插件、前端切换、原子切换删 cordis 与 oRPC | 未开始 |

**M4 的定位**:只**增加** Effect 路径,不删 cordis 任何东西。PermissionRegistry、oRPC router、
`server.enrich` 全部活到 M7。两套运行时并存期间,权限目录已经改为**两边读同一份 entry 模块**。

## 2. 已确立的机制(每条都实测过)

### 2.1 插件不认识聚合体(M3)

`HttpApiBuilder.group` 要整个 api,而 api 是从每个插件生成的 —— 直译就是每个插件依赖那个从它自己生成出来的包。
读源码解决:group 的**运行时 key 只含标识符**,而返回类型**带 api id**。所以插件拿一个只装自己那一个 group 的
本地 api 去实现,共享 `QUALY_API_ID` 让类型也对上。

**先跑过再采信**:类型过了不等于聚合体找得到 handler,专门起真 server 验证过两个不同 `HttpApi` 实例上实现的
group 能被第三个一起服务。这条约束随后自己证明了价值 —— health 的 handler 建在 `HttpApi.make('health')` 下,
接进来时**编译期就报了**。

### 2.2 事务是环境,不是参数(M4 前置)

上游把连接放进 fiber context,drizzle 直接委派。实测一个不收 handle、只要 `Database` 的 peer:
看得见调用方未提交的写入、跑在同一个 backend pid、调用方失败时一起回滚、自己开事务拿到的是 savepoint,
以及**调用方写入后被 peer 的不变量拒绝时那条写入不留下**(这条才是 handle 参数存在的理由)。

**结论**:`RbacDbHandle` 可以整个删掉,「持锁时另开连接死锁」从纪律变成结构上不可能。
**载重前提**:一个进程只能有一个 PgClient(事务 key 按 client 实例生成)。

### 2.3 `Layer.mergeAll` 不接线(M4 前置)

它并行构建成员、**不满足成员之间的依赖**。生成的运行时装配已改为按 `qualy.runtime.dependsOn`
拓扑分层 + `provideMerge`,缺依赖指名报错、成环连路径一起拒绝。

### 2.4 权限目录从推改拉(M4 CUT 1)

插件从自己的构造器往 rbac 推权限码,静态图表达不了:rbac 要建在所有贡献方**之后**才完整,又要建在他们**之前**
回答授权调用 —— 这才是这一簇里唯一的真环。改为生成器按清单聚合,rbac 拿到成品,不再是任何人的下游。

**必须用活跃集,且必须忽略 `--all`**:seed 那份故意含 disabled(行要留着),目录含了就等于停用的插件继续授权;
而 `--all` 经同一个 argv 到达所有生成器、`pnpm build` 又会传它。两个方向都有测试。

### 2.5 端口包:tag 是值(M4 CUT 2/3)

cordis 下 `ctx.rbac` 靠 `declare module` 的类型增强,零值导入。**Effect 的 service tag 是值**,
`yield* Rbac` 会逼 org 值导入 `@qualy/plugin-rbac`,而 rbac 又值导入 org 的 schema —— **那才是真的 ESM 环**。
tag 放进零插件依赖的契约包,实现留在插件里。

`Rbac` 放 `./effect` 子路径而非包根:根会经 oRPC 契约链走到浏览器(实测打包后 grep 过,`effect` 没进 chunk)。

`@qualy/auth-contract` 只装 org 唯一那次调用,**不带任何数据库类型**(现签名把 auth 自己的 drizzle 事务泄过边界)。

### 2.6 UiAuthorizer 必需而非默认(M4 CUT 5)

最自然的译法是 `Context.Reference` + 拒绝一切的默认值,**看起来**安全。不是:Reference 从 requirements 通道
抹除,所以接线错误永远抓不到 —— 少了提供方照样构建、启动,然后给每个已登录用户只显示公开页面,
**没有报错、没有类型失败、没有测试变红**。fail-closed 和坏掉长得一模一样。

改成必需服务后需求活到入口点,没接就编译不过。测试只在那一行压掉两条诊断,而把需求满足后**两个压制都会变成
unused** —— 证明烂不成同义反复。刻意不要授权走显式的 `denyAll` layer。

## 3. 沿途修掉的真问题

| 问题 | 性质 | commit |
| --- | --- | --- |
| org 调 `ctx.auth.iam.*` 却零导入 auth,单独编译直接报错(ping、auth-local 同病) | 类型只在「有同伴」时存在,tag 化后无法忠实迁移 | `ab95aa1` |
| 迁移计划里「org ↔ rbac 已成环」是错的 | 照着不存在的问题做设计 | `58ff9c2` |
| 生成的运行时装配用 `mergeAll`,M4 一定编译不过 | 潜在,尚未触发 | `cb11091` |
| CLAUDE.md 把 `scopeCoverage(scope, alias)` 写成 `anchorCoverage(anchors, alias)` | 签名差异有实质影响(`tenantWide` 只在 scope 上) | `90e66e0` |

新增门禁 `scripts/tests/plugin-isolation.test.ts`:逐插件单独编译,反向验过去掉导入即红。

## 4. 我自己犯过并纠正的判断

记下来是因为它们都属于「看起来已经验证过、其实没有」这一类:

- **「根部再 provide 会把资源建两遍」** —— 猜错。Effect 按 layer 引用 memoize,实测 `builds = 1`。
  真后果是需求冒到根部变成**离肇因很远的类型错误**,不是两个连接池。
- **pid 相等在池只有一条连接时是白给的** —— 补了一例断言池确实发得出多条,否则整个 2.2 是空转。
- **一个名字撒谎的测试** —— 名为「OpenAPI 文档」实际重测 401。重写后立刻发现:不需要认证的 endpoint
  拿到的是 `security: []`,不是没有这个键。
- **`@ts-expect-error` 压不住 Effect LSP 的诊断**,它是另一条通道;而且第一版因为
  `@effect/platform-node` 解析不到、表达式成了 `any`,directive 变 unused —— **等于什么都没证明**。
- **四次把 `Context.Service` 写成 `Effect.Service`**(v4 不存在),每次都被 LSP 当场拦下 ——
  这正是 docs/agents/effect-source-policy.md 存在的理由。

## 5. 被否掉的方案(不要重启)

- **`R` 标成 `SqlClient.TransactionConnection`** 来让「必须在调用方事务里」变成编译期约束:
  **比现状更糟**。类型上的 Identifier 是稳定接口、运行时 key 却带 client id,任何 client 的事务都满足类型,
  而查错 client 会**静默回落到新连接** —— 一个看起来被证明过的 fail-open。
- **合并 auth/rbac/org 为一个 layer**:服务图本来就无环,合并会毁掉 rbac 只依赖 db 的 headless 可部署性;
  且 `Layer.effectContext` 让「以后再合」很便宜,「以后再拆」不便宜。
- **application coordinator 承载跨域不变量**:把不变量搬出它必须待的那个事务,会把「读预测而非终态」的 bug 放回来。
- **全局 service locator** 绕过 Layer 图(迁移文档原本就禁止,继续禁止)。

边缘方向改用**方法级 R 通道**兜底:`changeNodeType: (input) => Effect<Node, E, Rbac | Placement>`,
layer 只要 `Database`。真出现反向边时改一个包的签名即可。

## 6. 待办与已知风险

**M4 剩余**:rbac(图的根)、auth、org 三个 Effect layer 与 API group。`changeNodeType` **先行** ——
它是唯一在同一把锁里同时用到三个插件的方法,回归会表现为**连接池死锁**而不是错误答案,是最响的失败方式。

**原先列在这里的两处已在审计整改中修掉**(见第 8 节):可选 actor 的 fail-open 形状、
跨插件约束名的无人校验耦合。两者都补了会红的门禁,不再是待办。

**其他已知**:

- `auth/client/UserGrants.tsx` 越过插件图直接调 rbac 的 HTTP 接口,rbac 缺席时用户详情页**静默**少一块面板。
- 清单 config → layer config 的贯通仍在 M5(现在只有一个带 config 的插件,样本不够)。
- `@effect/vitest` 在 Vitest browser mode 下能否用,**M6 之前必须确认**(上游无证据)。
- 租户行锁有三份手写副本(auth / org / rbac),尚未漂移,是最可能的下一个漂移点。

## 8. 外部审计整改(2026-08-05)

一轮外部评审提了 4 个 P0 和若干 P1。**逐条实查后 4 个 P0 全部属实**,已修;P1 部分改为记录触发条件。

### 8.1 `--all` 会把停用插件放进服务端路由图(P0,已修)

`pnpm build` 跑 `gen.ts --all`,而 `gen-api.ts` 跟随该 flag —— 停用插件的 handler 照样生成,它的依赖
(Database)还在,**它的接口会被真的服务**。我自己的测试还断言了这个行为,比没有测试更糟。

根因是我在 M3 抄了 gen-contracts 的语义没想清楚:`--all` 对**客户端契约与 web 包**是「超集」,代价是几 KB
不可达代码;对服务端它就是**路由图本身**。现在 gen-api 与 gen-permissions 都固定用活跃集并**忽略 `--all`**,
另有一例断言四个服务端产物在 `--all` 前后**逐字节相同**。

### 8.2 Effect 侧丢了 `/api` 外部前缀,且把 health 塞进了 openapi(P0,已修)

冻结路径的真实外部地址是 `/api/ping/hello`(cordis server 的 `prefix` 默认 `/api`),而我把聚合体挂在了根上;
同时 health 被并进 servedApi,于是探针进了生成文档——CLAUDE.md 明确要求它**在前缀之外、不进 openapi**。

**这里有个坑值得记住**:`HttpApiBuilder.layer` 的路由来自 **group layer**(用插件的本地 api 建的),
而文档来自**聚合体**。所以只给一边加前缀,会让**文档移了、路由没移**,类型系统完全看不见。
现在两边都加,并有一例遍历文档里每条路径去 fetch,404 即失败——把插件的前缀去掉会立刻红。

### 8.3 授权 actor 可选是 fail-open 形状(P0,已修)

`actor?` / `as?` 在 auth、org、rbac 共 14 个方法上可选,锁内检查以 `if (!actor) return` 开头 ——
**漏传参数 = 跳过授权**。生产调用点无一遗漏,但 66 处测试依赖它,等于「授权为了测试省事才可跳过」。

改法不是导出一个谁都能构造的 SystemPrincipal:**可信是一个值,且生产拿不到它** ——
唯一构造点在 `@qualy/rbac-contract/testkit`,而「生产代码禁止 import testkit」早有门禁。
识别用全局 symbol(跨包实例),判定函数正常导出(**检查不是构造**)。
另加门禁扫可选 actor 与裸 `return` 跳过;它第一次跑就误报了一处——ui-registry 给匿名访客
`return { permissions: none }` 是**拒绝**不是跳过,于是把规则收窄到裸 return。

### 8.4 Effect 启动路径没有装配校验(P0,已修)

cordis 入口一直会拒绝清单/lock/条目表漂移的启动,Effect 入口**什么都不查**。现在走同一个
`verifyAssembly`,并扩展到 Effect 读的那个生成模块。手改生成文件后 frozen 启动会拒绝(实测)。

### 8.5 顺带补的三条架构门禁

- **一个进程只能有一个 PgClient**:ambient transaction 全靠它,而事务 key 按 client 实例生成,
  第二个 client 会静默把死锁放回来,**编译器两个方向都看不见**。
- **`Effect.run*` 只许在边界**:service/repo/handler 自己跑 effect 会丢掉调用方的 fiber,
  连带丢掉 ambient transaction、中断与错误通道。
- **翻译的约束名必须是 lineage 真造出来的**:org 写死了 auth 与 rbac 拥有的三个 FK 名,
  改名只会让领域错误静默退化成裸 500。以**迁移 SQL** 为准而非 schema 源码(没迁移的名字生产上照样不存在)。

三条都用「故意破坏」验过会红。

### 8.6 记录触发条件、暂不建的三项

见 docs/effect-migration.md「审计后的裁决」:database 保持可选能力(但如实写明当前组合根要求它)、
运行时依赖维持写具体插件 id、最小装配编译门禁等 M4 三个 layer 落地后再补(现在闭包等于全集,测不出东西)。

## 9. 仓库状态

- `refactor/effect-platform` 已推 origin 并设好 upstream。
- **本地 `main` 比 `origin/main` 领先 5 个 commit**(装配阶段的工作),迁移分支包含全部这 5 个,内容没丢,
  但 `origin/main` 停在能力边界重构之前。
- **tag `p1-capability-boundary` 只在本地**,而 CLAUDE.md 把它写作本次迁移的基线 —— 换机器或重新 clone 找不到。
