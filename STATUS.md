# STATUS

阶段:**P1 基座迁移**(入场基线 tag p1-base,基线修复后 tag p1-ready,2026-08-02;P0 收官 tag v0.1.0-p0)

## 已完成

- [s1] 仓库奠基:git init(main);骨架文件就位;pnpm i 零报错;PG18+pgvector 容器 healthy 且 psql 连通;提交 4997321
- [s2] cordis 启动闭环:`pnpm dev`(bin.js + include 读 cordis.yml)装载 TS 冒烟插件 @qualy/plugin-ping;官方 @cordisjs/plugin-logger-console 输出日志;hmr 粒度重载可用(高风险项通过,未动用 tsup 退路);根 typecheck 门禁建立(TS 6.0.3);三视角复核 14 条发现已裁决(4 条现改、7 条修入教程/手册、不采纳 2 条、1 条推迟到 s7)

- [s3] 生成器基建 + database 插件:scripts/lib(read-entries 组展平+--all+漏装警告、codegen banner+write-if-changed)与 gen-schema 落地;@qualy/plugin-database(drizzle v1,Service.init 异步初始化+fail-fast,withRelations 视图工厂);ping 补 /schema(snakeCase.table,uuidv7 DB 默认主键)与 inject 门控;首个命名迁移建表并实测

- [s4] server 插件 + oRPC v2 接入:@qualy/plugin-server(OpenAPIHandler + CORSHandlerPlugin + onError 拦截;Service.init 绑定端口,disposal 等端口真释放;contribute/rebuild 全 effect,ns 冲突抛错);开场四条探针实录 notes/orpc-v2.md;HTTP 404 链路通

- [s5] ping 后端全链路:契约先行(oc.meta(openapi) GET /ping/hello)→ implement.$context<ApiContext> → contribute('ping');gen-contracts 生成器(exports["./contract"] 声明式发现,导出名约定 <ns>Contract)入 gen 管线;api-client(OpenAPILink@/fetch + createORPCClient + 类型标注);会话 4 收尾修令四条同批落地(server 请求兜底/db:reset/卷注释/vector 迁移备忘)

- [s6] ui-registry + manifest:@qualy/plugin-ui-registry(Service 'ui',static inject ['server'],addPage 全 effect + path 冲突抛错 + 确定性排序,RBAC 过滤留 P1 钩子);ping inject 'ui' 并 addPage(/ping,PingPage,admin,nav)
- [s7] web-runtime + 前端壳:@qualy/web-runtime(Provider/useApi/useManifest/Slot,react 为 peerDependency 防双实例);ping /client(thunk 表 + PingPage);gen-plugins 生成器;apps/web(vite 8 + react 19 + react-router 8,manifest 驱动路由,/api 代理);tsconfig 四程序分治(root node + web-runtime + ping/client + apps/web),typecheck 链式;check-chunks 树摇哨兵(头注注明依赖默认 [name]-[hash] 命名);契约 ns 定案改为按契约模块导出名派生(<ns>Contract,连字符包名陷阱实锤)

- [s8+收官令] P0 合卷:A 组修 CI(typecheck 前置 gen)、gen.ts 单入口(argv 共享根治 --all 只达链尾)、check-chunks/typecheck 声明化(根脚本零插件名)、**宿主拥有插件**(依赖与 cordis.yml 归位 packages/app,hoist 桥接实验失败后走结构正解;聚合方声明输入 + 生成器硬失败校验;hmr base 回锚修复 watcher 全盲);B 组 8 个 vitest(生命周期集成×3、PGlite PG18.3 迁移重放、生成器确定性×2、不变式、类型活性)+ 八项总验收归档 docs/reports/P0-REPORT.md + tag v0.1.0-p0;C 组角色表与两纪律入 CLAUDE、TanStack Query 接入(web-runtime 自持 manifest 生命周期,错误态可重试,@orpc/tanstack-query 同族锁定)

- [plugin-web 定案] 前端交付插件化(2026-08-02):server 增单槽 Connect 风格 fallback(effect 托管,/api 前缀内永不触发,next()→404、next(err)→日志+500)+ httpServer/port 暴露;新建 @qualy/plugin-web(mode auto 按 NODE_ENV 分流:development 挂 Vite middlewareMode 到宿主 server 共端口,production 用 sirv 服务 staged 产物;启用即必须可服务,缺产物/缺 vite 启动硬失败);apps/web 改名 @qualy/web-app 留守组合根,产物经 stage-web-assets 归插件 client-dist/(gitignored);独立 dev:web 与 /api 代理删除,dev 单进程。修复两坑:traceable 代理下服务可变槽重赋值不粘(fallback 撤销失效,改稳定容器盒,入 notes/cordis.md);sirv setHeaders 收请求路径致 html 壳误带 immutable(改无扩展名判定)

- [P1 入场收口] 基线冻结与三修复(2026-08-02):①装配清单更名 `apps/server/qualy.yml`(审计确认文件名在 cordis 库中零特殊化,仅弃用的 bin.js 有默认值;代码引用 main.ts/read-entries/plugin-add/codegen banner/两测试全量切换,归档文档与上游手册不动);②终端日志归一——db:migrate 换自研静音脚本(drizzle-orm migrate() 程序化调用,与 kit 台账实测兼容;注意 v1 必须 `drizzle({client})`,裸 `drizzle(pool)` 会被当 config 自建无凭据连接),vite 日志经 customLogger 走 `ctx.logger('vite')`;③web 壳补 index 重定向(首个 nav 项)与 404 页,根路径不再空白;④CI 增 `pnpm build` + staged assets 存在检查 + check-chunks 树摇门禁;⑤p1-tutorial.md 与 p1-migration-audit.md 入库(审计表已按真实旧仓校对路径),CLAUDE 切到 P1;⑥旧代码克隆 legacy/(gitignored,vitest 排除):qualy_old + algryth(RBAC 参考);⑦当前 HEAD 全量验收重跑并补记 P0-REPORT,打不可变基线 tag `p1-base`

- [P1 入场评审修复] 三项基线问题(2026-08-02,评审后、p1-ready):①CI no-op generate 改 `git status --porcelain`(git diff 漏 untracked 迁移目录);drop-guard 增 `--all` 全史扫描并入 CI(main push 上 `--base-ref origin/main` 差异为空、实际扫 0 文件;已批准的 destructive 迁移永远带 `-- destructive: approved` 标记,全扫恒干净);②packages/app 依赖自持:include/logger-console/timer 入 dependencies、hmr 入 devDependencies,根包剪掉全部 cordis 运行时依赖(根 dependencies 仅剩 tsx);③main.ts 清单路径 import.meta.url 锚定 + QUALY_CONFIG 外部清单覆盖(异 cwd 启动实证)。**重要实查**(loader rc.5 解析矩阵,见 notes/cordis.md):internal 路径按清单目录解析宿主依赖(monorepo 内启动必须 --expose-internals);无 internal 回退从 loader 包位置 plain import,pnpm 隔离下宿主直属依赖不可见——剪枝后静默零装载、退出码 0(实锤);外部清单路径只在独立部署扁平布局可用,生产清单不含 hmr

- [CI 竞态修复] generators 测试隔离(2026-08-02):CI 上 invariants 测试撞 YAML 重复键——根因是 generators 测试原地改写真实 qualy.yml(afterAll 恢复),vitest 测试文件并行,慢机器上 invariants 在 ping 带 disabled 的窗口读到清单再插一行成重复键(本地快、从未复现)。修法:read-entries 增 `--yml <path>` 注入(与 --all 同型),generators 的 disabled 用例改临时清单副本,仓库清单全程只读;教训并入注入化纪律——**测试禁止改写仓库跟踪文件**

- [P1 会话 1] 基座插件骨架与请求上下文(2026-08-02):server 的 ApiContext 扩展为 { cordis, request, response, principal? }(AuthPrincipal = tenantId/userId/sessionId),新增 ContextEnricher 多槽注册表(`server.enrich(key, fn)`:Map 稳定容器 + effect 托管,key 冲突抛错,仅 API 请求且每请求串行执行,fiber dispose 即撤销);请求流重构为 insideApi 提前分流(enricher 与 oRPC 只在 /api 前缀内运行,静态资源不跑)。四基座插件骨架 packages/plugins/base/{rbac,auth,org,dict}(具名导出 + 空 schema + schemaEntry 声明 + infra inject ['db','server','ui'],不含业务),`pnpm plugin:add` 装配;argon2 0.45.1 / cookie 2.0.1 入 catalog(会话 3 用,暂无包引用不安装);CLAUDE 增租户纪律。**实查**:logger 首启竞态入 notes/cordis.md——无 inject 的插件 apply 即时执行,日志早于 logger-console 激活即丢弃(fiber 实为 ACTIVE 零错误,勿误判装载失败);声明真实 inject 后日志自然归位

- [类型盲区修复] 插件 tests 纳入类型门禁(2026-08-02):IDE 报 server.test 传 `{ port: 0 }` 缺 prefix 而 `pnpm typecheck` 不报——根因一:根 tsconfig include 只有各包 src,插件 tests/ 不在任何 tsc 程序里(vitest 不查类型);根因二:cordis 的 `GetPluginConfig` 从构造器/apply 参数推调用方 config 类型,参数标 `z.infer`(输出型)会逼调用方传全量。修法:include 补 `packages/*/tests` 与 `packages/plugins/*/*/tests`;server/database/web/ping 的 Config 参数统一改 `z.input` + 体内 cast `z.output`(cordis 先校验再调用,运行时恒为解析后输出),双面约定入 CLAUDE

- [工具链审计裁决] 迁移下沉 + 自动 codegen(2026-08-02):外部审计建议按冻结元规则过滤,三档裁决入 notes/tooling.md。**采纳**:①迁移执行下沉 database 插件——`runMigrations()` 归 `@qualy/plugin-database/migrator`(零 cordis 依赖),Service.init 按 `migrations: apply|off` 执行已提交迁移(依赖 db 的插件迁移完成后才激活;migrate 幂等,hmr 重跑仅台账检查数十 ms,不做 once-guard);`pnpm db:migrate` 改为同一实现的薄适配器(经 hostRequire 解析,根包不依赖插件);dev 脚本去掉前置 db:migrate。②codegen 自动化——dev/typecheck/test 前置 gen(build 原有),plugin:add 收尾自动 regen,CI 独立 gen 步骤删除。**缓建**(触发条件入 tooling.md + 回顾表):@qualy/tooling 包/CodegenRegistry/qualy bin/Vite adapter/gen watcher/verify mode/插件自带 migration。**永久禁令**:应用进程禁 drizzle-kit generate 与写 .gen.ts、codegen 不进 cordis core、不按 active 集合动删库对象

- [迁移生命周期加固] 复审四项修复(2026-08-02):①migrationsFolder 相对路径改按装配清单目录(ctx.baseUrl)解析,qualy.yml 显式声明 `../../db/migrations`——此前按 cwd 解析实际回退了 import.meta.url 锚定的 cwd 无关启动保证;②init 失败(迁移目录缺失/SQL 失败/探活失败)时 disposer 尚未登记,补 try/catch 关闭 Pool 再抛;③appliedCount 只吞 3F000/42P01(缺 schema/缺表),迁移成功后的复数不再容错;④off 模式打印明确日志(区分「无待迁移」与「未检查」)。新增真 PG 生命周期集成测试(lifecycle.test.ts:apply 建表门控 + 重载幂等 + off 不建表 + 坏目录失败且 pg_stat_activity 零连接;PG 不可达自动跳过),CI 增 pgvector:pg18-bookworm service(与 compose 同镜像)。「幂等」表述限定为单实例串行(rc4 无 advisory lock,多副本走 off + 迁移 Job)

- [P1 会话 2] 租户与组织树 schema(2026-08-02):@qualy/plugin-org 落地四表(tenants/org_types/org_type_rules/org_nodes),租户边界由数据库自证——(tenant_id, id) 复合唯一 + 复合外键(parent restrict/type restrict/rules cascade),跨租户引用 23503 直接拒绝;ltree 自定义类型(src/db/ltree.ts,不经 schema entry 导出)+ path 标签 = uuid 去连字符(沿用旧仓方案,会话 5 repo 复用)。**对旧版的修正**(不照搬):①GiST 改声明式——drizzle v1 kit 原生支持 `.using('gist')`,custom 迁移只装 extension(教程「GiST 走 custom」方案废弃);②补 code 稳定标识(org_types 必填、org_nodes 可空 + partial unique),seed 纪律「稳定 code 查找」的前提;③同父同名唯一改两个分区索引(parent NOT NULL / IS NULL 各一),堵住旧版 NULLS DISTINCT 下根节点同名漏洞;④砍冗余索引(旧 idx_org_nodes_parent 是 parent_sort 前缀、depth 索引与 rules 的 tenant_parent 索引无消费查询)。检查约束(slug/code 格式、not blank、非负、parent 非自身)保留——裸写入路径防线。迁移:20260801222248_org-ltree(custom,严格 CREATE EXTENSION)+ 20260801222256_org-base(命名生成);PGlite 重放测试接 contrib/ltree 扩展照常通过。seed 落 scripts/seed.ts + `pnpm seed`(去教程的 p1 阶段标记):默认租户 + 四类型 + 三规则 + 四层示例树,全部稳定 code 幂等 upsert,双跑第二次零创建

- [会话 2 复审修复] 六项裁决(2026-08-02):①org 包补 `drizzle-orm` 依赖(此前靠根包侥幸解析,包边界破洞);②补 `(tenant_id, org_type_id)` 索引(复合 FK 引用侧,fix-forward 迁移 org-node-type-index)——上会话砍索引砍过头;③**删除语义实证推翻担忧**:PG18 的 RI 检查是语句级 AFTER 触发器(看语句终态),现有 RESTRICT 下 tenant CASCADE 完整兑现、整树单语句删除可行,而删在用类型/删有子节点的行级保护照常 23001——无需改 FK 动作,探针固化为 deletion-semantics 测试;④seed 升级为「insert-if-absent + 漂移校验」:org 类型校验 name/sort_order,org 节点只校验拓扑与类型结构(parent/type/depth/path)——名称与排序是业务可编辑字段,不入漂移检查;不符即抛 seed drift 中止(事务内,零部分写入);⑤seed 核心下沉 scripts/lib/seed.ts,新增 seed.test.ts(临时库双跑断言 1/4/3/4→全零 + 四级路径 + 漂移注入拒绝);⑥CI 增 QUALY_REQUIRE_POSTGRES_TESTS=1——service 在位时集成测试不可达即失败,不再静默跳过(本地无 PG 仍跳过);PGlite 测试标题纠正。会话 3 注意:seed 的 create-only 语义不适用于凭据(管理员密码是否随环境变量重置需显式裁决)

- [seed 语义边界] core/demo 拆层(2026-08-02,进会话 3 前):同一 seed 此前混装两类收敛语义——系统启动数据(租户/类型/规则,会话 3 将加 provider/管理员)必须严格校验,而样例组织树是业务数据,合法移动/改名不得阻断 core seed。现在 `seedCore` 恒严格;`seedDemoOrg` 仅在 `QUALY_SEED_DEMO=1` 显式要求(此时严格校验)或目标租户组织为空(首次引导)时执行,默认对已有组织数据直接 skip。seed 测试改为三例:空库全建(demo created)→ 二跑收敛(demo skipped)→ 移动节点后普通 seed 照常通过(核心不被业务漂移阻断)+ 显式 demo 模式对漂移拒绝。cascade 测试补有效 rule 并断言四表零残留。会话 3 裁决预留:管理员密码属操作性输入,QUALY_ADMIN_PASSWORD 的存在时语义(校验/忽略/重置)开场定案

- [org schema 拆层] 表文件下沉(2026-08-02,进会话 3 前):插件级 schema 所有权不动(四插件各持 ./schema 入口),org 内部拆为 db/tables/{tenants,org-types,org-type-rules,org-nodes}.ts + 共享 code-pattern.ts;schema.ts 变纯具名再导出入口(拒绝 export *,防辅助物泄入表导出集)。定义逐字搬移,`drizzle-kit generate` no-op 且 db/migrations 零 diff 实证纯重排。relations 裁决:RQB v2 基础设施已备(withRelations/WeakMap 缓存),业务关系图**按查询需求落地**——会话 3 在 validateSession/getCurrentUser 前建 auth/src/db/relations.ts(顶层单例导出,defineRelations 覆盖跨插件 org 表与复合键关系,先对 rc.4 类型探针),不预建全系统关系大图,不建全局 relations 注册表;auth 四表从一开始采用同款多文件布局

- [P1 会话 3] 用户类型、本地认证与 Session(2026-08-02,修订版教程):**载体选型定案 Cookie + 不透明 token(库存 sha256),不用 JWT/localStorage**(论证:同源单进程部署无跨域需求;logout/禁用即失效是硬指标而纯 JWT 做不到;HttpOnly 免疫 XSS 窃取;SameSite=Lax 覆盖 CSRF 主面;全文 notes/auth-security.md)。org 前置补丁:tenants.enabled/expires_at + 单根 partial unique(fix-forward 迁移 org-tenant-state-single-root)。auth 五表(user_types/users/auth_providers/user_identities/sessions,tables/ 布局,复合租户 FK,business_no 分区唯一,迁移 auth-base);authRelations 单例(user→tenant/userType/primaryOrgNode 复合键,session→user)。**实查两坑**:①beta.21 的 ORPCError status 选项与契约 errors 的 status 在 HTTP 层均被忽略,状态由 handler 的 errorStatusMap 按 code 映射——server.contribute 增第三参 errorStatuses(与路由片段同 effect 生命周期,同码不同值冲突抛错),auth 注册 INVALID_CREDENTIALS/AUTH_REQUIRED/SESSION_EXPIRED→401;②cookie 2.x 导出改名 parseCookie/stringifySetCookie。Argon2id 参数显式(m=64MiB,t=3,p=4;本机 hash 36ms/verify 31ms);登录名 ASCII 规范化(trim+lowercase);未知用户走 dummy hash 拉平时序;登录失败统一 INVALID_CREDENTIALS。enricher:无效/过期 Cookie 清 Cookie 后匿名继续,过期额外置 sessionExpired(me 区分 SESSION_EXPIRED);session 校验链 = session→user.enabled→userType.enabled→tenant enabled/expires,过期即删行。seed 四层重构:provision(create-if-absent + 稳定语义校验[provider type/system flags],业务展示字段永不回写)、demo 显式 QUALY_SEED_DEMO=1(纯 create-if-absent,含 student/faculty 类型与示例账号,密码需 QUALY_DEMO_PASSWORD)、管理员密码 created/unchanged/reset 三态(重置需显式 QUALY_RESET_ADMIN_PASSWORD=1)。LoginPage(blank 布局,成功后整页刷新重取 me+manifest)+ web 壳 blank 路由。**过程事故**:盘上残留旧 spec auth 表卷进 org 补丁迁移(未提交、仅本地库),删除重做两段式生成——教训:generate 前确认 schema 全集处于目标状态

- [P1 会话 3.5] 认证 Provider 插件化(2026-08-02):按「协议族=驱动插件,实例=数据行」拆分——@qualy/plugin-auth 收缩为 Service 基座(session 核心 + provider type registry + resolveProvider/findIdentity/completeLogin + GET /auth/methods),@qualy/plugin-auth-local 为首个驱动(Argon2id/规范化/时序拉平/`POST /auth/local/{providerCode}/login`/LocalLoginPage);URL 定案 `/auth/<type>/<code>/<op>`(code 而非数据库 UUID,fix-forward 迁移 auth-provider-route-codes 加 code/type 格式 check 与 sort_order;kit 对新增 check 需 --hints 显式 create,实查);同租户多实例成立(测试:local-primary/local-secondary 同 identifier 异密码互不通过、CAS 行走 local 路由被拒、驱动停用后 methods 即时消失而数据保留);修复 revokeSession 为 tenant+user 作用域删除;入口页 /login 改 methods 驱动(credentials→驱动页,redirect→start URL);登录方式列表 fail closed(驱动 active 才返回)。seed 哈希经 @qualy/plugin-auth-local/password 解析。旧 /auth/local/login 无兼容别名(无外部消费者)

- [P1 会话 3.6] 前端收口(2026-08-02):①**组件命名空间**——client components key 定为显式 `<plugin>/<Component>`(gen-plugins 生成期动态 import client 读 key 集,越界/缺名硬失败;check-chunks 按 basename 匹配 chunk);②**Tailwind v4 + shadcn 形态基础**——三层所有权:apps/web 持唯一编译入口(@tailwindcss/vite + 单一 app.css),新共享包 @qualy/ui 持组件源码(cn/Button/Input/Label/Card/Alert + oklch 主题变量,shadcn 风格手写最小集,CLI/components.json 等批量加组件时再接),插件只 import @qualy/ui 不装 Tailwind;**实查**:@source 的 `*/*/client` glob 扫不到插件目录,改整树 `@source packages/plugins`(超集语义与 schema 聚合一致,build 探针证 max-w-sm 等插件独有 class 进 CSS,全量 13.95 kB);root tsconfig 排除 packages/ui,typecheck 链加 ui 程序;③**登录改单页 Shell + 驱动 Renderer**——LoginMethod 契约改判别联合(mode: component/redirect),驱动 registerProviderType 提供 describe()(core 不再拼驱动路由),redirect href 强制同源相对路径(违规 warn+跳过,测试钉住);/login 唯一登录页,?method=<code> 是页面状态(前进后退/刷新/直链天然工作),LoginPage 走 TanStack Query(loading/error+重试/empty/ready 四态分离),renderer 缺失 fail closed;④auth-local 从「贡献页面」改「贡献嵌入式 renderer」(auth-local/LoginMethod,props={method,onAuthenticated}),删 /login/local 页面与 ui inject。web-runtime 增 useComponent,ComponentRegistry 放宽为异构 props。裁决:不启用通用 Slot(单组件按 key 渲染用 useComponent 即够,多贡献者 widget 场景出现再建);lucide/separator 等无消费者组件不进 @qualy/ui

- [3.6 复审修复] 展示模型收口(2026-08-02):①删除 @qualy/plugin-auth 残留的 `./password` 死导出(文件已迁 auth-local),新增仓库不变式测试 package-exports.test(遍历 workspace 全部 exports 的本地目标验存在,防「合法声明、无效目标」);②同源 redirect 校验改 URL 解析(哨兵 origin 归一化)——旧前缀判断可被 `/\evil.example` 反斜杠绕过(浏览器把反斜杠规范化为斜杠),矩阵测试钉住 https:///`//`/反斜杠三类逃逸与合法带 query 目标(旧实现下反斜杠用例会放行);未强制 /api/auth/ 前缀(server prefix 可配,避免耦合);③LoginMethodRendererProps 收紧为 Extract<LoginMethod,{mode:component}> 并由 auth contract 公开导出,凭据型驱动复用。缓办记录:returnTo 随 protected-route redirect 实现(防开放重定向同套 sameOriginPath);describe() 异常隔离随 auth-cas 的 config 校验落地

- [P1 会话 3.7] UI Composition Runtime(2026-08-02):按七概念模型完成改造(全案 notes/ui-composition.md)。①新共享包 @qualy/ui-contract:命名空间 ID 正则、Layout Contract 常量(admin-shell/v1、blank-shell/v1)、defineUiCollection/defineUiSlot token 原语、admin-shell 表面定义(navigation-primary、header-actions);②ui-registry 重写为组合内核:PageDecl 增必填 id(逻辑标识与 path/component 解耦),registerLayout(单 Provider/契约,冲突硬失败),contribute(token, contribution)统一收集 Collection/Slot(ID 冲突/cardinality 硬失败,effect 托管,无加载顺序语义),manifest 变授权后投影(layouts/pages/collections/slots,permission/public 不出服务端,导航 pageId→path build 期解析、页面消失项脱落,无 Provider 布局的页面丢弃并告警);③新 @qualy/plugin-layout-default:AdminShell(消费导航 collection + header-actions slot + NavLink 高亮)与 BlankShell;④apps/web 收缩为纯路由引擎(layouts×pages 动态生成路由,LayoutBoundary/渲染器缺失 fail closed),AdminLayout/导航 DOM 从宿主移除;⑤web-runtime 增 useUiCollection/UiSlot(逐项 ErrorBoundary+Suspense 隔离);⑥Slot 首个真实消费者:auth 贡献 auth/UserMenu 到 header-actions(登录态显示用户名+退出,匿名显示登录入口)——此前系统无任何登出 UI。缓建带触发表:多 Provider/Theme 注册/页面级 Slot/config schema/bootstrap 插件(会话 7)/ui:validate

- [3.7 小修] 登录链路打磨(2026-08-02):①UserMenu 登录按钮改 react-router Link(SPA 内导航,不再整页重载进登录页);②server 的 onError 只记录 5xx 级真故障——已定义客户端错误(AUTH_REQUIRED/INVALID_CREDENTIALS 等按 errorStatusMap <500 的码)是正常业务流,不再刷整页堆栈(冒烟:匿名 me×2 + 错误登录均 401 且日志零 [E] 行)

- [3.7 软导航收口] 硬跳转清零与加载态统一(2026-08-02):全项目硬跳转审计后仅保留一处**刻意的**跨文档导航(redirect 型登录方式跳驱动 302 端点,注释注明);登录成功与退出改软导航——`queryClient.invalidateQueries()`(me/manifest 一并失效,为会话 7 RBAC 过滤后的 manifest 变化预留正确语义)+ react-router navigate。@qualy/ui 增 spinner(Spinner/LoadingScreen/PageLoading),替换全部裸文本加载态:RuntimeLoader isPending 从 null(白屏)改全屏居中 spinner、失败态样式化重试;宿主 renderPage/LayoutBoundary、登录页 methods 与 renderer fallback 均居中 spinner

- [P1 会话 4] RBAC、用户类型权限与角色资格(2026-08-02):rbac 七表落地(permissions 平台级 code 全局唯一+点分格式 check+「grantToUserType→必须 tenant scope」DB 级不变式;其余六表全租户复合 FK;迁移 rbac-base)。**关键裁决**(不照搬处):①auth 运行时 inject 'rbac' 但不加包依赖(类型走 root 程序全局声明合并,避免 auth↔rbac 包循环——rbac 单向依赖 auth/org schema);②definePermissions 双层——同步内存 active registry(effect 托管,双活同 code 冲突硬失败)+ 异步串行 DB 镜像队列(syncBox 稳定盒防 traceable 重赋值坑;稳定语义=scope+双 grant 通道,漂移→响亮报错+移出 active 集 fail closed,展示字段与 defaultTenantAdmin 可更新;whenSynced() 供等待);③**权限目录单源**破解 bootstrap 死结——各插件导出纯常量 ./permissions(org 的会话 5 才接 definePermissions),runtime registry 与 seed 共用同一常量,seed 得以在插件首次启动前 upsert rows 并绑定租户授权。授权核心:require(tenant scope,user-type∪tenant-role 并集,r.kind='tenant' 防御过滤)/canAt(org scope,ltree `path <@` self/subtree)/getProfile(manifest 用,active 过滤)/错 scope=程序错误抛非 403;无任何 bypass,tenant-admin 走真实 role_permissions(defaultTenantAdmin 幂等注入,registry 与 seed 双写同语义)。assignment 资格(4.8,管理 API 会话 6 消费):createAssignment 事务校验(同租户/enabled/assignable/tenant 角色仅 root+subtree/org 角色 allowed user+org types)+removeAssignment last-admin 保护(最后有效租户管理员不可移除)。seed:provision 层 +permissions 11/tenant-admin/defaultTenantAdmin 全映射/administrator portal 授权/admin root-subtree assignment;demo 层 +org-manager(资格约束+六权限)/student+faculty portal/manager college-subtree assignment

## 验收输出摘录

- s2 启动:`[I] hmr watching [ '.' ]` + `[I] ping ping plugin loaded: 你好P0`
- s2 hmr:改 ping 源码保存 → `[I] hmr reload plugin at packages/plugins/demo/ping/src/index.ts` → 插件体重新执行,进程不重启,心跳定时器无重复(effect 清理干净)
- s2 yml 热应用:改 greeting 保存 → 运行中进程打出新问候;loader 写回 yml 补 id 字段(预期行为)
- s2 校验:greeting: 123 → `[E] include ValidationError: invalid config: Invalid input: expected string, received number (at greeting)`;旧实例存活,改回后自动恢复
- s2 类型门禁:`pnpm typecheck` → 零错误
- s3 生成:`pnpm gen` → db/schema.gen.ts(banner+re-export);再跑输出 "unchanged, skipped"
- s3 迁移:`pnpm db:generate --name ping-logs` → `20260727175710_ping-logs/migration.sql`(v1 目录结构);`pnpm db:migrate` → applied;`\d ping_logs` → id uuid 默认 uuidv7()、created_at timestamptz(snakeCase 映射实证)
- s3 uuidv7:裸 SQL insert 返回 `019fa4b9-80c7-7467-...`(版本位 7,DDL 兜底路径实证)
- s3 门控联动:ping 装载被 db 的 Service.init(含 select 1 探活)门控;yml 停用 database → ping 回卷;恢复 → 01:58:33 ping 自动重载
- s3 类型门禁:`pnpm typecheck` → 零错误

- s4 启动:`[I] server http server listening on :3000` → database connected → ping loaded
- s4 链路:`curl -i localhost:3000/api/anything` → `HTTP/1.1 404 Not Found`(空 fragments,链路通)
- s4 hmr 端口安全:改 server 源码 → `hmr reload` → `http server closed` → `http server listening on :3000` → curl 仍 404,无 EADDRINUSE(disposal await close 实证)
- s4 实查:CORS 插件 v2 名为 CORSHandlerPlugin(v1 的 CORSPlugin 已亡);onError 在 @orpc/server 根;OpenAPIHandler 泛型 Router<ApiContext>;四条探针全文 notes/orpc-v2.md
- s4 类型门禁:`pnpm typecheck` → 零错误
- s5 (a):`curl --get .../api/ping/hello --data-urlencode name=毕设` → `{"msg":"hello, 毕设"}`(裸 UTF-8 不编码会 400,属客户端编码责任)
- s5 (b):ping_logs 计数随请求递增,中文值落库
- s5 (c):api-client 类型化客户端 `c.ping.hello({name:'client'})` → `{ msg: 'hello, client' }`
- s5 (d):yml 停用 ping → 同 curl 404(贡献点 effect 摘除,零重建热生效);恢复 → 200 + ping 重载日志
- s5 关键实测:rc.7 服务访问受 inject 声明约束(cannot get property without inject),handler 必须闭包自插件 ctx;OpenAPILink 在 /fetch 子路径;RouterContractClient/JsonifiedClient 是纯类型导出(值探针盲区);弃用需 meta.path 印章的 client factory;sed -i 换 inode 会弄丢 yml watcher(脚本改 yml 用 python 原地重写)
- s5 类型门禁:`pnpm typecheck` → 零错误;类型活性验收(@ts-expect-error 错误调用)入 vitest
- s6 manifest:`curl /api/ui/manifest` → pages 含 /ping(PingPage/admin/public)+ nav Ping(order 10)
- s6 停用双重消失:yml 停用 ping → manifest 空 + /ping/hello 404(effect disposal 实证);恢复经重启路径回全(yml watcher 写回后失效怪癖二次复现,已归档 notes/hmr.md,勿会话中途深挖)
- s7 构建:`pnpm build` → `dist/assets/PingPage-*.js 0.26 kB` 独立 chunk;`node scripts/check-chunks.mjs` → present
- s7 树摇负测:停用 ping → build 产物无 PingPage chunk(check-chunks exit 1),index 体积同步减小;恢复 regen 正常
- s7 冒烟:vite dev 起壳(title Qualy),`localhost:5173/api/ui/manifest` 经代理返回 pages ['/ping'];浏览器人工走查留给人
- s7 类型门禁:四程序链(root/web-runtime/ping-client/apps-web)全绿
- plugin-web 测试:`pnpm test` → 11/11 通过(新增 fallback 槽生命周期 + 生产态 spa/缓存头/硬失败三断言组)
- plugin-web dev 冒烟:`pnpm dev` 单进程 → `curl :3000/` 返回 vite 注入 react-refresh 的 HTML,`/api/ui/manifest` 正常,`/api/nope` 404
- plugin-web 生产冒烟:`pnpm build`(gen --all → web-app build → staging)后 NODE_ENV=production 启动 → `/` no-cache、`/ping` 200(spa 回退)、哈希资源 `public,max-age=31536000,immutable`
- plugin-web 类型门禁:`pnpm typecheck` → 零错误(tc: 0)
- [P1 会话 4.2 补修] 授权读取钉死完整稳定语义(2026-08-03,评审必修一笔):此前授权 SQL 按**行当前的**通道 flag 过滤,防御不对称——true→false 即时失效(正确),false→true 却会即时扩权(行翻转后查询条件与触发器读的都是新值)。修法:所有查询以 active definition 为真源,`pinned(def)` 片段钉死 owner/scope/双通道/defaultTenantAdmin 五字段,且 def 声明关闭的通道直接不开查询分支(SQL 侧 `(${def.grantToUserType} and exists...)` 布尔参数门控);getProfile 改为 SQL 报告双通道原始可达性+稳定字段,判定在 registry 侧完成;registry 的 defaultTenantAdmin 映射写入同样重新钉行(封验证与写映射之间的变化窗口)。带外翻转自此只可能收窄授权。测试补双向:关闭的 user-type 通道翻开+utp 写入成功但 hasPermission/require/getProfile 全拒(恢复后合法授权回归),关闭的 role 通道翻开+rp 写入成功同样全拒(CATALOG 增 test.usertype.only)。缓建接受:registration degraded 状态、server errorStatuses 拷贝/范围校验/common map 冲突参检、server 文件拆分——随下次 server 真实改动处理
- 会话 4.2 补修验收:typecheck 零错误;vitest 69/69(rbac 18 组三连跑无 flake);dev 冒烟真实登录 200 + 认证后 me/manifest 200(pinned 语义与 seed 行全兼容)+ 日志零 [E]
- 会话 4.2 验收:typecheck 零错误;vitest 68/68(rbac 17 组:pre-sync 窗口 FORBIDDEN + owner 劫持读取失效 + 双实例竞争恰一 active + whenSynced 不被后续成功掩盖且 dispose 清错;server 7 组:共享错误码双贡献者/卸载存活/异值拒绝、throwing factory 回滚后原路由 200 且 key 可复用、四种非法 prefix 拒绝;api-reference 5 组:/backend 非默认前缀全链路 + docsPath=specPath 拒绝);三连跑 rbac 无 flake;dev 冒烟 docs 200/spec servers=/api/me 401/日志零 [E]
- 会话 4.1 验收:typecheck 零错误;vitest 61/61(rbac 15 组:原 9 组行为保持 + 并发 last-admin 恰一成功 + catalog 校验 + 触发器四拒 + 通道翻转读取失效 + ownership 漂移 fail closed + defaultTenantAdmin 稳定语义;api-reference 3 组;seed 6 组含目录发现;PGlite 重放含触发器迁移);dev 冒烟 `/api/docs` 200 HTML、`/api/openapi.json` 3.1.2 全路由(ui/ping/auth 六条)、`/login` 200、SIGTERM 优雅关闭;`pnpm db:migrate` applied 2(CHECK + triggers)
- 会话 4 验收:rbac 测试 9 组全过(4.9 矩阵:admin/manager/student × portal/角色管理/授权子树/他学院/用户管理;401 vs 403;self 不扩散/subtree 含自身;disabled role+permission+inactive plugin 三重 fail closed 且 DB 行存活;租户隔离含伪造 principal;profile 双源并集;语义漂移拒绝;资格校验五拒一过;last-admin 双向保护);`pnpm db:reset` 空库 8 迁移重放;全量 seed(含 demo)fresh 计数 permissions+11/roles+2/grants+20/assignments+2,二跑全零;dev 冒烟 admin 与 demo manager 双登录 200、日志零 [E];typecheck 零错误;vitest 52/52
- 会话 3.7 验收:manifest 新投影(2 layouts/2 pages/导航已解析 path/slots 含 user-menu);六 chunk 哨兵(PingPage/LoginPage/UserMenu/LoginMethod/AdminShell/BlankShell)present;`/`、`/ping`、`/login` 均 200;typecheck 零错误;vitest 43/43(ui-registry 重写为组合/撤销/冲突/格式校验两大用例组)
- 会话 3.6 验收:methods → mode:component + component:auth-local/LoginMethod;build CSS 探针四 class 全 present(含插件 client 独有);三 chunk 哨兵(ping/PingPage、auth/LoginPage、auth-local/LoginMethod)present;login 链路 200;typecheck(含 packages/ui 程序)零错误;vitest 39/39(新增非同源 href 丢弃 + 命名空间校验单测)
- 会话 3.5 验收:methods → [{code:local,type:local,interaction:credentials}];`/api/auth/local/local/login` → 200 + HttpOnly Cookie;me/logout/401 链路不变;build 三 chunk 哨兵(PingPage/LoginPage/LocalLoginPage)present;typecheck 零错误;vitest 38/38(新增多实例矩阵/methods fail-closed/驱动停用即时性)
- P1 会话 3 验收:`pnpm db:reset` 空库重放 applied 6 migration(s);seed 首跑 tenant+1/types+8/rules+9/root+1/userTypes+1/provider+1 admin created,二跑全零 unchanged;curl login → 200 + `Set-Cookie: qualy_session=...; Max-Age=604799; Path=/; HttpOnly; SameSite=Lax`,DTO 含 userType(administrator)/primaryOrgNode(root)/tenant;me 带 cookie 200;logout 清 cookie;me 后 401;库存 token_hash 为 64 位 hex 且 ≠ cookie 原值(测试断言);`pnpm build` → PingPage + LoginPage chunk present;drizzle-kit generate no-op;typecheck 零错误;vitest 35/35(auth 集成 8 组:统一 401 矩阵/大小写规范化/过期删行+SESSION_EXPIRED/禁用三态撤销/provider 停用/幂等 logout;auth schema 边界;org 单根+租户状态;seed 六组)
- P1 会话 2 验收:`pnpm db:migrate` → applied 2 migration(s);seed 双跑 → 1/4/3/4 created 后 0/0/0/0;dev 库层级实查 path 四级 uuid 标签链、depth 0-3;org 边界测试 4/4(真 PG 临时库:跨租户 parent/type 23503、同父同名与同租户双根 23505、跨租户同名放行、rule 自环 23514、GiST 索引存在、path <@ 子树计数、uuidv7 版本位);PGlite 重放(含 CREATE EXTENSION ltree)通过;`drizzle-kit generate` no-op + check 干净;typecheck 零错误;vitest 19/19
- 工具链裁决验收:`pnpm db:migrate`(薄适配器)→ migrations up to date (42ms);`pnpm dev` 启动序列 = gen(unchanged, skipped)→ `[I] database migrations up to date (228ms)` → connected → 四骨架激活(迁移先于依赖方,门控实证);typecheck(自动 gen)零错误;vitest 12/12
- P1 会话 1:resolveSchemaEntries → 5 条(ping + rbac/auth/org/dict);drizzle-kit generate no-op + porcelain clean + drop-guard --all 1 file;dev 冒烟四条 "scaffold loaded" 日志齐 + ping API 200 + `/` 200;enricher 测试(两 enricher 串行合成 principal、同 key 二次注册拒绝、dispose 后回 null);`pnpm gen` unchanged;typecheck 零错误;vitest 12/12

## 会话中定下的约定(已写入 CLAUDE.md / docs/notes/)

- 共享框架依赖走 pnpm catalog;esbuild 构建脚本经 `pnpm approve-builds` 精确批准
- 插件 Config 末尾必挂 `.prefault({})`(zod 4 语义)
- tsconfig:base 用 module Preserve + types ["node"](cordis d.ts 与 NodeNext 不兼容,实测定案);web 侧覆写 types 清空;`.ts` 扩展名为软约定;根 tsconfig.json 是 solution 检查入口,`pnpm typecheck` 列入每会话验收
- TypeScript 只用 6.x(P2 vfs 门禁需 Strada API);不建 @qualy/tsconfig 共享包(触发条件见 CLAUDE.md)
- dev 脚本含 `--expose-internals`(hmr 依赖 loader.internal,生产脚本不得携带);hmr 需 @cordisjs/plugin-timer(peer)
- 插件包不写 package.json `cordis` 字段(市场元数据,运行时只认 inject);插件包对 cordis 声明 peerDependencies(防双实例),运行时依赖正常 dependencies
- plugin-timer 在 dependencies(运行时基础设施);hmr 保持 devDependencies——已知不一致:提交的 cordis.yml 引用了 dev-only 的 hmr,生产装配拆分(cordis.dev.yml include)推迟到 P0 尾声处理
- 复核修入教程的未来地雷:s3 需 @types/pg/drizzle 依赖声明与 database Config 默认值;s3 占位 gen 脚本不落盘;s4 server 关停返回 Promise 防 EADDRINUSE;s7 前置根 tsconfig solution 化 + client 依赖自声明 + 先 create vite 再 gen
- 插件形态定案(s2 尾声,与 Chat 四组对照实测共同确认):统一具名导出 `name/inject/Config/apply`,模块命名空间即对象插件,禁用 default 函数 + 属性赋值;对象型 Config 顶层 `.prefault({})`,禁止 `.default({})` 替代(Zod 4 短路语义,缺失时字段默认静默失效);函数插件体勿隐式返回值(返回值会被当作 effect 清理函数,非函数抛 Invalid effect)。教程 s2/s3/s5/s8 示例已统一,坑速查表补三行
- 启动入口定案(s2 尾声):apps/server/src/main.ts 接管 cordis bin(SIGINT/SIGTERM 优雅关闭,根 fiber dispose 级联清理,实测 Ctrl+C 退出码 0 无 ELIFECYCLE;根 fiber dispose 后状态仍 ACTIVE 属特例勿断言);hmr root 收窄为 packages;代码注释与日志一律英文
- 发行愿景定案入 PLAN §2.7:构建/运行双清单分离,生成器需 --all 模式(s3 落地),超集镜像 + 静态配置生成器 + volume 挂载 yml 三件套;--expose-internals 为 dev-only,Dockerfile 必查项

- hmr watch 集合定则(s2 尾声):root = loader 装载的代码目录 + 全部装配清单,当前 `["packages", "cordis.yml"]`;include 零自监听,yml 热更完全依赖 hmr watcher(曾因收窄 root 丢过配置热更)。已知上游怪癖:源码重载会把插件配置回退到启动值,真改 yml 值或重启 dev 恢复(notes/hmr.md)

## 遗留/阻塞

- 旧 Qualy Postgres 容器已改名 qualy-postgres-old 保留(卷 qualy_postgres_data 为 P1 数据源,勿删)
- (无新增阻塞)

## s3 定下的约定(已入 CLAUDE.md / docs/notes/)

- drizzle v1 成对锁 1.0.0-rc.4:表定义一律 snakeCase.table(定义期 casing);禁 drizzle()/config 的 casing 选项;RQB v2(pg 驱动无 schema 选项),关系 API 走 ctx.db.withRelations;陌生 API 先探针(v0/v1 教程混杂)
- 主键统一 UUIDv7 数据库侧生成(PG18 uuidv7() 进 DDL,兜住裸 SQL 路径);$defaultFn 仅在需预生成 ID 时叠加;时间戳 createdAt/updatedAt + withTimezone
- Service 异步初始化必须放 async *[Service.init](<>)(构造器 effect 拦不住依赖方,实测);服务缓存若绑定 disposal 资源须在同一 disposal 清空(重载安全);寄生副作用不用单独 effect 化
- 迁移必须命名:pnpm db:generate --name <名>;gen 管线只含已落地生成器,不写占位空壳;生成物统一走 scripts/lib/codegen.ts(banner + write-if-changed)
- 服务日志本分:启动(目标+耗时,凭据脱敏)、拆除、异常(传整个 error 对象);查询级日志走 logQueries 配置开关
- 迁移策略定案(2026-07-31,三组实验):gen-schema 恒超集聚合,停用不删表(实测停用 ping 后 generate 零变更;过滤聚合下 --explain 实证会计划 DROP);删除 yml 条目 = 显式 DROP 审阅动作;手工 SQL 走 pnpm db:custom(--custom 空迁移实测可用)
- ORM 终审结案维持 drizzle:Orchid 的 rake-db 生成器把外来表纳入改名/删除候选且无范围过滤(双插件实验实锤);翻案条件与全过程归档 notes/drizzle.md;git 已连 github.com/hprogq/qualy 并推送;仓库 AGPL-3.0
- 数据层 v3 治理栈曾按 A→H 六提交建成,随即被**数据层简化令**回退(2026-08-01):完整栈归档于 tag `archive/data-governance-v3`(2c6e8dc),回退动因、删除/保留清单与**约束性触发表**见 docs/notes/data-layer-retrospective.md。现行形态:零生成物聚合(resolveSchemaEntries 读 yml 全量 + qualy.database.schemaEntry 声明)、db:generate + drop-guard、db:generate:custom 手工 SQL 通道、dev 先 migrate 后 start、CI 六步精简版。冻结规则与元规则已入 CLAUDE.md。历史文档(architecture/database.md、orm-review.md)描述的是 v3 形态,查阅时以 tag 与 retrospective 为准
- 注意:main 历史含 amend 重写,远程需 force-with-lease 推送

## 代码审查修复轮(2026-08-01,基于 99e5814)

- entry 合并:schema.entry.ts 删除,schemaEntry 直指 src/db/schema.ts,exports["./schema"] 与 schemaEntry 不一致即抛错(跨插件引用与 kit 聚合共用同一文件)
- 测试注入化:readEntries/resolveSchemaEntries 支持 ymlPath,不变式测试改写 os.tmpdir 临时 yml,不再读写仓库真实 cordis.yml
- drop-guard 增 --base-ref(git diff <ref>...HEAD),CI checkout fetch-depth: 0 后按 origin/main 扫描;本地默认 git status 行为不变
- 死物清理:ping 的 behaviorDir 与两包 dependsOn 删除;read-entries 头注修正;codegen.ts 与 .gitignore 的 *.gen.ts 加防误删标注
- 确认项:tsc 通过且 include 覆盖 scripts/**(含 tests,vitest 导入参与类型检查);notes/hmr.md 已含 --expose-internals 必要性与 dev-only/生产禁带;pnpm-workspace 的 allowBuilds 字段对 pnpm 11.8 有效(实证:approve-builds 写入该字段后 esbuild postinstall 正常执行)
- prettier 最小配置(semi:false/singleQuote/printWidth:100)+ 全量格式化独立提交

- [P1 会话 4.1] RBAC 安全加固与能力拆分(2026-08-02,评审驱动):**三处必修实锤后修复**——①grant 通道此前只在声明校验,授权 SQL 不看 `grant_to_user_type/grant_to_role`(裸 SQL 违规授权会生效):授权层全部查询加通道过滤(utp 支限 `grant_to_user_type and scope='tenant'`,role 支限 `grant_to_role`,getProfile 重构双支)+ DB 双防线(permissions 加 CHECK `NOT default_tenant_admin OR grant_to_role`;utp/rp 各挂 BEFORE INSERT OR UPDATE 触发器拒违规授权行,custom 迁移 rbac-grant-channel-triggers);②last-admin 保护改 canonical 判定(`code='tenant-admin' and is_system and kind='tenant'`)+ 角色行 `FOR UPDATE` 锁串行化管理员削减操作 + `count(distinct user_id)` 幸存者含 enabled 过滤(READ COMMITTED 并发双删实测恰一成功);③defaultTenantAdmin 纳入稳定语义(方案 A:连同 plugin ownership 一起,DB 行不一致即 fail closed 移出 active + whenSynced() 可观察拒绝)。**结构**:新共享包 @qualy/rbac-contract(类型 + Context 声明合并 + RbacService 接口,替换会话 4 的全局声明合并,auth/org/rbac 显式依赖,消包循环);rbac 按能力拆 permission-registry/authorization/assignments 三模块 + index.ts 收缩 78 行 facade(effect 留 facade 保 caller-fiber 归属;syncBox {tail,latest} 双槽:tail 保串行队列存活,latest 供 whenSynced 观察失败);目录导出统一 `permissions` + `satisfies readonly PermissionDefinition[]`;registry 补 catalog 内去重与 registration Symbol 按 token 撤销(reload 竞态安全)。**seed 声明式发现**:package.json `qualy.permissions.entry`(与 exports["./permissions"] 一致性硬校验,仿 schemaEntry)经 scripts/lib/permission-entries.ts 发现,seed 不再枚举插件名;已有行补稳定语义漂移校验(plugin/scope/双通道/defaultTenantAdmin)。**Scalar 接入**(评审采纳,实查修正):server 增 `contributeOpenApiPlugin(key, factory)` 扩展点(factory 每次 rebuild 以当前 router 造新实例,effect 托管,冲突抛错);新插件 @qualy/plugin-api-reference(exposure auto/off/public,生产 auto 即关;/api/docs + /api/openapi.json)。**实查三条**(notes/orpc-v2.md):beta.21 插件名是 `OpenAPIReferenceHandlerPlugin`(评审所称 OpenAPIReferencePlugin 不存在);**无需 @orpc/zod**——Zod 4 走 Standard JSON Schema,@orpc/json-schema 的 `StandardJsonSchemaConverter` 直出 3.1(minLength/format 探针实证);Scalar 页内联 spec 非 URL 引用,generate 的 info 走 `base.info`。手工多语句迁移必须 `--> statement-breakpoint` 分隔(pg 简单协议容忍、PGlite extended 协议 42601,重放测试实锤,入 notes/drizzle.md)

- [P1 会话 4.2] RBAC 生命周期与 server 重建加固(2026-08-02,评审驱动三笔):①**registry 状态机**——注册 pending→逐码 insert-or-verify→原子入 active:消灭「activate 先行、DB 校验滞后」的 fail-open 窗口(冲突声明在验证前对授权不可见);`ON CONFLICT DO NOTHING` 后**无条件回读**存储行,双实例携冲突定义并发启动收敛于行 owner(恰一 active,实测);whenSynced() 改为「结算全队列 + 只要仍注册的目录有失败即拒绝」,后续成功不再掩盖前序失败,dispose 失败目录即清错;授权 SQL 追加 `p.plugin` 钉死已验证 owner(带外改 owner 即时失效,与通道 flag 同哲学);激活保持逐码粒度(单码漂移不放倒同插件全目录,portal 级联事故半径考量)。②**errorStatuses 归 fragment**——共享错误码从「首注册者拥有」改为每次 rebuild 从全部活动 fragment 重推导,auth HMR dispose 不再拖垮 org 的 AUTH_REQUIRED;同码同值任意多消费者,异值在写入前拒绝贡献者。③**rebuild 事务化**——候选状态先完整构造 handler 成功后一次性提交(clear+copy 原地变更,handler 入稳定盒,遵守 traceable 纪律),throwing factory/状态冲突不再污染已服务状态;mountPath 校验收紧(origin-relative、无尾斜杠/query/hash/协议相对,拒根路径),prefix 与 api-reference docsPath/specPath 共用 schema 且两 path 必须互异(`.refine().prefault()` 链探针可用)。**缓建记录**:权限目录 owner 单源化(catalog 携 owner)——现 seed 推导与 runtime 声明双源,漂移会被验证响亮拦截而非静默,单源化留待第三方插件支持前;会话 6 角色管理 API 必须给 canonical tenant-admin 加不可删/禁/改 code/kind/isSystem 约束(仅 assignment 删除保护不够);生产部署不变量:NODE_ENV=production 必须显式设置(api-reference auto 依赖它)

- [P1 会话 5] 组织树领域、API 与页面(2026-08-03):按 errors/repo/service/router/contract/index 分层重写旧 org 模块(不照搬,旧代码零事务/无锁/多处漏租户过滤/queryNodes 运行时坏)。**并发纪律**:每个结构写事务首语句 `select ... from tenants where id=$1 for update` 锁租户行,rbac createAssignment 共用同锁——单租户结构写与授权写全串行化。**path/depth 派生投影**:label=uuid 去连字符,插入用单语句 `select uuidv7()` 原子写 path+depth(无占位窗口),move 单 UPDATE 覆盖 `path <@ oldPath` 整子树(自身置 newPath,子孙 `newPath || subpath(path, nlevel(oldPath))`,depth 统一偏移),新增 `(tenant_id, path)` 唯一索引把维护 bug 变约束错。**规则图 DAG**:递归 CTE 环检测(加边前查 parent 是否已从 child 可达),旧代码只拦自环。**类型变更三校验**:parent 规则 + 直接子节点兼容 + rbac assignmentsBlockingOrgType(现有 org 角色 assignment 的 allowed org types)。**删除保护**:叶子/children/users/assignments/在用 type/在用 rule,23001(restrict 违反,实测 PG18 restrict 抛 23001 非 23503)/23505 按约束名翻译成域错误。**授权**:org.tree.read/manage 接 definePermissions;getTree 按 read anchors 投影森林(subtree 展开、self 裸节点),per-node manageable 标志;create 目标 parent、move 目标两端、type/rule 目标 root;tenantId 只来自 principal。**对抗式审查**(15 agent workflow,3 lens × verify)产出 8 确证发现全部修复:①【critical 池死锁】changeNodeType 持锁时 assignmentsBlockingOrgType 走共享池取第二连接,10 并发即 max=10 连接池耗尽+connectionTimeoutMillis=0 永久等待→线程级死锁;修:RbacDbHandle 贯穿契约,持锁调用传 tx handle 在本连接执行。②【major 授权 TOCTOU】router 的 requireAt 在事务外/锁前判定,并发 move 可在 check→lock 间 re-anchor 目标;修:service 持锁后用锁上连接读 anchors 重新校验(assertManages,principal 贯穿 create/update/changeType/move/delete,ORG_FORBIDDEN→transport FORBIDDEN)。③【major move 提权】self anchor + 受管目标可把未授权子树整体拖入受管区并获得 manage;修:move 要求对**整个被移动子树**有 subtree 覆盖(subtreeCoveredBy)。④【major nodeId 泄露】self read grant 经 getTree?nodeId 返回整子树;修:readForest 统一按 anchor 投影,self 覆盖只返回裸节点、不覆盖返回 403(与 not-found 不可区分)。⑤【minor 撕裂读】多语句 forest 读非单快照;修:readForest 用 `repeatable read`+`read only` 单事务。⑥【minor 存在性预言机】createNode 借 uq_org_nodes_tenant_code 探测租户内 code 存在——in-lock authz 修复后附带收敛。⑦【minor 角色码泄露】ASSIGNMENT_INCOMPATIBLE 错误消息拼 role code;修:只报数量。⑧【minor 页面重复渲染】root 同时嵌套;修:OrgPage 按 roots 集合排除嵌套。OrgPage 最小管理页(树/选中/CRUD/parent selector 移动/类型规则管理/manageable 控件隐显)。org.test.ts 15 组(创建规则/DAG 环/根保护/自移动+移入后代/子树 path+depth 深树/并发规则+建删互斥串行化/类型三校验/删除五保护/租户隔离/HTTP 森林投影+越权 403+域错误状态码/self 裸投影+nodeId 不泄露/move 提权拒绝/in-lock 重校验)

- [会话 5 收口] 评审三项对齐(2026-08-03):①**授权与树同快照**——readForest 改收 Principal,rbac anchors(assignment/role/permission)与组织树在同一个 repeatable-read 只读事务内解析(经 RbacDbHandle 传 tx),撤销的授权不再能在新快照里多活一次;router getTree 收缩为纯传输。②**能力分立**——tree DTO 增 `subtreeManageable`(move 需整子树 subtree 覆盖,self grant 的 manageable=true 不再误导 UI 展示移动控件),页面按其隐显移动;capabilities 对象模型待权限种类增多再展开。③**type/rule 写锁内重验**——五个方法收 as?: Principal,lockTenant 后 assertManagesRoot 在锁上连接重验(会话 6 动态 IAM 前统一事务纪律)。附带:OrgPage 查询失效改定向 `orpc.org.key()`(不再全局失效 me/manifest)。**缓建记录(会话 6 执行)**:OrgPage 已达拆分点,IAM 新页面直接按 UI 能力拆(OrgTree/NodePanel/TypeRuleAdmin/queries),org 页面随后补拆;RbacDbHandle 统一为 database 插件导出的 DbExecutor 类型(勿每领域再造 handle);锁顺序固化 tenant→canonical row→assignment/allowed/permission→sessions,removeAssignment 补租户锁使 org 类型修改/角色资格修改/assignment 删除有全序
- 会话 5 验收:typecheck 零错误;vitest 86/86(org 17 组,含 capability 双态与锁内 type/rule 拒绝);dev 冒烟 admin 全树 5 节点全 manageable、manager 授权子树 4 节点、manager 改根 403、日志零 [E];`pnpm build` OrgPage chunk 落盘;openapi spec 含 9 条 /org 路由

- [i18n 基座] 本地化基础设施(2026-08-03,进会话 6 前):**边界定案**——后端传语义、前端定语言(全文入 CLAUDE i18n 边界条)。**@qualy/i18n-contract**(零框架):`UiText = MessageRef(id + 英文 defaultMessage) | LiteralText(业务数据不可译)`、`message()/literal()`、`uiTextSchema`、`PluginCatalogs{namespace, messages, locales}`、`ErrorMessageMap`、SupportedLocale zh-CN/en-US。**@qualy/web-i18n**:lingui core 实例 + 自写 React 绑定(Provider 解析 locale→加载 common+各插件 catalog→activate→同步 `<html lang>`,首次激活前渲染 fallback 防英文闪烁;`useI18n/useLocale/LocalizedText/LocaleSwitcher`;`formatApiError` 按 网络失败→插件 registry→common code→后端英文 message→通用兜底 逐级解析)。**两处对评审方案的适配(实查后裁决)**:①**catalog 用纯 TS 模块 + raw ICU 字符串**,不引 PO + lingui CLI——探针实证 `i18n.setMessagesCompiler(compileMessage)` 让原始 ICU 串在运行时直接可用(复数/插值/select 全支持),省掉抽取与编译构建阶段(冻结元规则:复杂度须由已发生问题证明),catalog 因此天然进 typecheck 与 vitest;PO 互换将来可加而不动契约。②**不引 `@lingui/react`**——Provider 本就要自持 locale 解析与 catalog 装配,`i18n.on('change')` 实测可用,自写 ~30 行绑定即可,顺带甩掉 babel-plugin-macros peer。**manifest 携文本引用**:`NavigationItem.label`/`PageDecl.navigation.label` 改 `UiText`,manifest 因此语言中立(切语言不重取 manifest);`UiCollectionToken` 可带 schema,registry 在**贡献期**校验(裸字符串/非命名空间 id 当场失败,机制通用非导航专用)。**typed error 结构化**:`OrgError` 携 data,ASSIGNMENT_INCOMPATIBLE 只报 `assignmentCount`(角色码不外泄),contract 声明 data schema,router 透传;前端按 code+data 用 ICU 复数本地化,英文 message 退为协议兜底(HTTP 层断言:payload 含 data、message 不含数字)。**插件自持 i18n 资产**:auth/auth-local/org/ping 各带 `client/i18n.ts`(messages + errorMessages + catalogs)与 `client/locales/zh-CN.ts`,gen-plugins 聚合 catalogs/errorMessages 到 plugins.gen(build 实证 5 个 zh-CN chunk 独立代码分割);Provider 持合并 registry,页面调 `formatError(error)` 无需知道 code 归属。**存量文案清零**:web-runtime manifest 态、App 壳(渲染器缺失/空页面/404)、LoginPage/UserMenu/LoginMethod/OrgPage 全量抽取;`@qualy/ui` 保持零文案(Spinner aria-label 改可覆盖 prop + 英文默认)。**自动化门禁**:catalogs.test 遍历所有 client 插件断言「每语言零缺译、零孤儿键、id 不越命名空间」,web-i18n 测 locale 解析链/catalog 合并/ICU 复数/错误解析顺序/uiTextSchema 边界。**缓建**:后端 `ctx.i18n` 与 `@qualy/plugin-i18n`(触发条件:邮件/短信/服务端 PDF/导出固定标题/定时通知/非浏览器消费端要求本地化——届时 API handler 仍不得按 Accept-Language 翻译错误);用户 locale 偏好落 user_preferences(会话 6 用户管理时接,勿混进 users 身份字段,接上后喂 `resolveLocale({stored})`);en-US catalog(现英文走 defaultMessage,缺译即回落,补齐时机由实际英文用户驱动)
- i18n 验收:typecheck 零错误;vitest 97/97(web-i18n 7 组、catalogs 门禁 5 插件、ui-registry 畸形贡献拒绝、org HTTP 层错误 data 断言);`pnpm build` 通过且 catalog 独立分块;dev 冒烟 manifest 导航项下发 `{kind:'message',...}` 而非中文、typed error payload 含 code/message、/admin/org 200、日志零 [E]。**浏览器人工走查待补**:切换语言后导航/页面/错误提示即时改语言且不重取 manifest 与业务数据、刷新后保持、`<html lang>` 同步

- [i18n 类型闭包] 从 contract 严格推导错误本地化(2026-08-03,评审后收紧):此前 contract 的 code/data 严格,但前端 registry 是 `Record<string, {values?(data: unknown)}>`,拼错码、写不存在的码、断言错字段全部能编译——会话 6 大量 IAM 错误码前必须合上。**探针实录**(notes/orpc-v2.md):beta.21 用 `RouterContractClient<C>`(非文档所称 ContractRouterClient)+ `InferClientError` 得到 `Error | ORPCErrorFromErrorMap<...>`;裸 Error 成员会让**非分布式**条件类型整体塌成 never,必须用裸类型参数写分布式 helper(`DefinedApiError`/`ApiErrorCode`/`ApiErrorData`)。另一处实锤:contract 里用计算键的非泛型 `err()` 辅助函数会把字面量 code 擦成 `string`,整条错误联合失效——改泛型保留字面量后才推得出。**闭环**:①contract 导出 `OrgContractError`/`AuthLocalContractError` 作单一真源;②`defineErrorMessages<Union, OwnedCodes>()` 强制「每个自有码必须在、外来码拒绝、`values(data)` 拿到该码的精确 data」(参数直接标约束类型而非推断子类型,否则拿不到 contextual typing);③`OrgError` 改 code-indexed `OrgErrorDataMap`,带 data 的码不给 data 报错、无 data 的码给了也报错,constraint 翻译表限定 `DatalessOrgErrorCode`;④contract 的 data zod schema 与 domain map 用类型断言对齐,漂移即编译失败;⑤`MessageDescriptor` 分裂出 `ValuedMessageDescriptor`(**必填** phantom `__values`——可选属性无法与「未声明」区分,这是能否判定占位符的关键),`format` 按 `ValuesOf<D>` 条件 rest 参数,声明了占位符就必须传、传错名报错;⑥catalog 由 `CatalogFor<typeof 声明表>` 定精确键集(缺键/孤儿键/拼错全部编译失败;首版曾因 `commonErrorMessages` 声明为宽类型而空转,改 `as const satisfies` 后实测生效),`catalogs.messages` 从声明表 `Object.values` 派生,不再手工维护。**聚合冲突**:生成器改为逐插件认领 namespace / message id / error code,重复或越命名空间或覆盖 common 码一律硬失败(实测两条守卫均触发),不再靠 object spread 的覆盖顺序。**降级**:catalog chunk 加载失败改为 console.error + 激活空 catalog(渲染英文 defaultMessage),不再永久停在 fallback。运行时保留的唯一 cast 在 `formatApiError` 的类型擦除边界(聚合 registry 用 `ErrorMessageRegistration<never>` 作逆变超类型),已就地注明理由。**未做**:ICU 源串与 phantom 声明的一致性无法靠 TS 证明(需 ICU parser/codegen),现由「声明 + 编译期要求 values + 对全部 catalog 跑 compileMessage + 带参消息格式化断言」四件套覆盖,大规模 placeholder 漂移出现再评估 AST 门禁
- i18n 类型闭包验收:typecheck 零错误;vitest 102/102(新增 org error-types 五项 @ts-expect-error 负向断言:registry 缺码/外来码/错字段/OrgError 缺 data/多余 data;web-i18n 占位符必传与传错名拒绝、catalog 全量 compileMessage、chunk 失败不吞异常);生成器冲突守卫实测拒绝重复 namespace 与 common 码覆盖;`pnpm build` 通过;dev 冒烟 manifest 导航仍下发 message id、/admin/org 200、日志零 [E]

- [插件 API 去样板] 类型体操归基座(2026-08-03,评审驱动):8075605 的类型闭包正确但把「证明门禁的方法」变成了「插件的编写方式」——org 的 contract/errors/router/client-i18n 四处横跨同一批错误事实,新插件作者要写状态表、DataMap、条件 tuple、契约联合推导与五张消息表。重构原则:**保留全部严格性,封装进声明式 DSL;插件只声明数据**。**新基座**:①`@qualy/api-contract`——`defineDomainErrors({CODE: {status, message, data?}})` 单源派生契约 `.errors(e.pick(...))`、状态表 `e.statuses`(beta.21 errorStatusMap 适配收进基座)、`e.create(code, data?/message?)`(data 类型来自定义内 zod schema,带 data 的码不给 data 编译失败、无 data 的码给了也失败)与 `AccessDeniedError`(service 内授权裁决,边界映射 FORBIDDEN,取代各插件自造 X_FORBIDDEN);另含 `get/post/put/patch/del` 路由元助手与 okOutput。②server 两个共享 middleware(**探针实证** beta.21:`os.$context().middleware()` 构造的独立 middleware 可挂任意契约 implementer,middleware 内可达 typed error factories,`next({context})` 类型精化下游生效):`apiErrorBoundary` 统一映射 DomainError→契约 typed error(message+data 透传)/AccessDenied→FORBIDDEN/未声明码保持 500,`requireAuth` 拒匿名并把 principal 精化为非可选——router 的九组 try/catch+mapDomain+requirePrincipal 全部消失;AUTH_REQUIRED:401 下沉 server 基础状态表(principal 是 server 概念,不再依赖任何插件在场)。③`@qualy/plugin-database/pg-errors`——unwrapPgError + createConstraintTranslator(23505/23503/23001 判定与 drizzle cause 解包收进基座,插件只写 constraint→create thunk 表)。④i18n-contract 门面——`definePluginMessages({namespace, messages, errors, locales})` 一次调用取代 orgMessages/orgErrorTexts/errorMessages/orgDeclaredMessages/catalogs 五张表;`defineErrorTranslations(errors, {...})` 直接从 DSL 值推导(全码必须译、外来码 excess property check 拒绝、values(data) 精确类型),**整条 InferClientError/RouterContractClient/分布式过滤链从插件路径删除**(机制知识保留在 notes/orpc-v2.md;api-client 的合法使用不变)。**迁移全量**:org(errors 90→37 行纯声明、contract 232→153 行纯 API、router 239→159 行零 try/catch、client i18n 单调用)、auth-local(同型)、auth/ping/ui-registry(契约助手+门面)。**两处实施校正**:①插件 locale 文件回归 `satisfies MessageCatalog`——CatalogFor 精确键在「声明表与 catalog 同文件族」时制造 TS7022 类型环(i18n→locale thunk→locale 的 satisfies→declared→i18n),精确键完整性由既有 catalogs.test 运行时门禁负责(缺键/孤儿键/命名空间越界照红),web-i18n 自身 common catalog 无环保留 CatalogFor;②defineErrorTranslations 参数必须是映射类型本身而非推断泛型子类型——泛型约束推断不触发 excess property check,外来码曾静默通过(负向探针实测后改正)。**缓建**(触发条件记录):definePlugin 组合根门面(3 处 'org' 重复是小痛,cordis effect 生命周期不动);发现逻辑统一 discoverPluginPackages(生成器共享 resolvePackageDir 已够用);后端 ctx.i18n 的 AsyncLocalStorage 请求级 locale(oRPC 官方示例手法,邮件/PDF 需求出现时用,API 错误永不按 Accept-Language 翻译)
- 去样板验收:typecheck 零错误;vitest 105/105(api-contract DSL 三组含 @ts-expect-error 负向:pick 外来码/create 缺 data/错 data 形状/无 data 码拒 data;org error-types 重写为 DSL 负向:翻译缺码/外来码/values 错字段;既有 org 17 组语义不变仅 ORG_FORBIDDEN→ACCESS_DENIED);`pnpm build` 通过;dev 冒烟登录/树/坏凭据 401(DSL statuses)/匿名改 401(requireAuth+server 自有状态)/删根经边界返回 ORG_NODE_IS_ROOT 与 contextual message、日志零 [E]

- [基座收口] 传输适配彻底隐身与 DSL 硬化(2026-08-03,评审后):①**HTTP 状态适配对插件完全消失**——评审建议 `contribute(ns, router, {errors})`,实查后做得更彻底:**探针**证实 `walkProcedureContractsSync`(@orpc/server)可遍历已构建 router 并从每个 procedure 的 `~orpc.errorMap` 精确读出契约声明的 status(嵌套 router 一并覆盖),故 server 直接自取,`contribute(ns, router)` 收缩为两参,`errorStatuses` 选项删除,org/auth/auth-local 三处传参与 auth 手写 `authErrorStatuses` 表一并消失——插件从此只在契约里写一次 status,漏接的失败模式不复存在。②**跨包识别改全局 symbol brand**(`Symbol.for('qualy.api.domain-error')` / `...access-denied` + `isDomainError`/`isAccessDeniedError`),不再 instanceof:第三方插件锁不同版本、打包内联或模块图重复时,错误仍被边界识别而非退化 500(测试构造「另一份包实例抛出的错误」验证)。③**CreateArgs 判据改按 schema 是否声明**(原按 data 输出类型是否 undefined),与运行时分支同源——`z.undefined()`/`.optional()` 这类 schema 下类型与运行时不再可能分歧。④**加载期校验**:code 必须 SCREAMING_SNAKE_CASE、status 必须 400-599 整数、message 非空,definitions/statuses 冻结,`is()` 用 `Object.hasOwn` 而非 `in`(不再匹配 constructor/toString 等原型键)。⑤`okOutput` 改 `z.literal(true)`(handler 失败即抛,客户端不必处理不存在的 false)。⑥**middleware 直接测试**(无数据库、无 http):已声明码→typed error+status+message、带 data 码→data 透传、**未在该 procedure 声明的域错误→不伪装成 typed error,保持内部故障**、AccessDenied→FORBIDDEN、无 principal→AUTH_REQUIRED、有 principal→handler 内非可选且值完整、普通异常原样冒泡。⑦**i18n 占位符返回值约束**:评审判断「不建议现在做」,实测代价仅一个泛型接口(`ValuedErrorTranslation<Data, Message>` 用 `ValuesOf<Message>` 钉返回值)——`values` 返回错误占位符名现在编译失败,org 注释相应改为如实描述
- 收口验收:typecheck 零错误;vitest 114/114(api-contract 5 组含跨包 brand 识别、原型键拒绝、加载期四类校验与冻结;server middlewares 7 组;server 既有 6 组改为契约声明状态);`pnpm build` 通过;dev 冒烟状态零配置全对——坏凭据 401(auth-local DSL)、删根 409(org DSL)、匿名 me 401(server 基础表)、非法输入 400(oRPC 内建),日志零 [E]

- [基座补漏] 翻译与状态合并两处实缺(2026-08-03,评审后):①**占位符返回值约束此前是假保证**——上一笔的负向测试写的是底层泛型接口 `ValuedErrorTranslation<Data, typeof valued>`(显式传了具体 message 类型),而插件真正调用的 `defineErrorTranslations` 门面里第二泛型被固定成 `ValuedMessageDescriptor<MessageValues>`,`ValuesOf` 退化为 `Record<string, unknown>`,写错占位符名照样编译通过;提交信息因此夸大了保证。**修法**:两遍式约束——参数改 `Table & CheckedTranslations<Table, Defs>`,编译器先推断出 Table(此时每项的 message 类型已具体),第二遍再用 `ValuesOf<Table[Code]['message']>` 钉死投影返回值(单遍映射类型无法表达「values 返回值取决于兄弟属性 message」)。四条负向全部改为**经门面**验证并固化:缺码/外来码/data 字段写错/占位符名写错。②**状态合并两条静默覆盖路径**:同一 router 内两个 procedure 对同码声明不同状态时后者静默覆盖(此前只查 fragment 之间);插件契约可声明 `FORBIDDEN: 418` 覆盖公共语义。**修法**:统一 `claimStatus`(status 必须 400-599 整数、同码异值即冲突),reserved 表(COMMON_ERROR_STATUS_MAP + AUTH_REQUIRED)**先行认领**,插件可重复声明相同值但不能改写;最终 statusMap 不再 spread。新增三测:单 router 同码 409/422 拒绝、插件覆盖 FORBIDDEN 拒绝、嵌套子 router 声明的 451 真实生效(把 walkProcedureContractsSync + `~orpc.errorMap` 这条 beta.21 适配从探针记录升级为自动化门禁)。③**隐藏 DomainError 构造器**——symbol brand 解决的是跨包识别,并未阻止插件绕过 `create()` 直接 new;现在只导出结构类型,实现类 `DomainErrorImpl` 私有,唯一构造路径是 `errors.create()`(受信代码仍可伪造 brand,这是纪律不是隔离,注释已如实说明)。④**删除 `DomainErrors.statuses`**:server 改为从契约自读后它已无消费者,留着等于给插件一个"HTTP 状态是我的事"的错误暗示。⑤**冻结每个 definition 对象**(此前只冻外层,嵌套 `status/message` 仍可运行时改写;zod schema 内部不冻)
- 补漏验收:typecheck 零错误;vitest 115/115(org error-types 四条负向全部经真实门面;server 17 组含同 router 冲突/reserved 覆盖/嵌套状态生效;api-contract 5 组改用 brandedError 助手构造"另一份包实例的错误",冻结断言覆盖表与单个 definition);`pnpm build` 通过;dev 冒烟登录 200/坏凭据 401/删根 409/匿名 me 401,日志零 [E]

- [前端架构收口] 授权 manifest 与语义化路由(2026-08-03,评审驱动):**实证后确认的真实缺口**——`build()` 完全无视 `PageDecl.public/permission`、`getManifest` 不接 principal,契约注释所称的"authorized projection"从未兑现:匿名访问可枚举全部已装配页面的 id/路径/组件名并生成导航入口(业务 API 仍拒绝越权,故非数据越权,但是能力泄露)。会话 6 将新增大量 IAM 页面,必须先修。**落地**:①`definePage({id,path})` 建立跨插件共享的页面身份(插件 `src/ui.ts`,零框架依赖,`exports['./ui']` 暴露),声明期校验路径(绝对/非协议相对/无 query hash/无尾斜杠/无空段)并冻结;②`UiVisibility` 判别联合(public/authenticated/permission)取代可选 `public?`+`permission?`,**注册时必填**,页面 navigation 继承页面可见性;③`getManifest` 接 principal 做投影:页面/独立 contribution/slot 按可见性过滤,未使用 layout 不下发,导航 page target 由服务端解析成 path 且随页面一起消失;④权限判定用 **ui-registry 单槽 authorizer**(而非 ui-registry 硬注 rbac——那会让无头部署也必须装 ui,方向反了):rbac 经 `ctx.inject(['ui'])` 嵌套 fiber **可选**注册(rc.7 无 optional inject,嵌套 fiber 即该语义),无 authorizer 时权限页 fail closed;⑤`NavigationTarget` 判别联合,external 限 http(s)/mailto/tel 且走 `<a>` 不进路由;⑥route builder 移入 web-runtime(可脱浏览器测试),干掉 `layout.contract === 'admin-shell/v1'` 硬编码——首页与 404 成为宿主级策略;⑦`PluginComponentBoundary` 统一隔离 layout/page/slot/renderer,组件崩溃只塌局部并记录 id+kind,manifest 引用了 build 里没有的组件不再静默(此前 slot 静默吞异常、page 无边界);⑧`PageLink`/`usePageNavigate`/`usePageHref` 按页面导航,**5 处裸路径清零**并加 client-paths 门禁测试;⑨`useSessionTransition` 在身份切换时清空 query 缓存(此前只 invalidate,A 用户的组织树可能在 B 会话中短暂可见);⑩`isAuthenticationError` 等错误判定 helper,UserMenu 不再把网络故障当"未登录",登出失败不再产生未处理 rejection。**按实际裁剪**:PageRef **不引入 params/search 的 Zod 层**——当前零页面带路径参数,会话 6 的 IAM 三页也都是列表页,建一套泛型参数机制是零消费者的过度建设(触发条件:出现 `/admin/users/:userId` 这类详情路由)
- 前端收口验收:typecheck 零错误;vitest 121/121(ui-registry 4 组:组合与撤销/三态可见性投影+authorizer 生命周期/畸形声明拒绝/页面引用校验;web-runtime href 编码 5 例;client-paths 门禁);`pnpm build` 通过;dev 冒烟三态实证——匿名 manifest 仅 `ping/page,auth/login` 且 `org/` 零出现、admin 得到 `org/page` 且导航 target 为已解析 page 形态、student(无 org 权限)与匿名一致,日志零 [E]

- [P1 会话 6] IAM 管理闭环(2026-08-03):用户类型、用户、角色与授权的最小管理闭环,全部按前几轮冻结的纪律写(错误 DSL 单源、两 middleware、租户行锁、PageRef+visibility、定向失效),**新页面未复制 OrgPage 的单文件模式**(shared 面板/查询态原语 + 每职责一组件)。**auth 侧**:`IamService` 管用户类型与用户,全部写事务首语句锁租户行(与 org 结构写、rbac 授权写同锁)。跨领域规则是重点——①权限只能经声明的 user-type 通道进用户类型(role-only 码被拒且不破坏既有授权);②改用户类型时若现有 org 角色授权不再允许该类型即拒(`ASSIGNMENT_INCOMPATIBLE` 带数量);③禁用用户**立即删除其 sessions**(不等过期);④**最后管理员保护**覆盖两条路径:禁用最后一个持 canonical 角色且可登录的用户、禁用其赖以登录的用户类型,均在 `for update` 锁 canonical 角色行下判定(并发双禁用实测恰一成功);⑤系统用户类型不可删、在用类型不可删(带 userCount)。**rbac 侧**:`Administration` 管角色与授权——org 角色只能持 org scope 权限、tenant 角色只能持 tenant scope,均需声明 role 通道;收窄 allowed 集合时与现有 assignment 一并在同一锁内校验,会产生孤儿授权即整体拒绝;**canonical tenant-admin 五项不可变**(不可删/禁用/取消 assignable/改权限/被非持有者授予或撤销——`TENANT_ADMIN_REQUIRED` 防组织管理员自我提权);`syncUserAssignments` 差集替换后**末尾一次性**校验最后管理员(看终态而非快照)。**页面**:/admin/users(按组织节点锚定,anchor 决定授权与列表范围)、/admin/user-types、/admin/roles,均 `permissionOf(...)` 可见,manifest 三态实证。**基座顺带两修**(会话 6 自己撞出来的真实缺口):①**query 参数强制转换**——契约声明 boolean/number 的 GET 参数在 query string 里是文本,校验直接 400(`subtree=true` 实锤);server 装 oRPC SmartCoercion + StandardJsonSchemaConverter,声明类型在链路两端从此同义。②**生成器支持一包多契约**——一个插件同时拥有会话核心与同域管理 API 时,不必挤进一个命名空间;各自成 ns,跨插件冲突守卫不变。**错误码全局唯一守卫两次触发**(rbac 与 auth 同声明 USER_TYPE_NOT_FOUND 等、auth 与 org 同声明 ORG_NODE_NOT_FOUND),按语义加前缀消解(ROLE_USER_TYPE_NOT_FOUND / USER_PLACEMENT_NOT_FOUND 等)——守卫按设计工作,验证了上一轮加它的价值
- 会话 6 验收:typecheck 零错误;vitest 135/135(auth IAM 8 组:类型创建冲突/通道校验+幂等/系统与在用类型删除保护/用户创建与占位校验/类型变更被授权阻断/禁用即清 session/最后管理员双路径/并发禁用恰一成功;rbac 新增 3 组:canonical 五不可变+allowed 收窄拒绝/授予权保留/差集替换与末尾不变式);`pnpm build` 通过且 UsersPage、UserTypesPage、RolesPage 各自独立 chunk;dev 冒烟 admin manifest 含 6 页(含三个 IAM 页)、user-types/roles/users API 正常、subtree 两态正确、student 只见 2 页且 IAM API 403、日志零 [E]
- 会话 6 未做(记录触发条件):`setLocalIdentity`/`setLocalPassword`(本地凭据管理属 auth-local 驱动职责,教程 §6.2 列出但需与驱动插件的 provider 实例模型一起设计,登录限流也应同批做);assignment 编辑页面(API 已就位,UI 待与用户详情页一起做——当前无详情路由,加了就该同时引入 PageRef 的 params 层);`changeBusinessNo` 独立接口(update 已覆盖且禁止清空)

- [P1 会话 6.1] 审计修正轮(2026-08-04):外部审计提出的 P0/P1 逐条核实后修正,**属实的都改了,两处判断修正了审计**。**安全类三条**:①**subtree 越权读**属实——`listUsers` 只在请求锚点上 requireAt,而 `self` 授权对锚点自身也返回 true,于是持 self 的调用者请求 subtree 就读到了整棵子树。改为**请求范围 ∩ 授权范围下推 SQL**(`anchorCoverage` 落 rbac-contract,org 侧 TS 版与之对应),返回部分子树是正确答案而非报错;单条 `getUser` 同样把"不可读"与"不存在"做成不可区分。②**授权 TOCTOU** 属实——router 前置检查发生在拿租户锁之前,节点可在窗口内被移动;`canAt` 增 `RbacDbHandle` 参数,所有身份写入与 assignment 集合替换改为**在锁定连接上复核**(assignment 的 existing 集合也改为锁内读取,消除"删掉快照之后新增、且调用者无权的授权"这条路径)。③**最后管理员不变量**属实且更糟——auth 与 rbac 各写一份 survivor SQL 且**已经漂移**(rbac 那份根本没 join user_types)。收成 `@qualy/rbac-contract` 单源实现,定义收紧为"**还能登录**的管理员"(enabled user + enabled type + **type 至少开一个登录通道**);是否已绑定 identity **不纳入**——那是驱动知识(SSO 可首登即建),核心不能断言,注释写明这是必要条件而非充分条件。校验改为**写入之后读终态**,删掉 exclude 参数。新增守护路径:关闭最后登录通道、改管理员的用户类型。**产品语义一条**:有用户的类型**禁止停用**(旧行为吊销全员登录却不清一条 session,类型重新启用旧 Cookie 即复活;批量封禁是另一个操作,需要预期数量/理由/清 session,等真需要时另建);删除类型时若会清空某角色的 eligibility 使其无人可授,也拒绝(否则 FK cascade 静默做掉)。**错误 DSL 一条**:`assertTenantKeepsAdministrator` 原先抛裸 Error,经 HTTP 是 500 而非可本地化的 409;单条授权资格校验也有两份并已漂移(一份拒绝 disabled 用户一份不拒绝),合并为 `assertGrantEligible`,拒绝理由是稳定语义 token(role-unassignable/user-disabled/user-type/org-type/tenant-role-anchor),前端能翻成指出该改什么的句子。**审计判断被修正的两处**:seed 的 administrator 类型本就 `allow_local_login=true`(审计说它不可登录只对**测试夹具**成立,夹具已修——现在类型不开通道会让整组不变量测试失败,这正是它该有的样子);"权限不足页面显示空下拉框"的解法不是给页面加跨域权限,而是给每个页面**自己权限可及的 options 端点**。
- [P1 会话 6.1] API 路径规范化:`/rbac/*` 全部迁到 `/iam/*`(rbac 是实现,不该出现在 URL;插件/服务/表/权限码保留 rbac 名);动作段改幂等子资源(`/move`→`PUT /placement`,`/enabled`→`PUT /status` 带枚举,`/allowed`→`/eligibility`,`POST /type-rules`→`PUT /type-rules/{parent}/{child}` 且重复即收敛);`/auth/me`+`/auth/logout`→`GET`/`DELETE /auth/session`,`/auth/methods`→`/auth/login-methods`;`/ui/manifest`→`/app/manifest`。客户端命名空间随之 `rbacAdmin`→`access`、`iam`→`identity`、`ui`→`app`;生成器 import 改 aliased(否则插件不能导出 appContract)并校验导出名可作命名空间。**全量 46 条路径由 scripts/tests/api-surface.test.ts 冻结**,另三条约定测试(域名不得是实现名、单记录子资源必须 PUT、健康探针不进 API 面)。
- [P1 会话 6.1] 补接口与前端补全:新增 user/user-type/role/org-node 详情读、`/iam/permissions`(只出 registry 活跃集)、`/iam/user-options` 与 `/iam/role-options`(各自权限可及)、`PUT /iam/users/{id}/placement`、`GET|PUT /iam/users/{id}/role-assignments`;列表改 keyset 分页(cursor 原语进 api-contract,禁止裸 limit 静默截断);响应带 `capabilities.canManage` 与逐行 `manageable`。角色/用户类型**一次建全**(创建即带权限与 eligibility/登录通道)。前端把"能列能开关"补成完整闭环:每个目录旁挂编辑器(权限勾选、eligibility、登录通道、启停删),选中项存 query string 因而可链接可刷新;用户加真正的详情路由 `/admin/users/:userId`——这才逼出 **PageRef 参数层**(缺参数是编译错误,URL 仍由 runtime 拼);控件按服务端 capabilities 渲染、表单走原生 `<form onSubmit>`(回车可提交、pending 不能重复提交)、删除走可读可测的 `<dialog>` 而非 `confirm()`、支撑查询失败必须报错而不是渲染成空选择器。Panel/AsyncSection/CheckboxGroup/ConfirmDialog 下沉 `@qualy/ui`(零文案原语)。
- [P1 会话 6.1] 基座三补:`/health/live` 与 `/health/ready`(贡献方经 `server.readiness` 声明,database 查连通、rbac 查 catalog 已同步;都在 /api 之外、不进 openapi;失败原因只进日志);不可解析的请求体不再记 `[E]`(它是客户端过错且已答 400,记成服务端故障让"日志零 [E]"失去意义);`mergeErrorTranslations` 让一个插件能翻译多个错误声明集。
- [P1 会话 6.1] 测试补三层:**HTTP 层**(真实 URL 的 401/403、scope 枚举过 query string、self 锚点仍框住 subtree 请求、域错误的声明状态与 code);**transport 层**(query 强制转换双向覆盖 + 非法值仍是 400——上一轮只有手工冒烟);**浏览器层**(Vitest Browser Mode + Chromium,8 个用例覆盖能力边界、API 会拒绝的停用、本地化拒绝、重复提交、失败的选择器;**首次运行就在两个创建表单里抓到真 bug**——它们的权限选择器没有错误态,查询失败会渲染成空列表,这就是这一层的价值)。node 套件排除 `*.browser.test.tsx`,浏览器套件独立 `pnpm test:browser`。
- 会话 6.1 验收:`pnpm typecheck` 零错误;`pnpm vitest run` **27 文件 149 测试全过**(较上轮 +10);`pnpm test:browser` **8 全过**(Chromium headless);`pnpm build` 通过,UsersPage/UserDetailPage/UserTypesPage/RolesPage 四个独立 chunk;dev 冒烟:`/health/live`→`{"status":"live"}`、`/health/ready`→`{"status":"ready","checks":{"database":"ok","permissions":"ok"}}`;manifest **四态**(匿名 2 页 / student 2 页 / manager 5 页含 user-detail / admin 7 页);manager 对 `/iam/user-types`、`/iam/roles`、`/iam/permissions` 均 403 而 `/iam/user-options` 200(正是"页面不该跨域要权限"的实证);**manager 请求整棵树的 subtree 只拿回自己学院的两人,根节点上的管理员不在其中**(越权读已封);不变量经 HTTP 全部命中声明码——禁用最后管理员 409 LAST_ADMINISTRATOR、停用其类型 409 USER_TYPE_IN_USE、关闭其最后登录通道 409 LAST_ADMINISTRATOR、清空其角色授权 409 LAST_ADMINISTRATOR;空 PATCH 与越界枚举均 400;旧路径 `/rbac/roles`、`/auth/me`、`/ui/manifest` 全部 404;openapi.json 32 条路径全在 /iam /auth /app /org /ping 下,无 /rbac、无 health;日志 **[E] 零**
- 会话 6.1 未做(记录触发条件):**审计事件域**(actor/target/before-after/reason)——它是独立领域(新表、新插件、新界面),且组织/字典/测评都会产生事件,不该挂在 /iam 下,留作独立会话;**登录 provider 管理 API**(provider secret 与协议配置归各驱动插件,需与 auth-local 的 provider 实例模型一起设计);**本地凭据管理**(setLocalIdentity/setLocalPassword,同上,应与登录限流同批);**用户 identity 与 session 的管理界面**(API 形状已想清楚:`/iam/users/{id}/identities`、`/iam/users/{id}/sessions`,等凭据管理落地再一起做);**权限的分组与描述元数据**(现在选择器显示 code + name,分组展示需要 groupKey 的 i18n 方案)
- [P1 会话 6.2] 访问模型重做(2026-08-04,评审驱动):`permissions.ts` 原本一条权限要声明四件事(`scope` / `grantToUserType` / `grantToRole` / `defaultTenantAdmin`),把「权限判定的对象」「谁能拿」「谁天生有」搅在一起。拆成三个各归其位的概念:**`permission.target`**(`tenant` | `org-node`,插件自己的领域事实,只说这条权限该对着什么判)、**`role.kind`**(`tenant` | `org`,管理员建角色时选,决定授权时要不要锚节点)、**`grant.coverage`**(`self` | `subtree`,授权那一刻才知道的事)。`defaultTenantAdmin` 逐权限声明改为角色上的 **`permission_mode = 'all-active'`**:只有 canonical tenant-admin 一行是这个模式,它持有全部 active 能力并抵达每个节点,新插件上线不再需要回填授权。**提权控制照 Kubernetes 的 escalate/bind**:定义角色只能用自己持有的权限(`iam.role.escalate` 是逃生门),授权只能给出自己有的权威且 coverage 不更宽(`iam.tenant-role.bind` / `iam.org-role.bind`,后者是 org-node 目标的,因此可以按节点下放)。角色有 **draft → active → disabled** 生命周期,完整性在激活时检查(此前可以建出「没有权限、谁都授不了」的半成品角色),集合替换一律要 `version` 乐观并发。`user_role_assignments` → `role_grants`(`chk_role_grants_anchor` 强制 `(org_node_id IS NULL) = (coverage IS NULL)`,两个分区唯一索引)。**三处一致性加固**:①读过滤下推——`@qualy/rbac-contract` 的 `scopeCoverage(scope, alias)` 把授权范围翻译成 SQL 谓词,子树读不再先全取再过滤;②TOCTOU——每个结构性写的第一条语句是 `select 1 from tenants where id = $1 for update`,锁内用调用方连接重跑 `canAt(principal, code, node, tx)`(`RbacDbHandle` 防止持锁时另开一条池连接);③解释与判定同源——`REACHES_EVERY_NODE` 是导出的 SQL 片段,授权、profile 与 `/iam/access-evaluations` 共用,诊断不可能和裁决说法不一致。分页游标带查询指纹(`encodeQueryCursor`),指纹不符抛 `BAD_REQUEST` 而不是静默回第一页(那会让「加载更多」变成同一页反复出现)。
- [P1 会话 6.3] 用户类型与角色的职责切分(2026-08-04):上一轮留下的 `user_type_baseline_roles`(用户类型继承角色的权限)与业务不符——按真实校情,**用户类型说的是「这是什么人、能站在哪」,角色说的是「担了什么职、因此能做什么」**:管理员只能挂在学校下、老师只能挂在年级/教研室/班级下、学生只能挂在班级下;而辅导员只发给老师、班长和团支书只发给学生、审核员两者都可以。这两件事正交,让类型继承角色等于把它们焊死。**做法**:①删除 `user_type_baseline_roles` 表、服务、接口与错误码,`heldRoles` 收缩为「只看 grant」,诊断里的 `user-type-baseline` 来源消失;②补上一直缺的另一半——新表 `user_type_allowed_org_types` + `user_types.version`,`assertPlacementAllowed` 在创建、改类型、调动三处校验(**当时**空集 = 不约束,这个读法后来被证明是错的,见下一条评审修复的显式 `placement_mode`),收窄允许集时若已有人站在那里返回 `USER_TYPE_PLACEMENT_IN_USE`;③删掉 `auth.portal.access`——「能进门户」是认证状态不是权限,把它建模成权限正是当初用户类型开始背角色的起点,页面改用 `AUTHENTICATED` 可见性(grep 确认没有页面拿它做权限);④`administrator` 用户类型改名 `system-account`:管理员权力全部来自 tenant-admin 角色,这个类型只剩「恢复用的系统身份」这一件事;⑤`assertMayAssignType` 只再拦系统类型——类型不授予权威,给谁什么类型不是一次提权。**新接口**:`GET/PUT /iam/user-types/{id}/allowed-org-types`(带版本)与 `GET /iam/role-grant-options`(给定用户与节点,实算这个人此刻能被授予哪些角色)。迁移 `20260803201110_access-model` 重写:`rbac.*` 权限码就地改名为 `iam.*` 并保留行 ID,逐用户类型生成的迁移角色显式授给它的每个成员(**不做权限并集**,学生不会因此继承教师的权限),重复的租户授权用 `DISTINCT ON` 收敛保留最早一条。auth 的 `ORG_TYPE_NOT_FOUND` 与 org 的同码冲突(错误码全局唯一,生成器启动即拦),改名 `USER_TYPE_ORG_TYPE_NOT_FOUND`,与 rbac 的 `ROLE_ORG_TYPE_NOT_FOUND` 同一命名法。
- 会话 6.2/6.3 验收:12 条迁移在空库全量应用;seed 产出正好是要的形状——`示例学生 (student) | 软件2023级1班 [class] | 无角色` / `示例辅导员 (faculty) | 2023级 [grade] | org-manager @ 软件学院 subtree` / `系统管理员 (system-account) | Qualy [university] | tenant-admin`;HTTP 端到端实测:学生建进班级 200、建进学院 409 `USER_TYPE_PLACEMENT_NOT_ALLOWED`、调动到年级同样 409、收窄学生允许类型 409 `USER_TYPE_PLACEMENT_IN_USE`、把辅导员的角色授给学生 409 `GRANT_NOT_ELIGIBLE`、`/iam/role-grant-options` 对同一节点上的学生返回 `[]` 而对老师返回 `['org-manager']`、`effective-permissions` 显示辅导员的 6 条权限**全部**来自 org-manager 角色(用户类型来源已归零);manifest 三态(admin 7 页 / manager 5 页 / student 2 页);`/health/ready` 两探针 ok,日志零 `[E]`。**未做(用户明确要求在此停下)**:两个陈旧测试文件 `rbac.test.ts` 与 `iam.test.ts` 尚未按新模型重写,`pnpm typecheck` 目前只在这两个文件报错(源码与全部 client 程序零错误),`api-surface` 冻结清单也待同批更新。
- [外壳体验三修] 404、文案与登录后清单(2026-08-04,用户实测反馈):三个各自独立的缺陷,均先在真实浏览器复现再修。①**404 渲染在所有布局之外**——`buildManifestRoutes` 把 index 与 `'*'` 兜底放在布局路由的**兄弟**位置,未匹配的地址因此画在裸 body 上(实测标题定位 `x=0 y=0`,连字体都不是应用的)。改为把这两条嵌进**视图者自己首页所在的那个布局**(宿主不点名任何布局契约,靠 `homePath` 反查页面的 layout;无布局可用时仍独立渲染),并补 `packages/web-runtime/tests/route-builder.test.tsx`——此前 route projection **一条测试都没有**,新测试用 `matchRoutes` 钉住分组、兜底归属、`'*'` 永远排在真实页面之后(含 `:userId` 参数页与跨布局页)、以及任何清单都不会得到没有终点的路由树。②**文案假设了不存在的导航**——not-found 提示词原文是「或从导航进入其他页面」,而那个屏幕根本没有导航;empty 提示词是「请在装配清单中启用业务插件」,把开发者指令说给了终端用户。两条重写,Notice 改成居中整屏并带「回到首页」动作;嵌进壳之后匿名访客还能直接看到 header 的登录入口(用户此前只能手工把地址改成 /login)。③**登录后只剩 Ping**——`useSessionTransition` 用的是 `queryClient.clear()` + `refetchQueries()`。**实跑 @tanstack/query-core 5.101.4 证实**:`clear()` 只把条目从缓存里摘掉,**不通知已挂载的 observer**,`useQuery` 继续吐上一个身份的数据;随后的 `refetchQueries()` 面对空缓存无事可做;而 `RuntimeLoader` 挂在 `BrowserRouter` **外面**,`navigate()` 也重渲染不到它——于是超管登录后拿到的仍是匿名清单。四个候选实测对比:`clear+refetch` 与 `removeQueries+refetch` 都不刷新,`invalidateQueries({refetchType:'all'})` 会刷新但旧身份数据在刷新期间仍可读,只有 `resetQueries()` 既让 observer 转 pending(旧数据当场不可读)又真重取。**对抗评审又抓出一条自伤**:`reset()` 会清掉每个条目的回收定时器且只在下次 fetch 时重装,没人观察的条目会活到标签页关闭(实测三轮切换残留 10 条空条目,`clear()` 是 0),补 `removeQueries({ type: 'inactive' })` 后回到 1 条(仍挂载的 manifest);测试里被我一度删掉的缓存规模断言换成键集断言补回,并验证过去掉修复它确实会红。④**typecheck 门禁此前遇错即断**——`scripts/typecheck.ts` 在第一个失败的工程上就抛,web 侧那 10 个工程从来没被真正检查过(此前「全部 client 工程零错误」的说法没有依据);改为全部跑完再汇总退出,并把 `packages/web-runtime/tests` 纳入该工程的 include(此前是类型盲区)。顺带清掉上一笔改名遗留的三个 rbac 孤儿译文键(catalogs 门禁因此转绿)。
- 外壳三修验收:改前/改后同一段 Playwright 脚本对比——`nav on /xxx` 由 `[]` 变 `["Ping"]`,标题定位由 `x=0 y=0` 变 `x=662 y=238`,`nav after login` 由 `["Ping"]` 变 `["Ping","Organization","Users","User types","Roles"]` 且**全程零次刷新**;zh-CN 渲染实测「页面不存在 / 这个地址没有对应到任何你能打开的页面。/ 回到首页」;`pnpm build` 通过,日志零 `[E]`;`pnpm typecheck` 11 个工程全跑,只有根工程因两个陈旧测试文件报错;node 套件由改前 6 failed / 92 passed 变 5 failed / 102 passed(catalogs 转绿,新增 9 条 route projection 与会话切换断言),剩余失败全部是上一笔遗留的待办(api-surface 冻结清单、seed、server readiness)。**仍未做**:`rbac.test.ts` / `iam.test.ts` 重写、api-surface 冻结清单更新、`apps/web/tests` 的 browser fixture 已随契约漂移(5/8 红,`userType()` 缺 `allowedOrgTypeIds`/`version`,`role()` 缺 `systemKey`/`version`/`holdsEveryPermission`/`grantCount`/`unavailablePermissions`;其中 `systemKey !== null` 这种写法对手搓 fixture 尤其不友好——漏字段不会崩,只会静默把操作按钮全隐藏),以及 `apps/web/tests` 同样不在任何 tsconfig 里(与 web-runtime 同型的类型盲区,本轮只修了后者)。
- [访问模型评审修复] 站位、资格与迁移残留(2026-08-04,评审驱动,逐条先对代码核实再改):**先说没照搬的一条**——评审第一节问「角色的可锚定组织节点类型是不是和用户类型重复」,核对 `assertGrantEligible` 后确认**不重复也不能删**:它读的是 grant 目标节点的类型,与持有者本人 `primaryOrgNode` 无关。用户类型说人挂在哪,角色的锚点说职责在哪生效。保留关系,但把招人误会的名字改掉:`allowedUserTypeIds` → `eligibleUserTypeIds`(可授予哪些用户类型)、`allowedOrgTypeIds` → `anchorOrgTypeIds`(职责作用于哪些节点类型),文案同步改成「可以授予这些用户类型」/「职责作用于这些类型的组织节点」。**P0 五条**:①**空集合不再被读成「不限制」**——新增 `user_types.placement_mode`(`unrestricted` | `allow-list` + check 约束),接口由 `/allowed-org-types` 改为 `/iam/user-types/{id}/placement-policy`,`allow-list` 至少一项由 contract 层挡(实测 400),widening 必须显式说出口,stranded 检查改为**无条件**在写入之后读终态执行(旧代码只在新集合非空时才查,清空恰好绕过——这正是用户看到的「取消学校仍可保存」);创建用户类型也**必须**带 policy(没有隐式默认,与 addPage 的 visibility 同规矩),同策略重写不涨版本,`user_types.version` 改为整行资源版本(每次变更都涨,与 roles 一致)。②**系统身份钉在租户根**——`syncPlacementPolicy` 拒绝系统类型(此前是系统类型唯一可被普通管理员改写的部分),且 `placementLegal` 对 `is_system` 只认 `parent_id is null`;理由是对人的权限就是对其所在节点的权限(`assertManagesNode` 走 `canAt(actor,'auth.user.manage',node)`),恢复账号一旦落到子树里,那棵子树的管理员就管得着它。③**改节点类型检查现存用户**——org 此前只问 `grantsBlockingOrgType`(角色授权),不问站在上面的人;新增 `ctx.auth.iam.usersBlockingOrgType`(与 rbac 那条同型的跨插件问询,**不另建约束注册表**,org 因此 inject auth),新错误 `ORG_NODE_PLACEMENT_INCOMPATIBLE` 带 userCount。④**tenant 角色也校验资格**——`assertGrantEligible` 旧代码在 `kind === 'tenant'` 分支**直接 return**,跳过 `role_allowed_user_types`,于是「全校审核员只发给师生」这种约束对租户级角色完全不生效;资格检查上移到 kind 分支之前(canonical tenant-admin 经 `system_key` 豁免,它是恢复入口),`assertComplete` 相应要求任何角色激活时至少一个可授予用户类型(org 角色再加节点类型),`syncRoleEligibility` 放行 tenant 角色。**顺带发现并修掉一个静默 bug**:eligibility 收窄时的 stranded 查询用 `join org_nodes on n.id = g.org_node_id`,而租户授权的 org_node_id 是 NULL,内连接把它们全丢了——改 left join 后实测收窄租户角色会正确报 `GRANT_STRANDED`。⑤**站位不变量单源**——`placementLegal(type, orgTypeId, atRoot)` 一个谓词,写入校验、org 问询、全量扫描共用;seed 测试新增全租户扫描断言零违规,并断言每个类型都显式声明了 mode。**P1 四条**:`/iam/user-type-options`(归 `auth.user-type.read`)取代用户类型页借用 `access.getRoleOptions`(那要 `iam.role.read`,合法的类型管理员只会看到空下拉框,违反已冻结的 options 纪律);`grantOptions` 把 `GRANT_USER_NOT_FOUND`/`GRANT_NODE_NOT_FOUND` 移出「不可授予」集合并改为请求开始时一次性校验,不存在的 id 现在 404 而不是「没有可选角色」;迁移 fix-forward `20260803221952_placement-policy` 清理 `auth.portal.access` 僵尸权限与因此变空的迁移角色、把 `migrated-*` 置 `assignable = false` 并补上它们各自来源用户类型的资格、对「同时存在 administrator 与 system-account」和「系统身份不在根」两种混合状态 `RAISE EXCEPTION` 硬失败。用户创建表单按所选节点的类型过滤可选用户类型(选项已带 policy,不再把规则变成报错)。
- [顺带修掉的三处存量] ①**org 的约束翻译名陈旧**——`fk_user_role_assignments_node` 在上一笔改名后已不存在,删除仍有授权锚定的节点会把裸 SQL 报错抛给调用方而不是 `ORG_NODE_IN_USE`(org 测试实锤);②**retype 用户还在查已删除的表**——`updateUser` 的 assignment 兼容性检查仍 `from user_role_assignments`,这是**运行期必炸**的死代码,改查 `role_grants` 并去掉只看 org 角色的 join(租户授权同样会被改类型弄失效);③server readiness 测试仍期望裸装配即 ready,改为断言装配门(503 `assembly: pending`)与 `markAssemblyComplete()` 之后的 200。
- 评审修复验收:`pnpm db:reset` 后 **13 条迁移在空库全量重放**、seed 一次建全(3 用户类型 / 2 角色 / 6 授权),全租户 placement 违规 **0**;HTTP 实测——空 allow-list 400、收窄有人站的类型 409 `USER_TYPE_PLACEMENT_IN_USE{userCount:1}`、改系统类型策略 409 `USER_TYPE_IS_SYSTEM`、把恢复账号调出根 409 `USER_TYPE_PLACEMENT_NOT_ALLOWED`、班级改专业方向(树规则允许)409 `ORG_NODE_PLACEMENT_INCOMPATIBLE{userCount:1}`、不存在的 user/node 404、租户角色无资格不能激活(`ROLE_INCOMPLETE{missing:['user-types']}`)、只发学生的租户角色授给教师 409 `GRANT_NOT_ELIGIBLE{reason:'user-type'}`、收窄到学生而教师持有时 409 `GRANT_STRANDED`、同策略重写版本不变(3→3);浏览器实测用户类型页新表单与编辑器(策略二选一、allow-list 空则按钮禁用)。`pnpm typecheck` 11 个工程全跑,只有两个待重写的测试文件报错;node 套件 **125 passed / 0 failed**(较修复前 92 passed / 6 failed,org 套件 17 条全部恢复);`pnpm build` 通过,日志零 `[E]`。**仍未做**:`rbac.test.ts` / `iam.test.ts` 按新模型重写(48 + 16 个类型错误),`apps/web/tests` 的 browser fixture 契约漂移与该目录不在任何 tsconfig 的类型盲区,以及评审 P2 的「无刷新登录/退出 browser 回归测试」「缩小 session transition 的 reset 范围」——都留到 P1 收尾一并做。**未采纳一条并记录理由**:评审建议加 `GET /iam/placement-violations` 诊断端点;不变量本身已按「解释与判定同源」做成单一谓词并有全量扫描断言,但端点是新的 API 面(要冻结、要授权、要文案),按 CLAUDE 的冻结元规则「复杂度必须由已发生的问题证明」暂不建,触发条件是出现一次真实的线上站位漂移需要运维自查。
- [访问模型二轮评审修复] 六项边界与迁移语义(2026-08-04):评审确认主干设计成立、不需再动模型,只修边界。**三项影响最终 API 或安全语义的**:①**系统角色豁免过宽**——`role.system_key === null` 表达的是「所有系统角色都豁免资格检查」,而注释写的是「只有 canonical administrator」;当前库里只有 tenant-admin 一行所以还没出事,但下一个系统角色会白捡这个旁路。新建 `@qualy/rbac-contract` 的 `isCanonicalTenantAdmin` / `canonicalTenantAdmin(alias)`(按 `system_key + permission_mode + kind` 整体形状判定,TS 与 SQL 各一份、同一处声明),rbac 的资格检查与 auth 的改类型 SQL 共用。实测:塞一个 `system_key='audit-bot'` 的角色进去,授给学生 409 `GRANT_NOT_ELIGIBLE{reason:'user-type'}`。②**恢复账号本体可变**——此前只挡住「把普通人改成系统类型」,没挡住反向:把恢复账号改成教师类型,它的 tenant-admin 授权因 canonical 豁免仍然有效,却丢掉了 root-only 站位与「必须保留密码登录」;停用它也只被「还有别的管理员」挡着,而那不等于租户还能自救。新增 `SYSTEM_ACCOUNT_PROTECTED`,系统身份的类型、状态、位置一律冻结,改名等展示字段照常(实测三项 409、改名 200)。③**版本协议只做了一半**——`version` 已是整行版本(profile/status 都涨),但只有 placement policy 接口要 `expectedVersion`,于是普通改名能覆盖并发写、还会让正在编辑策略的页面莫名冲突。按 rbac 的既有协议(它的 delete 也要版本)补齐 PATCH / status / placement-policy / DELETE 四个入口,写响应统一回 `{version}`,状态未变则不涨版本(实测无版本 400、旧版本 409 带 currentVersion、正确版本 200 回新版本、同状态 PUT 版本 3→3)。**三项迁移语义**:④`LIKE 'migrated-%'` 会误伤管理员自己起名叫 `migrated-auditor` 的合法角色,改成 `^migrated-[0-9a-f]{32}$` 精确正则,置 assignable 那步直接 join 来源用户类型;⑤删除 `auth.portal.access` 后,管理员自建的「只有门户权限」角色会变成 active 且零权限——违反刚立的生命周期不变量而迁移不拦,补 preflight 列出这些 code 并 `RAISE EXCEPTION`(删/停/补权限是管理员的决定,不是迁移文件的);⑥`placement_mode` 的数据库默认值让 seed、导入脚本、裸 SQL 都能靠省略造出一个不受限类型,与刚冻结的「创建必须带 policy」自相矛盾——回填后 `DROP DEFAULT`,drizzle schema 同步去掉 `.default()`。**这一条立刻见效**:五个测试 fixture 的 `insert into user_types` 当场炸出来,全部补上显式策略(实测裸 insert 被数据库拒绝)。**顺带五个小项**:系统类型的 DTO 改报 `{mode:'tenant-root'}`(它存的 allow-list 谁都不看,报出来会被误读成「任何 university 节点都行」),seed 因此不再给它写那行假配置;`ASSIGNMENT_INCOMPATIBLE{assignmentCount}` → `GRANT_INCOMPATIBLE{grantCount}`(库和 API 早已全面改叫 grant);demo seed 的允许组织类型只在**类型首次创建**时写入,不再每次运行把管理员的收窄改回去;route builder 的首页候选只从**能挂载的页面**里选(引用了缺 provider 布局的页面会被丢出路由树,重定向过去等于绕一圈落到 404),补一条测试;STATUS 里会话 6.3 那句「空集 = 不约束」标注为已被后续修复替代。
- 二轮修复验收:空库 13 条迁移重放 + seed 一次建全;`placement_mode` 的 `column_default` 为空且 NOT NULL,省略该列的裸 INSERT 被数据库拒绝;系统类型 `/placement-policy` 返回 `{'mode':'tenant-root'}`;`pnpm typecheck` 11 个工程全跑、只有两个待重写文件报错;node 套件 **126 passed / 0 failed**(org、schema、local-login 三个套件在 fixture 补齐后全绿);`pnpm build` 通过;浏览器复测 404 外壳、无刷新登录(5 个导航项)、用户类型页三段文案齐备;日志零 `[E]`。
- [测试重写与收尾] 两个陈旧套件重写 + 迁移升级测试 + 浏览器 fixture(2026-08-04):四个文件并行重写(rbac.test 933→1597 行 21→27 例、iam.test 618→1101 行 13→20 例、identity.browser.test 8→9 例、新建 migration-upgrade.test 777 行 15 例)。**重写纪律**:旧断言若因**意图变了**而不再成立,一律替换为钉住新意图的断言而不是删掉;三处被删的机制(权限双通道 grant_to_user_type/grant_to_role、permissions.enabled、defaultTenantAdmin)各自换成对应的新不变量(数据库约束集、读路径复核存储定义的 code/plugin/target_kind、all-active 只持有 active 集)。**迁移升级测试**是此前完全缺失的一层:空库重放证明不了任何 UPDATE/DELETE 分支,新测试按序执行迁移到指定一条、写入旧形态数据、再跑完剩下的,覆盖八个场景(逐类型兼容角色不做权限并集、assignable=false 与资格继承、portal.access 清理与空角色删除、管理员自建 portal-only 角色硬失败、名叫 migrated-auditor 的合法角色不被误伤、placement_mode 回填两个分支与去默认值、administrator/system-account 混合状态硬失败、系统身份不在根硬失败),并断言失败场景回滚后留下的是**旧 schema** 而非半转换状态。**apps/web/tests 纳入 typecheck**——fixture 正是在这个盲区里漂了整整一轮;仅加 include 还不够(harness 的 fakeClient 收 Record<string, unknown>),把 fixture 工厂与 stub 表按契约 DTO 定型才让它成为真门禁,实测改名字段与漏字段都会在编译期红。
- [测试重写期发现的产品缺陷] **数据库 CHECK 被 NULL 击穿**(rbac/src/db/tables/roles.ts):`chk_roles_all_active_is_system` 写的是 `permission_mode <> 'all-active' OR system_key = 'tenant-admin'`,当 `system_key IS NULL` 时右操作数为 NULL,整个表达式 `false OR NULL` = NULL,而 **Postgres 接受求值为 NULL 的 CHECK**——于是「第二个 all-active 角色」这个它专门要挡的行被放行(实测 `INSERT 0 1`)。这行不是 canonical administrator(`isCanonicalTenantAdmin` 要求 system_key='tenant-admin'),因此不受任何保留规则约束,但 `REACHES_EVERY_NODE` 只看 `permission_mode = 'all-active'`,拿到它就等于每个节点上的每一项能力。API 路径写不出这行(createRole 硬编码 draft/explicit),而**这正是把保证放在数据库层的理由**:psql / ETL / seed / 迁移都能写。修法 `IS NOT DISTINCT FROM`,fix-forward 迁移 `20260803233609_all-active-null-check` 并带 preflight(已存在这种行就点名报错,不静默删授权);全库扫描确认只有这一条 CHECK 有该形态(org 的两条用的是正确的 `IS NULL OR` 写法)。**记录但未修**:`20260803201110` 生成兼容角色名用 `left(name,80) || ... || left(uuid_hex,6)`,而 UUIDv7 前 6 位十六进制是毫秒时间戳高 24 位,同一 ~4.66 小时窗口内铸造的 id 全部相同,因此同租户两个「前 80 字符相同、100 字符内才分叉」的类型名会撞 `uq_roles_tenant_name`,迁移以裸 23505 中止而不是它自己写的那句友好 preflight。事务回滚、不损坏数据,严重度低;**不修的理由是这条缺陷在已应用迁移的文件内部,无法 fix-forward**,而改写已应用迁移违反 CLAUDE 的迁移纪律——需要时由用户裁决是否破例改那一行。
- 收尾验收:`pnpm typecheck` **exit 0,11 个工程全部零错误**(本轮首次);`pnpm test` **29 文件 188 例全过、零失败零跳过**(会话开始时是 92 passed / 6 failed / 51 skipped);`pnpm test:browser` 9 例全过(耗时由 98s 降到 8.7s,此前的时间全花在定位器超时上);`pnpm build` 通过。空库重放 **14 条迁移** + seed + 浏览器无刷新登录(5 个导航项)+ `/health/ready` 双探针 ok + 日志零 `[E]`。**落地自查**:三处针对性变异(把豁免放宽回所有系统角色、废掉恢复账号冻结、让空 allow-list 重新读作「不限制」)分别被 1、1、4 个用例杀掉,变异后 `git checkout` 复原,产品源零残留改动。
- [P1 会话 6.4] 评审修复(2026-08-04,四项,做完即冻结):①**删除用户类型只保护了 org 角色**——`deleteUserType` 的 stranded 查询带 `r.kind = 'org'`,而现模型要求两种 kind 都必须声明可授予用户类型。路径:建 active tenant role → 它只允许类型 T → T 无人使用 → 删 T → 资格行级联删除 → 留下一个 active 但谁都授不了的角色。不提权,但正是生命周期要防的 inert 状态;去掉 kind 限制,补 tenant role 回归测试(实测:改回 `kind='org'` 该用例即红)。②**停用插件期间保存角色会永久删除该插件的权限行**——`syncRolePermissions` 删掉「不在 wanted 里」的全部 role_permissions,而编辑器只把 **active** 权限放进选择状态,`unavailablePermissions` 完全没参与;于是管理员改一个无关权限就把停用插件的授权抹掉了,插件恢复后不会回来。这直接违背「停用不改变聚合(表与数据保留)」,也会让会话 7 的 dict 停用/恢复目标失败。修法:删除范围限定为**当前 registry 在供的那些码**——没被供出来的行,调用方并没有「取消勾选」它。补生命周期测试(持有 suspendable.thing.read → 停用插件 → 保存别的权限 → 该行仍在 → 恢复插件 → 能力回归;实测:去掉限定该用例即红)。③**角色创建表单收集三组数据然后全部丢弃**——`NewRoleForm` 渲染权限、可授予用户类型、可锚定节点类型三个 picker 并以它们为提交前置条件,实际只发 `{code, name, kind:'org'}`,成功后又把本地选择清空;kind 还硬编码成 org,而 `RoleEditor` 只给 org 角色渲染可授予用户类型,后端却要求 tenant 角色同样必须配置才能激活——租户角色因此在界面上根本配不出来。改成:创建只承载身份与 **kind**(新增 tenant/org 单选,kind 建后不可改所以在此选),三个 picker 删除;编辑器对两种 kind 都渲染可授予用户类型,只有 org 角色渲染锚定节点类型。`@qualy/ui` 补 `RadioGroup`(与 CheckboxGroup 同型:真 fieldset + legend + radio,可按 role/name 驱动)。④**迁移兼容角色名可能撞车**——`left(name,80) || … || left(uuid_hex,6)`,而 UUIDv7 前 6 位十六进制是毫秒时间戳高 24 位,同批铸造的 id 全相同;两个「前 80 字符相同、100 字符内才分叉」的类型名会撞 `uq_roles_tenant_name`,迁移以裸 23505 中止,而预检只比对「生成名 vs 已有名」,catch 不到「生成名 vs 生成名」。**经用户批准破例修改已应用迁移**(理由:P1 未收口、无不可重建的外部数据库、缺陷位于会阻断后续迁移的迁移自身因而无法 fix-forward),改为 `left(name,61) || ' 原有权限 #' || replace(id,'-','')`(61+7+32=100,完整 UUID 后缀确定唯一),补升级测试(两个类型名前 80 字符相同且 id 前 6 位相同 → 迁移成功 → 两个角色名不同且 ≤100;实测:改回旧表达式该用例报 duplicate key)。
- 会话 6.4 验收(冻结点):空库 **14 条迁移**重放 + seed 一次建全;`pnpm typecheck` exit 0、11 个工程;`pnpm test` **29 文件 190 例全过**;`pnpm test:browser` **10 例全过**(新增「按表单实际要的东西创建角色,含 kind」,断言 `createRole` 收到 `{code,name,kind:'tenant'}` 且页面上不再出现创建期用不到的三个 picker);`pnpm build` 通过;drop-guard 全史 14 文件干净;`drizzle-kit generate` no-op(schema 与改后的 lineage 一致);HTTP 实测租户角色全链路(建草稿 → 给 tenant 目标权限 → 只配用户类型不配节点类型 → 激活)全部 200;日志零 `[E]`。**过程教训**:变异验证后用 `git checkout` 复原产品源,会连**尚未提交的本轮修复**一起还原——这一轮踩了两次(迁移一次、两个 service 修复一次),都是全量套件跑出来才发现。以后变异验证一律先 `git stash` 或改用副本。
- **未采纳评审的一处建议并说明**:评审建议把 `unavailablePermissions` 在编辑器里显示为「所属插件当前未加载,权限已保留」的只读提示。后端语义已按建议改(保存不再删除),但只读提示属于会话 7 dict 生命周期的展示需求,留到会话 7 与「停用插件后页面/权限如何呈现」一并设计,避免现在先造一个届时要重做的 UI。
- [P1 会话 6.5] 测试分层收口(2026-08-04):六个业务插件套件各自持有一份 PostgreSQL 生命周期——探测服务、造库名、admin Pool 建库、定位迁移目录、手工 `runMigrations`、再以 `migrations: 'off'` 起 Database 插件、维护两个 Pool、`drop database ... with (force)`,还都靠 `pool.on('error', () => {})` 吞掉强杀连接的后果。**同一个库两个所有者,插件自身的 init/dispose 路径从来没被测过**。收口为 `createTestContext()`:按**生产路径**注册 Database(`migrations: 'apply'`,于是每个套件顺带证明迁移 lineage 仍可从空库应用),dispose 时先 `ctx.fiber.dispose()` 再 drop:**正常路径永不 force**(实测六个套件全部不再需要,`pg_database` 零残留,原先那句吞错误的 handler 掩盖的只是它自己制造的竞态);force 只在普通 drop 已失败之后用于清除残留,且每一步的错误都收进 `AggregateError` 抛出——**强制清理成功不得把一次失败的 teardown 变绿**。三条泄漏路径一并堵掉:建库失败不再漏掉 `admin.end()`、init 失败先 dispose 已注册的 effect 再清理且保留原始错误、`fiber.dispose()` 抛错不再跳过后面的 drop 与 `end()`。**放在哪里换了一次判断**:先建了平级的 `@qualy/test-support`,评审提出这只是把越层从六个文件搬进一个包——核对后同意,`pg`、连接串、迁移目录都是 database 插件的领域,于是整体移进 `@qualy/plugin-database/testkit`(四个业务插件本来就都依赖该包,零新增依赖边),`@qualy/test-support` 删除。**约束测试照旧直接写非法 SQL**(约束的价值就在于挡住 service 永远不会发的东西),只是经 `db.query()` 而不是自己的 Pool。
- [收口期发现的三处实情] ①**drizzle 包裹驱动错误**:SQLSTATE 在 `error.cause` 上,顶层 `.code` 是 undefined——旧的 `pgCode` 一旦走 drizzle 就会静默返回 undefined,`expect(...).toBe('23505')` 这类断言会**从此不再断言任何东西**。共享 `pgCode` 走 cause 链。②**drizzle 把顶层数组展开成 `(a, b)` 内联列表**而不是绑成一个数组参数,`= any($1::uuid[])` 因此变成 postgres 拒绝的 record cast;改用 `sql.param()` 绑定后恢复原样(三个 agent 各自独立撞上同一条,已在 harness 修掉并把被绕开的语句改回)。③**cordis 的 `fiber.dispose()` 吞掉抛错的 disposer**(resolve 而非 reject,已实查),所以 harness 报不出插件的释放失败,能报的只有 postgres 拒绝的那些——这条写进 CLAUDE 与 testkit 测试的注释,免得后人以为 teardown 覆盖了插件泄漏。④`noUncheckedIndexedAccess` 下 `rows[0].x` 一律报错——旧代码只是因为 `@types/pg` 把 rows 标成 `any[]` 才没暴露;harness 补 `row()` 访问器,"insert ... returning id 没返回行"当场报错而不是三行之后空指针。
- [硬门禁] scripts/tests/test-layers.test.ts。初版只扫 `**/tests/**` 且"豁免清单"其实只断言路径还在、没参与判定,评审指出这两点后重写为四条:①扫**整个 `packages/`**,除 `plugins/infra/database/**` 外一律禁 `from 'pg'`、`new Pool(`、`plugin-database/migrator`、`process.env.DATABASE_URL`、`QUALY_REQUIRE_POSTGRES_TESTS`、`create/drop database`(不再依赖测试目录命名,挪进 `src/` 也跑不掉);②`scripts/` 用**文件级**白名单(seed 的公开入参就是 PoolClient),不是整目录豁免;③扫全仓 package.json,除 database 外不得声明 `pg`/`@types/pg`;④**生产源码不得 import 任何 `/testkit`**。另把本轮迁移的六个套件按**精确路径**钉住,删/挪/改名当场红。四条都做了破坏性验证:把套件挪进 `src/`、改掉六个之一的文件名、在 `apps/server/src/main.ts` 里 import testkit、给 rbac 加回 `pg` devDep,分别被对应的那条抓到。
- [6.5 评审补强] 两份审计一致裁定不做 vitest 插件、不做跨插件 fixture、不搬测试,但指出四处收尾问题,已在同一提交内补齐:①testkit 的三条失败清理路径(建库失败漏 `admin.end()`、init 失败 force drop 且掩盖原始错误、`fiber.dispose()` 抛错跳过全部后续清理)统一收进 `teardown()`,收集全部错误抛 `AggregateError`;②分层门禁的"豁免清单"原先只断言路径存在、没参与任何判定,且发现规则只认 `**/tests/**`——挪进 `src/` 或 `__tests__/` 即可绕过,已按上一条重写;③CLAUDE 里"禁止为测试给生产包开 test-only 导出"与新增的 `./testkit` 子导出字面冲突,规则改精确为"禁止暴露内部实现;资源所有者可提供显式 `<包>/testkit`,不进包根、生产源码不得 import";④testkit 自己没有回归测试,新增 `database/tests/testkit.test.ts` 七例(cause 链取 SQLSTATE、数组绑成单参、`row()` 拒绝空结果、正常 dispose 后库消失、init 失败零残留、teardown 失败必须报出、以及"cordis 吞 disposer 错误因此 harness 看不见"这一条的成文记录)。顺带删掉 iam.test 里手工拼 `{a,b}` 数组字面量的绕法——testkit 修好后两种参数约定不该并存。
- 会话 6.5 验收:`pnpm typecheck` exit 0、11 工程;`pnpm test` **30 文件 194 例全过**;`pnpm test:browser` 10 例全过;`pnpm build` 通过;空库 14 条迁移 + seed;`pg_database` 中 `qualy\_%` 残留 **0**。
- **未采纳评审的更大方案并说明理由**:评审进一步建议做 `@qualy/vitest-plugin`(按装配清单探测 database 能力、动态生成 unit/postgres 两个 vitest project、`*.db.test.ts` 命名分流、`dbTest` fixture 取代 `beforeAll`)。**采纳了其中的结构判断**(testkit 归 database 插件),**未采纳其余**:①按冻结元规则,已发生的问题是「六份重复 + 双所有者 + 吞错误 + pg 越层」,这些已经全部消除,而 project 分流解决的是「第三方无数据库仓库跑 vitest」与「装配里停用 database 时不加载 db 测试」——都还没发生;②(此处原先写的理由是错的,评审指正:vitest 4.1.10 的 fixture 支持 `scope: 'file' | 'worker'`,实查 `@vitest/runner` 的 `FixtureOptions` 确有该字段,所以「改 fixture 就必须每个用例重建库」不成立,性能不是阻碍)——真实理由是改过去会同时引入 project 拆分、文件命名协议、fixture 作用域、worker 生命周期、装配能力探测与 CI 调度六件事,而它们对应的收益都还没出现;③`*.db.test.ts` 改名 + 第二层 vitest 配置是一次覆盖六个文件的返工,而门禁已经能拦住第七次复制。**重评触发条件**:出现不带 database 的独立插件仓库、或装配清单里真的需要停用 database 还要跑测试、或 db 测试多到需要与 unit 分开调度。
- [插件数据库能力现状实测] 用一个临时选装插件走真实流程,得到四条事实(与外部分析的部分转述不符,以实测为准):①**插件带表已经是全自动的**——package.json 声明 `qualy.database.schemaEntry` + 写进 qualy.yml + `pnpm db:generate`,迁移自动生成,安装者不需要碰 migration.sql;②**插件带 function/trigger 没有任何携带入口**——scripts 里零 behavior 支持,只能由宿主手写 custom 迁移,这是真实缺口;③**从 qualy.yml 删掉条目会生成 `DROP TABLE`,但被 drop-guard 拦住**(需要 `ALLOW_DESTRUCTIVE=1` 或迁移内显式批准),所以今天已经是 fail-closed,不会静默删数据;④**`disabled: true` 是正规停用方式**——表保留、generate 零 diff,与 `readEntries({ all: true })` 的语义一致。当前库里 Qualy 自己的 trigger/function 数量为 **0**(pg 里那批 ltree_* 是扩展自带);历史上 `20260802150059_rbac-grant-channel-triggers` 建过两组,访问模型重构时因为它们读的列已被删除而一并 DROP。
- [从 0 部署验证抓到的 P0] 按「新克隆者」跑 空库 → `db:migrate` → `seed` → `dev`,发现 **`/health/ready` 的第一个应答是 `{"status":"ready","checks":{}}`** ——零探针却报 ready,正是装配门要防的那件事。**门本身没错,是 `main.ts` 在错误时刻开的门**:`ctx.inject(['server'], ...)` 在 server 服务一出现就触发,那是装配**进行中**,不是装配之后(实测 +200ms 只有 server/db,+800ms 才齐全)。loader rc.5 不暴露任何 settled 承诺(`loader.create()` 返回字符串不是 fiber,`loader.root` 无 fiber,`ctx.fiber.await()` 立即返回且服务全无),最终用 cordis 已声明的 `internal/status` 事件观察 fiber 状态:没有 PENDING/LOADING 且连续两次静默即视为装配完成(实测 927ms 齐全),60s 未静默则**保持 readiness 关闭并响亮报错**——起不来的实例就该答 not-ready,liveness 仍然响应,编排器分得清。修后首个应答变成 `503 {"status":"not-ready","checks":{"assembly":"pending"}}`。
- [从 0 部署验证抓到的第二个 P0] `migrations: 'off'` 只打一行「交给外部迁移 Job」的日志就放行,**数据库落后也照常启动**——随后表现为缺列缺表,离原因很远,而编排器看到的是一个健康实例在服务落后一个版本的库。migrator 新增 `pendingMigrations()`(账本已应用数 vs 目录内已提交数),off 模式下有待迁移即**拒绝启动**并指出跑 `pnpm db:migrate`。lifecycle 测试相应改为两条:未迁移时拒启且没建任何表、已迁移到位时正常启动。
- 验收:`pnpm typecheck` exit 0;`pnpm test` **31 文件 203 例全过**;`pnpm build` 通过;从 0 部署重跑一遍——空库 14 条迁移 + seed + ready 双探针 ok + 登录 200 + 日志零 `[E]`。
- [clean-room 装配实测推翻上一轮结论] 上一轮我判断「插件带 trigger 的携带机制触发条件未发生」——**错了**。评审指出我的实验只证明了「在现有 14 条 lineage 上加插件」,没证明「任意组合能从零建立自己的 lineage」。照做:挑三组插件、各自空迁移目录、`drizzle-kit generate` 建 baseline、部署到空库——**三组全部失败**,包括默认全装配,错误是 `type "ltree" does not exist`(42704)。根因:`CREATE EXTENSION ltree` 只活在宿主手写迁移 `20260801222248_org-ltree` 里,而 `drizzle-kit generate` 只复现表。**那条迁移的注释本来就写着 `-- owner: @qualy/plugin-org`——归属早已声明,缺的只是承载入口**。所以缺口不是「将来可能需要 trigger」,而是**org 插件今天就不自包含,换一组插件从零装配根本装不起来**,只是被现有 lineage 掩盖着。触发条件的正确表述是「插件需要携带 Drizzle 表达不了的 SQL,且安装者不应手改宿主迁移」,与 trigger 数量无关。
- [落地] ①**`baselineDir` 片段编译**:插件声明 `qualy.database.baselineDir`,目录内 `NNNN_*.sql` 由新的 `pnpm db:generate`(`scripts/db-generate.ts` 包住 drizzle-kit)编进中央迁移——`-- phase: pre-structure` 排在结构 SQL 之前(扩展必须先于用它的列建),默认 post-structure 排在之后(trigger 要等表建好);片段带 `-- qualy-baseline: <插件> <路径> <sha>` 标记写进迁移,**已编译片段不可再改**(改了硬失败,要改就新增片段覆盖——数据库已经跑过它,改源文件会让 lineage 与包对不上),重跑 no-op,disabled 插件仍贡献。baseline 片段**必须幂等**(`IF NOT EXISTS` / `CREATE OR REPLACE` / `ON CONFLICT DO NOTHING`),这是它与一次性 custom 迁移的分界。org 据此把 ltree 收回自己包里。②**`dependsOn` 解析期校验**:schema 引用别的插件的表就声明依赖,缺依赖的装配现在报 `rbac needs @qualy/plugin-auth`,而不是迁移到一半由 postgres 报 `relation "user_types" does not exist`(第三组 clean-room 用例暴露的)。auth→org、rbac→org+auth 已声明。③**clean-room 成为常驻测试** `scripts/tests/assembly.test.ts`(6 例):最小组合与全装配都要能从零生成 lineage 并由 database 插件按**生产路径**部署到空库(断言表建出来了、ltree 扩展确实先落地)、缺依赖组合解析期即拒、片段不可变、重跑 no-op。
- 验收:`pnpm typecheck` exit 0;`pnpm test` **32 文件 209 例全过**;`pnpm test:browser` 10 例;`pnpm build` 通过;真实仓库从 0 部署——空库 **15 条迁移** + seed + ready 双探针 + 登录 200 + 零 `[E]`。
- **仍未做,给出触发条件**:`qualy.lock.json`(触发:需要跨环境复现精确装配,或删条目要与「从未装过」区分)、自定义 assembly loader 替换 include(触发:装配完成信号之外还需要 include 挡住的能力——注意 readiness 那条已经用 `internal/status` 绕过了)、purge 状态机与 installEpoch(触发:决定实现自动卸载)、provision DAG(触发:中央 seed 拆成插件级时)、setup 询问框架(触发:出现第二个需要交互配置的插件)、CLI(触发:命令数量多到记不住)。**每装配独立 lineage** 现在已经可行(clean-room 测试就是证明),但仓库仍只维护默认装配那一条,这是产品形态问题不是能力问题。

- [装配阶段 1] qualy.yml 产品清单 + qualy.lock.json(2026-08-04):按 docs/assembly-design.md §23/§24 落地装配基座。新包 **@qualy/assembly**(零 cordis 依赖,manifest/hash/graph/metadata/resolve/lock/runtime-plan),`packages/app` 与 `scripts/` 共用同一份解析器。
- **清单改键控映射**:`version: 1` + `plugins:` 以插件 id 为键,重复键、未知顶层键、未知条目键、旧数组格式全部拒绝(旧格式是合法 yaml,不拒会静默解析成零插件)。文件顺序无语义,`manifestHash` 排序后计算,注释与引号风格不进哈希。
- **状态机 active / disabled / detached**:移除一个拥有数据库对象的插件 → detached(schema 与 baseline 照常贡献,drizzle 看不到表消失,不生成 DROP);移除一个什么都不拥有的插件 → 直接离开 lock(否则积压永远删不掉的死条目,purge 尚未实现)。detached 插件的包被卸载 → resolve 硬失败并说明数据还在。`readEntries`(选中集)与 `retainedEntries`(retained 集)分家,此前 `--all` 一个开关同时表达两件事。
- **图的裁剪(与设计文档不一致处,已实证)**:①**不建运行时图**——读 cordis loader 源码确认 `EntryGroup.update` 用 `Promise.all` 并发创建全部条目、激活由 `inject` 门控,条目顺序不决定任何事;而 `pnpm install` 当场警告 org↔rbac 已是 workspace 循环依赖(org 的 devDependencies),用包依赖当运行时图会把一个合法状态变成硬失败。runtimeOrder 因此就是按 id 排序。②数据库图保留为硬约束:缺依赖、成环在 resolve 期失败并打印环路径。
- **lock 只记装配语义**:插件版本/状态/database 声明/两条拓扑序 + `manifestHash` + `resolutionHash`;原子写(tmp + fsync + rename)。**测试发现的真洞**:只比对「解析结果的哈希」抓不到手改 lock——改内容不改哈希时两边都等于原值。补 `lockSelfHash`,先验 lock 内容与自身哈希一致,再验是否等于当前解析结果。
- **cordis.gen.yml**:清单是产品选择,loader 要的是条目数组,派生文件做翻译(gitignored,`pnpm gen` 产出)。条目 id 由插件名派生——loader 的 `ensureId` 用 `Math.random()` 补 id 并写回读到的文件,派生 id 让它无事可做,人手维护的清单不再被机器改写。
- **start 只校验不修复**:`apps/server/src/verify-assembly.ts` 在 loader 之前解析全部包(loader 对导入失败只记日志,写错的插件本来会静默不装载),清单/lock/条目表任一漂移在 `QUALY_FROZEN_LOCKFILE=1` 下拒绝启动,否则告警继续。
- **readiness 改用官方信号**(读 loader 源码后的更正):上一轮写的「loader 没有 settled promise」是错的,`ctx.loader.await()` 就是——它循环等每个条目的 `_initTask || fiber.inertia` 直到全空,每轮重取所以后建的条目也等得到。50ms×2 静默轮询与 `internal/status` 监听全部删除。**实测**:`await()` 1008ms resolve,`inject(['server'])` 693ms;`intercept('loader',{await:true})` 装配前注册 1ms 就触发、装配后注册再也不触发,不可用(细节入 notes/cordis.md)。
- **CLI**:`pnpm qualy resolve [--frozen-lockfile] [--yml <path>]` 与 `pnpm qualy plan`;frozen 零写入(包括派生条目表)。`plugin:add` 收尾自动 resolve。
- **测试**:新 `scripts/tests/support/workspace.ts` 造真临时 assembly workspace(自带 qualy.yml / lock / migrations / node_modules,node_modules 是指向真实包目录的符号链接目录,包各自的依赖照常从 pnpm 放的位置解析)。`assembly-resolve.test.ts` 21 例(清单格式、两次 resolve 同字节、键序无关、缺依赖、成环、detached 三态、frozen 三种漂移、派生条表确定性、仓库自身 lock 与清单一致);`assembly.test.ts` 6 例改跑真 workspace,新增「detached 插件的表留在 lineage 里且不生成 DROP」;`invariants.test.ts` 补移除等价于停用一例;`generators.test.ts` 的「同一插件装两次」用例失去意义(键控映射不可能表达),改为断言生成的契约聚合里没有命名空间被两次认领。
- 验收:`pnpm typecheck` exit 0;`pnpm test` **33 文件 231 例全过**;`pnpm test:browser` 10 例;`pnpm build` 通过;真实仓库从 0 部署——空库 15 条迁移 + seed + **首个 ready 应答是 `503 {"assembly":"pending"}`、169ms 后转 200**(门禁实证,不是事后观察)+ 登录 200 + 零 `[E]`/`[W]`;frozen 启动对改过的清单拒绝、非 frozen 告警继续,均实跑。
- **本阶段没做,触发条件**:purge / installEpoch(触发:决定实现自动卸载,或 detached 插件的包必须能被卸载);provision DAG(触发:中央 seed 拆成插件级);setup 询问框架与 `${secret:}`(触发:出现第二个需要交互配置的插件;注意 loader 自带 `!!js` 标签插值,派生文件经 `yaml` 包往返会丢标签,真要用得先处理);migration revision / upgradesDir(触发:插件需要给自己的既有表升级);自定义 assembly loader(触发:需要 include 挡住的能力——readiness 已用 `loader.await()` 解决,原设计文档给的理由不再成立);包 integrity(触发:出现第一个来自 registry 而非 workspace 的插件)。

- [装配阶段 1.5] Capability Boundary:核心与数据库分家(2026-08-04):阶段 1 交付后的问题是 `@qualy/assembly` 名义通用、实际内建 Database——`LockedPlugin.database`、`plans.databaseOrder`、`hasDatabase()` 决定 detached、`dependsOn` 校验都在核心里,仓库根还持有 `drizzle.config.ts`、`drizzle-kit`/`drizzle-orm` 依赖与五个 `db:*` 脚本。「Database 是可选插件」因此不成立。
- **新契约包 @qualy/assembly-contract**(零依赖):`AssemblyCapabilityProvider` = `key` / `parseContribution` / `resolve` / `retainsPlugin` / `plan` / `generate` / `deploy` / `commands`,**每一项都有当下的消费者**。核心固定生命周期(`resolve / plan / generate / deploy / <capability> <command>`),插件不得自造阶段。
- **database 语义整体搬进 `@qualy/plugin-database/assembly`**(零副作用子路径,CLI 期动态 import):依赖图、schema 聚合、baseline 片段、drizzle-kit 调用、迁移执行、drop-guard、`check`/`custom`/`studio`/`where` 命令。根删掉 `drizzle.config.ts`、`scripts/db-generate.ts`、`scripts/db-migrate.ts`、`scripts/drop-guard.ts`、`scripts/lib/baseline.ts` 与 `drizzle-kit`/`drizzle-orm` 依赖;`packages/assembly/src/graph.ts` 也搬走(核心不再有图)。
- **lock 分区(lockfileVersion 2)**:`plugins[id].contributions.<key>` 存解析后的声明,`capabilities[key] = {provider, state}` 归 provider 所有——核心序列化、进哈希、frozen 比对,但不解释。`plans.runtimeOrder` 更名 `runtime.plugins`,并写明「排序只保证字节稳定,不表达初始化依赖」。**没有 contractVersion**:capability state 是派生的(resolve 每次重算,`previousState` 只作建议),没有需要迁移的旧状态;触发条件是某能力的 state 出现只有 lock 记得的事实(purge 的 installEpoch)。
- **对抗审阅(8 扫描 + 4 审阅 agent)找出并修掉四个真缺陷**:①provider 只从清单发现——database 与全部贡献方同批离开清单时没人能回答保留问题,每个拥有表的插件会**无声离开 lock**;改为从清单 ∪ 上一份 lock 中仍安装的插件发现,并区分「没人能回答」(硬失败)与「没什么要保留」(正常离开)。②retained 插件的 contribution 从活的 package.json 重建——包若删掉声明,保留判定翻转、表先离开聚合集条目再消失;改为硬失败。③**connection string 会进被提交的 lock**:`providerConfig`(含 `url`)此前传给 `resolve()`,返回值进 state 并被哈希提交;改为只在 generate/deploy/命令的 context 上给。④memo 改存 Promise 后 rejection 被整个进程永久继承;改为 `.catch` 删缓存键。
- **第二轮对抗审阅(5 维 + 逐条反驳)又抓出六个**:①CI 把 `qualy resolve --frozen-lockfile` 放在任何东西生成 `cordis.gen.yml`(gitignored)之前,全新 checkout 必挂——补 `pnpm gen` 前置。②`qualy deploy` 与全部 `qualy database` 命令**不读 .env**(被删的 drizzle.config.ts 与 db-migrate.ts 都读),DATABASE_URL 失效后静默打到 localhost 兜底——CLI 顶部补 `process.loadEnvFile()`。③provider 插件自身离开清单后只多活一次 resolve:它不贡献任何东西,于是下一次 resolve 把它扔出 lock,再下一次就没人能回答保留问题了——发现范围补上 `previous.capabilities[key].provider`,并让「仍在保留别人的能力」把自己的 provider 也保留住(同一棵树连跑两次 resolve 结果一致,已测)。④`qualy resolve` 读上一份 lock 的 contributions(保留判定的依据)却不校验 `lockSelfHash`,手改的 lock 一条命令就被洗成正统——改为 `readLock` 直接拒读被改过的 lock(`lockDrift` 的对应分支随之删除)。⑤`stdio: 'pipe'` 把 drizzle-kit 的 stderr 吞了,失败只剩 "Command failed" 加一个已被删除的临时配置路径——改为把 stderr/stdout 随错误抛出(实测能看到 `notAFunction is not defined`)。⑥drop-guard 的 `--base-ref` 用 shell 字符串拼绝对路径(带空格的检出会裂开)→ 改 execFileSync argv;全量扫描在目录不存在时报「ok, 0 files」→ 改为硬失败。
- **我自己写的门禁被审阅证伪**:`CORE_MAY_SAY` 按**文件**豁免,覆盖了 resolve.ts / lock.ts / metadata.ts,注释里自称要防的 `databaseOrder` 回归照样通过(审阅 agent 注入验证过)。改为剥掉整块注释后零豁免——重新注入 `export const databaseOrder = ...` 现在会失败,移除后恢复通过(实测)。另两处门禁同批收紧:provider 入口的 import 扫描改为**从 package.json 声明发现**(此前写死数据库插件目录,第二个 provider 落地那天不受任何约束);production 侧 testkit 禁令补上带扩展名的相对路径形式。
- **核心里还剩一个能力名**:`RUNTIME_KEYS = ['permissions']` 就是换了个词的 `qualy.database` 硬编码。改为通用规则——顶层 `qualy.<key>` 只有在 `<key>` 恰好是本装配提供的能力时才拒绝(那才是写错位置的 contribution),其余插件间元数据一概不管。
- 另外:旧 `qualy.database` 元数据键因此**硬拒**并指向新位置(静默忽略会让插件贡献为空、表悄悄离开聚合集);frozen 生产默认开(`NODE_ENV=production`,`=0` 才放行);lock 版本更旧不再抛错(抛错会让 `qualy resolve` 自己跑不起来),全 active/disabled 就当无 lock 并重写、一旦有插件正被保留就硬失败列名,版本更新一律硬失败;原子写抽成 `writeAtomic` 并用于 `cordis.gen.yml`(截断的条目表是**合法 YAML 只是少几个插件**);`test-layers.test.ts` 新增三道门禁——核心源码不得出现数据库词汇、`packages/assembly*` 不得声明 drizzle/pg、provider 入口不得静态 import cordis/运行时/testkit/devDependency。
- 测试重新分层:`scripts/tests/assembly-resolve.test.ts` 27 例只测核心(清单、状态机、capability 分区、保留声明、frozen 五态、lock 版本升级、派生条目表);数据库语义移到 `packages/plugins/infra/database/tests/assembly.test.ts` 6 例(baseline、schema 聚合不因停用/移除改变、两组 clean-room 部署、detached 表留在 lineage);workspace helper 提升为 `@qualy/assembly/testkit`。
- 验收:`pnpm typecheck` exit 0;`pnpm test` **32 文件 244 例全过**(vitest 全局 testTimeout 提到 30s:碰 postgres 的套件在第一条断言前要建库并跑完整条 lineage,5s 默认在装配套件加入后已经不够);`pnpm test:browser` 10 例;`pnpm build` 通过;空库 `pnpm qualy deploy` 15 条迁移 + seed + 首个 ready `503 {"assembly":"pending"}`、约 200ms 后 200 + 登录 200 + 零 `[E]`/`[W]`。**无 database 装配实测**(这条才是本阶段的证明):server + ui-registry + api-reference 经 `QUALY_CONFIG` 启动,`capabilities []`,`/health/live` 200、`/health/ready` 200 且 checks 为空、openapi 200。
- **仍留在根的 db 相关物**:`scripts/seed.ts` 与 `scripts/lib/seed.ts` 写 auth/org/rbac 的行,属 provisioning,本设计尚无归属阶段(阶段 4),根因此保留 `pg`/`@types/pg`;`qualy.permissions` 是 rbac 的插件间元数据、不在 resolve 期消费,未提升为能力(触发条件:出现需要 resolve 期校验的权限约束);`db:reset` 做的是 docker compose 的事,留在根。

## Effect 迁移(分支 refactor/effect-platform,进行中)

阶段性总结与要点在 **docs/reports/effect-migration-progress.md**(已完成什么、机制结论、被否掉的方案、
待办与风险);设计与实测细节在 **docs/effect-migration.md**;决策在 docs/adr/0001-0003。这里只记进度与交接。

| 里程碑    | 内容                                                           | 状态                                 |
| --------- | -------------------------------------------------------------- | ------------------------------------ |
| M0 / M0.5 | 依赖栈落地、effect/drizzle 源码 vendoring 与 agent 指令剥离    | e4ca3d5                              |
| M1a       | 数据库切片实测(事务/回滚/中断/savepoint/约束名/ltree/uuidv7)   | 3f2fac8 + 076bfea                    |
| M1b       | HTTP 切片实测(HttpApi、类型化 client、TanStack Query 桥接)     | 13c8016                              |
| —         | Effect LSP 接入 tsc,并用会失败的 fixture 守住 patch 是否还在   | 3d3f7a1                              |
| M2        | 应用外壳(健康探针、配置、组合根、优雅关闭)                     | b989041                              |
| —         | cookie 会话 + middleware 实测,**ADR 0003 放行条件全部满足**    | 603f7ad                              |
| M3        | `@qualy/api` 包边界 + ping 迁 HttpApi + 类型化 client          | 本次                                 |
| M4        | auth/IAM + rbac + org —— **最难的一块**,要真的拆开 org↔rbac 环 | **55/55 路由已迁完**                 |
| M5        | 其余插件按依赖簇迁移(清单 config → layer config 也在这里)      | **完成**(api-reference / dict / web) |
| M6        | 前端切到 HttpApiClient                                         | 待办                                 |
| M7        | 原子切换,删掉 cordis 与 oRPC                                   | 待办                                 |

**M3 交接要点**:插件**不依赖**聚合体——用只装自己一个 group 的本地 `HttpApi` 实现,靠共享的
`QUALY_API_ID` 让类型也对上(源码依据与实跑验证见迁移文档「M3 包边界」)。生成三份产物:
`packages/api/src/api.gen.ts`(只有定义,浏览器读)、`apps/server/api-handlers.gen.ts`(handler,宿主读)、
`apps/server/runtime.gen.ts`(非 API 贡献)。插件声明 `qualy.runtime.api` 指向 group 模块,生成器按
`<ns>ApiGroup` 发现并配对 `<ns>ApiHandlers`,**没人实现的 group 是构建期失败**。

**验收(逐条实跑)**:`pnpm typecheck` exit 0;`pnpm test` **41 文件 281 例全过**;真进程实跑
`/ping/hello?name=ada` → `{"msg":"hi, ada"}`、无参 → `{"msg":"hi, world"}`、openapi 三条路径
(`/ping/hello` `/health/live` `/health/ready`)、`/health/live` 与 `/health/ready` 均 200、
SIGTERM 后端口释放。冻结路径 `GET /ping/hello` 未变,`api-surface.test.ts` 仍绿。

**M4 交接要点**:冻结路由表 55 条**已全部由 Effect 侧提供**,
`scripts/tests/effect-api-parity.test.ts` 从「包含」改成了「相等」——少一条即失败,不再是可以静静漂移的计数。

- **两个运行时共用同一份 SQL**:每个插件一个 `queries.ts`(rbac / auth-iam / org),cordis 服务与
  Effect layer 都执行它;验收方式是「旧测试一行不改仍然全过」。行类型跟着产出它的语句走。
- **推改拉,已用三次**:权限目录、登录驱动、UI 表面。判据是「描述符还是活函数」——描述符(权限码、
  页面、布局、slot)在装配期收齐,活函数(rbac 的 UI authorizer)仍是服务。三个生成器都在**生成期**
  拒绝重复认领(权限码 / provider type / 页面 id、path、layout contract)。
- **UI authorizer 按请求读,不在 layer 构造期读**:构造期读会让 ui-registry 需要 rbac 先构建,而
  `Layer.mergeAll` 不做这种连线,写成 `dependsOn` 又等于让基础设施反向依赖业务插件。按请求读时它是
  per-request requirement,冒泡到组合根被满足;缺失仍是编译错误,不是「悄悄只给公开页面」。
- **游标编解码搬到 `@qualy/api-kit`**,不可用的游标返回 null 而不是抛 oRPC 错误,两侧共用一份格式。
  `pageOf` 的入参约束成无服务需求的 schema:`Schema.Top` 在两个 service 通道里都是 `unknown`,
  会把一个没有名字的 requirement 漏到根 layer。
- **迁移中发现并修掉的真缺陷**:登出在没有 middleware 的端点上用 `serviceOption(CurrentUser)`,
  静默什么都不撤销(答 200 而会话继续可用)——改成按 cookie 里的 token 定位;测试端口 3196 被两个套件
  同时占用,表现为「登录测试连不上自己的服务器」,已加 `scripts/tests/ports.test.ts` 守。
- **已知 flake(与本次改动无关)**:`packages/plugins/infra/database/tests/lifecycle.test.ts` 在 init
  失败后立刻断言 `pg_stat_activity` 为空,postgres 不保证那么快更新该视图。

**M5 进展**:判据是「描述符还是资源」,不是「cordis 里有没有 Service」。

- **api-reference 不需要插件层**:上游自带 `HttpApiScalar.layer`(inline source,不走 CDN),文档本来就由宿主
  提供;它缺的是 exposure 那个决定,而那是**宿主的 setup 声明**——没有任何东西依赖这个答案。已修:
  Effect 侧原先**无条件**同时提供 Scalar 与 openapi.json,生产环境等于把 API 参考公开出去。
  现在 `QUALY_API_DOCS` = auto(默认,非生产才开)/ off / public,且 spec 与 docs 一起开关
  ——只藏文档却照发它渲染用的 spec 等于什么都没藏。三种设置都在真进程上验过。
- **dict 不需要 Effect entry**:它今天贡献的全部是装配期读取、不需要构造的描述符(一个 schemaEntry)。
  理由写在文件里,免得下一个人「因为原来有个 Service」给它补一个。
- **plugin-web 已迁**,它是这批里唯一的真资源。三条上游事实让它不用硬来(路径都实际读过):
  ①`NodeHttpServer.layer` 收的是 `LazyArg<Http.Server>`,而 `HttpServer` 服务只暴露 address 与 serve、
  不暴露实例(`repos/effect/packages/platform-node/src/NodeHttpServer.ts:93-176,445`)——所以**宿主自己建**
  这个实例、发布为 `NodeServer`,同一个对象同时交给平台层和 Vite;
  ②平台写响应的第一行是 `if (nodeResponse.writableEnded) return`(同文件 :508-515),这正是「把请求交给
  Connect 中间件、handler 的返回值被忽略」之所以是**受支持的交接**而不是取巧;
  ③`HttpRouter` 按**特异性**匹配(`HttpRouter.ts:130-200`,find-my-way 风格),所以 `/*` 兜底不会遮住已声明
  路径,注册顺序不构成优先级问题。因此 shell 是 **router 路由**而不是 catch-all endpoint——后者会把浏览器
  外壳写进 openapi 文档。
  **中间件在 layer 构造期建一次,不在 handler 里**:handler 是 Effect 的路由会**每个请求**执行一次,
  那样每次导航都会起一个 Vite server。
  路由贡献像 api handler 一样**生成**(`qualy.runtime.routes` → `routes.gen.ts`),因为装配含哪些插件由清单
  决定,宿主不得点名可选插件。plugin-web **不导出任何服务**,dev server 活在路由层自己的 scope 里。
  **没搬过来的一件事**:cordis 版把 Vite 的 logger 接进运行时 logger 求格式统一;要在 layer 里做需要
  `Effect.run*`,而 source policy 把它限定在进程边界,理由写在调用点上。

**下一步是 M6**(前端切到 HttpApiClient),以及必须先确认的:`@effect/vitest` 在
Vitest browser mode 下能否用(上游无证据)。**建议在 M5 之前先跑一轮逐方法审计**:第一轮审计在 11 条
路由上查出 12 个确认缺陷(含 1 个安全缺陷),现在是 55 条。

## 下一会话(P1 会话 7)

- 会话 7 做 manifest 权限过滤的收尾与 dict 插件。**注意:manifest 授权投影已在前端收口轮提前完成**(ui-registry 单槽 authorizer + 三态投影),§7.1 的 Authorizer 已落地,会话 7 只剩页面权限声明复核与 dict。**会话 6 已沿用的硬约束**:①canonical tenant-admin 五不可变(不可删/禁/改 code/kind/isSystem);②所有跨领域写(用户类型变更、角色 allowed 集合变更、org node 类型变更、org type 删除)对现有 assignment 的一致性必须在同一串行化事务内校验(org 已建 assignmentsBlockingOrgType 与租户行锁范式,会话 6 的用户/角色写复用同锁);③禁用用户/类型即 Session 失效;④tenantId 只来自 principal。**会话 5 遗留的会话 5 原始约束(已在会话 5 落实,存档)**:①org 插件从 scaffold 起即按 errors/repo/service/contract/router/permissions/index 分层(repo 只做租户限定数据访问不抛 ORPCError 不判权限;service 管事务与树不变量不碰 HTTP;router 管校验+requireAt+领域错误映射;contract 纯净;index 组合根);②**组织结构写操作一律先 `select ... from tenants where id=$1 for update` 锁租户行**(create/move/delete/改类型/改规则全串行化,防「A 移入 B 下 ∥ B 移入 A 下」双事务旧快照互过;P1 规模代价可忽略,细粒度锁不做);③move 授权查两端 requireAt(source + destination parent),create→parent、rename/改类型/delete→node、读子树→请求根;④path/depth 是 service 维护的派生投影(parent_id 才是结构关系),move 必须同事务更新整个子树 path/depth/updatedAt,评估 (tenant_id, path) 唯一索引,测试验证 parent 链与 path/depth 恒一致;⑤类型规则多节点环 DB 只拦自环,完整环检测由 service 在串行化事务内做
- 按 docs/p1-tutorial.md 会话 5 执行:组织树领域搬迁(errors→tests→repo→service→contract/router→client 顺序,禁止整目录复制)。旧代码 legacy/qualy_old/apps/api/src/modules/org/;必须保留/新增规则见 5.2(单根/根保护/规则图无环/类型规则校验/自移动+移入后代拒绝/子树 path+depth 事务更新/改类型验 children+现有 assignments 的 allowed org types/删除保护)。org 声明权限接 definePermissions(常量已在 ./permissions);路由鉴权 requireAt(read/manage,目标节点语义见 5.3);OrgPage 最小管理界面(树/选中/CRUD/parent selector 移动,无拖拽)。demo 账号密码 QUALY_DEMO_PASSWORD(dev 库当前 demo 密码 qualy-dev-demo-123)
- 浏览器人工走查(P0-REPORT 第 3 项)在 P1 第一个 commit 前人工补记:/ping 页面与导航、改 PingPage 文本验 HMR、停用 ping 后导航与路由消失、恢复、控制台无 React 双实例/Router/chunk 错误

## M7 · 删除 Cordis 与 oRPC(2026-08-06)

Effect 成为唯一运行时。仓库内 `cordis` / `@cordisjs/*` / `@orpc/*` 的 import、依赖与 lockfile 条目
全部归零(prose 注释里的历史提及保留)。

删除:65 个文件。包括 cordis 插件实现、oRPC 契约与 router、`apps/server/src/main.ts`(cordis bin
复刻)、`contracts.gen.ts` 生成器、`cordis.gen.yml` 与其 `renderRuntimePlan` / `runtimeEntries`
一族。装配层现在只派生一个运行时产物:`apps/server/runtime.gen.ts`。

`pnpm dev` 与 `pnpm dev:effect` 合并为 `pnpm dev`(不再需要 `--expose-internals`,那是 cordis
loader 的解析要求)。

### 顺带修掉的真缺陷

- `PackageResolver.isInstalled` 仍按裸包名解析,而多数插件**故意不导出 `"."`**。结果:一个装着的
  包被判为「未安装」,resolve 让人去重装一个就在原地的包。改为与 `resolvePackageDir` 同一条路径。
  由 assembly-resolve 的 detached 用例抓到。
- `constraint-names` 门禁锚在 `createConstraintTranslator(` 这个调用上,而 Effect 端已改成普通
  约束映射表。门禁静默报告「零个 translator」而不是报告自己已经什么都不看了。改为按约束名键扫描,
  并已实测:把 `fk_role_grants_node` 改一个字母立刻变红。
- `test-layers` 的 `MIGRATED_SUITES` 与 Effect 侧测试对齐;testkit 因是测试边界而豁免
  `Effect.run*` 规则(相邻用例保证生产代码不得 import testkit)。

### 遗留(需要单独决策,不在 M7 范围)

- **qualy.yml 的 `config:` 现在没有消费方**。cordis loader 曾把它交给插件;Effect 侧配置一律走
  `apps/server/src/effect/config.ts` 读环境变量。已从产品清单里删掉两条死配置
  (`plugin-database.migrationsFolder`、`plugin-ping.greeting`),装配层仍支持 `config:`(lock
  与 testkit 都还在用),要不要把它接进生成的 layer 是一个设计决定。
- `scripts/tests/generators.test.ts` 会重写仓库里的生成物,而别的测试并发读同一批文件,偶发失败。

### 验收(实际执行)

```
pnpm typecheck                → 0 errors(根 + apps/web)
npx vitest run                → Test Files 46 passed | Tests 299 passed
pnpm test:browser             → Test Files 1 passed | Tests 10 passed
pnpm dev + curl               → /health/live 200  /health/ready 200
                                /api/app/manifest 200  / 200  /api/api/app/manifest 404
SIGTERM                       → "shutdown complete",端口释放
grep imports of cordis/@orpc  → 0
grep deps in any package.json → 0
grep pnpm-lock.yaml           → 0
```

## 装配层核查与 clean-room 验证(2026-08-06)

起因是 M7 里我删掉了 `qualy.yml` 中 database 的 `config.migrationsFolder`,理由写的是「没有消费方」。
**那个判断是错的**,下面第一条即由此暴露。

### qualy.yml 的消费关系(先把话说准)

`qualy.yml` 一直、且现在仍然决定装配:选哪些插件、谁 enabled、lock 与全部生成物都由它派生。
没有消费方的只是**插件级 `config:` 块**,而且分两种情况:

- **能力 provider 的 config 是活的**,经 `providerConfig` 在 CLI 期(generate/deploy/命令)消费。
  database 的 `migrationsFolder` 正属此类,删掉它会让 generate 写到 `apps/server/db/migrations`
  ——一条全新的空 lineage,drizzle 会把所有表重新生成一遍。已恢复。
- **非 provider 插件的 config 确实到不了任何地方**(Cordis loader 曾负责投递,Effect 侧没有对应
  机制)。ping 的 `greeting` 就是这种,它的 Effect layer 读 `PING_GREETING` 环境变量,所以那条删
  除是对的。这类键写了不报错、不生效,仍是开放问题。

### 三处「同一事实有两个所有者」

1. **lineage 目录**:qualy.yml 声明一份,`apps/server/src/effect/config.ts` 又硬编码一份,两边注释
   都声称「和对方读的是同一处声明」。进程改为读清单(`manifestMigrationsFolder()`);实测把清单指向
   `db/nonexistent-lineage` 后进程按该路径报 ENOENT,而此前会静默用硬编码值。
2. **lock 路径**:`lockPathFor` 只取清单**目录**、文件名写死,于是 `packages/app` 下任何第二份清单
   resolve 一次就把产品 lock 覆盖成别的文件的哈希(本次亲历)。改为按清单basename 命名,
   `qualy.yml → qualy.lock.json` 不变。
3. **连接串**:CLI 读 `config.url`,运行时完全不读。按「qualy.yml 不写连接串」这条既有纪律,改为
   **显式拒绝**并指向 DATABASE_URL——清单是要提交的,连接串写进去就是把凭据提交进版本库。

三条都由 `apps/server/tests/assembly-config.test.ts` 守,已逐条注入 bug 验证会红。

### baseline 片段丢失:真缺陷

`pendingBaseline` 判断「片段消失」的条件是**该插件在磁盘上是否还有别的片段**。org 恰好只有一个
(`0001_ltree.sql`,承载它自己列类型所需的扩展),删掉这唯一一个就绕过检查,generate 报
`nothing to generate` 并退出 0。据此生成的 lineage 部署到空库必然失败:

```
type "ltree" does not exist
```

——正是 baseline 机制当初被引入要解决的那次事故。判据改为「该插件是否仍在装配的 retained order 里」。

### clean-room 实测(回答「没有 db/migrations 能否重建」)

把 `db/migrations` 整个移走,用真实产品清单 `pnpm qualy generate` 一次成功,ltree 作为
pre-structure 片段排在结构 SQL 之前。随后把 from-scratch 与 committed 两条 lineage 分别部署到两个
空库,逐对象比较:

| 对象                  | 数量           | 结果     |
| --------------------- | -------------- | -------- |
| 列(名/类型/可空/默认) | 129            | 完全一致 |
| 约束                  | 195            | 完全一致 |
| 索引                  | 57             | 完全一致 |
| 函数 + 触发器         | 80             | 完全一致 |
| 扩展                  | ltree, plpgsql | 完全一致 |

唯一差异是**列的物理顺序**(committed 靠 ALTER TABLE ADD COLUMN 追加,from-scratch 按声明顺序建表)
与 pg_dump 的 `\restrict` 随机串,均无语义。手工 SQL 只有 ltree 需要进插件,且已经进了;
`rbac-grant-channel-triggers` 的两个触发器与函数在 `access-model` 里被同批 DROP,终态本就没有它们,
不是遗漏。

此结论已固化为 `packages/plugins/infra/database/tests/clean-room-parity.test.ts`(删掉 ltree 片段即以
生产同款报错变红)。旧的 clean-room 测试只数表数量,漏掉任何函数/触发器/约束都看不见。

### 数据库重置与 demo seed

`docker compose down -v` → up → `qualy deploy`(15 个迁移)→ `QUALY_SEED_DEMO=1 pnpm seed`。
顺带清掉了 17 个测试残留库。seed 需要 `QUALY_DEMO_PASSWORD`(不会自己编凭据),本次用
`QualyDemo!2026`,未写入 .env。

实测结果:租户 1、组织类型 8、节点 5、用户类型 3、用户 3、角色 2、权限 16、授权 2;站位不变量违规
数 0;`tenant-admin` 是唯一 `permission_mode=all-active` 且带 `system_key` 的角色;`system-account`
站在租户根节点。登录与授权投影端到端实测:管理员登录 200,manifest 下发 7 个页面;demo 学生登录
200,manifest 只有 2 个(login 与 ping)。

### 路线图对照(docs/assembly-design.md §23)

- 阶段 1 / 1.5:文档已标完成。
- **阶段 2 已完成**:该节 2026-08-05 重写为「静态 Effect 运行时」,`cordis.gen.yml → runtime.gen.ts`
  正是 M7 收尾做掉的那件事,不是还停在 M1。
- 阶段 3 约六成:baselineDir、pre/post phase、片段哈希、中央 generate、drop guard 均在,clean-room
  验收本次实测通过;**缺** database revision、upgradesDir、install epoch、migration bundle hash。
- 阶段 4(provision / setup)未开始,seed 仍是 633 行的中央脚本。
- 阶段 5(purge)未开始。

### 验收(实际执行)

```
pnpm typecheck                    → 0 errors
npx vitest run                    → Test Files 48 passed | Tests 306 passed
clean-room parity                 → 129 列 / 195 约束 / 57 索引 / 80 函数触发器 全等
删 ltree 片段后 generate           → 硬失败,点名 @qualy/plugin-org db/baseline/0001_ltree.sql
清单指向不存在的 lineage 后启动     → 按清单路径 ENOENT(证明运行时确实读清单)
管理员 / 学生 manifest             → 7 页 / 2 页
```

### 装配审查结果(18 agent,10 条确认,2026-08-06)

审查角度四个:CLI 与运行时各自决定的事实、失效的清单 config、from-scratch lineage 完整性、seed。
每条findings 都经独立 agent 反驳一轮才留下。**已修 8 条**,2 条留待决策。

已修:

1. `config.url` 被 CLI 采纳、运行时看不见(且优先级高于 DATABASE_URL)。改为连同一切未知键**拒绝**。
2. 非 provider 插件的 `config:` 被静默丢弃,而 manifestHash 照变——resolve 成功、frozen 启动通过,
   设置看起来生效了。核心与 database provider 现在都会点名说不认识这个键。
3. `runtime.gen.ts` 写在 `--yml` 指定清单旁边,其余六个产物写死路径。**全部产物都是静态 import**,
   所以谁也不能搬家;结果 `--yml` 会让 layers 用一份装配、permissions/routes/handlers 用另一份。
4. 同因:`QUALY_CONFIG` 指向别处时,启动校验去核对一个进程根本不会加载的模块,然后报告「已验证」。
5. `db:reset` 在 `docker compose up -d` 返回后约 1s 就连库,而 postgres 需要约 6s。改用 `--wait`
   等健康检查(实测 `Waiting → Healthy → applied 15 migration(s)`,7.3s)。
6. seed 把租户 slug 写死 `default`,而应用读 `QUALY_DEFAULT_TENANT`——设了这个变量就会「种一个租户、
   服务另一个」,症状是所有登录都解析不到 provider。改为读同一个变量。

留待决策(都属中央 seed,阶段 4 会整体重做):

- **重跑 seed 会把管理员撤销过的 demo 角色权限加回来**。对 demo 数据这也许正是想要的,但它确实会
  静默推翻运维决定。
- **seed 放置 demo 用户时不校验站位不变量**,若某租户先收紧了 student 的 placement policy,重跑 seed
  可能写出一条 API 本身会拒绝的站位。

后两条要不要改,取决于「seed 是幂等保证态,还是只在空库跑」——这是产品决定,不是缺陷判定。

## 迁移后收口 + ORM 决策阶段启动(2026-08-06)

依据 docs/mikro.md 的审计,以及对其结论的一处修正。

### 目录与包收口

- **插件的 `src/effect/` → `src/server/`**(8 个插件),导出子路径 `./effect` → `./server` 同步改名。
  `effect` 曾表示「新 Effect 实现,与旧 Cordis 并存」,Cordis 删掉后它命名的是一次迁移而不是一层;
  更要紧的是它与 `client/`、`db/` 并列却不说明自己在网线哪一侧——而正是这个区分失效,让 pg 经
  api.ts 进过浏览器 bundle。runtime.gen.ts 由 `qualy.runtime.entry` 派生,重新生成即可;唯一写死
  `/effect` 的是装配测试自己的断言,已改为向 `runtimeLayers()` 询问插件声明。
- **`packages/app` → `apps/server`**,`src/effect/` 一并扁平进 `src/`(整个包就是 server)。它是部署
  根而非可复用库,与 apps/web 同级。两处按目录层数计算的锚点跟着改;根 tsconfig 补 `apps/server/tests`
  (此前无任何工程覆盖它)。
- **删除 plugin-dict**。它只有一个 `export {}` 和一条声明了 schemaEntry 却零表的 database 贡献。
  直接从清单移除会让它变 detached(保留判据问的是「有没有声明 schemaEntry」而不是「有没有拥有东西」),
  而 detached 插件的包被卸载即硬失败,purge 未实现。做法是**先在它仍被选中时撤销那条贡献**,再从清单
  移除,于是它按常规路径离开 lock。无任何迁移创建过 dict 表。
- 删除 `packages/api-client/packages/web-i18n/src/format.ts`:误嵌套、不在 workspace、不在任何
  tsconfig、无人引用,且仍在翻译已经不存在的 `ORPCError`。
- **未做**:api-contract 双轨错误体系清理(57 个错误码定义了两遍)。旧 zod 定义仍是四个
  `client/i18n.ts` 错误目录的类型来源,不是死代码,需要把 `defineErrorTranslations` 改到 Effect
  TaggedError 上才能删。按裁决它是独立一笔,不夹进 ORM 实验。

### generators 并发 flake:结构性修复,不是重跑变绿

根因是 `writeGenerated` 把相对路径解析到 cwd,于是这些测试**重新生成整个仓库**,而 vitest 并行跑文件
——症状是另一个测试套件报「api 丢了路由」,且不可复现。现在 generator 走 `outputRoot()`,测试各自指向
临时树。实测:套件前后仓库内生成物字节相同、工作树零改动,连跑三次全绿。

### ORM 决策:接受「先做可删除的纵向验证」

结论按裁决表述为:**现在不启动全量 MikroORM 迁移;先做隔离的、可删除的纵向切片,完成后立即 Go/No-Go,
不长期维持 Drizzle + MikroORM + Kysely 三轨。**

我此前的论证有一处过度:我搜索 226 个提交没找到列名事故,便据此说触发条件不足。那只能证明测试拦住了、
或改动规模还不够大,不能证明手写类型断言没有维护成本。触发条件是**已经存在**的——查询层与 Schema 类型
链断裂:

| 事实                       | 实测                                     |
| -------------------------- | ---------------------------------------- |
| `sql\`\`` 用量             | 108 处 / 15 个文件                       |
| Drizzle typed builder 用量 | 5 处(1 insert、4 update)                 |
| 手写查询层                 | auth 591 + rbac 652 + org 252 = 1,495 行 |
| 表                         | 16 张,840 行 schema                      |
| 结果类型                   | 经手写 `rows<Row>()` 断言                |

### vendored 上游

`repos/mikro-orm` @ v7.1.10(commit 3066827),按 effect/drizzle 同一机制,catalog pin 版本但**无人安装**。
上游 clone 带 176MB 的 v2–v6 文档快照,与 vendor 树「只描述所 pin 版本」的本意相反(搜索会把五个废弃
大版本摆在正确答案旁边),已按新增的 `supersededPaths` 剥掉:206MB → 30MB。

从源码(非文档)确认的三个前提:

- `SqlEntityManager.getKysely()` 读 `getTransactionContext()`,事务内返回绑定该事务连接的实例,
  `em.fork().getKysely()` 才跳出——这是跨插件同事务的基础(`packages/sql/src/SqlEntityManager.ts:106`)。
- `IMigrator` 可程序化调用 `createMigration/up/down/getPending/getExecuted/rollup`
  (`packages/core/src/typings.ts:2221`)。
- `safe: true` / `dropTables: false` 可禁止 DROP(`packages/core/src/utils/Configuration.ts:696`)。
  **但它只兜住「不 DROP」,不解决「实体集合按 retained order 聚合」**——disabled/detached 仍必须由
  Qualy 自己决定,这是 spike 必须验证的部分。

### 验收(实际执行)

```
pnpm typecheck            → 0 errors(根 + apps/web)
npx vitest run            → Test Files 48 passed | Tests 306 passed
pnpm test:browser         → 10 passed
pnpm dev + curl           → live/ready/manifest/spa 200,/api/api/... 404
管理员登录                 → 200,manifest 7 页
SIGTERM                   → shutdown complete
```

## 配置入口收口:repos 移出版本库,清单移到根(2026-08-06)

按审计裁决执行前三步。**第 4-8 步(CLI --config-file、`${VAR}` 插值、`qualy config --validate`、
插件 typed config 输送、环境变量迁入清单)未动。**

### repos/ 不再进版本库

可追溯性由 `vendor-lock.json` 承担(packageVersion + tag + 精确 commit),`pnpm vendor:sync`
还原逐字节相同的树。提交树本身只多买到「离线可读」,代价是 7,759 个外部文件压在 376 个自己的
文件上。门禁分两层:

- `pnpm test`:只校验 lock 与 catalog 一致、effect 生态同版本、repos 不进任何工具链、无人从中
  import。**在从未跑过 vendor:sync 的新克隆上必须通过。**
- `pnpm vendor:check`:同步后校验树确实是 lock 指名的那一版。树里 `.git` 被剥掉,所以身份读各源
  自己的 `versionFile`(如 `packages/core/package.json`),不是 commit——先写成读 commit 的版本
  当场就红了,`git rev-parse` 在剥了 .git 的目录里返回的是外层仓库的 HEAD。

`docs/agents/effect-source-policy.md` 里「必须随仓库一起被版本化」那条已改写。

**历史未改写。** `main` 上没有 repos,103MB 只在本分支;引入它的 `e4ca3d5` 是本分支的**第一个**
提交,移除等于重写全部 84 个提交,且 `git-filter-repo` 未安装。是否改写取决于合并策略,待定。

### qualy.yml 与 qualy.lock.json 移到仓库根

原先要改端口或数据库地址得进 `apps/server/qualy.yml`——一个应用的源码树里。它携带的路径已经暴露
了这一点:`migrationsFolder: ../../db/migrations`,爬出包才够得着仓库。现在是 `./db/migrations`。

**关键修正**:我此前把「清单目录 = 插件依赖宿主」当成架构硬约束,那是错的——它只是
`hostDirFor = dirname(manifestPath)` 的结果。清单现在显式声明宿主:

```yaml
application:
  workspace: ./apps/server
```

`hostDirFor(manifest)` 改为 `resolve(dirname(source), workspace ?? '.')`。于是三件事各归各位:
清单目录 = 用户配置入口与相对路径基准;`application.workspace` = 插件 npm 依赖的宿主;
`apps/server` = 服务端源码与部署入口。

**一处有意偏离裁决**:审计要求升 manifest `version: 2`。我用了**可选字段 + 保持 version 1**,
因为 v1 完全能表达它(新增一个可选顶层键),而升版本会让 testkit 与全部现存测试的清单一次性失效。
省略 `application` 时行为与从前完全一致(宿主 = 清单目录),那正是独立部署布局。按项目元规则
「复杂度必须由已发生的问题证明」,没有 v1 表达不了的东西就不该升版本。若你坚持 v2,改动很小。

server 侧找清单改为**从自己的包向上查找**(`QUALY_CONFIG` 仍然覆盖),两种布局都覆盖:本仓库在根,
独立部署在宿主旁边。

### 验收(实际执行)

```
pnpm typecheck        → 0 errors
npx vitest run        → Test Files 48 passed | Tests 304 passed
pnpm qualy resolve    → qualy.lock.json(根)written
pnpm dev + curl       → ready/manifest/spa 200,SIGTERM shutdown complete
git ls-files repos    → 只剩 repos/vendor-lock.json
```

## 阶段 A 收尾:manifest v2 与 vendor 三动作(2026-08-06)

按裁决只做两笔,不碰 typed config、环境变量迁移与完整 CLI。

### 一、Manifest version 2

**接受版本号的论证**:v1 解析器遇到 `application` 会报 unknown top-level key,所以带着这个字段却
标 `version: 1` 的文件从来就不是 v1。版本号表达的是消费者兼容性,不是 YAML 能不能容纳一个字段。
我先前的判断错了。

`application.workspace` **必填**,独立部署也要显式写 `.`——留成可选就等于保留它要替换掉的那个猜测
(清单目录即宿主),而那个猜测一直是对的,直到有人把清单放到读它的人找得到的地方。

**两处已解析却被忽略的字段**,审计指出后实测确认:

- `manifestHash()` 不含 workspace。把宿主指向另一个包会选中同名插件 id 的不同安装版本,而这不算
  「变更」,frozen 启动照过。已补,并做等价拼写规范化(`./apps/server`、`apps/server`、
  `apps/./server`、`apps/server/` 同一个 hash;指向 `./apps/web` 则不同)。
- `renderManifest()` 不输出 `application`。任何经它重写的清单会**静默从「有宿主」变成「独立布局」**。

新增:workspace 指向没有 package.json 的目录时在**解析期**报错并点名,而不是让每个插件各自
MODULE_NOT_FOUND——后者读起来像「插件没装」,而不是「清单指错了地方」。

**顺带抓到清单移根引入的一个真 bug**:`scripts/qualy.ts` 的漂移检查仍从清单目录推导
`runtime.gen.ts`,而清单已在仓库根、生成物钉死在 `apps/server/`。表现是 `--frozen-lockfile`
报 `runtime.gen.ts is missing`。是我在验证「改 workspace 必须失败」时撞出来的。

### 二、vendor 拆成 update / restore / check

原先一个命令做三件事,哪件都不精确:它读 catalog、clone tag、重写 lock,**因此根本无法「恢复」**
——tag 被移动过的话,同一个记录里的 commit 会悄悄给回另一份源码。而 lock 只记 commit,
**commit 说不出磁盘上是什么**:树已经不在版本控制里,本地改一个字节不留痕迹,比对 package version
也看不见(两边 package.json 是同一个)。

| 命令             | 做什么                                           | 写 lock |
| ---------------- | ------------------------------------------------ | ------- |
| `vendor:update`  | 读 catalog → clone tag → 剥离 → 算内容 hash      | **写**  |
| `vendor:restore` | 读 **lock 的 commit** → fetch → 剥离 → 校验 hash | 不写    |
| `vendor:check`   | 只看本地树:版本、内容 hash、该剥的剥没剥         | 不写    |

`contentSha256` 对剥离后的树按「路径 + 文件字节」计算,忽略 mtime 与权限(否则每次恢复都报漂移)。

实测:往 `repos/mikro-orm/README.md` 追加一行 → `vendor:check` 立刻红;`vendor:restore drizzle-orm`
从 lock 的 commit 恢复后内容 hash 与记录一致,且 lock 未被改写。

### 三、又一个并发隔离缺陷(与 generators 同类)

`apps/server/tests/effect-shell.test.ts` 标了 `.concurrent`,而它的两个用例共用固定端口 3197,
其中一个恰恰断言**没有人在监听**。并发跑时它读到了另一个用例的服务器,拿到 200。
**单文件跑永远复现不了**,只有全量跑才会踩——和 generators 那次一模一样。

`ports.test.ts` 原先只守跨文件端口唯一,看不见同文件内并发共用。已补一条:声明了固定端口的套件
不得标 `.concurrent`。

### 验收(实际执行)

```
pnpm typecheck              → 0 errors(根 + apps/web)
npx vitest run × 3          → Tests 310 passed(连续三次)
pnpm test:browser           → 10 passed
pnpm vendor:check           → 3 tree(s) match repos/vendor-lock.json
pnpm qualy resolve --frozen → qualy.lock.json is up to date
pnpm dev + curl             → ready/manifest/spa 200,SIGTERM shutdown complete
```

**阶段 A 完成,可以 squash merge。** 下一步按裁决:合并 → 删旧分支 → 在新 main 上打
`pre-mikroorm-spike` → 从 main 建 `spike/mikroorm-kysely`,连真实 PostgreSQL 做纵向切片。

---

## 迁移分支 refactor/mikroorm-migration(阶段 C:正式迁移)

spike 的结论已落地为四个提交,每一步都可单独回退。

### 一、能力可以拥有生成物(核心不知道它生成了什么)

实体聚合必须和插件集合一样新,也就是说 `pnpm gen` 要写它、frozen 门禁要比它——这两件事都在核心,
而**核心不知道什么是实体**。所以契约多了一条声明(不是一个阶段):`modules?(context)`,
纯函数、不拿 `providerConfig`(生成物会进工作树,连接串不进)。核心写字节、比字节,从不读内容。

由此:`apps/server/entities.gen.ts` 由 database 能力产出,`qualy resolve --frozen-lockfile`
在它缺失或过期时拒绝。两个能力抢同一路径、路径逃出 workspace 都是硬失败。

### 二、entity 聚合的校验(实测每条都能红)

- 两个插件声明同名实体 / 同名表 → 拒绝(拼接里完全无声,最后注册的赢)
- 声明的路径不在包 exports 里 → 拒绝(否则构建期才发现,且看起来像聚合文件坏了)
- 集合取 **retained**(active + disabled + detached);实测改成 active-only 后
  「停用/移出清单仍保留」用例立刻红——这条正是数据被 DROP 的路径
- 产物落在**宿主 workspace**,不是清单目录(改成清单目录后用例红)
- 产物里不得出现 `any` / `unknown`(元组一旦被宽化,表名全变 `never`,而运行时什么都不报)
- 插件集合变化后 frozen 门禁必须红(实测:装了 plugin-b 而聚合还是旧的 → 报 not what this
  manifest generates)

### 三、ORM 接上聚合

`@qualy/plugin-database` 的 layer 现在是 `ormLayer.pipe(Layer.provideMerge(connection))`——
顺序不是随意的:`provideMerge` 先构建参数(实测见 repos/effect/packages/effect/src/Layer.ts:1337),
所以 ORM 出现时迁移已经跑完。宿主把 `entities.gen.ts` 交给插件,插件不做 discovery。

宽化的 manager 收窄成插件自己的闭包类型,收窄**只做一次**(`entityManager<T>()`),
不是在十五个调用点各写一次 cast。

顺带把十五个各自重建 database layer 的测试文件收进 `databaseFor(url)`——正是这次「插件多要一个
服务」要改十五处,才证明它该被提出来。

### 四、16 张表全部声明为实体,逐插件过 parity

| 插件 | 表  | columns | constraints | indexes |
| ---- | --- | ------- | ----------- | ------- |
| org  | 4   | 30      | 23          | 18      |
| auth | 6   | 34      | 23          | 15      |
| rbac | 6   | —       | —           | —       |

**parity gate 的一个洞已补**:spike 版本只比 `data_type`,而 schema 里每个 varchar 的
`data_type` 都是 `character varying`,长度在 `character_maximum_length` 里——spike 把
`org_types.name` 声明成 255(实际 100)一直是绿的。现在比宽度与精度,实测把 100 改回 255 立刻红。

**约束命名从「例外表」改成「规则」**:一个 assembly 只有一个 naming strategy,且主键名没有
per-entity 覆写(实测见 repos/mikro-orm/packages/sql/src/schema/DatabaseSchema.ts:343)。
五个复合主键都叫 `pk_<表>`、单列主键都取 postgres 默认——这是整个 schema 的规律,所以规则写在
database 插件里,它不需要认识任何一张业务表。曾经考虑改名迁移,不需要了。

### 验收(实际执行)

```
pnpm typecheck                          → 0 errors
npx vitest run                          → Tests 330 passed / 53 files
npx tsx scripts/qualy.ts resolve --frozen-lockfile → qualy.lock.json is up to date
npx tsx scripts/qualy.ts generate       → database: nothing to generate(drizzle 侧无漂移)
```

### 下一步

查询层:把 repo 从 drizzle 逐个改写到 Kysely(`kyselyOf(em)`,entity 名 + property 名 +
convertValues)。每个 repo 单独过它自己的既有测试,drizzle 侧最后整体撤下。

---

## 阶段 C 续:改写查询之前先堵住类型缺陷(裁决执行)

### 一、`defaultRaw` 缺陷在依赖边界修,不由查询层长期承担

`MaybeGenerated` 判的是「选项**值等于** `true`」而不是「选项**存在**」,而 builder 记的是实际值。
最锋利的说法是:**两个只差默认值的声明行为不同** —— `.default(true)` 可省略,
`.default(false)` 必填。`.defaultRaw()` 那条分支**从不命中**,而它正是文档推荐给
`now()` / `uuidv7()` 的写法。

实测(patch 前),缺的是 `disabled, id, count, createdAt`,**唯独不缺 `enabled`**。

`patches/@mikro-orm__sql@7.1.10.patch` 把两处 `true` 改成 `unknown`(= 属性存在)。
被否掉的三个候选与理由记在 notes/mikro-orm.md;核心是**不让 5300 行业务查询为一个类型 bug
永久付代价**,也不在应用层复制一份上游的实体→Kysely 推导(猜错的方向是「类型说可省略、
元数据其实没默认值」:编译通过,运行时 NOT NULL)。

**patch 是自守的**:`kysely-types.test.ts` 是纯类型测试(函数从不调用,断言交给 `pnpm typecheck`)。
已实测把已解析的那份 `typings.d.ts` 改回 `true` → typecheck 立刻红。这条很重要,因为
pnpm 的 `prepare` 在部分安装下可能被静默跳过(effect LSP patch 踩过同样的坑)。

上游 issue 草稿四份在 `docs/upstream/`(本条 + entity generator 三条),按上游表单字段写好,
reproduction 一节留给提交者附仓库。

### 二、查询必须走 `query()`,不能裸 `Effect.promise`

改写前发现的:`translateConstraints` 从**错误通道** catch,而 `Effect.promise` 把拒绝变成
defect —— 不在同一个通道上。裸写会让约束翻译**永不触发**,restrict 外键挡住的删除答 500 而不是
409,调用点看不出问题。已加 `query()`(内部 `tryPromise`,失败包 `QueryFailed`,驱动错误挂
`cause`)。由「a refused write」一条钉住:换回 `Effect.promise` 立刻红。

### 三、事务:补中断与 defect,收回 `Orm`

原先只测了 typed failure 回滚。已补:**fiber 中断**(Deferred 通知写入已发生 → interrupt →
事务外查询为空)与 **defect**(`Effect.die`)。三条路径在「release 永远 commit」时同时变红。

`Orm` 从 `@qualy/plugin-database/server` 改为**只导出类型**。持有它就能 `orm.em.fork()`,
在事务内逃出事务而毫无异样——测试里的 `outsider` 正是这么构造的。收回后编译器直接拦:
业务插件写 `import { Orm }` 会得到 TS1485。这比 grep 门禁强。

`transaction()` 的语义已写明是 **join-existing**,不是 requires-new,也不是 savepoint;
将来要局部回滚另加 `savepoint()`,不改这个的语义。

**未做(记触发条件)**:`entityManager<T>()` 目前由插件自填 `T`,理论上可声明更宽的元组绕过依赖
闭包。等 wiring generator 为每个插件生成绑定闭包的入口再收紧——现在还没有插件写查询,
按「复杂度必须由已发生的问题证明」先不建。

### 四、偶发失败:仍未定位,但已可诊断

instrument 而非猜测串行化:

- `QUALY_TEST_REPORT=<path>` 让全量跑额外写一份 json 结果(平时不开,免得每次本地跑都落文件)
- scratch 库 drop 失败时,**在服务器还这么认为的时候**打印该库的 backend 数与
  `connections / max_connections`——被强制 drop 救回来的那次否则什么都不留下

两组对照都跑了,**都没复现**:

```
默认并发   339 passed   22.7s
--no-file-parallelism  339 passed   96.4s
```

串行慢 4 倍,所以「串行化」本身也不是免费的修法。**保持 unresolved**。

## 查询改写:前两个 repo 已切,并发现迁移单元不是文件

已切到 Kysely 并各自过了既有测试:

- `auth/src/server/session.ts`(会话中间件,三表 join + 两个计算列)
- `auth/src/server/sign-in.ts`(登录/登出/登录方式,八条查询)

关系属性顺带按列名改了(`tenant` → `tenantId`、`permission` → `permissionId`):属性名就是
Kysely 查询里写的名字,而列名由 `joinColumns` 决定,三份 parity gate 不受影响。晚发现就要回头改
已经写完的查询。

### 阻塞点:一个事务不能横跨两个运行时(已实测)

drizzle 的 `database.transaction` 和 MikroORM 的 `em.begin()` 各从自己的池取连接。
把 auth 单独切过去,org 在自己的事务里问 auth「这次改类型会不会把人晾着」时,
auth 会另开一条连接读**已提交**状态 —— 答案看起来完全正常,只是回答的是别的问题。

实测(临时探针,已删):drizzle 事务里插入的行,同一 fiber 里经 `entityManager()` 查得到 `[]`。

因此 org / auth / rbac 是**一个连通分量**,事务核心必须同批切;明细与守护它的测试见
docs/notes/mikro-orm.md。已切的两个文件都不在事务里,所以是安全的。

### 解法:先换执行者,再换写法(已落地)

原本只有一个选择:一次提交改完三个插件的全部语句,中间没有可运行状态。实测发现还有第二条路——
**drizzle 编译出来的 SQL 可以直接在 ORM 的连接上跑**(`PgDialect.sqlToQuery` 是 drizzle 自己的
驱动用的那个,参数照旧绑定;经 Kysely 的 `CompiledQuery.raw` 执行)。

于是加了 `packages/plugins/infra/database/src/server/legacy-sql.ts`:一个和旧 `Database`
**同形**的 `LegacySql`(`execute` / `transaction`),实现在 ORM 连接上。三个插件各改一行
`yield* Database` → `yield* LegacySql`,加上 catchTag 换成 `QueryFailed`,**全部语句原样不动**。

**drizzle 从此只负责拼 SQL,不再负责执行。**342 测试全绿。

这个 shim 是临时的,最后一条 drizzle 语句走掉时跟着删。它换来的是:剩下的
~1360 行查询可以**一个模块一个模块**地改写,每次都能跑全量,而不是一次改完赌一把。

验证不是靠推理:翻转后那两个跨运行时的守护用例**立刻红了**(`inside` 得 1 不是 2,
`refused` 得 false),因为测试自己还在用 drizzle 开事务 —— 把它们指向生产用的同一个入口后转绿。
断言一个字没改。

**下一步**:逐个模块把语句改写成 Kysely,顺序建议 `rbac-contract/src/scope.ts`(`scopeCoverage`,
三个插件都嵌它)→ rbac/src/queries.ts(652)→ org/src/queries.ts(252)→ auth/src/iam/queries.ts(458)。
行形状从 snake_case 变 camelCase 是每次改写的主要涟漪,只影响该模块的消费方。

### 第一个共享片段已切:placement rule

`auth/src/server/placement.ts`(新)。四个消费方共用的那条判定,drizzle 版本连同
`strandedByQuery` / `usersBlockingOrgTypeQuery` / `strandedByPolicyQuery` / `placementAllowedQuery`
一并删掉 —— 不留给「只有测试还在用」的那份,否则同一条不变量就有两个实现。

变化:谓词原先拿 alias **字符串**(`placementLegal('t', ...)`),join 改个名字没人会发现;
现在拿列引用(`eb.ref('t.isSystem')`),不在作用域里就编译不过。内层
`exists (select 1 from user_type_allowed_org_types ...)` 仍是裸 SQL(只涉及一张表、无外部 alias)。

`effect-parity.test.ts` 里直接断言该谓词的用例改成用 Kysely 版本重建查询 —— 顺带证明这个片段
能嵌进调用方自己的 select(org 将来就是这么用的)。

### 连接预算(实测,已收口)

翻转之后 ORM 的池才是活的,测试并发需求大约翻倍,`53300 too_many_connections` 开始出现 ——
而且报错落在**下一个连接的测试**上,不在起因处。采样看到峰值 80+/100。三处各自定了上限:
迁移器 1 条(它本来就是一条条跑)、drizzle 池 2 条(已经没人走它)、ORM 池由
`DatabaseConfig.poolSize` 决定,testkit 取 2。

连跑 6 次全量:5 次 342 全绿,1 次 1 失败但**没抓到是哪条**(报告开着的那 4 次都是绿的)。
偶发失败仍 unresolved,只是同一类错误现在有了上界。

### auth 切完;共享的授权片段也切了

`user-types.ts`、`users.ts` 全部 Kysely。`scopeCoverage`(`@qualy/rbac-contract/scope.ts`)
连同它的**六处使用**一次切完 —— 这个不能分两次:一条授权谓词有两份实现,不会大声失败,
只会答得不一样。rbac 的 `grantsQuery` 因此也一起搬了,并新建了 `rbac/src/server/db.ts` 闭包。

片段的参数从 alias 字符串变成列引用(`eb.ref('n.path')`),锚点 id 从拼进语句变成绑定参数 ——
那个手写的 uuid 校验本来只是注入防护,不是领域规则,绑定之后它防的东西已经不存在了。

**踩到一个真 bug,被既有测试抓住**:搜索条件写成一整段裸 `sql` 且顶层含 `or`,
Kysely 不会给裸片段加括号,于是 `and` 结合更紧,keyset 的游标条件掉进了 `or` 的另一支 ——
第二页原样返回第一页。改用 `eb.or([...])` 让分组由构造器表达,而不是靠人记得写括号。
**裸片段里出现顶层 `or` 就是这个坑**,后面 rbac/org 改写时注意。

auth 还剩两条 drizzle 语句(`iam/queries.ts`,63 行),都读 rbac 的表 ——
不在 auth 的实体闭包里,**也不应该在**。它们该是 rbac 服务上的端口,随 rbac 迁移一起做。

测试侧:org 与 rbac 的 harness 现在都要传完整实体闭包,否则 ORM 不知道 `User` 对应哪张表。

### rbac 的授权内核已切(最难的一块)

`rbac/src/server/authorization.ts`(新):`canAt` / `hasTenantPermission` / `authorizedScope` /
`effectiveRows` / `reachAt` / `explainRows`,加上它们共用的三个片段
(`reachesEveryNode` / `carries` / `rolePermits` / `reaches`)。判定与解释仍然同源。

**发现并消掉一处已存在的重复**:「这个人持有哪些授权」原先写了两遍 —— `heldRoles()` 一份,
`explainRowsQuery` 里的 `with held as (...)` 又一份,差别只是后者多取一个 grant id。
现在是同一个 CTE。这正是那个文件头部注释警告的漂移,只是它自己已经发生了。

**补了一条缺失的测试**:`carries` 把权限钉在注册表验证过的 plugin + target 上。
我把这两个条件删掉,**全部测试照旧通过** —— 说明这条安全相关的约束一直没人守。
`effect-drift.test.ts` 守的是装配期(声明与存储行不一致就拒绝启动),不是**启动之后**
有人直接改表。新用例:先断言 canAt 为 true,`update permissions set plugin = 'not-org'`,
再断言变成 false;删掉钉死条件它立刻红。

反向验证:把 self 锚点改成按 path 匹配(那个历史事故),11 条测试红。

### 测试闭包收成一处

auth 的七个测试文件各写一份实体闭包,rbac 的查询开始经 ORM 命名表时,七份都要同时学会 ——
所以收进 `auth/tests/support/closure.ts`。org 与 rbac 的 harness 同样要传完整闭包。
生产不受影响:宿主给的是生成的聚合。

**剩余**:rbac 的 37 条 CRUD 查询(roles/grants/permissions,344 行)与 org(252 行 + index 1001 行)。
都是机械改写,没有共享片段的约束了。

### rbac 授权面全部切完;剩角色 CRUD

已切:授权内核、grant 的资格判定与写入、权限目录(装配期把 catalog 镜像进 permissions 表)。
`rbac/src/queries.ts` 从 652 行降到 267 行、24 条查询,全部是**角色 CRUD**
(roles.ts 的集合替换、role projection、eligibility)加 diagnostics 的两条存在性检查。

`CanonicalAdminShape` 顺势改成 camelCase(`systemKey` / `permissionMode`) —— 它读的就是
`roleForGrant` 返回的那一行,行形状变了它就得跟着变。SQL 版 `canonicalTenantAdmin(alias)`
还是 drizzle,因为 auth 那条 `grantsBlockingUserTypeQuery` 还在用它。

**下一步**:roles.ts(20 条左右)→ diagnostics 的两条 → org(252 行查询 + 1001 行 index)。
没有共享片段的约束了,可以一条一条改。

### rbac 全部切完:`src/queries.ts` 已删除

角色 CRUD、eligibility 集合替换、role projection、diagnostics 的存在性检查 —— 最后一批。
每条语句现在住在跑它的那个 service 旁边,两个 service 都读的(role projection、
rolePermissionCodes、lockTenant、userExists/orgNodeExists)住在 `server/db.ts`。

eligibility 的替换不再拿表名和列名当字符串参数。它原先那样是因为一条 drizzle 语句
经 `sql.raw` 同时服务两个集合 —— 这也是那些 id 必须先校验再拼进语句的原因。
现在两个集合各自成句,id 是绑定的。

`CanonicalAdminShape` 改成 camelCase:它读的就是 `roleForGrant` 返回的那一行。

**剩余**:org(`src/queries.ts` 252 行 + `server/index.ts` 1001 行),以及
auth 里那两条读 rbac 表的语句(应改成 rbac 服务上的端口)。rbac 的 `LegacySql`
现在只用来开事务、不再执行任何语句,org 切完后可以一并换成 `transaction()`。

### org 也切完:三个插件的查询模块全部删除

`org/src/queries.ts` 与 `rbac/src/queries.ts` 都已删除,auth 的 `iam/queries.ts` 只剩两条。
ltree 的两条(建节点的路径原子写入、`subpath`/`nlevel` 搬子树)仍然写成 SQL —— 那不是
构造器能表达的东西 —— 但它们现在是 org 里仅有的 SQL 文本,返回的行也和别处一样命名。
`NodeRow` / `NodeView` 去掉 snake_case,边界映射函数存在的理由随之消失。

### 只剩两条语句还在旧运行时上

都在 auth,都读 rbac 的表:

- `rolesStrandedByUserTypeQuery`(删用户类型时:哪些角色会变得没人能拿)
- `grantsBlockingUserTypeQuery`(改用户类型时:哪些授权会失效)

它们不在 auth 的实体闭包里,**也不应该在** —— 这两个问题属于 rbac。正确形态是 rbac 服务上的
两个端口,和 `assertTenantKeepsAdministrator`、`grantsBlockingOrgType` 同型。

**收尾顺序**:①这两个端口 → ②auth 的 `iam/queries.ts` 删除 → ③`LegacySql` shim 删除
(它现在只用来开事务;七个文件里没有一处 `tx.execute` 是 rbac/org 的了)→
④drizzle 表定义 `*/src/db/tables/` 与 drizzle 依赖撤下。

### 三个插件的查询全部在 Kysely 上;查询模块一个不剩

auth 最后两条读 rbac 表的语句改成了 rbac 服务上的端口
(`rolesStrandedByUserType` / `grantsBlockingUserType`),与 `assertTenantKeepsAdministrator`
同型 —— 它们在调用方的事务里回答,因为连接在 fiber 里。`auth/src/iam/queries.ts` 随之删除。

反向验证:把 `rolesStrandedByUserType` 的「且没有别的类型」条件改成「且有这个类型」,
`refuses to delete a type that is the last one a role admits` 立刻红。

**收尾只剩两件,都不改行为**:

1. `LegacySql` shim 删除。所有 `tx.execute` 已经没有了,`database.transaction(...)` 换成
   `transaction(...)` 即可,但 `write`/`writeAtRoot`/`readInSnapshot` 三个包装器要同时
   套上 `withDb`(否则 `Orm` 会泄进服务方法的类型)。**试过一次用脚本批量改,括号改乱了,
   已回滚**;这件事要手改五个文件,不要用正则。
2. drizzle 表定义 `*/src/db/tables/`、drizzle schema 聚合与 drizzle 依赖撤下。

### 查询层完全脱离 drizzle;shim 已删除

`LegacySql` 与它的测试删除。事务直接来自 orm 的 `transaction()`,三个 `write` 包装器
套 `withDb`(事务把数据库供给 body,包装器把它供给事务,服务因此仍然零 requirement)。
两条守跨插件事务参与的用例也改成用同一个入口开事务,断言一字未改。

341 测试(少的 3 条是 shim 自己的)。**没有任何服务再 import drizzle。**

### drizzle 还剩什么:只有 schema 那一半

- `*/src/db/tables/*` + `db/schema.ts` —— 仍是 `qualy.contributions.database.schemaEntry`
  指向的对象,也就是 **drizzle-kit 仍在生成迁移**
- `org/src/db/ltree.ts`(自定义列类型)、`auth/src/db/relations.ts`(RQB)
- `Database` 服务:生产里只剩 `ping()` 一处,其余全是测试 seeding

**下一阶段是独立的一件事**:把迁移生成从 drizzle-kit 换到 MikroORM 的 SchemaGenerator。
`packages/plugins/infra/database/src/parity.ts` 与三个 `entity-parity.test.ts` 就是为这一步
建的 —— 它们已经在证明实体产出的 schema 与 lineage 逐列一致(含宽度与精度)。
换完之后 `db/tables`、`db/schema.ts`、`relations.ts`、`ltree.ts` 与 drizzle 依赖一并撤下,
`Database` 服务与 `@effect/sql-pg` 也随之消失(`ping` 改走 orm,测试 seeding 改用 Kysely)。

### 试过把 `ping()` 也搬走,失败了 —— 而且失败得有道理

想法是让就绪探针不再经 drizzle 的 `Database`。改完编译不过:`ping` 的 requirement 变成
`Orm`,而 `Orm` **故意只导出类型**,所以 apps/server 的 handler 既无法 yield 它、也无法
`provideService` 它,requirement 一路泄到 main.ts 变成 `unknown`。已回滚。

这不是障碍,是设计在起作用:探针要的是「这个插件健不健康」,该由**拥有连接的插件**回答,
而不是由组合根自己去连。Effect 端目前还没有 `server.readiness(key, probe)` 那套注册
(cordis 时代的设计还没搬过来)。**所以 `ping` 与 `Database` 服务同生共死**:
等就绪探针改成插件注册、且测试 seeding 不再用 `Database` 时,两者一起走。

顺带删掉 `auth/src/db/relations.ts`(drizzle RQB 定义,已无人 import)。

### 迁移生成换成 MikroORM;drizzle 全部撤下

生成不再是「实体元数据 vs 快照」,而是**两个真实数据库的比较**:一个应用了已提交 lineage,
一个按全新安装的方式由实体建成(pre-structure baseline → `getCreateSchemaSQL` → 复合外键 →
post-structure baseline)。

两侧都是真库是这件事成立的原因。租户复合外键指向复合唯一键,实体元数据没有这种声明,所以拿
元数据去比,那 19 条外键**每次都会被判成要删**。放到第二个库上,它们两边都在,diff 从不提它们,
而新增一条会自己作为 addition 出现。扩展、函数、种子行则相反:没有东西把它们读进 schema,
所以照旧走 baseline 片段逐字写进迁移——两套机制永不描述同一个对象。

第一次跑出来是 `nothing to generate`:实体声明的 schema 与已部署的 lineage 逐对象相同。
反向验证做了三次:加一列 → 只产出 `add column`;删一列 → 产出 `drop column` 且被 drop-guard
拦下;做了一条**正则里带 `;\n` 的 check** → 语句切分没有在字符串里断开。

**路上撞到两个上游缺陷,都已 patch + `docs/upstream/` 存档 + 测试守**:

1. 读回 check 约束时,剥 `(col)::text` 的正则没有锚定成对括号,body 里有两个括号项加一个 cast
   就会把括号剥乱(`code IS NULL) OR ((code ~ ...`),产出的 SQL 根本不能解析。
2. 索引 introspection 丢掉 access method,ltree 上的 gist 索引读回来变成 btree。这条是**静默的**:
   DDL 合法,只是子树查询从此全表扫描——所以它单独有一个测试,而不是只靠 clean-room 门禁。

`packages/plugins/infra/database/tests/introspection.test.ts` 直接问 postgres 这两个问题;
把 patch 撤回去,两条立刻红。

**drizzle 现在一点不剩**:表定义、schema 聚合、`schemaEntry`、ltree 列类型、测试播种、
迁移执行器、`Database` 服务、`@effect/sql-pg`、catalog 条目、vendored 树,全部撤下。
迁移执行器换成本插件自己写的(基于 pg),但**逐字复刻了 drizzle 的账本契约**:同样的目录名、
同样的 statement-breakpoint、同样的整文件 sha256、同样的列。拿开发库(账本是 drizzle 写的)
验过:第一条迁移算出来的 hash 与库里存的一致,deploy 报 up to date。

两处行为**故意**不同:迁移目录不存在now是错误而不是「空 lineage」(读成空会让进程在一个从没建过的
库上启动并自称 up to date,harness 的失败启动用例正是这么抓到的);账本里出现没有 name 的行直接
拒绝,而不是猜。

**上一份 STATUS 说 `ping` 搬不走,那个结论是错的**。`Orm` 出现在 requirement 里没有问题——
handler 在 group 建立时取它即可;当时的编译错误是 `ping` 已经不是函数了而调用点还在调用它。
`Orm` 只导出类型挡的是组合根自己持有 ORM,挡不住建在这个插件之上的 layer 去要一个。

**遗留**:`repos/drizzle-orm/` 这棵树还在磁盘上(gitignored,已从 vendor-lock 与 vendor-sync
的清单里移除),手动删掉即可。

### 审计待办(用户 2026-08-06 提出,按此顺序处理)

迁移换成 MikroORM 的 `Migrator` 之后,原审计第 1 条(账本、严格前缀、advisory lock)大部分归上游:
排序、事务、`mikro_orm_migrations` 账本、并发都由 `MigrationRunner` 负责。**仍然成立的是**
上游账本只记 `name` 与 `executed_at`,不记内容哈希 —— 已应用迁移被改动仍然无人察觉。

按优先级:

1. **destructive guard 在写文件之前跑**。现在仍是「先写 → 再扫 → 抛错」,被拒的迁移已经落在
   `db/migrations` 里,而且它的 baseline marker 下一轮会被当成已编译。改成:内存渲染 → 扫描 →
   通过才落盘(临时文件 + rename)。
2. **错误定义两个事实源已经漂移**。`src/errors.ts` 的 Zod `defineDomainErrors` 与
   `src/server/errors.ts` 的 `Schema.TaggedErrorClass` 各说一遍:旧表还留着 `ORG_RULE_CONFLICT`
   (幂等 PUT 之后已不存在),`TypeInUse` / `RuleViolation` 的 `reason` 字段旧表没有。
   合成一份中立描述表(code / identifier / status / fields / message),两侧都从它派生。
3. **错误 tag 的全局门禁**:`^[A-Z][A-Z0-9_]*$`、全局唯一、插件私有错误带领域前缀
   (`ORG_*` / `AUTH_*` / `RBAC_*`),公共码(`ACCESS_DENIED` 等)归共享 contract。
   Effect TaggedError 这条路绕过了旧 `defineDomainErrors` 的校验,现在没人守。
4. **实体碰撞检查换 AST**。`assertNoCollisions` 用正则扫 `name:`/`tableName:`,会把 check /
   index 对象里的 `name:` 当成实体名,只认单引号,且同插件内重名不报。
5. **clean-room parity 加深**:补 `pg_get_functiondef` / `pg_get_triggerdef` / `pg_get_viewdef`、
   `pg_views`、`pg_matviews`(将来 `pg_policies`),以及 baseline 声明的必需数据行的显式探针。
   现在函数体、触发器条件、视图定义变了都是全绿。
6. **cleanup 错误遮蔽根因**:`structuralDiff` 与 `schemaParity` 的 finally 里,scratch 库删不掉
   就抛新的 AggregateError,把原始失败盖掉。应当两者一起带出去。
7. **启动期失败的类型要与叙述一致**:ORM 初始化与迁移执行仍走 `Effect.promise`(defect),
   而模块头注释声称在 error channel 里。要么改注释,要么加 `DatabaseStartupFailed` / `MigrationFailed`
   走 `tryPromise`(不进 HTTP 领域错误 union,只进 Layer 构建失败)。
8. **生产禁止 localhost fallback**:`NODE_ENV=production` 且缺 `DATABASE_URL` 时硬失败,
   开发/测试保留 fallback 但告警。
9. **`compositeForeignKeys` 要在加载期校验形状**:现在只校验 `entities` 是数组;导出成字符串会
   被逐字符 for...of。

**错误码格式已裁决:保持 SCREAMING_SNAKE**。四层命名各司其职,不合并:
class `NodeNotFound` / schema identifier `OrgNodeNotFound` / 协议码 `ORG_NODE_NOT_FOUND` /
message id `org/error/node-not-found`。

### 已有数据库遇上被压缩的 lineage:`qualy database adopt`

lineage 压成一条之后,任何已存在的数据库都会「不被认识」:新账本是空的,那条初始迁移要重新建表,
于是 `relation "auth_providers" already exists`。开发库就是这么起不来的。

`pnpm qualy database adopt` 是这件事的答案,而且**先验后写**:把目标库与「实体+复合外键+baseline
建成的库」逐对象比对,不一致就拒绝并把差异逐条列出来,一致才把 lineage 记成已应用(只写账本、
不跑任何 SQL)。第一次跑就拦下来了 —— 差异是旧的 `cordis_meta` 账本 schema,它确实不属于
任何插件声明的 schema。删掉那个退役账本(一张表、15 行,指向的迁移都已不存在)后认领成功。

顺带把 `structuralDiff` 拆出 `diffAgainstDeclared(subjectUrl, ...)`,adopt 与 generate 共用同一个
比较,并修掉审计第 6 条的一半:scratch 库删不掉时,只有在主体已经拿到答案的情况下才抛
AggregateError,否则原始失败不会被清理失败盖掉。

### codegen 进了 main,dev 只剩一个进程

`pnpm dev` 不再前置 `tsx scripts/gen.ts`。`apps/server/src/main.ts` 在导入任何 `.gen.ts` 之前
自己跑一遍(仅非 production,动态 import),日志走应用同一个 logger。顺序是关键:`runtime.ts`
改成 codegen 之后再动态 import,否则进程会冻在生成前的那份上;`manifestPath` 因此挪进
`src/manifest.ts`(config.ts 静态 import 了三个由清单派生的生成物)。

生成器只报写了什么。九行 `unchanged, skipped` 只说明「codegen 跑过」,而调用方本来就知道。

### 能力边界实测:核心解耦成立,组合根不成立

`scripts/tests/capability-boundary.test.ts`(四例)把两条一直没人验的断言钉住了:

1. **没有 database 的装配**:`providers` 空、`capabilityWork` 空(不是「跑了但没做事」)、
   `capabilityModules` 空,lock 的 `capabilities` 为 `{}` 且整份 lock 的 JSON 不含
   database/entities/migration 任何字样。
2. **第二个能力**:现写一个 `cache` provider(真 provider 的形状),与 database 并存 ——
   各自解析、各占 lock 一段、互相看不见对方 state,两个生成模块各生成各的;每个 provider
   每阶段跑一次;命令只到自己的 provider;没实现的阶段报「没跑」而不是「跑完」。

阶段 1.5 那次「无 database 实测」是 cordis 时代的,现在有测试守着了。

**但组合根启动不了**。静态 Effect 运行时下,`apps/server/src/{runtime,config,health}.ts` 无条件
点名五处插件导入,而 `entities.gen.ts` 只在 database 能力存在时才生成。

根因不是「忘了解耦」,是**清单里的每插件 `config` 在 Effect 运行时下没有通往插件的路径**:
cordis 时代 loader 把 config 交给插件,现在没有 loader,于是宿主手写代码替每个插件读了配置
(`databaseConfigLayer` / `authConfigLayer` / `webConfigLayer` / `uiCatalogLayer`),
点名因此不可避免。

#### 下一阶段:让插件自己收配置

1. **声明**:插件 package.json 加 `qualy.runtime.config: true`(声明不探测,与能力同规矩)。
2. **生成器**:`renderRuntimeModule` 对声明了的插件 emit
   `import { configLayer as X } from '<entry>'` 与 `X(<该插件的清单 config>)`,汇成
   `export const pluginConfig`,provide 给 `pluginLayers`。~25 行,加 metadata 一个字段。
3. **插件侧**:四个 config layer 的函数体从 `apps/server/src/config.ts` 搬进各自插件。
   auth / web / ui-registry 三个只读环境变量,直接搬;database 还要 `migrationsFolder`,
   它来自清单 —— 由生成器作为参数传入,这正是第 2 步存在的理由。
4. **`Entities`**:由 database 能力的生成模块导出 layer(`modules()` 已经在生成
   `entities.gen.ts`),生成器合并「能力模块导出的 layer」。这是**第二套机制**,与第 2 步不同,
   不要混做。
5. **`ping`**:就绪探针改为插件注册,`health.ts` 不再点名 database。
6. **验收**:能力边界测试加一例 —— 无 database 的装配 `renderRuntimeModule` 产出不含
   database,且组合根编译通过。

**清单 config 进被提交的生成文件安全**:`databaseWork` 已经硬拒 `config.url` 并指明
「连接串放环境变量,清单是提交物」,所以清单 config 按规则就是非密的。这条门禁已经存在。

**此草稿已被取代**:设计在 docs/assembly-design.md「阶段 2.6:组合根收口」(v2)。v2 的核心:
只有「不启动应用就必须存在」的值走静态文件(entities/契约/chunk 表/layer 列表);
login-drivers、ui surfaces、permissions 运行时目录、readiness 全部改为 Effect 原生注册表
(服务即注册表、Layer 即注册、layer 图即 loader.await、acquireRelease 即 ctx.effect,
上游例证 HttpRouter.use 与 HttpApiBuilder.group)。**完整实施方案在 docs/composition-root-plan.md(v3)**:注册表 API 逐个定型(Ui 是 addPage/registerLayout/contribute/fillSlot 四方法,不是笼统 register),五条注册表纪律,permissions 因 rbac 构建期把 catalog 镜像进表(时序倒置实证)改回静态能力;按该文档 §9 的 1→8 实施。

### 开发库清理(2026-08-06)

一次清掉 14 个残留库(约 100MB):4 个过期 `qualy_tpl_*`(模板按 lineage 内容寻址,迁移改一次
生一个新的,旧的没人回收)、7 个 `qualy_upgrade_*` 与 `qualy_ddl_probe`(已删除的
migration-upgrade 测试留下的,来自被中断的运行)、`qualy_fresh`/`qualy_psql`(我做空库 deploy
与 `psql -f` 验证时建的)。留下的 `qualy_tpl_5fc62b89ff2e9de1` 是当前 lineage 的模板,**正常且
必要**:测试靠 `CREATE DATABASE ... TEMPLATE` 复制它,免掉每套件重放迁移,故意跨运行保留。

**没有做自动清理**:testkit 的 dispose 在正常路径上是干净的,这批全部来自 Ctrl+C 打断的运行;
而「测试启动时按名字模式删库」在并行跑十几个文件时会删掉别人正在用的库,风险远大于收益。
需要时一句 psql 即可。

### 阶段 2.6 第 1 步完成:Readiness 注册表

`@qualy/api-kit/readiness` 提供注册表服务(register 挂 scope、checks 请求期读),database 插件
在自己的 layer 里注册预绑定的探针,`health.ts` 不再 import 任何插件。

**实施中改了一处设计**:注册用 `Effect.serviceOption` 而不是把 Readiness 列进 layer 的
requirement。硬需求会传染到每个提供 `context.services` 的测试 harness —— 而「一个只想要数据库
的套件不必知道就绪探针存在」正是本次要拆的耦合,只是方向相反。与 rbac 可选注册 ui authorizer 同型。

新增用例:**没有任何探针的装配,`/health/ready` 返回 200**。这个组合在改动前根本无法构建
(handler 直接 import 了 database 插件),所以它不是漏测,是不可能。反向验证:把注册条件取反,
两条既有就绪用例立刻红。

### mikro-orm 7.1.11:少了一个 patch hunk

你提的四条上游都修了。做法不是猜哪几条:**先把 patch 整个拿掉跑门禁**,让测试回答 ——
kysely 类型套件直接绿了(7.1.11 里就是 `default: unknown`,正是那个缺陷),两条 introspection
用例仍然红。所以按 7.1.11 重建 patch,只留仍然挣得到的两个 hunk,上游源码也确认了原因:
`PostgreSqlSchemaHelper.ts:699` 的 check cast 剥离与 `:407` 的索引 access method 丢失原样还在。
那两条(草稿 5、6)从没提过。vendored 树随之到 v7.1.11,patch 注释里引的路径是存在的路径。

### 阶段 2.6 第 2 步完成:LoginDrivers 注册表

契约的值从 `readonly LoginDriver[]` 变成句柄(`register` 挂 scope / `forType` 请求期查)。
auth 用 `provideMerge(loginDriversLayer)` 把注册表连同自己一起发布 —— 它是唯一消费者,而驱动
插件需要在 auth 建成之前有地方注册。auth-local 的整个 layer 现在就是一行
`registerLoginDriver(driver)`。

删除:`gen-login-drivers.ts`、`login-drivers.gen.ts`、`src/login-driver.ts`、
`exports['./login-driver']`、`qualy.loginDriver` 声明、宿主的 `loginDriversLayer`。
**一种登录方式的成本从「文件 + 子路径 + 声明 + 生成器」变成 layer 里的一行。**

**顺带找到一个洞**:把 auth-local 的注册删掉,336 例全绿 —— 从来没有任何测试断言 local 登录
方式真的被提供。生成器时代它是结构性成立的,所以没人写断言;而注册是一行代码,一行代码可以
被删掉。补了一例(真实 pluginLayers 起服务 + seed 一行 provider,断言 `/auth/login-methods`
含 local 且 component 正确),删注册即红。

### 阶段 2.6 第 3 步完成:Ui 注册表(`ctx.ui.addPage` 回归)

`@qualy/plugin-ui-registry/server/registry` 提供 `Ui`,四个领域方法(`addPage` / `registerLayout` /
`contribute` / `fillSlot`)加批量的 `registerSurfaces`。UiManifest 改为**请求期**读注册表再投影
(原来构建期 flatten,那是实现选择不是必要)。ui-registry 用 `provideMerge(uiLayer)` 把注册表
连同 manifest 一起发布,贡献方在自己 layer 里注册。删除 `UiCatalog`、`gen-ui.ts`、`ui.gen.ts`、
宿主 `uiCatalogLayer`。

三处与方案不同:

1. **component-keys 门禁不用改** —— 它读的是 client 的 `components` 映射,从来不经 `ui.gen`。
   方案里那条顾虑是多余的。
2. 注册表必须放**无环子路径**:ui-registry 的 server 入口引用 auth 的 session-contract,贡献方
   再引用 server 入口就成环,TS 把一侧解析成 `any`,错误信息还落在 main.ts 上、离原因很远。
   拆 `./server/registry`(只依赖 effect + ui-contract)解决,与既有的 `server/authorizer`、
   `auth/server/session-contract` 同一前例。
3. layout-default 从此有 runtime entry —— 它确实向运行时贡献布局实现,之前只靠 `./ui` 被生成器
   扫到。+1 个插件文件,-2 个仓库文件。

**又一个洞,与 login driver 同型**:删掉 ping 或 layout-default 的界面注册,336 例全绿。补了一例
断言真实 manifest 含 ping 的页面和 admin-shell 的实现(删任一注册即红),外加三例重复声明拒绝
(页面 id / 路径 / 布局契约)—— 那正是被删掉的 `gen-ui.ts` 原来守的三条,现在在 boot 期守,
而 boot 本来就是它最终会被抓到的地方。

**教训**:排错时用 `head -4` 截错误列表,把真正的 `TS2304: Cannot find name 'Ui'` 截掉了,
在无关的 `any` 上绕了很久。错误列表不要截。

### 阶段 2.6 第 4 步完成:config 通道 + auth/web 搬家

`qualy.runtime.config: true` 声明「我的 runtime entry 导出 `config`」。生成器把该插件的清单块
**作为字面量**写进调用:`pluginAuthConfig({}, { manifestDir })`,由插件自己声明的参数类型在
typecheck 期校验。`manifestDir` 只在真有插件收配置时才 emit;`renderRuntimeModule` 因此多一个
`modulePath` 参数 —— 从生成模块回到清单的相对锚点,只有调用方知道模块写去哪。

auth 的三个环境变量与 web 的模式判断搬回各自插件。web 还多做一件事:`sourceRoot`/`assetRoot`
是路径,由它自己按 `manifestDir` resolve —— 核心不知道哪个键是路径。

resolve 期原本就有一条「给了 config 但只有 capability provider 会读」的硬失败,现在它也认
`runtime.config`,所以「设置看起来生效实际没人读」这个失败形态仍然被堵住。

三例新测试 + 真实启动验证。**注意**:业务测试直接注入 AuthConfig 服务(设计如此,方案里写明),
所以 `config` 导出这条路只有真实启动会走到 —— 用 `login-methods` 验的,它需要 `defaultTenantSlug`
才能找到租户。

### 阶段 2.6 第 5 步完成:database config 搬家 + 生产禁 fallback

`DatabaseConfig` 由插件自己的 `config` 导出构建:环境变量自己读,`migrationsFolder` 自己按
`manifestDir` resolve。宿主的 `databaseConfigLayer` 与 `manifestMigrationsFolder` 一并删除。

**审计第 8 条落地**:`NODE_ENV=production` 且没有 `DATABASE_URL` 时 die —— 否则生产实例会连上
localhost 上碰巧存在的那个 postgres,而且 migrations 默认是 apply,等于往没人打算给它的库里
写 lineage,开场只有一行没人看的警告。

顺带:`LOCAL_FALLBACK` 与 `MIGRATIONS_FOLDER` 收进零依赖的 `src/defaults.ts`。原来 CLI 侧
(assembly/work.ts)与运行时侧各一份,靠 assembly-config 里一条「断言两者相等」的测试守着;
实现只有一份之后,那条测试不必存在,那套测试改成直接问插件的 `config` 导出。

三个 config 导出的清单校验一律 `onExcessProperty: 'error'` —— Effect Schema 默认是 `ignore`,
而「多写一个键被静默丢掉」正是这条通道要防的失败形态(`url` 尤其:清单是提交物,连接串写进去
就是版本控制里的凭据)。

**教训**:默认 ConfigProvider 只读一次 `process.env`。测试里先跑一遍、改环境变量、再跑一遍,
第二遍读到的仍是第一次的值 —— 生产分支因此一直没被走到。改成显式
`ConfigProvider.layer(ConfigProvider.fromEnv({ env }))` 把环境**供给**进去,而不是改进程的。

### 阶段 2.6 第 6-8 步完成:宿主不再点名任何插件

**permissions 升为 rbac 的能力**(`@qualy/plugin-rbac/assembly`)。`layerExport` 契约字段随之落地:
生成模块自己 import `PermissionCatalog` 并导出 layer,runtime 生成器把它并进 `capabilityLayers`。
entities 同样处理。`gen-permissions.ts` 删除,seed 改读 `qualy.contributions.permissions.entry`。

三处实施发现:

1. **disabled 语义两个能力不一样**。停用插件保留表(不能丢数据),但必须**停止**贡献权限码
   —— 否则是一条没人服务的授权。所以 permissions 的 resolve 只取 active 集,而 database 取
   retained 集。同一个问题两个答案,正好说明为什么每个能力自己回答。
2. **生成模块跟随清单的 workspace**(与 entities 一致),而旧的 `gen-permissions.ts` 写死
   `apps/server/`。这修掉一个潜在 bug:用 `--yml` 指向另一份清单时,旧生成器会把那份装配的
   权限目录写进本仓库的 `apps/server/`。
3. **org/auth/rbac 从 resolve 期起就是一个整体**。它们互相贡献与依赖,单选其一现在会被拒。
   测试夹具改成选真实闭包 —— 那本来就是这三个插件的真相,只是过去 database 能力不在乎。

**终局**:`apps/server/src` 里没有任何 `@qualy/plugin-*` 导入,由 capability-boundary 的
扫目录用例守住(把 `capabilityLayers` 从组合里删掉,typecheck 立刻两个错)。
`runtime.gen.ts` 导出三样:`pluginLayers`、`pluginConfig`、`capabilityLayers`。

**第 8 步里没做的那半**:没有把宿主收成单个 `assembly` 导出。`runtime.ts` 仍自己组合这三者加
readiness、logger、api/health/routes —— 那些是宿主自己的领地(端口、文档曝光、两个 API 的挂载
方式),塞进生成器只会让生成器学会宿主的事。目标(宿主不点名插件)已经达到。

### CI 教训:不要用 grep 过滤门禁输出

CI 挂在 `pnpm typecheck`,本地却"通过"了 —— 我一直在跑
`pnpm typecheck 2>&1 | grep -E "error|message"`,而那次的诊断是 `warning TS18`
(Effect LSP 的 `multipleEffectProvide`),既不匹配 grep,管道又把退出码换成了 grep 的。
同一天早些时候还用 `head -4` 截掉过真正的 `TS2304`。**门禁看退出码,不看过滤后的文本。**

### 审计第 1、4、6、7、9 条

**1 destructive guard 提到写盘之前**。原来是「写 → 扫 → 抛」,被拒的迁移已经在 `db/migrations` 里,
下一次部署会应用它,而且它编进去的 baseline 片段会被下一次 generate 当成「已编译」——**拒绝一次会让
那些片段从此再也不出现在任何迁移里**。改成内存渲染 → 扫 → 临时文件 + rename 落盘。
新增用例:一个只贡献 `DROP TABLE` baseline 的合成插件,generate 抛错且 `db/migrations` 为空目录。
(伪造验证:把两行顺序换回来,该用例立刻红。)

**4 实体碰撞改读元数据**。原正则扫源码 `\b(name|tableName):\s*'([^']+)'`:把 check/index 对象里的
`name:` 当实体、只认单引号、同插件内重名不报。改成读 `EntitySchema.meta.className / tableName`
—— 解析声明是解析器的活,而**生成本来就已经把模块 import 进来了**。因此检查从 `modules()`(codegen,
纯函数、不许 import)挪到 `loadEntityModules()`(generate/deploy)。上游只在 ORM 启动时查**表名**重复
(`MetadataValidator.ts:158`),消息里只有表名、没有插件名,实体名重复根本不查。

同类问题在 rbac 的权限码扫描上**保留正则**,理由不同:resolve **也在启动时跑**,那里没有任何东西能编译
插件的 TypeScript,所以 resolve 不能 import。改为承认它是「早期答案」,并在 rbac 真正镜像目录的那个
循环里加一条精确判定(此前重复码会被静默后写覆盖:upsert 会把 plugin 列改成第二个插件,原有的
「与存储行冲突」检查因此放行)。

**6 cleanup 不再遮蔽根因**。`finally` 里抛出会替换掉正在抛的错误;上一轮的半修(主体失败时**吞掉**清理
失败)又丢掉了「有一个库留在真实服务器上」这条事实。新增 `src/cleanup.ts`:两个失败一起进
AggregateError,**根因在 errors[0]**。`closeAll` 同理:原来 `await a.close(); await b.close()` 第一个抛
就漏掉第二个,而没关掉的连接正是随后 drop 失败的原因,于是报出来的是症状的症状。三处调用:
structuralDiff、diffAgainstDeclared、schemaParity。五条纯逻辑用例。

**7 启动期失败与叙述对齐**。模块头一直声称「三种失败都在 layer 的 error channel 里」,实际只有
`MigrationsBehind` 是,ORM 初始化与迁移执行都是 `Effect.promise`(defect,类型说 `never`)。
新增 `DatabaseStartupFailed` 与 `MigrationFailed`,导出 `StartupFailure` 联合。

**实查上游**:`MikroORM.init` **不连接数据库**(repos/mikro-orm/packages/core/src/MikroORM.ts:120-144,
只 discover 元数据 + createEntityManager;`connect()` 是 :176 的另一个方法,而且 sql 侧的
`connect()` 也只是 initClient,pg Pool 本身是惰性的)。所以「服务器连不上」在两种 migrations 模式下
都由**迁移器**先发现——它无论如何都会自己开一条连接。`MigrationFailed` 因此带 attempted 短语,
消息是 `could not apply the lineage: ...` / `could not read the migration ledger: ...`。
`DatabaseStartupFailed` 覆盖 init 真正会失败的事(实体元数据不合法等)。三条用例,伪造验证过
(把 catch 换成 rethrow,「entity set will not load」立刻报 `the layer died rather than failing`)。

**9 compositeForeignKeys 加载期校验**。原来只校验 `entities` 是数组;导出成字符串会被 `for...of`
逐字符展开,每个字符当一条语句执行。

**API 实查教训**:我按记忆写了 `Cause.failures(...)`,不存在。v4 beta.103 的 API 是
`Cause.findErrorOption` / `findError`(Result)/ `hasFails`,见
repos/effect/packages/effect/src/Cause.ts:761-840。

### 审计第 2、3 条:错误定义收成一份,并把守门人重新装上

审计说「两个事实源已经漂移」,提议合成一份中立描述表让两侧派生。**实际做法是删掉一份**,因为查完
之后发现 zod 那份**在运行时已经没有任何调用者**:oRPC 全仓零引用,`orgErrors.create()` 之类一次都
没有,`defineErrorTranslations(errors, table)` 里那个参数是 `void errors`(只用类型)。所以它只是
在给前端翻译表提供类型。

于是:`ErrorsByCode<typeof import('.../server/errors.ts')>` 从 Effect 的 TaggedErrorClass 直接推出
「码 → 错误实例」,`defineErrorTranslations` 改柯里化(错误集只作类型参数,前端 `import type *`,
**零字节进 bundle**——传值会把整个 server 模块拉进浏览器)。删掉 5 个 zod 表和整个
`@qualy/api-contract` 包(8 个 package.json 的依赖条目一并清理)。

**漂移实录**(现在是编译错误):`ORG_RULE_CONFLICT`(幂等 PUT 之后已不存在)与 `IDENTITY_CONFLICT`
翻成了两种语言而没有任何东西能抛它们。

**第 3 条门禁** `scripts/tests/error-codes.test.ts` 七条:自身完整性(扫全仓 `TaggedErrorClass<`,
文件不在清单里就失败)、全局唯一(旧的唯一性检查随 gen-plugins 的 oRPC 聚合一起没了)、
`^[A-Z][A-Z0-9_]*$`、identifier + 400-599 状态、每个码恰好被拥有它的一方翻译一次、不翻译不存在的码、
公共表只留能被抛出的码。

**门禁一上就抓到四条真问题**:①`ACCESS_DENIED` 与 `BAD_REQUEST` 前端根本没有翻译(浏览器一直在
显示后端英文句子);②公共表里 `FORBIDDEN` / `NOT_FOUND` / `INPUT_VALIDATION_FAILED` /
`INTERNAL_SERVER_ERROR` 四条**没有任何东西会抛**——它们是 oRPC 边界的产物,那层边界已经不存在了;
③`asApiError` 的 tagged 分支**丢掉了 message**,所以未翻译的码连英文兜底都拿不到,直接显示
「操作失败,请重试」(旧的 ORPCError 分支在测试里替它遮住了这个 bug,测试夹具也还在造
`name: 'ORPCError'` 的对象);④rbac-contract 里 `LAST_ADMINISTRATOR` 与 `ACCESS_DENIED` 归属不同
——前者是 rbac 拥有的跨插件不变量(按 CLAUDE 的规则由拥有规则的插件翻译),后者人人都能抛。

**没做,并给出理由**:审计第 3 条还要求「插件私有错误带领域前缀 ORG__/AUTH__/RBAC_*」。CLAUDE 的
既有裁决是**全局唯一 + 只在跨插件同义时加前缀**(`ROLE_ORG_TYPE_NOT_FOUND` /
`USER_TYPE_ORG_TYPE_NOT_FOUND`),两套规则不能同时为真。前缀是为了保证唯一,而唯一性现在由门禁
直接守;真按前缀重命名要改约 55 个**线上协议码**加两份语言目录与相关测试。若要改按前缀统一,
这是一次独立的破坏性改名,应当单独决策。

**顺带**:`asApiError` 里的 ORPCError 分支删除(全仓已无 oRPC)。**遗留**:前端仍把 query utils
变量叫 `orpc`(`useApiQuery()` 的返回值,十几个组件),纯命名残留,与本轮无关。

### 审计第 5 条:parity 加深

**clean-room parity**(整条 lineage 对整条 lineage)补齐四类:①列宽与精度——原来只比 `data_type`,
而每个 varchar 在它眼里都是 `character varying`,255 与 100 完全相等(逐插件那份 parity 早就吃过这个
亏并修了,整体这份没有);②函数改比 `pg_get_functiondef` 全文,原来只比「名字/参数类型」,函数体改了
全绿;③触发器改比 `pg_get_triggerdef` 全文,原来只比 `表.触发器名`;④新增视图(`pg_get_viewdef`)、
物化视图(`pg_matviews`)与枚举标签(`pg_enum`)。

**逐插件 parity** 补触发器(表作用域,随表一起被删,所以生成侧必须经 `afterCreate` 声明才能留下)。

**伪造验证**:把 `tenants.name` 从 255 改成 200,clean-room 立刻红并逐行打印
`character varying(255)` vs `(200)`;改回后绿。这条差异在改动之前是**完全看不见**的。

**当前都是空集**:本 schema 没有函数、视图、物化视图、触发器,状态用 check 约束而不是 PG 枚举。
它们现在比的是空对空——价值在于哪天有了,改一行函数体或触发条件会是差异而不是「名字一样就过」。

**没做**:审计还提到「baseline 声明的必需数据行的显式探针」。全仓只有一条 baseline 片段
(org 的 `CREATE EXTENSION ltree`),它已经有显式锚点断言;没有任何插件用 baseline 插数据行,
按冻结元规则不为不存在的东西建探针。触发条件:第一条带 `INSERT ... ON CONFLICT DO NOTHING`
的 baseline 片段落地。

### 本轮验收(2026-08-06)

GitHub Actions 这天在故障中:本轮三个提交的 run 连续三次 **cancelled**,`steps: []`,每次排队整
15 分钟一步都没跑起来(`gh api .../attempts/3/jobs` 实录)。上一条提交 33f4d10 用同一份 workflow
是 success,所以不是配置问题,是拿不到 runner。**因此把 CI 的每一条命令在本地逐条跑了一遍**:

```
pnpm install --frozen-lockfile   Already up to date            (删掉 api-contract 之后 lock 一致)
pnpm qualy resolve --frozen-lockfile   qualy.lock.json is up to date
pnpm typecheck                   11 个工程零错误
pnpm qualy database check        database: lineage ok
pnpm qualy generate              database: nothing to generate + git status 干净
pnpm qualy database drop-guard   drop guard ok (2 file(s) scanned)
pnpm test                        58 files / 361 passed
pnpm test:browser                13 passed
pnpm build                       built in 501ms + staged assets ok
check-chunks                     org/OrgPage、ping/PingPage、rbac/RolesPage chunk present
```

真实启动 `PORT=3061 pnpm dev`:`/health/live` 200、`/health/ready` 200、`/api/app/manifest` 200、
`/api/auth/login-methods` 返回 local、未知路由 404,日志零 `[E]`。

### permissions 回到注册形态:assembled 屏障

用户裁定:装配完成前不放行接口,permissions 就能像 ui 一样在启动期注册。实施后发现旧论证的两半
都不成立:①「registry 会被空读」——只在**构建期**读才成立,读挪到屏障(全部 layer 建完、端口未绑)
就没有窗口;②「seed 需要静态目录」——seed 从来读的是 `qualy.contributions.permissions`(package.json
声明),根本没消费过 permissions.gen.ts。

**Assembled 屏障**(`@qualy/api-kit/assembled`):与 Readiness 同形的注册表 + `assembledBarrier`。
宿主 `server.pipe(Layer.provide(booted))` —— **实查上游** `Layer.ts:1329-1348` `provideWith` 是
`flatMap(that.build, ...)`,被 provide 的层无条件先建完,memoMap 贯穿所以 pluginLayers 只建一次。
hook 失败 = 启动失败,端口不绑。

**Permissions registry**(`@qualy/rbac-contract/effect`):rbac 提供(读者拥有注册表,与 Ui 同理),
贡献方 `declarePermissions('org', permissions)` 在自己 layer 里声明,重复码在声明时硬失败并点名双方。
rbac 的镜像循环原样搬进 boot hook。org/auth 各加一行。permissions.gen.ts 与 rbac assembly 的
modules() 删除;resolve 保留(active 集入 lock、源码级重复扫描作早期答案、entry 与 exports 等同校验)。

**测试台**:`@qualy/rbac-contract/testkit` 增 `booted(services, {catalog?})` —— 按生产顺序组
registry→服务→声明→屏障。10 个 harness 换装;**真实插件自声明后,fixture 重复声明真实码立刻被
registry 拒掉**(die),照做修剪:auth/org 的 fixture 目录整个删除,rbac 的只留它自己不声明的码。
fixture 里 `on conflict do update set plugin = excluded.plugin` 会改写镜像行的 owner、被 catalog
钉住检查判掉,全部改为保留镜像行的 no-op upsert。

**验收**:361→358 node(删 3 条 gen 目录用例、加 1 条 resolution 态用例 + 3 条屏障单元),13 browser,
typecheck 11 工程零错;真实启动:登录 → `/api/iam/roles` 200、admin manifest 7 页、permissions 表
16 行 owners auth(4)/org(2)/rbac(10)。**伪造验证**:注释掉 `Layer.provide(booted)` 重启,同一调用
403、manifest 缩到 2 页(fail closed)——屏障是承重的。

### 插件形态收口:入口 src/index.ts、client 进 src、ui.ts 拆分

用户裁定三件事,全部落地:

**① 入口是 `src/index.ts`**(`exports["."]`、`qualy.runtime.entry: "."`,三个生成器补 `'.'` → 包名
的 specifier 规则)。入口是组合根:引入能力并注册,别无其他。ping/auth-local/layout-default 整个
服务端就在入口里;auth/org/rbac 的入口做注册组合(`serviceLayer` + `registerSurfaces` +
`declarePermissions` + handlers 再导出),service 本体仍在 `src/server/`(988/781/445 行的内部拆分
是下一步,规则本来就有)。**不是 barrel**:`./db` `./permissions` `./api` `./pages` `./client`
仍是叶子子路径——四类消费者要的子集互斥,一个全量 index 会把 effect 拖进浏览器、把 React 拖进 CLI。

**② `ui.ts` 拆掉**:页面身份(`definePage`)进 `src/pages.ts`(浏览器要跨插件 import 它,
UserMenu 对 loginPage 就是),surfaces 直接写在入口的 `registerSurfaces` 调用处——实测它只有
本插件入口一个消费者。`./ui` 子路径删除。

**③ `client/` 搬进 `src/client/`**。根 tsconfig 与 plugin-isolation 门禁 exclude `src/client`
(Node 类型的工程不看浏览器代码,各 client 自带 tsconfig 照旧被 typecheck 脚本发现)。

**顺带清理**:auth-local 孤儿 `login-driver.ts`(生成器删掉后没人 import)、宿主 runtime.ts 里
重复的注释块与多余的 mergeAll(Effect LSP 的 TS37 顺手修掉)。

**验收**:typecheck 11 工程零错;node 361 / browser 13 全绿;`pnpm build` + check-chunks 四个
chunk 全在;`resolve --frozen-lockfile` 干净;真实启动(PORT=3064):登录 → roles 200、manifest
7 页、`/api/ping/hello` 200、`/ping` 外壳 200,日志零 `[E]`。

**未做,记触发条件**:①组件键仍是 `component: 'ping/PingPage'`,可由 page id 派生省一个名字——
等下一轮 UI 触碰时一起;②auth/org/rbac 的 server/index.ts 内部拆分(handlers/service 分文件)。

### api-handlers.gen.ts 消失(codegen 收缩第 1 步)

用户方向:尽可能去 codegen。裁定分两半:**能死的是"值"的聚合,必须留的是"类型/打包"产物**
(`@qualy/api` 是浏览器 client 类型与 openapi 的来源、`plugins.gen` 是 Vite chunk 图、
entities 的 schema 语义属于 retained 集)。第 1 步杀 api-handlers.gen.ts;
runtime.gen/entities.gen/routes.gen 由运行时装配器统一处理,方案已给用户、等发话。

**实施**:每个入口统一导出 `apiHandlers`(与 `layer`/`config`/`routes` 同列的入口契约,不再有
`<ns>ApiHandlers` 命名约定);runtime.gen 聚合它们(`qualy.runtime.api` 为真即 import,纯元数据、
不动态加载);gen-api 只剩定义聚合那一半;宿主从 runtime.gen 取 `apiHandlers`。配对检查从生成器的
字符串比对变成编译器的服务需求(`HttpApiBuilder.layer` 要求每个 group 的 handler 服务)。

**一次失败的中间方案,教训记下**:曾把 handler 层直接并进插件 `layer`。上游事实
(HttpApiBuilder.ts `HandlerRequirements`、HttpRouter.ts:770-795 与 serve 的 `HR`)是:
handler 的请求期需求分两类——幻影标记(`Request<"Requires", X>`)只在 `HttpRouter.serve`
参数内部解包;**中间件 tag(Authenticated/Viewer)是真实 R**。ui-registry 的 manifest handler
请求期要 auth 的 viewer 中间件,而 auth 构建期依赖 ui-registry——构建图无环、请求图有环,
group 并进 entry 后 pluginLayers 出现 R∩Out 重叠,而 `provide(x, x)` 自闭合在 Layer 代数里
不成立(provide 会把 x 的 R 重新并进来)。**结论:group 层必须组合在全部插件服务之上**,
这就是聚合存在的结构性理由;它可以不再是独立文件,但不能塌进各 entry。

**验收**:typecheck 11 工程零错;node 361 / browser 13;真实启动:登录 → roles 200、manifest 7 页、
ping 200、openapi.json 200,日志零 `[E]`。apps/server 下 .gen.ts 从 4 个变 3 个。

### M1:插件描述器原型落地(docs/plugin-descriptor-plan.md)

审计(docs/assembly-new.md)采纳,计划文档落盘并经用户裁决:M1 原型先行、M2 分批不一次切完、
@qualy/api 保留到 M4。本轮 M1 完成:

**`@qualy/plugin-kit` 内核**:Plugin / Feature / ExtensionPoint 三概念 + 三相
(prepare / afterServices / boot)。关键类型两处:①`AnyLayer = Layer<never, any, any>` ——
**Layer 对输出是逆变的**(provide 消费输出),萬能接受位在 never 不在 any;②`Plugin.service`
的 requires 是真实 Tag 数组,作 layer R 的上界,插件多要一个服务在**自己**的 typecheck 报错
—— 无 codegen 下保住依赖诚实性的关键。原型装配器 `assemble()`:按相编译扩展点、服务按列表序
provideMerge(Tag 拓扑留给批 5)、"贡献无人解释"按 CLI 同款规则点名硬拒。

**三个 Feature 构造器**在各能力自己的包(开放世界,内核零能力知识):
`Postgres.entities/provider`(@qualy/plugin-database/plugin)、`ReactUi.surfaces/provider`
(@qualy/plugin-ui-registry/plugin)、`Api.group/provider`(@qualy/api-kit/plugin)。
Api.group 收**已构建的 group layer**而非工厂 —— Layer 本身就是延迟值,上游推断原样保留,
类型擦除只在 provider 的聚合循环里(`HttpApiGroup.Constraint` 是上游 `add` 自己的参数约束)。

**ping 描述器 + 桥**:default export = `Plugin.define(id, Postgres.entities(..),
ReactUi.surfaces(..), Api.group(..))`;legacy `layer`/`apiHandlers` 导出由**同一批常量**派生,
两形态无从漂移;宿主照旧走 runtime.gen,主系统零改动。

**审计四点验证**(scripts/tests/descriptor-prototype.test.ts,5 例):①根 default-export 纯数据
描述器;②`Plugin.contributionsOf` 不构建任何东西取出实体(ping_logs 在列);③页面进目录而 ping
从未 require Ui(prepared 单独构建即含 ping/page);④handler 在完整服务图之上闭合并真实 served
(`/api/ping/hello` 200、行入库);外加:贡献无人解释时点名双方硬拒。

**验收**:typecheck 11 工程零错;node 366(+5)/ browser 13;真实启动经桥照常
(live 200、ping 200,零 [E])。M2 批 1(compat 派生助手)待继续。

### M2 批 1-4:八个插件全部成为描述器(宿主未切)

四批四个提交,每批门禁全绿:

- **批 1**(2d6c1e7):桥机制化 —— `legacySurfaceLayer(plugin)` 等派生函数从描述器推出 legacy
  注册层,两形态无从漂移。**类型事实**:handler 桥必须保持直接导出 —— 描述器存的是擦除的
  AnyLayer,而过渡期 runtime.gen 的精确类型(中间件与请求期标记)是 serve 解包的依据。
- **批 2**(d5086dd):layout-default、auth-local。新增 `Login.driver` feature
  (@qualy/auth-contract/plugin)。
- **批 3**(a909a1d):ui-registry、database 自己也 default-export 描述器
  (provider + Plugin.layer)。
- **批 4**(本提交):auth、org、rbac。新增 `Access.permissions` feature
  (@qualy/rbac-contract/plugin)。rbac 的自有码从 service layer 里的 `registry.declare('rbac', …)`
  挪进描述器 —— 两处并存会撞 registry 的重复码硬拒;它的桥用 **provideMerge** 而非 merge,
  因为声明要进的 registry 正是它自己的 service 提供的(merge 不接线)。

**现状**:8/8 插件 default-export `Plugin.define(...)`;legacy `layer`/`apiHandlers`/`config`
导出全部由同一批常量或描述器派生;宿主与三个 gen 文件未动,批 5(宿主切换)待做。

**验收**:typecheck 11 工程零错;node 366 / browser 13;真实启动:登录 → roles 200、
manifest 7 页、ping 200,日志零 [E]。

### M2 批 5:宿主切换完成,服务端 codegen 归零

apps/server 下再无任何 .gen.ts。`pnpm gen` 只剩浏览器产物(@qualy/api 类型聚合 + plugins.gen
chunk 表)。三个提交:5a 能力面(14b0805)、5b 本体、文档。

**装配流程(已是生产路径)**:main.ts 跑 verify(lockDrift,生成物检查随文件一起消失)拿到
resolution → `makeApplication(resolution)` → `loadAssembly` 按 `runtimeLevels` 展平的依赖序
动态 import 各插件 default 描述器、给 configured 插件调 `config(block, {manifestDir})` →
`assemble()` 三相:prepare 编译目录(Entities / PermissionCatalog / LoginDrivers / Ui 全为
**构建前就完整的值**)→ 服务按序 provideMerge → afterServices 在完整服务之上闭合
(运行时 HttpApi 聚合 + raw routes)→ Assembled 屏障(rbac 镜像)→ 绑端口。
宿主自己也是描述器(`@qualy/app`:Api.provider 带文档曝光决策 + routesProvider)。

**审计预言兑现**:auth→Ui 的构建期边消失(页面是 prepare 数据),permissions 注册表退回目录值
(`compileCatalog` 重复码点名硬拒,harness 直接 `Layer.succeed(PermissionCatalog, ...)`——
绕了一圈回到原点,但这次是描述器在喂它)。上一轮的屏障保留且只干真正的启动后工作。

**类型账**:插件侧零 cast;擦除集中三点(Api.provider 聚合循环、装配器 AnyLayer、宿主
makeApplication 返回处一次 narrow)。整装配的编译期闭合让位给 boot 校验——已伪造验证:
注释掉 rbac 描述器里的 `Access.provider`,启动即
`@qualy/plugin-rbac, @qualy/plugin-auth, @qualy/plugin-org contribute(s) to
@qualy/rbac-contract/permissions, which no selected plugin provides`,点名双方。

**保留与瘦身**:qualy CLI 的 drift 检查只剩 lock(+ 机制上仍支持 capability modules,
由合成能力用例守);database assembly 删掉 modules()/renderEntityModule,retained 集语义
原样(entityContributions 按 lock 供 generate/deploy;seed 传空实体——lineage 是纯 SQL);
runtime-plan 只剩拓扑(runtimeLayers/runtimeLevels),render 半边删除。

**测试台**:harness 改 `serviceLayer` + `booted({catalog})`(catalog = `compileCatalog`
的真实声明,与生产同一编译函数);effect-api 直接跑生产 `loadAssembly`(滤掉 web 免 vite);
entities.test 收缩为碰撞与加载校验(生成模块用例退役,其语义由 assembly.test 的 retained/
依赖图用例覆盖)。

**验收**:typecheck 11 工程零错;node 356 / browser 13;`pnpm build` + 四 chunk;
`resolve --frozen-lockfile` 干净;真实启动(装配器路径):登录 → roles 200、manifest 7 页、
openapi/docs/外壳/ready 全 200,零 [E]。

**遗留(记触发条件)**:①org/auth/rbac 服务端内部的 entityManager/kyselyOf 调用点换
`Postgres.scope`(纯清扫);②M3 CLI 统一(resolve 改读描述器、qualy run 动态命令、
作废"resolve 不 import 插件代码"并改 CLAUDE);③CLAUDE 插件形态节需按描述器模型重写
(与 M3 一起,避免改两次)。

### M3a:CLI 动态命令落地

**结构裁决**(先例分析入 docs/plugin-descriptor-plan.md):名词优先两级
`qualy <namespace> <command>`,**不加 run 间接层**——npm 的 `run` 是给任意用户脚本防冲突的,
qualy 的命令来自插件声明,命名空间即所有权(docker buildx / rails db:migrate 同款);
「一键一主」规则天然保证命名空间唯一。核心动词(resolve/plan/generate/deploy/list/help)是
保留字;`aliases` 支持;实现**惰性加载**(oclif 同款)——描述器保持轻,服务端 boot 不背迁移器。
`effect/unstable/cli`(Command/HelpDoc/Completions 全套在)暂不引入,feature 形状兼容,
等需要 typed options/补全时整体换壳。

**实施**:`@qualy/plugin-kit/cli` 定义 `CliCommands` 点 + `Cli.command` + `collectCliCommands`
(命名空间/别名/保留字三重硬拒,点名双方);scripts/qualy.ts 作 CLI 宿主解释(经
resolvePluginModuleUrl 走宿主包解析——根包故意不依赖业务插件);`qualy list` 列出生命周期 +
描述器命令 + 能力生命周期命令。首个动态命令:**`qualy db migrate`**(= deploy 的迁移半边,
`context: 'capability'` 档拿 CapabilityWorkContext),`qualy database migrate` 与别名双拼写实测通。

**内核新概念**:`ExtensionPhase` 增 `'external'`——由**另一个宿主**解释的通道(CLI 命令由命令
运行器解释,不由服务进程),层装配器对它零收集零 provider 要求;完整性规则只为自己构建的图发言。
发现过程:服务端装配器曾把 CLI 贡献当"没人解释"拒掉,这个相位就是那次失败的正确答案。

**CLAUDE**:插件形态节按描述器模型重写 + CLI 规则一节;M3b 前 `qualy.contributions/runtime`
仍在 package.json、"resolve 不 import 插件代码"仍有效(命令路由是唯一例外,已注明)。

**验收**:typecheck 11 工程零错;node 359 / browser 13;`qualy list`、`qualy db migrate`、
`qualy database migrate` 实测;未知命令/冲突命名空间/保留字占用三条硬拒有测试;真实启动照常零 [E]。

**M3b 待做**:resolve/lock/seed 改读描述器,database assembly 删声明解析,正式作废 resolve 纪律。

### M3b-1:qualy.runtime 消失,resolve 纪律作废

**范围裁决**:M3b 再切两刀——本轮杀 `qualy.runtime`(运行时元数据进描述器),
contributions/lock 重塑(M3b-2)与 127 处 `Postgres.scope` 清扫各自成轮。

**实施**:①`Plugin.define(id, options?, ...features)` 增选项:`dependsOn`(包 id 数组,
与 `Plugin.service` 的 Tag requires 并存——基础设施故意不导出 key)与 `config`
(manifest 块通道,函数直接住在描述器上);②resolve 在元数据校验之后 **import 每个 active
插件的 default 描述器**(报错优先级:坏声明先于缺描述器),`Resolution.descriptors` 暴露给
宿主——loadAssembly 不再自己 import,改同步;③config 通道单源化:三个插件的 `export const config`
再导出删除,签名改 `(manifest: unknown, ...)`(块来自 YAML,本就 unknown,函数内本来就在
decodeUnknown——原参数类型是方便的谎);④「给无通道插件配 config」的拒绝改读描述器,
测试同步;⑤gen-api 以 `exports['./api']` 存在性发现契约(runtime.api 死);
⑥八个 package.json 的 qualy.runtime 全删;⑦testkit 合成包 default-export 描述器**字面量**
(`{_tag:'Plugin', id, dependsOn, config?, features: []}`——isPluginDescriptor 收纯对象,
合成文件零 import),SyntheticPackage 增 dependsOn/takesConfig。

**纪律正式作废并写入 CLAUDE**:"resolve 不 import 插件代码"。描述器是纯值、import 零副作用,
但确实执行 TS;boot 的 verify-resolve 本来就在 import(装配器随后就要),模块缓存零额外成本。

**验收**:typecheck 11 工程零错;node 359 / browser 13;`resolve --frozen-lockfile` 干净
(lock 字节未变——runtime.plugins 形状没动);真实启动:登录 → roles 200、manifest 7 页、
ping 200,零 [E]。

**M3b-2 待做**:contributions(database entitiesEntry/baselineDir/dependsOn、permissions entry)
迁描述器,lock 记 feature 投影,seed 改读描述器,retained 集语义不变。
→ 已再切两刀:2a(permissions,见下)已完成;2b(database + capabilityProvider feature 化

- LOCKFILE_VERSION 升级)单独成轮。

### Postgres.scope 清扫:org/auth/rbac 全量

127 处 `entityManager/kyselyOf/query` 调用点归零:每插件的 `server/db.ts` 改为
`export const db = Postgres.scope(closure)` + `type Db = ScopedKysely<...>`;查询助手全部
去掉 `em` 首参(`db.query((k) => k.selectFrom...)`,ambient manager 在事务内自动加入——
这本来就是端口层已有的保证,`em` 线程化只是 cordis 时代的管道残留);builder 片段助手
(nodeColumns/people/standing/roleProjection/held/forPrincipal 等)改收 `k: Db` 首参。

**语义确认**:事务内行为完全不变(TransactionManager ambient);事务外从"一个 em 连发多条"
变"每条各自 fork"——这些是 Kysely 裸查询,不碰 identity map,自动提交语义等价。
关键测试全绿:锁内复核、`counts a person the caller has moved but not committed`
(未提交状态跨服务可见)、并发撤销单胜。**一次真实差异抓获**:auth 的 placement 测试里
本地 `const db = createTestContext(...)` 与导入的 scope `db` 同名遮蔽,改 `authDb` 别名——
遮蔽会让 `db.query` 撞上 testkit 的 SQL-string 签名,编译器当场拒绝。

**验收**:typecheck 11 工程零错;node 359(org 37 / auth 47 / rbac 31 全绿)/ browser 13;
真实启动:roles/org tree 200、manifest 7 页(`/api/iam/users` 的 400 为清扫前既有的
入参校验行为,对照验证过),零 [E]。

### 能力面命名:Db 与 Ui(2026-08-07,用户裁决)

`Postgres.*` → `Db.*`、`ReactUi.*` → `Ui.*`(25deb47)。Postgres 夸大了声明方
(defineEntity 是 orm 通用的,仓库其余地方都叫 database),ReactUi 低估了契约
(surface 声明是框架中立数据,React 只住在 client 注册表)。扩展点 id 不变
(`@qualy/plugin-database/entities`、`@qualy/plugin-ui-registry/surfaces`),
只动构造器命名空间。验收:typecheck 零错、node 361 + browser 13、真实启动干净。

### M3b-2a:permissions 迁描述器,seed 统一(2026-08-07)

**契约钩子**:`AssemblyCapabilityProvider` 增可选 `contributionFromDescriptor({pluginId,
descriptor})`——钩子存在即该能力**单源读描述器**,同键的 package.json 声明按 orphaned
硬拒(「reads contributions from the plugin descriptor now」),不做回退链。resolve 的
描述器循环从 active 扩到**全部 accounted 插件**(disabled/detached 的声明仍塑造装配,
包已由 uninstalled 检查保证在盘)。

**permissions 换轨**(首个使用者):rbac assembly provider 经
`Plugin.contributionsOf(descriptor, PermissionDeclarations)` 读声明,一插件一 owner
(多 owner 硬拒);lock 的 contribution 从 `{entry}` 变 `{owner, codes[]}`——评审 diff
直接看到码面(auth 4 / org 2 / rbac 10)。resolve 期查重改用运行时同一个
`compileCatalog`(早答案与权威答案是同一个函数);正则源码扫描、catalogFile、
exports["./permissions"] 一致性检查、`resolvePackageDir` 依赖全删。
`qualy.contributions.permissions` 从 auth/org/rbac 的 package.json 删除。
lock 只变内容不变版本(contribution 形状归 provider 所有,resolutionHash 自然翻新)。

**seed 统一**:scripts/lib/permission-entries.ts 改读描述器(readEntries all →
import default → `contributionsOf`),owner 直接来自声明本身(不再从包名派生);
PermissionDeclarations 经宿主解析动态 import(根故意不依赖 rbac-contract)。
exports 等价检查随"两个模块两个答案"的风险一起消失——现在只有描述器一个源。

**测试**:assembly-resolve 增 describe「descriptor-sourced contributions」——合成能力
(核心读不懂的 caps 键)验证①描述器贡献进 lock、静默 feature 不产生空条目、state 见到
贡献集;②package.json 残留声明被点名硬拒。

**验收(实际执行)**:`pnpm typecheck` 零错(11 工程);`pnpm test` 60 文件 361 全绿
(assembly-resolve 36、seed permissions:16 走描述器路径);`pnpm test:browser` 13;
`pnpm qualy resolve` 重写 lock 后 `--frozen-lockfile` 干净;真实启动 `/health/ready` 200、
`/api/iam/roles` 401(未认证 fail-closed)。

### M3b-2b:database 迁描述器 + capabilityProvider feature 化(2026-08-07)

**database 换轨**(两个 commit 的前一个):`Db.entities(entities, {dependsOn,
compositeForeignKeys, baselineDir})` 一个 feature 携带全部声明,四个 package.json 的
`qualy.contributions.database` 删除;entitiesEntry/loadEntityModules/exports 子路径核对
全部死掉——generate/deploy/adopt/`qualy db migrate` 经 `context.descriptors`(契约新增,
resolve/work/modules 三个上下文都带)直接拿声明值,与运行时编译的是同一批常量。
lock 投影 `{entities(实体名), baselineDir?, dependsOn}`(评审 diff 直接看到实体面);
**未升 LOCKFILE_VERSION**——形状归 provider 所有,唯一跨版本读者 `retainsPlugin`,
`lockedOwnsObjects` 同时认旧 `entitiesEntry` 形状,detached 语义保住(计划里写了升级,
实做发现不必:核心表结构未变)。

**resolve 期完整性恢复**:package.json 声明消失后「org 贡献 database 但没人提供」一度
只能等 boot 才报。裁决:能力扩展点自带归属——`ExtensionPoint.make(id, {phase,
capability})`,贡献方 import 的 point 对象本身携带能力键,resolve 在写 lock 之前按键拒绝
(报文与旧版一字不差);运行时通道(api/ui/login)无此键,归 boot 装配器完整性检查——
与旧行为精确对齐(它们本就没有 resolve 期检查,宿主描述器提供的 api 点 resolve 也看不见)。
先试过「泛化点级完整性搬进 resolve」,被产品清单自己证伪(api 组的 provider 在宿主
描述器上),遂收窄为能力键方案。

**capabilityProvider feature 化**(后一个 commit):`Plugin.capability(key, () =>
import('./assembly/index.ts'))` 上描述器,database/rbac 两个 package.json 声明删除;
resolve 改为先 import 全部候选(清单 ∪ lock 召回,均已装机)的描述器、再从中发现
provider——一键一主与「模块提供的 key 与声明不符」校验原样保留,lazy load 保证 boot
永不 import 迁移器。metadata.ts 的 provider 解析缩成 `declaresProvider` 布尔(仅用于
把残留的 package.json 声明按 orphaned 硬拒),契约删 `CapabilityProviderDeclaration`;
`qualy` 节对装配只剩 `contributions`(且仅无钩子能力在用,合成 cache 能力测试即此形态)。
test-layers 的 provider 入口门禁改从 `Plugin.capability` 声明发现(仍是按声明不按目录名)。

**验收(实际执行,两 commit 各自跑)**:`pnpm typecheck` 零错;`pnpm test` 60 文件 363
全绿(database assembly/clean-room-parity 真库套件、descriptor-sourced contributions、
两 provider 冲突拒绝);`pnpm test:browser` 13;`pnpm qualy resolve` 重写 lock 后
`--frozen-lockfile` 干净(feature 化一刀 lock 零变更);`qualy list`/`qualy db migrate`/
`qualy plan` 正常;真实启动 `/health/ready` 200、未认证 API 401、零 [E]。

**M3b 至此收口**。package.json 对装配的残余:仅 `qualy.contributions`(无钩子能力)。
下一个未裁决项:M4(每插件自持 typed client,删 @qualy/api 与全局 api-client)。

### 审计修复轮:内核收紧、前端去 codegen、生产可信边界(2026-08-07)

外部审计(M3b-1/M3b-2 两份)驱动,六个独立绿的 commit:

**f7744d0 内核**:`Plugin.service` 的 requires 拓扑真实落地(键重复提供/缺提供/成环在
assemble 期点名硬拒,keyed services 按真实 Tag 排序,`Plugin.layer` 保列表序垫底);
`boot` 相从 `ExtensionPhase` 删除(零使用者,不编译的相位只会静默吞贡献,一次性工作归
Assembled 屏障);descriptor.id ≠ 包 id 硬拒,descriptor import 失败包裹插件名;
ExtensionPoint 同 id 异形硬拒;provider compile 收 `Contributed<T>`(ui 重复页面、api
同组码都点名双方插件);prepare 相 compile 类型上强制零 requirement——**重载而非条件
类型**,实测上下文归型会把未解析的条件宽化到约束从而放行(红绿探针验证)。

**7d35534 常量**:`Api.local(group, ...)` 收走 api 聚合身份,插件/测试不再拼
QUALY_API_ID/PREFIX(六个插件文件 + 两个测试);其余跨插件常量核查为契约词汇,非债务。

**4d007f1 CLI(用户报的 CI 红)**:`qualy database check` 曾被描述器命名空间遮蔽——
命名空间命令 = 描述器命令 ∪ 同名能力命令,别名同达,同名双声明硬拒。

**e8bc669 virtual module**:`plugins.gen.ts` 死,`virtual:qualy/plugins` 由
scripts/lib/vite-qualy-plugins.ts 提供(collector 保留全部冲突检查;物化到
apps/web/node_modules/.qualy——**必须是可读文件**:纯内存 id 让 esbuild 依赖扫描
爬不进,react 分裂成预打包+源码两份,hook 崩溃实测);dev/build/浏览器测试同一逻辑,
build 取超集;main.ts 零前端生成,gen-api 由 Vite buildStart 拥有;scripts 锚定仓库根
(vite build 从 apps/web 跑);**strip-types 兼容成为现实约束**——resolve/Vite 配置让裸
node 以 strip-only 加载 workspace TS,五处参数属性全改普通字段。

**ff6c497 指纹 + 生产 smoke**:stage 写 `.qualy-assembly.json`(resolutionHash,dotfile
不外发),宿主提供 `AssemblyInfo`(api-kit/assembled),web 插件 production 拒绝错配与
无指纹(篡改指纹实测:boot 拒绝并点名两个哈希);`scripts/smoke-production.ts` 真启动
NODE_ENV=production(ready/live/壳/manifest/哈希资源 + SIGTERM 退出 0)进 CI——
它首跑就抓到真实约束:生产不假设 DATABASE_URL。

**cc5c25a OpenAPI 全量对比**:`OpenApi.fromApi(qualyApi)` 与运行时 `/openapi.json`
深比较(上游原样服务同一生成器输出,HttpApiBuilder.ts:103 实查;仅 tag 序归一)。
首跑即红:两侧加组顺序不同,匿名 schema 命名(Objects_1 等)随遍历序漂移——gen-api 改走
`runtimeLevels` 同一依赖序、从描述器 `Api.group` 读组,并把「有 ./api 导出无声明 /
有声明无导出 / 导出值被换绑」三类漂移变成硬失败。顺带结构性修掉 vite logger 排水
测试的定时赌(等行数不等时钟)。

**验收(实际执行)**:typecheck 零错;node 373 全绿(assemble-kernel 6 新增、web 指纹 7、
document equality 6);browser 13;`resolve --frozen-lockfile` 干净;`pnpm build` +
chunk sentinel + 生产 smoke 全绿(shutdown clean, exit 0);dev 真启动 ready=200 零 [E];
`qualy database check`/`db check`/`db migrate`/`bogus thing` 四路分发验证。

**缓建(带触发条件,见 plan 文档同节)**:描述器纯度静态扫描;prepare 相互依赖建模;
跨组同路径碰撞检查。

### 日志体验、运行命令二分、ui.ts 合并(2026-08-07,用户反馈驱动)

**报错定性**:终端的 `InterruptError: All fibers interrupted without error` 是被中断请求
(浏览器取消导航、499、vite ws 断开)被上游 `HttpMiddleware.logger` 按失败退出打印 cause,
无害但形似错误;刷屏主因是 dev 下每个 vite 模块请求产生 4-5 行 INFO(实测一次页面加载
1500+ 行)。

**日志系统(961c9db)**:①qualy.yml `application.logging` 为提交的默认值,**不进
manifestHash**(core 只携带不解释,调级别不触发 resolve;assembly-resolve 测试守),
`QUALY_LOG_LEVEL/QUALY_LOG_FORMAT/QUALY_ACCESS_LOG` 最高优先(LOG_LEVEL 兼容别名,
级别别名 verbose/notice/silent);②logger 在 main.ts 根部安装,verify 阶段同格式;
③pretty 格式 `时间 级别 来源 消息`——来源 = `source` 日志注解,装配器用
`Layer.fromBuild` 包装每个插件层(构建 fiber 及其 fork 继承注解,memoMap 不破),
api group/raw routes 按贡献者注解(vite 挂载日志正确显示 [web]);首现顺序取稳定色,
chalk 探测染色能力(用户建议采纳),同显示名必同色(曾实测 `@qualy/app` 与默认 `app`
显示同名却异色,配色改按显示名取);fiber id 只留 json 格式;④访问日志自研并关掉上游:
5xx=Error、429=Warn、4xx=Info、成功=access.level(dev Debug/prod Info),**499/纯中断
=Debug**(上游 `causeResponseStripped` 提取已发响应,实测 499 与残余中断原因并存也要
降级),mode off|api|all 默认 api,exclude 默认健康探针——dev 默认输出从 1500+ 行降到
个位数;⑤vite logger 三处缺陷修复:WeakSet 实现 hasErrorLogged(此前恒 false 会引来
重复错误)、error 计入 hasWarned、行注解 web:vite。

**运行命令(787d04e)**:`pnpm dev` / `pnpm start` 都经 scripts/run-server.ts(跨平台设
NODE_ENV;矛盾的 NODE_ENV 拒绝;production 拒绝 QUALY_WEB_MODE=development,
QUALY_MIGRATIONS 缺省 off——迁移归 `pnpm qualy deploy`,单机显式 apply)。生产 smoke
改走同一 runner(部署命令即被测路径),CI 在 smoke 前先 deploy lineage。命名裁决:
按 npm 生态惯例取 dev/start(next/vite/nest 同款),不用 serve 或 start:prod。

**ui.ts 合并(106d899,用户裁决 D)**:pages.ts + messages.ts(auth 含 iam/messages.ts)
合并为 `src/ui.ts`——同类文件:两个编译世界共同 import 的框架中立叶子(描述器注册页面
与导航文案,浏览器代码链接同一身份、catalog 门禁对照同一声明);子路径 `./pages` →
`./ui`,仓库内消费方全部迁移,无兼容别名;locales 留在 client/(后端 i18n 触发条件
到来时再一次廉价搬迁)。README 全面刷新(cordis/oRPC/Drizzle 已死的技术栈描述、
生产三步 build → deploy → start、日志配置)。

**验收(实际执行)**:typecheck 零错;node 377 全绿(新增 logging 12 + manifest logging
不进 hash);browser 13(复跑两次);`resolve --frozen-lockfile` 干净(logging 改动
零 lock 变化);dev 真启动:全部来源命名着色、访问日志仅 api 行;FORCE_COLOR 验证
chalk 染色链路;`pnpm build` + `pnpm start` 路径生产 smoke 全绿(shutdown clean)。

### Ui.page 单点声明:组件引用取代注册表样板(2026-08-07,审计采纳 + 用户裁决)

**模型**:页面 = 描述器里一次 `Ui.page({id, path, component, layout, visibility, navigation})`;
组件是 `Ui.react('./client/X.tsx')` 产出的 **ClientComponentRef**(renderer/module/export
纯数据,路径相对 src/)——**不是 React 值**(审计论证:React 值会把浏览器模块图拖进
Node、函数不可序列化、把 Ui 锁死在 React;模块引用只多几个字符,换来 CLI 可读、HMR、
code-splitting、多框架开放)。布局/槽位同理(`Ui.layout`/`Ui.slot`),登录方式的
`presentation.component` 同理(redirect 的 href 保持按 provider 的函数——
effect-login-methods 测试证明该变化是真实需求,静态化被测试当场否决)。

**键派生**:注册表键 `<plugin>/<Basename>` 由 `componentKey(pluginId, ref)` 单函数派生,
manifest 投影(registry 全面记 owner)、virtual module、chunk 哨兵、login-methods 四处
同源——**wire 与旧手写键逐字节一致**(真实启动比对过 manifest 与 login-methods),
浏览器测试键位零变化;validateComponentKeys 与其测试删除(派生键不可能违例)。

**客户端一律按 id**(用户裁决:「注册处用真组件,组件内用 id」):`PageLink page="auth/login"`、
`usePageNavigate()(id)`、session destination 按 id 经 **manifest** 解析路径(路径单源于
描述器;不可解析回退 home);`usePageRouteParams('userId')` 按名取参缺失即抛。
**同插件内组件互引是普通 import,不走 id**(用户追问后定案:id 只服务跨 manifest 边界)。

**删除**:四个 ui.ts(上一轮刚立即废——被本轮更优方案取代)、六个 client/index.ts 的
components 表(入口只剩 catalogs/errorMessages;layout-default 整个 client 入口与
exports['./client'] 删除)、'<plugin>/<Component>' 手写键、web-runtime 的
PageRef 泛型参数机械(PathParam/ParamsOption 保留但运行时不再依赖)。

**类型门禁**(审计方案第一层):`pnpm typecheck` 新增组件引用检查器
(scripts/lib/check-client-components.ts)——对每个 active 插件用**它自己的 client
tsconfig** 建 Program + 内存虚拟断言文件:模块存在、不逃逸包、default export 是
React 组件、**页面组件 `ComponentType<{}>`(零必需 props——shell 无 props 挂载)**。
红绿实测:拼错路径报「does not exist」,页面加必需 prop 报不可赋值并点名插件+模块+kind。
标准 TS 无法两全(`typeof import` 污染 program 边界 / loader 拿不到路径),字符串 +
检查器是审计推荐的平衡;IDE language-service 层留待 API 稳定(缓建)。

**catalogs 门禁**:declared 集 = 客户端 catalog ∪ 描述器导航文案(`message` 内联进
`Ui.page` 后,translation 不再因声明移动而成孤儿);运行时 en 兜底走 wire 的 UiText。

**验收(实际执行)**:typecheck 零错(含新检查器);node 376 全绿;browser 13(冷缓存
换轨首跑一次红、缓存落定后连跑复测两侧全绿);`pnpm build` + chunk 哨兵 + 生产 smoke
(shutdown clean);dev 真启动 manifest/login-methods wire 与旧格式逐字节一致、零 ERROR;
frozen lock 干净(descriptor 内联声明不改 lock 面)。

### M4 + i18n 预装配 + 物理重组:零 codegen 收官(2026-08-07,审计第四轮)

**M4(161b26b)**:每插件 `src/client/api.ts` = `Api.local(...groups)`;组件经
`useApi`/`useApiQuery`(web-runtime,WeakMap 缓存)消费;@qualy/api 与 api-client 包删,
effect client/query 原语并入 `@qualy/web-runtime/api`;浏览器测试 stub 经
`RuntimeProvider clientFor`,类型仍受真 client 面约束。**i18n 预装配(0fdfdf9)**:
`Ui.i18n('./client/i18n.ts')` 声明聚合模块,virtual module 静态 import catalogs/
errorMessages,client/index.ts 全灭。至此仓库唯一生成物是 db/migrations 的 SQL。

**搬迁(917dbcf)+ 物理重组(52bc0ee)**:experiments/ 删;CLI → apps/cli;runner →
apps/server/src/run.ts;vite 链 → packages/build/web(@qualy/web-build);其余脚本 →
tools/{fixtures,quality,repo,tests,lib};packages/ 分类 core/contracts/web/build/plugins。
**包名全部不变**,workspace globs、根 tsconfig include、web 侧 extends 深度、门禁路径表
(test-layers/error-codes/vendor/ports/seed)随迁;assembly 的宿主解析收进
`@qualy/assembly/host`(manifestPath 全显式);CI smoke 路径修正 tools/quality/。

**冷缓存双 React 定案(52bc0ee)**:三个叠加根因——①vitest browser root 在仓库根,
根 package.json 无 react,dedupe 与 @vitejs/plugin-react 注入的 optimizeDeps.include
从根解析全部静默失败(pnpm 隔离)→ root 改 apps/web;②生成模块用绝对文件路径 import,
vite 语义里是 root 相对 URL,dep 扫描器与 dev server 都不跟进 → collect 改产相对
`.qualy/` 的相对路径(fromDir 参数);③聚合本体是动态 import(chunk 分割边界),
扫描器不跟动态 import → 新增静态 import 的 scan 孪生文件一并喂给 optimizeDeps.entries。
`@radix-ui/react-label`(仅被插件组件引用的依赖)自此在首扫期发现,「optimized
dependencies changed. reloading」中途重载(7 测挂的直接死因)消失。物化位置从
`node_modules/.qualy` 挪到 `apps/web/.qualy/`(entries glob 忽略 node_modules)。

**文档**:CLAUDE.md 全面改写(cordis/oRPC 纪律随 ADR 0003 作废并移除;新目录布局、
零 codegen、Effect API 纪律、页面 id 导航、日志、dev/start 收录);
plugin-descriptor-plan.md 记 M4 收官与 `./api` 保留理由;README 修 runner 路径。

**验收(实际执行)**:typecheck 零错(11 工程 + client 工程 + 组件引用检查器);
node 369 全绿(61 文件);browser 13/13 **冷缓存两次 + 热一次**(此前冷跑必挂 7);
`resolve --frozen-lockfile` 干净;`pnpm build` + chunk 哨兵前提的 stage 成功;
`pnpm qualy deploy`(migrations up to date)+ 生产 smoke 全绿(ready/live/壳/manifest/
哈希资源/SIGTERM exit 0);`pnpm dev` 真启动 root 200 + manifest 200 + 优雅退出 0;
`pnpm qualy list` 正常。**下一步**:测评业务纵切(评估记录见前节)。

### 对抗审计与修复(2026-08-08)

**审计**:8 维度审查者(authz / assembly / effect / web / database / api / gates /
landmines)并行找问题,每条发现单独派对抗性怀疑者反驳(存疑默认毙掉),末尾盲区批评家;
33 agent。**确认 23 条、反驳 1 条**,清单落 docs/notes/adversarial-audit-2026-08-08.md。

**已修 20 条,七笔提交**(每条都有测试,多数红绿双验):

- `369a1e0` server:①**每源日志最小级别判反了**(上游 `isEnabled` 是
  `!isGreaterThan(minimum, record)`,我们参数写反,于是丢掉比阈值更严重的记录、留下噪音,
  且 `Logger.layer` 替换默认 logger 集 = 丢掉的错误无处可寻;'off' 反而静音不了);
  ②端口在路由层建成前就 listen(upstream 在 `make` 里 bind、在 `serve` 里才挂 handler),
  窗口期请求被解析但**永不应答**,连接还卡住无超时的 close finalizer → 我们自己拥有
  server 实例,窗口期答 503 并自退;③二次信号无效(upstream 只是再中断一次已在中断的
  fiber)→ 超时(默认 30s,长于 20s drain)+ 二次信号立即放弃,均 128+signo。
- `17717cd` api:deleteRoleGrant 把声明过的 409 `orDie` 成 500;cursor 的 uuid 段
  未校形状 → 篡改的游标以 cast error 变 500(改为按位声明 `['text','uuid']`);
  update 对"原值重存"照样 +1 version,把并发的真实编辑挤成冲突。
- `c5b6ae0` assembly:①**provider 随插件离场**(此前从上一份 lock 召回的 provider
  答完"无需保留"仍留在 lock,generate/deploy 继续对已移除插件的外部系统做事);
  ②module 契约只有比较方没有写入方(第一个声明 module 的能力会把整条 CLI 锁死在
  "运行 resolve"却什么都不写的死循环)→ resolve 补写;③boot 静态拉进 migrator/
  SchemaComparator/pg/child_process → 各相位自己动态 import,加静态闭包门禁;
  ④drop-guard --base-ref 把 git 的仓库相对路径按 cwd 解析,非根目录下扫描 0 个文件
  却报成功。
- `0bc8ef6` db:①**Migrator.init 会 CREATE DATABASE**(typo 的 DATABASE_URL 让
  "只校验不修复"的 boot 建出野库,随后 lineage 干净跑完、应用绿着起空库);
  ②adopt 用结构 diff 认证等价,而它看不见扩展/函数/种子行(baseline 片段的全部内容),
  写完账本后这些永远不再补 → 改为先跑幂等片段;adopt 此前**零测试**,补两条;
  ③testkit 模板保护把 datallowconn 设成 `true`(默认值,等于没设)。
- `cbbcded` web:isTransportError 对真实传输失败恒 false(浏览器拿到的是
  HttpClientError 包装,不是 fetch 的 TypeError);UiSlot 每次渲染新建包装组件 →
  React 按类型协调 = 每次重挂载,状态丢失+重新请求;`.qualy` 聚合两套集合共用一对文件
  (并行 build 会改掉 dev server 正在用的模块);chunk 哨兵按裸 basename 前缀匹配,
  跨插件同名时互相顶包。
- `91d526d` 门禁自身:run* 规则只枚举了 12 个中的 5 个(所有 `*With` 与 runCallback
  静默通过);vendor 的 repos/ import 扫描卡在深度 4,重组后 213 个文件里 81 个没被读;
  catalog 完整性对"整个 locale 缺失"直接 skip(零翻译的插件真空通过);
  浏览器 bundle 探针只覆盖硬编码的 auth 一个插件 → 按发现遍历全部五个。
- `37e5abe` plugin:add 重组后失效(仍调已删除的 scripts/qualy.ts,改完两个 manifest
  且 install 之后才崩;apps/web 依赖的判据是早已不存在的 `./client` 导出)→ 修好并加
  "脚本执行的文件必须存在"门禁(命令串与常量两种形态都覆盖);qualy.lock.json 进
  .prettierignore(CLI 拥有其字节,格式化会让每次 resolve 都产生 diff)。

**未修 3 条**(low,记录在案):`.qualy` 并发已按每集合分文件解决其主因;剩余为
诊断类描述,触发条件写在审计清单里。**盲区**(批评家,均属未审计区域而非缺陷):
认证滥用与会话生命周期(登录无节流/无锁定、无请求体上限、无密码重置、过期 session
无清理)、备份与恢复(compose 声明了 pg_backups 卷但无人写入,db:reset 一并销毁)、
部署形态(无 Dockerfile/runbook,生产即 tsx 跑 workspace TS)、可观测性(付了 span
成本却无 exporter,/health/ready 逐个探针无超时)、多进程/多副本(迁移互斥已按触发表
推迟,但无人看守触发条件)、租户运维面(租户生命周期无任何应用入口,过期即全员锁死)。

**验收(实际执行)**:typecheck 零错;node **386** 全绿(62 文件,新增 8 条测试);
browser 15/15(**冷缓存**);`pnpm build` + chunk 哨兵;`qualy deploy` + 生产 smoke
(shutdown clean);`resolve --frozen-lockfile` 干净;`pnpm dev` 真启动 + 窗口期 503
实测 + SIGTERM 优雅退出;超时/二次信号强退分别实测(exit 143)。

### P2 领域文档落库(2026-08-08)

**docs/assessment-design.md 成为综测领域唯一权威文档**:合并设计稿 v2.1 + 沙箱归属增补 01 +
两轮用户裁决。三份来源文件(p2-tutorial-a / -a-v2_1 / -a-supplement-1 / -b)首行标注"已并入,
只作来源存档",不再更新。五条领域 ADR 抄进 docs/adr/0004-0008。CLAUDE.md 加指针
(开场读物 + 禁止项 + "两者冲突停下来报告")。

**本轮并入的新内容**(来自 v2.1 与增补 01):①**M9 Formula 主特性**——custom 计分器/聚合器经
`assessment.calculator` registry ExtensionPoint 即插即用,内置集合(fixed/lookup/range/decrement +
sum/max/countTier)永久冻结在最小规模,一切校本逻辑走 custom;QuickJS 因此从 §27 禁令表解禁,
但沙箱内非确定性 API、网络/IO、跨题访问、函数内做组级组合**永久禁止**。②**三层拆分**:
`plugins/infra/sandbox`(机制层,零表零 API 零 UI、租户盲)/ `plugins/assessment/formula`(驱动层)/
`assessment/core`(语义层);另加薄 `plugins/infra/llm`。**infra 成员资格成文**(零业务语义 +
零自有业务数据 + 装配即治理开关有独立意义;跨领域消费只是加分项),且**归置决策不适用"复杂度由
需求触发"元规则**——归置没有推迟收益。③装配即信任边界:不装 sandbox 而装 formula = dependsOn
硬失败,两者都不装 = 该能力物理不存在,落在 ADR 0001 上。

**裁决记录在 §32**(与设计稿不同之处,逐条):①**只有自己能改自己的材料**——取消班委代录、
管理员在线 Excel 录入、M7 批量网格;行政事实(扣分/低频特殊加分)走 `entrySource: administrative`
的独立路径,学生无入口也不需同意(救济渠道是申诉);②**修改建议是参考不是替换**——驳回时可在
学生内容上改出建议稿并在图片上圈画,学生端只读、**不可一键套用/复制**(合规风险),因此不存在
"待学生确认"状态、不需要定时器与通知;③接口修正——权限码连字符、dependsOn 写真实插件 id、
selector 引 uuid、**PhaseGate 只活在批次上下文内**(同一学生可同时在多个 active 批次,如保研综测
与学期综测并行,页面可见性没有唯一"当前阶段");④**审核不定分**——decision 事件无分值字段,
需人定值的条款一律 administrative 题目、创建时按 [min,max] 校验,并加配置校验"range 只能挂
administrative";⑤花名册用户类型集合是 batch 级配置;⑥政策口径——大项 floor 0、同一事项 max 聚合、
一票否决/弄虚作假不建模为资格标记(即使被否决也要有成绩,资格属未来的奖学金系统)、月度小结的
等价能力是"预填报期提前一学期开"(Phase 天然支持,零新机制)。

**下一步**:M1(Batch + Phase + Roster + PhaseGate 运行时骨架),按 §26 M1 七条验收。

### M1 细节三轮裁决落库(2026-08-09)

用户对 M1 细节的三轮商榷(配置冻结、锚点必要性、卡死发现、时间模型)已裁决并全部并入
docs/assessment-design.md(§9/§10/§11/§12/§14/§17/§20/§21/§24/§26 就地改写,
裁决记录 §32.7–32.12,ADR 0007 补"到站检查")。要点:①"出现提交后冻结"废除,配置生命周期
分级(draft 自由/active 自由+事件+确认框/SCHEDULED 冻结/归档只读),理由必填按操作类型挂;
可重算由 input_manifest 含 config_revision 免费保证;②锚点两列保留但理由修正(在途稳定靠
链快照,锚点服务此后路由/分区/管辖),转入转出对称走 diff 面板不自动纳入(双重参与风险);
③卡死发现:拉模型保留,巡检为唯一正确性机制(不做写路径钩子),告警是派生视图,
"立即复查"做即时性,滞留水位管怠工;④时间模型:actual=语义生效时刻(scheduled 写 planned
值,processed_at 另记),effectivePhase 按时钟判定,队列只武装队头,时间三形态
(硬计划/偏移/预计),边界二分(承诺型/里程碑型);⑤审核期结束三旋钮(手动+SLA+归零自动切
开关),默认模板新增公示创建期;⑥SCHEDULED 冻结集合精确化+发布时刻断言。§20 补充:
不抽通用工作流/时间线能力(触发条件记录),grades 集成方向两候选留 M6。**未编码**。

### PhaseGate 归属修正:rbac 零改动(2026-08-09)

用户对"rbac 契约加 phaseControlled 加法字段"提出分层反对(infra 不为顶层业务加字段,
否则概念性循环依赖),推演结论比"rbac 开放能力"更轻:**字段从头就放错了家**——被门控的
权限全部是 assessment.* 自己的码,"哪些码受门控"是门(PhaseGate)的属性;落点 =
assessment 自己的 src/permissions.ts 同文件承载权限声明 + PHASE_GATED 白名单,
rbac 一行不改。结构性安全升级:全局权限在结构上进不了阶段编辑器。"rbac 开放 opaque
meta 能力"降级为写档的升级路径(触发条件:跨域权限治理需求)。新判据入 §29:
**字段/查询归谁看词汇属于谁**。设计文档 §11/§24/§25/§26/§28/§29 就地改写,
裁决记 §32.13;并入时以 §11 冻结目录为准(对话示例码表含裁决前词汇,未采用)。
M1 前置的 rbac 工作归零,第一个 commit 即 plugin:add + 自家 permissions.ts。**未编码**。

### 第二轮外部审计 24 项 + 四项拍板落库(2026-08-09)

外部审计精准打在版本/时间/数值/发布后修正语义四处;裁决(约 19 采纳、4 修正实现、1 改判、
1 已满足)连同用户四项拍板全部并入 assessment-design.md,新增 ADR 0009、修订 ADR 0005。

**四项拍板**:①申诉统一为"轮"(review_instances + round_no/origin/initiator,appeal 四表
与 appeal.* 权限点取消,申诉窗=三个 phase 开关组合,原链越过 normalTerminal 续爬,发起权
entry.resubmit / review.reopen);②一票驳回(quorum 只管 APPROVE,三补条:即刻终结留票、
竞态先落库、escalated 终点 panel 的 reject 仍一票;rejectionQuorum 留档);③行政条目按性质
分流(proxy 代录=创建代理走完整链、record=trusted 不建实例四约束,单调谓词无条件成立,
S1 后新录行政事实经 S2 preflight 显式确认;撤回按时间分流案);④精度=1e-4 定点整数 +
HALF_AWAY_FROM_ZERO + 行级 2dp 量化 + 排名用展示精度("逐行相加恒等"属性不变量)。

**主要新增**:S1 后评分语义冻结 + Publication RETRACTED(ADR 0009,纠错=撤回重发可申诉的
preliminary;发布断言分裂:外部漂移照发+CRITICAL、内部损坏中止);ItemRevision 不可变版本
实体(EntryRevision/ScoreRun 精确引用);anchor_lineage jsonb 冻结逐级 (nodeId,nodeTypeId);
effectivePublished 惰性物化(取消预告仅限 publish_at 前);BreakdownLine lineId+provenance
(申诉锚 = publication+participant+line);claim 生命周期全表(归档不释放);reassign v1 删除;
core dependsOn storage(M2 起);附件三态+内容安全基线;ranking_tie_resolutions;
uuid 统一到实例列;内置计算器 id@version;LLM 隐私红线;One Batch = One Rule Set;
公示创建期矩阵全 ×;withdraw 取消实例回 draft(独立 withdrawn 状态删除);M7 标题去网格。
裁决记录 §32.14–32.19,权限目录/矩阵/路由预案/表清单/里程碑验收同步改写。**未编码**。

### 第三轮审计:十项主修 + 八项 P1 + M9 断言修正落库(2026-08-09)

第三轮审计不再动架构,专挑模型交界处最后没说死的状态,其中两项是真 bug(负分域 max 反向、
preflight/排名/物化顺序不可能同时成立)。十项主修全落:①proxy 四处叠层矛盾清除,冻结为
**原子代录**(创建+提交一个动作,无代理草稿,自身即窗口,预填报 ×);②时间形态落列
(entry_trigger 加 'publication',entry_offset/estimated_entry_at/opens_publication_id,
武装前缀精化);③发布**两段式**(schedule 不 advance,effective 段 actual:=publish_at 同事务,
可惰性物化);④行政条目首轮链通则(item_revision.review_policy + 冻结 lineage 现场解析快照,
administrative 题必须配救济链);⑤同 entry 单开轮 DB 约束 + **轮期间终态保持**(推翻"分数悬置");
⑥轮证据挂 review_event_attachments(同时补上驳回圈画图的 FK 落点),修订权三分;
⑦聚合器补 min(负数域"扣最高"=min)+ floor 默认 null 仅大项显式 0(推翻默认 0);
⑧preflight 二段式(Input/Output Validation,tie 裁决锚 score_run_id 后一次性物化 rows);
⑨retract 阶段编排定稿(进申诉处理性质阶段清轮,向后插新公示创建期,冻结绑定"存在未被
retract 的 preliminary",ADR 0009 更新);⑩M2 最小 scorer 内核前移(+3 是真竖切)。
八项 P1:成绩异议题(none@1 + 申诉期 scoped create)、lineId 确定性生成 + label 冻结、
删"重新路由"开关、自审冲突集含代录 actor、**收件箱改锚点精确等值 join**(推翻 subtree <@)、
normalizer 版本入 claim、storage authorizer 补 subject、correctedFinal 留触发条件。
M9a 三条断言修正:64MB 以敌意分配测试自证、libm 一致性降为 golden replay 待验目标、
wasm 工件 hash 入 engine version(库 <1.0 未审计,验证工件而非信任库)。
裁决记录 §32.20–32.25(含七条 supersession 注记)。**未编码**。审计判语:此十项落完,
"核心架构冻结、可按里程碑施工"名副其实——采纳,M1 随时开工。

### 第四轮审计:六个边界条件封口 + 五项 P1 + 残留清扫(2026-08-09)

第四轮审计定位准确:已不是架构问题,是六个"单元测试全绿、真实学期跑到边界才爆"的封口。
12 项全部采纳落库,裁决记录 §32.26-32.34:

**六个 P0**:①publication 边界绑定生命周期(创建时 NULL 合法=未武装,schedule 时绑定,
actual 后不可改;M1 落 nullable 列无 FK)——恢复"约束挂在武装时刻"的原始语义;
②**ScoreRun 新鲜度门禁**(Output Validation 重算 manifest hash 比对 + schedule 事务 CAS
复验;SCHEDULED 前漂移=禁止预告,之后才归"照发+CRITICAL");③**panel 交集规则**
(可行动集=快照 panel ∩ 当前精确锚点持有者,新任者不进旧 panel,已投票永久有效,
收件箱 SQL 分叉;恢复三路零新机制,panel 重组留触发条件);④**谓词分裂**
(wasReleased/isEffective——S2 发布后 S1 仍可读但永不再锚新申诉;effective final 后禁
retractPreliminary);⑤**排除性锚定行**(rejected/voided 且曾提交的条目在快照里生成
0.00 行供申诉锚定,完全不进聚合器输入);⑥**S1 后新立不利终局的复议权**(含孪生案:
复查撤销原通过——申诉窗约束不了窗口关闭后出生的事实;resubmit 在申诉处理期按
ResourcePolicy 谓词收窄放行,每事实限一轮)。

**五项 P1**:origin 三值(initial|appeal|reopen);ItemRevision 消费不变量(payload 按
自身版本解码,保存新配置实测 in_review/approved 条目);排名两口径(ties 仅在要求
rank 时 blocker、partition 查冻结 lineage);retire 历史引用语义(已引用读取永久有效);
时间语义统一(锚时刻确定即可物化、公示边界 SCHEDULED 后转承诺型)。

**残留清扫 + 两补充**:source/actor 服务端推导升格安全不变量;revisions 仅本人;
§20 依赖表实名并删 appeal 模块;M5 措辞两段式;(roleId,nodeId) 去重;作废条目终态
voided(reason=item_voided);巡检 quorum 按可达性公式。M5 验收增至 ⑯ 条。

审计与裁决一致判定:**"核心架构冻结,可按里程碑施工"标签自此成立**,此后分歧应只在
Effect API/SQL 约束/UI 细节。**未编码**。下一步:M1 第一个 commit。

### M1 会话 8(s1)· 骨架与全部表(2026-08-09)

入场基线 tag `p2-base`(d27a6fa,含 docs/m1-tutorial.md 会话拆分计划)。
`@qualy/plugin-assessment` 落地 `packages/plugins/assessment/core`(workspace glob
`packages/plugins/*/*` 与根 tsconfig 天然覆盖,零配置改动):

- **描述器**:dependsOn 五个真实插件 id(auth/database/org/rbac/ui-registry);
  `Db.entities`(schema 依赖 org+auth)+ `Access.permissions('assessment', …)`。
  s1 无 service/API/UI,index.ts 只是声明。
- **permissions.ts**(§32.13 落地):§11 冻结目录 15 码;target 按文档标注——管理/代录/
  record/审核类 `org-node`,自助类(view-self、entry 四动作、resubmit、view-peers、
  ranking.view)`tenant`;同文件 `PHASE_GATED` 白名单 11 码(=矩阵 ✓ 列,一字不多);
  **import 期断言集合 ⊆ 自声明码**——红证:scratchpad 副本注入 `assessment.bogus.code`
  立即 throw(第一次红证 sed 把声明行一起改了导致假绿,已修正只改 Set 行)。
- **九张表**(§21 全量):assessment_batches(daterange 左闭右开、scope ltree 快照、
  config_revision 计数、current_phase_id 投影)、batch_user_types、batch_phases
  (entry_trigger 三值 + entry_offset jsonb + estimated_entry_at +
  **opens_publication_id 裸 uuid 可空**——绑定检查 `trigger='publication' OR IS NULL`
  - 部分唯一保一一对应,§32.26;source_template\_\* 落列无 FK,溯源存续)、phase_events
    (+processed_at;actor 无 FK,审计存续于账号删除)、phase_templates、phase_item_scopes
    (item 裸 uuid,M2 补 FK)、phase_participant_scopes、batch_participants(anchor_path
    ltree GiST + **anchor_lineage jsonb** 逐级 (nodeId,nodeTypeId)、(batch,user) 唯一)、
    batch_config_revisions(append-only + revision 唯一对)。全表 uuidv7 库侧默认、
    timestamptz、复合租户 FK((tenant_id,id) 目标索引齐备)。**删除规则=数据保留政策**:
    批次自有行随批次 cascade;roster 指向的 users/org_nodes/user_types 一律 restrict
    (有综测历史的主体不可删,实测 23001);current_phase_id 用 PG15+ 列级
    `set null (current_phase_id)`(普通 SET NULL 会把 tenant_id 一起置空)。
- daterange/ltree 均按 org 先例 `p.string().type(...)` 列类型覆写(不是 custom type
  class);无新 baseline 片段——ltree 扩展已在 initial lineage,daterange 是内建类型。

**验收(实际执行)**:`pnpm plugin:add` 写 apps/server 依赖 + qualy.yml + lock
(runtime.plugins 收编,database/permissions 两能力各 1 条贡献);
`qualy generate --name assessment-batch-phase-roster` →
`20260809055103_assessment-batch-phase-roster.sql`(9 表 + 全部约束,drop guard ok);
`qualy deploy` applied 1 migration(129ms);schema.test.ts **4/4**(往返:daterange
`'[2026-03-01,2026-09-01)'`、lineage jsonb、permission_profile jsonb 回读;约束:
23514 publication 绑定、23505 ordinal/(batch,user) 重复、23503 跨租户三处、23001
restrict 三处、批次删除级联清零);`pnpm typecheck` 零错;`pnpm test` **63 文件 391
全绿**(唯一改动:seed 权限数 16→31,恰证明权限贡献被 seed 单源捡到;clean-room
parity 覆盖新表——从插件重生的 lineage 与提交件逐对象一致);
`resolve --frozen-lockfile` up to date;`pnpm dev` 真启动 READY 2s、dev 库
permissions 表 `assessment=15`、SIGTERM shutdown complete。

**下一步**:s2 纯函数时间引擎(`src/phase/engine/`,零 IO):effectivePhase(now)、
武装前缀、偏移物化、插入重排、七条编辑校验器、时间线派生;红绿直接照 §24 时间条目写,
撑不住就按"判定类/编辑类"一切为二,绝不把引擎写进 service 层。

### M1 会话 9(s2)· 纯函数时间引擎(2026-08-09)

`src/phase/engine/` 四模块,零 IO、零 Effect(纯 TS,本会话无需实查 repos/):
时间用 EpochMillis(number),plan/publication 快照与 now 全部显式入参,毫秒级可测。

- **types.ts**:PhaseSnapshot / PhasePlan / EntryOffset(days/hours/minutes 时长规格)/
  PublicationRef+Lookup(**绑定的公示缺席于快照 = 抛错**,不静默"待定"——否则漏取数据会
  悄悄取消一个已承诺的日期)。
- **queue.ts(判定类)**:`normalizePlan`(排序+拒绝重复 ordinal 与 actual 断档);
  `effectiveState(plan, pubs, now)`——照 §10 从已物化前缀向后走,scheduled 过 planned、
  publication 边界所绑公示 isEffective(PUBLISHED 或 due-SCHEDULED)即视为已进入,连续
  推进;pending 携带**语义时刻**(scheduled 写 planned、publication 写 publish_at,
  永不写 now),即 s4 调度器的待追认清单,应用后重扫为空(幂等);`armedPrefix`——穿
  scheduled 与已绑 SCHEDULED 公示的边界,止于 manual/未绑/未物化 planned;**manual 的
  planned 是 SLA,永不自燃**。
- **materialize.ts**:§32.34 逐字落地——锚的语义时刻已确定(上游 actual,或 SCHEDULED
  公示的 publish_at)才物化,**一步深**(物化出的 planned 仍是 plan,不再作为下游的锚);
  非正 offset 到物化即抛(不静默压缩阶段);`clearDerivedPlansBelow` 只清 offset 派生的
  planned(cancel/retract 回待定),手设硬计划不动。
- **edits.ts(编辑类)**:结构化拒因 17 种 + lint 1 种,`reviewPlanEdit / reviewInsertion /
planInsertion / reviewPlanShape`。七条校验器落点:①归档收尾 = 插入不得在 terminal 之后
  - `terminal-must-be-manual`;②绑定生命周期 = 仅 publication 边界、未进入可绑/重绑/解绑、
    **时钟判定已进入即不可改**(§32.26);③硬计划不越"事件门"——未发生 manual **与未武装
    publication 边界同判**(armed prefix 定义推论,已武装的不拦,文档措辞只点名 manual,
    按同理由扩展并记录);④已结束仅名称(profile 在 ended 拒、current 放行——SCHEDULED
    冻结归 s3 服务层);⑤actual 不可改(编辑通道整体拒绝);⑥边界只许未来 + 承诺时刻沿
    队列单调(planned 与上游 actual/planned/publish_at、下游承诺互相排序,SLA 不参与排序
    但同守未来);⑦proxy✓submit× lint(warning 不阻断);profile ⊆ PHASE_GATED 硬拒
    (`profile-code-not-gated`)。"已进入"一律按 effectiveState 时钟判定——**调度器没追认的
    边界也是历史**。
- **timeline.ts**:取值优先级一次定死 entered > planned(确定)> announced(公示
  publish_at 单源)> estimated(约)> pending(待定);manual 的 SLA 不外显。

**验收(实际执行)**:引擎四测试文件 **31 用例**全绿(queue 9 / edits 15 /
materialize 5 / timeline 2),覆盖 §24 时间条目:时钟精确到毫秒且 actual 记 planned 值
(迟到 47s 不影响)、物化前后同答案、manual 后 scheduled 不自燃、publication 边界按
承诺进入并穿透推进、重扫幂等、硬计划越门被拒(manual 与未绑 publication 两分支)、
偏移事件时刻物化 + SCHEDULED 提前物化 + 锚未定不动、绑定生命周期三态、乱序/过去
planned 被拒、插入重排 ordinal 序列、时间线全优先级。写测试先行,首轮 30/31——唯一红
是测试预期把"armed prefix 穿过已绑公示边界"写窄了,按 §10 定义改预期(引擎对)。
`pnpm typecheck` 零错;`pnpm test` **67 文件 422 全绿**(前 391 + 引擎 31)。

**下一步**:s3 服务层 + API + PhaseGate(批次 CRUD、阶段计划编辑接引擎、advancePhase、
激活生成花名册、PhaseGate(+ctx) 与 authorize facade、frozen-routes 与 error-codes 同笔);
Effect HttpApi 与服务写法先实查 repos/。

### M1 会话 10(s3)· 服务层 + API + PhaseGate(2026-08-09)

给引擎接电。证据来源:org/rbac 的 api.ts、server/index.ts、db.ts 是同版本活先例
(HttpApiGroup/HttpApiBuilder/Context.Service/Effect.fn/withDatabase+transaction/
translateConstraints/scopeCoverage 全部照抄形态);`Schema.Literals/Union` 在 rbac api.ts
有同版本用例;v4 Exit/Cause 活结构用 tsx 实探(见下)。未凭记忆引入任何新 Effect API。

- **API 13 端点**(frozen-routes 同笔):batches CRUD + `PUT status`(激活/归档)+
  `GET/PUT phases`(计划幂等替换:带 id 改、不带 id 插、模板 `fromTemplateId` 服务端
  复制+溯源)+ `PUT phase`(advance)+ `GET timeline` + phase-templates CRUD。列表全
  keyset(cursor 指纹校验 + ISO 复验)。**错误 10 码**入全局门禁(error-codes 同笔),
  `ASSESSMENT_PLAN_INVALID` 携带引擎结构化拒因数组(reason/phaseId/blockingPhaseId/
  code/index),不是句子。错误码强制翻译 ⇒ s3 就带**最小 client i18n**(仅 errorMessages
  - zh-CN locale + client tsconfig;Ui.i18n 声明留给 s6 有页面时上车,catalogs 门禁按声明
    发现故不误报)。
- **服务层**(Context.Service `Assessment`,serviceLayer: Orm+Rbac):每写锁批次行;
  "已进入"一律 effectiveState 时钟判定(调度器没追认的边界也是历史);`ratifyPending`
  共享给 advance/归档(s4 调度器同款,幂等:actual 只落一次)。计划编辑:draft=整体替换
  (保 id、可删可排序,engine `reviewPlan` 整案校验);active=外科 diff(禁删禁重排、
  phaseKey/trigger 不可变,逐 field 产 PlanEdit 由引擎按演进中的计划顺序复核,ordinal
  重排用"停车位 +1e6 两遍写"避开唯一索引瞬时冲突);模板应用仅 draft。advance:先追认
  再判 next、非 manual 边界要 force+reason(force-advance 权限),事件 kind='entered'
  带 actor/reason,随后 materializeOffsets 落 planned + 'offset-materialized' 事件。
  激活 = 单条 INSERT…SELECT 生成花名册(enabled ∧ 类型 ∈ batch_user_types ∧ path <@
  scope,anchor_lineage 由 `jsonb_agg(… order by depth desc)` 现场冻结)。归档=到达
  terminal 的 stand-in gate(M5 补公示条件,注明)。updateBatch 每保存必 bump
  config_revision + 配置事件(diff/actor/reason)。
- **PhaseGate 纯函数**(src/phase/gate.ts):`PHASE_GATED.has ? code ∈ profile : true`
  fail closed;item-scope 只限创建族(create/edit/submit/withdraw/proxy/record),
  participant-scope 限整个 entry 族(含 resubmit),review.process/reopen 永不受限;
  authorize facade = rbac(M1 为 hasPermission 桩,锚定解析随 entry 到 M2/M3)∧ gate ∧
  policy 槽位(恒放行,entry 状态机 M2)。
- **engine 补 `reviewPlan`**(整计划校验):带 now 走全钟档,`now=null` 结构档——模板是
  数据,十月保存九月模板不该被拒;refusal/warning 增 `index` 指认第几条 spec。
- **两处实查修正**:①kysely 结果经 MikroORM 实体元数据水合,epoch 别名撞 datetime 属性
  名被转回 **Date**,引擎 Date+number 变字符串拼接炸 22P02——db.ts 读边界 `msOf` 统一归
  一化毫秒;②v4 Cause 活对象是 **`cause.reasons[]`**(`{_tag:'Fail',error}`),toJSON 才叫
  failures(tsx 实探 `Effect.runPromiseExit` 确认),测试助手照此读。另:两个测试计划初稿
  在 manual 边界后放硬计划被引擎正确拒绝('hard-plan-beyond-event-boundary')——改为
  offset 形态,顺带把"advance 物化 offset + 审计事件"测进去了。

**验收(实际执行)**:`pnpm typecheck` 零错(含新 client 工程与 Effect LSP);插件套件
**7 文件 48 用例**全绿——验收③(offset 物化后改未来 planned 成功 + 'planned-changed'
事件,改已进入阶段拒 'phase-already-entered';actual 无线上表达+引擎双保险)、
④(manual 切换落 'entered' 事件带 actor;提前进 scheduled 边界:无 force 拒/有 force
无 reason 拒/force+reason 过且事件记 reason;非 next 拒;terminal 归档后写动作
ASSESSMENT_BATCH_READ_ONLY)、⑥(gate 矩阵逐格:预填报 create✓submit✗、审核期
submit✗review✓、公示创建全✗、未门控码恒放行、无阶段 fail closed)、⑦(到点边界
sleep 后 gate 时钟放行、advance 先追认且 actual==planned 精确相等、'entered' 事件仅一条、
重复 advance 拒——幂等)、⑩(item/participant 两 scope 合成 ctx 逐格:resubmit 跨题但受
participant 限、review 不受限;facade 三层:未持码 layer=rbac、持码相闭 layer=gate、
全开放行);花名册单 SQL(域内两生入册,跨 grade/教师/停用户排除,lineage 锚→根三级
逐一冻结);模板结构档(terminal-must-be-manual 拒、同名 409、phases 改动 version+1);
配置事件(revision 1 + diff 键集 + reason)。`pnpm test` 全仓 **69 文件 435 全绿**
(api parity 现算聚合含 13 新路由、OpenAPI 深比较、error-codes/catalogs/seed 均过);
`resolve --frozen-lockfile` up to date;`pnpm dev` READY 2s、未登录
`GET /api/assessment/batches → 401`(Authenticated 中间件生效)、SIGTERM 干净退出。

**下一步**:s4 调度 fiber(Assembled barrier 上 fork 每分钟扫描,推进武装前缀内到点
scheduled 边界,actual:=planned、processed_at:=now,幂等可重入,单实例声明照迁移器抄;
集成测试时钟控制验 ②⑧⑨)。实查点:Effect v4 fiber/Schedule/Layer 作用域。
s3 备注:验收⑩的端到端(真实 entry 动作)按计划留 M2,本会话为 gate 层合成 code+ctx 测。

### M1 会话 11(s3 修补)· 封 phase 服务不变量(2026-08-09)

用户逐项评审 s1–s3 后判定:整体通过,但两个 P0 领域语义错误 + 五个完整性缺口须在 s4 前
以独立小会话修掉,P2 两条按"不预防性建设"纪律留档。全部照裁决落地:

- **P0① config_revision 生命周期反转修正**:原实现 draft/no-op 也 bump、active 计划编辑
  反而不记。改为统一入口 `recordConfigChange`——**draft 零仪式**(不 bump 不记事件)、
  **active 实际发生变化才 bump + 追加事件**、archived 上游已拒;`updateBatch` 与 active
  `replacePlan`(diff = `{phasePlan: {edited, inserted}}`)同源,M2/M4 的 item/group
  配置沿用同一门。
- **P0② publication 边界永不可 force advance**:`advancePhase` 三分——manual 正常、
  scheduled 走 force+reason+force-advance 权限、**publication 一律拒**(新拒因
  `publication-boundary`):其进入只能由所绑公示 effectivePublished 驱动
  (actual := publish_at),M5 的公示服务走内部物化函数,不走公共 advance。
  "force 是对时钟的权威,不是对不变量的权威"。
- **P1③ offset 物化后冻结**:引擎新拒因 `offset-with-planned`——planned 非空时
  set-offset(含清空)一律拒,物化后的 offset 是 provenance;planned 先清空则释放可编辑
  (working plan 顺序演进天然支持);整计划/插入/模板对 planned+offset 并存同拒
  (顺带修了 reviewInsertion 伪 phase 丢 planned/offset 导致 combo 检查失明的洞)。
- **P1④ 模板结构档补全**:`reviewPlan(specs, null)` 不再连带跳过结构规则——
  hard-plan-beyond-event-boundary、planned-out-of-order、combo 在无钟档**照常执行**,
  只豁免 planned-not-in-future(十月存九月模板合法,但"manual 后接绝对时间"的模板
  在任何月份都无法应用,存都不该存进去)。
- **P1⑤ scoped 写入口**:`phaseSpec`/`phaseView` 增 `itemScope`/`participantScope`
  (幂等替换,空=不限);服务负责维护(writePlanOrder 统一写、active 记 'scope-changed'
  事件并计入配置变更);**participantScope 成员必须 ∈ 本批次 roster**(FK 只保租户,
  同批次由服务把线,拒因 `participant-not-in-batch`;draft 无 roster 天然拒);
  模板禁携 scope(`scope-in-template`);ended 阶段改 scope 拒(name-only 规则延伸);
  测试改为**经服务写入**,不再裸 SQL。
- **P1⑥ draft scope 可改**:PATCH 增 `scopeNodeId`——draft 放行(requireAt 新节点 +
  同事务重冻 scopePath),active 拒(新错误码 `ASSESSMENT_BATCH_SCOPE_LOCKED`,
  i18n 双语同笔);激活 roster 取重指向后的 scope(实测)。
- **P1⑦ 激活重验时钟**:`setBatchStatus(active)` 对整计划跑 reviewPlan(结构+时钟)——
  搁置过期的 draft(planned 已过)拒绝激活(`planned-not-in-future`),不产生
  "phase 语义开始时间早于批次存在"的历史;不做"晚激活自动追认"例外(文档无此规则)。

**P2 留档不修**(按数据层冻结元规则):①`current_phase_id` 与 `phase_participant_scopes`
的 FK 只保证同租户不保证同批次(service 写路径不制造,首次需要 aggregate 级复合 FK 时再定);
②模板权限用 `hasPermission(batch.manage)`——某学院管理员可管全租户共享模板,是否收紧
属产品口径,设计文档未写死,留待裁决。

**验收(实际执行)**:引擎新增 3 用例(offset 冻结与释放、reviewPlan 无钟档仍拒结构违规
×2);服务套件 **12 用例**全绿——config 生命周期四段(draft 0 事件/active 变化
revision 1+diff/no-op 不动/计划编辑 revision 2+phasePlan diff)、publication 边界
force+reason 仍拒且拒因准确、offset 物化后改动拒 `offset-with-planned`、模板存
"manual 后绝对时间"在保存时即拒(且无 future 拒因)、scope 经服务写入后 gate 六格判定
不变+陌生 participant 拒、draft 重指向 scope_path='r.b' 且 roster 来自新 scope+active
锁定、搁置 1.4s 的 draft 激活拒。`pnpm typecheck` 零错;`pnpm test` 全仓
**69 文件 441 全绿**;`resolve --frozen-lockfile` up to date。

**下一步**:s4 调度 fiber(不变)。

### M1 会话 12 · batch scope 升级为节点集合(2026-08-09)

用户提出"scope 是否该改成导入模式 + 每分钟检测锚点漂移",裁决:**scope 保留并升级为
节点集合,导入模式否决**(裁决 §32.35,§9/§21/§27 就地改写)。核心论证:scope 是
**人群的定义(intent)**,roster 是**人群的事实**——导入模式做完一次性动作后系统不再
知道批次面向谁,**新迁入检测失明**(转入生无行可 diff、无定义可判);定义落库才使
"新迁入 = 任一 scope 子树内 ∧ 类型匹配 ∧ 不在 roster"可计算,并承载管辖判定与
"你尚未被纳入"定向文案。"只许 1/2/3 班"证明的是表达力不够,不是概念错了。

- **schema**:`batch_scope_nodes(tenant_id, batch_id, node_id)` 替代 batches 上的
  scope_node_id + scope_path 两列(快照列取消——要冻结的是 roster 不是 intent);
  **node_id 刻意无外键**——节点删除应成为 diff 面板的 scope 完整性警告而非被阻塞或
  静默消失,租户与存在性由服务在写入时把线。**破坏性迁移**
  `20260809085658_batch-scope-node-set.sql`:建表 + FK → **INSERT…SELECT 把既有批次的
  单节点搬进 join 表** → 再 drop 两列(`ALLOW_DESTRUCTIVE=1` 生成,文件带
  `-- destructive: approved`)。**仓库首个迁移升级测试**落地
  (tests/migration-upgrade.test.ts):部分 lineage 建旧库形态 → 插入带 scope 列的活
  batch → 跑全量 lineage(账本只补差)→ 断言 join 行搬到、两列消失;test-layers 门禁
  为"迁移升级测试"开出**单文件名单规则豁免**(只豁免 migrator import,pg/Pool 等
  其余规则照抓)。
- **服务与 API**:`scopeNodeIds` 集合贯穿 create/PATCH/detail/list(list 的管辖过滤 =
  `NOT EXISTS(未覆盖的存活 scope 节点)`下推 SQL;悬空节点定义不了任何人,不阻塞也不
  放行,只出警告);`requireScopeReach` = 对每个存活 scope 节点 requireAt(全悬空的退化
  情形回退 hasPermission,注释说明);激活 roster 单条 SQL 改 `EXISTS` 于节点集合并集
  (嵌套已拒 ⇒ 子树两两不相交,无重复行);校验三拒因:`scope-empty` / `scope-node`
  (含跨租户,不存在即拒)/ `scope-nested`(祖先后代同选,并集语义无害但必然困惑,
  直接拒);draft 可改 active 锁(沿用 ASSESSMENT_BATCH_SCOPE_LOCKED)。
- **检测节律**:漂移检测 **on-read 派生**(面板/徽标现算),否决"每分钟扫描"——漂移有
  请求驱动的天然发现路径且不阻塞在途流程(与审核卡死必须巡检的判据对比写进 §9);
  巡检摘要加 diff 计数留 §27 触发条件。三层冻结梯度成文:实时层(树/角色持有人)/
  批次层(roster 位置+谱系)/轮层(链快照)——位置冻结、人员实时、类型冻结。

**验收(实际执行)**:升级测试 1/1(旧形态→迁移→join 行在、列消失);"1/2/3 班"实测
——scope=[class1, class3](跨 grade 两班)激活后 roster 恰为两班学生,同 grade 未选的
class2 排除;嵌套选择拒 `scope-nested`、空集拒 `scope-empty`;draft 重指向 [gradeB]
后 roster 来自新 scope,active 改 scope 仍锁;scoped gate/config 生命周期/advance 等
12 服务用例全数迁移到集合形态后照绿。`pnpm typecheck` 零错;`pnpm test` 全仓
**70 文件 442 全绿**;`resolve --frozen-lockfile` up to date(实体指纹变更经 resolve
收编)。

**下一步**:s4 调度 fiber(不变);s5 diff 面板按 §32.35 增 scope 完整性警告类。

### M1 会话 13(s4)· 调度 fiber(2026-08-09)

**实查上游**(effect 4.0.0-beta.103,路径逐一读过):`repos/effect/packages/effect/src/Effect.ts`
(forkIn:8482、forkScoped:8525、repeat:7511、provideService:6225、scope:6343)、
`Schedule.ts`(fixed:933——带 runningBehind 追平;spaced:1198)、`Clock.ts`
(currentTimeMillis:265)、`testing/TestClock.ts`(layer:411、adjust:482、setTime:519、
withLive:555、Options 只有 warningDelay:167)。未凭记忆用任何 API。

- **服务改读 Effect 时钟**:`Date.now()` 全部换成 `Clock.currentTimeMillis`(6 处)。这是
  TestClock 能真正控制判定的前提,也让"现在几点"成为可注入事实而非环境。
- **候选查询**(db.ts,**刻意跨租户**):`batchesWithDueBoundaries(now, limit)`——调度器以
  系统身份行事而非替某 principal,故不 tenant-scoped。它是**候选**查询,允许超集(谓词只取
  "active 批次存在未进入、planned 已过的 scheduled 阶段"),真正谁跨界由引擎在各自事务里定;
  **不允许欠集**,所以谓词取"跨界必然蕴含"的最弱条件,武装前缀(前面挡着 manual)由引擎判。
- **服务 `sweepDueBoundaries`**:一次候选查询 + **逐批次一个事务**(锁行→读计划→ratifyPending),
  返回 `{scanned, ratified}`;单事务横扫全部批次会把锁跨租户握住,逐批次则一次失败只赔上那个
  批次这一分钟。`ratifyPending` 顺带补齐:①返回本次真正写下的条数(写入条件是 actual 仍为 null,
  并发者收敛为 0);②**边界落地即物化下游 offset**(此前只有手动 advance 会物化,调度器路径漏了
  ——同一句"边界发生 = 锚点确定"现在两条路径共用)。SWEEP_BATCH_LIMIT=200 是天花板不是分页,
  下一分钟自然续扫。
- **fiber**(`src/phase/scheduler.ts`,全文件 ~70 行):`Effect.repeat(sweep, Schedule.fixed('1 minute'))`
  ——fixed 而非 spaced(节律是墙上时钟的一分钟,不是"上次跑完后一分钟");**在屏障上 fork、
  forkIn 到本层 scope**(屏障:后台 fiber 不该在装配还没建完时开始写;层 scope:关停即随 scope
  一起中断,SIGTERM 不必挂超时);boot hook 无 requirement,故 Assessment 在注册处用
  `Effect.provideService` 绑定;`Effect.catchCause` 兜住失败与缺陷——**一次坏事务不许结束循环**,
  下一分钟就是重试的好时机。单实例声明照迁移器口径写进注释:两个进程也不会写坏(条件写入),
  只是没人需要,所以不买锁。
- 描述器上车:`Plugin.layer(schedulerLayer.pipe(Layer.provide(serviceLayer)))`——fiber 消费服务、
  不导出任何 tag,不进别人的图。

**验收(实际执行)**:scheduler 套件 2 用例 ——①**时钟决定/物化只是记账**(不起 fiber:越过边界后
gate 已放行而 actual 仍为 null,这条在没有任何扫描者能竞态的地方断言)+ 起 fiber 后
**actual == planned**(不是 now)、processed 严格晚于 actual、事件恰一条、current_phase_id 投影
更新;②**十分钟空转**不重复写(幂等)且 manual 之后的 scheduled/offset 阶段**不自燃、不物化**;
③**跨租户一次扫两个租户**(scanned 2 / ratified 2)、二次扫 0/0、draft 批次不动。
过程中修掉自己的两个测试错误:计划末位放 scheduled 被引擎按 terminal-must-be-manual 拒(引擎再次
抓到测试违规)、`'4 minutes 30 seconds'` 不是 v4 合法 Duration(单单位)。**并修掉一个真 flake**:
TestClock 的 adjust 先推进时间再唤醒睡眠者,所以落在 adjust 区间内的 tick 会观察到区间**末端**
时刻——原测试"tick 之前 actual 仍为 null"因此在全量并发下不成立;改为把两个命题拆开各自确定
(无 fiber 段断言时钟语义,有 fiber 段用 `TestClock.withLive` 轮询等待真实事务落地,超时即响亮失败)。
`pnpm typecheck` 零错;`pnpm test` 全仓 **71 文件 444 全绿**(连跑两轮确认 flake 已消);
`pnpm dev` 真启动 READY 2s,debug 日志实见 `boot hook: assessment/phase-scheduler` →
`phase scheduler sweeping every 1 minute`,SIGTERM 后 shutdown complete(fiber 随 scope 落幕)。

**下一步**:s5 花名册 diff 与对称转入转出(四类差异 + §32.35 的 scope 完整性警告类、
纳入动作的双重参与警告、显式移出与 excluded、锚点变更应用、"首提前自动同步"开关落配置位)。

### M1 会话 14(s5)· 花名册 diff 与对称转入转出(2026-08-09)

roster 的管理面。中心原则照 §32.7/§32.35 落实:**diff 是 on-read 派生视图,花名册永不
自行移动,每个变更都是人的显式动作**。

- **diff 五类**(`GET …/roster-diff`,面板打开现算、徽标同源、零存储):新迁入(未纳入,
  每行携带 **activeElsewhere**——该生在其他未归档批次的 active 记录,双重参与的决策辅助)、
  已迁出仍在册(live 位置不在任何存活 scope 节点下)、锚点变更(域内挪动:live 节点或
  路径 ≠ 冻结值)、用户类型变更(带 `toEnrolled`——新类型是否仍在批次集合内)、
  **scope 完整性警告**(scope 行指向已删除节点,§32.35 新类)。漂移行可同时出现在锚点与
  类型两类(各说一个维度);出了 scope 的只进"已迁出"(锚点/类型类过滤 inScope——出域者
  的补救是移出,不是把锚点改到域外)。draft/archived 批次返回全空(漂移是活批次的问题)。
- **纳入**(`POST …/participants`,转入默认不纳入——diff 只列出,人来点):守卫链 =
  批次 active → 用户存在 → enabled ∧ 类型 ∈ batch_user_types → live 位置 ∈ scope
  (**范围外手工纳入按 §27 拒绝**,不留后门)→ 无既有行;通过后**单条 INSERT…SELECT**
  现场冻结快照(与激活同形,单人版)。响应带 activeElsewhere 警告(是辅助不是拒绝——
  两院协调是人的问题)与 **chainPreview**:M1 的降级链预检——对新 lineage 逐级数
  "恰锚定于该节点的任意角色持有人"(锚点精确匹配,与 M3 stage 成员资格同口径;真正的
  按 review_policy 解析 M3 接全,已注明)。
- **移出与恢复**(`PUT …/participants/{pid}/status`):excluded 保留整行与全部历史
  (实测行数不变),diff 对已移出者闭嘴(决定已做,不再唠叨);重纳入同一扇门反向走,
  幂等(重复置同状态收敛为 no-op)。
- **锚点应用**(`PUT …/participants/{pid}/anchor`):**整个冻结快照一体重冻**——位置、
  谱系、类型是"谁、站在哪、以什么身份参加"这同一事实的三面,服务端从 live 现算
  (无客户端输入);excluded 拒 `participant-not-active`,出域拒 `user-out-of-scope`;
  在途链快照(M3)不受影响,注明。
- **"首提前自动同步"开关**:`anchor_auto_sync` 列落 assessment_batches(追加迁移
  `20260809100142`,非破坏),create/PATCH/detail 贯通,active 改动走统一配置事件门
  (diff 键实测);M2 有了"首次提交"才生效,列上注释说明。
- **闭包扩到 rbac**:链预检(及 M3 收件箱)join role_grants——按"跨插件取表 = dependsOn
  - 实体并入闭包"纪律,`Db.entities` schema 依赖加 @qualy/plugin-rbac,db 闭包并入其六表
    (§29 判据:holders 反查是 rbac 词汇的只读下行,M1 先以直查降级实现,M3 若 rbac 提供
    正式 holders API 再切)。
- 错误码 +2(PARTICIPANT_NOT_FOUND / PARTICIPANT_INVALID 六拒因,i18n 双语同笔);
  frozen-routes +5;participants 列表 keyset(anchor_path, id)。

**验收⑤(实际执行,全部真跑)**:diff 大场景——两批次两 scope,一个学期的全部变动
(s3 迁入 A、s2 迁出 A、s4 域内换班、s1 改类型、scope 叶节点被删)一次读出五类,且
**A/B 两侧对称**(s2 同时是 A 的已迁出与 B 的新迁入,activeElsewhere 互指对方批次名);
变动风暴后冻结快照逐字节不变、roster 成员不变(转入默认不纳入);纳入六拒因逐一
(teacher/disabled → not-eligible、域外 → out-of-scope、陌生 uuid → not-found、draft →
batch-not-active、重复 → already-included)+ 成功纳入冻结三级 lineage + activeElsewhere

- chainPreview [1,0,0](class1 有一名角色持有人);移出行数恒 3、重复移出收敛、diff 停止
  报告、重纳入恢复;锚点应用重冻三面 + 预览计数 + 应用后 anchorChanged 清空 + 两拒因;
  开关 create true → PATCH false 落配置事件。`pnpm typecheck` 零错;`pnpm test` 全仓
  **72 文件 449 全绿**;`resolve --frozen-lockfile` up to date;`pnpm dev` READY 2s、
  未登录 `GET …/roster-diff → 401`、SIGTERM 干净退出。

**下一步**:s6 batch-admin 页(M1 最重前端会话:批次表单、阶段时间线编辑器、权限矩阵
编辑器(数据源 PHASE_GATED)、roster+diff 面板;Ui.page + i18n catalog + 浏览器测试;
超时切分线在"阶段编辑器"与"roster 面板"之间)。

### M1 会话 15(s6)· batch-admin 页(2026-08-09)

M1 最重的前端会话,四个面板一次做完(未触发"阶段编辑器/roster 面板"切分线)。

- **§22 跨域选项纪律先补服务端**:批次表单要选组织单位与用户类型,但"禁止逼页面持有
  其他域读权限"——于是加两个 **assessment 自己的 options 端点**
  (`GET /assessment/scope-options`:调用者对 batch.manage 的授权范围**就是**可选单位集,
  scopeCoverage 下推 SQL;`GET /assessment/user-type-options`),管理员只需
  assessment.batch.manage 即可填完表单,不必再持 org.tree.read。frozen-routes +2。
- **权限矩阵的数据源是 PHASE_GATED 本身**(§32.13 的结构性安全在 UI 上兑现):
  `permissions.ts` 把白名单改成字面量元组 `PHASE_GATED_CODES`(PHASE_GATED 由它派生),
  矩阵组件遍历该元组、标签用**以该元组为键的映射**——新增受控码若无译文**直接编译失败**;
  其他插件的权限**在结构上进不了这个列表**,不需要任何校验去拦。
- **阶段时间线编辑器**:一行一形态——已进入显示时刻(只读)、publication 边界显示"待定"、
  有 offset 显示时长(已物化则禁用并注明)、其余显示日期时间输入(manual 边界的标签是
  "目标日期"并注明"手动阶段永远不会自己开始",与承诺型区分);插入阶段、模板套用
  (仅 draft 可用,服务端复制)、advance(manual 直接开始,scheduled 走"提前开始"+理由)。
  **不重写规则**:提交整份计划,把引擎拒因**按 index 渲染回对应行**,行级拒因显示在该阶段
  卡片里,计划级拒因显示在面板顶部。
- **拒因映射表编译期完备**:`refusals.ts` 以 `Record<EditRefusalReason | ServiceRefusalReason,
MessageDescriptor>` 为类型——引擎新增拒因而无句子即编译失败(type-only import 引擎类型,
  运行时零成本)。
- **roster + diff 面板**:五类各配一个动作(新迁入→纳入并显示"同时参加 X"警告、已迁出→移出、
  锚点变更→应用新位置、类型变更→提示是否仍在纳入类型内、scope 完整性→列出缺失单位),
  draft 批次显示"花名册在激活时生成"。
- **i18n**:130 条文案 + zh-CN 全量(含 navigation label、11 条权限标签、26 条拒因句子);
  组件内**零裸中文**;`Ui.i18n` 与 `Ui.page`(visibility=permissionOf('assessment.batch.manage'),
  ADMIN_SHELL,导航 order 40)上车;apps/web 加插件依赖(收集器对未声明输入硬失败)。

**验收①(浏览器实测,新增 6 例)**:①**阶段编辑器只显示受控权限**——按阶段行 scope 查询,
断言恰 **11 个复选框**且"登录/管理组织架构/管理测评批次/查看角色"**均不存在**;
②模板套用只发 `fromTemplateId`(复制归服务端,溯源由服务端写)、active 批次该控件禁用;
③引擎拒因 `hard-plan-beyond-event-boundary` 以**中文句子**出现在对应阶段行;
④三种时间形态各自渲染正确的控件(计划时间 vs 偏移天数);⑤diff 两类各自触发正确的 API
(纳入带 userId、应用锚点带 participantId)且"同时参加：英语学院综测"可见;
⑥draft 批次显示花名册尚未生成。过程中修掉自己两个测试错误(复选框计数把新建表单的也算进去
——改为按阶段行 scope;同一 `it` 里渲染两次页面导致按钮重复——拆成两个用例)。

**门禁(实际执行)**:`pnpm typecheck` 零错(含新 client 工程与组件引用检查器);
`pnpm test` **72 文件 451 全绿**;`pnpm test:browser` **4 文件 22 全绿**(冷跑);
`pnpm build` 组件收集 + chunk 哨兵通过、产物 staged;`resolve --frozen-lockfile` up to date;
`pnpm dev` READY 1s、未登录 `scope-options → 401`、`/assessment/batches` 页面壳 200。

**下一步**:s7 学生时间线页 + M1 全量验收收口(取值优先级渲染、"待定"文案红线、拒因到 UI
文案映射,然后 ①–⑩ 全部真跑一遍并把输出摘录进 STATUS,M1 收口提交)。

### M1 会话 16 · batch-admin 页返工(2026-08-09,用户评审裁决)

用户对 s6 首版三项批评:布局是 Card 顺序堆叠没法用;模板模型错了(阶段模板与时间线模板
是分开的两种东西且都不是必经之路);文案暴露内部术语。三项全部返工。

- **模板分立(裁决记 §32.36)**:`phase_templates` 加 `kind`('timeline' | 'phase',
  迁移 20260809111511,check 约束,默认 'timeline' 保存量行)。timeline = 完整阶段序列,
  语义不变;**phase = 单阶段预设**,只有名称与权限选项、无时间无 trigger(存储惯例单条目
  manual 全空时间,服务端 `phase-template-shape` 拒因把关;`fromTemplateId` 遇 phase kind
  拒 `template-not-a-timeline`)。listTemplates 加 `?kind=` 过滤,两个选择器各查各的。
  应用语义分层:时间线 = 草稿期服务端整体替换(带溯源);预设 = 编辑器内复制名称+profile
  进目标行(起点填充,无溯源)。**三条路互相独立**:从零逐个加阶段 / 套时间线 / 单行套预设。
- **@qualy/ui 补足组合原语(零新依赖,房风:主题 token、原生 `<dialog>`)**:badge / table /
  tabs(手写 WAI-ARIA tablist,roving focus + 方向键)/ select(styled native);admin.tsx
  抽 `useNativeDialog` 共用机制,新增 **FormDialog**(居中模态)与 **SidePanel**(右侧
  侧拉),ConfirmDialog 改用同一机制。全部只用 shadcn 主题变量,不自定义颜色。
- **布局重做**:列表页 = 页头 + 表格(名称/状态 Badge/材料区间/单位数),行点击进详情;
  新建批次在 **FormDialog**;详情页 = 返回链接 + 标题行(名称 + 状态 Badge + 元信息 +
  激活/归档,两者都过 **ConfirmDialog** 说明后果)+ **Tabs**(阶段安排 | 参评人员)。
  阶段列表一行一句话(第几个、名称、何时开始、开放几项操作),**全部编辑控件收进
  SidePanel**:名称、开始方式(RadioGroup 三选)、时间形态(scheduled 内再选"具体日期 vs
  跟上一阶段算天数",已换算的只读并说明)、预设填充、权限矩阵;移除阶段过 ConfirmDialog。
  advance:manual 行"开始这个阶段"过确认框,scheduled 行"提前开始"进 FormDialog 理由必填。
  roster tab = 变动分区(各带计数 Badge + 逐条动作)+ 参评人员表格。
- **文案全量重写(en + zh-CN,~150 条)**:面向第一次见到产品的人,零内部术语——"物化"→
  "这段间隔换算成了上面的开始时间";trigger→"它怎么开始?";publication→"成绩公示时开始";
  advance force→"提前开始(会连同你的理由一起记录)";roster→"参评名单";diff 五类各配
  一句"这些人是谁、你该做什么"的说明。拒因句子全部改写成可执行的建议
  (hard-plan-beyond-event-boundary → "前面还有阶段没定下日期……改用'上一阶段开始后第几天'")。
- **侧边栏问题实证(用户中途报告"侧边栏没有测评批次")**:起 dev、登录种子管理员、拉
  manifest——`admin-shell/navigation-primary` **含** `assessment/batches/nav`(order 40),
  AdminShell 对 collection 无条件全渲染,当前代码无缺陷。成因是用户的 dev 后端进程仍在跑
  s6 描述器落地前的代码(manifest 由后端算,Vite 热更不覆盖):**重启 `pnpm dev` 重新登录
  即可见**。
- **测试**:node 新增"keeps timeline and phase templates apart"(phase kind 建/带时间拒/
  两 kind 过滤互斥/fromTemplateId 误用拒),浏览器套件按新交互全部重写为 9 例:表格进出详情、
  **零模板从头建阶段**(空态双路径文案)、面板矩阵恰 11 码且外部权限不存在、预设填入(名称+
  勾选变化且仍可改)、时间线按 id 服务端套用、active 不再提供时间线、拒因句子出现在面板、
  提前开始理由必填(空理由按钮禁用)、roster 草稿说明 + 两类变动各触发正确 API。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **72 文件 452 全绿**(两轮,首轮
一例未复现 flake 二轮起干净);`pnpm test:browser` **4 文件 25 全绿**;`pnpm build` 通过、
产物 staged;`resolve --frozen-lockfile` up to date;dev 实测 manifest 导航条目在。

**下一步**:s7 不变(学生时间线页 + M1 ①–⑩ 全量真跑收口)。阶段/时间线模板的管理界面
(建/改/删模板本身)尚无 UI,按需求触发再建。

### 界面体系返工(2026-08-09/10,用户逐轮评审驱动)

连续多轮把管理端从"手写组件"迁到真组件库,并把壳与导航契约做成开放注册。

- **@qualy/ui 采纳 shadcn 官方组件栈**:经官方 CLI 拉取 25 个组件源码(dialog/drawer/
  alert-dialog/select/dropdown-menu/popover/calendar/checkbox/radio-group/collapsible/
  breadcrumb/field/hover-card/tabs/table/badge/avatar/skeleton/button-group 等,radix base,
  new-york 风格),NodeNext 约束下对产物做确定性 import 改写(@/ 别名→相对+扩展名);
  依赖 radix-ui/vaul/react-day-picker/date-fns/lucide-react/tw-animate-css/motion 归 ui 包。
  适配层(admin.tsx)保 prop API 重建在官方结构上:FormDialog/ConfirmDialog(AlertDialog)/
  SidePanel(右侧圆角 Drawer),CheckboxGroup/RadioGroup 内部换官方组件;**纪律:组件内部
  样式零覆盖,只做布局层**(overlay 的 backdrop-blur 是三处组件源码内的一次性全局设计决定)。
- **导航成为开放契约**:删除 NavGroupId 枚举——ui-contract 只供 navigationGroups
  collection token(id/label/order/parent/icon),组由业务插件注册(org 注册"管理"与
  "组织与用户"(users 图标,parent 嵌套成三层),assessment 注册"综合测评"),页面按命名
  空间化 id 引用,断链回退散项;sidebarUser 槽位由 auth 贡献用户卡。catalogs 门禁升级为
  对 surfaces 声明深扫任意 UiText(collection 值里的可译文本从此在护栏内)。
- **壳(AdminShell)**:inset 形态(视口不滚、内容卡内滚)、三层侧栏(小字分区→可折叠簇→
  页面)、官方 Breadcrumb、收起侧栏(负 margin 滑出,弹层不被裁)、LocalePicker 用官方
  Select 自适应宽。
- **会话携带站位**:SignedInUser.primaryOrgNode 加 orgType 与 lineage(ltree 祖先一查),
  用户卡=姓名/学工号(空则灰字"未绑定学工号")/类型 Badge,菜单右弹带 [节点类型] 谱系路径。
- **assessment 管理屏**:组织范围换**层级选择器**(TreeSelectDialog,演算抽纯函数
  tree-selection.ts——勾父覆盖子树、取消子自动拆解为其余兄弟、结果恒为非嵌套集,6 个
  单测钉死,ui 包 tests/ 入 tsconfig);日期字段换 DatePicker(Popover+Calendar,
  captionLayout=dropdown,date-fns locale 随界面语言);花名册姓名列 PersonCell
  (Avatar+HoverCard 详情);各列表 AsyncSection 加 Skeleton 骨架;页面入场 Reveal(motion);
  新建批次对话框照官方 demo 形态(FieldGroup,官方间距,焦点环不被裁)。导航页更名"批次管理";
  "管理测评/填报测评"二级簇留待 M2 内容落地(单成员簇只添点击)。
- **风格试验并回退**:官网紧凑感实查为其 demo 容器的 scaled 变量层(--spacing .2rem 等),
  搬入后用户嫌密回退;nova 风格(preset b0→registry 路径 radix-nova)整套试穿后同样回退
  (用户 git add 快照 + git restore 复原)。**定论:new-york 默认密度**;后续微调只动
  --spacing 一个变量。
- **.claude/.agents/skills-lock.json 进 .gitignore**(本地 agent 工具链不同步;
  已跟踪的 .claude/settings.json 维持原状)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **73 文件 459 全绿**(+6 树选择
演算);`pnpm test:browser` **25 全绿**(radix 化后未改一行断言);`pnpm build` 通过;
dev 实测截图逐轮核对(三层导航/树选择器/用户卡右弹菜单/日历/blur 弹层)。

### 管理端产品化打磨(2026-08-10,用户逐轮评审驱动)

在上一节的组件迁移之上,把批次管理从"能用"推到"像产品"。

- **文案产品化**:批次/阶段两屏的教学式与聊天式话术整体重写为功能陈述句(开始方式三选项
  =定时开始/手动开始/随成绩公示;计划开始时间"非必填,仅供参考";权限提示"仅在本阶段生效,
  不改变角色本身的权限");失败提示改为"<对象>保存失败:"句式(~~"安排没有保存成功"~~)。
- **列表页**:搜索(ilike,字面量转义)+ 状态筛选 + **真页码分页**——api-kit 新增
  `countedPageOf`(items+nextCursor+total,count 是有意付费),db 的 `batchFilters` 让列表与
  计数同源,前端持游标栈(上一页复用已持有游标)配官方 Pagination;**总数常驻、页码控件仅在
  多页时出现**(游标列表必须回答"是不是全部",单页显示 `< 1 >` 则是纯装饰)。列"覆盖范围"
  换"参评人数"(batchSelection 投影内相关子查询,草稿显示 —)。
- **分步引导**:新建批次两步(基本信息 / 参评范围,范围内联树选不再弹二层模态框);阶段面板
  两步(基本信息+开始方式 / 开放操作),权限按填报-审核-结果分组平铺并逐条给一句说明;
  三种开始方式做成卡片选项。SidePanel 由 vaul Drawer 改 **Sheet**(vaul 手势填充层在 inset
  壳下外露成白条),语义定型:Dialog=居中决定、Sheet=侧栏编辑、Drawer=移动端手势。
  DateRangePicker 照官方示例(选起始不自动关闭)。
- **暗色模式**:web-runtime 的 ThemeProvider(light/dark/system,localStorage,跟随系统变化)。
- **个人偏好归账户菜单**:外观(图标胶囊)与语言(**DropdownMenuSub**,语言数量会增长)移入
  左下角用户菜单,选择不关闭菜单;头部只留面包屑与 headerActions 槽(右上角留给未来的
  助手/对话类功能)。preferred_locale 暂不入库,触发条件:共享终端场景 / 服务端生成邮件导出。
- **身份逐级展示**:session 的 lineage 每级带 typeName(sign-in 多 join 一次 org_types),
  菜单里按"学校:X / 学院:Y / 班级:Z"逐行渲染,层级数量随人自然变化。
- **移动端**:< 768px 时侧栏改为左侧 Sheet 抽屉(默认收起,跨断点跟随),复用同一个开关按钮。
- **领域裁决 §32.37**:删除引擎自造的 `insert-after-terminal`——单阶段批次进入后"当前"与
  "末位"重合,两条位置规则把可插位置挤成空集,计划永久冻结(用户实测踩中)。收尾是归档
  status 及其 gate 的职责,不是末位序号。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **73 文件 461 全绿**(+2:末尾追加
的引擎用例与服务级全链用例);`pnpm test:browser` **28 全绿**;`pnpm vitest run
tools/tests/catalogs.test.ts` 7 全绿;`pnpm build` 通过;dev 实测:桌面/暗色/手机三档截图,
并在用户报障的那个批次上端到端复跑"单阶段进行中 → 追加定时阶段"成功。

### 时间线编辑器返工为"段 + 共享边界"编排器(2026-08-10,用户体验批评驱动,裁决 §32.38)

- **plan-model.ts 投影层**(纯函数,5 单测):boundaryViewOf/withBoundary 双向 lens,
  管理员词汇(定时/顺延/人工确认/随成绩公示)↔ 引擎词汇(trigger+planned/offset/estimated),
  往返恒等钉死(含小时粒度 offset、已定型 offset、模板写进 planned 的 SLA);编辑器全文
  不再触碰任何 entry 字段。存储模型零改动(engine/scheduler/api/putPhases 全不动)。
- **编辑器重写**:顶部等宽非比例总览条(状态着色+切换图标);**左时间线 + 右检查器两栏**——
  每张段卡并排显示自己的开始/结束/持续/开放项数(两格指向同一切换点、同时高亮),左栏纯只读,
  全部控件在右栏检查器(独立滚动、sticky,二十余条权限不再撑满视口);首版"边界只渲染在两卡
  之间"被用户判为不可用(读起止要上下找、信息与按钮交织),故共享改为**只约束编辑不约束显示**;
  "审核期截止待定"现在就是在边界上选"人工确认",不再需要"创建手动开始的下一阶段"的心算。
  整线本地草稿一次保存(粘性保存条,N 处修改/放弃/保存编排),refusals 按 phaseId/index
  下沉到段卡旁;进行中批次把引擎规则画出来:已入口边界带锁与实际时刻、已有阶段切换方式
  只读、插入点只在当前之后渲染、未保存段带"未保存"徽章可撤。原两步 SidePanel 范式退役。
- i18n:phase 面板词汇表整体换血(boundary/* plan/* 34 新键,33 死键清除),catalogs 7 绿。
- 测试:plan-model 5 新;浏览器 28→29(新增共享边界用例:改一次边界,落在下一阶段的 entry 上;
  局部编辑不发请求、保存一次整案提交)。

- **切换点收敛为轨道上的唯一一行**(第三轮修正):此前"开始/结束两个格子 + 两张卡外框"点击时
  四处同时点亮,用户判为噪音;**共享改用位置表达**——切换点画在两卡之间的连接轨道上,只此一处
  可选可点,选中只亮它自己(轨道转主色 + 行内淡入),歧义与高亮把戏一起消失;每张段卡改为
  一行只读跨度("开始 X → 结束 Y"),读一个阶段仍不必上下找。视角问题随之**不复存在**:
  只有一个入口,标题恒为"切换点"、副标题"「A」的结束与「B」的开始是同一个切换点"、
  动作恒为"结束「A」，进入「B」";该动作从检查器底部提到**顶部高亮条**(不必再滚);检查器换内容走 Swap 短转场(motion,160ms),选中切换点时整个检查器换主色底以区分两种对象;锁图标、
  未保存圆点带 Tooltip 解释(shadcn tooltip);空计划给三句话说明编辑器怎么用;放弃修改改为
  确认对话框;总览条可点跳转;保存条滑入。**未做**首次遮罩式引导(一次性打断、需要记住
  已读状态,收益不抵成本;说明就地放在空态里)。

- **一体化工作台**(第四轮修正):检查器此前是"框随内容长"的浮动卡片,切换点配置与权限配置
  高度悬殊导致右栏忽长忽短,用户判为拼凑;改为**单一容器的 master-detail 工作台**——
  总览条成为容器头带(border-b),左右两栏 divide-x、**恒定高度**(max(30rem,100dvh-23rem),
  实测两种选中同高),左栏计划列表自滚动,右栏检查器"固定身份带 + 滚动体"三段式:身份带
  常驻眉标(阶段 N / 切换点)+标题(「A」→「B」)+副标题与移除按钮,内容在带下滚动,框架永不
  随内容跳动;检查器整体换色取消(乱源),身份靠眉标与图标表达。总览条 overflow 修复:
  flex 子项缺 min-w-0,truncate 从未生效,长名撑破容器。

- **竖向 rail 与"现在"锚点**(第五轮,两份外部审计意见筛选后采纳):左栏成为一条贯穿的时间轴——
  节点(切换点)与段落(阶段)交替挂在同一条线上,已过节点实心主色带锁、未来节点空心虚线,
  **"现在"是线上的一个脉冲标记**(motion-safe),一眼看到批次走到哪;顶部横向总览条**删除**
  (与 rail 信息重复,且是 overflow 的来源);**每个时刻只印一次**——卡片不再复述起止(此前
  同一时刻在节点+上卡+下卡出现三次),改为把**持续时长**提为卡片主信息(排期最该看的数字);
  节点文案换成自然语言("已于 X 开始"/"X 自动切换"/"「A」开始后第 3 天 · 预计 Y"/
  "待定 · 由管理员确认后进入"),两套重复词汇表(short*/reason* 与 boundary*)合并为一套;
  推进动作("就此切换")从检查器移到 rail 节点上,原地可见;插入 + 悬停显现(触屏常显)。
  **未采纳审计1的"合并检查器、只选阶段"**:那正是用户最初批评的模型(改 A 的截止要去 B 里设),
  但吸收其内核——阶段检查器顶部以只读方式讲出自己的起止,每端配"设置"跳到对应节点。

- **单栏行三元组**(第六轮,用户重设计 + 两份外部审计逐条裁决,见 §32.39):双栏工作台退役,
  每行 = 阶段名 + [开始][时长][结束];**只有"结束规则"被编写**,开始是上一行结束的投影、
  时长仅在"持续时长"规则下才是权威;结束规则四选一显式声明,拒绝"改时长静默把固定时间
  改写成偏移"——**存承诺语义不存当前算得出的结果**。投影层新增 endRuleOf/withEndRule/
  startRuleOf/withStartRule/resolveStarts(沿链传播 actual > planned > offset,算不出即 null),
  5 例新测试。插入改常驻缝(hover 显现),否决"暂态空隙";保存前的便宜校验**锚定到字段**
  (展开出问题的行 + 红边 + 行内句子 + "暂时无法保存：还有 N 项需要处理"),否决抖动/Sonner。

**门禁(实际执行)**:typecheck 零错;node **471**(+5 投影层);browser **30**(+1:未完成草稿
就地被拒且不发请求);catalogs 7;build 通过;dev 实测(进行中批次):三格行/共享切换点面板/
锁定态/插入缝渲染正确,控制台零 error。

### Phase 模型退回三职责(2026-08-11,裁决 §32.41,docs/phase-redesign.md)

按定案全栈重构:**阶段只有"有时间"与"待排期"两种状态**,不再有 trigger/offset/公示绑定。

- **存储**:`batch_phases` 删 `entry_trigger`/`entry_offset`/`estimated_entry_at`/
  `opens_publication_id`,加 `description`(阶段说明,varchar(500));迁移
  20260810202600_phase-schedule-model.sql(destructive,已 deploy)。
- **引擎**:`materialize.ts` 整体退役;`queue.ts` 的 `normalizePlan` 新增「已排期必须成前缀」
  的腐坏拒绝,新增 `scheduledIndex`/`isScheduled`;`edits.ts` 重写为三条位置规则
  (schedule-out-of-order / unschedule-not-from-tail / scheduled-phase-immutable),
  删掉 7 条与 offset/publication/terminal 有关的旧拒因;`timeline.ts` 的取值阶梯从五级
  收敛为两级(entered > planned > pending)。
- **服务与 API**:新增 `PUT .../phases/{phaseId}/schedule`(幂等子资源,null 即收回排期,
  同事务内先追认时钟再判位置);`putPhases` 收敛为纯结构写(不再接受任何时间),
  timeline 模板从「整体替换」改为「追加到末尾」;**未排期后缀允许增删改序**(此前 active
  批次一律 `phase-removed` 硬拒,是用户实测踩到的真 bug);激活不再校验时间。
- **前端**:整屏重写为顺序表,并按职责**拆成 5 个文件**——`PhaseTimelineEditor.tsx`(组合根:
  查询/变更/模式)、`phase/model.ts`(行草稿 + 计划三区域 `shapeOf`,单点判定谁能排期、
  谁能收回、谁的结构还能改)、`phase/PhaseRow.tsx`(一行)、`phase/PhaseDialogs.tsx`
  (排期/取消排期/说明/模板四个对话框)、`phase/PhaseActionsPanel.tsx`(开放操作 Sheet,
  权限两列)。浏览态是纯文本表格,「编辑阶段」后行内变输入;排期与「立即开始」合并进同一个
  对话框(立即开始仅在队首可选);计划开始列按状态给不同图标并附相对时间(如"22小时前")。
  i18n 清掉 120 个死键与 33 条孤儿译文。

**门禁(实际执行)**:typecheck 零错;`pnpm test` **446 全绿**;`pnpm test:browser` **29 全绿**
(阶段计划 8 例按新语义重写);`tools/tests` 142 全绿;`pnpm build` 通过;dev 实测截图
(浏览/编辑两态)控制台零 error。

**用户逐轮评审后的收尾**(同日):行高统一为 `h-16`(不再随说明/时间/状态跳动);编辑笔紧贴阶段名
右侧;首个待排期行的状态列补小字「可安排开始时间」(与下方「请先为上一阶段排期」同形);已排期与
未排期之间插一条居中细线提示「以下阶段尚未排期」;编辑态在行与行之间给零高度的接缝条,指针移上去
才浮出「在此添加阶段」——**显隐由 state 而非 `:hover` 决定**,因为插入一行后指针没动、CSS 的悬停态
会滞留;点击后同时 `blur()`,`focus-within` 才不会把它钉住。移动端卡片改三段式。

### 批次授权改为接受边界(2026-08-12,裁决 §32.45,docs/batch-redesign.md)

不做「批次角色」。角色与分配仍是租户层的通用 RBAC,批次只维护**自己接受过什么**。

- **RBAC 加通用资源范围**:`role_grants` 多了 `resource_namespace/type/id` 与
  `valid_from/valid_until/revoked_at`,一次分配可以限定在某个不透明对象上
  (`assessment / batch / <uuid>`)。RBAC 里没有一行 assessment 代码。**带资源范围的分配不参与
  任何通用判定**——`held` CTE 加了 `resource_id is null`,否则「某批次的临时审核员」会变成
  全租户审核员。端口新增 `listApplicableAssignments / getRolePermissions /
createScopedAssignment / revokeAssignment`。
- **Assessment 建三张表**:`batch_access_sources`(接受了哪条分配,inherited|explicit)、
  `batch_access_source_permissions`(接受时的权限上限)、`batch_access_denies`(**按人**,不按来源
  ——一个人同时是辅导员与年级负责人时,点一次「禁用审核」就该两条来源都禁用)。
- **有效权限** = `(分配现在仍携带 ∩ 批次接受过) − 批次 deny` ∪ 花名册赋予参评人的,
  再对 `PHASE_GATED` 的码 ∩ 当前阶段开放集。由此得到本轮的核心性质:
  **收权实时,扩权需确认**——撤角色/撤分配/撤权限立刻在所有批次生效;新增则必须在批次里
  显式「同步组织权限」(preview 分新增人员 / 新增权限 / 已失效三段)。
- **临时工作人员不是新概念**:就是一条限定在本批次的普通 RBAC 分配,创建时同事务接受进 baseline
  并快照上限——即使临时分配也过接受边界,否则日后有人给共享的审核员角色加了公示管理,
  这个人会突然获得。委派受限:只能授出自己在该节点持有的权限,只能在自己管得到的节点上授权,
  且角色携带的权限必须全部属于批次可委派集合,否则整条角色不可用。
- **物化时机整体提前到创建批次**(取代 §32.43 的「首次排期时冻结名单」):同一个事务里生成花名册
  与授权基线,失败则批次不存在;草稿期两者都可检查,改 scope 或人员类型则重新绘制;
  首次排期只校验与推进状态,「立即开始」不再顺手初始化任何东西。相关文案同步改写。
- **参评人不进 RBAC**:五百人乘五个权限就是两千五百行在重复同一件事;参评能力来自
  「在花名册里 + 人员类型」,同样受 PhaseGate 约束。

**门禁**:typecheck 零错;`pnpm test` 449(新增一条端到端用例钉死接受边界:创建时接受两项 →
租户撤一项立刻消失、加一项不自动进入 → 批次 deny 生效且同步后仍在 → 撤销分配后全部归零);
`pnpm test:browser` 35;build + smoke + drop-guard 全过。迁移 20260812182627_batch-access-baseline.sql
(含手写的两条唯一索引替换——生成器只比对索引名,不比对索引体)。

**未做**:批次内的「人员权限」页面(服务与 API 已就绪,`GET/POST .../access`、
`PUT .../access/{userId}/permissions/{permission}`、`DELETE .../access/sources/{sourceId}`、
`GET/POST .../access/sync` 均已冻结进 frozen-routes),下一轮落地。

### 测评首页与批次上下文栏(2026-08-12,分支 feat/ui-shell)

**上下文栏**:批次名与状态徽章**居中**,右侧一个 ▾ 打开切换菜单(按需加载最近几个批次,不为每页
预取一份列表);最右侧是**当前阶段 + 倒计时**——下一阶段已排期就倒数到它(`剩余 3 天` / `剩余 23 小时`
/ `剩余 1 分 59 秒`),没有后继就正数(`已进行 X`)。计时**只读本地时钟**,按当前单位决定刷新节奏
(天与小时每分钟、分与秒每秒),不是每秒一个请求。数字切换走新的 `@qualy/ui/ticker`:旧值模糊上移
离场、新值模糊下移进场(motion,约 0.22s),宽度由两值中较宽者撑住,邻近文字不抖。

**状态徽章**加了呼吸点:草稿灰、待开始琥珀、进行中翠绿且 `animate-ping`、已结束石板色;
`motion-reduce` 下不动。**只有进行中的批次会自己变**,所以只有它的点在动。

**测评首页**改为分组资源页:正在进行 / 即将开始 / 草稿 用卡片,**已结束用紧凑列表**(找到它、打开它
就够了);筛选改成 全部 / 进行中 / 草稿 / **已结束**(`archived` 是列里存的词,读者认的是"结束了")。
全页无 `·` 分隔符。

**卡片两列排布**(桌面 `sm:grid-cols-2`,容器回到 default 1150):一张占满窗口宽的卡片,是六个字后面
跟半米空白;并且**眼睛只会比较并排的东西**。每张卡片自上而下:批次名 + 状态徽章 / 三条带图标的事实
(材料时间窗、参评人数——草稿改说覆盖几个单位、第几阶段共几个)/ 一块着色面板(当前阶段与倒计时;
待开始说计划开始时刻;草稿说还没排阶段并给出下一步)/ **分段进度条**(一段一个阶段:已过灰、当前绿、
未来浅——六个阶段的名字在半宽卡片里只会被截断成噪音,形状比截断的名字说得更清楚,而当前阶段的全名
就在它上面)/ 右下角「进入测评 →」(草稿是「继续配置 →」),整卡可点、箭头随悬停右移。

列表 DTO 因此带上**精简时间线**(每阶段:名称 / ended|current|future / 进入或计划时刻),服务端一次
查完本页所有批次的阶段再按批次分组派生(两条语句,不是 N+1),与批次自己的时间线同一个 `deriveTimeline`。

### 壳分家:应用壳与工作区壳(2026-08-12,裁决 §32.44,分支 feat/ui-shell)

单一 `admin-shell/v1` 与那根常驻左侧栏退场。它把「产品有哪些应用」和「我正在做的这件事能做什么」
塞进了同一根栏——学生一路背着一根自己打不开任何页面的空侧栏。按停留时长分成两个契约:

- **`app-shell/v1`**:顶部一排应用 + 下面一行当前应用的分区(小字横排,多于一个才出现),无侧边栏。
- **`workspace-shell/v1`**:同一排应用 + 上下文栏(在操作哪个批次)+ 导航栏(能做什么),
  进入批次才出现。

两条新机制,都为了让壳继续不认识业务:workspace 导航条目的 path 带参数,由壳用当前路由 params 填充,
**填不出来就不渲染**;上下文栏是 slot,由知道什么是批次的插件贡献。导航解析从「只认
primaryNavigation」推广为认 `navigationCollections` 列出的每一个导航面。

- 契约与键改名 `admin-shell/*` → `app-shell/*`;新增 `workspace-shell/{navigation,context}`。
- URL 搬家:`/admin/{org,users,user-types,roles}` → `/organization/{tree,users,user-types,roles}`。
- 新增 `PageContainer`(default / wide / full),壳不再替页面定宽度;组织四页与批次页各自选档。
- 批次的返回、名称、状态与生命周期操作从页面搬进上下文栏——说一次,而不是每个分区顶部再说一遍。
- **未建的不建入口**:工作台、资源库、批次概览/公示管理/批次设置只写进 §23.1,等页面落地再贡献。

**观感收尾**(同日,用户实测「太空」后):`PageContainer` 三档改为 default `max-w-6xl`(约 1150)、
wide `max-w-[1440px]`——1600 太宽,四五列的表在里面散开;批次的两个分区回到 default。新增
`PageHeader`(标题 + 一句说明 + 动作),批次分区不再以自己的控件开场;阶段编辑器与名单面板里
重复的那行说明随之删掉。批次列表补上**当前阶段**列(服务端一条子查询取 `current_phase_id`
对应的阶段名——「这批到哪一步了」是看列表的第一个问题,一个 id 答不了),总数徽章移到标题旁边、
表底不再重复。顶栏的账号从侧边栏footer那张大卡片收成「头像 + 姓名」,其余信息进下拉。

**门禁**:typecheck 零错;`pnpm test` 448;`pnpm test:browser` **35**(新增 shell.browser.test.tsx
三例:应用与分区两层、应用 Tab 指向自己的第一页、工作区把 `:batchId` 填进导航条目且填不出的条目不渲染);
build + chunk 哨兵 + smoke 全过。

### 批次生命周期简化(2026-08-11,裁决 §32.43)

「激活批次」这个动作删除了——它承担的校验与冻结整体并入**首次排期**:给第一个阶段排期(或直接
「立即开始」)时,同一事务校验人员类型与计划、冻结名单、批次转 active。管理员从「先激活、再排期」
两步收敛成一句「我把这个批次安排在 9 月 1 日开始」。

- **产品语言里没有"激活"**:草稿 / 待开始 / 进行中 / 已归档。`active` 作为存储值保留,
  「待开始」是派生的(active 且无当前阶段),不占状态位。
- **可逆性边界**:取消首阶段排期(且从未实际进入任何阶段)= 回草稿并丢弃名单快照;
  任一阶段曾实际进入,永不回草稿;**删除只针对从未开始的草稿**,跑过的一律归档。
- **归档 = 为末阶段划下终点**(`[actual(last), archivedAt)`),所以要求末阶段**已实际进入**,
  不是"已排期"。
- **归档后是「重新开启」而不是「取消归档」**:后者会诱导实现成 `archived_at = null`,
  抹掉"批次曾关闭两周"这段事实。新建 `batch_lifecycle_events`(archived / reopened,
  append-only,reopened 的事由由数据库 check 强制非空);重新开启**在末尾追加新阶段**并立即开始,
  不复活旧阶段,也不使旧结果失效。
- API:`PUT .../status` 收敛为归档与重新开启两种载荷,新增 `DELETE /assessment/batches/{batchId}`;
  迁移 20260811124316_batch-lifecycle-events.sql(已 deploy)。
- 缓建并记档:`BatchArchiveGuard` / `BatchReopenGuard` 贡献点——Publication 与 Appeal 插件尚不存在,
  没有任何插件能贡献拒因,按数据层冻结规则不做预防性建设。

**门禁**:`pnpm test` 448 全绿(新增两条服务用例:首次排期即开跑/撤回即回草稿/删除边界、
重新开启追加新阶段并记事由);`pnpm test:browser` 32 全绿(新增三条:草稿可删且不再出现"激活"、
已排期未开始显示待开始、重新开启必须同时填事由与阶段名)。

### 导航收敛为四个二级入口(2026-08-11,裁决 §32.42)

左侧一级只有「综合测评」,二级四个:测评管理(批次管理 / 阶段模板 / 时间线模板)、填报管理、
审核工作台、我的测评(我的填报 / 结果公示 / 我的申诉),二级带图标、三级是纯链接;公示管理不进
左侧,它属于某个批次。**本次只建已有的那条**:测评管理 → 批次管理——其余入口不预留占位,
一条通向空页的链接比没有链接更糟,新页面落地时再各自贡献。

代码上只动了三处:导航契约本就支持嵌套组与图标(`parent` + `icon`),所以新增一个二级组
`assessment/manage`(图标 `clipboard-list`,布局的图标集补上这一个名字),批次管理页改挂到它下面。
完整的导航树、URL 表(含未建路径)、以及「什么进 URL / 什么不进」的原则,写进 docs/assessment-design.md §23,
裁决记在 §32.42。

### 批次的地址栏说清楚它在哪(2026-08-11)

`?batch=<id>` 退场,批次与它的分区都进 path:

```
/assessment/batches                              批次列表
/assessment/batches/:batchId                     → 重定向到 phases(replace)
/assessment/batches/:batchId/phases              阶段安排
/assessment/batches/:batchId/participants        参评人员
```

「阶段安排 / 参评人员」不再是 Tabs 的本地 state,而是**批次下的两个子页面**——外观仍是分段控件,
实现是两条 `PageLink`(`aria-current="page"` 标出当前项),刷新、复制链接、前进后退都自然工作。
批次名也成了真链接,可以中键新开标签页。

页面按此拆开:`BatchListPage.tsx`(列表)、`batch/BatchScreen.tsx`(批次的公共外壳:标题、状态、
批次级操作、分区导航、确认框)、`BatchPhasesPage.tsx` / `BatchParticipantsPage.tsx`(各自的分区)、
`BatchPage.tsx`(裸 id 的重定向)、`batch/StatusBadge.tsx`(列表与详情同一个状态徽章);
原 `BatchAdminPage.tsx`(482 行、两个屏幕挤在一起)删除。

**没有进 URL 的**:编辑模式、排期对话框、开放操作抽屉——它们是未提交的本地事务,刷新后草稿已经
不在,恢复一个 `editing=true` 没有意义。列表的搜索与筛选目前仍是本地 state,按同一条原则它们
将来更适合放 query,但这次不改。

每个分区各自挂载一次批次外壳,所以**外壳不再做入场动画**——否则每次切分区,标题与按钮都要淡入上移
一遍,宣告一个并没有发生的变化;只有分区内容 `Reveal key={section}` 淡入。批次详情查询给 30s
staleTime,切分区不再是一次往返(改动批次的操作本就显式失效这个 key,不等这个钟)。

测试侧:harness 新增 `routes` 选项(一次挂载多条真实路由),批次浏览器套件据此覆盖
「列表 → 阶段 → 参评人员 → 返回列表」的真实跳转。

### Dialog / AlertDialog 重做(2026-08-11)

按 shadcn base-nova 的结构重排(底层仍是 Radix,没有引入 @base-ui/react):`DialogContent` 改为
header / body / footer 三段竖向 flex,**只有新增的 `DialogBody` 滚动**,标题与按钮常驻;header
`px-6 pt-6 pb-4 pr-12`、footer `border-t bg-muted/30`,滚动边界正好落在分隔线上;标题降为
`text-base`,关闭按钮换成真正的 ghost 图标按钮;遮罩收到 `bg-black/40 backdrop-blur-[2px]`。
`ConfirmDialog` 新增 `tone="destructive"`(用于批次归档与放弃未保存修改)。消费者只有
`admin.tsx` 一处,插件页面零改动。

### TypeScript 7 换装(2026-08-11)

`pnpm typecheck` 从 **~34s 降到 ~9s**(root program 单独 9.5s → 2.4s),12 个 program 的类型判定
与 6.0.3 完全一致(逐个跑过比对)。三处代价与解法:①原生 tsc 不再导出编译器 API,组件引用检查器
改为「写断言文件进插件 client 目录 → 跑一次 tsc → 只读该文件的诊断 → finally 删除」;②Effect 语言
服务换成 `@effect/tsgo`(patch 原生二进制,`tsc --version` 显示 `7.0.2+effect-tsgo.0.36.4`,插件名
不变);③注释抑制语法变了——规则名**不带 `effect/` 前缀**且 `-next-line` 是字面下一行,旧写法静默
失效。新规则集在旧代码上抓到 1 个真 error(ui-registry 的负面类型断言)与 1 个真 warning(api-kit
的全局 Error 失败通道),两处都改成不需要抑制的写法;51 条 suggestion 经 `includeSuggestionsInTsc:
false` 挡在 tsc 输出之外。详见 docs/notes/tooling.md 与 docs/agents/effect-source-policy.md。

### 测试与类型检查提速(2026-08-11)

`pnpm test` **15.8s → 10.5s**,`pnpm test:browser` **14.2s → 12.5s**,`pnpm typecheck` **8.5s → 3.6s**(热)。
①测试改跑在 compose 新加的 `postgres-test`(5433,fsync/synchronous_commit/full_page_writes 全关、
tmpfs 无卷)上——一次运行建删约 150 个库,这些操作无论 synchronous_commit 怎么设都要刷盘,
实测只关 synchronous_commit 收益为零;不 fsync 的集群崩溃后可能起不来,所以开发库照旧持久化,
两者分开(testkit 认 `QUALY_TEST_DATABASE_URL`,缺了就退回 `DATABASE_URL`,只是慢一点);
CI 只有一个库且活不过一个 job,安装后 `alter system` 关掉即可。②tsc 全部带 `--incremental` 与各自的
buildinfo(node_modules/.cache),plugin-isolation 门禁 6.5s → 1.3s,并实测注入类型错误后热运行照报;
③六个门禁各自的仓库遍历合并进 tools/lib/walk.ts——诊断门禁的临时 fixture 与它们竞态,曾两次以
ENOENT 偶发红;④前端查询不再无条件重试三次(默认退避要 7 秒才肯说话,而每个区块本就有错误态与
重试按钮),只对连接层失败重试一次——最慢的一条浏览器用例 7.0s → 0.4s。
死路已记录在 docs/notes/tooling.md(create database 不是瓶颈、threads 池无差别、--no-isolate 不值、
浏览器侧 isolate/fileParallelism 都无效)。

**门禁(实际执行)**:`pnpm typecheck` 8.7s 零错;`pnpm test` 446/72 全绿;`pnpm test:browser`
29 全绿;`pnpm build` 通过;`tsx tools/quality/smoke-production.ts` 五探针全过、SIGTERM 退出 0;
`pnpm vendor:check` 两棵树匹配;`prettier --check .` 全仓干净。CI 无需改动:`pnpm install
--frozen-lockfile` 照旧跑根 `prepare` 打补丁,平台二进制 linux-x64/arm64 均已发布。

### 迁移生成器:改了体的索引(2026-08-12)

批次接受权限那一轮需要把 `role_grants` 的两条唯一索引换掉(加 `coalesce(resource_id, ...)`
与 `revoked_at is null`),而生成的迁移里没有它们,只能手写 SQL 补在文件末尾——这与「插件自由装配、
用户拿不到 migrations 目录」直接冲突:手写的那段只存在于这个仓库,别的装配再也生成不出来。

上游不是缺陷:`SchemaComparator.diffIndex` 对经 `expression` 逃生口声明的索引**只比名字**,
并写明原因(repos/mikro-orm/packages/sql/src/schema/SchemaComparator.ts:986)——没有任何东西能
靠读两段任意 SQL 判断它们是否等价,所以不打 patch。检查约束不在此列,`diffExpression` 是比体的。

我们比上游多一件东西:diff 的两侧都是**真实数据库**。声明的索引进过一次 Postgres,
`pg_get_indexdef` 读回来就是规范化形式,两段规范化定义相等当且仅当索引相同——不解析、不猜。
`diff.ts` 因此在结构语句之后补一趟:两侧同名而定义不同的索引,发 `drop index` 加数据库自己拼的
`CREATE INDEX`(约束背后的索引排除在外,那归约束比对)。这条对所有插件、所有装配一律生效。

那条迁移已删掉手写段重新生成(`20260811185310_batch-access-baseline.sql`,49 行、零注释,索引替换
由生成器自己给出且用的是 Postgres 的拼写),本地按新文件重放。回归测试在
`assembly.test.ts`「replaces an index whose definition changed under the same name」:同名换体应发出
drop+create、能应用、再 diff 为空;实测拿掉这趟补丁它立刻红(expected [] to have a length of 2)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **450/72 全绿**(clean-room-parity 8.6s、
assembly 15 项全过)。

### 批次人员权限页(2026-08-12)

`/assessment/batches/:batchId/access`,工作区侧栏第三项「人员权限」。服务端与 API 上一轮已就位,
本轮补上页面本身:

- **名单表**:人员、授权来自(角色 + 「组织授权」/「本轮临时」badge,底层分配被撤销的标「组织侧已撤销」)、
  本轮可做(chips)、已停用(带删除线的 chips,不是"少几个 chip"的沉默)。
- **同步提示**:扩权是提议,停在琥珀色面板里等人按「接受进本轮」;收权已经发生,同一面板里改用静音样式、
  没有按钮,文案直说「已经生效」。两半不长一个样,是这一页存在的理由。
- **逐项停用**:每人一个对话框,复选框是本轮持有 ∪ 已停用(组织侧已撤的项不出现,免得看起来像"曾经开过"),
  每格独立即时 PUT,没有保存按钮——幂等子资源本来就没有批次概念。
- **移出本轮**:只出现在 origin=explicit 的来源上,先问再做;继承来的授权归组织,拒绝它的手段是停用。

文案 en + zh-CN 齐全(zh 另写,不是英文直译);`@qualy/web-i18n` 补了 `common/action/close`
(改动已即时生效的面板,"取消"是假承诺)。权限标签由 STAFF_CODES 逐条列出并 `satisfies
Record<StaffCode, MessageDescriptor>`,新增 staff code 少一条标签就编译失败;`inCatalogOrder`
丢弃目录外的码,避免原始标识符落到屏幕上。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 450/72 全绿;`pnpm test:browser`
**38 全绿**(新增 3 例:停用一项只影响本轮、扩权等确认而收权已生效、只有本轮临时的人可移出且先问);
`pnpm build` 通过。

**未做**:添加临时工作人员的选人器。`POST .../access` 需要 (userId, roleId, orgNodeId),而页面不得
持有 iam 域读权限去调 `/iam/user-options`、`/iam/role-grant-options`——按 API 纪律,选项要由本页
权限可及的端点提供,所以要先加一条 assessment 自己的 options 端点(候选人 = 覆盖单位内可管的人,
候选角色 = 权限全在 STAFF_CODES 内且调用方在该节点持有),含 frozen-routes 更新与服务端测试。

### 人员权限页第二轮:合并变更、自我保护、通用人员卡片(2026-08-12)

**文案改口径。** 界面小字改成引导,不再解释实现。批次页、阶段页、名单页、人员权限页的长句一并收短
(例:「每个人在本轮能做什么,是本轮接受授权的那一刻定下来的……」→「管理批次参与者的权限,或与组织侧
权限进行同步。」),术语统一到「批次」。纪律已写进 CLAUDE.md 的 UI 节:小字是给用户的引导,不是实现说明、
不是领域复述、不是自夸;要两三句才说得清,说明这一屏的信息结构做错了。

**同步变更改成分页 + 逐项勾选。** `GET .../access/sync` 从「三段全量列表」改成 keyset 分页的单一变更行
(`{id, kind, userId, displayName, businessNo, roleName, permissions}` + `pendingTotal` / `lapsedTotal`),
`POST .../access/sync` 收 `{accept: [{kind, id, permissions}]}`——服务端在事务里重算一遍并与之求交,
选择只能收窄、不能凭空造出变更。页面上只留一行提示 + 「查看变更」,列表在对话框里翻页,默认全不勾,
勾了才合并;撤销的那一类不给复选框(已经生效,批准已发生的事是谎)。路径未变,frozen-routes 不动。

**不能改自己。** `setAccessDeny` 与 `removeStaff` 对 `subject === caller` 直接 422
(`self-adjustment`);`listAccess` 逐行下发 `manageable`,自己那一行不渲染任何按钮——能撤销自己权限的
管理员可以把自己锁在负责的批次外,而且没人能撤销。

**调整对话框改成一次决定。** 取消勾选不再立即提交;按「保存」才把差集逐条 PUT 上去。选择器按阶段编辑
同样的三族(填报/审核/结果)分组、两列、带一行说明。

**通用人员卡片(由 iam 提供)。** 新 slot token `iam/person-card`(@qualy/ui-contract),auth 以
`permissionOf('auth.user.read')` 贡献实现;`UiSlot` 新增 `fallback`,没人贡献(插件没装,或读者无权)
时退回纯姓名,不留洞。卡片 hover 才发请求(一页一百个名字不能是一百个请求),浮层给身份类型与所在单位,
「查看详情」开模态框:学工号、状态、自上而下的单位路径、担任的角色(角色来自新的 rbac 端口方法
`listUserRoles`,只列在效的授权)。`GET /iam/users/{userId}` 顺势带上 `orgPath` 与 `roles`,不新增路由。
测评的人员权限表与参评名单表都改用它。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 450/72 全绿;`pnpm test:browser` **39 全绿**
(新增:自己那一行没有按钮、只合并勾选项、保存才提交);`pnpm build` 通过;`prettier --check .` 干净。

**未做**:添加临时工作人员的选人器(仍缺一条 assessment 自己的 options 端点);`listAccess` 尚未分页
(与变更列表不同,它只含担任角色的人,量级是几百;真要分页需要把 readAccess 的整表计算改成 SQL 分页)。

### 批次对普通用户开放,以及几处不该下发的数据(2026-08-12)

**谁看得见哪些批次。** 原来整个测评模块都锁在 `assessment.batch.manage` 后面,学生连自己参加的那一轮
都进不去。现在:批次列表页与批次总览页对 `AUTHENTICATED` 开放,列表内容按人裁——管理员看到自己权限
够得着的全部(含草稿),其他人只看到**自己确实参与的**(在花名册里,或被接受为工作人员)且**非草稿**的批次
(草稿是管理员还在写的计划,里面的人还没被告知)。判定下推进 SQL(`visibleTo` = 管理可达 ∪ 参与),
`getBatch` 与 `getTimeline` 共用同一条规则——`getTimeline` 此前**没有任何授权**,知道 id 就能读,已修。
阶段安排/参评名单/人员权限三个子页仍是 `permissionOf('assessment.batch.manage')`,manifest 不下发,
侧栏里就不会出现。批次行带 `manageable`,前端据此不渲染用不了的控件。

**新增批次总览页**(`/assessment/batches/:batchId`,`AUTHENTICATED`),侧栏第一项「总览」,内容暂为占位;
原来这个地址是重定向到阶段安排的,普通用户会被弹回。列表卡片与批次切换器现在都落到总览页。

**不再下发的数据。** ①`scope-options` 不再返回 ltree `path`,改成 `parentId`——path 是数据库自己的
子树加速地址,给了浏览器等于把组织结构与命名公开给任何能看到一片叶子的人;`tree-selection.ts` 整体
改用父引用(roots = 父不在集合里的节点,深度由树算),测试同步改写。②花名册变动里的 `from/to.path`
直接删掉(前端本来就只显示姓名)。③批次 DTO 不再带 `scopeNodeIds`——配置意图,且点名了读者可能无权
知道的组织节点;卡片相应不再显示「覆盖 N 个单位」。

**删掉 anchorAutoSync。** 全仓只有写、没有读:它承诺「花名册跟着组织自动走」,而领域定案是花名册
永不自动移动(组织变动只作为待处理建议列出),两者直接矛盾。列、API、配置修订 diff 一并移除,
迁移 `20260811200227_drop-anchor-auto-sync.sql`(destructive: approved);原来只断言它能存取的测试
改成断言「一次配置变更 = 一条事件 + 计数器 +1」。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **451/72 全绿**(新增「参与者只看得到自己那一轮、
看不到草稿、按 id 也读不到别人的」);`pnpm test:browser` 39 全绿;`pnpm build` 通过;
`prettier --check .` 干净。

### 花名册成为唯一事实,参评范围整体删除(2026-08-12)

批次不再持有「参评范围」。组织节点 + 人员类型只是**创建/导入那一次的查询条件**,查完即成为历史记录;
谁参加这一轮,只有花名册说了算。这样一次删掉的不是一张表,是「规则与物化结果必须保持一致」这整类问题——
改范围要不要动名单、删节点要不要踢人、转专业要不要从历史批次消失、手工加的人下次同步会不会被删,
这些问题现在都不成立了。

- **表**:`batch_scope_nodes` / `batch_user_types` 删除;新增 `roster_imports`(节点 id、类型 id、导入人数、
  操作人、时间),它是**审计事实,不参与任何判定**。`batch_participants` 增加 `included_by` /
  `excluded_by` / `exclusion_reason`——移出保留成员历史,不物理删除。
- **两条入口一条实现**:`insertParticipants(userIds)`。从组织导入 = 先把节点+类型解析成 userIds 再走同一条路,
  所以插入路径不知道「单位」是什么。导入前算候选人数并要求确认,提交时**再算一次**——用户确认的那个数
  在他读到时是真的,而决定的是第二次。
- **管理权限的锚点改为花名册**:批次不再挂在节点上,「能管这一轮」= 能管这一轮里的每一个人
  (`batch_participants.anchor_path` 与授权范围求交)。空名单回落到「持有该权限」,否则草稿作者自己都打不开。
  强制切阶段的权限校验同样改用花名册锚点。
- **删掉的东西**:`getRosterDiff` 及四类漂移检测、`applyParticipantAnchor`(重新冻结快照)、
  `includeParticipant`、`BatchScopeLocked` 错误、`updateBatch` 的 scope/userTypes 字段。批次 DTO 不再有
  `userTypeIds`。`ASSESSMENT_BATCH_NO_USER_TYPES` 改名 `ASSESSMENT_BATCH_NO_PARTICIPANTS`:开跑的前提
  从「配置了人员类型」变成「名单里有人」。
- **权限同步收窄**:范围没了,「组织侧现在还提供谁」就没有基准,所以 `previewAccessSync` 的
  **newSources 一并取消**,只剩已接受授权的权限增加(等确认)与撤销(已生效)。新工作人员一律显式添加——
  与花名册那侧完全对称:没有隐式范围,就没有隐式新人。
- **路由**:新增 `GET .../import-candidates`、`GET/POST .../participant-imports`;
  `POST .../participants` 改收 `{userIds}`;删除 `GET .../roster-diff` 与 `PUT .../participants/{id}/anchor`。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **449/72 全绿**(花名册套件按新模型重写:导入只发生一次、
按姓名添加会跳过已在名单的人、移出保留记录);`pnpm test:browser` 39 全绿;`pnpm build` 通过;
`prettier --check .` 干净。迁移 `20260811205602_roster-is-the-population.sql`(destructive: approved)。

**下一步(未做)**:iam 的两个公共选人组件——①选人器(树/列表双模式、姓名与学工号搜索、按用户类型与
组织类型筛选、仅本层/含子树、分页、右侧已选清单),②从组织批量导入(选节点 + 类型,预算人数后确认)。
目前参评名单的「从组织导入」是 assessment 内的临时实现(复用 TreeSelect + 类型多选 + 人数确认),
待公共组件落地后替换;「添加人员」与「添加工作人员」两处选人入口也等这两个组件。

### iam 公共选人组件,以及一轮授权/脱敏复查(2026-08-12)

**两个公共组件由 iam 提供,经 slot 下发**(token 在 @qualy/ui-contract,可见性
`permissionOf('auth.user.read')`——无权的人拿到的是 fallback,不是一个能点开的空壳):

- `iam/people-picker`:左侧组织树,右侧该节点下的人员分页列表(姓名/学工号搜索、按用户类型筛选、
  仅本层/含下级切换),选中的是**人**(userId),已选清单支持逐个移除,跨页已选计数单独标出。
- `iam/people-import-picker`:选一个或多个节点 + 人员类型,只负责"选什么",导入会做什么由调用方说
  (参评名单在页脚显示"将新增 N 人",数为 0 时按钮不可用)。
- `OrgTree` 单独拆出来:它只回答"我在看哪里",不选人也不选节点语义——将来组织架构页可以直接用。

参评名单接入:「添加人员」走选人器,「从组织导入」走导入器(assessment 里那个临时对话框已删)。

**授权与脱敏复查(逐条,三处有实际改动)**:

1. **真洞:导入越权。** `previewImport` / `importParticipants` 原来只校验"在所选节点上持有
   `assessment.batch.manage`",然后按 ltree 取整棵子树。可授权可以是 `self` 覆盖——在学院上持 self 的人
   请求学院,会把底下所有班级的人一并扫进来。现已把调用方的授权范围**下推进同一条 SQL**
   (`scopeCoverage(held, n)`),预览与执行共用,数与结果必然一致。回归测试:grade 上持 self 的协调员
   预览 grade,候选数 0。
2. **祖先链披露。** 人员卡片的"所在单位"原来给出从根到本节点的完整链,包含读者无权浏览的上级名称。
   现按读者的 read 范围裁剪。
3. **导入历史回传节点 id。** 与上一轮"scopeNodeIds 是机密数据"的裁决冲突,改为服务端解析成**名称**,
   且只解析读者够得着的;够不着的直接不出现。

顺带修的:`/iam/user-options` 的节点补 `parentId`(仍不给 path;父节点不在读者可达集合里时置 null,
读者看到的树从他的权限边界开始);`/iam/users` 加 `userTypeId` 过滤,并把它并入 keyset cursor 的
fingerprint——不同筛选条件之间沿用游标会静默跳行或重复;`roster_imports` 的 jsonb 写入补 `::jsonb`
强制转换(否则驱动把文本原样存成 json 字符串,读回来是字符串而不是数组,实测报 uuid 语法错)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **450/72 全绿**;`pnpm test:browser` 39 全绿
(导入用例改为经真实 slot 装配渲染 iam 的导入器);`pnpm build` 通过;`prettier --check .` 干净。

**未做**:添加工作人员的选人入口——它除了选人还要选角色与节点,角色目录归 rbac,需要一条
「这个人在这个节点上我能授予哪些角色」的 options 端点(`/iam/role-grant-options` 已有,但那要求调用方
持有 iam 读权限,不能直接给测评页用)。组织架构管理页尚未改用这几个组件。

### 添加工作人员:三个答案,顺序互相约束(2026-08-12)

人员权限页补上「添加工作人员」:选人(选人器,单选)→ 选负责单位 → 选角色。角色放最后,因为能给什么
取决于前两个;而且**由服务端算,不在前端拼**——`GET .../staff-options` 返回:

- `nodes`:本批次花名册的锚点单位 ∩ 调用方可管的,已解析成名称(不回传 id 以外的结构信息);
- `roles`:仅当同时给出 userId 与 orgNodeId 时才算,且经两道过滤——① rbac 端口新增
  `listGrantableRoles`,它复用 `/iam/role-grant-options` 背后那段逻辑,**逐个角色跑一遍写入时的全部检查**
  (eligibility、可管理该角色、提权不超过自身权威),所以列表不可能承诺写入会拒绝的东西;
  ② 角色携带的权限必须全在 `STAFF_CODES` 内——带 `assessment.batch.manage` 的角色不出现在列表里,
  因为批次不能把「决定谁能管这个批次」的权限发出去。

另外:请求的单位必须是本批次自己的锚点之一,否则返回空——否则「为批次添加工作人员」会变成在租户
任意节点上发授权的入口。

服务端测试覆盖三点:只列出本批次覆盖的单位、带批次管理权的角色不出现、指定批次外的单位得到空列表。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **451/72 全绿**;`pnpm test:browser` 39 全绿;
`pnpm build` 通过;`prettier --check .` 干净。

**未做**:添加工作人员对话框还没有浏览器用例(参评名单的导入已有);组织架构管理页尚未改用
`OrgTree` / 选人器。

### 可任命的单位是一条链,不是一个锚点(2026-08-12)

`staff-options` 原来把可选单位定成花名册的**锚点本身**,实测只返回一个班——这是设计错误:锚点之上的
专业 / 年级 / 学院同样覆盖这批人,按原样根本任命不了学院级审核员,花名册横跨三个班还得把同一个人
添加三次。改为**锚点及其全部祖先 ∩ 调用方可管的范围**,按层级排序(学院 → 年级 → 专业 → 班)。
向上取是安全的:这里创建的授权由 `batchResource(batchId)` 限定在本批次内,在学院上授权不会外溢。

同时补上一个真缺口:「必须是本批次覆盖的单位」这条约束原来**只在 options 端点**,写入端 `addStaff`
不查——UI 不给这个选项,但 API 直接收。现在写入端用同一个 `batchUnits` 复查,不符即
`node-out-of-batch`(422)。测试同时断言列表给出整条链、批次外的单位列表为空、以及写入被拒。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 451/72 全绿;`pnpm test:browser` 39 全绿。

### 添加工作人员改三步,以及一个让按钮消失的 bug(2026-08-12)

**先说 bug**:参评人员页看不到「添加人员 / 从组织导入」两个按钮,原因是 `getBatch` 调 `oneBatch` 时
没传 viewer,而 `manageable` 是在 SQL 里按 viewer 算的——没有 viewer 就恒为 false,于是所有按 manageable
渲染的控件全部静默消失。已修:详情按读者查询;凡是过了管理守卫才返回详情的路径直接置 true。

**三步式添加工作人员**:选人 → 选单位 → 选角色。分三步是因为答案互相约束——能给什么角色取决于给谁、
在哪,三个一起问就会先显示一份错的角色列表。已答过的步骤可以点回去。

- 单位那步用新的 `iam/org-node-picker`(slot):调用方可以把候选节点传进去(本批次覆盖的那条链),
  传了就只显示这些,没传就显示读者可管的整棵树。组织架构页将来可以直接用。
- 角色那步是新的 `RolePicker`:**不可授予的角色也会列出来,置灰并说明原因**——「该用户类型不能设置此角色」
  「你无权授予此角色」「此角色的权限超出批次范围」「该角色已不可用」。为此把 rbac 的 `grants.options`
  从「过滤掉」改成「保留并带 refusal」(`user-type` / `authority` / `unavailable`),assessment 再补一条
  自己的 `beyond-batch`。原来那个 iam 授权页保持旧行为(在 handler 里过滤),所以对它无感。
  理由:一份更短的列表只是在对读者看不见的对象说「不行」,而原因通常是他能去改的。

顺带:选人/导入/合并/调整几个对话框都放宽了一档(4xl / 2xl / 3xl / 2xl);`StatusBadge.tsx` 里
`standingOf` 拆到 `batch/standing.ts`——组件文件同时导出非组件会让 Fast Refresh 整个失效(vite 已经在
控制台警告),而一个悄悄不更新的组件比一条警告难查得多。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 451/72 全绿;`pnpm test:browser` 39 全绿;
`pnpm build` 通过;`prettier --check .` 干净。

### 组织节点选择器重做(2026-08-12)

三个问题,都是我的:

1. **一选中整棵树就折叠回顶部。** 节点列表和选中值共用同一个 query key,选一下就重新请求,`data` 变
   undefined,树整棵卸载重建,展开态随之丢失。改法不是记住展开态,是把问题拿掉:单位列表单独一次查询
   (问题里不含选中值),角色另一次查询(依赖人和单位)。
2. **选中之后取不掉。** 单选 + 没有 toggle。现在**统一多选**——无论分配角色还是导入参评,人和节点都是集合。
3. **不如原来新建批次那个。** 因为原来那个是 `@qualy/ui` 的 `TreeSelect`:子树覆盖语义、勾父吸收子、
   取消一个班保留兄弟班,而且这套算术在 `tree-selection.ts` 里有测试。现在选择器直接建在它上面,
   而不是我另写一棵树。

在此之上补齐:**每个节点带类型 Badge**(`/iam/user-options` 新增 `orgTypes`),**按名称搜索**,
**按类型筛选**——搜索或筛选时切换为平铺列表,因为过滤后的树大半是通往结果的枝干,而「学院里所有的班」
本来就是一份名单不是一个形状。已选节点在下方以可移除的 chip 列出。`TreeSelect` 加了可选的 `meta`
渲染位(行尾放 Badge),选择算术未动。

**`addStaff` 改成收集合**:`{userIds, orgNodeIds, roleId}`,在一个事务里建全部组合。一人两班与两人一班
是同一件事;逐对提交则是一串写入,中途被打断留下的缺口在已写入的记录旁边是看不见的。授权检查按节点
逐个先做完再落笔。

`PeopleImportPicker` 的节点半边改为直接复用这个选择器,不再自己画树。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 451/72 全绿;`pnpm test:browser` 39 全绿
(导入用例新增:类型 Badge 与类型筛选都在、勾上能取消再勾上);`pnpm build` 通过;`prettier --check .` 干净。

### 参评人的操作不是 RBAC 权限(2026-08-12)

裁决见 docs/assessment-design.md §32.46。既不给用户类型加权限表,也不动租户管理员角色——病因不在缺一层,而在
`assessment.entry.create/edit/submit/withdraw` 与 `result.view-self` 本来就不该是 RBAC 权限:它们挂在目录里,
角色编辑器就列出来、`setRolePermissions` 就允许勾、租户管理员按 `permission_mode='all-active'` 定义还自动持有,
而 `authorizeEntryAction` 对这五个码根本不查角色,只查花名册。同一个码 RBAC 说「可以授予」,业务层不认这种来源。

改动很小:五个码离开 `permissions` 数组,改名 `PARTICIPANT_ACTION_CODES`。角色编辑器因此自然不再列出(它只渲染
`listPermissions()` 的目录),服务端 `setRolePermissions` 自然拒绝——不是前端藏起来而 API 还能偷偷给。
`PHASE_GATED_CODES` 原样保留并横跨两类:阶段开关表达「此刻开放哪些操作」,与资格来源正交,而且它只能开关
一个主体本来就有资格做的动作,不能凭空赋权。启动断言相应改成三条:STAFF_CODES 必须在目录里、
PARTICIPANT_ACTION_CODES 必须**不在**目录里、PHASE_GATED 必须落在两者之并内。

拒因分层跟着改名:`ActionDecision.layer` 的 `'rbac'` → `'authority'`;参评人不在名单返回 `not-participant`,
工作人员无权仍是 `permission-not-held`。把花名册失败伪装成 RBAC 拒绝,会让读它的人去找一条永远不存在的授权。

**数据残留必须清**,不是脏数据那么简单:`permission_mode='all-active'` 的租户管理员按定义持有目录里的每一条,
留着就等于它仍在授权。迁移 `20260811225407_drop-participant-action-permissions.sql`(custom,owner 标注,
destructive: approved)先删 `role_permissions` 的引用行再删 `permissions` 本体;升级测试建旧库形态、给角色勾上
`entry.submit`、跑迁移、断言角色只剩该留的那条且目录里的码已消失。开发库实测:assessment 目录剩 10 条,
`entry.%` 的授权行只剩审核员的 `entry.resubmit`(它仍是 staff 权限,本该留)。seed 门禁的权限计数 31 → 26。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **452/72 全绿**(新增迁移升级用例);`pnpm test:browser`
39 全绿;`pnpm build` 通过;`prettier --check .` 干净。

### 六处修补(2026-08-12)

**manifest 不再下发空导航分组。** 分组自己的可见性只回答「这个读者能不能看到这个分区」,不回答「这里面还剩
什么」,所以一个页面都看不到的学生仍被告知「组织与权限」存在。现在投影完成后再筛一遍:没有任何条目归属的
分组直接丢掉,归属链上的父分组随子分组一起保留。分组名本身也是泄露——读者由此得知自己被挡在哪些门外。
门禁在 effect-manifest.test:有权者拿到该分区,无权者页面与分区一并消失。

**/timeline 不再回传 phaseKey。** `stage-7` 是计划给某一行起的内部把手,对读时间线的人没有意义;前端没有
任何地方用它,而一个没人用的字段迟早会有人开始依赖。

**PersonCell 与 PersonCard 去重。** 重复的其实是「指上去看更多」这件事:`PersonCell` 传 children 时会长出
自己的 HoverCard,而 iam 的 `PersonCard` 又做了一遍——后者还知道谁有权看到什么。现在 `PersonCell` 收回成
纯粹的画法(头像、姓名、副标题),交互层归 iam。

**PersonCard 的布局闪动。** 根因不是渲染慢,是 slot 的 `loading` 是 null:契约组件的 chunk 在飞的时候那格
什么都不画,等它到了再把整行挤开。现在 `UiSlot` 加载期间渲染 `fallback`——而 fallback 正是同一个人的朴素
画法,所以替换是看不见的。

**组织节点选择器**:①加载骨架 + 固定高度,不再从空盒子长成一棵树;②类型筛选换成 shadcn `Select`;
③`OrgNodePickerContext` 新增 `loading`,因为「空列表」和「还没到」长得一样,而由调用方传节点时只有它知道
自己还在取。至于「树只显示一条链」:那是**添加工作人员**第二步,节点由批次提供,而这个批次的花名册只有一名
成员在软件2023级1班,所以链就是 学校→学院→年级→专业→班。导入对话框不传节点,拿到的是完整的树。

**两张表分页。** 参评名单的接口本来就是 keyset 分页,只是前端没用;人员权限的接口原来一次返回全部——
现在按**人**分页(`accessSubjectPage`,按姓名+id 的 keyset),因为按 source 截断会把一个人切成两半、
只显示他两个角色中的一个。两处 UI 都是走过的翻页写法:游标发下来就记住,回上一页用的是手里已有的那个。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **453/72 全绿**;`pnpm test:browser` 39 全绿;
`pnpm build` 通过;`prettier --check .` 干净。

### 选人类对话框定高(2026-08-12)

三个装着选择器的对话框(从组织导入、添加人员、添加工作人员)的 body 给了 `min-h-[58vh]`,里面的组织树与
人员列表改成 `h-[42vh] / h-[34vh]` 配一个 `min-h`。这不只是"高一点好看":原来盒子的高度跟着内容走,
树到达、搜索无结果、翻页各会改一次高度,对话框就跟着上下跳。空态与骨架也一并占满同样的高度,
所以"没有匹配的人员"不会把对话框压扁。选人器的人员类型筛选顺手也换成了 shadcn `Select`。

**门禁(实际执行)**:`pnpm test` 453/72 全绿;`pnpm test:browser` 39 全绿;`prettier --check .` 干净。

### 选择器的三处手感(2026-08-12)

**类型 Badge 不再右对齐**。名字后面紧挨着就是它的类型,而不是被推到行的另一端——一个标记离它标记的东西
越远越难读。做法是名字不再 `flex-1`,改由一个空的 `flex-1` 撑满行宽。

**树的整行可点**。原来行是 `[chevron][名字按钮]` 并排,缩进属于外层容器,于是节点越深,名字前面那条
"看起来能按、其实按不动"的空白就越宽。改成整行一个按钮、缩进算进按钮自己的 padding,chevron 绝对定位
浮在它左边缘上——两个独立的点击区,没有按钮套按钮。

**人员选择器填满对话框**。原来高度由查到的人数决定,搜到三个人对话框就缩一次。现在对话框 body 是
纵向 flex,选择器 `flex-1 min-h-0`,左右两栏各自 `flex flex-col`,树与人员列表 `flex-1` 内部滚动;
空态与骨架同样撑满,所以"没有匹配的人员"不会把它压扁。`AsyncSection` 为此新增可选 `className`,
且**三个分支(骨架/错误/内容)都要带上**——只给其中一个,加载完成的一瞬间高度就会跳。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 453/72 全绿;`pnpm test:browser` 39 全绿;
`pnpm build` 通过;`prettier --check .` 干净。

### 六处:加载态、反馈、名单语义(2026-08-12)

**选择器加载时闪现「无权浏览」**:上一轮把 slot 的 loading 直接设成了 fallback,而这些对话框的 fallback 正是
「当前账号无法浏览人员」——于是有权的人在 chunk 到达前先被告知自己无权。`UiSlot` 现在把两者分开:
`fallback` 是「没人贡献」,`loading` 是「正在来」,默认相等(人员卡片的 fallback 就是同一个人的朴素画法,
所以那里默认是对的),选择器类对话框显式传骨架。

**人员权限页学工号闪一下就消失**:`PersonCard` 加载后用 `businessNo ?? undefined`,没有学工号就不画第二行,
而它的 fallback 用的是「未绑定学工号」。两处画法不一致,行高就跳。现在卡片与朴素画法说同一句话。

**引入 sonner**(@qualy/ui 新增 `./toast`,`Toaster` 挂在 RuntimeProvider 根部,一次挂载全站可用;
组件本身零文案,措辞各插件自备)。导入、添加、移出、重新加入、合并变更、调整权限、添加/移出工作人员——
七处写入都给了成功提示。理由很直接:这些写入改的是页面别处的列表,不说一声,读者只能拿列表和记忆比对。

**移出与重新加入的语义**(裁决见 §32.47)。移出只把成员状态转 `excluded` 并记录人与理由,数据一律保留;
**重新加入恢复同一行**——原实现只跳过 active 的人,重新加入会撞上 `(tenant,batch,user)` 唯一索引直接失败,
这是个真 bug,现在走 `on conflict do update where status <> 'active'` 并刷新锚点快照。「重新开始填报」
暂不实现,因为它的正确语义是作废封存而非删除,且要按数据成熟度分级——条目表(M3)还不存在,现在建等于
为一张不存在的表建仓库;落地时的不变量已写进设计文档。移出前的确认框明说保留什么。

**从组织导入:人员类型全选**(全选/清空同一个按钮,全选后只剩「都不要」这一个愿望)。

**参评名单页左侧组织树筛选**:复用 `iam/org-node-picker`,选中的单位就是名单被收窄到的范围。
服务端 `listParticipants` 新增 `orgNodeIds`,按**冻结的锚点**而非此刻所在过滤(名单说的是这一轮接纳了谁、
从哪里接纳),并把它并入 keyset cursor 的 fingerprint。

**树的竖线不再半途而废**:最后一个展开分支的引导线现在延伸到容器底部(每级最后一行 `flex-1`,根 `ul`
`min-h-full`),而不是在最后一个子节点处收住、底下留一条白。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **454/72 全绿**(新增「重新加入恢复同一行」);
`pnpm test:browser` 39 全绿。

### 名单页的组织树改成单选筛选器(2026-08-12)

名字到第五层就只剩省略号,因为每一级都要摊掉缩进 + 展开钮 + 复选框。而这个位置本来就不需要多选——它是
筛选器,不是购物车。于是 `OrgNodePickerContext` 增加 `single`(不画复选框、点整行选中、再点取消)与
`scope`/`onScopeChange`(仅本层 / 含下级),名单页用这一组;导入与添加工作人员仍是多选。左栏顺带从 16rem
放宽到 22rem。服务端 `listParticipants` 相应增加 `orgScope`,`self` 比对冻结的锚点本身、`subtree` 比对
`anchor_path <@`,并把它并入 cursor 的 fingerprint。

顺带修两处:①**添加工作人员里按节点类型筛选永远是「没有匹配的单位」**——`batchUnits` 没有回传 `orgTypeId`,
而类型下拉却因为 react-query 缓存(同一个 `getUserOptions` key 被别的选择器取过)照常渲染,于是任何类型都
匹配不到;现在批次单位也带上自己的类型。②竖线不再延伸到容器底部(用户看过实际效果后否决),改回随分组结束。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **455/72 全绿**(新增单位筛选的三态断言);
`pnpm test:browser` 39 全绿;`pnpm build` 通过;`prettier --check .` 干净。

### 倒计时改成两个单位,只有变的那个字模糊(2026-08-12)

**两个单位**:1 天 3 小时 / 3 小时 35 分 / 3 分 13 秒 / 13 秒,较小的那个为零时整个丢掉(「3 小时」不写成
「3 小时 0 分」)。`spanOf` 从「最大的那一个单位」改为「最大的两个」,`Elapsed.rest` 取代原来的
minutes/seconds 对。刷新频率不变:天与小时下面挂的是小时与分,都不会比一分钟更快变。

**只有变化的字符模糊**。原来 `Ticker` 以整串为 key,39 秒变 38 秒时整行一起 blur——而实际只有一个数字变了,
让它旁边的字也糊一下,等于说那些字也发生了什么。现在按**位置**拆分,每个位置一个 AnimatePresence、以字符
为 key,于是只有真正换掉的那一位有东西可换,其余纹丝不动;正因为周围不动,那一位才读得清。退场时
`position: absolute`,不然旧字符还占着宽度,整行会先撑开再缩回去。

浏览器用例覆盖两条:一天多读作「天 + 小时」而不下探到分;整三小时只说「3 小时」。用例特意取 3 小时零
30 秒——正好三小时的话,组件读时钟时已经是 2 小时 59 分了。

**筛选栏与移动端**:选择器的搜索独占一行,「仅本层/含下级」与类型下拉共用第二行——三个挤一行时最后一个
总被顶到第二行。名单页左侧的树在手机上默认折叠(`useIsMobile`),标题行本身就是展开钮;桌面上展开且
不可点。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 455/72 全绿;`pnpm test:browser` **41 全绿**;
`pnpm build` 通过;`prettier --check .` 干净。

### 选组织单位就 400,以及一条假门禁(2026-08-12)

**400 的真因不是游标,是「一个值不是数组」。** 上游 `UrlParams.toRecord`
(repos/effect/packages/effect/src/unstable/http/UrlParams.ts) 只在参数**重复出现**时才给数组,出现一次给的是
字符串;而 schema 写的是 `Schema.Array(id)`,于是「只选一个单位」这种最常见的请求整个被拒,前端拿到的是
一个没有任何可操作信息的 400。改成 `idList = Schema.Union([Schema.Array(id), id])`,handler 侧统一用
`listed()` 归一。`import-candidates` 的两个数组参数同病同治。

**顺手拆掉一条假门禁。** 我先写的是 HTTP 用例(打真实 URL 断言不是 400),写完把 schema 改回坏的一跑——
**照样绿**:鉴权在解码 query 之前就短路了,这条用例什么也没证明。换成直接对 `idList` 解码的契约测试:
一个值、多个值都过,不是 id 的仍然拒。教训记在这里:一条不会因为 bug 变红的测试,比没有测试更糟。

顺带修的:①换筛选条件时用 effect 重置分页,effect 比渲染晚一步,第一次请求仍带着旧游标——现在游标栈把
「它属于哪个问题」一起存着,问题变了当场作废(名单页与选人器同治);②`AsyncSection` 的错误态从靠左的红条
改成基于 `Empty` 的居中块(图标 + 一句话 + 重试);③组织树折叠的断点从壳的 768 改成本页真正分两列的 1024,
768–1024 之间原来树是展开的而布局还是一列,把用户列表挤到了第二屏;④树太深时横向滚动而不是把名字截成
一串省略号;⑤左栏收窄到 18rem 并吸顶填满剩余视口高度。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **458/73 全绿**(新增三条 query 解码用例);
`pnpm test:browser` 41 全绿;`pnpm build` 通过;`prettier --check .` 干净。

### 确认框用上它本来就有的样式(2026-08-12)

`alert-dialog.tsx` 早就是 base-nova 的形态——`size`、`AlertDialogMedia`、以媒体位为轴的 grid header、
移动端反向堆叠的 footer 全都在;没用上它们的是 `ConfirmDialog`,它只塞了标题和一句话,于是渲染成
「一段话 + 两个按钮」,自然不如人家好看。现在补上媒体位:破坏性动作是红底三角警告,普通确认是问号,
标题与正文因此落在图标右侧(小屏则居中于图标下方)。所有确认框都走这一个组件,所以改一处即可。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 458/73 全绿;`pnpm test:browser` 41 全绿;
`prettier --check .` 干净。

### 确认框:结构照抄,尺度用自己的(2026-08-12)

先按上游渲染出来的 DOM 抄了一版(padded card + footer 用负 margin 顶回边缘、hairline ring、h-8 按钮、
`max-w-sm`),用户看过实物后否决:那套间距是配它自己那套字号的,搬过来偏挤。现在**结构保留、尺度回到本仓库
自己的**——header `px-6 pt-6 pb-5`、footer `border-t bg-muted/30 px-6 py-4`(与隔壁 Dialog 的 footer 同一套,
两者是兄弟)、按钮回到默认尺寸、宽度 `sm:max-w-md`。基本款不放图标(与参照一致),破坏性只体现在按钮颜色上;
`AlertDialogMedia` 保留给需要它的调用方。

**关闭动画期间标题里的姓名消失**:调用方在点下确认的那一刻就把「正在移出谁」清成 null,而对话框还要淡出
一段时间,于是句子中间的名字先没了,变成「将 移出本批次?」。`ConfirmDialog` 现在记住最后一次拿到的文案,
关闭期间继续显示它——调用方照旧可以在用完的那一刻清自己的状态。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 458/73 全绿;`pnpm test:browser` 41 全绿;
`pnpm build` 通过;`prettier --check .` 干净。

### 侧边栏的开关归侧边栏(2026-08-12)

上下文栏最左边原来挤着两个东西:收起侧边栏与返回批次列表,而那个位置只放得下一个。现在**开关归它开关的
那样东西**:按钮移进侧边栏顶部、居左;上下文栏那一格只留给返回。

收起后不是消失,而是**留一条窄条**(w-13,恰好容下按钮),按钮就还在原地——否则「关掉侧边栏」这个动作会
把自己的把手一起关掉,再打开就得回到顶部去找。手机上侧边栏是抽屉,没有自己的边可摸,所以那里仍由上下文
栏提供开关。

动画一开始是错的:我在容器改宽度的同时**换掉了里面的内容**,于是动画作用在了错的东西上——收起时按钮被
拉成全宽,展开时导航文字先以一个字一行的形态出现再回流。改法是内容始终保持同一个宽度(w-56)、由外层的
列去收窄并裁掉,里面一点都不动;条目只做透明度过渡,不产生任何回流。收起时它们还带上 `inert` 与
`aria-hidden`——看不见的链接如果键盘还能走进去、读屏还会念,那只是视觉上的隐藏。

门禁用例断言的正是这条:收起后条目不可达、开关仍在原处、再点回来。写第一版时它红了但原因不是实现——
断言在 manifest 到达之前就数按钮,一个也没数到;先 await 一条真实的导航项再数才是对的。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 458/73 全绿;`pnpm test:browser` **42 全绿**;
`pnpm build` 通过;`prettier --check .` 干净。

### 批次分区的页头变成一条 banner(2026-08-12)

`PageHeader` 增加 `variant="banner"`:带边框、自上而下的浅色渐变、`px-5 py-4`。批次的四个分区(总览 /
阶段安排 / 参评名单 / 人员权限)改用它。理由不是「填空白」——一个光秃秃的标题压在表格上,读起来像页面
还没加载完;banner 给了分区一条上边缘,下面的内容也就有了起点。actions 位早就在 `PageHeader` 上,
将来某个分区想把主操作提到页头,不用再改结构。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 458/73 全绿;`pnpm test:browser` 42 全绿;
`pnpm build` 通过;`prettier --check .` 干净。

### M1 收口:六处授权/生命周期缺口(2026-08-13)

外部源码审计逐条提出,全部采纳并修掉,裁决写入 docs/assessment-design.md §32.52,M1 的交付与验收段
同步改写成当前模型(旧稿仍写着「花名册 diff」「三种时间形态」这些已被 §32.34/§32.45 取代的措辞)。

**四条按真实授权漏洞处理**:①`participantByUser` 只返回 active 成员关系(被移出的人此前在阶段开放
`entry.*` 时仍被权威层放行,与「移出即失去资格、数据保留」直接冲突);②`createScopedAssignment` 执行
与普通授权一致的结构性不变量(active/assignable/用户类型/节点类型/角色 kind),此前绕开 UI 直接调
`addStaff` 可以把「只允许老师」的角色给学生、把「只允许班级」的角色挂到年级;③归档关闭闸门并清空
current phase 投影,重开若排在未来则在新阶段真正进入前无任何阶段生效(重开保留归档前所有阶段的 actual,
单看计划会算出旧阶段,故按 `lastArchivedAt` 与阶段生效时刻比较判定);④批次可见性拆成管理/工作/参评三
条路径——管理路径先要求确有权威(空花名册此前对任何登录用户恒真),工作路径 join `role_grants` 复核授权
仍然有效,参评路径要求批次已真正进入某个阶段。

**两条 P1 同轮清掉**:⑤草稿期的花名册可管理(创建即建名单是 §32.45 的意思,guard 却还停在旧模型,
导致导入 0 人的草稿除了删除没有出路);⑥`batch_participant_events` 落表记 included/excluded/readmitted,
并把「恢复」收敛到唯一的接纳路径(与添加人员同样刷新锚点快照)。另有 `entry.resubmit` 按 §32.14 从
RBAC 目录移入参评人动作,`deriveTimeline` 认得「已归档」不再把末阶段标成 current。

回归测试五组全部落在 `effect-assessment.test.ts`:被移出者五个动作全在权威层拒且恢复后回来、成员历史三态
留痕;三种非法角色委派全拒;归档后即使末阶段开着 create 也拒、重开待命期间仍拒;空花名册对无权限者不可见、
撤职后失去可见性;草稿期可从 0 人补到可启动。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **465/73 全绿**(新增 5 组敌意用例);
`pnpm test:browser` 48 全绿;`pnpm build` 通过;`pnpm qualy resolve --frozen-lockfile` 零写入;
`prettier --check .` 干净。迁移新增 `20260812164252_participant-membership-events.sql`。

**未纳入本轮**:`authorizeEntryAction` 的资源策略仍是空槽(M1 允许,还没有 Entry);M2 第一件事是接上
归属、Entry 状态与工作人员组织范围——`entry.record/proxy` 必须校验目标参评人的冻结锚点落在提供该权限的
分配范围内。

### M1 收口第二轮:管理边界与语义状态(2026-08-13)

第二次源码审计的五条全部修掉,裁决写入 docs/assessment-design.md §32.53。

**P0 是跨组织接管**:上一轮只堵住「零权限的陌生人看得到空批次」,而 `withinReach` 与 `requireRosterReach`
在花名册为空时都退化成「在任意地方持有 `assessment.batch.manage`」,于是 B 学院管理员可以拿走 A 学院的空
草稿并往里加人。修法是给批次一条自己的**管理边界** `batch_management_anchors`(创建时从初始组织选择冻结),
授权要求同时覆盖锚点与当前花名册;花名册仍是参与者的唯一真相,不恢复 participant scope。迁移带回填(从
`roster_imports` 最早一条的 org_node_ids,跳过已删除节点)。

**语义状态统一**:新增 `effectivePhaseIndex` 返回「当前阶段序号或 null」,gate / 时间线 / 可见性共用一份;
`deriveTimeline` 第三参数由 boolean 改为 `number | null`(上一轮把下周才开始的新阶段也标成了 ended);
参评人可见性改按时钟判定,不再读 `current_phase_id` 投影(到点而扫描器未跑的窗口里会出现「动作已开放但批次
不可见」的分裂);归档不再等于不可见——归档是停止工作,不是收回「你参加过」。

**另外三条**:`entry.resubmit` 的升级迁移补齐(它比其他参评动作晚一版离开目录,旧库里 permissions /
role_permissions / 批次天花板 / deny 四处都会残留),带升级测试;`isStaff` 改为复用与 BatchAuthority
相同的算术(接受 ∩ 角色当前携带 − deny,角色须 active),此前角色被摘光权限的人仍能读批次;
scoped assignment 整段收进 grants 的 `scoped()`,与普通授权共用「先锁租户再检查再写」的临界区。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **470/73 全绿**(新增 4 组回归 + 1 组升级测试);
`pnpm test:browser` 48 全绿;`pnpm build` 通过;`pnpm qualy resolve --frozen-lockfile` 零写入;
`prettier --check .` 干净。新增迁移两条:`20260812175917_batch-management-anchors.sql`(含回填)与
`20260812183000_drop-resubmit-permission.sql`。

### M1.1:接纳的唯一路径与两处一致性(2026-08-13)

第三份审计的五条:其中「空花名册退化成任意位置持有 MANAGE」「staff 可见性按当前有效权限」「参评人可见性按时钟而非投影」
三条已由上一轮(§32.53)修掉并有回归测试;本轮补的是其余两条与四项非阻断项,裁决写入 §32.54。

**P0 是恢复成员绕过范围校验**:`addParticipants` 一直读当前站位并校验 `canAt`,而 `setParticipantStatus(active)`
直接走 `insertParticipants`,后者会按 `users.primary_org_node_id` 刷新冻结锚点——A 班管理员因此可以把已转去
B 班的学生按 B 班锚点重新接纳。现在接纳只有一条路径 `admit()`,添加与恢复共用;并把授权过的位置写进 SQL
(`join unnest((user_id, node_id))`),人若在检查与写入之间被移走,那一行根本不会落库,check-then-use 窗口一并关掉。

**列表与详情的时间线统一**:`listBatches` 现在与详情页共用 `effectiveIndexOf`(整页多取一次 `lastArchivedFor`),
`deriveTimeline` 第三参数改为 `number | null | undefined`。修掉两处矛盾:重开待命的批次在列表里旧阶段仍是 current;
草稿的计划阶段被标成 ended。

**另外三项**:参评人游标指纹补上 `orgScope`(subtree 的游标可被 self 查询继续用,会漏行/重复);
`setBatchStatus` 与 `addStaff` 的时刻改走 `parseInstant`,两个端点补 `BadRequest`;删掉指向已删表的
`inScope()` 与 `batch_user_types` 约束翻译。

**未采纳**:为 `current_phase_id` 等补「两端同批次」的复合外键——按 CLAUDE.md 数据层冻结规则,新增机制需由已发生
的事故触发,跨批次引用从未发生且写入路径唯一。已记入触发表,M2 的 Entry/Revision 出现第二条写入路径时按此加固。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **472/73 全绿**(新增恢复越权、列表/详情一致性两组,
staff 可见性补 deny-all 分支);`pnpm test:browser` 48 全绿;`pnpm build` 通过;
`pnpm qualy resolve --frozen-lockfile` 零写入;`pnpm qualy generate` 无待生成;`prettier --check .` 干净。

### M1.1 收尾:边界、fail closed、跨插件外键、投影(2026-08-13)

第四份审计五条:其中「roster 写入 TOCTOU」上一轮已由「把授权过的位置写进 INSERT 语句」关闭;其余四条本轮修完,
裁决 §32.55。

- **回填只取最早一次导入**:`roster_imports` 不只在创建时写,原回填把后续补导的单位也算进了边界。新增前向迁移
  按 `distinct on (batch_id) order by occurred_at` 重建,配升级测试(A→B 两次导入,升级后只剩 A)。
- **没有边界就 fail closed**:既无锚点又无在册的人时,只对租户级权威开放(scoped 管理员一律拒绝),可见性 SQL
  同步加存在性条件。回填会跳过已删除节点,所以这个状态真实存在,修复入口只能是租户管理员。
- **删除组织节点对任何插件的外键都答 409**:只在 `deleteNode` 一处把 23001/23503 泛化为 `ORG_NODE_IN_USE`
  (实测 RESTRICT 报 23001),判定读整棵 cause 树;org 不需要知道上层插件的约束名。测试在 org 套件里现建一张
  上层表引用节点。
- **状态不再读投影**:`readDetail` 与 `listBatches` 下发派生出来的当前阶段,`current_phase_id` 列只做投影、
  永不出服务端——否则扫描器未跑的窗口里,授权说"已开始"而列表说"待开始"。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **475/73 全绿**;`pnpm test:browser` 48 全绿;
`pnpm build` 通过;`pnpm qualy resolve --frozen-lockfile` 零写入;`pnpm qualy generate` 无待生成;
`prettier --check .` 干净。

### 两条低优先边界:资格与历史读取分家,日期校验(2026-08-13)

- **`excluded` = 失去资格,不等于失去自己的历史**(裁决 §32.56)。可见性按「有没有成员关系行」判定,资格按
  `status='active'` 判定:被移出的人仍能打开那一轮读自己当时的东西,任何写动作在权威层被拒。这条现在定下,
  M2 写 Entry ACL 时只需再加「这条 Entry 是不是他的」。
- **`isoDate` 校验真实日期**:`2026-02-31` 此前一路走到 postgres 变成 500,现在在契约边界返回 400;闰年一并
  管住。契约测试直接解码 schema(HTTP 用例会先被鉴权挡下,说明不了 schema 的事)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **478/73 全绿**;`pnpm test:browser` 48 全绿;
`pnpm build` 通过;`prettier --check .` 干净。

### M2 对话 1:Storage 基座,拆成能力拥有者 + 两个 provider(2026-08-13)

M2 第一段。开工时按 v3 文档把 Local/COS 都放进 `@qualy/plugin-storage`,随后裁决改成三个包——理由不是「多拆几个
包」,而是职责确实不同:「什么叫附件」是 Qualy 的概念,「附件现在放在腾讯云」是部署决策。形态与仓库既有的
`Login.driver` 一致(auth 定义扩展点,auth-local 贡献驱动)。设计文档 §4 / §5.5 / §5.19 已同笔改写。

- **`@qualy/plugin-storage`(能力拥有者)**:两张表 `storage_upload_reservations` / `storage_attachments`
  (不对 tenants/users 建外键,保持 `storage → database` 单向);`prepareUpload / completeUpload / metadata /
bind / open / retire`;额度;GC;backend 注册表。它不认识 COS,也不认识文件系统。
- **`storage-local` / `storage-cos`(provider)**:各自 `Storage.backend({ code })` 声明 + 在自己的 layer 里
  注册实现。**可以同时装多个,但同一时刻只有一个默认写入 backend**:新附件写 `defaultBackend`,历史附件按
  `attachments.backend` 回到写它的那个 provider——否则把默认从 local 换成 cos 会让此前所有附件打不开。
- **声明与实现在启动屏障对齐**:声明了却没注册、默认 backend 没安装,都是启动硬失败,而不是第一个上传的人
  才发现。
- **不可变从第一个字节起**:key 在 prepare 就定死(`attachments/{tenantId}/{attachmentId}`),COS 靠
  `x-cos-forbid-overwrite`,Local 靠 `link()`(不是 rename——rename 会静默覆盖)。没有 promote,没有 incoming。
- **上传者说什么都不算数**:size 与指纹一律来自 backend 的 stat/HEAD;客户端多传了就 `failed` + 删对象。
- **额度算的是「持票」而不是「占盘」**:一张票还没上传就已经吃掉 reserved bytes 与在途张数,
  tenant → owner 顺序的 `pg_advisory_xact_lock` 串行化准入。十并发抢三份额度的测试实测只放行三份。
- **GC 三段式**:短事务 CAS claim → commit → 网络 delete → 短事务 finalize。持 DB 行锁调对象存储是被明确
  禁止的;delete 失败则保留 claim 与额度,下一轮重试。abandoned 只在凭据失效 + grace 之后动手。
- **浏览器不认识 COS**:`prepareUpload` 返回 `{ driver, payload }`,页面只调 `upload(ticket, file)`,
  `cos-js-sdk-v5` 只存在于 storage-cos 的浏览器半边。
- **Storage 的失败暂不是 wire error**:没有 HTTP 边界服务它们,所以是普通 tagged Error,不进全局码表、不写
  翻译;附件 API 接入时由暴露端点的插件登记(否则 core storage 要为几句文案依赖 ui-registry)。
- 顺带修了两条门禁:`test-layers` 现在认 testkit **目录**(共享契约用例是 testkit 的一部分),`effect-api`
  套件补上 storage 的两个 config 服务。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **520 passed / 10 skipped(79 文件)**,其中 storage
33 例(service 7 + quota 8 + cleanup 9 + registry 9)、storage-local 11 例(含 7 条共享契约);
`QUALY_TEST_COS=1` 对真实开发桶 **10/10 全绿**(含「凭据只认自己那一个 key」「超出 content-length 被拒」
「签名 URL 带 attachment disposition 且能取回字节」);`pnpm test:browser` 48 全绿;`pnpm build` 通过;
`pnpm qualy resolve --frozen-lockfile` 零写入;`pnpm qualy generate` 无待生成;`prettier --check .` 干净;
生产 smoke 走真实装配全绿(探针/壳/manifest/哈希资源/SIGTERM 退出 0)。

**补测:整条链路对真实桶跑通**(同日追加)。上面那轮里服务层用的是内存 backend,COS 只单独测了 backend
四件事,两半没一起跑过。新增 `upload.integration.test.ts`(同样 `QUALY_TEST_COS=1` opt-in,另加真实 PG):
`prepareUpload` → STS 临时凭据 → 用该凭据 PUT 真实字节 → `completeUpload` 读 HEAD 得到 crc64 与长度 →
`storage_attachments` 行 → `open` 签名 URL 取回同一份字节 → `bind`;第二条断言同一张票的凭据再写一次被桶拒绝。
2/2 通过,连同 backend 套件 10/10。首跑曾因去 ap-beijing 的 TLS 被重置失败一次,签名 URL 的那次 fetch 现在重试
三次——跨洲的连接被掐不是这份代码的事实。

**仍未验证**:浏览器那一条腿。上传用的是 node SDK 拿同一份临时凭据,`cos-js-sdk-v5` 没有在真实浏览器里跑过,
开发桶的 CORS(§5.18:PUT/GET/HEAD + 实际 origin)也还没配。这两件事随第一个上传表单一起验。

**下一步**:对话 2(Assessment M2 数据骨架 + item registry)。两处留给它之前先想清楚的:Local 的 raw PUT
route(归 storage-local,需要和 reservation 凭据一起设计)、provider client driver 进浏览器包的聚合方式。

### 对话 1 收口:六处不变量,一处是真漏洞(2026-08-13)

外部审计对 Storage 基座提了六条,逐条对着源码核过都成立,本轮全部修完。每条都先写一个**会失败**的测试,
再改代码——七个新用例在旧行为下确实全红,改完全绿(实测,不是断言的形状好看)。

- **STS 凭据可以把附件设成公开读(P0)**。原 policy 只限定了 key、大小、禁覆盖,但 `PutObject` 允许请求
  自带 `x-cos-acl`。攻击者根本不必用我们的 upload helper:拿着 STS 自己发一个合法 PUT 加上
  `x-cos-acl: public-read`,一份私密证明材料在第一次写入时就公开了。现在 policy 补
  `string_equal_if_exist { cos:x-cos-acl: private }` 与四条独立的 `deny string_like cos:x-cos-grant-*`;
  browser driver 也显式发 `x-cos-acl: private`。两处细节是实测定的:`if_exist` 而非 `string_equal`
  (否则不带 acl 头的正常上传被拒),四条 deny 拆开写(同一 condition 块里多个键是与关系,合并只会在
  「四个头都带」时触发)。新增 hostile 套件,站在攻击者一侧、完全不用 upload helper:公开读 403、
  四个 grant 头各 403、写别的 key 403、超长 403、不带禁覆盖头 403、拿写凭据去 get/delete/list 403,
  而正常 private 写入 200。**注意**:用户此前已按同一口径配好 CAM 父策略,所以实测的 403 无法区分是
  STS 还是 CAM 拦下的——两层都要,仓库能保证的是自己这层。
- **owner 的 staged/stored 额度可被超卖(P1)**。原判断只算已存在的字节,没算已签发未完成的 reservation:
  240 已 staged + 两张各 10 MiB 的票都能过 250 的线,complete 后是 260。改为
  `staged/stored + reserved + new`(tenant 那条本来就算了 reserved,所以没这个洞)。
- **claim 租约过期不等于旧 worker 停了(P1)**。原来 `bind`/`complete` 把超过 5 分钟的 claim 当作无人认领
  就放行,于是「租约刚过 → 用户 bind → 旧 worker 迟到的 DELETE 成功」= DB 说 bound、对象不存在。现在业务
  transition 遇到 `cleanup_claimed_at IS NOT NULL` 一律拒绝,**租约只用来决定另一个 sweeper 能不能接手**。
- **oversized 分支在对象删掉前就把额度还了(P1)**。原来置 failed + 尝试删除,删除失败只记日志——而 sweeper
  只扫 issued,那个对象从此没人负责。现在保持 issued 直接拒绝,交给正常的 abandoned sweep:先删对象,
  再释放额度。
- **`bind` 对已 bound 的附件不查 owner(P1)**。幂等分支排在 owner 检查前面,于是任何人对别人已绑定的附件
  调一次 bind 都得到成功。owner 检查提到最前:幂等是给 owner 重试用的,不是给所有人用的。
- **`retire` 允许 staged → retired 并伪造 `bound_at`(P2)**。retire 是关于历史的话,staged 没有历史;
  现在只接受 `bound → retired`,staged 答 `not-bound`,归 TTL sweep。

设计文档 §5.7 / §5.9 / §5.11 / §5.13 / §5.14 / §5.20 同笔改写,把这六条写成规则而不是修复记录。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **537 passed / 17 skipped**;
`QUALY_TEST_COS=1` 对真实开发桶 **17/17**(backend 8 + hostile 7 + 端到端 2);`pnpm test:browser` 48;
`pnpm build`、`pnpm qualy resolve --frozen-lockfile`(零写入)、`pnpm qualy generate`(无待生成)、
`prettier --check .`、生产 smoke 全绿。

上一条 CI 红的 browser 用例(`identity.browser.test.tsx`「保存」按钮数)已在 `ca2f2ac` 修掉:站位面板等的是
第二个查询,断言用的 `.elements()` 不重试。给那个 stub 加 400ms 延迟可以在本地稳定复现同样的报错,加上
等待后带延迟也全绿。

### M2 对话 2:题目、条目与审核的持久层 + 两个注册表(2026-08-13)

按 m2-design §18 对话 2 的边界:只有 schema 与 prepare 相注册表,**没有任何业务 API**。

- **八张表一次定终形**:`score_groups`(cap/floor `numeric(12,4)`,树形自引用——M2 API 层拒绝嵌套,
  DB 不把"单层"焊死)、`assessment_items`(轻量身份 + `current_revision_id` 投影,void 三件套由 check
  绑定:voided ⇔ 有时间、有人、有理由)、`assessment_item_revisions`(不可变,`(item, revision_no)` 唯一)、
  `entries`(status/source 枚举 check,source 永远服务端推导)、`entry_revisions`(不可变,actor 与
  subject 分列)、`entry_revision_attachments`(关系表,复合主键 + position 唯一)、`review_instances`
  (m2-design §11.1 的核心列集:round_no/origin/initiator/effective_chain/mode/state/outcome +
  `uuid[]` 角色快照 + ltree 路径)、`review_events`(append-only)。
- **批次边界由数据库自己持有**:entry→item、entry→participant、item→score_group、score_group→parent
  全部携带 `(tenant_id, batch_id)` 复合键;entry→current_revision、entry→current_review_instance、
  item→current_revision、review_instance→revision 携带父 id("必须属于同一 entry/item")。
  跨批次、跨条目、跨题目的引用一律 23503,不再是 service 层的承诺。为此给 `batch_participants` 补了
  `(tenant_id, batch_id, id)` 唯一索引。
- **一个 entry 只有一轮开着**:`uq_review_instances_open_entry` 部分唯一索引
  (`where state in ('active','blocked')`),双击 submit 与并发 submit 都死在 23505;完成一轮后
  开新轮照常。谓词按 introspection 回读形态拼写,理由记进了 m2-design §18 落地记录。
- **附件引用是真外键**:`entry_revision_attachments → storage_attachments (tenant_id, id)` RESTRICT
  ——被不可变 revision 引用的附件行删不掉(实测 23001),这就是「bound」在数据库里的形状。
  assessment 的 Db.entities 与描述器 dependsOn 补 `@qualy/plugin-storage`。
- **两个 prepare 相注册表**(`@qualy/plugin-assessment/plugin` 子路径):`ItemTypes.driver/provider`
  (driver = configSchema + decodePayload + attachmentRefs + interaction + scoring refs;同 id 双注册
  编译期硬失败)与 `Scoring.driver/provider`(tagged calculator/aggregator,ref 强制 `name@version`,
  同 kind 同 ref 双注册硬失败,跨 kind 同名允许)。core 自身贡献 `fixed@1`(config 只收 decimal string,
  JSON float 被 schema 拒绝)与 `sum@1`(零配置)——纯声明骨架,算术归对话 6。
- 迁移 `20260813090200_assessment-items-entries-review.sql`;生成期踩了一个真实坑:对已有表
  (batch_participants)新增的索引被排在文件尾部,而新表的外键在前面引用它——lineage 重放即失败,
  已把该索引移到文件头(未提交迁移,可改)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **556 passed / 17 skipped(84 文件)**,其中
新增 m2-schema 12 例(跨批次/跨条目/跨题目引用、双开轮、revision_no 唯一、附件外键、check 形状、
跨租户)+ registries 7 例(目录编译、重复拒绝、ref 格式、decimal string);`pnpm test:browser` 48;
`pnpm build`、`pnpm qualy resolve --frozen-lockfile`(零写入)、`pnpm qualy generate`(无待生成)、
`prettier --check .`、生产 smoke 全绿。storage 的 cleanup 套件因新外键把 truncate 改成 cascade。

**下一步**:对话 3(`@qualy/plugin-assessment-evidence` + item/score-group API + M2 review policy
validator)。对话 5 写 review 事件时用 kebab-case(`submitted` 等,裁决见 m2-design §18 落地记录)。

### 对话 2 收口:一条真裂缝与五处约束补紧(2026-08-13)

外部审计六条,逐条对着实体核过全部成立,本轮修完。上一条 STATUS 里「跨批次引用一律 23503」当时说满了:
EntryRevision 的 item_revision 恰好是没被绑住的那条边。

- **EntryRevision 可以引用别的题、甚至别的批次的配置(阻塞项)**。两条外键各自成立
  (revision→entry、revision→item_revision),合起来却没说「这份配置属于这个 entry 的题」——
  于是 `Entry.itemId = 题A,payload 按题B 的表单解码`是合法数据,历史解码、review policy、
  计分全被污染。修法沿用本轮的复合键策略而不是 service if:`entry_revisions` 增列 `item_id`,
  两条键合抱——`(tenant, entry_id, item_id) → entries (tenant, id, item_id)` 钉住「item 是这个
  entry 的 item」,`(tenant, item_id, item_revision_id) → assessment_item_revisions
(tenant, item_id, id)` 钉住「revision 是那个 item 的 revision」。三条敌意用例:谎报 item、
  实报 item 引别题 revision、跨批次 revision,全部 23503。
- **void shape 的 `false = false` 通道**:等式形式下,active 行带着残留 voided_at 会让两边同假而通过;
  空白 reason 也过。改成真二选一(active 三件全空 / voided 三件全有且 `btrim(reason) <> ''`),
  换名 `chk_assessment_items_void_state_shape`。
- **completed 却没有 outcome 是合法数据**:原来只有单向蕴含。合并成一条
  `chk_review_instances_lifecycle_shape`:开着的轮两者皆空,completed 两者皆有。outcome 词表
  仍不冻结(归审核状态机落地时)。
- **floor > cap**:aggregator 会有两个都说得通的答案,加 `floor <= cap`(NULL 放过,负值仍合法
  ——扣分组是真需求)。
- **driver id 声明期校验**:`ItemTypes.driver` 现在按 `item_type` 列同一条正则拒绝
  (`Evidence`/`foo/bar`/`foo..bar` 装配期即死),与 `Scoring.driver` 的 `name@version` 校验同型。
- **注册点改名**:`@qualy/plugin-assessment/calculators` → `.../scoring-drivers`(它装的是两类)。

修正迁移 `20260813090300_bind-entry-revisions-to-their-item.sql`(fix-forward,不回改已提交迁移;
entry_revisions 尚无任何写路径,加 NOT NULL 列无回填问题)。过程中实测出 MikroORM 生成器两个坑,
已记 docs/notes/mikro-orm.md:①改 CHECK 表达式不进迁移(comparator 检出但写出器不渲染,要改就换
约束名);②对已有表 add CHECK 时 IN 列表被写成残缺的 `ARRAY[...][]`(非法 SQL,clean-room parity
抓到)——lifecycle 检查因此拼成 `state <> 'completed'`(值域由另一条 IN 检查兜住)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **559 passed / 17 skipped(84 文件)**,
其中 item-entry-schema 14 例(+2 敌意解码、4 处新 check 拒绝)、registries 8 例(+driver id 格式);
`pnpm test:browser` 48;`pnpm build`、`pnpm qualy resolve --frozen-lockfile`(零写入)、
`pnpm qualy generate`(无待生成)、`prettier --check .`、生产 smoke 全绿;dev 库已 deploy。

审计中「暂不修」四条照单:actor/subject 不加 users 外键(历史不钉活人)、附件 owner/status/跨 entry
复用归 ResourcePolicy 与 bind 事务、parent_group 不焊死单层、current_* 保持 nullable。

**补一条同类边(第二轮反查)**:`phase_item_scopes.item_id` 一直是裸 uuid("等 items 表出现再补外键"
的那条注释欠的账)。现在 items 表在了:补 `(tenant_id, item_id) → assessment_items` **CASCADE**
(只有零业务事实的 draft 题可硬删,阶段对它的 allowance 应随之消失;active 题走 void 不经过这里);
service 与 participant allowance 同一口径加同批次校验(`item-not-in-batch`,进 refusal 词表与双语
catalog)。修正迁移 `20260813090400`(先清没有对应 item 的历史悬挂行再加键——这张表在 items 表出现
之前就可写,不能假设无旧数据)。原来把"随机 UUID 进 itemScope 且成功"当正常行为断言的测试改为
插真实题;敌意用例三条:不存在的 id 拒、同租户他批次真实题拒、本批次题过;DB 级两条:悬挂 23503、
draft 题删除连带 allowance。`pnpm test` 560 passed / 17 skipped,全门禁绿,dev 库已 deploy。

### M2 对话 3:题目配置、evidence 驱动与保存关卡(2026-08-13)

按 §18 对话 3 的边界:item/score-group API + ItemRevision append + review policy validator +
configRevision 事件 + evidence 驱动 + 两个 fixture;**不做 Entry write**。

- **保存关卡(§6.3)整条落地**:锁批次 → 驱动已装 → formConfig 过驱动 schema → scoring 引用已装且
  config 过各自 schema → review policy 形状 → **对 {in_review, approved} 条目的 current revision 用新
  配置实测解码** → append revision N+1 → currentRevisionId 前移 → active 批次 config_revision++ +
  事件(draft 零仪式)。全部问题一次列完(`ASSESSMENT_ITEM_CONFIG_INVALID.issues[]`),不是发现第一个
  就停。兼容试算已有真测试:直接 SQL 造一条 in_review 条目,收紧表单被拒且**点名该条目**;把它改成
  draft 后同一保存通过(draft 经新表单重入,新配置不欠它)。
- **policy validator(§6.4)**:只认「单 roleAt stage + quorum any + normalTerminal 0」;stages≠1、
  nearestRole、all/atLeast、terminal≠0、未知键逐个点名拒绝。**administrative 题的 policy 必须是空对象**
  ——trusted 路径没有链,存一条没人走的链是配置说谎(此裁决记入 §18 落地记录)。
- **item/score-group API 六端点**(frozen-routes 同笔):`GET/POST /assessment/batches/{id}/items`、
  `GET/PATCH /assessment/items/{id}`、`GET/PUT /assessment/batches/{id}/score-groups`。组树 PUT 是
  整表替换(flat by construction——payload 里没有 parent 字段,M2 单层由形状保证而不是靠拒绝);
  结构化拒绝 `group-has-items` / `group-not-found` / `floor-above-cap`。三个新错误码进全局码表与双语
  catalog。授权沿用 requireRosterReach(管理)与批次可见性(读);跨租户答 NOT_FOUND 不是 FORBIDDEN。
- **`@qualy/plugin-assessment-evidence`**:首个 item-type 驱动,经 `ItemTypes.driver` 上车。字段 DSL
  只做 text / date / attachment(§7.2 M2 集);date 合法域 = materialRange ∩ 字段 min/max,**range 端
  半开、字段 max 闭**的差异有专门用例(9-01 出、8-31 进);attachment 查 count/uuid/去重;
  `attachmentRefs` 从 payload 提取引用(带 accept),对历史 payload 读而不判。
- **两个 fixture 走真实验证路径**:退役复学 +3(student,单附件必传 maxCount=1,fixed@1 "3.00",
  单级链)与行政扣分 -1(administrative,依据文号必填,fixed@1 "-1.00",空 policy)——经
  `validateItemConfig` + 真驱动 + 真内置 refs 全绿。demo seed 不建批次,故 fixture 落在测试而非 seed
  (seed 版随对话 8 的 UI 一起做才有东西可看)。
- Assessment service 现在依赖两个 prepare 目录(layer 类型显式加 ItemTypeCatalog | ScoringCatalog),
  三个既有 harness 补 `catalogLayers`(测试自带一个极简驱动,evidence 真驱动只在 fixture 测试里进目录
  ——core 对 evidence 是 devDep,循环与 auth↔auth-local 同型)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **582 passed / 17 skipped(88 文件)**——新增
item-config 7(关卡/拒绝/兼容试算/事件/组替换/授权)+ policy 5 + evidence driver 6 + fixtures 3;
api-parity 与 OpenAPI 深比较随全量跑绿;`pnpm test:browser` 48;`pnpm build`、
`pnpm qualy resolve --frozen-lockfile`(零写入)、`pnpm qualy generate`(无待生成——本对话零迁移,
schema 是对话 2 的)、`prettier --check .`、生产 smoke 全绿。

**下一步**:对话 4(Entry + ResourcePolicy,M2 安全核心;hostile tests 先于 UI)。

### 对话 3 收口:一条对权威文档的违规裁决,加七处配置不变量(2026-08-13)

外部审计八条全部核实成立,其中第一条是我在对话 3 犯的真错误:把「administrative 题 review_policy
必须为空」写成了 validator 规则,而 assessment-design §13/§15(第 423 行)白纸黑字冻结着相反的规则
——record 录入不走链,但申诉/复查按 EntryRevision 引用的 ItemRevision.review_policy 现场解析救济链,
**administrative 题必须配置 review_policy**。CLAUDE.md 明确两文冲突时停下报告,我却用施工文档覆盖了
领域定案。已纠正:两种 entry_source 同一 M2 单 stage 形状,行政 -1 fixture 带链,m2-design 落地记录
划掉原条目注明纠正。幸而 Entry write 尚不存在,没有任何行按空 policy 落进不可变历史。

其余七条:

- **`AttachmentRef.maxFileBytes`(P0)**:core 持可信文件事实(storage 的 size),驱动持字段规则,
  ref 是两者相遇处——没有它,Entry 侧要么破插件边界读 evidence formConfig,要么放弃大小校验。
  evidence 的 refs 现在带 accept + maxFileBytes。
- **materialRange impact check**:`updateBatch` 收缩材料窗口前,逐条 live entry 按**其自身 ItemRevision
  的 form** 在候选范围下试解,越界点名拒绝(新码 `ASSESSMENT_MATERIAL_RANGE_INVALID`,进码表与双语
  catalog)。驱动契约增可选 `configIssues(config, batch)`:date 字段窗口与 materialRange 无交集
  (必填却无任何合法日期)在保存关卡拒绝。
- **理由必填按操作类型挂(§32.8)**:active 批次上 scoringConfig 变更、换组、cap/floor 移动必须给
  非空理由(`reason-required`);标题等装饰随便改;draft 零仪式。分数 3→5 无言被拒、附一句话通过、
  改标题不问,三态都有用例。
- **审计 diff 讲真话**:item 事件记 itemId + 逐字段 [old,new] + old/newRevisionId;组树事件记
  added/removed/changed 逐字段;**真 no-op 不追加 revision、不写事件、不动 config_revision**——
  否则重复 PUT 会让所有 ScoreRun 永远显示过期。jsonb 回读键序重排,比较改用 canonical stringify
  (实测:原样重存曾被误判为变更)。
- **wire schema 收到列宽**:金额整数部分 ≤8 位(numeric(12,4)),int 字段限 int4 范围——超宽输入
  是 400 而不是数据库炸成 500;floor/cap 比较走 1e4 定点 bigint,不再经 Number。
- **policy 每层拒未知键**:selector/quorum/stage 各自的键集封死,嵌套私货(futureFallback 等)
  三处全数点名拒绝。
- **entrySource 冻结**:题目一旦存在任何 Entry(含 draft),不得再切换 student↔administrative
  (`entry-source-frozen`);要改事实来源走作废+替换。无 Entry 时仍可自由改。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **588 passed / 17 skipped**(item-config 11、
policy 6、evidence driver 7、fixtures 3);`pnpm test:browser` 48;`pnpm build`、
`pnpm qualy resolve --frozen-lockfile`(零写入)、`pnpm qualy generate`(无待生成)、
`prettier --check .` 全绿。

### M2 对话 4:Entry 与 ResourcePolicy,敌意测试先行(2026-08-13)

开工前按审计要求补完 materialRange guard(`1ac15d9`):候选范围除了试解 live payload,还对**每个
active 题的当前配置**跑 `driver.configIssues`(空窗口题点名拒),driver 缺失一律 fail closed
(`item-type-not-installed`)。三臂各有用例。

对话 4 本体(第三层授权从空槽变成真实规则):

- **服务端决定谁在说话**:客户端永不提交 source/actor/subject。题目的 entrySource 决定路径——
  student 题要求 participant 就是本人(替别人建 → `not-your-participant`);administrative 题走
  record:staff 持 `assessment.entry.record`、经批次接受、**且授权锚点覆盖目标 participant 的冻结
  锚点**(subtree 用冻结 path 对 grant 节点活 path 求 `<@`,self 对冻结节点 id,租户角色全域,
  资源限定的授权必须是本批次)。审计的靶心用例:record 覆盖学院 A 的 staff 对学院 B 的学生 →
  `participant-out-of-reach`。依据必填(`basis-required`);record 即 approved、零审核实例。
- **生命周期矩阵(§10.4)整套落地**:draft 可编辑可提交;rejected 追加修订即回 draft;in_review
  不可编辑(`entry-not-editable`)不可重复提交;withdraw = 取消当前轮(instance → completed/
  cancelled + `cancelled-by-submitter` 事件)回 draft,修订不回滚;重新提交开 round 2。
  `max_entries` 在批次行锁内计数(voided 除外)。excluded 的人历史照读、笔被收走
  (`participant-not-active`);他人条目连存在都不可见(404)。
- **submit 现场解析单 stage**:冻结 lineage 找最近的 nodeTypeId 节点 → 精确锚点 holder →
  剔除 {subject, actor} → 空则拒 `reviewer-not-found`(测试:唯一审核人被撤职后拒;学生自己
  戴上审核角色也拒——没人审自己的材料);链快照与节点/角色投影落 review_instances。
- **附件与修订同呼吸**:driver 的 refs(accept + maxFileBytes)对 storage 可信 metadata 逐条校验
  ——staged 必须是 actor 自己传的(`attachment-not-yours`),bound 只许本 entry 历史引用过的复用
  (跨 entry 借用 → `attachment-cross-entry`),retired 拒;`Storage.bind` 经 ambient transaction
  加入同一事务——**一好一坏的引用整单失败,entry 不存在、好附件仍是 staged**(实测)。
- API 四端点(`POST /assessment/entries`、`GET/POST revisions/PUT status`),frozen-routes 同笔;
  三个新码(`ENTRY_NOT_FOUND` 404 / `ENTRY_ACTION_REFUSED {action,reason}` 403 /
  `ENTRY_PAYLOAD_INVALID {issues}` 422)进码表与双语 catalog。
- Assessment service 现在依赖 Storage;测试 harness 统一经 `storageForTest()`(内存 backend +
  真 storage service,与业务同库同事务)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **594 passed / 17 skipped(90 文件)**,
entry-policy 敌意套件 6 例 34 断言全绿;`pnpm test:browser` 48;`pnpm build`、
`pnpm qualy resolve --frozen-lockfile`(零写入)、`pnpm qualy generate`(无待生成)、
`prettier --check .`、生产 smoke 全绿。

**下一步**:对话 5(单 stage Review:inbox、detail、approve/reject、驳回建议稿、
reject → revision → new round)。

### 对话 4 收口:受审语义锚定与五处边界(2026-08-13)

外部审计六条全部核实成立。最重的一条是我把 submit 写歪了:payload 校验与 review_policy 取的是
**item 当前配置**,而 ReviewInstance.revisionId 钉的是学生的旧 revision——一轮审核的 schema、链与
受审内容必须同源于该 EntryRevision 引用的那个 ItemRevision。已改正;测试从两个方向自证:配置在
提交前被收紧并指向无人持有的角色后,旧 revision 照样提交成功,且实例快照里的链是旧角色不是新的
(旧代码下这条测试会以 entry-not-submittable 失败)。

- **跨批次并发绑定**:两个批次各锁各的批次行,storage 的 bind 对同 owner 幂等——并发下同一 staged
  文件曾可同时进两个 entry 的历史。现在附件校验先对排序后的 attachmentId 取
  `pg_advisory_xact_lock` 再读 metadata/history。竞态用例:两轮同刻引同一文件,恰一成功、
  另一 `attachment-cross-entry`、关系表只有一个 entry family。
- **participantId 显式同批次**:他轮成员行在策略层答 `participant-not-found`,不再走到外键变 500。
- **note 上限统一 500**(wire 曾放 1000,列只有 500——超长会炸成 500)。
- **跨字段重复附件**:同一 payload 一个文件出现两次直接拒 `duplicate-attachment`(原先 bind 去重了
  但关系表主键仍会撞出 500);不静默去重——文件到底背书哪个字段不能由迭代顺序决定。
- **复用附件不豁免现行限制**:bound 分支曾在 history 命中后直接 continue,跳过了
  maxFileBytes/accept;现在字段现行规则对所有引用生效(限额收紧后旧 15MiB 文件不能再被复用)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **598 passed / 17 skipped**(entry-policy
10 例);`pnpm test:browser` 48;`pnpm build`、`pnpm qualy resolve --frozen-lockfile`(零写入)、
`pnpm qualy generate`(无待生成)、`prettier --check .`、生产 smoke 全绿。

审计留给对话 5 的开工约束照单记下:**submit 的到站检查、inbox、approve/reject 权限必须同一份
「当前可行动 reviewer 集合」语义**(exact grant ∩ batch accepted review.process − deny ∩ PhaseGate
∩ 自审排除),不允许 submit 与 inbox 各写一套 SQL。

### 对话 5:单 stage 审核流(2026-08-13)

上一轮审计的开工约束落地为一个 SQL 谓词:`mayReview`(review/db.ts)= 站位(stage 角色精确授在
stage 节点、授权行有效、角色 active、人 enabled、resource 为空或本批次)∩ 权威(批次 accepted
`assessment.review.process` 且无 deny)∩ 回避(非 subject、非受审 revision 的 actor)。submit
到站检查、inbox、approve/reject 授权全部引用同一片段,conv-4 的 stageHolders 已删;测试用一条
deny 同时关掉两扇门(队列清空 + 下一次 submit 直接 reviewer-not-found)证明单源。PhaseGate 刻意
不进谓词:谓词答「存在谁」,gate 答「此刻开没开」——submit 在填报期只问前者,inbox/decision
叠加后者(phase 未开:队列空、决定拒 phase-closed、canDecide=false)。

- **inbox**:拉模型、跨批次、oldest-first keyset(cursor 带 per-user fingerprint,篡改 400);
  行内只有屏幕要念的字段,不落 assignee。
- **decision**:instance CAS active→completed,first-writer-wins,输家得
  `ASSESSMENT_REVIEW_CONFLICT`(409);entry 随决定走 approved/rejected,与 withdraw 的竞态由
  同一 CAS 串化。approve 可留言;reject 必须留言(422)。
- **suggestedPayload**:只在 reject 上合法,按受审 revision 引用的 ItemRevision 表单解码,只准
  引用受审 payload 已有的附件(attachment-not-cited),存 event 不动 entry;学生修订后 resubmit
  开新 round(roundNo+1),第二轮照常审。
- **读写分离**:detail 给 subject/审核人/批次管理 reach,其余 404;可读不可判答 403
  not-reviewer(subject 自判、admin 越权判都在内),陌生人 404。
- 夹具修正:review 角色现在真实携带并被批次 accept review.process——只站在节点上不再是审核人。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` **604 passed / 17 skipped**(新增
review-flow 6 例,entry-policy 10 例全绿);`pnpm test:browser` 48;`pnpm build`、
`pnpm qualy resolve --frozen-lockfile`、`pnpm qualy generate`(无待生成)、`prettier --check .`、
生产 smoke 全绿。

下一步:对话 6(唯一 scorer + provisional result:ScoreAmount、fixed@1/sum@1、单层 ScoreGroup、
calcParticipant 单点、breakdown/provenance、/my-result、+3/-1/+2 全链测试)。

### 对话 5 收口:reviewer 资格的两处边界(2026-08-13)

外部审计两条(P1)均核实成立,`mayReview` 收成**单条 EXISTS**:同一条 RoleGrant 必须同时满足
stage 成员资格与批次 acceptance——

- **coverage 必须是 `self`**:此前锚在 stage 节点上的 subtree 授权会被误认为 stage 成员,
  违反「subtree 只参与管辖、不构成 stage membership」的冻结规则。新敌意用例:同角色、同节点、
  coverage='subtree'、已 accept → 队列不见、不构成到站 reviewer。
- **acceptance 按 assignment 逐条命名**:原先站位与权威是两个独立 EXISTS,可以由两条不同
  RoleGrant 拼出——新授的 stage 角色能借另一条旧 source 已 accept 的 review.process 直接进审核链,
  绕过 Batch Access Baseline 的显式确认。现在 batch_access_sources 直接 join 在 rg.id 上。
  新敌意用例:inspector 已有 accepted review.process source,再新授未 accept 的 stage 角色 →
  队列空、判定答 404;把这条 assignment accept 后 → 立即成为 reviewer。

同笔落 **§32.57**(只记裁决、不建表):概念链「学生声明 → 审核认定 → 生效事实 → scorer」;
M2 显式简化 effective facts = approved EntryRevision.payload 逐字;将来 ReviewAdjudication 只
替换 `collectParticipantScoreInput` 这一段,`calcParticipant → Breakdown` 唯一 scorer 不动。

**门禁(实际执行)**:typecheck 零错;`pnpm test` **605 passed / 17 skipped**(review-flow 7 例);
browser 48;build、frozen resolve、generate(无待生成)、prettier、生产 smoke 全绿。

### 对话 6:唯一 scorer 与 provisional result(2026-08-13)

`calcParticipant` 落地为纯函数(src/scoring/calc.ts):无时钟、无查询、无浮点,排序在函数内部
(§8.6 冻结顺序),同输入逐字节同输出由测试冻结。算术全程 1e4 定点 bigint,`scaledAmount` 进、
`formatAmount` 出(canonical 串,至少两位小数);ScoringDriver 收编为判别联合,calculator 带
`amountOf`、aggregator 带 `fold`,fixed@1/sum@1 是真算术。缺驱动 = 装配故障(defect),不是
业务拒绝。

- 状态映射:approved → entry 行(provenance:entryId/entryRevisionId/calculatorRef);
  rejected → excluded-evidence 0.00 行;draft/in_review 无行;题 voided → 本人有历史时一条
  item-voided 行、不进聚合。组 cap/floor 是可见调整行(grp:{id}:cap/:floor,值为差额)。
- `collectParticipantScoreInput` 独立成段:M2 生效事实 = approved payload 逐字(§32.57),
  未来 adjudication 只换收集段,scorer 不动。
- `GET /assessment/batches/{batchId}/my-result`:只回答本人,成员行存在即可读(excluded 含),
  非成员 404;恒 provisional。
- 测试(tests/provisional-scoring.test.ts,3 例,走真实流程:审核通过、行政录入、驳回):
  +3 通过 − 1 行政 = **"2.00"**,驳回 0.00 行、草稿无行、两次调用深相等、外人 404;
  cap 2.00 压 +3 → −1.00 调整行、floor 0.00 托 −1 → +1.00 调整行,总分 "2.00";
  voided 题对有历史者一条 0.00 行、对无历史者无行。lineId 逐字断言。

**门禁(实际执行)**:typecheck 零错;`pnpm test` **608 passed / 17 skipped**;browser 48;
build、frozen resolve、generate(无待生成)、prettier、生产 smoke 全绿。

下一步:对话 7(题目作废动作 + 历史/附件授权闭环)。

### 对话 6 收口:my-result 服从 Batch visibility(2026-08-13)

外部审计一条(P1)核实成立:首版 `getMyResult` 只查成员行(「membership row present is enough」),
而 roster 在创建时物化——草稿或首阶段未到点的批次,榜上学生凭 batchId 就能提前看到分组与
provisional 结果,绕过了已冻结的 Batch visibility(participant = 已开始或已归档;API schema 里
早已列着 `AccessDenied`,实现却从不产生它)。

修法即审计给的最窄一刀:`ScoringDeps` 注入现成的 `requireBatchVisible`,在确认批次存在之后、
读成员行之前调用;不走 `authorizeAction`(`result.view-self` 不受 PhaseGate 控制,excluded 也
不能被权威层挡掉)。visibility 之内成员行只保留历史资格。新边界用例:草稿被拒、排在未来未到点
被拒、进入首阶段后可读、excluded 仍可读、走到末阶段归档后仍可读;完全无关者从
`PARTICIPANT_NOT_FOUND` 改为更宽的 `ACCESS_DENIED`(这一轮先问「这轮与你何干」)。

**门禁(实际执行)**:typecheck 零错;`pnpm test` **609 passed / 17 skipped**;browser 48;
build、frozen resolve、generate(无待生成)、prettier、生产 smoke 全绿。

### 对话 7:题目生命周期与附件授权闭环(2026-08-13)

- **delete / void 分界**(§12):delete 只对草稿批次且零条目放行并连 ItemRevision 一起删;
  active 批次只能 void(必填 reason,事务内锁批次、CAS 置 voided、draft/in_review 条目随题
  voided、in_review 的 round CAS 完结 outcome=cancelled 加 `cancelled-item-voided` 事件、
  approved/rejected 保全、config_revision +1 记 diff)。restore 只开题不复活:死掉的条目与
  round 保持原样,voided 不占 max_entries,学生可重新填报。草稿批次上的 void 仪式直接拒绝。
- **附件授权闭环**:`Assessment.openAttachment` 经 Storage.open 的 authorize 回调落地(§3.5,
  storage 不学业务)。读者 = staged 上传者本人 / 引用 entry 的 subject(excluded 照读)/
  有管理 reach 的 staff / `mayReview` 承认的审核人;retired 只停新引用不停阅读;其余(邻座、
  只持 record 权限的 recorder、跨租户、别人的 staged)一律 404 单一话术。HTTP 四条 attachment
  路由随对话 8 的上传 UI 边界一起挂载,本对话交付授权内核。
- 新 API:`DELETE /assessment/items/{id}`、`PUT /assessment/items/{id}/status`;新码
  `ASSESSMENT_ITEM_ACTION_REFUSED`、`ASSESSMENT_ATTACHMENT_NOT_FOUND`,双语目录同步。
- 测试:tests/item-lifecycle.test.ts 三例(权限与状态分界 / 作废清扫与保全与 restore 不复活 /
  附件读者矩阵含 excluded+retired 与跨租户)。

**门禁(实际执行)**:typecheck 零错;`pnpm test` **612 passed / 17 skipped**;browser 48;
build、frozen resolve、generate(无待生成)、prettier、生产 smoke 全绿。

下一步:对话 8(前端真实竖切:工作区、填报、审核收件箱、我的结果、上传 UI 与 attachment HTTP
边界)。

### 查询层规约:Query Builder 默认,raw SQL 只留给 PG 特性(2026-08-13)

工程规则入 CLAUDE.md:查询默认走 Kysely Query Builder,`sql` 模板只留给 PostgreSQL 特有表达
(advisory lock、ltree、row-value keyset、extract(epoch)、IS DISTINCT FROM、uuid[]/jsonb 等),
且以最小 `sql<T>` 片段内嵌进 builder 查询;`sql<Row>` 是自我声明不是 schema 校验,能推断就不许
`Record<string, unknown>` 手工映射。

同笔把 C5–C7 新增的普通关系查询收回 builder(不碰已被敌意测试钉死的 server/db.ts 复杂授权 SQL,
不碰 `mayReview`/`reviewersAt`/`userMayReview` 共享谓词与 `pg_advisory_xact_lock`):

- attachment/db.ts `citingEntries`/`citingInstances`、scoring/db.ts `participantEntries`、
  review/db.ts `instanceOf`/`activeReviewBatches`/`inboxPage`/`reviewEventsOf` 全部改为
  aliased join + 类型化 select,列名/关系拼错现在编译期就报;
- `inboxPage` 外围整体 builder 化:`mayReview` 谓词作为 typed fragment 挂在 `.where()` 上,
  keyset 行值比较与 `created_at::text` 保留为内嵌片段,`limit ${sql.raw(...)}` 改回原生
  `.limit(n)`;
- 手工 `Record<string, unknown>` 映射全部删除,行类型由实体 schema 推断。

**门禁(实际执行)**:typecheck 零错;`pnpm test` **612 passed / 17 skipped**(行为不变,全部
既有敌意用例照常通过);browser 48;build、frozen resolve、prettier、生产 smoke 全绿。

### 对话 7 收口:锁后重读与找回入口(2026-08-13)

外部审计两条 P0 均核实成立,分两笔提交。

**锁前快照不可信(TOCTOU)**:createEntry / appendEntryRevision / setEntryStatus / updateItem 都在
`lockBatch()` 之前读取 item/entry,拿到锁后继续用旧快照——void 恰好可以落在读与锁之间,于是
「作废后出现新 draft」「voided entry 挂着 active review instance」都构造得出来。修法统一为:
**锁前读取只用于定位 batchId,锁后重读业务对象,只信锁后的状态**;submit/withdraw 的
`setEntryState` CAS 返回值补上检查(锁下 fresh read 后不可达,防未来重排静默留孤儿)。新增
tests/void-races.test.ts:create/edit/submit/updateItem/decision 五路与 void 真并发,收尾断言
不变量——voided 题下零 live entry、零 active round、round 恰好完结一次且 entry 状态与 outcome
一致(approved↔approved / cancelled↔voided,事件序列同源)。

**找回入口**:此前刷新浏览器后没有任何 API 能重新拿到自己的 entryId,draft/in_review 永久失联。
新增两条读:

- `GET /assessment/batches/{batchId}/my-entries`:本人全部状态(draft/in_review/approved/
  rejected/voided),keyset 分页,visibility 先答(与 my-result 同层:无关者 ACCESS_DENIED,
  可见非成员 PARTICIPANT_NOT_FOUND);
- `GET /assessment/entries/{entryId}/revisions`:一条申报的完整账目——全部 revision(含附件
  关系)+ 全部审核轮(state/outcome/所审 revisionId/事件含驳回意见与建议稿),读权与 getEntry
  同源(本人或管理 reach,其余 404)。
  tests/entry-discovery.test.ts 两例:三态列表 + 分页 + 邻座隔离 + 无关者拒;两轮历史 + round 与
  revision 对齐 + 陌生人 404。

**门禁(实际执行)**:typecheck 零错;`pnpm test` **617 passed / 17 skipped**;browser 48;
build、frozen resolve、prettier、生产 smoke 全绿。

### 对话 8:前端真实竖切(2026-08-13)

- **对话 1 的两笔欠账随本对话闭合**:`Ui.browser` 聚合通道(收集器把 provider 的浏览器半边以
  副作用 import 编进 virtual module,active 集只带选中的 provider)与本地上传门
  (`PUT /api/storage/local/uploads/:reservationId`,reservationId 即完整凭证;核心
  `receiveUpload` 校验票据、oversize 答 `oversized` 而非后端故障;storage-local 测试 2 例)。
- **attachment HTTP 边界**:uploads(准入=item active ∩ 成员或 record 权限)/complete/
  descriptor(redirect 给短时 url、stream 指向 /content,descriptor 显式 destroy 未读流)/
  content(StreamUint8Array;redirect 后端答 404)。DELETE 缓予 sweeper。
- **页面**:rail 新增「个人」(我的填报、我的成绩)与「工作」(审核、代为登记),管理组加
  「项目配置」。我的填报按题合卡、表单按 formConfig 渲染、上传 provider-neutral、历史与驳回
  建议只读;审核收件箱按批次过滤租户级队列,退回必填意见、建议稿不开上传门;行政登记
  (listParticipants 放宽为 manage ∪ accepted record,写入仍查 reach);项目配置=分组编辑+
  结构化基础+配置 JSON(服务端逐条答复)。my-entries 响应新增 participantId 供首次填报指名。
- 浏览器用例 +5(申报→提交、建议只读、队列→通过、退回必填意见、成绩单调整行)。

**门禁(实际执行)**:typecheck 零错;`pnpm test` **619 passed / 17 skipped**;
`pnpm test:browser` **53**;build、frozen resolve、generate(无待生成)、prettier、生产 smoke
全绿。

下一步:对话 9(M2 收官审计:hostile matrix 复审、migration 重放、frozen routes/error gate、
死代码清理、assessment-design 增补、验收报告)。

### 工作区能力过滤:批次内导航按身份显示(2026-08-13)

用户报出 manifest 模型与批次域的正面冲突:批次内授予的审核权限拿不到审核页;若按人投影放宽,
每个批次都会冒出审核按钮。经用户裁决(四条修正一并采纳)按三层收口:

- **资格层**:`permissionOf` 语义定为「∃ 有效授权上下文中的 effective authority」。确诊根因:
  rbac 的 `held` CTE 无条件排除 resource 限定授权,manifest 的 `getProfile` 因此看不见批次内
  授权。`held` 增 `general | any-context` 档,`effectiveRows('anywhere')` 走 any-context
  (discovery 计入 resource 授权),`canAt` 等通用判定不变。rbac 层无 deny;批次 accepted−denied
  细化归第二层。测试:resource 限定授权 → getProfile 可见、canAt 依旧拒绝。
- **能力层**:`getBatch.capabilities {personal, review, record, manage}`——workspace navigation
  capability 而非权限码镜像;与 authorizeAction 同源(batchAuthority/成员行),不掺 PhaseGate;
  `personal`=成员行存在(excluded 保留历史);创建/更新/归档三个写响应同样携带;列表暂不带
  (要带必须批量投影,已写入裁决)。矩阵测试:同一审核人 A 批 review=true、被 deny 的 B 批
  false;recorder/学生/excluded/管理员各就各位。
- **导航层**:`NavigationItem.capability?: string`(概念冻结的批准扩展,裁决入
  notes/ui-composition.md);workspace shell 挂 `WorkspaceCapabilityScope`,BatchContextBar 把
  服务端投影发布为 token 集合;**loading/ready 是契约**——未发布时带 token 条目一律不渲染
  (fail closed,绝不闪现后收回)。管理组五条 rail 同批挂 `assessment/manage`,「A 批管理员在
  B 批看到管理按钮」的同源问题一并消失。审核/登记页区分「无身份」与「无任务」两种话术。
- 实测修一个发布环:publish 身份随 state 重建 → 发布者 effect 反复重挂 → Maximum update depth;
  `useCallback` 钉稳。

**门禁(实际执行)**:typecheck 零错;`pnpm test` **621 passed / 17 skipped**(rbac 21、
capabilities 矩阵);`pnpm test:browser` **54**(scope 契约 + shell fail-closed);build、
frozen resolve、prettier、生产 smoke 全绿。

### 前端可用性整改:侧栏定案落地与配置去 JSON(2026-08-13)

用户指出批次内前端不可用:侧栏未按 §23.1 定案组织、页面功能薄且与既有页面不配、项目配置竟要
手填 JSON。本轮按定案整改(不新增测试,前端将反复迭代):

- **侧栏**:工作区分组照定案「概览 / 个人 / 工作 / 管理」;分组标题只有文字,icon 只在条目层
  (用户当场纠正过一版带分组 icon 的实现);图标集补齐 8 个 lucide 名(此前 rail 条目引用的
  file-text/inbox 等根本不在 ICONS 表,画不出来);「审核」按定案更名「审核工作」。未建页面
  (填报进度、公示、申诉)不占位。
- **项目配置去 JSON**:新增 `GET /assessment/batches/{batchId}/item-options`(manage 门槛,
  组织类型 + 活跃 org 角色两组选项);ItemConfigEditor 侧栏面板结构化编辑——基础(标题/分组/
  每人条数/由谁填报)、表单字段行(文本/日期/文件三类,按类型展开 maxLength、日期界、文件数/
  单文件 MB/接受类型,增删上下移)、计分(每条通过计 X 分)、审核(在哪一级 × 由谁审,单 stage);
  编辑时把既有配置解析回表单,保存拼出与 API 校验同形的 config,`ItemConfigInvalid` 逐条回显。
- **页面版式对齐**:审核队列表格化(项目/来自/提交时间/操作);审核详情左材料右案卷
  (申报人/轮次/时间/处理经过,§23.4);我的填报题目卡带「通过后计 X 分」与备注摘要;
  附件统一 `AttachmentLink`(经 describeAttachment 显示真实文件名与大小,redirect 后端直链、
  否则走 content 门)。

**门禁(实际执行)**:typecheck 零错;`pnpm test` 621 passed / 17 skipped;`pnpm test:browser`
54(既有用例未破);build、prettier、生产 smoke 全绿。

### 审核链按 §14 补齐(2026-08-13)

用户指出前实现与《14. Review 引擎》不符,并当场裁决了成员资格语义。逐条对齐:

- **成员资格只看锚点,coverage 不参与**(裁决入 assessment-design §32.58):上一轮按外部审计加的
  `coverage='self'` 已删——「subtree 不参与成员资格」约束的是向下延伸,锚点相等本身已挡住;多余的
  self 条件排除的恰是授权表单默认值,等于让 stage 无法配齐人。用户报的「配了 3 个审核员仍无法
  提交」实际根因是**审核层级配在「年级」而所有授权都在学院/专业/班级**——现已被配置页的覆盖
  预览当场标红。
- **整条链**:policy 放开为 §14 全量(多 stage、roleAt|nearestRole、normalTerminal);提交时解析
  整条链落 `effective_chain` 快照(含跳过的段与原因);`nearestRole` 沿冻结 lineage 找最近持有者
  ——「上级管下级」由它表达,与 ltree 语义一致。
- **决定走链**:approve 逐段推进到 normalTerminal 才终结;reject 任何段即终结;escalate 进入疑点段
  (mode=escalated),其中间段只能留意见/建议/继续上报,**仅链尾可裁决**;动作集由服务端按 mode 与
  位置下发。
- **到站检查 + 巡检**:进入任何一段无人 → `blocked` + 事件(不再拒学生);巡检上 scheduler 分钟档,
  按 (roles,node) 去重重解析,双向自愈;`review-alerts` 分组为「等待任命」面板。
- **quorum all/atLeast 具名拒绝**(`policy-quorum-not-counted`):panel 快照与计票未建,接受配置就会
  把 all 当 any 跑;建好后删这一分支即可。
- 前端:配置页多步骤链编辑器(选层级角色 / 最近持有者、标记普通流程终点、逐步覆盖预览);审核详情
  右栏链路展示 + 按下发动作集渲染。

**门禁(实际执行)**:typecheck 零错;`pnpm test` **623 passed / 17 skipped**;`pnpm test:browser`
54;build、frozen resolve、prettier、生产 smoke 全绿。

### 对话 8.5:按外部审计分级收口(2026-08-13)

**P0 分数分组保存丢 id**:前端不回传 id → 后端理解为删旧建新 → 已挂题目的分组一改封顶就被
`group-has-items` 拒。重写为分组树编辑器(保留 id、逐条回显拒绝、active 批次改封顶要求原因、
删除连带子组)。

**P0 嵌套分组**(裁决 assessment-design §32.59):`parentGroupId` 为唯一结构真相,不引入 ltree
(分数树是节点极少、频繁移动的小树,拖拽在 parentId 下改一行,在 path 下要重写子树);服务层拒环、
scorer 遇环抛 defect;复合外键 + RESTRICT 对话 2 已建,无需迁移。scorer 改递归并冻结
`raw = Σ直属item + Σchild.final`、`final = clamp(raw, floor, cap)`、`total = Σroot.final`;
Breakdown 逐组给 itemsTotal/childrenTotal/raw/final + parentGroupId/depth。敌意测试按真实校规:
体育 2+3+2 cap4 → 4,文体 cap10 → 6。

**P0/P1 删除步骤错移终点**:`normalTerminal` 按下标算,删前面的步骤会把疑点段首步变成普通终点。
编辑器改两列表(常规审核 / 疑点上报)+ 稳定 key + 上下移,终点保存时派生,管理员不再看到该概念。

**P1**:意见类动作(comment/recommend-*)不再误退出审核,只刷新详情;删除与 §32.58 冲突的
「仅本级」文案;`no-such-level` 与 `no-holder` 分别成句;事件与结论走 presenter(服务端投影
actorName),审核详情与条目历史共用,链路每段附当前可审人员名单;历史按 revision 自己的 formConfig
显示字段标签(不再 f1/f2);附件对光栅图给缩略图与灯箱(不改 storage 的 attachment 语义——
`<img>` 是子资源加载,svg 经 img 禁用脚本);我的填报按计分树分组并标出已得/封顶。

**门禁(实际执行)**:typecheck 零错;`pnpm test` **624 passed / 17 skipped**;
`pnpm test:browser` 54;build、frozen resolve、generate(无待生成)、prettier、生产 smoke 全绿。

### 题目配置页重做:像出卷子一样编排(2026-08-13)

用户要求把「项目」统一改称「题目」,并重做配置页——现在太简陋、不合人体工学。

- **改名**:中文文案里 24 处「项目」全部改为「题目」(页面名为「题目配置」),英文默认串同步
  (item → question);内部标识与 API 不动。
- **页面重做为「卷面 + 编辑区」两栏**:左栏是**卷面结构**——分组带封顶徽章、题目带分值与
  「登记」标记、停用题目划线,悬停即出「＋题目 / ＋子分组」,选中高亮;右栏打开选中的那一样东西。
  弹窗全部取消:出卷子的人是一边看已有内容一边写新题的,模态框恰恰把这个拿走。
- **分组面板**:名称、封顶、保底(各带一句说明)、面包屑说明位置、active 批次要求原因、删除;
  保存时整棵树连同 id 一起回传(这正是上一轮 P0 的成因)。
- **题目面板**:原侧栏内容原地展开(基础/表单字段/计分/常规审核/疑点上报),标题旁给停用、
  重新启用、删除;从某个分组的「＋题目」进入时默认落在该分组。
- 「等待任命」告警上移为页首横幅(图标 + 单位 + 等待条数 + 该怎么办)。

**门禁(实际执行)**:typecheck 零错;`pnpm test` 624 passed / 17 skipped;`pnpm test:browser` 54;
build、prettier、生产 smoke 全绿。

### 题目配置页第二轮:卷面即页面 + 文案按规范重写(2026-08-13)

用户指出两点:文案又出现自言自语(违反「引导而非说明」的约定),页面仍不好看、不合人体工学。

**设计**(先定再写):整页就是一张卷子——居中一张纸,分组是带中文序号的大题
(「一、文体活动 —— 封顶 10 分」),题目是纸上的行(序号 + 标题 + 点线引导 + 「2 分」右对齐),
停用划线、登记类标注,悬停才浮现「新增题目 / 新增子分组」。左侧与卷面重复的 outline 树删除,
纸本身就是目录。题目详情收进右侧抽屉,分节可折叠(填报表单/计分/常规审核/疑点上报,编辑时默认
收起为一行摘要:「3 个字段」「通过计 2 分」「2 步」);分组设置收进小对话框(名称/封顶/保底)。
顺带修复:抽屉里的停用/恢复/删除按钮此前声明未渲染,不可见。

**文案**(对照阶段安排页的定稿标准逐条重写,en/zh 同步):删除自夸设计的「选中的内容会在这里
打开…而不是盖住它」、复述模型的「分数按组累加…」、解释巡检机制的「一分钟内自行恢复流转」、
小论文式的「适合辅导员这类…」;「等待任命」改「以下环节暂无审核人」,动作句「为对应单位授予
以上任一角色后,申报会自动继续。」;审核人定位方式用用户原话:「指定组织层级」「向上查找最近
负责人」;孤儿键(outline-title/pick-hint/chain-hint/groups-hint 等 11 个)连同 zh 行一并删除,
catalogs 门禁守。

**门禁(实际执行)**:typecheck 零错;`pnpm test` 624 passed / 17 skipped;`pnpm test:browser` 54;
catalogs 7;build、prettier、生产 smoke 全绿。

### 题目配置页第三轮:两栏定稿(2026-08-13,按用户新交互稿)

用户给了三张交互稿:左右两栏(左侧试卷结构、右侧选中对象的编辑页)、右侧横向选项卡、审核链条画成流程。逐项落地:

- **左栏试卷结构**(常驻):中文序号大题 + 「封顶 X 分」,题目行 = 序号 + 标题 + 「登记」标注 +
  右对齐带符号分值(负分红色),选中行反色;悬停浮现「新增题目 / 新增子分组」,底部「添加分组」;
  子分组以左侧竖线缩进。**支持拖拽排序**:题目在组内排序、拖入其他分组(落点画线/整组高亮),
  分组在同级间排序;落下后只写位置真正变化的行(updateItem sortOrder / replaceScoreGroups)。
- **右栏编辑页**:顶部小字「题目编辑」+ 题目名 + 右上「停用/恢复/删除 + 保存」;下方横向选项卡
  **基本信息 / 填报字段 / 计分方式 / 审核链条**(下划线式)。基本信息新增**填报说明**
  (存 displayConfig.description,填报对话框在题目下方显示)与**每人可申报条数留空为不限**
  (maxEntries 空 → null,API 本就支持)。分组编辑同样在右栏(名称/封顶/保底/原因/删除)。
- **审核链条画成流程**:提交(参评人员) → 步骤卡片 → 审核完成(通过计入成绩);卡片默认折叠为
  摘要(第 N 步、层级/角色 或 方式:逐级向上,「展开编辑」),一次只展开一张;展开卡带前移/后移/
  删除与覆盖检查(该层级 N 个单位都有人可以审核 / 点名没人的单位);常规链最后一步标「通过后完成」;
  疑点上报一节在下方,同一套卡片。
- 交互稿里与冻结设计冲突或后端不存在的能力**未做**:表决方式仅有「任一人通过」故不渲染控件;
  「改判分值」违反 §32.4(审核决定不携带分值);递减/分值表/自定义函数等计分器后端未建,
  计分方式选项卡只有当前真实存在的固定分值。

**门禁(实际执行)**:typecheck 零错;`pnpm test` 624 passed / 17 skipped;`pnpm test:browser` 54;
catalogs 7;build、prettier、生产 smoke 全绿。

### 题目配置页第四轮:通栏工作台(2026-08-13,按用户逐条反馈)

用户反馈:不要卡片包裹、中间一条从上到下的竖线、左右不留边距;左侧选中态改边框+微底色;
新增按钮一点即建,不经过右侧;并给了一份三栏工作台参考稿(样式仅供参考,配色遵循本项目 theme)。

- **通栏布局**:BatchScreen 新增 `flush` 模式(内容区去 PageContainer 边距,草稿横幅自带缩进);
  内容区一分为二,左栏格子随行拉伸,`border-r` 就是那条从上到下的竖线(区域设 min-height 保证到底)。
- **左栏 = 结构栏**:浅底色(bg-muted/30);头部「结构 + 新增分组」,底部合计行「分组封顶合计 N 分」
  (仅当顶层分组都设了封顶);行支持折叠(chevron);去掉中文大题序号与题目行号,行 = 名称 + 登记
  标注 + 带符号分值(负分红);**选中态 = 边框 + 白底 + 微影**,不再反色。
- **新增即创建**:「新增分组 / 新增子分组 / 新增题目」点击立即写库(题目带缺省配置:一个「情况说明」
  文本字段、固定 1.00 分、首层级+首角色的单步审核链;分组名「未命名分组」),创建成功即选中进入
  编辑;右栏不再承担任何「新建」表单,编辑器与分组面板都只做编辑。
- **参评人员界面预览**(参考稿右栏):编辑器头部「预览」按钮展开右侧预览列(默认折叠),
  按当前草稿实时渲染参评人员将看到的卡片——题名、「最多申报 N 条 / 通过计 X 分」、填报说明、
  逐字段控件示意(附件为虚线上传框)、以及「提交后将经过」的常规审核步骤;不渲染假按钮。
- 顺带:填报字段列表由堆叠方框改为分隔线行。

**门禁(实际执行)**:typecheck 零错;`pnpm test` 624 passed / 17 skipped;`pnpm test:browser` 54;
catalogs 7;build、prettier、生产 smoke 全绿。

### 题目配置页第五轮:可调分栏与细节修整(2026-08-13,按用户逐条反馈)

- **可调整分栏**:@qualy/ui 新增 `resizable`(react-resizable-panels v4,实查其 API 为
  Group/Panel/Separator,分数字符串为百分比);桌面端左右两栏用 ResizablePanelGroup,拖动中缝
  调宽,各栏内部独立滚动;窄屏(<1024px,matchMedia hook)退化为上下堆叠。
- **占满高度**:BatchScreen flush 模式改为 `min-h-full` 弹性链(壳的 main 是确定高度的滚动容器),
  分栏区 `flex-1`,中缝从上到下贯通。
- **分数显示去尾零**:新增 `trimAmount`(10.0000 → 10),铺到结构栏封顶与分值、编辑器预览、
  我的填报分组小计、成绩明细(总分/分组/逐行);浏览器用例断言同步(2.00 → 2)。
- **结构栏**:去掉底色用默认色;悬停操作换成两个图标(＋题目 / 文件夹＋子分组)带 tooltip,
  不再挤压分组名;页脚改为「共 X 题,满分 Y 分」(题数计全部启用题目,不计分组;顶层分组未全部
  设封顶时只显示题数)。
- **参评人员界面预览**:取消折叠,默认显示;xl 以下堆叠到编辑器下方(窄屏适配)。
- **填报字段选项卡**:改为手风琴——每个字段折叠为一行(标签、类型、必填星号),点开才出设置,
  新增字段自动展开;不再默认铺开所有字段的全部设置。

**门禁(实际执行)**:typecheck 零错;`pnpm test` 624 passed / 17 skipped;`pnpm test:browser` 54;
catalogs 7;build、prettier、生产 smoke 全绿。

### UI 换装:radix-luma 预设(2026-08-13,用户要求试看,可能换回)

用户先指出 Input 阴影非 shadcn 新基线样式,随后给出 preset 码要求整体换成 Luma 看效果。

- 经 `npx shadcn apply b1VlIttI` 应用(在 packages/web/ui,临时放 vite.config 通过框架检测,用毕即删);
  preset 解析为 **radix-luma**(radix 原语版 Luma,与本仓库原语一致,无需迁移 Base UI)。
- 35 个组件 + theme.css + utils 被官方源整体重写(胶囊圆角、填充式输入框、无阴影、Inter Variable 字体,
  新增依赖 @fontsource-variable/inter 与 shadcn 包的 tailwind 基底);toast 在 radix-luma 注册表缺失,
  应用期间暂移出目录后原样保留(sonner 路线)。
- 修整:registry 的 `@/` 别名导入全部改回 NodeNext 相对路径 + `.ts` 扩展(35 文件,脚本处理);
  theme.css 去掉重复的 tw-animate 导入;apply 抹掉的自有导出移植回新文件
  (spinner 的 LoadingScreen/PageLoading、dialog 的 DialogBody)。
- 单独一个 commit,如要换回样式直接 revert 即可。

**门禁(实际执行)**:typecheck 零错;`pnpm test` 624 passed / 17 skipped;`pnpm test:browser` 54;
build、prettier、生产 smoke 全绿。

### UI 换装第二轮:radix-nova 预设(2026-08-13,继续试装)

`npx shadcn apply b48` → **radix-nova**(直角些、描边输入框,仍无阴影,Inter 不变)。流程同上一轮:
toast 暂移避开注册表缺口、35 文件别名导入改回相对路径+扩展名、theme.css 去重、
自有导出(LoadingScreen/PageLoading/DialogBody)移植回新文件。单独 commit,revert 即回 Luma。

**门禁(实际执行)**:typecheck 零错;`pnpm test:browser` 54;build、prettier、生产 smoke 全绿。

### 题目配置照设计稿重做(2026-08-15)

设计稿 claude.ai/design 项目 66ce1d7d「题目配置.dc.html」,采用其中 **2a/2w**(空态与创建卷面)、
**3a**(结构列表)、**4a**(题目详情重做)三屏;`page-container` 由 default 改 **wide**(1440)。

- **空态(2a)**:居中两张卡(推荐路径带深色描边与实心按钮),第三张「从已有批次复制」未做——
  后端无复制端点,不画不能用的入口。
- **结构(3a)**:卷面摘要改为一行只读文本(总分名称/上限/下限 + 铅笔图标的「编辑卷面」)+ 顶层分组
  配额色条与图例(取 `--chart-2..5`,`--chart-1` 在白底上看不见);结构表按设计稿改八列 grid,
  分组行自带「子分组 / 题目」两个按钮与 ⋮ 菜单(打开/发布/停用/重新启用/删除,全部接真实 mutation),
  题目行左侧状态色条 + 圆点状态胶囊;只有分组带编号。
- **题目详情(4a)**:整页左标题右内容的分节版式(168px 说明列 + 内容列,节间只有一条细线),
  右侧 312px 灰底面板放「参评人员界面 / 计分位置 / 版本」;填报字段由侧栏抽屉改为**表格 + 行内展开**
  (FieldSheet.tsx 改名 FieldTable.tsx);计分区加「分」后缀、「不限条数」勾选与本题上限说明;
  审核链条画成一条横线(起点/步骤/终点),每步实时显示 `reviewCoverage` 覆盖情况。
- **分组编辑改 Sheet**:三个字段不值得离开结构,GroupEditor 由整页改 SidePanel;随之删掉「分组草稿」
  这条路径(TreeDraft 收缩为只描述未保存的题目,GroupDraft/held 的分组分支一并移除)。
- **文案**:「封顶/保底」全量改为「上限/下限」(中英两侧),`assessment/items/sibling-position`
  改为 `paper-position`(右上角上下键改为在整卷所有题目间切换,不再限于同分组)。
- **顶部 banner 是同一个位置**:BatchScreen 的横幅带里两个标题在同一处交叉淡入淡出(200ms),
  `BatchBanner` 经 portal 把题目的面包屑/标题/状态/操作送进去;正文自己左右移动。
  新增 `@qualy/ui/portal`(react-dom 入 @qualy/ui peerDependencies)。
  **带高不许动**:`banner` 由布尔改 `section | open`,**传了这个属性就等于声明本节会交出横幅**,
  据此给带内容留出两个标题都放得下的高度(min-h-18),实测三态恒 121px、零位移;
  `@qualy/ui/reveal` 的 `Resizing` 只作兜底(窄窗口文案折行才真的要动)。
  **Drill 不再 `mode="wait"`**:排队会让新屏幕在旧屏幕退场完成前根本不存在,
  它要填的横幅就空 200ms(第二次进入时肉眼可见「先变空再变新」);改为两屏在同一 grid 格交叠,
  退场那屏 `pointerEvents: none`。
- **切换动画**:`@qualy/ui/reveal` 新增 `Drill`,由调用方显式声明 `move`——
  `in/out` 左右推进退出、`next/previous` 上下移动(整卷翻题)、`none` 不做任何动画(保存后原地落回,
  不再表演一次到达);`prefers-reduced-motion` 下只留淡入淡出。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 626 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过并 stage 到 client-dist;prettier 已跑。
过程中用一次性 Vitest Browser 截图夹具核对三屏还原度(用毕删除,未入库)。

### 题目配置收口:横幅、宽度与移动端(2026-08-15)

- **页面宽度改回 default(max-w-6xl)**,与其他页面一致;题目详情的正文/侧栏在 1152 内仍站得开。
- **横幅高度与别的页面一样**:题目横幅改成和 `PageHeader variant="banner"` 同一骨架
  (标题行 + 说明行,操作靠右),自然高度就相等——不再靠预留高度硬凑,实测两态恒 109px。
- **只有离开的那个标题淡出**。交出横幅时读作交叉淡入淡出(接手的那个同一帧就渲染了);
  收回横幅时,离开的那个已经随它的屏幕一起消失,再淡入就是从空白淡起——那正是用户看到的「闪白」。
- **Drill 只画到达的那一屏**。两屏同时在场会互相透出、争抢页面高度(进入时的「闪动」);
  排队又会让到达的那屏在退场结束前根本不存在,它要填的横幅就空着(返回时的空窗)。现在离开的
  那屏与新屏在同一次提交里换掉,方向由到达的动作交代。
- **卷面摘要重排**:去掉「总分名称/满分/下限」这排标签,改为卷面名(+铅笔「编辑卷面」)在上、
  `满分 100 · 不设下限` 在下;右侧仍是核对句与统计。配额色条改为**按满分为全长**,
  未分配的部分留白显示(此前按各分段合计归一,75/100 会画满整条)。
- **移动端不再左右滚动**(实测 390px 视口 `scrollWidth` = 390):结构表与填报字段表在窄屏改为
  「名称+状态一行,列里的内容并成一行小字」;分组行的「子分组/题目」按钮收进 ⋮ 菜单;
  搜索框占满一行;拖动提示只对指针设备显示。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 626 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过。截图与量测夹具用毕删除。

### 题目配置续修:地址、控件与审核链条(2026-08-15)

- **打开的题目进地址栏**:`?question=<id>`(`usePageQueryState` 增 `history: 'push'` 选项——
  筛选器不该进历史,打开一条记录该进)。刷新、分享链接、浏览器前进后退都成立;实测
  列表 → `?question=Q2` → 上一题 `?question=Q1` → 后退回 Q2 → 再后退回列表。
  **方向改为推导**:比较上一次提交时在哪一屏(`moveBetween`),因此浏览器后退与页面上的
  按钮走同一套动画;草稿没有 id,仍只存在于内存,保存后 draft→item 推导为 `none`(原地落回)。
- **新建收成一个按钮**:`新建` + Dropdown(新建题目 / 新建分组,各带图标)。
  **落点不再写死在卷根**:分组面板新增「上级分组」下拉(自身与其子孙不在候选里),
  所以从工具栏建的东西可以就地改到任意层级;分组行上的「子分组 / 题目」仍是就地快捷方式。
- **题目编辑页的下拉全部换成 shadcn**:新增本地 `Choice`(Select 的六个部件包一层,
  一屏六个字段不至于淹没在标记里),覆盖所属分组、由谁填报、计分方式、字段类型、
  上级分组、审核步骤的三个选择。原生 select 在移动端会拉起系统滚轮,与旁边的输入框不是一类东西。
- **审核链条**:两条链都有起点与终点(疑点链此前既无始也无终,读起来只是一排方框);
  步骤之间与两端都有插入点(悬停才显形),不再只能追加到末尾再用左右箭头挪过去;
  **未配置完成的步骤**不再显示「专业 / —」(那个破折号会被读成汉字「一」),改为红色虚线序号 +
  「尚未设置」+ 一句该填什么。
- **保存按钮不再置灰**:点下去会说清楚差什么(标题为空 / 没选分组 / 没填分值 / 字段没名称 /
  审核步骤没设完),而不是让人对着一个死按钮猜。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 626 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过。

### 换主题暴露的问题:尺寸交还给主题(2026-08-15)

用户换了 shadcn preset(输入框与按钮变为 h-9 胶囊形)后题目配置页错位——根因是这几屏里
写死了一批高度与字号,主题一动就全乱。**规则:控件的尺寸归主题,页面只说布局。**

- 手搓的 `<button className="size-7 …">` 一律换成真的 `Button` + 官方尺寸档
  (`xs / sm / icon-xs / icon-sm / icon`):行内 ⋮、卷面「编辑卷面」、分组行的「子分组 / 题目」、
  返回箭头、审核步骤的删除、字段表的「添加字段」。
- 删掉所有 `h-7 / h-8 / h-9 / size-5.5 / size-6.5 / h-9.5 / h-10.5` 之类的高度覆盖;
  表格行改用 padding,高度由主题的字号与控件决定。
- 任意字号 `text-[11px] … text-[15px]` 全部并回 `text-xs / text-sm / text-base / text-lg`。
- 列表页的状态筛选也换成 `Choice`(shadcn Select),与其他控件同形。
- 空态两张卡:此前是 `<button>` 里塞一个假按钮 `<span>`,改为普通卡片 + 真 `Button`。
- **仍然写死的两处**:审核链条里的分隔竖线(纯装饰)与右栏预览里模拟输入框的 `h-9`
  ——后者是「跟输入框一样高」的意思,没有 token 可引,主题若再改输入框高度需要跟着改。
- 顺带:题目页右上角只留 ⋮ / 取消 / 保存,**去掉上下切题按钮**(位置信息仍在面包屑那行,
  按钮本身没意义且移动端会挤到第二行);对应的 `itemsPrevious/itemsNext` 文案一并删除。
- 顺带修 Fast Refresh:`StructureTable.tsx` 既导出组件又导出 `itemCeiling/structureRows`,
  违反「一个模块只导出组件」,每次改动整页重载;行模型拆到 `items/structure.ts`。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 626 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过。新主题下三屏截图核对:控件同高、胶囊形一致、
390px 视口 `scrollWidth` = 390。

### 顶部卷面块瘦身 + Fast Refresh 门禁(2026-08-15)

用户指出顶部那张卡「又想矮又想显示全,别扭还占地方」。**根因是它说的话下面二十像素处
全都又说了一遍**:几道题、几个顶层分组、几道未发布、每段值多少——那就是下面那张表。

- 删掉重复的统计与材料时间范围,只留表回答不了的两件事:整卷值多少,以及各分段已经占掉多少。
  条形图给一眼的比例,右侧一句 `各分段已占 75 / 100` 给数字。
- 真出错才占一行:`各分段上限合计 {sum},已超出满分 {total}`(destructive)、
  或「有顶层分组未设上限」。稳态不占空间。
- 从五行带框卡片降到两行;不再用边框(与下面那张表的边框打架),改浅色底面板,
  与白底的表格区分开——先前去掉边框后「和底下混在一起分不清」。
- 删除 `paperTally / paperCapMatch / paperCapSum / paperCapSumFree / paperNameLabel`,
  新增 `paperAllocated / paperAllocatedFree / paperCapOver`。
- 列表页「新建」按钮改回默认档:与搜索框、状态筛选同为主题的 36px(此前 sm=32px 差 4px)。

**Fast Refresh 门禁**:同类问题两次(`itemCeiling`、`FIELD_TYPE_LABEL`)——
新增 `tools/tests/fast-refresh.test.ts`:插件 client 目录下,**导出了组件的 .tsx 不得再导出别的值**
(类型会被擦除,不算)。顺带把 auth 的 `OrgTree.shapeOf` 收回文件内(本就无外部消费者)。
共享 web 包不在门禁范围:它们是有意把 hooks 与 Provider 放在一起发布,拆不拆是另一个问题。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 627 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过。

### 两处收口:横幅同高与浮层退场动画(2026-08-15)

- **横幅又差几 px**:不是右上角按钮撑的(它们 36px,比左侧两行文字矮)——是**返回箭头**。
  它是 24px 的 icon 按钮,塞在 20px 的文字行里,把那一行撑到 24px,于是比另一个横幅高 4px。
  **根治**:`PageHeader` 的 title/description 放宽为 ReactNode,题目横幅改为走同一个 PageHeader
  (此前是照着它另写了一遍——两份分别拼出来的标题必然会差几像素);返回箭头改为与文字同尺寸的
  内联按钮,不再撑行。实测列表 / 题目 / 返回三态恒 109px。
- **浮层关闭没有退场动画**:写法都是 `{x !== null && <Panel/>}`,x 一变 null 整个组件即刻卸载,
  Radix 的关闭动画没有载体。新增 `@qualy/ui/use-lingering`:留住最后一次的值,
  面板改为常挂 + `open` 控制,关闭时还有东西可画。分组 Sheet、审核步骤 Sheet、
  两个原因对话框、停用题目对话框、卷面创建向导**六处同病**一并修掉。
  实测:按下取消 60ms 后节点仍在且 `data-state="closed"`,700ms 后由 Radix 自行卸载。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 627 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过。

### 我的填报按设计稿 2a/2b/2c 重做(2026-08-15)

设计稿 claude.ai/design 项目 66ce1d7d「我的填报.dc.html」第二轮:一份结构 + 右栏按选中对象切换,
申报改模态框。旧版是「按分组分节、每题一张卡」的长列表,分组只是标题。

- **左栏一份结构**(376px→`lg:w-94`):分组与题目都是可选中的行,深度用缩进表达;
  右侧显示该行已计入的分值,题目行另有一个词说明处境(可申报/草稿/审核中/由学校登记/已停用)。
  打开的行进地址栏 `?open=<id>`,刷新与分享都落回同一处。
- **2a 选中分组**:我在本分组 / 上限 / 下限 + 进度条(按上限归一)、「本分组包含」可点进去、
  「我的构成」= 本级题目 + 子分组 = 本分组合计(全部取自 `getMyResult` 的分组行,不另算)。
- **2b 选中题目**:题面规则做成 Badge(通过后计 X 分 / 已申报 m/n 条 / 需 k 人依次审核)、
  草稿单独一行(继续填写 + 提交)、已提交条目按「字段名 → 填写值」平铺,分值取自结算行的 provenance。
- **2c 申报模态框**:`FormDialog` 加 `size="wide"`,左表单右侧栏(本题的规则 / 本题我已申报);
  底部两个出口——**存为草稿**与**提交**(提交 = 保存后再置 in_review,两次调用由这一屏承担,
  不再让用户先存再回列表找按钮)。
- 行模型抽到 `entry/standing.ts`(纯模块,列表与两个详情面板共用同一套「这一行处于什么状态」)。
- **可见性修正**:此前只显示「自己填 + 已有条目」的题目,于是学校登记且已计分的题目不出现,
  而分组的「本级题目 60」又把它算进去——现在凡是在结算行里出现过的题目一律可见。
- 尺寸全部交给主题(无写死高度),下拉与按钮用 shadcn;`BatchScreen` 新增 `actions` 槽,
  横幅右侧放「已计入 / 审核中 / 草稿」三个数。

**设计稿里未实现的部分**(后端没有对应事实,不做假数据):①「评分依据 第五条 + 查看原文」——
题目/分组没有政策条款引用字段;②「草稿自动保存于 14:23」——没有自动保存,现为显式保存并显示
最后一次保存时间;③ 审核链条显示角色名——`itemOptions` 是管理端端点,参评人员无权读,改为显示步数;
④ 真实性承诺勾选框——提交没有这条服务端约束,加上等于凭空立规矩;⑤「待公布」的互评/默认给分题型
尚不存在。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 627 passed / 17 skipped;
`pnpm test:browser` 54 passed(entry-workflow 的填报用例按新的两个出口更新);`pnpm build` 通过。

### 题目配置四处修复(2026-08-15)

- **已保存的题目却提示「请先保存」**:`dirty` 拿两次 `draftOf` 的 JSON 对比,而 `draftOf` 每次调用
  都给审核步骤铸新 key(`s${minted+=1}`),于是**只要有一个审核步骤,永远判定为脏**,任何已保存的题目
  都发布不了。改为比较**保存时真正会发出去的内容**(新增 `stated()`:标题/分组/条数 + `configOf`,
  不含笔尖自己的 key),并把已保存那侧 memo 住,顺带不再每次渲染铸一批 key。
- **列表页发布后跳进编辑页**:Radix 的菜单挂在 portal 里,而 **React 的事件沿组件树冒泡、不沿 DOM 树**,
  所以点菜单项等于点了它背后的行。给 `DropdownMenuContent` 加 `stopPropagation`。
- **⋮ 按钮上下不对齐**:分组行是 flex、题目行是八列 grid,末列位置各算各的。分组行在 md 以上改用
  `grid-cols-[3.5rem_minmax(0,1fr)_auto_1.75rem]`——首末两列与题目行同宽,菜单自然落在同一条竖线上
  (实测各行 x 均为 1113)。
- **根下题目吃掉了分组编号**:编号只给分组,但计数器把题目也算了进去,于是「根下一题 + 一个分组」
  的分组显示为 2。改为**只有分组参与编号**。
- **根下能不能放题目**:保持可以。引擎允许题目挂在任意分组(卷面根也是分组),小型卷面不分段是合法形态;
  要禁止就得服务端一起改,属于领域规则,不自行裁决。改为把「混排」表达清楚:分组行加文件夹图标
  (原先的 chevron 暗示可折叠,而它并不能折叠)、嵌套行前加一个 `└` 转角(此前是一根悬空的竖线,
  显得突兀)、分组行加大纵向留白。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 627 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过。

### 小数、可见性与审核链条连线(2026-08-15)

- **小数一律按整数算**:新增 `unitsOf/amountOf`(万分之一为单位,与库里四位小数同刻度),
  题目上限、分组小计、卷面配额条、我的填报的条目分值全部改走整数,不再出现
  `0.1×3 = 0.30000000000000004`。实测「0.1 分 × 3」显示为 `0.3`。
- **输入框不显示记账零**:`100.0000` 在框里显示 `100`、`100.5000` 显示 `100.5`
  (题目分值、分组上限/下限的初值都过 `trimAmount`)。
- **草稿保存后会播一次入场动画**:`onSaved` 先清草稿再设题目 id,中间有一帧两者皆空——那一帧就是列表,
  于是屏幕先滑出去再滑回来。改为**先命名题目、后释放草稿**;实测保存全程八次取样都停在题目页。
- **工作人员填报的题目参评人员看不到**:此前只显示「自己填 + 有条目 + 已计分」的题目。
  「这道题由别人填」是题目的属性,不是隐藏它的理由——现在本轮的题目一律可见,只是不给填报入口。
- **审核链条连线不等长**:flex 项的 `min-width` 默认是 `auto`,勾的角色越多,步骤列就被内容顶宽,
  把旁边的连线挤没。步骤列改 `min-w-44`(角色名换行而不是撑宽),连线由 `flex-1` 改为固定 `w-12`
  ——实测三段连线均为 48px,与勾选多少角色无关。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 627 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过。

### 审核链条连线接到节点上(2026-08-15)

**「至少一条审核」的要求保留**(用户裁决),此前记在待办里的「审核链条可为空」不再推进,
`policy-stages-required` 与 evidence 驱动的「至少一个字段」都维持原样。

- **连线连的是容器不是节点**:此前把每个节点画成一列(w-24 / w-44),连线放在两列之间,
  于是线从「上一列的右边缘」画到「下一列的左边缘」——而圆点在各自列的最左边,线的左侧就空出一大截,
  标签越短空得越多。改为**两行网格**:第一行只放圆点,圆点后面跟一条 `flex-1` 的线填到下一个圆点;
  第二行放对应的文字。实测圆点中心 296/472/648/824(间距恒为 11rem),
  三条线分别是 308→460、484→636、660→812,**正好从一个圆点边缘接到下一个圆点边缘**,长度全等。
- 插入点也随之归位:每条线就是一个可插入位置(第一步之前、任意两步之间、最后一步之后),
  `onAdd` 由「相对某步的前/后」改为直接给下标。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 627 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过。

### 我的填报按设计稿重做(2026-08-15)

设计稿 `我的填报.dc.html` 的 2a(选中分组)/ 2b(选中题目)/ 2c(申报模态框)对照复刻。
页面宽度回到 `max-w-6xl`(默认档),左栏是页面的索引:**占满视口的剩余高度**并在内部滚动
——高度不是 `100dvh`(那是「视口 + 它上面那段」,会凭空多出一条滚动条),
而是量出自身在窗口里的位置后减出来的余量,实测栏顶 133px、栏底 1176px、视口 1200px,
文档高度恰好等于视口。

- **上传改 react-dropzone + shadcn**:`@qualy/ui` 新增 `./dropzone`(`Dropzone` 拖放区 +
  `FileTile` 文件行,零文案)。附件字段支持多选、按字段剩余名额截断、逐个上传(预留票据是按文件发的,
  六个并发就是六种被存储拒绝的方式),上传中单独一行带 Spinner。
- **图片预览改 react-photo-view**:样式经 `@qualy/ui/theme.css` 的 `@import` 引入
  (`.tsx` 里 import css 编译器看不见);缩略图点开即全屏,附件列表与表单共用一套。
- **表单**:必填项标星(`aria-hidden`,不进无障碍名,测试仍按原标签取控件);日期字段给出本轮
  ∩ 字段自身的允许区间;备注改 Textarea。
- **右栏三张卡**:评分依据(**占位**,数据未接,先留位置)、本题我已申报、提交后的流转
  (只说要过几手,不点名审核人——角色名参评人员本来就读不到)。
- **左栏**:新增「全部 / 待我处理」筛选(shadcn Tabs 作分段控件),筛选后不再缩进——
  上面的分组是为已经不在列表里的行留的脚手架。
- **分组详情**:进度条带游标 + 三段刻度(0 / 距上限还有 x / 上限);「本分组包含」与「我的构成」
  改成左右两栏;构成里的审核中/草稿按**真实条目数**统计。
- **右侧面板换栏时带方向**:进分组是「进去」、回上级是「出来」、同级换行是上下移
  (方向在 effect 里记录、渲染时读取,strict 双渲染不会把每次移动都算成没动)。
- **文案**:去掉「由学校登记」——这套系统不只给学校用,改为「无需申报」;
  工作人员登记的题目,标题从「我申报的条目」改为「已登记的条目」,空态同理。
- **登记题不再向参评人员展示审核链**:登记 trusted 直接生效(§13),链条不会走;
  它在 `entries.status` 上直接落 `approved`。但服务端**仍然要求配置链条**——申诉/复查轮
  从这份 revision 解析同一条链(§15),没有链的题目就是「无路可回的历史」,
  测试 `policy.test.ts` 已把这条钉住。因此改的是展示与题目编辑器的提示语,不是校验。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 627 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过(staged web assets)。

### 配置变更治理与 Review v2:第一、二步(2026-08-15)

用户裁决整套模型(记入 docs/assessment-design.md §32.62,九条,含施工顺序)。**方向不变**——
历史永远按旧版本解释,新版本是否作用于未结束的业务由管理员显式选择,并用新的 revision / round 表达,
不修改历史。本次落地施工顺序的前两步。

**① BLOCKED 的撤回死锁**(已修,`fa8f44e`)。`cancelReviewInstance` 只认 `active`,而提交时若当前
节点无人,实例落 `blocked` + 条目 `in_review`——于是学生撤不回(`entry-not-withdrawable`),
也没有审核人能推进,条目永久卡死。blocked 是「等人被任命」的运行态,`uq_review_instances_open`
本来就把它算作 open,收尾语句现在与之一致。新增升级测试:吊销唯一持有人 → 提交 → 断言 blocked →
撤回 → 断言 `completed/cancelled`,事件序列 `submitted, assignee-not-found, cancelled-by-submitter`。

**② 字段永久身份 + payload 投影**(已做,`e92985b`)。

- 字段带 `id`(永不改、永不复用)与 `key`(payload 槽位,同样不可改),新字段两者同值。
  **旧表单不回写**:没有 `id` 的字段以 `key` 为身份——那本来就是它当时的身份,而 item revision 不可变。
- **改类型 = 删旧字段 + 建新字段**(编辑器改 type 时重新铸 id 与 key):`2026-04-12` 不是一道现在要求
  文本的题的答案。
- 驱动新增 `projectPayload(fromConfig, toConfig, payload)`:按身份投影,不按位置、不按槽位名。
  `issuesOf()` 先投影再 decode,于是**删字段、换顺序、改 label、加可选字段一律不再被判为
  `incompatible-entry`**。`liveEntryPayloads` 随之带回每条 payload 自己那版 `formConfig`
  (以及 status / reviewInstanceId,影响分析器下一步要用)。
- 编辑器首个字段不再是字面量 `f1`——`f1` 是下一道题也会铸出的名字,而一个身份不能有两个主人。

**剩余七步未做**:ReviewPolicy v2(normal/doubt 分家、stage 永久 id)、
`ReviewInstance.policyRevisionId` / `currentRoute` / `currentStageId`、提交取当前策略、
影响分析器(两次 PATCH + `impactToken` + `expectedRevisionId`)、`needs_revision` 与 `EntryEvent`、
reroute 传播、编辑器影响弹窗。这些都要动 schema(review_instances 列改名与数据转换、entries 状态枚举、
entry_events 新表),按 CLAUDE 的规矩每一步都要配升级测试,因此没有半途落地。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 633 passed / 17 skipped;
`pnpm test:browser` 54 passed。

### Review v2 第一半:两条路线,步骤有永久 id(2026-08-15)

施工顺序第三步。`normalTerminal` 从写入路径消失,疑点链不再是普通链的后缀。

- **`reviewPolicy` 升为 `{normal:{stages},doubt:{stages}}`**,每个 stage 带永久 `id`。
  写入只接受这一种形状——旧形状(`stages` + `normalTerminal`)在保存时被 `policy-version-legacy` 拒绝。
  **读取两种都认**:`readPolicy()` 把旧形状按 marker 切成两条,步骤名确定性派生为 `legacy-<在那张单子里的下标>`。
  历史不回写(item revision 不可变),而派生是确定的,所以同样的字节每次读出同样的两条路线。
- **`ReviewInstance` 改为 `current_route` + `current_stage_id`**,去掉 `mode` 与 `current_stage_index`;
  `effective_chain` 列名保留(改名要重写每一轮已开的审核,买不到东西),内容变成 normal + doubt 两条已解析路线。
  `ReviewEvent` 补 `route` / `stage_id`——reroute 之后「哪一级审过」只有靠它才答得出来。
- **状态机**:普通路线任一级可 approve / reject / comment,有可进入的疑点路线时多一个 `raise-doubt`;
  `raise-doubt` **直接跳到 `doubt[0]`**,不是沿原链往后走。疑点路线中间级只能
  comment / recommend-* / `forward`,末级才能 approve / reject。`escalate` 更名 `raise-doubt`(普通侧)
  与 `forward`(疑点侧),事件同名;旧事件 `escalated` 的译法保留,历史照旧读得出来。
- **迁移 `20260815070000_review-routes.sql`** 带数据步骤,配升级测试(建旧库形态 → 跑迁移 → 断言):
  普通轮落 `normal/legacy-0`,已上报且站在 marker 之后的落 `doubt/legacy-2`。
  **一种旧状态在新模型里没有对应**:已上报但仍站在 marker 之前——新模型里提交疑点就离开普通路线了。
  这种轮子保留原步骤、留在普通路线(最不失真的读法,也是唯一不会把它送到没人派它去的层级的读法),
  测试把这条钉住。
- 编辑器现在写 v2,读两种;`StageDraft.key` 从「浏览器句柄」变成真的会存下去的步骤名。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 647 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过;`pnpm qualy generate` 无待生成(手写迁移已让库与实体一致)。

**下一步**:`ReviewInstance.policyRevisionId`(新一轮取当前策略版本,而不是被审 EntryRevision 当年那版)、
影响分析器、`needs_revision` 与 `EntryEvent`、reroute 传播、编辑器影响弹窗。

### 一轮审核走的是它开启时的程序(2026-08-15)

施工顺序第四、五步。此前「审什么」和「按什么程序审」是同一个事实:一轮从被审 EntryRevision
所引用的那版 item revision 解析路线。分开之后,管理员改审核链才有可能作用于后续轮次
——否则改完链,新开的轮子照样按学生当年填写时那版走。

- **`review_instances.policy_revision_id`**(新列 + 复合外键 restrict)。已开的轮子回填为它们
  实际走过的那版(就是那个被引用的 item revision),行为一字未变,只是把事实写到了能被读到的地方。
- **提交取当前策略**:`resolvePolicy(readPolicy(item.currentRevision.reviewPolicy))`,
  不再取 `entryRevision.itemRevisionId` 那版。被审的内容仍然是写下来的那份
  (`entry_revisions.item_revision_id` 不动,审核人看到的仍是学生当时填的那张表单)。
- **草稿提交要过今天的表单**:旧 payload 先按身份投影到当前 formConfig,再按当前 formConfig 校验;
  不通过就 `entry-needs-revision`(「这道题的表单改过了,请按现在的要求补充后再提交」),
  而不是含糊的「不能提交」。**尚未进入审核的东西没有什么可 grandfather 的**——一份在表单加了必填项
  之前就搁着的草稿,就是还没填完。已在审 / 已通过的条目不受影响。

测试改写了原来那条「按它自己引用的配置判定,不按今天的」——那正是本次推翻的语义。新测试两段:
①表单收紧后旧草稿提交被 `entry-needs-revision` 拒;②表单还原、只改审核链指向没人持有的角色后,
提交成功、`policy_revision_id` = 当前版本、冻结路线里是新角色、轮子落 `blocked`(没人持有,等着,
不是拒绝),而 `entry_revisions.item_revision_id` 仍指向旧版本。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 647 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过;`pnpm qualy generate` 无待生成。

**下一步**:影响分析器(两次 PATCH + `impactToken` + `expectedRevisionId`)、
`needs_revision` 与 `EntryEvent`、reroute 传播、编辑器影响弹窗。

### 打回不是驳回:`needs_revision` 与条目自己的日志(2026-08-15)

施工顺序第七步,外加 §32.62 第七条里管理员的独立干预口——两者互为前提:一个状态没有生产者
就是死代码,一个干预没有落点就无处可去。

- **条目状态新增 `needs_revision`**(界面「待补充材料」)。**不复用 `rejected`**:否则以后统计
  驳回率,会把管理员的配置调整与流程干预全算成审核驳回。`canEdit` 与 `appendEntryRevision`
  接纳这个状态,改一版就回到 `draft`。
- **`entry_events` 表**(append-only)。已通过的条目被退回时**没有 open ReviewInstance 可记**,
  只 UPDATE 状态会在历史里留一段无法解释的变化。`cause_revision_id` 预留给下一步的配置传播
  (由那一步写入),现在只由手工干预写 `kind='revision-required'` + 理由。
- **`POST /assessment/entries/{entryId}/interventions`**(`kind: 'return-for-revision'`,理由必填)。
  权限走 `requireRosterReach`(能改这道题的人本来就该能把被它卡住的条目退回),**不受审核阶段闸门约束**
  ——这正是「卡住的条目怎么出来」的出口,而闸门已经关了恰恰是它要工作的场景。
  **`decideReview` 一字未动**:它仍然要求调用者真是当前 stage 的审核人,管理员不会因为有权改题
  就变成那一级的审核人。旧轮以 `outcome='superseded'` 收尾,不是 rejected。
- **登记/导入来源的条目不可退回**(`entry-not-returnable`):它们不是本人能改的,退回就是把条目
  丢到没人能动的地方;这类错误照旧走作废后重新登记。
- `getEntryHistory` 现在带上条目自己的事件,历史面板单独渲染,不伪装成一轮审核。

新测试:陌生人干预 `ACCESS_DENIED`;空理由 `reason-required`;卡在无人层级的条目被退回后
状态 `needs_revision`、轮次 `completed/superseded`、事件序列
`submitted, assignee-not-found, returned-for-revision`、条目日志记下 `revision-required` 与理由;
本人再存一版即回到 `draft`;已通过的条目同样可以被要求补充。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 648 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过;`pnpm qualy generate` 无待生成。

**下一步**:影响分析器(两次 PATCH + `impactToken` + `expectedRevisionId`)、reroute 传播、
编辑器影响弹窗。

### 配置变更的影响分析与传播(2026-08-15)

施工顺序最后三步一次落地——它们咬合太紧,分开会留下「409 里的选项没人执行」这种半成品。

**保存不再硬拒绝**。`issuesOf()` 里那段「拿新表单 decode 每条在审/已通过的 payload,
一条读不通就 `incompatible-entry` 禁止保存」删掉了。它把顺序调整、删字段、加可选字段
一并当成会毁掉现存条目的改动,而真正有破坏性的改动它又只会说「不行」。

**两次同一个 PATCH**:

- 第一次不带 `effects`。安全就直接存;会影响在途工作就 **409 `ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED`**,
  带上影响报告(表单:在审/已通过各自的总数与不兼容数;审核:在途数、其中卡住数、
  当前环节仍在新策略里的数、环节已消失的数)。**整个事务回滚**——提问期间什么都没做一半。
- 第二次带上选择与 `impactToken`。token 是第一次统计时那份状态的哈希(条目 id/状态/版本 +
  轮次 id/状态/路线/环节)。**对话框开着的时候审核人还在干活**,拿一份已经变了的状态去执行
  一个没人看过的操作是不行的:对不上就重新返回最新报告。
- `expectedRevisionId` 一并引入(Item 此前没有乐观并发,score group 早就有):
  两个管理员开着同一道题,第二个人是在回答一份已经不存在的状态画出来的报告。
  不符 → `item-revision-conflict`。

**两个选择,不合并**。表单:在审/已通过各自「保持原样」或「打回」;
审核:「仅新轮次」/「仅迁移卡住的」/「迁移全部在途」。
**打回优先于迁移**,写死不商量:被打回的条目要重新提交,那一轮自然走新策略,
迁移它正要离开的那一轮是没人会看见的工作。

**迁移是新开一轮,不是改快照**。旧轮 `outcome='superseded'` 收尾 + `rerouted` 事件;
新轮 `origin='reroute'`、`initiator='staff'`、`supersedes_instance_id` 指回去、
`revisionId` 不变、`policy_revision_id` 指新版本、按**同一个 stage id** 落位。
`UPDATE review_instances SET effective_chain = ...` 是被禁止的写法——它毁掉「当时为什么走到这里」。
当前环节在新策略里没有了就**不猜**:留在原处(计入 `keptOnOldPolicy`),
影响报告里点名有几条这样。
一次改动的选择与结果一并进 `batch_config_revisions` 的 diff(`propagation` 与 `propagationResult`)。

**编辑器**:保存带 `expectedRevisionId`;收到 409 弹影响对话框(两组单选,按报告决定显示哪几组),
确认后原样重发同一份配置 + 选择。理由跟着走——回答了问题不代表这一轮不再需要理由。

新测试:①第一次保存返回报告且**库里一动没动**(条目仍 in_review、版本仍是 1);
②带过期 token 的第二次再次被挡回;③正确 token + 「在审打回」→ 保存成功、条目 `needs_revision`、
条目日志的 `cause_revision_id` = 新版本;④不影响任何人的改动直接保存,不问;
⑤`expectedRevisionId` 过期 → `item-revision-conflict`;
⑥卡住的轮次迁移:旧轮 `completed/superseded`、新轮 `origin='reroute'` 且 `supersedes` 指回旧轮、
停在同一个 stage id、条目指向新轮、新审核人的收件箱里能看到它。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 650 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过;`pnpm qualy generate` 无待生成;
`prettier --check` 全绿。

§32.62 的九条至此全部落地。

### 界面文案按纪律清一遍(2026-08-15)

CLAUDE 的「界面文案是引导,不是说明」此前只在新写的地方被遵守,存量里积了不少违规。这次逐条过。

**删掉解释实现机制的句子**。它们归 docs/ 与代码注释:

- 版本说明「保存会生成新版本,已提交的申报仍按原版本计分」→ 只留「第 N 版,X 保存」。
- 「我的构成」下的「只有审核通过的条目计入。上限与下限在结算时生效。」→「仅统计已通过的条目。」
- 影响对话框里那句「被打回的条目不参与迁移:它重新提交时自然走新流程。」——纯机制,**整条删除**。
- 「卷面就是最外层分组」这类复述领域模型的 hint 全部换成下一步动作。

**删掉自夸与自我安慰**:

- 「所有数据将被妥善存档」→「归档后本批次只读,不能再填报或审核。」
- 「结构在本轮开始前都可以重排,**现在选哪条都不算数**」——这条消息(`paper-start-reassure`)**整条删除**,
  它是在替设计意图辩护,不是在引导。
- 「只问两件事」是对界面自身的评论,删掉。

**占位不要承诺未来**:评分依据的占位从「这里将显示本项对应的评分条款原文。」
改成陈述当前状态的「尚未关联评分条款。」

**同一概念只用一个词**。审核那套此前有六种说法(审核链条 / 审核链路 / 审核流程 / 疑点链 /
普通审核 / 疑点上报),现在固定为:**审核流程**(整体)、**常规审核** 与 **疑点审核**(两条路线)、
**提交疑点**(动作)。旧事件 `escalated` 的译法也跟着改成「提交了疑点」——对读者而言是同一件事。
另外「管理事实」(内部词)→「事项」,「给学生的说明」→「给申报人的说明」(全站用参评人员/申报人),
「组织链」→「这个人之上」。

**顺带**:删掉本轮重做时被我自己弃用的 5 条死文案(`entry/terms`、`entry/after-submit`、
`entry/file-pick`、`entry/todo`、`items/stage-doubt`)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 650 passed / 17 skipped;
`pnpm test:browser` 54 passed(一处按标签取控件的断言随文案同步);`pnpm build` 通过;
`catalogs.test` 全语言完整、无孤儿键。

### 申诉与疑点:一套引擎,四个阶段开关(2026-08-16)

裁决记入 §32.63。**不做两套审核状态机**——同一个 Review 引擎,三类独立动作,
两种 ReviewInstance 行为模式。

- **四个阶段开关,任意组合**:`entry.submit` / `entry.resubmit`(界面叫申诉)/
  `review.process` / **`review.raise-doubt`(新增)**。补报期可以同时开普通提交与申诉;
  申诉期通常只开申诉与处理审核。`raise-doubt` 不做 RBAC 权限——谁能处理当前节点已由
  `review.process` + 节点/角色决定,再加一条可授予的权限只会让管理员维护两份几乎相同的勾选,
  而且「可授予」会暗示它能让不是审核人的人变成审核人。它与参评动作同类,新增 `REVIEW_ACTION_CODES`
  这一档(不进权限目录,进 PHASE_GATED),阶段编辑器自动多出这一项。
- **`rejectPolicy` 冻结在轮次上**(`any-stage` / `terminal-only`),不从当前阶段实时读。
  否则填报期转入疑点的那一轮,进了申诉期就突然中途不能驳回;申诉期开的那一轮,
  窗口一关又变回任意节点可驳回。**阶段决定能不能开这种轮,轮次决定开完之后怎么走。**
- **两个入口,一套开轮逻辑**:普通提交固定 `initial / normal / any-stage`,
  申诉固定 `appeal / doubt / terminal-only`。这两组不给管理员配——能配出「叫申诉但第一级就能打回」
  的组合是在造本业务没定义的流程。
- **申诉锚定被申诉的那一轮**:`POST /assessment/review/instances/{instanceId}/appeals`,
  目标必须 `completed` 且有结论;新轮 `revisionId` 与它相同(**申诉的是结论,不是材料**),
  并记 `appealedInstanceId`。
- **同一 Entry 同时只有一轮开着**(数据库 partial unique index 本来就这么约束)。
  被驳回后二选一:改材料重新提交(normal),或不改材料申诉这次结论(doubt)。界面给两个按钮。
  「有没有开着的轮」改看轮次自己的 state——`entries.current_review_instance_id` 在轮次结束后
  仍指着它(那正是读者找结论的路),拿它判断会把每条已结束的申报都当成还在审。
- **疑点链变成真正的审核链**:取消 `recommend-approve` / `recommend-reject` / `forward`,
  中间节点「通过」即「本级无异议,转下一节点」。`ReviewDecision` 只剩四个。
- **不设疑点次数硬上限**。「每天最多 10 条」会逼审核员在第 11 条上要么替不确定的事做决定、
  要么等明天,并制造「今天名额不多,这条算了」的博弈——在决定奖学金的系统里这是错误的激励。
  治理靠:理由必填(已有)、一轮最多转一次疑点(状态机天然保证)、以及日后的疑点率异常提示。

新测试:①填报期的疑点全程(转入疑点后不能再转、中间级可以驳回、approve 即转下一级);
②申诉窗口——阶段关掉 raise-doubt 后审核人收到 `phase-closed`;陌生人申诉得到
`ASSESSMENT_REVIEW_NOT_FOUND`;空理由 `reason-required`;重复申诉 `review-already-open`;
新轮 `origin='appeal'`、`route='doubt'`、`reject_policy='terminal-only'`、
`revision_id` 与被申诉轮相同、`appealed_instance_id` 指回去;中间级只有 approve/comment、
驳回被拒,链尾才 approve/reject/comment。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 651 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过;`pnpm qualy generate` 无待生成;
`prettier --check` 全绿。

### 疑点改叫复核(2026-08-16)

界面上的「上报疑点 / 提交疑点」改为**提请复核**,「疑点审核 / 疑点流程」改为**复核流程**
(与「常规审核」并列的短标签用**复核**)。**只改中文**:标识符、事件 kind(`doubt-raised`)、
阶段动作码(`assessment.review.raise-doubt`)、英文 default 一律不动——
它们是英文域名词,而且阶段动作码存在各批次的 `permission_profile` 数组里,
为一次中文改名去迁移那份数据是把文案问题变成数据问题。中英文各自选词、不互相直译,
本来就是本仓的译法规矩。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 651 passed / 17 skipped;
`pnpm test:browser` 54 passed(两处按标签取控件的断言同步);`catalogs.test` 全语言完整。

### 疑点改叫升级/复核,连代码一起(2026-08-16)

裁决记入 §32.64。上一次只改了中文,这次按用户的完整方案把英文 UI 与代码领域名一起换成 escalation
——「当前审核人无法判断,于是把事项交给另一个决策机制」在工作流领域就叫 escalation,
而「疑点」把它说成了对当事人的调查。

- 中文 UI:提请复核 / 复核流程(短标签「复核」);英文 UI:Escalate for review / Escalation route。
- 代码:`ReviewRoute = 'normal' | 'escalation'`、`ReviewDecision` 的 `raise-doubt` → `escalate`、
  事件 kind `doubt-raised` → **`escalated`**(与拆分前的历史事件同名——本来就是同一件事,
  客户端不必再为一个概念挂两条译法)、阶段动作码 `assessment.review.escalate`。
- 迁移 `20260816010000_review-escalation-naming.sql` **只改被查询读的值**:
  `current_route`、`review_events.route` 与 `kind`、`batch_phases.permission_profile`
  与 `phase_templates.phases` 里的动作码。**不改** `effective_chain` 与 item revision 的
  `reviewPolicy`——按规矩不可变,读取侧同时认 `doubt` 与 `escalation`,
  用的是已经在读「一张单子加一个 marker」那版的同一个接缝。
  写迁移踩到的一处:`check` 约束必须先 drop 再 update,否则行还没搬完就撞上仍写着旧值的约束
  (升级测试直接红,不是靠眼睛看出来的)。
- 上次说「阶段动作码存在 permission_profile 里,为改名去迁移那份数据不值当」——这次改的不只是文案,
  是整套领域名,值当;那份数据是 jsonb 数组,逐元素替换一条语句。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 651 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过;`pnpm qualy generate` 无待生成;prettier 全绿。

### 任命权成为角色的一部分:role_grant_rules(2026-08-16)

用户裁决(记入 CLAUDE.md 访问模型与授权节):RBAC 负责全部「谁能给谁分配什么角色」,
Assessment 只消费 RBAC 并维护批次对组织权限的接受状态。不做 delegation graph、不做级联撤销、
不做 level 数字。

**RBAC 新增**:

- `role_grant_rules(tenant_id, granter_role_id, target_role_id)`——granter → target 的 DAG,
  两个 tenant-scoped FK cascade。语义:「制度上这个岗位由谁任命」,与「你有没有这么大的权」
  (no-escalation)互不替代——学院管理员可以持有年级管理员的全部权限,仍不是任命学院管理员的人。
- **授予算法五问**(原四问 + 任命规则):self 禁令 → grant-manage WHERE(原有)→ canonical 角色
  保留问(原有,先于规则以保留其专用文案)→ **任命规则 WHAT**(新)→ eligibility/anchor(原有)
  → no-escalation(原有)。任命规则要求:actor 经有效、非 resource-scoped 的授予持有某条 rule 的
  granter 角色,**且该持有覆盖新授予的锚点**(学院管理员对辅导员的任命边只在自己学院的子树内有效);
  tenant-wide 持有覆盖一切。canonical tenant-admin 唯一豁免规则表(不豁免 eligibility/anchor)。
- **self-grant / self-revoke 一律禁止**(`GRANT_SELF_FORBIDDEN`):权限由他人授予,辞任将来是
  独立业务动作。`options`(角色选择器)同步这两条,拒因映射 'authority'——选择器不许诺写入会拒绝的。
- **resource-scoped 授予走同一条完整路径**:`createScopedAssignment` 契约从 `createdBy` 改为
  `actor: Principal`,`grants.scoped()` 依次跑 self/WHERE/保留问/任命规则/eligibility/escalation;
  端口错误仍归一为 ACCESS_DENIED,但 reason 带上内部拒因标签(日志可读,不进界面)。
- Role 新子资源 `GET/PUT /iam/roles/{roleId}/grantable-roles`(version CAS,系统角色拒编辑),
  RoleEditor 增「本角色可任命的角色」勾选组。

**Assessment 删掉的**(checklist 第十一条):addStaff 里逐权限 `canAt` 循环(自实现 no-escalation)
与 `canAt(MANAGE, node)` 的 delegation 判断——现在只验证**批次适用性**(节点∈批次单元、
角色权限⊆STAFF_CODES、批次管理入口),授权判断全部发生在 rbac 的授予路径里。
**批次“人员权限”页可以把自己加成工作人员、加了又删不掉的不对称问题在根上消失**:
自授在 rbac 被拒,removeStaff 原有的 self-adjustment 拒绝语义与之一致(自己的行由别人调整)。
`assessment.batch.access.manage` 按裁决不加。

新测试:rbac 任命矩阵(有边+覆盖 → 成功;无边(平级复制自己)→ GRANT_RULE_REFUSED;
有边但持有不覆盖目标节点 → GRANT_RULE_REFUSED;自授 → GRANT_SELF_FORBIDDEN;
canonical 无边直授成功;options 拒因与写入一致)、自撤回拒绝、assessment 自加工作人员被拒。
存量测试改写三处:管理员并发撤销测试改为互撤(自撤已被禁),两处 grant 目标从 actor 本人改为他人。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 653 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过;`pnpm qualy generate` 无待生成;
entity-parity/error-codes/catalogs/frozen-routes 全绿。

### 我的填报按设计稿 3b:回到 wide,条目改成两列卡片(2026-08-16)

设计稿 t3 的论证:default(1152)下详情栏恒为 728px——减两侧 24 内边距、352 结构栏、24 间距,
屏幕再宽也不涨,1920 的屏两侧白掉 544;wide(1440)下详情栏 1016。不用 full:
不设上限的容器在 2560 的屏上一条申报会长到读不回行首。

- **`BatchScreen` 回到 `size="wide"`**(此前按用户指示改回过 default;本次是用户按设计稿 3b 的
  新裁决,理由写进了代码注释)。
- **已提交条目从"border-b 分隔的整行"改为卡片**(`rounded-xl border bg-card p-4`),
  `xl` 以上两列并排(设计稿"可以接着说"里建议的分界正是 1280),以下单列。
  文本答案单行截断(title 提供全文,完整内容一步进历史)——卡片是用来区分条目的,不是读全文的。
  标签列 6rem 固定,两张卡并排读起来像同一张表。
- 结构栏 352px(w-88)、状态"描边+圆点"样式与主题圆角本就与设计稿一致,无需改动。

实测(1680×1000,临时 harness,已删):容器 max-width 1440px;四张卡两行,每行共享同一 top;
1100 宽时四张卡各占一行。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 653 passed / 17 skipped;
`pnpm test:browser` 54 passed;`pnpm build` 通过;prettier 全绿。

### 附件的两种大小、模态框内可下载、满额按钮不消失(2026-08-16)

- **模态框里上传完就能下载**。服务端本来就允许 owner 读回自己 staged 状态的上传
  (item-lifecycle 测试早已钉住),缺的是入口:`CitedFile` 只有移除 ✕。补一个下载按钮,
  与已提交侧的 AttachmentLink 同款。
- **紧凑列表里附件一行一个**。`AttachmentLink` 增加 `compact` 形态:回形针 + 文件名一行,
  图片点名字原地看大图(另给一个小下载图标),其他类型点名字即下载。
  「我申报的条目」卡片用 compact;填报模态框维持大 tile(那里在操作文件,缩略图有用)。
  设计稿 2b 的条目行本来就是小图标 + 文件名。
- **条数占满不再藏按钮**。「去申报」在满额时保留为 disabled + hover tooltip
  (文案复用 `refuse-max-entries`)。消失的控件读起来像页面丢了东西,而按不了的原因正是
  读者想知道的。登记题、已停用题照旧不显示——那里按钮从来就不存在。
  disabled 按钮吞掉指针事件,tooltip 挂在包它的 span 上。

浏览器回归测试一条:满额时按钮可见且 disabled、hover 出现原因、卡片里附件名是一行链接。
顺带修了 fixture 的潜在 bug:`item(over)` 收了 override 参数却从没 spread(`entry()` 有,
`item()` 漏了),此前所有用例恰好都用无参 `item()` 才没暴露。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 653 passed / 17 skipped;
`pnpm test:browser` 55 passed;`pnpm build` 通过;prettier 全绿。

### 终审对账:两条通道、一条授权路径、一次改名(2026-08-16)

与审计的最终裁决逐条核对,已做的确认、没做的补齐:

- **两条通道语义核实(无需改码)**。通道 A(组织同步):`applicableAssignments` 用
  `codes: [...BATCH_STAFF_CODES]` 让 rbac 做投影——带批次外权限的组织角色照常同步进批次,
  只取综测认识的那部分,从不拒绝。通道 B(批次任命):`addStaff` 整体校验
  「角色全部权限 ⊆ BATCH_STAFF_CODES」,越界即整体拒绝(`permission-not-delegatable`),
  绝不静默裁剪;`staffOptions` 用同一判定标 `beyond-batch`,选择器与写入同判。
- **rbac 授权合为一条内部路径**。`grants.ts` 收敛出单一 `grantRole` 核心
  (resource 可选),`grant` 与 `scoped` 只是薄适配器;顺带修平两处不对称:
  org 侧授权现在也写 `createdBy`(此前只有 scoped 写),scoped 路径获得
  GrantExists 约束翻译。`insertScopedGrant` 从 db.ts 删除。
- **STAFF_CODES → BATCH_STAFF_CODES**。改名并重写文档注释:两扇门共用这一张表,
  `assessment.batch.manage` 被刻意排除在外——批次不得递归地把「管理批次」交出去。
- **通道 A 钉住测试**。effect-assessment 新增
  `syncs an office that carries more than the batch, and refuses to appoint one`:
  一个同时带 `assessment.review.process` 与 `iam.grant.manage` 的辅导员式组织角色,
  同步进批次(listBatches 可见、acceptance 只留综测码),而同一角色在批次内任命被
  `ASSESSMENT_ACCESS_INVALID` 拒绝、staffOptions 标 `beyond-batch`。
  实查:`getRolePermissions` 按活跃 catalog 过滤,测试装配里没有 org 插件,
  批次外权限得用本装配确实注册的码(iam.grant.manage)才测得到拒绝分支。
- 其余审计项(角色只在 RBAC 界面定义、批次里只做指派;不建 bindingMode/预设;
  不加 assessment.batch.access.manage)核对为已满足或维持不建。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 654 passed / 17 skipped;
`pnpm test:browser` 55 passed;prettier 全绿。无 schema 变更,不涉迁移。

### 审核工作台:设计稿 1a–1i 全量落地(2026-08-16)

按设计稿(审核页面.dc.html)实现审核工作的完整界面,三项开场裁决:智能审阅整套 AI 提示
**留占位不占列**;退回/复核事由**顺带建配置后端**;5 秒延迟提交 + ⌘Z 撤回**照做**。

**后端**(schema 迁移 20260816054833_review-workbench):

- `assessment_batches.review_reasons` jsonb:`{reject: [], escalate: []}` 两组事由标签,
  updateBatch 可改(计入配置事件日志),batchView 携带;`review_events.reason` 存选中标签原文——
  列表是报价不是历史,改列表永不改写已说过的话。
- decideReview 收 `reason`:批次配置了该动作的事由表时必填且必须在表内,未配置则不收;
  approve/comment 不收。校验与写入同在批次锁内。
- 队列行(listReviewInbox)携带填报本身:`values`(按题目表单字段投影,最多前三个非附件字段,
  少则少显,从不写摘要)、学号、单位(id+名)、route、附件数;新增 `batchId` 过滤与
  `handledToday`(按批次时区的当日决定数——日子属于时区,只有批次有时区)。
- 审核详情携带 `businessNo`/`unitName` 与 `context`(仅页面读取解析,决定路径留 null 不进锁):
  `worth`(通过后计/条数上限/组名与组上限/材料时间范围)、`siblings`(该参评人本题全部条目,
  读各自最新版本)、`previous`(上一轮的结论:动作/事由/说明/人/时间)。
- 实查:v4 `Schema.Struct` 默认忽略多余键(vendored Schema.test.ts:149 + node 实测),
  而 formConfig 按原文存储,测试得以在 fixture driver 下携带 `fields`。

**前端**:

- 队列页(1a/1h/1i/1e):按题目/按提交时间/按参评人三种排法 + 题目/单位筛选 + 搜索;
  按题目分组的列头是该题真实字段标签;行级状态章(待我审核/第 N 轮/复核中);
  无职责与空队列两种空态分开说;30 秒自动刷新。
- 工作台(1b/1d/1g):chrome="none" 全屏无 banner 无卡片;左侧连审队列(已决定的置灰带结论);
  连审进度条与位置;参评人头部(头像/学号/单位/复核章/边缘禁用的上下翻页 + tooltip);
  主栏 = 复核横幅 → 此前的意见(含上一轮结论块)→ 填报内容 → 编号材料(1–9 直达)→
  智能审阅占位;侧栏 = 评分依据占位 → 审核链条(两条路各画各的)→ 该题配置 → 其他条目;
  底部决定栏:说明框(与按钮同高)+ 备注/提请复核/退回(红底)/通过(绿底)+ 提交决定。
  一组审完(1g):通过/退回/提请复核计数、用时、下一组、决定清单。
- 键盘:A/R/E/C 只选择(全部 preventDefault,修掉 R 漏进弹层输入框的字母),⌘↵ 才提交,
  ⌘Z 撤回,J/K 上下件,1–9 开材料,? 面板(shadcn Kbd 组件,新增 @qualy/ui/kbd),Esc 逐层退。
  photo-view 打开时让位(它自带 Esc 关闭与左右键,实查 1.2.7 源码)。
- 5 秒延迟提交(useDeferredDecision):暂存→倒计时药丸→到点经 typed client 发出;
  期间 ⌘Z 撤回并回到那件;连续暂存则前一件立即发出;pagehide/路由离开经 sendBeacon
  立即提交(带上 JSON body,cookie 随行);冲突/失败 toast 并从会话清单标记。
- 弹层(1c/1f):事由标签单选(配置了才显示,必选)+ 必填说明 + Esc 取消带 Kbd;
  退回弹层的修改建议:S 切换、数字键定位字段、输入框默认全空(placeholder 保持不变),
  只有写了字的字段进入建议 payload,已写与未写样式分明;提请复核弹层画复核流转
  (末端标"作出结论",其余"只能给出意见")。
- 附件预览:PDF 走 DocumentLightbox——fetch 字节 + 显式 application/pdf 的 blob 进 iframe,
  浏览器自带阅读器(Firefox 即 PDF.js、Chrome PDFium),不引 pdfjs-dist;下载纪律不破:
  只有 LOOKS_LIKE_A_DOCUMENT(仅 pdf)才内联,html/svg 照旧只下载。Esc 关闭(Radix)。
- 批次设置新增两组事由编辑器(chip + 添加/删除),与其他字段同一份保存。

**测试**:node 新增 review-workbench.test.ts(队列行投影与当日计数;事由必选/越表/错位的
三种拒绝;事由入事件;context 的 worth/siblings/previous);浏览器测试改走新流程
(行即按钮、通过=选择+提交决定+撤回窗口、一组审完屏、退回弹层必填说明),
批次 fixture 补 reviewReasons。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 656 passed / 17 skipped;
`pnpm test:browser` 55 passed;`pnpm build` 通过;`pnpm qualy generate` 产出上述迁移后无漂移;
prettier 全绿。

### 审核工作台打磨:配色、文案、键盘、附件尺寸(2026-08-16)

- **三个按钮不再是三块重色**。退回与通过是「选择」,改成 rose/emerald 浅底描边;
  提交决定是唯一的实心(primary/90)。弹层里同理:确认退回一枚玫红实心,取消安静。
- **文案按纪律重写**。删掉解释机制与复述领域模型的句子:「通过后计入成绩,退回后参评人
  可修改重交…」→「提交后 5 秒内可撤回。」;「本轮提交在此之后,请对照核对…」→
  「对照检查是否已按此修改。」;「末端」改「最后一步」;事由提示由「选择一项,会记入经过」
  收成「选择一项」;连审位置由整句改 `{at}/{count}`。
- **退回弹层的快捷键真的能按了**。原来挂在面板 div 上,而弹层一开焦点就在说明框里,
  事件根本不冒泡到它。改为弹层挂载期间在 document 上监听:⌥S / ⌥1–9 在打字时也生效,
  不打字时裸键即可;面板只留 ⌘↵ 提交。
- **⌘C 不再被备注吃掉**。主界面键盘处理在字母分支前先放行任何带修饰键的组合。
- **页面无「·」**。分隔符全部去掉:服务端 siblings 不再拼接字符串(改为返回自己的
  label/value 数组),列表摘要用表意空格连接,其余位置改为独立 span 加间距。
- **同题其他条目可点开**。侧栏每条都是按钮,弹出该条的字段全文——重复申报正是靠并排读
  两条发现的。授权面没有扩大:这些条目本来就随审核详情下发(reviewer 对本题本人有判断权),
  没有新开 getEntry 那条需要管理反射的门。
- **说明框改单行 + 放大**。原来 textarea 会长出细滚动条并换行,把整排按钮顶下去;
  现在是 InputGroup 单行,右侧一枚放大按钮开真正的多行框(⌘↵ 收起)。
- **附件在审核页画大图**。`AttachmentLink` 收敛成一个组件三档:`line`(条目卡片一行)、
  `tile`(填报表单的小缩略图)、`preview`(审核页 224×144 大图 + 文件名 + 下载),
  序号 Kbd 压在图角上;`compact` 旧开关退休,调用点改成 `variant`。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 656 passed / 17 skipped;
`pnpm test:browser` 55 passed;`pnpm build` 通过;prettier 全绿。

### 审核工作台第二版:对照版本、完整经过、满屏空态、导航计数(2026-08-16)

设计稿从 1a–1i 扩到 1a–1k,按新稿补齐,并处理口述的十项。UI 以设计稿为准。

**后端**

- `getEntryHistory` 开出审核人这道门:持有该条目**开放轮次**判断权的人可读它的完整经过
  (版本 + 各轮事件)。判定复用 `mayReview` 那一份 SQL(review/db.ts 的 `mayReviewEntry`),
  不新开概念,也不放宽给「去年审过」的人。陌生人照旧连存在都读不到(测试钉住)。

**契约与外壳**

- 新增 UI 插槽 `workspace-shell/navigation-badge`(many):外壳在每个导轨条目旁给出插槽并
  传入条目 id,谁拥有那一页谁回答自己的计数。原因写进契约注释:导航是**按 principal 投影
  一次**的 manifest,而「还剩几件」在人工作时一直在变,数字进不了 manifest。
  综测供 `QueueBadge`,只认自己的 id,零件时不画。

**工作台(1b/1d/1j)**

- 队列头部左侧加返回按钮——没有出口的工作台是死路。
- 填报内容头部重做:第 N 版 + 时间、**对照 D**(与上一版逐字段比对,改动处左侧标线、
  下方给「上一版 …」删除线或「未填写」)、**版本 ⇧D** 打开 1j 版本选择(只列送审版之前的版本,
  往后比就是拿它跟它之后发生的事比)。
- 此前的意见右上角 **完整经过 H**:侧拉抽屉按轮次倒序,每轮标出判的是第几版,含各轮事件、
  事由与说明。
- 证明材料头部加**全部下载**。
- 四个按钮都有 tooltip;底部提示随状态变:未选→「先选一个决定」、选了通过→「通过后计入成绩,
  提交后 5 秒内可撤回」、末端→「这是最后一步,通过即为终审」、备注→「不改变流转」、
  复核路上→「这一步只能给出意见」。
- 键盘面板补 D / ⇧D / H;退回弹层的建议快捷键从 ⌥S 改为 **⌥G**(S 已被别处占用)。

**队列页(1a/1e)**

- 分组按钮不再叫「连续审核」:改为「开始审核」+ 件数 Badge + ↵。
- 空态改满屏三态:已全部处理完(带今日件数)、尚无可审条目、无审核职责;下方常驻
  「两种不进入队列的情况」(等待指派 / 已被他人处理)。

**其他**

- 同题其他条目弹层接 `useLingering`,关闭有动画。
- 说明输入框 placeholder 由「写下说明」改「写下审核意见」类文案;清掉六个变成孤儿的 message。
- `history.tsx` 只导出组件,数据钩子(`useEntryHistory`/`valuesOf`/`HistoryRevision`)
  下沉 `review/model.ts`——`tools/tests/fast-refresh.test.ts` 抓到了混合导出。

**未做并说明**:1k 触摸端的「按住通过」与平板两栏收窄尚未实现(现有布局在 <lg 会堆叠但
不是设计稿的触摸版);设计稿的「核对要点」与「智能审阅」提示内容没有数据来源,
前者未画、后者保留占位。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 657 passed / 17 skipped;
`pnpm test:browser` 55 passed;`pnpm build` 通过;prettier 全绿。

### 审核工作台收口:去掉设计注解、空态文案、导轨点亮(2026-08-16)

- **「两种不进入队列的情况」从界面删除**。那是设计稿写给实现者的说明,不是给读者的界面;
  连同它用到的五条 message 一并清掉。
- **空态文案重写**,一句说完不重复:「待你审核的填报已全部处理 / 今日已处理 N 件。」、
  「暂时没有待你审核的填报 / 有新的提交会自动出现在这里。」——原来标题、正文、脚注
  三处各说一遍「会自动出现」。`empty-refresh` 这条也删了。
- **审核某一条时导轨保持点亮**。工作区导轨原本一律 `NavLink end`,`/reviews/:instanceId`
  就不再匹配 `/reviews`。改为按前缀匹配,只有「下面还住着别的条目」的条目才要求精确
  (概览是所有条目的前缀,不这么办它会在每一页都亮)。规则写进 RailEntry 的注释。
- **同题条目弹层的进出动画**。Radix 只在 Root 跨越开关时才有东西可动画,原来整棵子树挂在
  `lingering !== null` 条件下;改为随工作台常挂,`open` 与内容分别由状态和 lingering 决定。
- **五条按钮 tooltip 重写**,去掉「流转」这类内部词:「通过,计入该参评人的成绩」
  「交回参评人修改后重交」「转入复核流程,由后续步骤作结论」「记一句话,这一件仍等你处理」
  「发出你选好的决定」。

**地址栏的选择(裁决)**:审核实例已经是路径参数(`/reviews/:instanceId`);排法、题目与
单位筛选、搜索词、连审范围继续用 query。它们是**同一个页面的取景**而不是不同的资源,
可分享、可后退、可为空,正是 `usePageQueryState` 存在的理由;把筛选提进路径会让
「没有筛选」也需要一个段,并把三种排法变成三条路由。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 657 passed / 17 skipped;
`pnpm test:browser` 55 passed;prettier 全绿。

### 审核工作台:动画与筛选行对齐(2026-08-16)

动画只加在「动作本身就是意思」的地方,全部经 `useReducedMotion`——减少动效时事实一条不少,
只是不扫过去。三个新原语进 `@qualy/ui/reveal`(motion 只此一处依赖,不进第二个包免得版本分裂):

- `CountdownRing`:按真实截止时间跑的倒计时环。撤回窗口本来只有一个数字,读到才知道;
  环让它一眼可见,而且是同一个事实画两遍,所以跑的是真 deadline 而不是固定循环动画。
- `DoneMark`:先描一圈再落一笔勾。清空队列是这份工作的目的,一个「打开页面时就在那儿」的
  静态勾说明不了任何事;画出来才是「这是你做的」。用在一组审完与「已全部处理完」空态。
- `Stagger`:分先后到场,给「先看标记、再看它是什么意思、再看下一步做什么」的屏。
- `Appear`:原地来去的东西(撤回条、对照出现的「上一版」行),带 AnimatePresence,
  否则「忽然不在了」读起来像故障。

接入点:撤回条进出 + 真倒计时环;连审换下一件用 `Drill move="next"`(是走到下一件,不是换了个页);
一组审完与空态用 DoneMark + Stagger;开启对照时每个改动字段的「上一版」行淡入。

**筛选行对齐**:「按题目/按提交时间/按参评人」的 TabsList 是 h-9,而两个筛选与搜索框写死 h-8,
所以整行差一像素级的错位。三者统一到默认 h-9;两个筛选从原生 `NativeSelect` 换成 shadcn
`Select`(radix 不收空字符串值,「不筛选」用 `all` 作它自己的名字)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 657 passed / 17 skipped;
`pnpm test:browser` 55 passed;`pnpm build` 通过;prettier 全绿。

### 一次按键提交了两遍:三个成因(2026-08-16)

现象:按 ⌘↵ 后既弹出撤回条又提示「先选择一个决定」,五秒后再报「该条目已被他人处理」,
刷新却发现自己其实已经审完了——「他人」就是自己一秒前那一次提交。三个独立成因:

1. **副作用写在 setState updater 里**。`useDeferredDecision` 的 flush 走
   `setPending((current) => { send(current); return null })`,而 apps/web 开着 StrictMode,
   React 会**重复调用 updater** 以暴露不纯——于是同一个决定 POST 两次,第一次成功
   (条目真的退回了),第二次撞 `ReviewConflict`。改为:待发的决定放 ref,`flush()` 先取走再置空
   再发送,任何第二次调用都取到 null、什么都不做。
2. **⌘↵ 被两个处理器各收一次**。弹层的面板处理器先跑并关掉自己,同一个原生事件继续冒泡到
   window 上页面自己的处理器,那时它读到的「没有弹层」已是新状态,于是又跑了一遍 `submitArmed()`,
   而此时没有任何决定被选中——「先选择一个决定」就是这么来的。改为:弹层的 ⌘↵
   `stopPropagation()`,页面的守卫从 render 闭包改成 ref(同一 tick 内就是准的)。
3. **退回弹层留着旧的面板键盘处理器**。它和后加的 document 监听同时在跑,S 被 toggle 两次
   正好抵消——这正是当时「按 S 没反应」的真正原因。旧的删掉,面板只留提交和弦。

**测试同步收紧**:`renderScreen` 现在在 `StrictMode` 下渲染,与应用一致。原来只有浏览器
开严格模式,套件不开,这类不纯 updater 在测试里根本不会现形。新增浏览器用例
「sends one decision per press, however it was pressed」:断言弹层确认后不出现
「先选择一个决定」,且 decideReview 只被调用一次。**已实测**:把 flush 改回 updater 形式后
该用例失败,改回来后通过——它确实钉住了这个回归。整套 56 条在严格模式下全绿。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 657 passed / 17 skipped;
`pnpm test:browser` 56 passed;`pnpm build` 通过;prettier 全绿。

### 被驳回不再是死路:三条出路与能力三态(2026-08-16,§32.65)

用户实测发现死锁:条目被驳回后不能改、不能重交、申诉又未开放、1/1 满额又不能删——
参评人被锁死。随审计对话逐项裁决(全文见 §32.65),本轮落地 P0/P1:

- **rejected 可原样重新提交**:同一 revision 开新普通轮(`from: ['draft','rejected']`);
  needs_revision 明确不可(那一轮要的就是不同材料),界面 blocked + 「先修改再提交」。
- **放弃申报**:draft/rejected/needs_revision 本人可置 voided(事件 `abandoned-by-submitter`),
  名额立即释放、历史全留;in_review 先撤回;approved 不可自弃。放弃不受阶段门控。
- **能力三态**:entry 的 edit/submit/withdraw/appeal/abandon 从四个布尔改为
  `{state: available|blocked|hidden, reason}`,读取路径(listMyEntries/getEntry)把
  真实 phase gate 一次问齐——按钮亮=调用通,申诉未开放时是 disabled+tooltip,不再点开必炸。
- **待重新提交**:驳回后修改在库里就是 draft(被驳回的是上一版,不是没提交的这一版),
  界面按 draft + currentReviewInstanceId 非空推导显示「待重新提交」,不加新库状态。
- **卡片出口**:已提交卡片补齐 修改/重新提交/放弃 三个动作位,全部走三态渲染。
- **历史按版本讲**:round 携带 origin/supersedes/appealed,「发生了一次变更」根因是
  rerouted/superseded 两个已有领域词没进对照表——现在各有人话(「管理员调整了审核流程」/
  「已转入新一轮继续」),轮次挂在它判的版本下面,空说明不再占行,事由标签上行。

**测试**:review-workbench 新增「lets a rejected claim go back as it stands, or be given up」
(原样重交 roundNo=2 但 revisionNo=1;放弃后 1/1 名额立即可再申报);entry-policy 的排除
读改断三态;浏览器 fixtures 迁移到新能力形状。

**缓建已裁决**(§32.65 待实现清单):聚合器可解释化 + max@1/top-n-sum@1(学生干部按最高
职务计分)、基础分 = derived Item(不做 ScoreGroup.base)、reviewPolicy mode:'none'、
declaration 题型、补件机制(SupplementRequest/awaiting_supplement/受限 requirement builder)、
resubmit 更名。本轮不动 schema,全部零迁移。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 658 passed / 17 skipped;
`pnpm test:browser` 56 passed;`pnpm build` 通过;prettier 全绿。

### 计分聚合可解释化:max@1 与 top-n-sum@1(2026-08-16,§32.65 待办①)

- **AggregatorDriver 换接口**:`fold(config, amounts) → bigint` 改为
  `aggregate(config, [{entryId, amount}]) → {total, entries: [{entryId, included,
effectiveAmount, reason}]}`。账目是产品(§8):「只取最高职务」必须能解释它留在零分的
  每一行,裸总数不是可接受的答案。并列取舍按金额优先、同额按送入顺序——scorer 喂入的
  顺序本身确定(byEntry),同一事实永远选同一条。
- **三个内建聚合器**:`sum@1`(原语义)、`max@1`(terms.md 明文:学生干部身兼多职按最高
  职务计分,不累计——cap 表达不了这个:min(2+2, 3)=3,政策答案是 2)、`top-n-sum@1`
  (config `{n}`,取最高 N 条之和)。
- **Breakdown 新行类 `entry-not-counted`**:已通过但按本题规则未计入,值 0.00,
  provenance 照带;成绩页有它的人话(「已通过,本题按规则计入了其他条目」)。
- **题目编辑器**接入「多条如何计分」:逐条累加 / 只计最高一条 / 计最高几条之和(带条数)。
- 纯函数测试 aggregators.test.ts 钉住:max 总分 2.00 而非 4.00、并列稳定取先送、
  top-n 计数、sum 不变;`maxEntries` 语义未动。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 662 passed / 17 skipped;
`pnpm test:browser` 56 passed;`pnpm build` 通过;prettier 全绿。

### 基础分与免审题:constant 题型 + reviewPolicy mode:'none'(2026-08-16,§32.65 待办②③)

- **全员计分题型 `constant`**(interaction `derived`,core 自带并注册):没有填报、没有审核,
  名单内每位参评人自动获得设定分值。基础分建模为 Item 而不是 ScoreGroup.base——
  账目必须能逐条命名九分从哪来(裁决理由见 §32.65)。scorer 支持非 Entry 贡献:
  `ScoreInputItem.derived` 由 item-type catalog 判定,Breakdown 新行类 `derived`
  (lineId `derived:<itemId>`,带 calculatorRef provenance),成绩页的人话「本轮自动计入」。
  对 derived 题创建条目被拒(`item-not-fileable`,创建即拒,不分参评人还是工作人员);
  我的填报页该题显示「自动计入,无需申报」,无申报按钮。
- **`reviewPolicy: {mode:'none'}` 显式免审**:「无需审核」必须说出来,空 stages 仍然是
  配置错误(validator 维持 `policy-stages-required`,测试钉住)。免审题提交即 approved
  (EntryEvent `auto-approved`),不建任何 ReviewInstance——没有轮次,自然没有撤回和申诉;
  队列里也不出现(测试钉住)。撤回相当于放弃这条已计入的?不——approved 后 withdraw
  hidden(能力矩阵原样适用)。
- **题目编辑器**:基本信息新增「题目类型」(材料申报 / 全员计分,创建后不可改);
  全员计分隐藏填报字段、审核、申报来源、条数上限,只留标题/分组/分值/说明;
  材料申报的审核节新增「按审核流程处理 / 无需审核」二选,免审时隐藏链条编排,
  校验项(字段必名、步骤必配)按类型与模式豁免。
- 测试:constant 题 total 3.00 + derived 行 + 拒填;免审题提交即 approved、成绩即时 0.20、
  队列无此件、空 stages 拒绝。test catalog 把 core 自己的 constantDriver 注册进 ItemTypeCatalog。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 664 passed / 17 skipped;
`pnpm test:browser` 56 passed;`pnpm build` 通过;prettier 全绿。无 schema 迁移
(题型与政策模式都活在既有 jsonb 配置里)。

### 一键声明题型 declaration(2026-08-16,§32.65 待办④)

- 新题型 `declaration`(interaction `entry`,core 注册):零字段、零附件,payload 就是 `{}`,
  一次确认即是完整申报;与 constant 的分界写在 driver 注释里——constant 是**发给**每个人,
  declaration 是**本人声明**「这件事对我成立」,因此照走该题配置的审核(或显式免审)。
  evidence 维持「至少一个字段」不放宽,声明是它自己的一种,不是被削掉字段的 evidence。
- 编辑器「题目类型」三选:材料申报 / 一键声明 / 全员计分;声明隐藏填报字段节,保留
  申报来源、条数上限、计分与审核节;configOf 抽出 aggregatorOf/reviewPolicyOf 三型共用。
- 测试:声明 + 免审组合——一次 createEntry({}) + 提交,立即 approved,成绩 0.50。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 665 passed / 17 skipped;
`pnpm test:browser` 56 passed;`pnpm build` 通过;prettier 全绿;零迁移。

### 一键声明补全前端两侧(2026-08-16)

用户指出「材料申报和一键声明前端没有任何区别」——④ 只接了后端与编辑器的一半,补齐:

- **参评人侧**:声明题的按钮是「确认申报」,一次按下创建 + 提交一气呵成,零字段弹框
  永不打开;toast 按结果说话(免审→「已申报,计入成绩」/ 有审核→「已申报,进入审核」)。
  遗留草稿不给「继续填写」(没有可填的),已提交卡片不给「修改」。
- **管理员侧**:抓到真 bug——填报字段节的门写的还是 `!granted`,声明题照样显示字段编辑器;
  改为 `fielded`(仅材料申报),声明题这一节换成一句说明(「参评人点击一次即完成申报,
  请在说明里写清他们在声明什么」);右侧参评人预览按题型画:声明画一枚「确认申报」按钮,
  全员计分画一句「自动计入」,不再一律画表单。
- 顺带:「多条如何计分」选择器从原生 NativeSelect 换成 shadcn Select。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 665 passed / 17 skipped;
`pnpm test:browser` 56 passed;`pnpm build` 通过;prettier 全绿。

### 题型称呼三分 + 申诉门更名(2026-08-16,§32.65 待办⑥)

- **题型 UI 称呼改为「类型名 + 一句话说明」**(用户裁决):填报型(填写信息或上传材料后提交)/
  确认型(无需填写内容,确认后提交)/ 自动型(无需用户操作,由系统自动计分)。说明行随选中
  项变化,站在选择器正下方;driver 内部名保持技术化(evidence/declaration/constant),
  UI 语言与领域实现各自清晰。
- **`assessment.entry.resubmit` → `assessment.entry.appeal`**:这个 participant action 门的
  是申诉,不是「修改后重新提交」(那是普通 entry.submit)。改码表(PARTICIPANT_ACTION_CODES、
  STAFF 拷贝集、gate 家族)、两处 authorize 调用、能力读取、权限档案的 UI 文案键
  (permission.assessment.entry.appeal「开放申诉」/hint「对已有结论的条目提出申诉」)。
  迁移 20260816120000_entry-appeal-naming 仅改查询会读的存量值:batch_phases 的
  permission_profile 逐元素替换、phase_templates.phases 文本替换;不碰 iam 表(该动作
  从来不是 rbac 权限行)。**升级测试**照 CLAUDE 规则补齐:建旧形态(profile 与模板里存
  resubmit)→ 跑迁移 → 断言两处都改名。历史迁移的测试(测 resubmit 退出 rbac 目录那两条)
  保持旧码不动——它们测的就是历史。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 666 passed / 17 skipped;
`pnpm test:browser` 56 passed;`pnpm build` 通过;prettier 全绿。

**§32.65 唯一剩件:⑤ 补件机制**(SupplementRequest/Response/Attachment 三表、
ReviewInstance 增 awaiting_supplement、受限 requirement builder、事件与能力),
单独会话开工。

### 下拉选项两行制(2026-08-16)

- `SelectItem` 增 `description`:灰色小字第二行只出现在展开列表里(Radix 的 ItemText
  才回显进关闭态的触发器,所以关闭时保持一行)。两处坑:①基类为单行场景写了
  `*:[span]:last:items-center`,纵向布局下就是水平居中——列容器以 `items-start!` 压回
  左对齐;②JSX 三元的表达式位置不能同时放注释和元素(vite 当场拒绝),说明并进 JSDoc。
- 题目类型(填报型/确认型/自动型)与「多条如何计分」(逐条累加/只计最高一条/取最高 N 条
  相加)两处选择器都换成两行制,每项带一句灰字说明;关闭态下方仍保留选中项的说明行。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 666 passed / 17 skipped;
`pnpm test:browser` 56 passed;`pnpm build` 通过;prettier 全绿。

### 补件机制(2026-08-16,§32.65 待办⑤,至此 ①—⑥ 全部落地)

- **三张表**:review_supplement_requests(instructions + requirements jsonb +
  status open/answered/cancelled,部分唯一索引保证一轮同时只有一个 open 请求)、
  review_supplement_responses(一请求一答复)、review_supplement_attachments(引用行,
  FK 进 storage,restrict)。ReviewInstance 状态列拓宽到 varchar(31) 并增
  **awaiting_supplement**——开放态:占唯一开放轮次槽位、进 hasOpenRound/影响分析/
  cancelReviewInstance 的开放集,但不进审核队列,补件期间 decideReview 拒绝
  (`awaiting-supplement`)。迁移 20260816124329_review-supplements(重跑 generate
  确认零漂移)。
- **状态机**:请求(当前 stage 任意审核人,同 decide 的 mayReview 谓词与阶段门;
  active→awaiting 的条件更新即并发闸门)→ 回答(仅本人;**可回答性 = 请求 open ∧
  轮次仍 awaiting**,刻意不过阶段门——轮次被撤回/重路由/作废时请求按定义失效,零清扫)
  或撤回请求(审核人,awaiting→active)。requirement 仅文字+文件,key 服务端按位次派发
  (f1..fn,≤8 项;文字 ≤2000 字、文件 ≤10 个);答复附件沿用申报的信任规则(自己的
  staged 文件或本 entry 故事已引用过的),附件读取授权把补件引用并入 citing 集。
  事件 supplement-requested/submitted/cancelled 入轮次 trail,请求说明随事件 comment。
- **API**:`POST …/instances/{id}/supplement-requests`、
  `PUT …/supplement-requests/{id}/status`、`POST …/supplement-requests/{id}/responses`
  (frozen-routes 同笔);reviewDetailView 增 supplements + 能力四元组
  (canDecide/canRequestSupplement/canCancelSupplement/canAnswerSupplement),
  entryView 增 `supplement`(本人视角的开放请求)。错误码零新增,全走
  EntryActionRefused/EntryPayloadInvalid 等既有码。
- **UI**:工作台决定栏增「请对方补材料」(受限 builder 对话框:说明 + 逐项
  文字/文件+必填);awaiting 时底栏换等待条 + 撤回请求;主栏新增「补充材料」区
  逐请求呈现问与答。参评人 FiledEntry 卡出现琥珀色请求面板,「去补充」打开按
  requirement 画的 EvidenceForm(文件上传复用既有 doors)。事件人话与拒绝词表
  补齐 EN + zh-CN。
- 测试:review-workbench 增两条(暂停-回答-回队全链路含权限/校验负例;撤回请求与
  条目撤回压过 awaiting 轮次)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 668 passed / 17 skipped;
`pnpm test:browser` 56 passed;`pnpm build` 通过;prettier 全绿。

**§32.65 ①—⑥ 已全部落地;剩 ⑦(申诉收紧到首次公示后 + 补证策略配置)待触发。**

### 我的填报按设计稿 4a / 5a 重做(2026-08-17)

设计来源 Claude Design `我的填报.dc.html` 的第 4、5 轮。4a 自陈三处改法,5a 自陈
「外壳已经自适应,真正缺的只有一处」,实现按这两句走。

- **草稿与已提交同一种卡**:原来草稿是一行细条、已提交是卡片,两种形状让人学两遍
  同一件事在哪看。现在同一个卡,只以虚线边、更浅的底、空心状态点区分;草稿的
  「继续填写」回到卡自己的动作行,题头因此只剩一个入口(去申报),满额仍是禁用+
  tooltip。`toneOf(entry)` 一处定 ok/wait/draft/attention 四态,边框、点、分数名目
  同源,不会各自漂移。
- **分数说清是哪一种分**:数字上方写明已计入/待计入/通过后计,只有已计入用深色加重;
  已通过读 standing 的实际行,未通过读题目的每条分值。题头右上新增「本题已计入」,
  与卡上逐条的数字对得上。
- **补件面板重做**:琥珀色小条 → 灰底面板,红色感叹号 + 完整引述审核人原话 +
  「需要提供」逐项(名称、文字/文件、必填)+ 主按钮;卡底一句说明谁在何时提出、
  补齐后继续审核、原材料不动。状态点与徽章在有开放请求时读「待补材料」。
- **「查看经过」改成一条时间线**:原来版本套轮次套事件三重边框,读者要自己合并顺序。
  现在一条竖线,版本/审核动作/补件请求/补件回答/修改建议各是线上一个节点,按时间
  从新到旧统一排序;点的颜色分三档(退回=红、通过与补件回答=实心、其余=空心)。
  面板副标题给「题目　共 N 版,N 轮审核,N 次补充」。为此 **getEntryHistory 的每一轮
  携带 supplements**(`supplementsOfInstances` 批量取,一次查询覆盖全部轮次,不是每轮
  一查);开放请求顺带带上 requestedByName,卡底那句话才有主语。
- **5a 窄屏只显示一栏**:两栏始终在 DOM 里,`max-lg:hidden` 按断点选显示哪一栏——
  没选中显示结构列表,选中显示详情并在顶部给一个 `lg:hidden` 的返回。判据是
  **地址是否点名了某一行**(`chosen`),不是解析后的 open:宽屏的兜底选中不该让手机
  永远停在详情上。窗口变宽两栏立刻同时出现,不重渲染也不闪。页头四个统计在 sm 以下
  只留「已计入」,其余三个下面的列表本来就会再说一遍。
- 上下文栏与抽屉未动:设计稿自己判定外壳已经对了。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 668 passed / 17 skipped;
`pnpm test:browser` 57 passed(新增一条:补件请求出现在条目卡上,且请求与回答成对
出现在经过里);`pnpm build` 通过;prettier 全绿。

### 地址即状态、待补材料分区、题目配置两轮设计(2026-08-17)

**一、我的填报的每一层都进地址**(用户裁决)。`?open` 选中哪道题、`?history` 看谁的经过、
`?entry` 填报弹窗(`new` 或条目 id,题目由 `open` 说了算)。三个都经 `usePageQueryState`,
关闭即置 `''` 即删参——留一个空参数下次刷新会把浮层再弹出来。**push 还是 replace 按宽度分**,
这是唯一按宽度分叉的地方,而且分的是历史语义不是布局:窄屏一层就是一个去处,安卓返回键要能
逐层退出;宽屏在树里连点十道题不该攒十步历史。判据用与布局同一条 `matchMedia('(min-width:64rem)')`,
不用 `useIsMobile`(768),否则 900px 平板单栏时返回键失灵。**申诉与补件回答两个弹层仍留在组件
state**:它们带未提交的输入,刷新重开一个填了一半的申诉不是好事——用户列的三个参数照做,这两个
另说。测试侧给 harness 加了地址探针(MemoryRouter 下 `window.location` 说明不了问题),新增一条
断言开层进参、关层删参。顺带:SidePanel 在手机上占满宽(3/4 宽的侧板在 390 屏是一条废边),
FormDialog 加 `max-h-[calc(100dvh-2rem)]` 与三行网格——长表单原来会把自己的保存按钮顶出屏幕。

**二、审核页 1l 待补材料分区**。新端点 `GET /assessment/review/supplement-requests`
(keyset,frozen-routes 同笔)。两支并集:`awaiting_supplement` 且请求 open,以及请求 answered
且轮次已回到 active/blocked——后者也在主队列里,但到了那儿它看起来和别的件没两样,不会说自己
是某人提问的回答。授权谓词复用 `mayReview`,语义是「我这一步能审的轮次」,同事发的请求也算。
空态一并修:主队列空但有待补材料时,「已全部处理完」整屏会把这几件藏了,现在缩成一行。
**索要补充材料并进同一套 5 秒延迟提交**(设计稿 1l 第二处改动):`StagedDecision` 变成可判别联合,
`send` 与 beacon 路径按 kind 分派,5 秒窗口/⌘Z/pagehide 兜底一律复用,没有另起一套——那段代码
修过双发 bug,不动它的取-并-清语义。发出后照样进下一件;快捷键 S 开弹层(内容要先写出来才能暂存)。
**「建议催一次」没做**:阈值是未冻结的业务策略(§30),不替政策假设,已等待时长照实显示。

**三、审核页缺的经过与版本对照入口**(用户报的 bug)。`onTrail` 一路传进 `MainColumn` 却从未
渲染,只有 H 键能开——没人会去猜 H。现在「此前的意见」标题栏右侧有「查看该条目完整经过 ›」。
**经过 Sheet 改用我的填报那条时间线**,旧的嵌套版删掉:一条申报只有一个故事,不该有两种讲法。
但**人称要分**——同一条时间线,读者不同:填报人看「我提交了第 1 版」,审核人看「周予安 提交了
第 1 版」。加一个 `subject` 入参(给了名字就是第三人称),配套五条第三人称文案。
**版本选择器补齐**:当前版本也列出并标「本轮,当前查看」(不可选,与上方的版本计数对得上)、
每版带它那一轮的结论与判定人、改成两步(选中 → 「对照第 N 版」),点一下就关无法纠正。

**四、题目配置 5a**(note 的三处改法逐条落):①题型从下拉改成三张卡——题型决定下面还剩哪些
区块,下拉把后果藏起来了;已保存的题目整组禁用并说明原因。②字段行:删表头(四个列名解释四个词),
改成「N 个字段 · N 个必填 · 点开一行改它的设置」;补序号(「按此顺序填写」指的就是它,而行里
从来没显示过);必填从一整列变成名字旁一个红点(整列同一个词等于没有信息);**限制只在真的设了
的时候出现**,没设是一条短横——原来 text 无长度上限印「不限」、date 无边界把整个批次窗口印出来。
③两个「计分方式」并成一处:区块名改叫「计分」,那个只有一个选项且 disabled 的下拉删掉,
「分值来源为每条固定分值」并进结论句。④自动型的「谁会获得」补上人数(`participantCount` 从
batch 透传)。

**五、题目配置 6a 文件类型预置组**。原来是一个自由输入框加一句「用逗号分隔,如 .pdf, image/\*」:
要先记得住写法才敢填,填错了参评人上传时才发现,于是多数人留空。改成四个预置组(PDF / 图片 /
Word 文档 / 表格),每组下面写出它实际对应的写法,另有「另外接受其他格式」的手写框,底部把最终
结果拼出来核对。**存的东西一个字没变**,仍是 token 数组;**刻意不记「作者点了哪几个组」**——
item revision 不可变是为了能回放,把组 id 写进去,日后改组定义就会让一条已发布 revision 所接受
的类型悄悄漂移。改成从 token 反推:组的全部 token 都在才算选中,剩下的落进手写框。定义放
`client/file-kinds.ts`(client 根,review 与 entry 都要用,去 import items/ 是错的耦合)。
Office 一律用扩展名而非 MIME:浏览器给 docx/xlsx 报的 mime 极不稳定,而服务端 `acceptable()`
对 `.ext` 走的是文件名后缀匹配。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 669 passed / 17 skipped(新增
「待补材料列表只给这一步的审核人看,补齐后仍在列,判完即离开」);`pnpm test:browser` 58 passed
(新增「每一层都进地址,关闭即删参」);`pnpm build` 通过;prettier 全绿;catalogs 门禁 7 passed
(清掉 4 个孤儿键)。

### 审核工作台的一批修正(2026-08-17,用户实测反馈)

- **已处理的件立即离开待审列表**,不等五秒倒计时走完:从审核人这边看它已经处理完了,一条灰着
  停五秒读起来像没生效。⌘Z 撤回会把它放回去——那时它确实没处理。
- **撤回条居中**:原来是 `left-[16rem]` 硬编码给队列栏让位,队列栏不在时它就飘到屏幕外。改成由一条
  跨满宽的行来居中,**不用 transform**——Appear 的入场动画本身就在动 transform,内联样式压过类名。
- **对照默认打开**,按钮文案按动作写:「打开对照」/「关闭对照」;「版本」改为「选择版本」;两个都
  加边框(原来是 ghost)。**关闭对照不再跳版**:标题下那行「与第 N 版相比,N 处改动」无论开关都占住
  一行高度,否则整段填报内容会在光标底下上移。
- **进度条点亮当前这一件**:原来只点亮已完成的,读者正在看的那一格永远是灰的,条子总比人慢一格。
- **自动刷新出新任务后会选中它**:队列清空后停在最后一件已处理的件上,新任务到达时左栏没有选中项、
  右栏却还显示着那件旧的。判据刻意收窄到「本次会话处理过的件」——否则从待补材料分区点「去处理」
  打开一个暂停中的轮次会被弹走。
- **附件不再汇总成一列「材料数」**(设计稿 1b):文件字段是该题真实的字段,保留自己的位置和名字。
  列表里它是自己那一列(值是份数),工作台的「填报内容」里它是一行,直接列出文件名;版本对照也覆盖
  它——换了证书就是一处改动,原来读成「无值」,于是整版看起来没动过,而那次重交的全部意义就是换了
  照片。服务端 `summaryValues` 相应带上 `files` 计数(份数怎么念是浏览器的事,服务端只数数)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 669 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 1b 的附件呈现与字段留白(2026-08-17,重读设计稿后)

- **材料按字段折叠**:独立的「证明材料」区取消,文件回到提出要求的那个字段名下,成卡片
  (168×96,左上角是编号也就是打开它的按键,右上角在本轮首次出现时标「新增」,名字与大小在下)。
  编号跨字段连续,与 1–9 快捷键同一套。原来一堆材料摞在页尾,说不出哪一份是证书。
  下载按钮在卡片内右下角、hover 才出(键盘聚焦时也出)——取一份复制件是第二念头,不是卡片存在的理由。
- **本轮移除的文件不做成卡片**:摆在卡片之间会读成「还在」。改为下方一行一个的文件行
  (回形针 + 文件名 + 下载),标题就写「本轮移除」而不是「上一版」——发生的事是这一版把它拿掉了。
- **长字段名不再压到内容上**:标签列允许换行(`overflow-wrap:anywhere`)而不是 nowrap 后溢出。
  「参加校级以上竞赛并获奖」截断成前几个字等于没名字。审核工作台与我的填报的条目卡都改了。
- **间距对齐设计稿**:字段行之间 12px(原 8px)、值列内 5px(原 2px)、卡片间 8px;行的左边条用
  `-ml-[13px] pl-[11px]` 挂出去,文字仍与本节其余内容对齐。
- **关闭对照时下方内容平滑上移**:`Appear` 增加 `collapse`,退场时连高度一起动。原来只淡出,
  空间留到动画结束再一次性收掉,于是所有内容在最后一帧跳上来一行。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 669 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿;catalogs 7 passed。

### 退回原因回到条目卡,以及两处快捷键与弹层动画(2026-08-17)

- **被退回的条目在卡上说明原因**。原来卡片只有一个「已退回」的状态词——一句要人去做事的
  指示,而指示本身在另一屏。新增 `EntryView.refusal`(kind/reason/comment/actorName/at),
  与补件请求同一种面板。取数要合两处:审核人的退回是**轮次的**事件,管理员因题目改动送回是
  **条目自己的**事件(§32.62,没有轮次),所以是一条 union + `distinct on (entry_id)` 的查询,
  列表一次取完整页而不是每卡一次。仅在 rejected / needs_revision 时下发——已通过的条目的历史
  在它自己的经过里读,不钉在卡上。重新提交后该字段即消失。
- **「查看该条目完整经过」标出快捷键 H**(键早就绑好了,只是按钮没说)。
- **「该参评人的其他条目」每行给 ⌥1–⌥9**。读 `event.code` 而不是 `event.key`:按住 Alt 时
  数字键在多数键盘布局上报出的是符号,而数字正是这个快捷键的全部意义。
- **三个决定弹层恢复渐隐**:退回、提请复核、请对方补材料都是「条件挂载 + 写死 open」,
  卸载即消失,退场动画从来没机会播——只有进场看着是对的。改成受控 open + `useLingering`,
  与本屏其他面板同一套。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped(新增
「退回时带着退回的原话回到卡上,重新提交后消失」);`pnpm test:browser` 58 passed;
`pnpm build` 通过;prettier 全绿;catalogs 7 passed。

### 全站 Radix 浮层动画从未生效(2026-08-17)

排查「修改」弹层没有淡入淡出时发现的:**这不是某一个弹层的问题**。overlay 组件一律写
`data-open:animate-in` / `data-closed:animate-out`,而 Radix 发出的属性是
`data-state="open"`。Tailwind v4 把 `data-open:` 当成内建的 data 属性简写,编成
`[data-open]`——一个谁都不会设的属性。构建产物里确认:改前 CSS 里是 `[data-open]`,匹配数为零。

于是 dialog / sheet / dropdown-menu / select / popover / tooltip / hover-card / alert-dialog
八个组件的进出场动画**一帧都没播过**,而且改多少组件代码都不会有效果。

修法是在 theme.css 补两条自定义 variant,把这两个名字接到真实属性上:

    @custom-variant data-open (&[data-state='open']);
    @custom-variant data-closed (&[data-state='closed']);

一处改动,八个组件同时恢复。构建产物核对:`[data-open]` 归零,`[data-state=open]` 出现 14 条、
`[data-state=closed]` 8 条,`animate-in` 的 `--tw-enter-opacity` 变量随之进产物。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 审核工作台改三栏,队列可收起(2026-08-17,设计稿「16比9 布局」1a)

设计稿自陈「只动两处,内容一处不减」,照此:

- **队列 15rem → 11rem,并可整栏收起**。队列行本来只有姓名、题目、时间三样,240px 里一半是空的。
  收起走 `?queue=off`——它是家具不是浮层,刷新后还在,但返回键不该管它,所以用 replace。
  **收起后是一条 2.75rem 的窄条而不是零宽**:返回批次列表的门与把队列叫回来的按钮都在这一栏里,
  整栏消失会把这两样一起带走(与外壳侧栏收起同一取舍)。窄条上仍显示剩余件数。
- **右侧由两栏拆成三栏** `0.82fr | 1.18fr | 19rem`:审批流转 / 申报内容 / 依据与配置。
  原来「此前的意见」和「申报内容」上下叠着,读第二段要先滚过第一段,而审核一条重交的件恰恰
  需要同时看见两者。现在左栏一屏放完(历史退回原因 + 本轮经过),中栏是唯一需要往下滚的那栏,
  右栏 19rem 未动。左栏内新增「本轮经过 / 等待你的决定」一行,把「为什么被退回」与「这一轮
  说了什么」分开;栏名从「此前的意见」改为「审批流转」——它现在装的是整条流转。
- 其余一处未减:连审进度条、参评人栏、决定条、快捷键、对照与版本、补充的内容、材料按序号排
  都在原处;字段仍是 6.5rem 标签加内容,附件仍是卡片。智能审阅占位块移到中栏顶部(设计稿位置)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿;catalogs 7 passed。

### 申报内容栏按 1a 重做,并找回丢掉的「补充的内容」(2026-08-17)

上一轮把设计稿的像素照抄成了 `text-[11px]` / `h-[33px]` 这类任意值,整屏比主题小一号且各处
不成体系。这一轮的做法改成:**版式(有什么、怎么排)照设计稿,尺寸(字号、间距、圆角)一律取
shadcn 主题刻度**,字号自己定而不照抄——设计稿 1440×780 的 11px 是那张画布的比例,不是本项目
的字号表。

对着 1a 逐条核对(用 playwright 把设计稿与本页各渲染一次比对,不靠记忆):

- **智能审阅占位块从中栏顶部挪到「申报内容 第 N 版」标题之下**。它排在标题之上时,等于把一个
  尚不存在的功能的说明放在被审的东西前面。
- **字段与标题左对齐**。此前字段带 `-ml-3.5` 加一条常态透明的 `border-l-2`(改动标记),结果
  字段比它自己的小标题往左错 14px,而那条线在没开对照时谁也看不见。1a 里字段区没有任何竖线:
  整栏只有三条左边框——栏分隔线、智能审阅卡的虚线框、以及逐字段智能审阅提示的 2px 虚线(该提示
  没有数据源,不写恒假分支)。
- **字段仍是上下堆叠**(标签在上、值在下),这是 1a 的实际写法;note 里「6.5rem 标签加内容」
  是在说沿用旧版,与 1a 自身的标记不符,以标记为准。中栏只有 1.18fr,固定标签栏买不起。
- **「上一版」恢复成有底色的圆角块**(设计稿 `background:oklch(0.97 0 0);border-radius:4px`),
  「本轮移除」同此;移除的文件仍是单行划删除线,不做成卡片。
- **「补充的内容」整节找回**。三栏改造时 `SupplementCard` 变成了定义但无人调用的死代码——页面
  上这一节整个消失了。现在按 1a 排在字段之后:分节标题 + 说明,每次请求一张卡(第 N 次请求、
  状态、时间、指令),回答按同一套字段版式排,补充的文件带「补充」角标。
- 附件卡的角标从只认「新增」扩成 `added | supplement`。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier `All matched files use Prettier
code style!`。

### 右栏按 1a 改成平铺分节,顺带修右栏与左栏的细节(2026-08-17)

右栏此前是四张 `rounded-xl border` 卡片摞在一起,1a 是**一栏平铺、分节之间只有一条发丝线**。
19rem 宽度下卡片的边框加内边距比它买到的东西贵,而且把四个本属同一问题(这件按什么判)的部分
排成了四块互不相干的面板。改成 `border-t pt-2.5` 分节。

- **评分依据**:标题 + 条款号槽位(暂无数据不渲染),正文用 2px 左引用线,不再是灰底卡。
- **审核流程**:每步一颗编号圆点——当前步实心、已过的浅底、未到的只有描边;正文一行
  `节点／角色`,右侧写这步的状态(当前在此 / 已通过)。谁可审仍留作第二行小字:1a 的 mock 里
  没有这条,但它是本项目真有的信息,丢掉会让审核员不知道这一步卡在谁那儿。
- **这道题值多少**(原「该题配置」):键值两端对齐。分组上限改用**分组本名**
  (「品德行为表现 上限」),原来的「所属分组上限」逼读者自己去想是哪个组,而答案就在屏幕上。
- **该参评人的其他条目**:表头右侧由「本题 N 条」改成快捷键提示「⌥ 1 至 N」——条数列表自己
  就数得出来,快捷键不写没人知道;行内补上按状态着色的圆点(退回/待补件为 destructive)。

左栏同轮修的两处:

- **「上一轮的结论」改为「历史退回原因」**,并补上这条结论来自第几轮(`previous.roundNo`
  一路从 `previousConclusion` 查询、service view、api schema 到 dto)。原先只有时间,读者要
  自己数是哪一轮。
- **退回动作的 chip 用 destructive 色**。与备注同一种墨色的退回,是疲惫的审核员会划过去的退回。

**做法**:这轮开始用 playwright 把设计稿与本页各渲染一次、按需裁剪放大比对,并直接枚举设计稿
DOM 里所有带边框的元素,而不是靠读 HTML 猜。上一轮「字段区左侧竖线」的来回就是猜出来的。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier `All matched files use Prettier
code style!`。

### 跟上设计稿右栏的改动,并修好自己弄坏的字号(2026-08-17)

重新拉了设计稿,与本地那份逐字节 diff——**右栏确实改了五处**,不是错觉:

- 评分依据从平铺改回**灰底卡片**(radius 11、padding 11×12),条款号从标题旁的 chip 挪到
  标题行右端的普通小字,正文去掉左引用线、改深色。它是被引用的条文,不是本屏自己的话,
  留一张卡片是对的。
- 四个分节标题**由灰改黑**。
- 分值信息的行加了**引导线**:键名 + 一条 1px 发丝线撑满中间 + 数值。一列长短不一的键名,
  眼睛要靠这条线走到三行外的数值。
- aside 的 gap 10→12、padding 14/15→16/16;分值信息块 gap 5→7、pt 10→12。

同轮修的:

- **分值信息一栏的字巨大无比**,是我自己弄坏的:它原来在 `text-sm` 的卡片里,拆成平铺分节时
  把 `text-sm` 一起删了,于是继承了 16px。
- **分节标题偏小**:设计稿里标题 11.5px、正文 12px,几乎一样大,靠字重分,不靠字号分。
  我却按 text-xs / text-sm 分了一整档。标题改回 `text-sm font-semibold`。
- 「这道题值多少」改名**「分值信息」**,并去掉「材料时间范围」一行(用户定)。
- **字段之间的间距 14px → 20px**。比例上我与设计稿一致(内 6 外 14 对 内 5 外 12),但我的
  字号整体大一档,同样的绝对间距就不再读作分组边界——标签离上一条的答案比离自己的还近。
  间距要跟着字号走。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier `All matched files use Prettier
code style!`;catalogs 7 passed。

### 「本轮移除」的间距,以及它顺带暴露的老毛病(2026-08-17)

字段内三档间距定为 6 / 12 / 20px(实测 computed style,不是估的):

| 位置                  | 间距 |
| --------------------- | ---- |
| 值 → 「上一版」       | 6px  |
| 附件卡 → 「本轮移除」 | 12px |
| 字段 → 下一个字段     | 20px |

「本轮移除」比 6px 远、比 20px 近:它属于这个字段,但一排卡片是够重的一块,底下贴 6px 会被读成
卡片行的一部分。

**做法上有个坑复发了**:这两块都是 `Appear collapse`(关对照时要收起),而间距原来挂在父级
`dd` 的 flex `gap` 上。**gap 不算在子元素高度里**,收起动画把子元素高度收到 0,gap 还在,
直到卸载才一帧消失——正是之前「关闭对照后布局跳动」那个 bug 的同一形状。所以 `dd` 去掉 gap,
两块各自用 `pt-3` / `pt-1.5` 自带间距,这样它跟着高度一起动。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier `All matched files use Prettier
code style!`。

### 滚动条与底部大片空白:审核台不再自己量窗口(2026-08-17)

两个症状同源。审核台原本用 JS 量「窗口高度 − 自己的 top」当作自己的高度,这个量法**两个方向都会错**:

- 在**已经滚动**的面板里量,`top` 变小甚至为负,算出来比实际空间高 → 工作台长出一条它本不该有的
  滚动条,越滚越错;
- 在**上方各条还没排好**时量(顶栏、批次栏、页头的文案会换行),算出来偏矮 → 决定条下面留出
  一屏白。用户截图里就是这一种。

**改成不量**:从 shell 的 `main` 到工作台根节点本来就一路是 flex column,只要根节点在 lg 下写
`flex-1 min-h-0`,剩多少就是多少——任何尺寸都对,没有需要保持同步的第二份状态。中间那层
`AsyncSection` 补上 `min-h-0`(否则它撑不下去)。实测四种情形 `scrollHeight − clientHeight` 均为 0:
初始、滚动后再 resize、窗口拉高、窄屏切回宽屏。

**窄屏**:三栏的 `overflow-y-auto` 改成 `lg:overflow-y-auto`。并排时它们是三个窗格,堆叠时它们
就是页面的三段,页面自己滚——否则一屏里塞三个各自滚动的盒子。窄屏实测 scrollHeight 1814 /
clientHeight 844,滚下去是内容不是空白。

**shell 的滚动条**:两个 shell 的 `main` 由 `overflow-y-scroll` 改 `overflow-y-auto`。原注释
担心「能滚与不能滚的页面宽度不同会抖」,并特意否掉了 `scrollbar-gutter`。实测:overlay 滚动条下
`scroll` 与 `auto` 都占 0 宽,那条宽度差在这里根本不存在;而 `scrollbar-gutter: stable` 会占掉
15px 空白条——原注释否掉它是对的,但据此选 `scroll` 就让填满视口的页面永远挂着一条推不动的
滚动条。

顺带:量高度的 hook 两个页面各抄了一份,合并成 `rest-of-the-scroller.ts`(改为对着滚动容器量、
加 ResizeObserver),我的填报仍用它;审核台已经不需要了。

**其他**:历史退回原因的动作 chip 与原因 chip 挤成三行——改为同一行,人名先让位打省略号,
两者都带 title;「审批流转」标题加 `whitespace-nowrap`(原来被压成一列单字);按钮文案
「查看该条目完整经过」→「查看完整经过」。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier `All matched files use Prettier
code style!`。

### 滚动条与白屏的真凶:sr-only 逃出滚动列(2026-08-17)

用户发现了决定性的复现条件:**开对照才出现,关对照就没有**。照此把夹具的 getEntryHistory 换成
真实的长上一版(此前夹具历史为空,`against` 恒为 null,等于一直在量关着对照的页面——上一轮
「overflow 0」的验证就是这么漏的),立刻复现:main scrollHeight 1889 / clientHeight 680,
三栏盒子却都正确夹在 490。

几何探测找不到伸出去的元素(culprits 为空),于是换暴力二分:逐个 `display:none` 子树看
scrollHeight 掉不掉,一路钻到叶子——**AttachmentLink 下载链接里的 `<span class="sr-only">`**。

机理:sr-only 是 `position:absolute`。它的包含块不是申报内容列(列是 static),而是往上第一个
positioned 祖先——工作台根节点(`relative`,撤销胶囊需要它)。**绝对定位元素不受「非包含块」
祖先的 overflow 裁剪**,于是这个躺在字段列表 y≈1888 处的 1px 元素逃出列的裁剪,把 main 的
滚动区域撑到 1889。而「本轮移除」的 line 链接只在对照开启时渲染——症状与开关完全同步。

修法是规则不是补丁:**会滚动的窗格必须自己是 positioning context**。四个滚动容器
(三栏 + 队列列表)与我的填报的索引列表都加 `relative`,绝对定位后代从此归窗格管、被窗格裁。
规则写在 FlowColumn 上方的注释里。

复测(对照开、内容超一屏):宽屏 overflow 0;窄屏 scrollH 2716 == 内容底 2716,滚多远都是
真内容。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier `All matched files use Prettier
code style!`。

### 版本选择三态、对照随页加载、附件批量描述(2026-08-17)

**选择版本 Sheet 的三态**。此前所有行一个样式,根因不止样式:页面传进来的 `comparingId` 常是
哨兵值 `'previous'`,不匹配任何 revision id,于是默认对照下没有任何行呈选中态、确认键也是死的。
现在哨兵在渲染时解析成真实的上一版 id(派生而非写状态,避免与请求赛跑);送审中的版本置灰 +
`cursor-not-allowed`(它是对照的读数,不是可对照的对象),对照中的行高亮 + 实心徽章,其余正常 +
`cursor-pointer`。

**对照信息随页面一起到**。此前对照数据走第二个请求,页面先画一帧没有对照的,再闪现(或播一次
没人触发的入场动画)。裁决:能一起加载就一起加载——`context.previousRevision`(id、版本号、
**它自己的** formConfig、payload——题目在两版之间可能改过)随 getReviewInstance 一起下发,
查询 `revisionBefore` 只在页面读取时执行;默认对照零额外请求、首帧完整。手选版本仍走历史
接口,而能手选的前提是打开过选择 Sheet——它已经把历史拉进了缓存。`Appear` 按数据就位与否
keying,晚到的数据重挂进场(`initial={false}` 静默首帧),用户自己的开关照常有动画。
review-workbench 断言:改版重交后 `previousRevision.revisionNo === 1`;原样重交后为 null。

**附件批量描述**。每个 AttachmentLink 各自请求 describeAttachment,一页三十份材料就是三十个
请求。新端点 `GET /assessment/attachments`(键控多取,按请求的 id 集有界,无 cursor;
`Schema.ArrayEnsure` 单值/数组都收,>60 个 id 硬拒不静默截断),授权仍逐文件走单文件那扇门的
同一判定,无权/不存在一律缺席不报错。浏览器侧 `use-attachment-descriptor.ts`:同一宏任务内
落地的加载合并成一次调用,按 client 实例分组(测试的 fake client 互不串),每文件的缓存条目
保留(30s staleTime,已描述过的文件零请求)。AttachmentLink 对外接口不变。frozen-routes 增
`GET /assessment/attachments`。**未做**:批量端点的授权省略语义没有独立的 node fixture(需要
storage 上传闭环,现有测试没有先例),其逐文件判定复用已被测的 describeAttachment 路径。

**Effect 依据(实际读过)**:`repos/effect/packages/effect/src/Schema.ts:4682`(ArrayEnsure:
解码单值或数组归一为数组,单元素编码回单值);`repos/effect/packages/effect/test/unstable/
httpapi/HttpApiClient.test.ts:290-330`(数组 query 编码为重复键 `?tags=1&tags=2`);
`repos/effect/packages/effect/src/unstable/http/HttpServerRequest.ts:120-160`(单值解析为
string,重复键为数组——正是需要 ArrayEnsure 的原因);`repos/effect/packages/effect/src/
unstable/httpapi/HttpApiBuilder.ts:700-780`(query 经 ParsedSearchParams + decodeUnknownEffect);
`repos/effect/packages/effect/src/Effect.ts:779`(forEach 带 concurrency 选项)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped(review-workbench
两处新断言在内);`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 队列头像条、窗格 ScrollArea、挂载卡顿与三个回归(2026-08-17)

**队列栏**。展开 11rem→13rem(内容放不下);标题旁的计数由 Badge 改普通小字(chip 占掉了
标题的空间,「待审队列」曾一字一行);收起走宽度过渡(轨改 `auto`,栏自己 `w-52↔w-11` +
`transition-[width]`,原来两个宽度写在 grid 上是瞬切);收起后列表变**头像条**:每行一个
Avatar(中文取前两字、拉丁取前两字母大写——一排「王」认不出谁是谁),当前件带 ring,title
提示全名,点击直达。右栏 19rem→21rem。

**审核页所有滚动处换 shadcn ScrollArea**(用户点名):三栏、队列列表、选择版本 Sheet。原生
滚动条在栏间是一条灰带。共享组件补了两处**通用缺陷**:①Viewport 加 `relative`——裁剪只对
包含块链内的祖先生效,viewport 不是 positioning context 时,内容深处一个 sr-only(绝对定位)
就逃出滚动区、把 shell 的滚动区撑出一屏空白(「打开对照后又出现滚动条」的回归即此,已实测
归零);②Viewport 内层 `display:table` 改 `block!`——table 不让子元素收缩,ScrollArea 之下
所有 truncate 都静默失效(「该参评人的其他条目」溢出即此,现已实测 ellipsis 生效)。

**窄屏三段重叠**。我在窗格上写的 `min-h-0` 把 auto 网格行的内容下限归了零,三行均分一个过小
的网格、内容互相画穿。高度约束(min-h-0 / flex-1 / grid-rows)全部改 lg 专属:窄屏是文档,
按内容流;实测三段 379/975/532 顺序堆叠。另:换 ScrollArea 后网格 auto 行按内容参与 track
sizing(与视觉溢出无关),两层网格行显式 `lg:grid-rows-[minmax(0,1fr)]` 钉住。

**进入页面的动画卡顿**。longtask 实测:挂载一个 353ms 长任务。对照实验(去掉两张附件卡→156ms)
定位到 PhotoProvider:每个 AttachmentLink 不论是不是图片都挂整套 lightbox。现在只有图片挂
(353→288,文件多的页面按比例受益)。**sibling 模态框动画消失**:openSibling 状态在页面根部,
开个对话框重渲染整个工作台。四个窗格 memo 化 + 回调 useCallback 稳定;实测打开对话框后长任务
为零,动画不再丢帧。剩余 288ms 是 dev + StrictMode 双渲染的整页首挂,再切就要延迟渲染内容,
与「不闪现」冲突,不做。

**附件大图渐显**。原图无缩略图,大图流式解码时在占位上一行行刷。`ArrivingImg`:装载完成前
opacity 0,完成后 300ms 淡入;缓存图在 ref 里查 `complete`,不重播。无新依赖。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 待补材料成为独立分区,全部审完的对勾回归(2026-08-18)

「待对方补材料」原来是垫在队列下方的一节,带来一个连锁妥协:队列清空时,全屏的「已完成全部
审核」会盖住它,于是空态被缩成一行小字——对勾动画版从此不再出现。

现在它是第四个分区(按题目 / 按提交时间 / 按参评人 / 待对方补材料),只有进入才显示,tab 上
带数量小徽章(为零不显示),题目/单位/搜索过滤器在该分区隐藏(它们过滤的是"现在能决定的"),
分区内空态一行说明(自成一页后,空着消失会读作坏掉而不是清净)。队列的空态因此拿回整屏:
处理过 → DoneMark 对勾动画版;本来就没来件 → 原来的静态版。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 审批流转:撤回不是退回,本轮经过成为时间线(2026-08-18,设计稿 1a 更新)

**更早各轮**保持三段结构(轮次 · 事由 · 时间),显示事由不显示人:审核员扫这一栏是判断
「这条卡在哪里」,事由直接回答;人名只在追责时有用,那时该看完整经过。退回行事由用深色,
无事由时兜底「退回了申报」(不再带人名)。

**撤回单独成例**。它不是退回——没有任何审核人下过结论,不能包装成退回理由:

- 更早各轮里:灰字「参评人自行撤回」,不给事由(确实不存在);`earlierConclusions` 查询把
  `cancelled-by-submitter` 纳入终局集(撤回也是一轮的结束,只是不带裁决)。
- 主块:上一轮以撤回终局时,标题改「上一轮未经审核,参评人自行撤回」,不显示 destructive
  裁决 chip、不显示事由 chip、不显示「对照检查是否已按此修改」(没有可对照的要求)。

**本轮经过改为真时间线**:左侧圆点串一条竖线,最后一点实心(当前所在),其余 45% 灰;事件名
`font-medium` 深色、说明文字灰色常规,两行靠字重与颜色分层;说明的引用竖线去掉。

DOM 实测:撤回行 `oklch(0.556)`、退回事由 `oklch(0.145)`、点数与事件数一致且实心恰一个、
说明无左边框、事件名字重 500;撤回主块三断言(标题/无裁决 chip/无对照提示)全过。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 我的填报按「宽屏」设计稿 1a 重做(2026-08-18)

**左栏**。顶部新增卷面卡:当整份卷面只有一个顶层大分组时,卡片就是它——名称、已得(两位小数)、
进度条、满分、`N 个分组，M 道题`,列表从它的子级直接开始、不再重复顶层行(用户纠正过一次:
先前我把批次名放卡上、顶层分组又在列表里出现了一遍);多个顶层分组时退回批次名 + 各组上限求和。
树加连接线:每行肘形圆角接入、同层有后继兄弟时画通线、分组向子级画下半段;分组行右侧
得分/上限 + 3px 进度条,题目行状态圆点(待动手红、可申报空心、其余灰)+ `N 分`。

**中栏**。标题栏:面包屑、题名 + 一句可读的规则(每条计 X 分,最多 N 条,需 N 人审核——替换
原来的三枚 chip),右侧已用条数 + 进度条、**本题已计入(两位小数)**;页头「已计入」同改两位
小数。条目工具行:全部/待处理/已通过 页签 + 计数说明 + 新增申报。条目卡收缩为:状态 chip、
版本时间、退回事由片(红底)、分值;**指定列表字段三个**(displayConfig 尚无此配置,先取表单
前三个,其余的数量写在第四行)+「还有 N 个字段未显示 · 查看详情」整行即入口。卡上的退回详情、
补件面板、全部操作按钮**全部收进抽屉**。

**查看详情抽屉**(新 EntrySheet,`?detail=<entryId>` 走地址,关闭删参数)。头部:面包屑、
「这条申报」+ 状态 chip + 版本时间;两个页签:填写内容({N} 项)/ 审核经过({N} 版,复用
EntryHistory 抽出的 EntryTrail,与独立面板同一渲染);填写内容 = 退回原因卡 + 未答复的补件
要求(带去补充)+ 本人填写全字段(文件为卡片)+ **按审核人要求补充**逐轮分节(要求原文 +
所补内容同源,数据来自 getEntryHistory 的 rounds.supplements);底部操作条:放弃申报靠左,
申诉/撤回/修改/重新提交(主色)靠右,capabilities 三态照旧(Offered 移入抽屉)。

**右栏**(lg:grid-cols-[minmax(0,1fr)_15.5rem]):题目说明卡(说明正文 + 分隔线下评分条款
占位);**计分详情**(按用户命名,设计稿原名计分位置):通过后每条计 / 本题最多计入 /
{分组} 小计 / {分组} 上限,引导线对齐,全部两位小数。**未做**:「提交后的流转」节——审核链
各步的节点/角色名是审核侧数据,参评人侧没有端点,不编造;「本轮满分」行——批次侧无此数据。
「管理员指定列表字段」配置同样未建(题目配置页范畴),卡上先取前三个字段。

验证:DOM 断言 21 项全绿(卷面卡四项、顶层不重复、连接线、规则句、两位小数、页签、入口行、
说明与计分详情各行、抽屉双页签与操作条);entry-workflow 五个用例改走抽屉流(提交/经过/补件/
地址层 `detail=`/文件计数)后 9/9。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 我的填报的四处收尾(2026-08-18)

- 查看详情抽屉 35rem → `sm:max-w-2xl`:装全字段与文件卡片的抽屉,560px 是设计画布的比例
  不是产品的宽度。
- 「按时间从新到旧排列,经过只读,不能修改。」提示删除(键随文案一起从两个 catalog 移除)。
- 空题不再留白:全部/待处理/已通过 页签与计数说明在零条时照样显示(全 0),原来它们随第一条
  申报才出现,页面读起来像少了一块。
- 页头统计值加 `leading-none`:大号「已计入」与小号计数正常行高下基线不齐,底对齐读成两个高度。
- 题名 text-lg → text-xl、与面包屑的间距放宽、规则句 13px:题名和它自己的元数据一样大时读作
  标签,不是标题。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿;catalogs 7 passed。

### 我的填报连环打磨(2026-08-18,一组会话内反馈)

- **面包屑换 shadcn Breadcrumb**,且可点击:分组段是地方不是文字,点击直达该分组面板
  (MyEntriesPage 现算祖先链 `crumbsOf`,带 id 传入);抽屉头部同套组件,当前题为 BreadcrumbPage。
- **题名两级放大**(text-lg→xl→2xl,用户两次嫌小),与面包屑间距 gap-1.5→2→2.5,规则句 13px→sm。
  整页小字上调一档:卡片字段标签 xs→sm(标签列 w-16→20)、查看详情行 xs→sm、页签 xs→sm(h-6→7)、
  卷面卡名称 xs→sm。
- **申报详情抽屉宽度**:三次反馈后才找到真因——SheetContent 自带
  `data-[side=right]:sm:max-w-sm`(384px),带变体前缀与裸 `sm:max-w-*` 在 tailwind-merge 里
  是不同组,两个类都存活、组件的赢。用同前缀 `data-[side=right]:sm:max-w-3xl` 覆盖,实测 768px;
  选择版本 Sheet 同坑同修(它的 sm:max-w-md 从来没生效过)。「这条申报」改名「申报详情」。
- **页头统计对齐**:混合字号 bottom 对齐读作基线错位,容器改 `[align-items:last_baseline]`
  (实测 computed 生效);仍差的最后一丝是 CJK 墨迹低于拉丁基线 ~0.1em,按用户指示给大号统计
  整体(含标签)`relative top-[0.1em]`。
- **空态**:两句改产品语(「这道题还没有申报记录。」「这道题由组织侧登记,暂无你的记录。」),
  换满宽 Empty 卡并在 lg 下撑满与左栏等高的窗格(实测 576px);卡内加「去申报」——按用户纠正,
  右上角的主按钮保留,卡内的用 outline 变体区分。
- 「完整内容与经过在详情里」→「审核经过与操作见详情」;「按时间从新到旧排列…」提示删除;
  空题的筛选页签显示全 0 而不是消失。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 条目卡片区按 1a 更新:列数随条目数走,末尾常驻虚线卡(2026-08-18)

设计稿改动两处,照做:

- **网格 `xl:grid-cols-2` → `repeat(auto-fill, minmax(340px, 1fr))`**:列数随宽度与条目数自适应,
  卡片保持约 340px 的块状比例——只有一条时它与虚线卡并排各占一半,不再拉成整宽横条。
- **末尾常驻一张虚线卡**:有余位时是「再申报一条 / 还可申报 N 条」(可点,声明题走一键声明,
  无上限题提示沿用「不限条数」);满了改灰色「已达申报条数上限 / 本题最多 N 条,不能再新增」,
  占位仍在——位置消失会让读者拿卡片数去对屏幕另一角的数字。组织侧登记、全员计入、非 active
  的题不出现;只在「全部」页签下出现(筛选视图里它会把筛选结果读成容量)。

**保留的先前裁决**:零条时仍是满高 Empty 卡 + 说明 + outline 去申报(用户后来定的),虚线卡
只在已有条目时接在末尾。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 我的成绩按设计稿 1a/1b 重做:一张能读出算法的账(2026-08-18)

原页面是 max-w-xl 的一列盒子,子分组靠外边距内推、三个数字挤在标题行。照设计改为 **max-w-6xl
的一张对齐的账**(BatchScreen 默认档即 max-w-6xl):

- **汇总带**:合计(34px、两位小数)+ 实时预览 chip + 本轮满分(仅当每个顶层分组都设上限时才有
  诚实的满分可写,由上限求和;有未封顶分组则不显示);分段进度条按顶层分组着色(三档灰度轮换)
  - 图例;右侧三行——已通过计入、**审核中暂不计入(条数而非金额:审核会给多少分未定,写成与
    已得同形的数字读作承诺——沿用我的填报页的既有裁决)**、因限额未计入(全组 raw>final 差额
    求和)。
- **账表**:四列 `分组与题目 | 各项相加 | 子分组相加 | 计入`,列宽 7rem、右对齐、tabular;
  分组行带底色(顶层 muted/75、内层 /40)+ 上限 chip(不设上限亦写明),无子分组的「子分组
  相加」写 —;题目行缩进 + 竖引导线,不计分的行留在原位、金额置灰、原因随行(已退回/停用/
  按规则计入其他条目/本轮自动计入);**限额行单独成行**:「分组限额 合计 X,按分组限额 Y 计入」
  差额负数(下限同理正数)。此行**单源自分组数字**——服务端也会发 `group-adjustment` line,
  照发照收会把同一笔限额显示两次,故该 kind 的 line 不再单独渲染,由分组的 raw/final 合成一行。
  表尾合计行。
- **1b 空态**:圆图标 + 「还没有计入的题目」+ 说明 + 主色「去我的填报」(usePageNavigate 按
  页面 id)+ 「审核中 N 条,草稿 N 条」;汇总带保留(设计如此)。
- 设计稿底部的三条图例是给实现者的注记,用户指出后未上屏(键一并移除)。

验证:两状态 DOM 断言 19 项全绿(总分/满分/条数/限额差额/嵌套限额/注记文字/max-w-6xl/分段数);
entry-workflow 的成绩用例改为两位小数与合成限额行断言,ambient 补 listMyEntries 桩。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿;catalogs 7 passed。

### 我的填报补动效(2026-08-18)

沿用 @qualy/ui/reveal 的既有动效词汇,三处,全部尊重 prefers-reduced-motion:

- **条目卡 Stagger 入场**(step 0.05,key 为「题目 id + 筛选页签」):换题或换页签是重新阅读的
  时刻,卡片按序到场;同 key 重渲染不重播。虚线占位卡作为最后一个子级一并入列。
- **申报详情抽屉页签 Swap**:填写内容 ↔ 审核经过 原位交叉淡入,替换可见而非闪切。
- **空态卡 Reveal**:淡入上移一次,不表演。

Drill(换题的整面转场)与 Sheet 自身的进出场此前已有,不重复叠加。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 我的填报改为试卷式(2026-08-18,设计稿 2a)

**右侧成为通篇填报页**:不再选一道看一道,整卷一次性铺开——顶层分组是段头带
(编号 01/02、名称、进度条、占总分比例、小计/上限,底色为**固定位置的灰白渐变**,按用户裁决
不做成完成度百分比),子分组是小号段带(编号 02.1),题目是 `23.5rem | 1fr` 的双栏行:左栏
题号、题名、说明、条件句(每条计 X 分,最多 N 条,需 N 人审核)、评分依据占位行、已用条数与
去申报按钮(满了改一句「已达申报条数上限」);右栏是申报表格(内容/版次与时间/状态/计分),
**一条申报一行,行高随条数长,点任意一行直接开申报详情抽屉**;超过 6 条折叠;无申报的右栏是
托盘式空态(未申报/由组织侧登记/全员计入 各说各话)。页头是卷内粘顶工具条:我的填报、已计入
(两位小数)、审核中/草稿/已退回 计数、整卷/只看待办 切换(只看待办时无题的分组段头一并隐去)。
字号按主题刻度定,不照抄画布 px(用户点名)。

**左栏 = 原总览栏,细节未动**:总分卡(灰底,按用户裁决)、全部/待办、树行连接线、分组小计
进度条全保留;布局变化只有三处——列表外框去掉、区域成为带右边框的独立栏(顶部「卷面结构」
标题行)、栏内自滚。**滚动跟随**:纸面滚动时,工具条下方的那一行在左栏以现有的 bg-accent
选中样式高亮(不用设计稿的样式,按用户裁决);高亮只写组件状态不写地址——滚动是阅读不是导航;
点击左栏行才写 `?open=` 并平滑滚到对应行,进页面带着 `?open=` 则先定位一次。

**删除**:ItemDetail、GroupDetail(内容并入纸面)、Totals(并入工具条)、Drill 换题转场
(整卷无"换题")、移动端列表/详情互斥切换(现在两栏堆叠成一页)。连带清理 48 个孤儿 i18n 键
(错误码等动态查表键已甄别排除)。EntryDialog/EntrySheet/申诉/补件对话框原样保留,
`?entry=`/`?detail=` 地址纪律不变(去申报先写 `?open=` 再开表单)。

验证(带 shell 骨架的 harness):12 项 DOM 断言全绿;rail 点击滚动落位实测 dist=64(恰为
scroll-mt);滚动跟随的边界数学经几何 dump 验证正确(此前探针的期望位超出了夹具内容的可滚
范围,是探针错不是代码错)。entry-workflow 五个用例改走「点行开抽屉」流后 9/9。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过(渐变 stop 类已进产物);prettier 全绿;
catalogs 7 passed。

### 试卷页的整洁小修(2026-08-18)

- **删掉每道题重复的「评分依据 尚未关联」占位框**:一处保留是占位,每题一框是噪音;数据到了
  再回来(Basis 组件与键仍被表单对话框和审核台引用,未动)。
- **纸面加一层 `bg-muted/20` 底色**:白底描边卡浮在白底上只剩线条,浅底让题卡立起来,
  段头渐变也有了对照。
- **节奏**:新段头上方留白加大(pt-7→8),与段内行距拉开档;题目左栏 gap 2→2.5、padding
  4→4.5,条件句不再贴着说明。
- **空态托盘收敛**(min-h-32→28、图标 8.5→8):一页里多个未申报题时,空态不再喧宾夺主。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 试卷页三处再优化(2026-08-18)

- **评分依据占位框恢复**(用户裁决:关联功能即将落地,座位留着),白底与题干浅底区分。
- **题干与申报两半区分**:左半题干加 `bg-muted/30` 浅底——试卷的题干栏着色、作答区留白,
  一眼分清哪边是题哪边是答。
- **卷面结构跟随滚动**:纸面滚动把高亮移到新行时,左栏自身也 `scrollIntoView(nearest)` 把该行
  保进视野(prefers-reduced-motion 时瞬移);高亮块改为 framer `layoutId` 共享元素——新增
  @qualy/ui/reveal 的 `Mark` 原语(动效词汇留在 ui 包,插件不直接依赖 motion),同一块
  accent 在行间滑动而不是逐行闪烁,spring 550/45,reduced 时零时长。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 申报详情抽屉的字号重调(2026-08-18)

抽屉宽 768px,原字号还是窄抽屉的比例:标题 15px、字段名 12px、答案 14px,读起来整体偏小。
按「答案是抽屉里最大的东西」重排:标题 text-base;分节标题(本人填写/按审核人要求补充)
xs→sm,靠字重与颜色分层;字段名 xs→sm;**答案与备注 sm→base**;补充答复与本人填写同一档;
时间戳、计数等元数据保持 xs。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 图片预览器与 Sheet 的两层冲突(2026-08-18)

两个 bug,一个来源链:

- **Sheet 里点图片打不开预览器**:`ArrivingImg`(渐显封装)只接收 src/alt/className——
  react-photo-view 的 `PhotoView` 是用 cloneElement 往子元素注入 onClick 来开预览器的,
  被组件吞掉后全产品的图片预览都静默失效。改为透传全部 img props(onLoad 链式合并)。
- **预览器开在 Sheet 上时点击穿透、Esc 双杀**:Radix 模态 Sheet 会把 content 之外(含 body 上的
  预览器 portal)设为 `pointer-events:none`,点击全部落到底下的 Sheet;Sheet 又在 document 上
  监听 Esc 与 outside-pointerdown。三处修法:`.PhotoView-Portal { pointer-events: auto }`
  (theme.css);共享 Sheet 组件的 `onEscapeKeyDown` 在预览器开着时 preventDefault(Esc 归
  预览器,再按才关 Sheet);`onInteractOutside` 对目标在 `.PhotoView-Portal` 内的交互
  preventDefault(预览器内的点击不算「Sheet 外」)。

实测(harness):portal computed pointer-events auto;Esc 第一次只关预览器、Sheet 仍在,
第二次才关 Sheet;用户实机确认。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过(portal 规则已进产物);prettier 全绿。

### 试卷页:段头替身条、常驻滑块、方案 A 定稿(2026-08-19)

多轮往复后定稿(全宽实验与"一段一张大表"两案均被否,已回退):

- **纸面形态(方案 A)**:白底(整页灰纹撤销)、题目独立圆角卡、编号正常字体、一级段头数字
  text-3xl/50 章节号化、题距 pb-4、申报表格末行也有封底线。
- **段头 sticky 改为"替身条"**:展示用的大圆角渐变卡留在纸面原处;另做一条 h-9 的矮横条
  (背景 95% + backdrop-blur + 底边线,内容对齐阅读列:编号 · 分组名 · 小计/上限),
  **绝对定位钉在窗格层**工具条正下——第一版误放进滚动内容里,`absolute top-13` 锚在内容
  坐标上跟着纸面滚走,只在特定几像素闪现;移到窗格层后实测钉在恒定 y。只在该分组自己的卡
  滚出顶部后出现(同处不报两次名),Appear 淡入淡出。
- **rail 高亮闪白根治**:`layoutId` 跨挂载接力在双 commit 下断链会闪白。改为**常驻单件滑块**:
  @qualy/ui/reveal 的 `Mark` 替换为 `Glide`(永久挂载的 absolute span,spring 追随
  top/height),Structure 量测活动行几何喂给它——没有卸载/挂载,就没有可闪的帧。实测 rail
  中 bg-accent 元素恒为 1。
- **配套**:点击转向锁(平滑滚动途中 spy 不逐行改高亮,Mark/Glide 一步滑到目标)、rail 跟随
  滚动用最近边视口数学(不可被取消、不牵动其他滚动容器)、spy 边界 +96 适配矮条。

实测:卡在屏时无条;滚进题目后条出现、连续滚动中 top 恒定;高亮元素全程唯一。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 58 passed;`pnpm build` 通过;prettier 全绿。

### 「去申报」时灵时不灵:同击双写竞态(2026-08-19)

一次点击要同时动两个地址层——`?open=<题>` 与 `?entry=new`。React Router 的函数式
setSearchParams 不在同一 tick 内串联:第二次写基于组件渲染时的快照,把第一次写静默丢弃。
`open` 停在旧值时,若那是个分组行,`writing` 恒为 null,表单永远不开;若是别的题,表单开错题。

修法:web-runtime 新增 `usePageQueryUpdate`——多键一次导航原子写;页面的「去申报」与抽屉内
「修改」都改走 `openAndFile(itemId, entryId)` 单写。新增回归用例:从 `?open=<分组>` 出发点
去申报,断言两参数同时落地且表单开在被点的题上(entry-workflow 10/10)。

另:用户描述的「点了没反应,过一会儿突然弹出、且好使后一直好使」的部分现象与本竞态不完全吻合,
高度疑似开发期 HMR 重载窗口(测试与本会话改码同时进行);已请用户在无编辑期复测,若仍复现,
下一嫌疑是模态层叠残留的 body pointer-events,备有探针方案。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 59 passed;`pnpm build` 通过;prettier 全绿。

### 试卷版式:满宽横线 + 右半独立表格 + 等高(2026-08-19)

题目卡的外框与圆角撤销,横线跑到窗格两边、内容仍在 `max-w-6xl` 量度里(`MEASURE` 常量,
段头/题目/工具条同一条中线);左右两半之间的竖线去掉、间距 40px,左栏 21rem;右半部分的申报
表格成为独立圆角卡(rounded-xl,主题 radius 实测 14px),并 `flex-1` 与左侧题目信息等高
(实测三种题:184/184、207/207、184/184 → 加高后 240/240、263/263)。

题目太"细长"(1104×220,表格 730×170 ≈ 4.3:1)的处理:高度靠内容而非 padding——①左栏条件
收成一张小面板(每条计分/最多几条/几人审核各占一行,底部接评分依据占位行);②申报行 py-2.5→
py-3.5;③表格底部多一个"下一条申报"的座位,吃掉剩余高度。改完 730×240 ≈ 2.9:1。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test:browser` 59 passed;prettier 全绿。

### 卷面结构与试卷的三处失联(2026-08-19)

三个症状,两个根因,全部有回归测试(apps/web/tests/paper-reading.browser.test.tsx,4 例):

- **首次点击瞬移、之后才平滑**:落地跳转把"读者刚写进地址的题"当成"页面带着地址进来的题"。
  第一次点击写 `?open=` 时落地那一枪还没打出去,瞬时跳转与 `goTo` 的平滑滚动同时开跑。
  修法:进页面那一刻把地址里的题记进 `arrivedAt` ref,落地只认它。
- **刷新后不自动滚过去 + 左栏钉死在 URL 那道题**:同一根因——滚动监听与落地跳转都在
  `rows.length` 变化时去找试卷窗格,而窗格是在 AsyncSection 骨架屏之后才挂载的:groups/items
  先到、standing 后到时,rows.length 已是 N 而页面还在骨架屏,两个 effect 拿到 null 直接
  返回,此后 rows.length 不再变就永不重试(没有监听 → passing 恒空 → 左栏退回显示地址里的
  题;没有落地 → 不滚)。修法:窗格改成 state(callback ref),effect 依赖
  `[paper, beside, rows.length]`。测试里把 getMyResult 延后 60ms 复现,未修时两条断言当场红。
- **卷尾大分组永远点不亮 / 点它反而冒 sticky 条**:判定线在窗格顶下方,卷尾的行滚到底也升不
  上去。现在到底时改用"最后一个还在屏幕里的行";sticky 条改为纯几何(只报卡片已滑到工具条
  以上的大分组),读者点着某个大分组过去、卡片就在眼前时闭嘴。转向锁从"1.5 秒到期"改成
  "只要试卷还停在点击停下的位置就认这一行"(`bring` 返回落点 scrollTop)。

另:定位一律算术 `scrollTo`,不再用 `scrollIntoView`(它会把所有可滚动祖先一起滚,双栏内滚
页面里会把外壳往上拽,工具条和左栏一起消失);左栏当前行加 `aria-current`。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 63 passed;`pnpm build` 通过;prettier 全绿。

### 试卷页文案与四种题态(2026-08-19)

- **顶栏**:移出滚动容器(sticky 的东西仍属于内容,overscroll 会带着它回弹),与左栏标题条
  同为 48px 含边框——测试断言两个滚动视口顶边坐标相等(此前差 1px)。
- **编号**:在整卷上算一次,`只看待办` 不再重排;段头 `01`/`01.1`,题号是贯穿全卷的连续号
  `1.` `2.`(与分组号形态不撞,不用汉字与罗马数字)。
- **动画**:@qualy/ui/reveal 增 `Sift`/`SiftRow`(popLayout,离场行淡出、其余滑上去),左栏
  筛选与右侧整卷/只看待办切换分别用它与 `Swap`。
- **空表**:表头常驻,提示落在内容区并带底色;可申报时是 xs 号 outline「新增申报」按钮。
- **四种题态**:普通空白(表头+按钮)/待工作人员录入(表头+等待提示+时钟图标+左侧禁用按钮与
  tooltip)/自动计分(虚线托盘、无表头、左侧「全员计入」徽标、术语行改「每人计 X 分」不再谎称
  工作人员录入)/已停用(默认折叠、灰化+删除线+写明停用原因,左栏行同样删除线并变矮)。
- **停用原因打通**:`voidReason` 从 AssessmentItem 列一路到 DTO(item/db → service → itemDto
  → api schema → 客户端 ItemDto)。
- **管理端自动型题目**:不再问「多条如何计分」「每人可申报条数」,金额标签改「每人计分」,
  小结与预览改「名单内每人计 X 分」,保存时 maxEntries 固定 1。
- **我的成绩**:列出全部题目,没有分数的以 0.00 + 原因成行(未申报/待工作人员录入/题目已停用);
  合并在前端做,服务端结算语义未动。
- 文案规则:zh-CN 不用「这道/这个/这次」(顺手改掉 item-voided);零值不用破折号(会被看成
  「一」),仍写 0.00,只弱化字色。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 96 files / 670 passed / 17 skipped;
`pnpm test:browser` 8 files / 63 passed;`pnpm build` 通过(staged web assets);prettier 全绿。

### 移动端外壳与我的填报三宽度(2026-08-19,设计稿 6a/7a/7b/7c)

**壳(layout-default,WorkspaceShell,对全部 workspace 页面通用)**:<lg(1024)时顶部应用栏折叠
(transition-[height] + inert,不是卸载,跨断点丝滑)、侧栏收到 w-0(同款宽度过渡)、上下文栏原样
(去掉旧的抽屉开关与 pl-9 让位 hack,批次名拿回整行);底部中央出现导航胶囊(44px、双横线 + 「导航」、
safe-area 锚定、Appear 出入场),点开底拉框:工作区页面两列格(navigationGroups 分组、徽标槽照旧、
当前页高亮)+ 底部「其他页面」条(折叠掉的应用栏去处:测评/组织)。**返回键语义**:抽屉开合放在
history entry 的 location.state 上——打开 push、关闭 navigate(-1) 消费自己那条、系统返回手势即关;
从抽屉导航后返回会回到"抽屉开着"的那层,与页面 query-layer 纪律一致。AppShell 未动(本轮只做
workspace 页面)。

**我的填报(7a/7b/7c,一张卷三处断点)**:

- Paper 段头三形态:手机两行(名一行、进度条一行)/平板 42px 单行/笔记本维持展示卡;子段头、题目
  网格(md 17rem、lg 19rem、xl 21rem 左栏;MEASURE px-4→lg:px-6)、条目表按宽度掉列:lg 四列、
  md 三列(版次时间折进内容格第二行,表头「内容与版次」)、手机去表头一条两行(状态点+版次时间在
  第二行、计分上下叠、行尾 chevron);新增申报/条数已满在手机上落到条目列表底部;左栏底部动作行
  md 起才显示。
- 工具条:手机两行(标题+meta+已计入 / 整卷·只看待办全宽 + 「结构」键),平板单行含「结构」键,
  lg 起无结构键;<lg 整块 sticky 顶部,**36px 段头替身条钉在其下沿**(滚过段头卡才出现,Appear
  collapse;桌面绝对定位替身条按设计稿删除——桌面有常驻结构栏定位)。
- 结构 <lg 收进底拉框(?rail=1 query 层,返回可关):Structure 加 variant='sheet'(不带汇总卡,
  表头行 = 卷面结构 + meta + 全部/待办),树与 rail 同一份;点行走 goTo——**open 与 rail 清除在
  同一笔 updateQuery 原子写**(双写竞态的老坑),滚动照旧 bring() 算术定位。
- 窄屏滚动监听:paneViewport 缺席时向上找 overflow-y auto 祖先(pageScroller);判定基线统一为
  「sticky 工具条底沿」(桌面上工具条在滚动容器外,底沿即容器顶,同一公式两形态通用);bring()
  在窄屏把 sticky 高度计入 clear,strip 的 36px 恒计(滚完它必然在)。
- Safari:viewport-fit=cover、-webkit-tap-highlight 透明、text-size-adjust 100%、胶囊与底拉框
  safe-area-inset-bottom。

**验证(浏览器真跑)**:壳 2 例新增(390×844 顶栏链接零可见+胶囊开抽屉见页面与其他页面、Esc 关闭
消费历史;从抽屉导航落地即关);试卷 2 例新增(结构键开抽屉→点行:rail=1 出现、open=<id> 落地且
rail 清除、页面滚动;段头条滚过 600px 出现且再滚不动)。截图核对 390/834/1280 三宽度与设计稿
7a/7b/7c 对齐。**已知偏离**:6a 底拉框顶部的「所在批次」行未做(上下文栏本就常驻批次切换器,用户
明示 6a 内容除外);底部动作条与胶囊的碰撞插槽(审核决定条场景)留待做审核页移动端时一并落。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 96 files / 670 passed / 17 skipped;
`pnpm test:browser` 8 files / 67 passed(新增 4 例);`pnpm build` 通过;prettier 全绿。

### 底拉框二稿:本人在头、页面在中、账户在底(2026-08-19,设计稿 t6 更新版)

设计稿 6a 更新后重做底拉框。壳保持零业务知识:@qualy/ui-contract 新增三个插槽
(app-shell/drawer-identity / drawer-account / drawer-sign-out),auth 认领——壳只负责三段容器,
身份与账户是谁拥有会话谁来填。

- **头部(auth/DrawerIdentity)**:头像垂直居中,两行——名字 + 学工号(未绑定时斜体提示,与桌面
  右上角一致)+ 类型徽标;第二行是**所在节点名**(不是设计稿初版的 '…/2023 级/软件工程 2302 班'
  截断路径)。点击同一行翻成一整行书写式完整路径(根→叶,'/' 相连,可换行),再点收回;两态同字号
  同行高,名字与组织行的间距不再跳动,也没有树状列表把导航挤下去。
- **底部(壳容器)**:第一行 auth/DrawerAccount——外观三态(与桌面菜单同一 ThemeChoicePicker,
  抽成 identity-bits 共享)+ 语言二态;第二行 其他模块(各模块带自己的图标——navigationGroups 的
  icon 经 useAppNavigation 携带,assessment/main 补 list-checks,org/organization 原有 users)+
  行尾 auth/DrawerSignOut 退出登录(匿名时不渲染,登录入口在头部)。文案 其他页面→其他模块。
- **session 只请求一次**:折叠的顶栏里 UserMenu 在进入页面时已取过 session;抽屉每次打开都是新
  挂载,react-query 默认 staleTime 0 导致再取一次(用户抓包发现)。三个观察者(UserMenu/
  DrawerIdentity/DrawerSignOut)统一 staleTime 30s,浏览器断言 sessionCalls === 1(开-关-开)。
  首开期间头部渲染同形骨架,不再"导航先出现、身份突然弹入"。
- **门禁修复**:fast-refresh 规则拒绝组件文件导出 initialsOf——拆成纯模块 initials.ts,
  identity-bits.tsx 只剩组件;测试 harness 补 ThemeProvider(与 App 同序,主题组件在测试里
  与真实环境一致)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 96 files / 670 passed / 17 skipped
(含 fast-refresh);`pnpm test:browser` 8 files / 68 passed(壳新增身份/账户/单请求集成用例);
`pnpm build` 通过;prettier 全绿。

### 底拉框首开跳动:chunk 预热(2026-08-19)

用户抓包发现首次点开底拉框时有三个网络请求 DrawerIdentity/DrawerAccount/DrawerSignOut——不是
API,是三个插槽组件的懒加载 chunk:首开才拉取,内容逐个到位,抽屉当着人面自己组装。修法:壳在
narrow 时就把三个插槽预挂载在一个 hidden 容器里(chunk 与身份背后的 session 一并预热,打开即整体
呈现);可见抽屉里再给 identity/account 两个插槽配 loading 骨架兜底(冷启动首拍也不跳)。浏览器
断言:开抽屉前 hidden 副本里已有用户名;可见断言全部改为 dialog 作用域(躲开常驻的预热副本)。
另:测评图标缺失是用户忘重启后端——描述器值 boot 时进 registry,客户端 HMR 带不动;重启后已现。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 68 passed;`pnpm build` 通过;prettier 全绿。

### CI 浏览器套件间歇失败:radix body pointer-events 泄漏(2026-08-19)

CI 在 entry-workflow「存草稿→点行→提交」处 13 秒重试 `<html> intercepts pointer events` 后超时;
本地 6 连跑全绿。实查 @radix-ui/react-dismissable-layer@1.1.19 源码:body 的 `pointer-events:none`
由模块级单变量 originalBodyPointerEvents + Set 计数管理,两层模态交接(填报 Dialog 退场动画未完、
详情 Sheet 已挂载)时清理顺序错位可把 body 永久留在 none——页面看着正常、点什么都没反应,刷新才好。
与用户此前实机"有时点不动、一旦好使就一直好使"完全同症(当时疑为 HMR,现定案)。

三处修复:①@qualy/ui 新增 modal-guard `releaseStuckBody`——Dialog/AlertDialog/Sheet 三个 content
卸载时等 500ms(退场动画完毕)后核验:无任何 open 的模态内容而 body 仍 none 即放开;后开的模态
自己会重新上锁,清理不可能与之竞争。②entry-workflow 在两模态交接处补 waitFor(dialog-content 为
null)——测试考的是流程,不该在慢机器上考 radix 的层叠竞态。③EntrySheet 面包屑分隔符移出
BreadcrumbItem(<li> 套 <li> 是非法 HTML,react 每次渲染都告警)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 670 passed / 17 skipped;
`pnpm test:browser` 68 passed(li 告警消失);`pnpm build` 通过;prettier 全绿。

### 退回事由开箱即用:系统默认复制到批次(2026-08-19)

审核页的 ReasonPicker、服务端 required/not-offered 强校验、事件文字快照本就完整;缺的是最后一步——
新批次从列默认 '{}' 起步,审核人永远没有原因可选。按裁决落地:**功能保留、不建理由主表、默认值在
创建批次时复制进现有 JSONB、批次此后自管、事件继续存文字快照**。

- `src/review/reasons.ts`:DEFAULT_REVIEW_REASONS 纯数据叶(双端可引,不是 i18n 文案——它与批次名
  同类,是管理员可编辑的业务数据)。退回八条(申报信息不完整/证明材料无法清晰辨识/申报内容与证明
  材料不一致/现有材料不足以支持申报内容/不符合本项认定条件/相关时间不在有效范围内/与已有申报重复/
  其他原因),复核四条(材料真实性存疑/认定标准存在争议/超出当前审核范围/其他原因);两表都以
  「其他原因」收尾——服务端拒绝表外文字,封闭列表会把预设都不符的审核人逼进死角。
- createBatch → insertBatch 落入默认(数据库默认 '{}' 仍作底层兜底,产品默认归应用层)。
- custom 迁移 20260819143000_default-review-reasons **只回填 '{}'**:配置过的原样,显式
  '{"reject":[],"escalate":[]}'(管理员主动关闭)原样——升级测试三形态并测(旧 lineage 建库→插三种
  批次→跑迁移→逐一断言)。
- BatchSettingsForm:每列表配「恢复系统默认」(仅在与默认不同且可编辑时出现,改 draft 不直接落库);
  退回提示改为裁决文案(选主要原因+具体说明,改删只影响之后);空列表显式说明(未设置预设……仅填写
  说明),复核列表拿到自己的提示与空文案;删掉无消费者的 settings/reasons 与语义错位的 reasons-empty。
- 测试 fixture(runningBatch 与 provisional-scoring 自建 round)在创建后显式关闭预设——那些用例
  考的是别的事;原因机制用例自行配置;新增用例断言"裸 createBatch 即带默认、两表以其他原因收尾"。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 96 files / 672 passed / 17 skipped
(含新迁移升级用例与 PGlite lineage 重放);`pnpm test:browser` 68 passed;`pnpm build` 通过;
prettier 全绿。

### 退回模态框:事由数字键与选中态、批次设置事由排序(2026-08-19)

- **数字键选事由**:1–9 直选(ReasonPicker 自持 document keydown,仅列表在场时挂;⌘/⌃/⌥ 与输入框
  内不抢)。与建议格的数字冲突裁决:**裸数字归事由**(每次退回必选),建议格跳转让位到 ⌥数字
  (行内 Kbd 提示同步改为 ⌥+n);⌥G 开合建议不变。
- **焦点交接**:用户实测发现说明框默认聚焦把数字吞进句子。改为:配置了事由时光标先不进说明框
  (数字落在事由上),**选中即把光标交给说明框**——数字选原因、接着打字,手不离键盘;未配置事由
  时照旧直接聚焦说明。RejectDialog 与 EscalateDialog 同款。
- **选中态**:选中的事由实心化(primary 底白字 + 对勾 + Kbd 反白),描边加粗的旧态一眼扫不出。
- **批次设置排序**:事由 chips 按 FieldTable 的拖拽家法可拖动排序(qualy/reason dataTransfer、
  左右半判定、inset 2px 落点标线、grip 图标),顺序即审核对话框的展示与数字键顺序(hint 注明)。
- 浏览器用例:Digit2 选中第二项(实心 + 对勾)→ 焦点已在说明框 → 仅事由不可提交 → 提交载荷带
  reason 文字快照。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 672 passed / 17 skipped;
`pnpm test:browser` 69 passed;`pnpm build` 通过;prettier 全绿。

### 键盘打开退回框时首个事由带环(2026-08-19)

按 R 打开(键盘发起)时 radix 把焦点落到第一个可聚焦控件——第一个事由 chip 戴上 focus-visible
环,读起来像"已选中";鼠标打开无环(focus-visible 启发式)。修法:FormDialog 增 `restfulFocus`
——onOpenAutoFocus preventDefault,焦点落在对话框容器本身(FocusScope 的兜底),数字键照落、Tab
仍可及、没有控件戴环。两个决定对话框在配置了事由时启用;未配置时说明框照旧 autoFocus。浏览器
断言:打开后 activeElement 不在 toggle-group 内。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 672 passed / 17 skipped;
`pnpm test:browser` 69 passed;prettier 全绿。

### 申报经过的声部混杂(2026-08-20)

参评人自己的「审核经过」里三种口径并存:轮内事件永远第三人称报名字(「示例学生 提交了申报」——
读者就是示例学生本人)、版本行用「我」(我提交了第 2 版)、补充与建议用「你」(等你补充、由你
决定)。审核端整卷经过(EntryHistory 带 subject)本来就是全三人称,没有问题。

修法:events.ts 增 OWN_VOICE 表——只有申报人自己的动作(submitted/cancelled-by-submitter/
appealed/abandoned-by-submitter/supplement-submitted)有第二声部(你提交了申报/你撤回了申报/
你发起了申诉/你放弃了申报/你补充了材料);EntryHistory 的 Act 与轮外事件按 subject 选声部,
subject 缺席(读者即申报人)走第二人称,审核人的动作在任何读法里都保留名字。「我」全部并入
「你」:trail-version→你提交了第 {no} 版、trail-answered→你补充了材料(en 同步 I→You)。
浏览器断言:本人经过里「你提交了申报」「你提交了第 1 版」可见,且「提交了申报」仅一处(没有
本人名字的第三人称行)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 672 passed / 17 skipped;
`pnpm test:browser` 69 passed;prettier 全绿。

### 审核读取边界:提交即失权(2026-08-20,按裁决)

用户实测发现:审核提交后仍能经 URL 读整个审核页(getReviewInstance 200),而同页的
/entries/:id/revisions 已按设计 404——两个门各写了一套读取授权。定案规则:**审核员的读取权来自
「当前仍承担这条申报的审核职责」,不来自「曾经审核过」**;approve/reject/escalate 提交即失权,
待补材料(awaiting_supplement)与停摆(blocked)是未完成任务、保留;申报本人与批次管理范围照旧。

实现:review/db.ts 单源 `OPEN_REVIEW_STATES`(mayReviewEntry 的 SQL 状态表改由它拼出);
review/service 拆两谓词——**mayAct(仅当前节点匹配,供动作端点:状态机继续给精确拒绝,同节点
两审核人赛跑时后到者得到 REVIEW_CONFLICT「已被处理」而不是装不存在,beacon 重发依赖这一点)**、
**mayRead(开放态 ∧ 当前节点,getReviewInstance 用它)**;附件侧 citingInstances 与
supplementCitingInstances 两条 reviewer 形查询补 `ri.state in OPEN_REVIEW_STATES`(entry 形、
subject/管理员路径不动)。客户端:工作台 done 屏对"本次会话刚裁决的实例"的 404 静默(那是边界
在生效,不是要盖在收尾屏上的错误)。

回归矩阵(review-access.test.ts,PG 真跑,反向验证过——撤掉修复 2 例当场红):两级链上
班级审核人/同节点搭档/学院审核人三视角 × instance/history/attachment 三门,逐节点断言
approve 交接后上一节点(含从未按键的搭档)三门齐关、下一节点齐开、completed 后最后一级也关、
本人与管理员恒开;补充材料期间三态保留、答复后保留、reject 后即关。errorOf 复用仓库助手
(Effect v4 cause 是 failures[],自写 _tag 判断会把一切失败读成放行——排查中踩过)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 97 files / 674 passed / 17 skipped;
`pnpm test:browser` 69 passed;`pnpm build` 通过;prettier 全绿。

### 浏览器测试分层:定位与断言分家(2026-08-20)

用户改了一轮中文文案,浏览器套件 24 例当场红——业务行为一点没变。裁决:**不是文案不该改,是这些
测试耦合过重**;并且明确否掉"把测试里的中文换成新的中文"这种修法(等于把雷埋回去)。三层纪律已
写进 CLAUDE.md 测试分层与禁止清单:

- **定位**照旧可用用户看得见的名字(role+name、label)——控件改名让测试红是合理的信号。
- **业务断言不得依赖界面文案**:给没有天然语义的元素加钩子,断言事实与值。本轮加的钩子:
  `stage-clock`(data-span/form/unit/count/rest——倒计时"两单位还是一单位"是显示决策,不是措辞)、
  `phase-when`/`phase-standing`/`phase-schedule`/`phase-refusal`(data-reason)、`phase-plan-empty`、
  `batch-list-empty`(data-empty=none|filtered)、`batch-pager`(data-page/pages)、
  `import-candidates`(data-ready/count)、`access-origin`(data-origin)、`access-sync-notice`
  (data-kind/pending/lapsed)、`access-permission-<code>` 与权限勾选框的 `data-permission`
  (按权限码断言"这一关只开放这些动作",而不是按标签文字)、`entry-standing`(data-entry-standing)、
  `trail-node`(data-kind)、`claim-row`(data-files)、`file-claim`(三个申报入口同一名)、
  `supplement-ask`、`decision-staged`(data-decision)、`run-done`(data-handled)、`result-mode`
  (data-mode)、`result-total`、`group-adjustment`、`type-summary`(data-users/placement)、
  `type-no-login`、`placement-panel`、`grant-nothing-offered`、`feedback`(data-tone)、
  `drawer-modules`、`drawer-account`。
- **只有以文案为对象的测试断言原文**:新增 apps/web/tests/localization.browser.test.tsx(3 例)——
  插值落位(本批次满分 10.00)、第二人称声部(你提交了申报/你提交了第 1 版 + 审核人保留姓名)、
  切 en-US 后同屏渲染英文默认值且中文不出现。catalog 完整性仍归 catalogs.test 门禁。
- **fixture 数据不是 copy**:批次名、人名、参评人填的字、题目字段标签照常直接断言——它们不随
  文案改版移动。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 97 files / 674 passed / 17 skipped;
`pnpm test:browser` 9 files / 72 passed(新增 localization 3 例);`pnpm build` 通过;prettier 全绿。

### 危险动作一律先问一句(2026-08-20)

三处修复合在一起交付:

- **卷面结构的高亮归滚动侦测所有**。原先 `openId` 在侦测没答话前回落到「第一道题」,于是进入
  我的填报时标记先落在题一、再滑到读者实际所在的分组带(左栏平移动画的来源);移动端点「结构」
  同样标到一道没人滚到的题。改为 `marked = passing || selected || null`——只标侦测认下的那条,
  两处调用点同源。
- **放弃申报的原生 `window.confirm` 拿掉**,提交审核 / 撤回提交 / 放弃申报三个动作合用
  EntrySheet 的一个 `ConfirmDialog`(按 `asking` 取词,放弃为 destructive);填报表单里的「提交」
  同样先问。
- **危险动作普查**:补上四处只需一次按压的不可逆动作——撤销角色授权(UserGrants)、删除分组
  (GroupEditor)、删除题目(ItemSettingsPage,标题带题名)、撤回补充材料要求
  (ReviewInstancePage)。核过不必再加的:VoidQuestionDialog 本就强制写停用原因,批次归档/删除、
  移出参评人、排期/取消排期、角色与用户类型的删除都已在对话框里;启用/停用这类可逆状态翻转
  不加模态,免得每次改状态都被拦一道。
- `ConfirmDialog` 的两个按钮加 `data-testid="confirm-accept"/"confirm-dismiss"`:答复一个问题
  不该依赖那句问话的措辞。entry-workflow 的提交用例据此加断言——按下「提交」只开对话框、
  `setEntryStatus` 未被调用,确认后才发出;已反向验证(把按钮改回直接提交,该例当场红)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 97 files / 674 passed / 17 skipped;
`pnpm test:browser` 9 files / 72 passed;`pnpm build` 通过;prettier 全绿。

### 审核页面的三种宽度(2026-08-20)

按设计稿 2a/2b/2c/2d 改造审核工作台与待审队列。设计稿自带「改动落在这几行」,逐条落地:

- **工作台在每个宽度都填满一屏**。原先只有 lg 以上是一屏三栏,窄屏整页生长、决定条掉到页面底部。现在
  外层恒为 `min-h-0 flex-1`,三栏在窄屏接进**同一个滚动区**,页头与决定条一上一下钉住——手机上被审的
  东西滚动,做决定的东西留在拇指底下。窄屏那条网格轨道要显式 `grid-cols-[minmax(0,1fr)]`:默认 auto 是
  max-content,决定条整排键当场把工作台撑得比屏幕宽。
- **三档而不是两档**。两栏从 64rem 起(2b 平板 1194、2c 笔记本 1280 是同一张脸);**第三栏(条目信息)
  推到 96rem 以上**——1280 上它要吃掉申报内容 21rem,而申报内容是唯一需要细看的一栏。1280 以下条目信息
  收进标题栏的键,推出右侧一层(2d);窄屏则是整页的最后一节。三种形态**同一份渲染**(`AboutParts`),
  两个宽度看到两个版本的规则是不能接受的。
- **锚点条 PartStrip**(窄屏,标题栏下 40px):审核流程 / 申报内容 / 条目信息,滚动侦测标记读者所在那一节,
  点击平滑滚过去,滚动后右侧出现「回到顶部」。它标位置、不切页面,回退键仍然回队列。标记用新的
  `Marker`(@qualy/ui/reveal,layoutId 平移)在三个 chip 之间移动;并列宽度下整条折成 h-0 而不是消失。
- **触摸端按住提交**:`pointer: coarse` 时决定条换形——文字框让位(手机上弹起键盘会盖住被审的材料,写字
  走「备注」开的那个真正的框),提交变成整行 `HoldToSubmit`,按满 900ms 才发出,中途松开不生效且填充回弹。
  **快捷键只在 `pointer: fine` 挂载**:A=通过 这种字母键不该躺在拇指底下(平板接键盘仍报 fine)。
- **窄屏的出口与底部**:标题栏左侧补「待审核列表」键(lg 以上由队列栏承担),头像/徽章/翻页键在窄屏收起。
  底部那一格给了决定条——新增 `ScreenFootScope` / `useClaimScreenFoot`(@qualy/web-runtime,与
  WorkspaceCapabilityScope 同一套路,计数而非布尔,换页时两屏并存不会互相抢),壳层据此把导航胶囊收起;
  没有决定条时(轮次已结束、连审收尾屏)不认领,免得手机上两样都没有。撤回浮条窄屏抬到 bottom-36。
- **待审队列**(2a 第一屏):三个分组视图的行都是写死的 `gridTemplateColumns`,390px 上 11rem 姓名之后
  就没地方了,而外面那张卡是 `overflow-hidden`——**页面看着完整,时间与状态其实已经被裁掉**。窄屏改为
  `max-md:flex-wrap`:姓名/学号/时间/状态一行,申报内容落到第二行;列名行 `max-md:hidden`。
- 媒体查询改为**首帧同步读**(`useMedia` 惰性初值):原先初值猜 true 再由 effect 纠正,手机第一帧画的是
  宽屏形态,而换滚动条的那两栏会把内容整个丢掉重建。

**测试**:新增 apps/web/tests/review-layout.browser.test.tsx(6 例,唯一 import 真实样式表的套件——
它断言的就是"某个宽度露出哪几部分",没有样式则所有断点是同一张脸)。断言全部落在 `data-workbench-part`、
`data-reading`、`data-holding` 这类事实上,不绑文案。逐条反向验证过:去掉 `lg:hidden` → 平板那例红;
按下即提交 → 「轻点不发出」红;去掉队列的 `max-md:flex-wrap` → 行的 scrollWidth 超出 clientWidth 那例红。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 97 files / 674 passed / 17 skipped;
`pnpm test:browser` 10 files / 78 passed;`pnpm build` 通过;prettier 全绿。

### 审核页面按新版设计稿返工(2026-08-20 下午)

设计稿更新(2b/2c 重定义、新增 3a),按稿逐项落地:

- **三栏与桌面同构,让位的是队列**。上一版把第三栏推到 96rem、中间宽度用 Sheet 推出——新稿裁决相反:
  lg 起三栏(0.82fr/1.18fr/21rem)永远都在,**放不下的是队列栏**(`min-[84rem]:` 起才并列);中间宽度
  队列收成标题栏左侧的小键(「队列 N」),点击回队列页。书本 icon 与 AboutSheet 整个删除。
- **3a 一页三形状**:窄屏正文不再重复段名(名字只在锚点条)——审核流程/申报内容的标题行 `max-lg:hidden`,
  完整经过入口移到流程末尾一行、对照键留在版本行;段与段之间用 10px 通栏浅灰带(`PartBand`)替代 border,
  条目信息一节整体浅底(`max-lg:bg-muted/30`),第三栏标题全部降为 caption(text-xs muted)。
- **锚点条按稿重做**:36px 高,当前 chip 圆角背景 + 后缀(审核流程→第 N 轮,申报内容→第 N 版)。
  之前"只有文字没有背景"的病根是 Marker 用了 `-z-10`——负 z-index 会沉到任何绘制背景的祖先(壳层
  `bg-background`)之下,标记其实一直在、只是被盖住。改为 DOM 顺序在前、文字 `relative` 盖上,不再依赖
  负层级。
- **键盘痕迹全部跟指针走,不跟宽度走**:快捷键 Kbd 角标(C/E/R/A、D/⇧D、H、⌥N)、快捷键提示、说明输入框,
  原先按 lg 显隐——平板(lg 且 coarse)全都露了出来。现在一律 `useFinePointer()` 条件渲染:touch 端无论
  多宽都没有键盘家具;决定键 coarse 时 h-11,按住提交在平板并入按键行(lg:w-44)、手机独占一行。
- **设计注释文案下页面**:「按住约一秒才提交,中途松开不生效。」「提交后 5 秒内可撤回。」是稿上给实现者
  的说明,已从 hint 行与消息表删除(reviewHoldHint 删除、hint-armed-approve 与 submit-hint 去掉 5 秒
  从句);touch 端整条 hint 段落不再渲染,等待态由按住键自己的「先选择一项决定」承担。
- **标题栏**:返回键从「< 待审核列表」大按钮改为小「队列」键(h-8,窄屏无计数);参评人头像窄屏也显示
  (size-8,与 PC 一致);快捷键提示仅 fine。
- **智能审阅移位**:从审核流程栏的虚线卡移到申报内容底部(`order-last mt-auto`,lg 起 `sticky bottom-0`
  吸附,内容长时钉在栏底、短时紧随字段),PC 同步;免责短句并入同一块。
- **后端修复:审核员不得看到草稿**。`siblingEntries` 原先只排除 voided,「该参评人员的其他申报」把
  参评人**从未提交**的草稿也发给了审核员。改为 `status not in ('voided','draft')`;新增回归测试
  (review-workbench:同题一条已提交、一条草稿,页面读取的 siblings 只含已提交那条),反向验证过
  (还原旧条件该例即红)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 675 passed / 17 skipped(新增草稿回归 1 例);
`pnpm test:browser` 10 files / 78 passed(review-layout 6 例改为断言新布局:1280 三栏+队列键、1680 队列栏);
`pnpm build` 通过;prettier 全绿。

### 决定栏与输入框:形状跟指针,不跟宽度(2026-08-20 傍晚)

用户连报三个同源症状:①手机上决定键 44px、按住提交 48px 不同高;②笔记本缩窗到平板宽度,按键突然
变高变小字;③「填写审核说明」placeholder 窄屏突然变大。根都是**用宽度断点近似触摸端**:

- 按住提交统一为 h-11(与按键同高;平板并排 lg:w-44),一条栏里只有一个高度。
- 决定键的触摸尺寸(h-11/px-3.5/13px)从 `max-lg:` 改为 `!fine && TOUCH_KEY`——形状只跟
  `pointer: fine/coarse` 走,fine 指针在任何宽度都保持桌面尺寸,缩窗不再变形;探针断言 1280→1000
  两次测量的整栏高度序列逐项相等。
- @qualy/ui 的 Input/Textarea:`text-base md:text-sm` 改为 `text-base pointer-fine:text-sm`
  (Tailwind 4 内置变体)。16px 本是 iOS 聚焦缩放的护栏,按宽度切导致桌面窄窗变大、宽 iPad 反而失去
  护栏;现在 fine 一律 14px、coarse 一律 16px。探针:fine 指针 390px 窗口输入框 computed 14px。
- 顺带修滚动侦测:内容一屏放得下时「到底即最后一节」规则把开屏标记放到了条目信息;补上「可滚动才算
  到底」前提,短页开屏标第一节。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test:browser` 78 passed;`pnpm test` 675 passed /
17 skipped;`pnpm build` 通过;prettier 全绿。

### 决定栏与决定弹层的触摸端返工(2026-08-20 晚)

- **锚点条滑块闪白**:Marker 用 motion `layoutId` 在 chip 间交接,交叉淡入把新旧两个元素各画半透明一瞬,
  浅底上就是旧位置闪白。换成 reveal 的新原语 `GlideAcross`(Glide 的水平双胞胎):单个常驻元素,
  PartStrip 量出当前 chip 的 offsetLeft/offsetWidth 后位移过去,构造上不存在交叉淡入。Marker 删除。
- **决定键排布**:仓库 Button 基类是 `rounded-4xl`,44px 高的胶囊里 13px 字悬在中间,难看的来源。
  触摸键改 `rounded-xl` + `flex-auto min-w-0 px-2`——整行占满、余量均分但每个键保住自己的字宽
  (纯 flex-1 均分会把 390px 摊成五个 66px,「要求补充材料」放不下)。
- **HoldKey 重做并抽成共享组件**(review/touch.tsx;useFinePointer/useMedia 因 fast-refresh 门禁
  拆到 review/pointer.ts):文字一次画在键色、一次画在填充色里,后者按**键的实测宽度**(ResizeObserver)
  裁切——之前用 100vw 估宽,键窄于屏幕时文字被压扁、看起来从左边挤进来;现在两层文字重合静止,
  眼睛看到的只有背景扫过。armed 未按时加 `animate-pulse` 底色脉冲邀请长按;文案改成动作指令:
  「长按提交」(waiting 仍是「先选择一项决定」)。
- **退回/提请复核在触摸端改为底拉框**(设计稿 2a):把手、标题+一句提示、事由 chips、说明 textarea、
  底部 `HoldKey`(「长按提交退回」/「长按提请复核」,未填完显示「先填写必填内容」);建议改法表格是
  桌面 affordance,390px 无诚实排法,sheet 不含。数字快捷键、⌥G、Kbd 角标、autoFocus 全部 gate 在
  fine 指针上——触摸端弹层里不再出现任何键盘痕迹。
- **modal-guard 提前一次检查**(250ms + 600ms 兜底):单次 500ms 检查留出的半秒死窗口足够 CI 点一次
  空气。
- **CI 修复**:entry-workflow 提交用例的 `getByRole('button', {name:'提交'}).first()` 撞上子串匹配
  ——行内状态片「未提交」也含「提交」,慢 runner 上解析到抽屉遮罩下的行按钮,重试到超时。改为先断言
  抽屉可见、再在抽屉作用域内按真实名字「提交审核」定位。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 97 files / 675 passed / 17 skipped(fast-refresh
门禁曾红,拆出 pointer.ts 后绿);`pnpm test:browser` 10 files / 78 passed;`pnpm build` 通过;prettier 全绿。

### 审核动作模型:取消独立「备注」,意见随动作走(2026-08-20 深夜)

领域裁决(经与用户对话定案):**不是「备注与退回意见合并」,而是取消「备注」作为独立审核动作**——
通过/退回/提请复核是动作,「审核意见」是每个动作携带的附属信息;「退回原因」仍是独立的结构化字段
(批次配置列表校验不动)。补充材料保持独立接口,不塞进 ReviewDecision。

- **服务端**:`ReviewDecision` 收为 `'approve' | 'reject' | 'escalate'`;`decisionsAt()` 不再派发
  comment;decideReview 删除「意见不推进流程」分支;API schema 同步。**不加**「每人每轮一条」的唯一
  约束——一个审核事件天然只有一份意见。历史 `kind='comment'` 事件只读保留,渲染照旧;handledToday
  的计数 SQL 保留 comment(只有历史行会命中)。无数据库迁移。
- **工作台**:底栏状态机(armed/word/sayNote/submitArmed/WritingBox/输入框)整体删除,只剩四个真正
  改变业务状态的键,按轻到重排:要求补充材料 → 提请复核 → 退回 → 通过(桌面右对齐,行尾是句号位)。
  点击任一键打开该动作自己的面板:桌面 Dialog(⌘↵ 确认、Esc 关闭重选),移动端底拉框。新增最轻的
  `ApproveDialog`(一个可选「审核意见」);SupplementDialog 也补了 Sheet 形态。五秒撤回窗口保持不变。
  键盘:A/R/S/E 一律「打开面板」,⌘↵ 归面板所有,页面级 chord 与 C 键删除;KeysPanel 同步改写。
- **滑动提交替代长按**:长按会触发系统文字选择/放大镜,`HoldKey` 删除,新 `SlideKey`(验证码式滑块):
  把手从左拖到右 ≥85% 松手才发出,中途松开回弹;进度轨迹上色、文字随进度淡出。**修了一个真实竞态**:
  快速一划时 pointermove 与 pointerup 落在同一帧,release 闭包里的 `at` 还是上一次渲染的 0,干净的
  整滑被判为零——逻辑距离改走 ref,渲染值照旧走 state。
- **DoneScreen** 删掉「本组审核结果」逐条列表分区(reviewDoneList/reviewDoneFinal 文案一并退役)。
- **文案**:`assessment/review/comment` 统一为「审核意见」;16 条退役消息(备注/提交决定/armed 提示/
  长按系)从 descriptor 与 zh-CN 成对删除;快捷键面板词条改为「打开××面板/确认当前动作」。
- **测试**:review-flow 的 decisions 集合断言去掉 comment;entry-workflow 通过用例改走面板流(点通过
  →面板→面板内确认),审核说明→审核意见的按名定位跟进;review-layout 触摸用例重写为「点开底拉框、
  半滑不发出、整滑发出」。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 97 files / 675 passed / 17 skipped;
`pnpm test:browser` 10 files / 77 passed;`pnpm build` 通过;prettier 全绿。

### 复核中途退回归阶段管;四个动作常驻底栏(2026-08-20 深夜二)

领域重裁(经与用户对话定案,§32.63 已更新):**「复核中途能否退回」不再由 ReviewInstance 的创建路径
暗中决定,改为阶段显式开合的审核动作**。

- **新阶段动作** `assessment.review.reject-intermediate`(「允许复核中途退回」):加入 REVIEW_ACTION_CODES
  与 PHASE_GATED_CODES,与 escalate 同类——不是 RBAC 权限,是阶段开合的审核员动作;阶段编辑器矩阵自动
  长出该项(标签+提示文案已补,checkbox 数 12→13)。
- **`rejectPolicy` 从领域整体移除**:规则变为「普通路线任意节点可退回;复核路线末端永远可退回,中间
  节点由当前生效阶段实时判定」。申诉不再硬编码 terminal-only——想要申诉仅末端可退回,就在申诉处理
  阶段不开启该动作,差异来自管理员配置而非 `origin === 'appeal'`。实体删列,迁移
  `20260820095421_drop-reject-policy.sql`(destructive,drop-guard 放行);entry/item/review 三处
  db 与 service 的读写全部清除。明知的代价:进行中的复核随阶段切换改变中间节点能否退回——这正是
  阶段权限应有的语义,已写进 §32.63 重裁记录。
- **审核详情从 `chain.decisions` + `capabilities.canRequestSupplement` 改为四个 ActionAvailability**
  (`actions.approve/reject/escalate/supplement`,`state: available|blocked` + 稳定 reason 码)。
  服务端给出准确的禁用原因:`in-escalation` / `no-route` / `route-closed` / `phase-closed` /
  `terminal-only`,前端只翻译不推测。decideReview 校验共用同一 decisionsAt,reject 在复核中间节点时
  才额外查一次阶段(锁内少付一次 gate 查询)。
- **工作台四键常驻**:不再条件渲染。分组语义排布——提请复核/要求补充材料是改变路径的分流动作,
  退回/通过是本环节裁决:宽屏一行 `[分流二键] — spacer — [裁决二键]`;手机 spacer 变折行
  (`max-sm:basis-full`),分流键紧凑靠左、裁决键各占半行——**不是 2×2**(读作数字键盘),也不造第五个
  按钮,也不给通过更宽(避免决策诱导)。同一容器一套渲染,两个断点两种排布(此前双容器把每个键渲染两遍,
  strict 定位当场炸)。禁用态:fine 指针 disabled+span 包裹出 tooltip 讲原因;coarse 无 hover,键保持
  `aria-disabled` 可按,按下 toast 讲原因而不执行。中间节点的「通过」tooltip 改为「通过当前审核环节,
  交由下一复核节点处理」,与末端「通过本次审核」区分。
- **测试**:node 新增「阶段开启后中间节点可退回且真正退成」回归例(反向验证过:去掉 gate 或条款该例即红);
  原「任意节点可退回」的 escalated 断言按新规则改为 terminal-only blocked;申诉用例删 reject_policy
  raw SQL 断言。浏览器新增两例:四键常驻+blocked 按下弹原因不开面板、手机 2 compact + 2 大排布几何断言;
  阶段编辑器 13 项断言更新。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 97 files / 676 passed / 17 skipped;
`pnpm test:browser` 10 files / 79 passed;`pnpm build` 通过;prettier 全绿。

### 审核台细节一轮清扫(2026-08-20 收尾)

- **补充材料面板长出键盘**(仅 fine 指针):⌥F/⌥T 追加文件/文字要求并把光标交给新行的名称框,
  ⌥1–9 选中第 N 行名称,⌘↵ 发送;按键上佩戴对应 Kbd 角标。浏览器回归例:纯键盘加行、光标落位、⌥1 回跳。
- **DoneScreen 平板宽度左偏的病根**:工作台外层是 `lg:grid-cols-[auto_minmax(0,1fr)]`,队列栏在
  84rem 以下 `display:none` 后,内容列落进 auto 轨、旁边留着一条空 1fr——**整个工作台只占一半宽**。
  改为 flex(队列栏 shrink-0 自持宽度动画,内容列 flex-1),量过:run-done 容器 1..1194 全宽,
  内文 576px 居中。
- **我的申报操作反馈**:提交审核/保存草稿/撤回/放弃四个动作补 toast(已提交审核。/草稿已保存。/
  已撤回,恢复为草稿。/已放弃申报。);申诉与补充材料原有提示不动。
- **上轮结论卡窄列溢出**:标题被钉在徽章与时间同一行,窄列里被压到 min-content 一行一字。改为
  flex-wrap:标题 `flex-1 basis-44` 按词换行,放不下时「第 N 轮 + 时间」整组落到下一行——按列宽
  自适应,不看视口断点。
- **待审列表时间**:新 `useDayClock`——今天显示 HH:mm,昨天显示「昨天」,更早显示 MM/DD;
  裸时钟在跨天队列里把昨天 18:16 和今天 18:16 画成同一行字。
- **右栏(条目信息)样式**:栏目 caption 降为 11px 加字距的弱标签,链条里的「常规审核/复核」升为
  text-sm medium——此前三者同款式,路名和栏目名不可分;栏距 pt-3→pt-4、内边距放松到 p-5。
- **待审列表重做**:标题升 text-sm;折叠改用壳层同款机制——内容恒为 w-56、外壳裁剪动画宽度,
  开合是两层透明度淡入淡出,不再有布局扭曲;**折叠态只剩把手与数字**(展开键、返回键、分隔线、
  计数胶囊)——原来那列 32px 灰头像配黑圈像一排遗照,「谁在等」本来就是展开列表的答案,折叠态
  只有「几个在等」是诚实的。
- 决定键行左内边距对齐调整(px-3 → 与内容列一致)。
- 补:⌥F/⌥T 角标在 outline 按钮的灰底上靠色不可见(Kbd 默认 bg-muted ≈ 按钮 bg-input/30),
  改白底描边;边线用 inset ring 而不是 border——border 计入盒宽,把 ⌥ 从 20 撑到 22,与上排
  ⌥1 不同框(探针断言两处 kbd 同为 20x20)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 97 files / 676 passed / 17 skipped;
`pnpm test:browser` 10 files / 80 passed(补充材料键盘 1 例新增);`pnpm build` 通过;prettier 全绿。

### 复核链重裁:逐级裁决链、同轮回避、合议席位、环节命名(2026-08-20)

按用户当日长裁决整体重构审核模型(领域定案入 assessment-design **§32.66**,§32.63 二作废):

- **复核链改为逐级裁决链**:复核任一环节 approve ⇒ 整轮通过;中间环节 reject ⇒ 意见随轮上提
  (新事件 `opinion-rejected`,非终局),终局否定只属链尾;中间环节 escalate ⇒ 上提且**不受**
  escalate 阶段门控(门只管普通链入梯)。`assessment.review.reject-intermediate` 阶段动作整体撤销
  (permissions/门/阶段编辑器/i18n/测试同步)。ReviewActionView reason 收敛为
  `no-route|route-closed|phase-closed|route-end`。
- **同轮跨环节回避**(仅复核环节):本轮已作正式判断者(events approved/rejected/escalated/
  opinion-rejected + 非 superseded panel votes)不得再任后续复核环节,一条 SQL 谓词并入 mayReview
  组合(收件箱/awaiting/详情/决定/巡检同源);普通链不回避;申诉/重路由是新轮不继承——被申诉
  决定的作出者可再任申诉裁决人(测试显式断言其队列含申诉轮)。
- **到达裁决 resolveArrival/stageArrival**:members=0 ⇒ blocked `no-assignee`(缺员永不跳过);
  members>0 且 eligible=0 ⇒ 复核中间环节跳过(事件 `stage-skipped`,链视图标 reviewer-conflict)、
  末端 blocked `no-independent-reviewer`。`review_instances.blocked_reason` 新列 + 同形 CHECK,
  entry submit / decide / appeal / reroute / patrol 全部走同一 resolver;appealReview 补上 ADR 0007
  欠账的自审跳过。管理员告警(reviewAlerts)按 reason 分行展示。
- **合议**:quorum `all` 开闸,仅限复核链非末端(校验 reason policy-quorum-all-normal/-terminal,
  atLeast 继续拒绝)。新表 `review_panels / review_panel_assignments / review_votes`(部分唯一索引
  守并发:单开 panel、席位单占、一席一票)。到达即按 eligible 快照席位(3 人回避 1 ⇒ 2 人合议),
  席位数冻结;全员同意 ⇒ 通过(事件 approved actor 空),否则含 0:N ⇒ 上提(escalated actor 空);
  成员 escalate 短路;补件答复(证据变更)supersede 重组、取消原样恢复;未投票者失权成空缺
  (eligibility-lost),新合格者投票时原子补位,已投票**不因撤权失效**;投票至同席结论前保密
  (votes 不写事件,open panel 不进 DTO),resolved panel 意见经 chain.stage.opinions 交后续裁决人;
  decideReview 全程持 instance 行锁;handledToday = 事件 + votes。巡检升级 panel-aware
  (reconcile 失权席位、blocked_reason `panel-seat-unfilled`)。
- **环节命名**:PolicyStage.label(≤50,校验 policy-label-invalid),编辑器必填(StageSheet 名称框 +
  处理方式 any/all 选项,末端自动折回 any),链视图 label 为主、单位/角色为兜底小字。
- **审核员 UX**:四词恒在;复核模式 = 顶部 amber 斜纹警示带(全宽度)+ 复核徽标全宽度可见;
  申诉轮 banner 直接展示申诉理由(appealed 事件 comment);合议/补位/BLOCKED 概念不出引擎与
  管理端;事件文案补齐(轮次自己的声音:panel-approved/panel-escalated 无主语句式)。
- **迁移**:`20260820131214_review-panels.sql`(三新表 + blocked_reason + 回填 UPDATE 后加 CHECK;
  实测踩到生成器把复合 CHECK 内 IN-list 输出成非法 `ARRAY[...][]`,实体侧改写为 IS NOT NULL 形式)。
- **测试**:node 重写 review-flow 三例(梯上任一环节可结案+提审人回避、异议上提+终局链尾+巡检解锁、
  回避跳过 vs 缺员阻塞)、appeal 例(原裁决人可审申诉、route-end);新增 **review-panel.test.ts 七例**
  (席位快照/一致通过/分歧上提携意见/成员短路/票越撤权+补位+不扩席/无空缺不纳新/补件答复重组 vs
  取消保留);policy/item-config/routes 断言更新。浏览器:batch-admin 阶段动作 13→12;stage fixtures
  补 label/opinions;review-layout 新增「复核环境」例(警示带、申诉理由、环节名、意见方向 data-*、
  route-end blocked)。旧行为的三个失败例先红后改,证明回避与裁决语义真实生效。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 98 files / 687 passed / 17 skipped
(含新增的 review-panels 升级测试:旧库血统建 blocked 行 → 跑迁移 → 断言回填 no-assignee 且
CHECK 拒绝置空);`pnpm test:browser` 10 files / 81 passed(复核环境 1 例新增);`pnpm build`
通过(staged web assets);prettier 全绿;`pnpm qualy resolve` + `pnpm qualy generate` 实跑出迁移。

### 审核链编辑器可用性四修(2026-08-20 追加)

- **未命名环节标红,不再穿缺省名**:环节名是必填项,链上未命名的环节标红显示「未命名环节」,
  不再以「专业／审核员、组织管理员」这类单位+角色组合冒充已完成;序号圆点同样转红色虚线
  (completeStage = 已命名 ∧ 已选审核人)。StageSheet 名称输入框 aria-required,提示语明写
  「必填」。已命名环节的单位+角色组合降为小字辅助信息保留。
- **删除键常驻**:普通链仅剩一个环节时删除键不再消失,改为 disabled + hover tooltip
  「普通审核链至少保留一个环节」(span 包裹使禁用键可应答 hover)。
- **环节可排序**:已有的 moveStage 接上 UI——每个环节下常驻 前移/后移 图标键,端点处 disabled;
  控制行(前移/后移/删除)从 hover 显现改为常驻,悬停才出现的控件对不知道它存在的人等于不存在。
- **加号常驻可见**:链条间隙的 + 从 opacity-0 hover 显现改为常驻,并缩小为 size-5 虚线圆
  (与 size-6 实心序号圆区分开,悬停/聚焦转实线),不再需要碰运气 hover 才能发现如何加环节。
- **测试**:新增 apps/web/tests/item-chain.browser.test.tsx 三例(未命名 → data-step-complete
  事实断言、命名+选人后转 true;加号可见性以 computed opacity 断言——红验证过:恢复 opacity-0
  即红;唯一环节删除键 disabled、双环节后移交换顺序、删余一个后重新入禁)。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 98 files / 687 passed / 17 skipped;
`pnpm test:browser` 11 files / 84 passed(item-chain 3 例新增);prettier 全绿。

### 授权模型重裁:自授禁令 → 自我提权禁令;任命图成为真实授权(2026-08-20)

按用户裁决重构 rbac 授予模型(CLAUDE.md 访问模型段已同步改写):

- **blanket 自授禁令废除**:`GRANT_SELF_FORBIDDEN` 错误、grantRole/revoke/options 里的
  `actor === target` 拦截全部删除。自授的新边界是**不得扩权**——目标角色权威 ⊆ 自身现有权威且
  coverage 不更宽(`assertNoSelfEscalation`,复用原 escalation 比较但**无任何逃生**);自撤开放,
  照常受 grant-manage 与最后管理员保护约束。系统管理员(all-active)因此可直接给自己挂审核员等
  业务身份——最初那个「管理员进不了审核链」的场景不再需要第二个账号演戏。
- **对他人授予不再比较权限集合**:任命权完全由 `role_grant_rules` 承载(WHERE=grant-manage,
  WHAT=任命边,WHO=eligibility,SCOPE=覆盖);人事角色无须亲自持有其任命岗位的业务权限。
  `iam.org-role.bind`/`iam.tenant-role.bind` 两枚逃生权限从目录删除
  (迁移 20260820160000_drop-bind-permissions.sql,含升级测试:旧库带 bind 的角色 → 跑迁移 →
  只剩真实权限、目录零残留)。
- **任命图写入时自洽**(`setGrantableRoles` 重写):拒自环、递归 CTE 拒成环(tenant lock 内无
  TOCTOU)、只可任命同 kind、granter 自身必须携带对应 grant-manage(杜绝潜伏边);新增边按
  角色定义同一标准量作者权威(`assertMayDefineRole`,`iam.role.escalate` 逃生);编辑任命图
  改需新权限 `iam.role.appointment.manage`。新错误 `ROLE_APPOINTMENT_INVALID`
  (reason: self|cycle|kind|granter-capability)。
- **改活跃角色权限 = 改职位本身**:RoleEditor 保存前 ConfirmDialog 展示影响面(grantCount
  持有人数 + 入边任命角色数,`getRoleGrantableRoles` 响应新增 appointedBy);任命边不因目标
  角色扩权而隐式失效。角色编辑器的任命候选收敛为同 kind、非系统、非自身,且角色未持有
  grant-manage 时整段替换为提示;options 探针的自授越权单列 refusal `self-escalation`
  (rbac contract + assessment schema + RolePicker 文案),GRANT_ESCALATION_REFUSED 文案改为
  自授语义。
- **测试**:effect-rbac 25 例全绿——原「不许自任/自撤」两例按新语义改写(自授职内成功、
  自撤需 grant-manage、最后管理员仍拒),新增「人事角色可授出自己不具备的岗位、自授即拒、
  canonical 自授成功、picker 单列 self-escalation」与「任命图五律(自环/异 kind/潜伏边/成环/
  作者越权)」两套;assessment「管理员自我 staffing」期望翻转为成功;seed 权限数 25→24;
  migration-upgrade 新增 bind 清理升级例。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 98 files / 690 passed / 17 skipped;
`pnpm test:browser` 11 files / 84 passed;`pnpm qualy resolve` 重写 lock(新迁移入 lineage);
prettier 全绿。

### 申报记录改为轮次分组时间线;流程迁移三选一(2026-08-21)

按用户裁决重做申报历史与流程迁移决策:

- **申报记录以审核轮次为一级分组**(EntryHistory 重写):轮次倒序、轮内事件同样倒序;每轮 section
  头部「第 N 轮审核 · 进行中/已结束」;开启事件与结束事件显式标注「第 N 轮审核开始/结束」
  (data-testid round-mark,按用户当场追改用轮次号而非「本轮」);开启本轮的申报版本落在该轮
  section 底部。原实现把五张表按 timestamp 混排,reroute 同事务同秒写入时 stable sort 把第 4 轮
  排在第 5 轮之上——现在轮次锚点相同时按轮次号取新者,病根消除。
- **reroute 成为轮次转换事实**:item/service 不再给新轮补写第二条 `rerouted` 事件(旧轮一条事件 +
  新轮 origin/supersedesInstanceId 即完整事实);历史视图旧轮结尾展示「后续由第 N 轮按调整后的
  流程继续」、新轮开头合成「因审核流程调整开始本轮审核/承接第 N 轮」(变更原因取自旧轮事件,
  旧数据的重复事件在装配时吞并)。
- **工作台「上一轮」改为真实轮次摘要**:previousConclusion/earlierConclusions 从事件白名单改为按
  ReviewInstance 逐轮汇总(lateral 取末事件为结论词)——被 reroute 结束的第 4 轮不再从摘要里蒸发,
  「更早轮次」一轮一行不跳号;上一轮卡片新增 rerouted(「上一轮因审核流程调整结束,未形成结论」,
  不穿判词章)与 approved 标题变体。
- **流程迁移决策升级**(ImpactDialog):切换范围三选(保留原流程/仅等待审核人/全部)之下新增
  落点选择——「从各自当前环节继续」或「从所在路线首环节完整重审」(effects.review.landing
  route-start,服务端 enterableFrom(route,0),复核中的申报重走复核而非普通链);当前环节已删的
  申报单独二选(保留原流程/按新流程重审,原来前端写死 refuse 使「全部切换」名不符实);影响
  报告新增 **pastChanged**(当前环节之前的环节序列按 id 对比发生变化的条数,前端明示「新增或
  调序到当前环节之前的步骤不会执行」)。「按旧轮已审环节自动推导新链完成度」按裁决明确不做:
  修改流程绝不能凭旧事件产生审核决定。
- **展示细节**:历史/审核记录时间精确到秒(跨年附年份;队列保留粗粒度日感知时钟);申报版本的
  附件不再堆底部——FiledFields 按冻结表单字段顺序逐字段展示,附件字段的文件挂在自己的字段名下,
  无字段认领的文件收尾兜底。
- **测试**:review-flow reroute 例增断言(rerouted 事件仅旧轮一条、previous.kind='rerouted' 不
  跳轮、pastChanged=0),新增 route-start 重审例(两环节调序 → pastChanged=1、新轮落 n2);
  entry-workflow 新增轮次分组回归例(同秒 tie 断 data-round-no 顺序 ['2','1']、新轮 transition
  开启标记、旧轮首尾 ended/started 标记);fixtures 补 origin/supersedes 字段。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 98 files / 691 passed / 17 skipped;
`pnpm test:browser` 11 files / 85 passed;prettier 全绿。

### 时间线文案定稿与 CI 修复(2026-08-21 追加)

- 用户逐条定稿轮次时间线文案:版本节点区分「创建/更新申报内容,生成第 N 版」(第 N 版是结果不是
  修改对象)、提交事件「你提交第 N 版申报进行审核」(消除「提交」的存草稿歧义并指明版本,工作台
  完整经过里的 submitted 行同样带版本号);生命周期标记改为带轮次号的「进入第 N 轮审核/第 N 轮
  审核完成」(「本轮」会误读为当前轮);reroute 三句、补充材料四句照用户原文更新;进行中/已结束
  Badge 分色(emerald 描边 vs secondary)。en 目录同步,localization 文案套件断言更新。
- **CI drop-guard 修复**:昨日的 20260820095421_drop-reject-policy.sql 缺 `-- destructive:
approved` 标记,全史扫描在 CI 红了。补上标记(注释行,不动语句;这正是「已批准的 destructive
  迁移永远带标记,全扫恒干净」约定的机制),本地 `qualy database drop-guard` 37 文件全绿。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 691 passed;`pnpm test:browser` 85 passed;
`qualy database drop-guard` 全史 37 文件通过;prettier 全绿。

### CI 死锁修复:实例行锁挪到批次锁之后(2026-08-21 追加)

void-races 在 CI 上偶发红:decideReview 里为合议加的 `lockReviewInstance` 拿锁顺序是
「实例行 → 批次」,而 void/重构/撤回路径是「批次 → 实例行 UPDATE」——ABBA 死锁,PG 杀掉
一边后 voidItem 静默回滚,断言 `item.status = voided` 读到 active。修复:实例行锁挪到
`lockBatch` 之后(与全部写路径同序,合议投票的串行化不受影响,注释记下教训)。
void-races 连跑三次全绿;`pnpm typecheck` 零错;`pnpm test` 98 files / 691 passed;prettier 全绿。

### 更早轮次行窄列溢出修复(2026-08-21 追加)

审核流程栏的「更早轮次」行在窄列上把退回原因挤到零宽、带秒时钟溢出卡片外:行是
`[轮次 chip][原因 flex-1 truncate][时钟 shrink-0]` 的单行 flex,两端 shrink-0 之和超过列宽时
truncate 只吃中间。改为 flex-wrap:原因保底 `basis-36` 并带 title 全文,放不下时时钟
`ml-auto` 落到自己一行——按列宽自适应,不吃原因也不出卡。浏览器回归例(1024 三栏最窄列):
每行 scrollWidth ≤ clientWidth、原因宽度 > 60px、卡片自身无横向溢出;红验证过
(还原单行布局该例即红,原因被压到 45px)。`pnpm test:browser` 11 files / 86 passed;
`pnpm typecheck` 零错;prettier 全绿。

### 提请复核模态框的流程预览补环节名(2026-08-21 追加)

「提请复核」模态框的转入后流程卡此前只显示单位名(stage.nodeName),现改为环节名称优先、
单位名兜底,与链视图同规则;卡片小字「仅提供意见」是裁决链改版前的旧语义,更正为
「可通过认定，或转交下一环节」(复核中间环节可径直通过)。`pnpm typecheck` 零错;
`pnpm test:browser` 86 passed;prettier 全绿。

### 我的申报页展示审核链条;effect-shell CI 抖动修复(2026-08-21 追加)

- **我的申报页与填报弹窗展示审核链条**(按用户裁决只给链条与环节名,不给组织层级/角色):
  standing.ts 新增 `chainNamesOf`(客户端安全解析新旧两种 policy 形态,label 缺省回退
  「第 N 个审核环节」);题目卡条款盒新增「常规审核 A → B」「复核 C → D」两行;填报弹窗的
  「审核流程」块由匿名的「第 N 个审核环节」改为真实环节名并补复核一行——旧 `chainLength`
  只识别 legacy `{stages}` 形态,对现行双路线策略一直静默返回 0,该块此前实际从不渲染,
  顺带删除孤儿键 head-steps。浏览器新增题目卡链条例(命名环节 join、未命名回退编号、
  不出现层级/角色字样)。
- **effect-shell CI 抖动**:两处根因防御。①测试内 fetch 换 node:http 单连接探针
  (`agent: false`,响应即断)——undici keep-alive 的存活 socket 会让「已关闭」的端口再答
  一次 200 或拖住 server close,正是 CI 上第二例读到 200 的机理;②testkit 落库 drop 前对
  「being accessed by other users」做 10×50ms 重试——连接数已回落到基线后,后端进程离开
  pg_stat_activity 仍有毫秒级尾巴,这是竞态不是泄漏;真正被占用的库会耗尽重试照常报错,
  force 兜底与 AggregateError 语义不变。effect-shell 连跑五次全绿。

**门禁(实际执行)**:`pnpm typecheck` 零错;`pnpm test` 98 files / 691 passed / 17 skipped;
`pnpm test:browser` 11 files / 87 passed(题目卡链条 1 例新增);prettier 全绿。

### shell 套件 CI 抖动:合成 Escape 换真实按键(2026-08-21 追加)

「seats the person at the drawer head」在 CI 偶发找不到「导航」键:合成
`document.body.dispatchEvent(KeyboardEvent)` 关抽屉,退场动画在负载下被打断时 radix 的
aria-hidden 滞留在页面上,role 查询看不见导航栏。改为 `userEvent.keyboard('{Escape}')`
真实按键路径,并在重开前 poll 到 dialog 真正离场。本地连跑三次全绿;
`pnpm test:browser` 11 files / 87 passed。

### shell 抽屉重开等到导航键回到无障碍树(2026-08-21 追加)

上一笔改真实按键后 CI 仍偶发红:dialog 已离场,但 radix 解除页面 aria-hidden 在被动
effect 里,负载高时晚于卸载,`expect.element` 的默认 1s 等不到「导航」。改为 poll 到
按钮真正出现在无障碍树里(两处均放宽到 10s)。本地连跑三次全绿。

### 填报的提交键改为「保存并提交审核」(2026-08-21 追加)

新建/修改申报的模态框里那一按本就同时写下与交出,按钮据此改名;弹出的确认框给三个答案
——取消 / 仅保存 / 保存并提交,「只想留着」不必先取消再回表单找另一个键。抽屉里那条
纯提交路径(不改内容)仍是「提交审核」。`ConfirmDialog`(@qualy/ui/admin)因此多一个
可选的第三键(`otherLabel`/`onOther`,testid `confirm-other`),标签同样进「话比答案活得久」
的记忆。entry-workflow 加两例:仅保存只落 createEntry、保存并提交两个调用都落;
红验证通过(改掉 testid 即失败)。

### 复核链条预览只报环节名(2026-08-21 追加)

「转入复核后的流程」的每格不再写「给出最终结论 / 可通过认定，或转交下一环节」:逐级
裁决链里任一环节都可终局,把「最终」挂在末位是错的描述。只留序号与环节名,两条文案
descriptor 与 zh 条目一并删除。

### 复核提示定为琥珀轻量卡片(2026-08-21 追加)

环境光效各版(顶边横条、头部下方投射、整视口辉光、镭射环边、蓝色边规)全部撤下,连蓝色
本身一起——主题是纯灰阶(`--primary: oklch(0.205 0 0)`),审核台只有 emerald/rose 两个
判定色,第三种色相在这块屏上永远像从别的产品贴过来的。「已进入复核流程」卡片位置不变
(「审核流程」标题之下、上一轮结论卡片之上),改为 `bg-foreground` / `text-background`
反白面板,但一大块黑在白页上同样难看且不显眼。**最终定色:琥珀**——审核台已说话的两个
颜色是判定(emerald 通过、rose 退回),复核既非通过也非退回,是「请更仔细地读」,琥珀在
灰阶界面上是暖的、不刺眼,也不与判定色抢语义。形式是浅色底 + 发丝边框的轻量卡片
(amber-50/70 底、amber-200 边、amber-950 标题),不是实心块;头部「复核」徽章同色系
(amber-50 底 + amber-300 边),两处一眼可辨是同一件事。不闪不动,暗色模式各自换档。
申报页「填报要求已更新」提示同样从黑块改为这套琥珀语汇——同一件事(停下来读)在产品里
只用一种说法。卡片与徽章各带一枚 `CircleArrowUp`:申报是被「上提」到复核的,一个字形
在两处说同一件事。

### 本轮验收(2026-08-21)

`pnpm typecheck` 零错;`pnpm test` 98 files / 691 passed | 17 skipped;
`pnpm test:browser` 11 files / 89 passed;`npx prettier --check .` 全绿。

### 填报的两道早拒(2026-08-21)

领域裁决见 docs/assessment-design.md §32.67。两条工作线,分两笔提交。

**文件大小在选中即拒**:`EvidenceFieldSpec` 补 `maxFileBytes`(数据本就在 formConfig 里,只是类型漏声明);
`Dropzone` 增 `maxSize` 与结构化 `onRejected`(reason `too-large|type|too-many`,只给 File 与理由码,
primitive 仍零文案);`take()` 在 prepare 之前复核大小与剩余名额,并把原先 `files.slice(0, room)` 的
静默截断改为逐个点名「未添加」;上传区提前写明支持格式(mime 归一为扩展名)、单文件上限与剩余数量。
服务端 bind 校验与 field-agnostic 的 prepare 原样不动。

**题目版本乐观并发**:新错误 `ASSESSMENT_ITEM_REVISION_CONFLICT`(409,携 itemId/currentRevisionId);
createEntry / reviseEntry / setEntryStatus 各加可选 `expectedItemRevisionId`,服务端在 decode payload
**之前**比较(顺序决定了报的是「要求变了」而不是「新字段未填」);EntryDialog 对题目做快照,冲突时
不关闭、不清空、不刷新,就地给出提示并禁用两个保存键,按下「查看最新要求」才推进快照并按 field
identity 迁移答案;抽屉提交与代录页同样携带令牌。

验收(逐条真实执行):`pnpm typecheck` 零错;`pnpm test` 98 files / 692 passed | 17 skipped;
`pnpm test:browser` 11 files / 91 passed(连跑三次稳定);`npx prettier --check .` 全绿。
新增三例均做红验证:去掉 take() 的大小检查、把表单字段改回读 props、把服务端比较短路,对应用例分别转红。

### 实时失效通道(2026-08-21)

领域裁决见 docs/assessment-design.md §32.68。三层四笔:

**传输(plugin-database)**:`pgNotify(channel, payload)` 骑当前事务连接(COMMIT 才投递、
ROLLBACK 即丢弃);`DatabaseNotifications.listen(channel)` 每进程一条专用 pg 会话连接,
Stream 化,死亡即失败交由消费者重试。testkit 的 `databaseFor` 同步供出该服务。

**总线与 SSE(plugin-assessment)**:`live/events.ts` 定内部事件(tenant/batch/kind/subject),
`announce` 布进 entry/review/item 三个 service 的全部写入点(均在既有事务内);
`AssessmentLive` 一条 LISTEN → sliding PubSub 扇出,监听 fiber 走 Assembled hook + 3s 重连;
`GET /assessment/batches/{batchId}/events` 用 `HttpApiSchema.StreamSse`(证据:
repos/effect/packages/effect/src/unstable/httpapi/HttpApiSchema.ts:397-431、HttpApiBuilder.ts:921-1019、
HttpApiClient.ts:71-82、Stream.ts:512/1166/2833/2900、PubSub.ts:427、ai-docs 07_pubsub 与
05_resources/20_layer-side-effects),连接期 `assertVisible`+`capabilitiesFor` 过滤,
公开事件只有裸 kind;frozen-routes 补一行;生产 smoke 增 401 探测。

**浏览器(web-runtime + assessment client)**:`useApiStream`(runtime 内运行、AbortSignal 中断、
3s 重拨、`live` 降级信号);`useBatchLive` 按 kind 定向 invalidate;收件箱/工作台连上时放宽轮询、
断线回落;工作台新增「任务已易手」就地态(保留工作台与已写内容、撤销 pending 决定、
琥珀横幅给两条出路);我的申报接线 entries/item/result 唤醒并加手动刷新键。

验收(逐条真实执行):`pnpm typecheck` 零错;`pnpm test` 99 files / 693 passed | 17 skipped
(新增 live.test:提交投递 + 回滚静默 + subject 路由,真库实测);`pnpm test:browser`
11 files / 93 passed(失效态用例经 gate 控制时序,红验证通过——短路 gone 判定即转红);
`npx prettier --check .` 全绿。

### 撤回/放弃重裁与工作台失效语义(2026-08-21)

领域裁决见 docs/assessment-design.md §32.69(并注销 §32.65 三条旧句)。要点:withdraw 止于
审核真正开始(承接谱系上的判定事件或任一 panel 票,`withdrawStandingsOf` 递归 CTE 单源判定,
capability 与写入同源);申诉轮一律不可 withdraw(堵住经申诉轮把 approved 洗成 draft 的 P0
漏洞);abandon 全生命周期开放(in_review 先关轮,approved 绝不回改审核轮),成为第七个
participant action code 并纳入阶段门控(不进 RBAC 目录);工作台 gone→lostTurn(管理员路径
此前静默刷成「已结束」),sonner 按可知原因说话 + pending 决定 undo + may()/stage 拦截 +
「继续审核下一条/结束审核」由人按;`expectedItemRevisionId` 收窄到 submit;一键声明补 token;
详情 live 时保留 60s 轮询(SSE 在线不证明 LISTEN 在线);申报页按 live 降级;EntryDialog 收到
新 revision 立即 stale;历史补材料只由问答卡讲一遍;「审核完成」改「审核结束」。

验收(逐条真实执行):`pnpm typecheck` 零错;`pnpm test` 100 files / 697 passed | 17 skipped
(新增 entry-lifecycle-boundaries 四例:审核开始后 withdraw 拒/abandon 关轮、申诉轮不可撤、
approved 放弃且 round 结论原样、阶段门关 abandon;withdraw 拒绝路径红验证通过;review-workbench
旧撤回故事按新裁决重写);`pnpm test:browser` 11 files / 93 passed(lostTurn 横幅、复选框 13、
文案断言同步);`npx prettier --check .` 全绿。

### 人员权限同步提示的按钮对齐(2026-08-21 追加)

「查看变更」按钮与单行提示未对齐:`AlertAction` 原语锚在 `top-2.5`(适合带正文的
alert),对只有一行字的通知,h-8 按钮中心比文字线低约 4px。就地覆写为
`top-1/2 -translate-y-1/2` 垂直居中,原语不动(其他 alert 仍要顶部锚定)。
identity + batch-admin 42 例全绿;`pnpm typecheck` 零错;prettier 全绿。

### 补件归属与只读查看(2026-08-21 追加)

领域裁决见 docs/assessment-design.md §32.70。同级审核员此前被当成同事补件的共同持有人:
等待列表看得到、审核页开得进、还能一键撤销别人的补件请求(`cancelSupplement` 只验
requireJudge,不验 requestedBy)。现拆成三个概念:stage membership / ask ownership /
admin visibility。open 补件只进发起人的等待列表;`mayRead` 在 awaiting 态只认发起人
(同事 refetch 转 NOT_FOUND,lostTurn 机制自然接住);`cancelSupplement` 先验
`requestedBy`(`not-requester`)再验 requireJudge;答复后回到全池(既有行为)。管理员
URL 直读是预期设计保留,工作台对无操作读者加一行只读说明。SSE 事件流结束的访问日志
降为 Debug(时长是连接寿命不是延迟),CLAUDE.md 日志节同步。

验收:`pnpm typecheck` 零错;`pnpm test` 100 files / 698 passed(review-workbench 新增
「open ask 归发起人」全景用例:双审核员共享池、等待期独占、同事读取/撤销双拒、管理员
只读、答复回池;撤销归属校验红验证通过);`pnpm test:browser` 93 passed;prettier 全绿。

### 审核队列移动端筛选行(2026-08-21 追加)

手机上「按题目/按时间/按人/等待补充材料」四个 tab、两个下拉筛选、搜索框、三个统计数字
全部叠成一面控件墙。按用户裁定只改筛选行、banner 与列表不动:移动端 = 全宽四段式分栏
(「待补」短标签 + 计数)+ 一枚搜索键(点开才出现全宽输入框,带着已输入的搜索进页则
默认展开);两个下拉是桌面工具,移动端隐藏;统计数字在移动端折成分栏下的一行小字
(PC 有移动端没有会读成两套账)。桌面端经 `hidden md:contents` 逐像素保留原布局。
待补列表的行在窄屏原是六个格子直落一列的乱堆,重排为「姓名+状态 / 事项 / 耗时·时刻·入口」
三行,桌面 grid 靠 `lg:contents` 包装层解散 + `lg:col-start` 钉回原列;
「撤回补充请求后…仍会保留…」的脚注按用户要求删除(键一并清理)。浏览器套件 93 例全绿;`pnpm test` 698 passed;`pnpm typecheck` 零错;
prettier 全绿。

### shell 抽屉重开第三层(2026-08-21 追加)

CI 再现:dialog 已离场,但「导航」键 10 秒都没回到可访问树——负载下 radix 摘除
aria-hidden 的清理偶发彻底丢失,不是延迟。不再与这个退场动画竞态缠斗:重开定位改用
`includeHidden`(点击本就不受 aria-hidden 影响),行为断言原样保留(按下→抽屉打开→
人名在内→session 只问一次)。本地连跑三次全绿。

### SSE 访问日志降级真正生效(2026-08-21 追加)

上一笔的判定从未命中:`text/event-stream` 不在 `response.headers` 里,而是随
`Body.stream(body, contentType)` 挂在 **response.body.contentType** 上,上游写线时才并进
wire headers(repos/effect/packages/effect/src/unstable/http/HttpServerResponse.ts:447-465、
HttpBody.ts:61-69,实读)。access-log 改为先读 body.contentType、再回退 headers;
事件流的 200 自此按设计落 Debug。`pnpm typecheck` 零错;prettier 全绿。

### SSE 日志失败分支与 shell 胶囊诊断(2026-08-21 追加)

用户仍见 `GET /events 200` 落 Info:实测 `HttpServerResponse.stream` 把 content-type 同时
写进 headers 与 body,故成功分支的检测其实有效——漏的是**失败分支**:浏览器在写入中途
挂断时,exit 是携带 200 响应的非中断失败,走 `Effect.logInfo(line(status))`。现两分支共用
`isEventStream`(body.contentType 优先、headers 回退),事件流的中断/挂断/自然结束一律
Debug。

shell 抽屉第四轮:`includeHidden` 也找不到「导航」,推翻 aria-hidden 残留论——按钮根本不在
可匹配状态。胶囊的三个渲染前提(`narrow`/`drawer.open`/`footTaken`)现作为 data 事实挂在
foot 容器上,测试把四元组整体断言;下次 CI 失败会直接报出哪个变量说谎,不再盲猜。本地
三连全绿。

### 移动端审核工作台改为横向三面 pager(2026-08-21)

领域裁决见 docs/assessment-design.md §32.71。lg 以下三列变 scroll-snap 分页(默认停在
申报内容),Pane 一律自持 ScrollArea;PartStrip 改 pager 驱动(横向 spy + chip 翻页 +
attention 事实点),初始定位收进 strip 自己的 effect(首拍竞态实测踩过:spy 先跑会把
flow 记成已读);复核/申诉卡在手机提升到 pager 之外;申报面顶部两三行情境摘要条直达
审核过程;决策弹窗两张脸(FormDialog/DecisionSheet)接 caution 软守卫,「查看」直达并
消点;决策栏手机 2×2(上行 h-9、下行 h-11,四键等宽)。part 定名:审核过程/评审依据。

验收:`pnpm typecheck` 零错;`pnpm test` 698 passed;`pnpm test:browser` 11 files /
94 passed——重写两例旧布局断言(分页语义、2×2 等宽与行高差),新增「lifts the
escalation over the pager…」全景用例:提升卡可见、摘要条可见、flow 面事实点、通过弹窗
两行守卫、两次「查看」逐面消点、第三次弹窗干净;prettier 全绿。

### 参评人注意力模型与概览页(2026-08-21)

领域裁决见 docs/assessment-design.md §32.72。状态/待处理/未读三分:左栏彩色状态点废除,
红点只表未读(题级聚合、看过即灭、并发变更后必回);Entry 增 attention/seen revision 对
(迁移 20260821094426_entry-attention.sql,存量初始化已读);bump 白名单与业务写同事务
(补件请求/撤销、终局通过/驳回、要求修改,含 propagate);`PUT my-entry-reads/:itemId`
幂等标读(免阶段门、不发 SSE);listMyEntries 携 attention.unreadItemIds(刻意不进
EntryView);行状态聚合补 supplement/rejected/partial/approved,todo 剔除「可申报」;
概览页落「需要你处理」(supplement/revision 行动卡,深链 open+detail/entry)与「最近动态」
(13 词公共词表、终局取自 instance 完成态、补件只走结构化记录、(at,source,id) keyset、
查看更多就地翻页),SSE 失效接线,管理员自然隐去。

验收:`pnpm typecheck` 零错;`pnpm test` 101 files / 701 passed(attention 三例:终局才响/
看过即灭/幂等、标读与撤销竞争后点回来、summary+activity 语义与排序);`pnpm test:browser`
11 files / 96 passed(未读点生命周期红验证——短路 unread 即红;概览行动卡深链落位);
prettier 全绿。测试顺带抓出三只真虫:PG `+00` 裸时区偏移 Date 拒解(生产同炸,已归一)、
entry_events 无 comment 列、补件表列名 cancelled_at。

### 状态点回归,按新语义配色(2026-08-21 追加)

用户裁定圆点保留而非移除:每题常驻一点,颜色只译新状态词——amber 等读者(待补充/待修改)、
中性灰自己的状态与等他人、emerald/rose 判定色、空心无主张;未读红点仍凌驾一切,看过即
让位于状态色。§32.72 一款同步修订。entry-workflow + paper-reading 27 例全绿;typecheck 零错。

### 审核页两笔小修(2026-08-21)

判定键带上字形:通过 CheckIcon、退回 CornerUpLeftIcon(ActionKey 新增 icon 槽,随键色同墨),
与第一行路由键(提请复核/要求补充材料,保持纯文字)在色块之外再多一层区分。评审依据面移除
max-lg 灰底——那是纵向堆叠时代的页尾洗灰,翻页化后它是独立一页,整页保持白底,桌面端仍以
左边框分列。typecheck 零错;review-layout 11 例、entry-workflow 21 例全绿;prettier 全通过。

### 审核页评审依据栏三件套 + 抽屉测试定位修正(2026-08-21)

智能辅助审核挪到 Pane 新增的 footer 槽位:钉在申报内容栏的物理底边(滚动区之外),
内容短不再上浮、内容长不再靠 sticky;样式重排为 muted 洗底 + Sparkles 靛蓝角标 + 标题/
免责一行。删除「材料按字段分组展示…」提示句(en/zh 键一并移除);全部下载改为逐字段:
按钮在文件字段名行右端,只下载该字段引用的文件,经隐藏 anchor + download 属性触发保存。
服务端 getAttachmentContent 改为直接返回 HttpServerResponse.stream(读过 repos/effect/
packages/effect/src/unstable/httpapi/HttpApiEndpoint.ts:566-573 handler 可返回自定义响应、
HttpApiBuilder.ts:801-803 原样放行、unstable/http/HttpServerResponse.ts:68-75 Options),
带 content-type=declaredMime、content-length、content-disposition: inline + RFC5987
filename*,下载名从「content」变回真实文件名,点击预览不受影响。
CI 抽屉 flake 定案:诊断四元组证明三条件全真而 includeHidden 仍找不到胶囊——radix 残留
的 aria-hidden 使 name-from-content 归零,role+name 永不匹配;重开定位改 data-testid=
"nav-capsule"(首开仍走 role+name)。
门禁:typecheck 零错;pnpm test 701 passed | 17 skipped;pnpm test:browser 96 passed;
prettier 全通过。

### 概览成为批次用户桌面,API 收进 /me(2026-08-21/22,§32.73)

五条路径改名(me/entries、me/result、me/overview、me/activity、me/items/{itemId}/read,
frozen-routes 同笔);/me/overview 返回 participant/reviewer 双分支(无身份为 null,审核老师
不再打出 ParticipantNotFound 404);/me/activity 以 batch user 为主体做双视角 UNION:参评人
故事 + 审核员亲自行为 + 我发起的补件被回复(supplement-answered),词表增 review-stage-approved
与 review-opinion-rejected(环节通过与终局通过文案分开),行带 perspective 与 instanceId,
支持 perspective 过滤(游标含过滤指纹);对象是自己申报时审核行不生成,一事不两说。
withdraw 补写 entry_events 'withdrawn-by-submitter',活动流不再解读 cancelled-by-submitter
——「审核中放弃」双条(撤回+放弃)已修,红验:恢复旧映射时 boundaries 两例转红。desk 端点
时间一律 to_char UTC ISO,前端删 PG 文本修补。审核队列计数 reviewerDeskCountsOf 复用
mayActOn 谓词。概览页:测评进程保留原三件套(用户否决横向带);需要你处理跨身份并列
(琥珀卡 + 待审核 N/补件已回复 N 两行,直达审核页对应视图),空时一行轻提示;最近动态改
纵向时间线(按日分组、时刻列、空心=自己实心=外部、终局轻语义色、reason/comment 副行、
lane 筛选仅双身份显示),useInfiniteQuery 修复手写游标末页复现 bug,SSE 失效整组重读;
页面无「·」。§30 增第 9 条:attention 跨事务竞态的严格保证待产品裁决,注释按实措辞。
修复途中两次事故:reviewer 支为首支时列名未别名(id 撞名,用户日志抓到,加 reviewer 单
车道断言防回归);zh-CN 目录被贪婪正则误删 302 行,已从 HEAD 精确重建(11 孤儿键 + 2 死键
之外逐行恢复,catalogs 门禁复绿)。另修:复核卡守卫单点化——列内渲染点丢了
route==='escalation' 条件,普通路线活跃轮也挂出「该申报已进入复核流程」。
门禁:typecheck 零错;pnpm test 703 passed | 17 skipped;pnpm test:browser 96 passed;
tools/tests 147 passed;prettier 全通过。

### 退回卡补上审核人的修改建议(2026-08-22)

decideReview 的 suggestedPayload 此前只进审核事件,从未到参评人手里。latestRefusalOf 增列
suggested_payload(entry_events 支为 null),EntryRefusalView/契约 refusal 结构/客户端 EntryDto
同步;详情 Sheet 退回卡内新增「审核人的修改建议」块——只列与现值不同的非附件字段,值为空显
「—」,仅供参评人手动照改,不提供一键套用(工程宪法禁令)。node 新用例断言建议逐字到达
owner 视图;boundaries 13 例、catalogs、entry-workflow 21 例全绿,typecheck 零错,prettier 通过。

### 概览页按设计稿 2a/2b 改造(2026-08-22)

经 claude_design MCP 读取设计稿(批次概览.dc.html §2a/§2b),按用户裁定落地:页内撤下阶段上下文
条(当前阶段与倒计时归顶栏,PhaseContextBar 组件保留备用),正文直接从「需要你处理」开始;事项
行整行可点、按申报/审核分组(组标签仅双身份显示),行内动词是同一入口的键盘把手;待审核行带
计分分组明细、已回复行带人名题名(reviewer 分支扩展 queueGroups/answeredAsks,pendingCount 由
分组和派生);动态一条三行(题名/句子/引栏),按日分组、桌面左列时刻、无点轨,未读题目的最新
一行戴红点(participant 分支改为 unreadItemIds,沿用版本对判定);移动端「阶段进度」标签 +
原 BatchFlowStrip 置顶,动态标题行粘顶携带筛选。设计稿文案按项目风格简化,字号收敛到项目字
阶,shadcn Tabs 不改内样式,左右两栏 gap-12,两区以边距分隔,空状态小卡去背景防暗色误读。
门禁:typecheck 零错;pnpm test 704 passed | 17 skipped;pnpm test:browser 96 passed;prettier 全通过。

### 概览随手修与加载态成形(2026-08-22 追加)

概览:三区标题统一 text-sm semibold;移动端顺序改为 需要你处理 → 阶段进度 → 最近动态,
组间距收拢再在前两者间补一口气;两栏 gap-12;空状态卡去灰底;阶段进度列先去掉
max-h+overflow 的内滚动条,又因真实六阶段列高过视口而放弃 sticky,随页自然滚动。
加载态:我的申报骨架改为「问题行轨 + 桌面纸面」的页面同形(移动端只铺轨),审核队列骨架
改为「控制行 + 五条工作行」,不再是两块/一块匿名大圆角。typecheck 零错;entry-workflow、
review-layout、paper-reading、batch-admin 相关套件全绿。

### 自动计入题目归位、骨架成形、抽屉胶囊常驻(2026-08-23)

「我的申报」左轨:itemType constant 从 recorded 灰名单拆出为 granted——不再灰名、状态词
「自动计入」点亮、分数在评分器未说话前先用条目自身面值(eachWorth);recorded(工作人员登记)
的状态词同步解除压制。加载骨架照真实页面同形重做:工具栏行(桌面单行/移动两行)、左轨
(筛选位 + 分组方点与题目圆点的缩进树)、纸面(展示卡 + 两个题目块),移动端只铺纸面(结构
在抽屉里)。CI 抽屉胶囊第五轮定案:getByTestId 也数到 0,证明元素真不在 DOM——AnimatePresence
在「退出动画被 CI 饿死时同 key 再进场」的时序下丢弃了重新进场的孩子;胶囊改为常驻 DOM、
CSS 过渡显隐、隐藏时 inert,包装层以 data-shown 陈述可见性,测试改断该状态。
门禁:typecheck 零错;pnpm test:browser 96 passed;catalogs 7 passed;prettier 全通过。

### 批次列表:筛选片计数与移动端收纳(2026-08-23)

listBatches 响应新增 statusCounts(同可见域、同搜索词、不吃状态筛选的分组计数,
countBatchesByStatus 复用 batchFilters 与 visibleTo),筛选片(全部/进行中/草稿/已结束)右侧
显示各自数量,全部为三态之和,服务端未答前不显数字。移动端收纳:新建批次回到标题行右侧
不再独占一行,区块间距收一档,筛选组单行保持、过宽时横向滑动。typecheck 零错;
pnpm test 704 passed;batch-admin/entry-workflow 50 例全绿;prettier 通过。

### 申报摘要统一、动态之门服务端裁定、投票入流、全部测评(2026-08-23,§32.74)

统一投影 projectEntrySummary(纯模块,前后端同源):配置 entrySummary.fieldIds(≤3 有序非附件,
校验四条)或回退前 3 个非附件非空字段;消费于纸面 lead/sub(副识别移动端保留)、审核 values
(附件不再占位)、概览动态 identity 行(按 entryId 批量投影);条目编辑器新增申报摘要选择器
(选择+上移+移除,shadcn 原样)。/me/activity 行 instanceId 改为「此刻仍可开才下发」(mayActOn
同谓词进 SQL),参评行不再带门,前端只给有门的行指针——修历史审核行点入 404。合议投票以
review-vote-approved/rejected 入流(pn-unanimous 断言:一票记一条、说投票不说终局、完轮无门)。
顶栏「返回批次列表」改「全部测评」,移动端撤快捷入口(切换器菜单同门仍在)。
红验痕:attention 既有断言 settled.instanceId 由 not.toBeNull 翻转为 toBeNull。
门禁:typecheck 零错;pnpm test 708 passed | 17 skipped(新增 entry-summary 4 例);
pnpm test:browser 96 passed;prettier 全通过。

### 申报摘要选择器搬家并支持拖拽(2026-08-23 追加)

摘要配置块从基础信息区搬进「填报字段」区(列表之后,细线分隔)——先有字段才有摘要可选;
选择器按 FieldTable 同一拖拽习语重写:原生 draggable + qualy/summary-field 载荷 + 上下沿
高亮落点 + Grip 把手,行内序号、首行「主识别」小签、移除键,上移按钮退场;表单里被删除的
字段自动退出当选集。typecheck 零错;catalogs 7、batch-admin 29 全绿;prettier 通过。

### 申报摘要独立成节(2026-08-23,设计稿 7a)

经 claude_design MCP 读取题目配置设计稿 §7a:摘要从填报字段区末尾的无名控件抽出为**独立配置
节**,排在填报字段与计分之间,左标题右内容与其他节同形。内容按 7a 一比一:表头「已选字段,
拖动换顺序」+ 右侧 N/3 计数;已选行为带边框列表——把手、深底圆形序号、字段名、类型词、首行
「申报标题」标签、移除键,拖拽换序沿用字段表习语;一个未选时写明自动取法(按表单顺序取前几个
填了内容的文本或日期字段);其余字段改为一排虚线加号块(取代原下拉),选满时置灰不可点;末行
写明上限与文件字段不参与的原因。文案按项目风格重写,未动其他配置区逻辑。
typecheck 零错;catalogs 7、pnpm test:browser 96 全绿;prettier 通过。

### 影响面误报与拖拽鬼影(2026-08-22)

用户实测:只改申报摘要,保存却弹「如何处理现有申报」。实查库中当前 revision 与请求 payload
三段全等(canonical 比较),再往上追到 impact.ts 自带一份**裸 JSON.stringify** 的 sameJson——
jsonb 取回的键是重排过的,浏览器发来的是书写序,于是每次保存 form/review 都被判成「变了」,
只要有在审轮次就必弹对话框。改为与 service.ts 同款的键序无关 canonical 比较(数组顺序仍有
意义:阶段序与字段序就是配置);新增 tests/item-impact.test.ts 三例(键序等价判同、真改动仍
判变、字段互换仍判变),红验:换回裸 stringify 第一例转红。
拖拽鬼影:题目编辑器挂在 Drill 动画容器内(带 transform),Chrome 从被变换的图层取快照,
表现为「拖着整个视口」。摘要行与填报字段行统一改为自建鬼影——克隆该行挂到 document.body
(脱离被变换的祖先)作为 drag image,下一帧移除;摘要行另加把手起拖(draggable 由按下把手
控制),行内文字不再意外起拖。摘要区上限文案改用 {most} 占位,不再写死 3。
门禁:typecheck 零错;pnpm test 711 passed | 17 skipped;pnpm test:browser 96 passed;
catalogs 7;prettier 全通过。

### MikroORM 7.1.13:最后一处 patch 离场(2026-08-22)

上游合入了本仓库报的第 5、6 两条(前四条已在 7.1.11 合入),按 CLAUDE.md 的升级流程走了一遍。

先扒 7.1.13 的发布产物逐处核对,不看 changelog:第 5 条(check 去 cast 时 `\((.*?)\)::\w+`
跨括号、把表达式改成语法错误)上游采纳了草稿里给的写法,与我们的 patch **逐字符相同**;
第 6 条(索引丢访问方法,gist 被重建成 btree)上游走了草稿给的**两个选项中较大的那个**,
比我们的 patch 更正:`pg_am.amname` 进 introspection 查询 → 落在 `IndexDef.type` →
经 `getIndexAccessMethodClause()` 发 `using gist`。我们的 patch 当初取的是便宜路子——把整条
`CREATE INDEX` 塞进 `expression`,代价是该索引从此无法结构化 diff(列与 partial where 一并
失去可比性);上游这版两者兼得。

因此 patch 整个删除,`patchedDependencies` 清空,`patches/` 目录不再存在。

守卫测试改了断言的**对象**:原来断言 `IndexDef.expression` 里含 `using gist`,那是我们那版
patch 的形状,上游换实现后即便修好也会红。改为断言 `getCreateIndexSQL()` 写回去的 DDL——
「读回来的索引能不能被重新建成它自己」才是缺陷本身,这个断言跨两种实现都成立。红验:临时把
断言改成 `toBe('SHOW ME')`,拿到实际值
`create index "idx_introspection_probe_path_gist" on "introspection_probe" using gist ("path")`。

**kysely 随之从 0.29.4 抬到 0.29.5**:7.1.13 依赖的是精确版本,不跟就并存两份实例,typecheck
当场报 `Kysely<any>` 互不可赋值(`#private` 指向不同成员)——正是 catalog 制度要防的版本分裂。

`repos/` 经 `vendor-sync update mikro-orm` 同步到 tag v7.1.13(commit c22d31cc),
未触碰 effect 树;`vendor:check` 报两棵树均与 lock 一致。

验收:typecheck 零错;`pnpm test` 711 passed | 17 skipped(与升级前一致);
`pnpm test:browser` 96 passed;prettier 通过;`pnpm qualy generate` 报 **database: nothing to
generate**(这条最关键——7.1.13 的 introspection 新增了 include/fillFactor/排序选项/type 等
字段,任何一个渗进 diff 都会凭空产出漂移迁移,实测全部实体、check 与 gist 索引完整往返);
生产 smoke 探针、壳、manifest、哈希资源、SIGTERM 退出 0 全过。

### 对抗审查两轮:27 条主张,26 条存活(2026-08-22)

距上一次成体系的多 agent 对抗审查(f5a2ef27,2026-08-08)已 357 个提交,综测域整体、storage
基座、rbac 重裁、实时通道、/me 桌面几乎全是新代码,2026-08-19 之后那批从未被系统审过。
两轮工作流各 5 个敌意视角,每条主张交由两名独立反驳者(机制反驳 + 可达性/先例反驳)交叉验证,
双票不反驳记确证。共 64 个 agent、2397 次工具调用。

第一轮(服务端与领域核心)13 条全部存活:9 确证 4 存疑。第二轮(平台面与门禁)14 条存活 13、
反驳 1(「访问日志对客户端中断分支不可达」被证伪)。反驳率之低本身可疑,故最重的几条我逐条
对着源码复核过。

**本轮先修的一条(critical,安全)**:附件内容门 `GET /assessment/attachments/{id}/content`
回显上传方声明的 MIME + `Content-Disposition: inline`,全仓库无 nosniff 无 CSP,构成主站
origin 上的存储型 XSS——参评人上传名为 proof.pdf、declaredMime 为 text/html 的 HTML
(字段 accept 只按扩展名判,`entry/service.ts` acceptable()),审核员打开即以其会话同源执行。
这是 `a43492e0` 引入的回归,直接违反 assessment-design §19 的冻结裁决(「下载一律 attachment +
nosniff,不信任上传方 MIME」),而三处客户端注释至今仍在陈述旧契约。
修法按裁决原文:新增 `src/attachment/served-type.ts`,只回显惰性类型白名单
(jpeg/png/webp/gif/avif/pdf,**不含 svg**),其余一律 application/octet-stream;disposition
回到 attachment;补 `x-content-type-options: nosniff`。两道闸互相独立。客户端无需改动——
图片走 `<img>`(子资源加载忽略 disposition),文档预览本就自己 fetch 字节、自己给 blob 定类型。
顺带关掉了「declaredMime 含 CR/LF 使该附件永久不可下载」那条(白名单外不进 header)。
新增 tests/served-type.test.ts 四例(惰性类型原样、主动内容各种拼法一律拒、CRLF 拒、大小写与
空白按 HTTP 语义),红验:改成原样回显,后两例立刻转红。

验收:typecheck 零错;`pnpm test` 715 passed | 17 skipped;prettier 通过。

其余 24 条的处置见下一轮。

### 申诉只针对当前生效的结论(2026-08-22,用户裁决)

对抗审查提出「`appealReview` 不校验目标轮次是否当前结论」,用户裁决为**缺陷**,不接受
「允许申诉历史任一结论」的解释:Entry 对外暴露的 capability 本就只在
`status ∈ {approved, rejected} && currentReviewInstanceId !== null` 时给出 appeal,
UI 层的领域模型已经是「申诉当前这条 Entry 的当前结论」。历史负责解释「怎么走到现在」,
只有 current 指针决定「现在还能对什么做动作」。若真要救济历史裁决,那是另一个概念
(DecisionAppeal / CorrectionCase,带 reconciliation 规则),不是现有 appealReview 能表达的。

事故:Round 1 驳回 → 改材料 → Round 2 通过之后,`appealReview(Round 1)` 仍被接受
(Round 1 completed+rejected、当前无 open round),新 appeal 轮次还复用 `row.revisionId`
把**旧版材料**重新推上台,并 `setEntryState(from: [approved, rejected], to: in_review)`
把已由 Round 2 确立的 Entry 拖回复核——旧结论越过后来已生效的事实夺回控制权。

不变量按裁决落地:`entry.currentReviewInstanceId === instanceId`,并顺带校验
`entry.currentRevisionId === row.revisionId`(正常数据下前者蕴含后者,写路径仍显式校验,
因为申诉的语义就是「对当前这份材料当前生效的结论提出异议」)。独立错误码
**`decision-superseded`**,不并进 `nothing-to-appeal`——这是有用的并发/stale UI 错误,
前端可以说「该结论已不是当前结果,刷新后可查看最新进展」。

校验位置按裁决放在**批次锁之后的重读**上:整个 `instanceOf` + `entryOf` 移到 `lockBatch`
之后,pre-lock 只留定位读(取 batchId 与鉴权),注释写明锁前所读一律不可信。
排序上把 `hasOpenRound` 放在越权检查之前:已有轮次在飞是更能指导用户的说法,而且它正是
背后那条结论不再是当前结论的原因;既有断言 `review-already-open` 因此保持不变。

新增测试 `refuses an appeal against a conclusion the claim has outgrown`:
①驳回 → 改材料 → 通过 → 申诉第一轮 = `decision-superseded`;②驳回 → **原样重交**(§32.65)
→ 再驳回 → 申诉第一轮 = `decision-superseded`(两轮判的是同一版材料,SQL 断言 revision 相同,
所以是指针在判定而不是材料);③同一条当前结论**并发两次申诉**,恰好一次成功。
红验:去掉该校验,①②立刻转红。

验收:typecheck 零错;`pnpm test` 716 passed | 17 skipped;prettier 通过。

### 审核决定读锁后的真相(2026-08-22,对抗审查 critical)

`decideReview` 在取锁**之前**读 round 行,`mayAct` 用的就是那份快照,`lockBatch` 与
`lockReviewInstance` 都在其后,而且锁后从不重读——964 行那段注释白纸黑字写着「round 行在批次锁
之下取、绝不在其之前」,代码没做到。这是 `b553c5fe`(把实例锁挪到批次锁之后修 ABBA 死锁)的
遗留:锁挪走了,读还搁在顶上。`lockReviewInstance` 只返回布尔(新鲜行被丢弃),
`completeInstance` 又只 CAS `state='active'`、不比对 route/stage(`advanceReviewInstance` 是比对的)。

事故:同一环节两名评审 A、B 同时决定。A 通过 → 推进到第二环节 → 提交;B 拿着陈旧快照进来,
`here` 仍算作第一环节,`wordEnds(normal, reject)` 成立,`completeInstance` 只看 `state='active'`
就把整轮判成 rejected——A 的通过静默丢失,事件还盖着已经离开的那个环节的 route。合议分支更糟:
`openPanelOf` 只按 instance 取,陈旧投票会落进新环节的席位。

修法是结构性的一刀:锁前只留**定位读**(取 batchId,轮次永不改批次,过期无害),
`lockBatch` → `lockReviewInstance` 之后**重读实例并在其上重做授权**。`mayAct` 比的是
`current_node_id`/`current_role_ids`,重读后陈旧评审自然不在新环节的名单里,`here`、`policy`、
合议席位也全部变成提交后的真相。另加一条:`state === 'completed'` 直接 ReviewConflict——单评审
分支靠终局写的 CAS 自己会说话,合议分支否则会在已关闭的轮次上重新组一次席位并留下开着的合议。

新增测试 `answers a word against the step the round stands on when it is written`:两环节链
(第一环节两人 quorum any,第二环节换一个角色、同僚无站位),同僚与评审**并发**决定,断言恰好
一个落地,且轮次要么被交到第二环节且仍开着、要么被驳回关闭——绝不会「交出去之后又被从已经
离开的环节关掉」。红验:把重读换回陈旧快照,**两个决定同时成功**,断言立刻转红。

验收:typecheck 零错;`pnpm test` 717 passed | 17 skipped;prettier 通过。

### 分歧的合议落在链末端时自己了结(2026-08-22,对抗审查 major)

两处「末端」判定错位:校验器按**位置**禁止末环节用 `quorum: all`(`place.last = index === stages.length - 1`,
item/policy.ts),引擎按**解析**判末端(`isRouteEnd` → `enterableFrom` 跳过对该参评人解析不到节点的
环节)。于是一个位置上不是最后、解析后却是最后的环节可以是合议席位;分歧票走
`climb(here.index + 1)` 找不到落点,`refuse(action, 'chain-ends-here')` **让整个事务回滚**——
那一票没了,轮次留在原地,下一票再来一次同样回滚,**永远结不了**。

修法在引擎:合议非全票且 `isRouteEnd(policy, here)` 时直接以 rejected 了结(阶梯的末端本就
拥有最终的否),不再尝试攀爬。校验器不动——它看不见逐参评人的解析结果,这条只能由引擎判。

新增测试 `settles a split sitting that turns out to be the end of the ladder`:升级路线为
[合议(quorum all), 一个指向本租户内无人站位的组织类型的环节];该环节对参评人解析为空被跳过,
合议成为实际末端,分歧票落地即 rejected(轮次 completed/rejected,申报 rejected)。
红验:关掉该分支,那一票立刻变成失败退出、轮次卡在原地。

验收:typecheck 零错;`pnpm test` 718 passed | 17 skipped;prettier 通过。

### 活动流游标不再截断到毫秒(2026-08-22,对抗审查 major,两轮独立复现)

`/me` 活动流的 `nextCursor` 编的是行的 `at`——`to_char(... 'HH24:MI:SS.MS"Z"')` 的**三位毫秒**
渲染值,而下一页拿它 `::timestamptz` 回去与**微秒精度**的 `created_at` 比 `(created_at, source, id) <`。
`created_at` 几乎总带毫秒以下的位,于是落在 (trunc(T), T] 之间的行——**包括与边界行同一批写入的
兄弟行**——每翻一页就被静默丢掉一批,而且再也不会出现在任何一页里。这是本插件里唯一不是从
`created_at::text` 取游标的分页(同文件 `entryCreatedIso` 的注释就写着「exactly as stored」)。

修法:查询多选一列 `created_at::text as cursor_at`,`UserActivityRow` 增 `cursorAt`,handler 用它
编游标,`at` 仍旧只作展示用的毫秒渲染。

新增测试 `pages the feed without dropping rows that share an instant`:把一条申报的全部动态行
按来源分别塞进**同一毫秒内、逐微秒递增**的簇(这正是一串连续写入的真实形态),然后以 limit 2
逐页走完,断言与一次取完的顺序**逐 id 相等**。红验:游标换回展示值,3 行只走出 2 行。

验收:typecheck 零错;`pnpm test` 719 passed | 17 skipped;prettier 通过。

### 重路由不改变一轮复核的身份(2026-08-22,对抗审查 major)

管理员改题目配置触发 `propagate()` 重路由时,替代轮次的 `origin` 被写死成 `'reroute'`,
被取代那一轮是不是申诉的事实丢失。撤回规则读的是**申报当前所站那一轮**的 origin
(`entry/service.ts` 的 `appeal-not-withdrawable`),于是一条申诉轮次被重路由之后就变得可撤回——
参评人一撤,正在被争议的那个已定裁决被静默抹掉,申报回到 draft。
修法:`origin: round.origin === 'appeal' ? 'appeal' : 'reroute'`,并把 `appealedInstanceId` 一并
带过去;`OpenRoundRow` 增 `origin` / `appealedInstanceId`。

新增测试 `keeps an appeal an appeal when the chain moves under it`:驳回 → 申诉 → 管理员改升级
环节名触发 reroute-all → 断言替代轮次 `origin='appeal'` 且 `appealed_instance_id` 仍指向被争议
那一轮,且此时撤回被拒为 `appeal-not-withdrawable`。红验:写回 `'reroute'`,断言立刻转红。

**同处第二条(存疑,今天不可达,如实记录)**:该 `stageArrival` 传的是
`actorId: participant.userId`,与 `subjectUserId` 同值,使自审回避集合塌缩成「本人」一个,
丢掉「被审那一版材料的作者」。其余每个到站点传的都是版本作者。已改为 `round.actorId`
(`OpenRoundRow` 增 `actorId`,由 `EntryRevision` join 取)。**没有专门测试**:`record` 来源的
申报即时通过、不建轮次,`proxy` 来源目前没有任何创建路径,所以今天没有「作者不是本人的开放轮次」
可被重路由。这一改是把值对齐到其余调用点,不是新增机制。

验收:typecheck 零错;`pnpm test` 720 passed | 17 skipped;prettier 通过。

### 花名册按录入者自己的范围下发(2026-08-22,对抗审查 major)

`listParticipants` 把「在本批次任意位置持有 `assessment.entry.record`」当作 `requireRosterReach`
的替代品放行,然后把调用方的原始 filter 直接交给 `listParticipantsPage`——**授权范围从未被求交进
SQL**。于是一个只锚在某个班的录入者可以读到整批次的花名册(姓名、组织位置、状态),
违反 CLAUDE.md「读过滤下推,禁止先全取再过滤」。

修法按同一条纪律:把写路径那句 `staffReachesParticipant` 的谓词整体抽成
`staffReachOver(...)`(server/db.ts,typed fragment,锚点节点与路径以 SQL 表达式传入),
单人判定与整页过滤**共用同一份定义**;`listParticipantsPage` 新增可选 `reach`,以 EXISTS 逐行求交。
调用点先问是不是花名册管理员(管理员读全量,不被收窄),不是才按录入权收窄。

新增测试 `gives a recorder the people their authority covers, and no more`:种子里的录入者锚在
college A(subtree),断言管理员看得到 college B 的人而录入者看不到,同时 college A 下的人一个不少,
页面严格更短。红验:去掉 reach 传参,录入者立刻读到全部 6 人。

验收:typecheck 零错;`pnpm test` 721 passed | 17 skipped;prettier 通过。

### 退回已通过的申报要说「成绩变了」(2026-08-22,对抗审查 major)

`interveneOnEntry` 的 `return-for-revision` 可以把 `approved` 移到 `needs_revision`,分数随之
不再计入,但它的 `announce` 少了 `result-changed`——那是唯一能让参评人成绩单那张查询失效的
唤醒类型。于是页面继续显示一份这条申报已经不再带有的分。补上,与撤回/放弃那处对齐。
审查另提「批量退回路径 item/service.ts:499 值得一并检查」,对着源码核过**不成立**:
那条路径的 announce(item/service.ts:1000)本就带 `result-changed`。

新增测试 `says the result changed when an approved claim is sent back`(live.test.ts):真的 LISTEN
本批次频道,通过之后由管理员退回,断言听到 `result-changed`。红验:去掉该条,断言立刻转红。

验收:typecheck 零错;`pnpm test` 722 passed | 17 skipped;prettier 通过。

### 两条门禁本身是坏的(2026-08-22,对抗审查)

一、**审核读取边界套件把「崩溃」读成「放行」**。`review-access.test.ts` 的 `shape()` 用
`tagOf(exit) ?? 'ok'` 表示「这位读者进得去」,而 `tagOf` 只看 Fail 的 `_tag`——Die 没有 `_tag`,
于是 `undefined ?? 'ok'` 把 500 记成放行,九条断言里五条分不清「进得去」和「炸了」。
更能说明问题的是:`Exit` 在该文件里原本是 **type-only 导入**——旧 helper 运行时压根没看过 exit 本身。
改为 `answerOf`:只有真正的 Success 才是 `ok`,typed failure 给 `_tag`,其余一律 `DIED`。
并新增一例直接守住 helper(succeed/fail/die 三态),它在旧实现下必红。

二、**参评人桌面的「退回待办」半边完全没有覆盖**。`attention.test.ts` 那条名为「列出未答的补件请求
与退回标记这两件事」的用例,在断言之前就已经让参评人**重新提交**了——申报回到 `in_review`,
退回标记按定义不可能存在,而断言只写了 `toContain('supplement')`。于是
`myActionRowsOf` 的整个 `revision` 分支在服务端与浏览器两侧都没有任何测试。
改为在退回之后、重新提交之前先读一次桌面,断言 `['revision']` 且 entryId 与理由都对;
重新提交之后再断言 `['supplement']`——两个半边各有一次读,而且都用 `toEqual` 而不是 `toContain`。
红验:把 SQL 里那个 `'revision'` 字面量改一个字,断言立刻转红。

验收:typecheck 零错;`pnpm test` 723 passed | 17 skipped;prettier 通过。

### 服务端 minor 六条(2026-08-22,对抗审查)

一、**作废题目不清扫 `needs_revision`**。`openEntriesOfItem` 只取 draft/in_review,
一条正等参评人重交的申报因此从作废中幸存在非终态:概览桌面继续把它列为待办,而申报列表与状态
投影都说它已作废——一个既做不完也消不掉的任务。两处 status 集合都补上 `needs_revision`。

二、**活动流发出的复核链接自己会拒绝**。`openDoor` 收 `('active','blocked','awaiting_supplement')`
再加 `mayActOn`,而链接落地的 `mayRead` 对 `awaiting_supplement` 还额外要求读者就是那条未答请求的
发起人(§32.70)。两者恰好在这一态上不一致,同环节的同事会拿到一扇打不开的门。把开放请求那条
规则折进 `openDoor` 的 EXISTS,两处判定同源。

三、**巡检按快照写**。`patrolReviewRounds` 一次读完全部开放轮次,再逐条计算与写入;
`openPanelOf` 只按 instance 取,`setInstanceState` 只 CAS state。轮次若在扫描与写入之间升级,
新环节的席位会被按旧环节的人员结论终止,并可能被扣上 `assignee-not-found`。
`setInstanceState` 与 `openPanelOf` 各加可选 `at: {route, stageId}`,巡检把快照所在环节一并带上——
已经移动的轮次这一轮直接落空,下一轮在它的新位置重看。

四、**`listImports` 裸 `LIMIT 50`**。违反 CLAUDE.md「列表一律 keyset 分页,禁止裸 limit 静默截断」。
改为 `(occurred_at, id)` 行值游标(游标取 `occurred_at::text`,与活动流同一课),success 增
`nextCursor`,query 增 `pageQuery`。该端点前端尚无消费者,改动止于服务端。

五、**未认证的上传门对非 UUID 票据返 500**。`:reservationId` 直接进 uuid 列比较,PG 抛 22P02,
经 `receiveUpload` 变成 defect——一个陌生人的猜测换来 500 与一条 error 级日志。
`reservationById` 先校验票据形状,不像票据就是「没这张票」。红验:去掉形状校验,该用例得到 `DIED`。

六、**后台工作丢失插件身份**。插件在自己的 layer 构建期注册 boot hook(装配器已在该 fiber 上打了
`source` 注解),但宿主在屏障自己的 fiber 上运行 hook,注解不在——于是插件在启动时开的所有长期
循环都记成 `app`,`application.logging.sources` 的分源级别对它们静默无效。
`register` 现在读下当前 fiber 的 `References.CurrentLogAnnotations`(依据:
repos/effect/packages/effect/src/References.ts:185、Effect.ts:13858 的 annotateLogs 记录重载),
把它裹回 hook 的 run 上。新增 api-kit 测试断言 hook 内读到的 `source` 就是注册方的。

验收:typecheck 零错;`pnpm test` 724 passed | 17 skipped;prettier 通过。

### 实时通道的两种结束,与一处绑住文案的浏览器断言(2026-08-22,对抗审查)

一、**SSE 在被拒绝的连接上无限重拨**。`useApiStream` 把每一次结束都当成传输打嗝,固定 3 秒重拨,
不看错误也不计次。会话没了的标签页因此变成一个只要开着就每 3 秒敲一次门的请求循环。
现在分三种结束:干净结束照旧立刻重拨(服务端本就会主动关闭一条它还愿意接受的连接);
`isAuthenticationError` 判定的拒绝**停止重拨**,等身份变化让 hook 重新挂载;其余失败按几何退避
(3s 起,封顶 60s),收到任一事件即复位——一台宕机的服务器不该被每个打开的标签页每分钟敲二十次。

二、**一处业务断言绑住了目录文案**。按 blame 逐条核过全部浏览器套件里与 catalog 取值重合的断言:
绝大多数是**定位**(`getByRole(..., {name})`、`getByLabelText`),那是规矩①明确允许的;
真正把断言本身押在文案上、且落在规矩生效当天及之后的,只有 `review-layout.browser.test.tsx:528`
(移动端按下被禁用的「提请复核」键,断言弹出的原文)。ActionKey 增 `data-blocked-reason`
携带事实(`no-route`),测试改为断言该事实 + 确有一条提示出现(`[data-sonner-toast]` 计数),
原文归 localization 套件。审查说「两例」,实测只有一例:另一处
(`entry-workflow.browser.test.tsx:598` 断言未读点的 `aria-label`)是可访问名断言,业务事实
(有且仅有一个未读点)已由同处的 testid 断言承担,按规矩①保留。

**如实记录的存量**:立规矩(2026-08-20)之前还有六处业务断言押在文案上——batch-admin 的三处空状态
与三处状态片、identity 的一处拒绝语。它们不在本轮范围内,列为待办。

验收:typecheck 零错;`pnpm test` 724 passed | 17 skipped;`pnpm test:browser` 96 passed;prettier 通过。

### 对抗审查第三、四轮:33 条确证,先记录不修(2026-08-22)

前两轮的 12 条修完并推送之后继续加压。两个工作流、113 个 agent、34 条主张,验证升级为**三名独立
反驳者**(机制 / 可达性 / 先例与时效),默认立场是反驳,两票以上不反驳才算确证——第三名专门查
「是不是今天刚被修掉了」。**确证 33 条,反驳 1 条**。全文归档在
`docs/notes/adversarial-audit-2026-08-22.md`,按严重度排序,含失败场景、证据、最小修法,
以及反驳者对主张后果的逐条校正(有几条的「后果」被部分推翻,修之前必须先读校正)。

靶区**刻意与前两轮不重叠**:第三轮打从没打开过的域(计分与成绩、阶段引擎、认证与身份、
rbac 插件内部、装配层与 CLI、组织树);第四轮把当天落地的 12 笔修复**本身当嫌疑对象**重审,
外加四条横切扫描(租户隔离逐 join、无界工作、UI 投影与 i18n 边界、构建与生产一致性)。
已修的 12 条与两条已知待办写进禁报清单,所以没有重复项。

分布:critical 1、major 18、minor 14。两条我亲手复核过(见档案开头的「亲自复核过的两条」):

- **`Ui.browser` 模块在生产构建里被 tree-shake 掉**,严重度应从 major 上调为 **critical**:
  聚合模块用裸 import 求副作用,而两个 storage 插件都声明了 `"sideEffects": false`。
  在已 staged 的产物里搜驱动自己的三个字符串一个都搜不到,即生产环境 `registerUploadDriver`
  从未执行、**所有附件上传必然失败**,dev 下却完全正常。生产 smoke 看不见这一类缺失。
- **巡检人员缓存键漏了批次**:键是「节点:角色」而被缓存的查询是按批次判定授权接受情况的,
  同租户两批次互相污染,一个未接受授权的批次能把另一个满编批次的轮次全部扣成 `no-assignee`。

另一条最重的是 **critical · replacePlan 允许把未排期阶段挪到已进入阶段之前**,写入后
`normalizePlan` 判定该 plan 损坏,此后该批次的几乎所有读路径(含批次列表页)全部抛错,
API 无法自救,只能直接改库。服务端没有这条断言的测试,是前端恰好挡住了才没被发现。

本轮不修任何代码,按用户要求先攒。

### 生产环境所有附件上传都失败(2026-08-22,第四轮 critical)

第四轮审查发现、我实证确认:`Ui.browser` 声明的模块在**生产构建里被整个 tree-shake 掉**。
生成的聚合模块对它写的是求副作用的裸 `import "…/upload.ts"`(packages/build/web/src/collect.ts:206),
而 `@qualy/plugin-storage-local` 与 `@qualy/plugin-storage-cos` 的 package.json 都写着
`"sideEffects": false`——那句话就是在告诉打包器「这个 import 可以丢」。dev 下 Vite 照常求值,
所以本地一切正常;生产产物里 `registerUploadDriver` 从未执行,drivers 表为空,**任何附件上传
都抛 UploadUnsupported**。实证:在已 staged 的产物里搜驱动自己的三个字符串
(`upload refused with status`、`upload cancelled`、`lengthComputable`)一个都搜不到;
声明修正后重建,两个字符串回到 `assets/index-*.js`。

修法是把谎话改成实话:两个包声明 `"sideEffects": ["./src/client/upload.ts"]`。声明在包一级、
贡献在插件一级,两个文件谁也看不见谁,所以另加门禁 `tools/tests/side-effects.test.ts`:
遍历全部插件包,凡 `Ui.browser` 声明的模块必须被其 package.json 的 `sideEffects` 放行,
失败时点名「哪个 package.json 丢了哪个文件」;另一例单独守 sideEffects 的通配语法解析。
红验:把 `false` 写回去,门禁立刻点名两个包。

生产 smoke 看不见这一类缺失(它只断言探针、壳、manifest、哈希资源与 SIGTERM),这条也记进档案。

验收:typecheck 零错;`pnpm test` 726 passed | 17 skipped;prettier 通过。

### 第三、四轮审查发现的修复(2026-08-22)

档案 `docs/notes/adversarial-audit-2026-08-22.md` 里 33 条,本轮修掉其中 29 条(含已单独提交的
生产 tree-shaking 那条)。修复由一个**串行**工作流的 10 个 agent 按 territory 执行(同一棵树里并行
改会互相踩),每个 agent 必须先按当前代码重验该发现、写一个**先红后绿**的测试并把红输出写进报告;
我逐块审 diff 后才提交。

**我在审查中拦下的一处**:rbac 自授修复原本把 `appoint:<角色码>` 放进 `GrantEscalationRefused`
的响应体——那是客户端可见的 403,而 CLAUDE.md 明令「禁放角色码」,2026-08-03 那轮正好修过同类泄露。
两处 locale 都只用这个数组取长度、从不上屏,所以改成单个不指向身份的哨兵 `appointment-authority`,
并把 `carriedBy` 的返回收成它真正需要的那一个布尔,免得下次又被顺手塞回去。

**按域**:①阶段计划——`replacePlan` 现在要求已提交阶段是提交序列的**前缀**(反驳者指出有两种损坏
形态,planned 与 entered 都要守),并新增 `specOver`:对已存在阶段,字段缺省一律读作「保持原样」,
一次修掉「保存计划清空白名单」与「套用模板抹掉入口说明」两条同源缺陷;②审核服务——`requestSupplement`
按 a124973b 同一形状改为锁后重读再授权(两个兄弟方法经核实本就受 CAS 保护,未动),申诉的
phase gate 挪进事务内以符合 §32.75 记录的顺序,合议在链末端了结时不再把 resolution 记成 escalated;
③补件归属——§32.70 的收窄抽成单一 SQL 片段 `heldThroughOpenAsk`,附件门与申报经过改用
`userMayReadReview`,活动流的内联副本一并换掉(此前是三处各写各的);④巡检——缓存键补上批次
(同租户两批次此前互相污染),并用 `sweepSchedule` 去掉 `Schedule.fixed` 的追赶行为
(依据 repos/effect/packages/effect/src/Schedule.ts:948-950,已核对:overrun 时它确实返回零延迟);
⑤无界工作——花名册导入的逐行 INSERT 改为一条语句,题目配置保存不再把表单配置按行复制进内存;
⑥计分——分项按分显式量化后再求和,组上限/下限同样量化,账目现在能被逐行加出来。

验收:typecheck 零错;`pnpm test` 760 passed | 17 skipped(修前 726);`pnpm test:browser` 99 passed
(修前 96);prettier 通过;`pnpm qualy generate` 报 nothing to generate。

**未修的四条**(理由见档案与会话记录):权限目录带中文过线(跨插件契约重构,且触及冻结的 i18n
边界,需裁决);批次归档不检查在飞轮次(STATUS 记为已知分期交付,补哪一半是产品决定);
阶段时间点用设备时区而非批次日历(产品行为变更);发布产物按当前选中集打指纹而非超集(设计取舍)。

### 权限目录不再带着中文过线(2026-08-22,第四轮 major)

`/iam/permissions` 把每条权限的名称与描述作为**已选定语言的字符串**下发,角色编辑器直接当复选框
标签渲染。反驳者补了三点范围校正:①只有 `name` 会被渲染,`description` 过了线却被唯一的消费者丢弃;
②该端点按 role kind 过滤 target,一屏看不到混合列表;③`name` 同时是**服务端搜索键**——不过实查
发现唯一的消费者从不传 `search`,这条约束因此解开。

按冻结的 i18n 边界改:`PermissionDefinition.name/description` 变成 `UiText`,四个插件共 24 条权限
改写为 `message('<插件>/permission/<段>', '<英文>')`,原来的中文成为各插件**自己命名空间下**的
zh-CN 词条(assessment 有 7 条 id 早就存在,直接复用,只补 4 条)。UiText 的 Effect wire schema
上提到 api-kit(`uiText`),避免与 ui-registry 里那份各写各的。角色编辑器经 `formatText` 渲染。

三处**不是屏幕**的消费者改用新助手 `plainText(UiText)`(i18n 契约):权限表的镜像行、seed 的同一条
insert、以及服务端搜索——它们没有读者可以替其选择语言。resolve 期的 `compileCatalog` 只知道 code
不知道标签,那里用 `literal(code)`。顺带修掉一处我自己的正则误伤:角色名是租户业务数据,不是产品
文案,不该变成 UiText。

**门禁**:`tools/tests/catalogs.test.ts` 此前只遍历 UI surface 贡献,权限标签对它完全不可见——
这正是这条缺陷能活这么久的原因。现在它也遍历 `PermissionDeclarations`,于是权限标签的翻译完整性
自动被覆盖(红验:删掉一条 zh-CN,该插件立刻失败)。另加一例禁止用 `literal` 写权限标签——
literal 不会被收集,否则等于给这条门禁留了后门(红验:把一条改成 literal,立刻点名)。

验收:typecheck 零错;`pnpm test` 761 passed | 17 skipped;`pnpm test:browser` 99 passed;prettier 通过。

### 批次切换器重做(2026-08-22)

窄屏下顶栏左侧的「全部测评」按门槛隐藏,批次名却仍居中——左边空无一物时居中读起来像装饰。
改为:窄屏用 flex 一行、切换器靠左起(与页面其余每一行同一起点),平板及以上仍是三列量好的栅格,
名字居中在两扇门之间。名字的宽度上限从 `min(60vw,24rem)` 放宽到 `min(70vw,40rem)`——这些是人取的
名字,为了保护没人用的空白而提早切断是错的取舍。

切换器本身从 DropdownMenu 换成 Popover:菜单会霸占键盘做首字母跳转,搜索框放进去会丢掉每一次按键。
新形态三段:顶部无边框搜索行(带放大镜,重取时右侧出 Spinner)、中间列表、底部「全部测评」。

- **加载态**:此前打开时先是一个空菜单,现在首次打开显示三行骨架——它本来就要付一次往返。
- **上限 10 条**:切换器是给常来常往的那几个用的,再多就是把列表页塞进菜单里;其余交给搜索与列表页。
- **搜索**:输入 200ms 后落定,走服务端 `q`(端点本就支持),`keepPreviousData` 让列表在两次按键之间
  不塌成空。关闭即清空,下一个人打开不会撞见上一次的搜索。
- **当前批次不再单独占一块**:按用户要求与其余批次同形,只是排在最前并带勾(点它只关闭菜单)。
- popover 宽度 `min(92vw,26rem)`,行距收紧到 `py-1.5`。

新增测试 `says it is loading, offers a bounded few, and narrows them by name`:把切换器自己那次请求
挂起,断言骨架出现;放行后断言恰好两行、当前批次在首位且带 `switcher-current` 钩子、请求的 limit 是
10;再改搜索框断言发出了 `q` 且列表收窄到一行。红验:把上限改成 5,断言立刻转红。
三个坑记下来:①popover 在 portal 里,`page.*` 定位器不走那棵子树,按仓库既有习语用 `document` 查;
②React 受控输入必须调它打过补丁的 setter,直接赋值会被忽略;③用例收尾必须关掉 radix 图层,
否则它把文档其余部分标成 aria-hidden,下一条用例按角色什么都查不到(与 `0c609d25` 同一个坑)。

**顺带修回一处回归**:`assessment/batch/back` 被改成了「返回测评列表」,而 §32.74 裁决的文案是
「全部测评」(箭头与词同现,不再被读成浏览器返回)。已恢复。

验收:typecheck 零错;`pnpm test` 761 passed | 17 skipped;`pnpm test:browser` 100 passed;prettier 通过。

### 必填项统一带星号,并说给读屏听(2026-08-22)

审核弹层里事由有星号、审核意见没有,而两者的必填性是一样的:`ready` 同时卡着
`comment.trim() !== ''` 与「有配置事由时必须选一个」。核对下来,**通过**的意见确实是选填(它没有
`ready` 闸),**退回**与**提请复核**的意见都是必填。

`@qualy/ui/admin` 的 `Field` 早就有 `required`,连「星号不进无障碍名」的注释都写好了,只是这三处
没用。给退回与提请复核的意见字段补上 `required`。事由那处手写的星号收敛为共享的 `RequiredMark`
(从 admin 导出):不是每个必填控件都是 `Field`——一组开关自带标签行——两处手写的星号迟早会走样。

星号是 `aria-hidden` 的,只加它等于只对眼睛说话,所以四个必填 textarea(退回与提请复核各有桌面与
触摸两种形态)同时带上 `aria-required`,这也是本仓库既有的事实断言方式(item-chain 就是这么断
环节名称的)。在 entry-workflow 已经操作退回弹层的那条用例里加一句断言。
红验:去掉全部四处 `aria-required`,该用例立刻转红。

验收:typecheck 零错;`pnpm test:browser` 100 passed;prettier 通过。

### 对比版本选择器:键盘可达,窄屏可读(2026-08-22)

**键盘**:与旁边的决定弹层用同一套和弦,评审用键盘工作时不必学第二套——`1`-`9` 选版本,`⌘↵` 确认。
数字**只数可选的行**:本轮受审的那一版是灰的、按不动,若把它也算进编号,某个数字就会落在死行上。
细指针下每行右侧出 `Kbd`,确认键上出 `⌘↵`。

**窄屏**:此前从右侧滑入——390px 上那等于整屏横着进来,而它承载的是一份要用拇指选的列表。
改为窄屏从底部升起(`side` 按 `useIsBelow(640)` 决定),高度封顶 85vh。
行内三处会在窄屏折断的地方修掉:版本名与时间各自 `whitespace-nowrap`(截图里「第 1 / 版」断成两行、
时间从中间劈开,那是行在说自己放不下,而不是在说事);结论徽章允许收缩并 truncate;
**窄屏只留结论词、不带审核人**——读者来找的是「哪一版被退回了」,人名是第二位的事实。
底栏在窄屏改为竖排,两个按钮各占一半:三样东西挤一行时,确认键窄到说不出它要确认哪一版。

行上加了 `data-testid="version-row"` + `data-version` + `data-standing`(judged/comparing/available),
测试断事实不断徽章文案。新增 review-layout 用例:⇧D 打开、断言三行且最新一版为 judged、
按 `2` 与 `1` 各自把对比版本挪到预期的那一版、`⌘↵` 关闭选择器。
红验分两次做:关掉数字分支 → 选择断言转红;关掉 `⌘↵` 分支 → 关闭断言转红。
第一版测试写弱了——首个断言恰好与默认对比版本重合,快捷键失效也会通过;调整了按键顺序,两步都真正证明。

验收:typecheck 零错;`pnpm test:browser` 101 passed;prettier 通过。

### IAM 三处小修:租户角色的 anchor 归 null、policy 改名、grant-options 显式 target(2026-08-22)

按用户最终裁决:**核心授权模型冻结**——`Role.kind` 双轨、tenant/org 两种 grant、两套 grant-manage
权限、任命图同 kind 限制全部保留,之前咨询稿里的「root+subtree 大合并」不做。只修三处:

一、**租户角色不再存假的 anchor 政策**。此前 `setEligibility` 对 tenant 角色强制写
`{mode:'allow-list', orgTypeIds:[]}` 表示「不适用」——为了统一 schema 制造的无领域意义状态,
每个完整性检查都要绕着它走。现在 `roles.anchor_mode` 可空,新增检查
`(kind='org') = (anchor_mode IS NOT NULL)`;API 的 `anchorPolicy` 对 tenant 角色是 **null**;
写入时 kind 与政策不一致直接拒绝(新错误码 `ROLE_ANCHOR_MISMATCH`,不做静默修复——
「替你改成对的」正是 replace 悄悄变成谎言的方式)。迁移合并为单文件(先放开 NOT NULL 再置 null
再上约束);**升级测试第一次运行就抓到真实顺序缺陷**——最初把置 null 排在放开 NOT NULL 之前,
在有存量租户角色的库上必炸,本地 dev 库恰好无此类行才蒙混过关。红验:去掉 kind 一致性检查,
mismatch 用例转红。

二、**`eligibility`/`anchor` 在领域与 API 层改名 `holderPolicy`/`anchorPolicy`**(谁可担任 / 可在
哪类组织上任命),路由路径 `/iam/roles/{id}/eligibility` 不动(路径比内部命名活得久),数据库表名
不动。三、**`getRoleGrantOptions` 的 target 显式化**:query 必带 `target=tenant|org-node`,
tenant 禁带节点参数,org-node 两参数必齐——原来 orgNodeId 缺省推断 tenant、coverage 缺省静默
`self`,正好掩盖调用方 bug。

顺带撞上并绕开一个新的上游缺陷:PG 把检查里的 `IN` 规范化为 `= ANY ((ARRAY[…])::text[])`,
MikroORM 7.1.13 的 cast 剥离不认**数组类型** cast,重发 DDL 时产出 `ARRAY[…][]` 语法错误
(我们报的第 5 条的残余洞)。实体检查改写为等值 OR 形式避开,已记录在案。

验收:typecheck 零错;`pnpm test` 762 passed | 17 skipped;`pnpm test:browser` 101 passed
(identity 13/13);`pnpm qualy generate` 报 nothing to generate;prettier 通过。

### 组织只说名字:code 全删,seed 只建租户根(2026-08-22,用户裁决)

**code 删除**:`org_types.code` 与 `org_nodes.code` 连同格式检查与唯一索引整体移除
(迁移 `20260822140624_org-codes-drop.sql`,destructive approved)。产品里没有任何读它的地方,
它唯一的作用是逼管理员建组织时再起一个机器名。波及面全部收口:org API 的四个 schema、
服务端投影与插入、会话契约 `SignedInUser.primaryOrgNode`(node 与 orgType 都不再带 code)、
auth/rbac/assessment 三处 org-type options 端点、五个前端消费点(OrgPage 的 code 输入与展示、
三个 CheckboxGroup 的 code hint、items options 类型)、二十余个测试夹具的裸 SQL。
**用户类型与角色的 code 保留**(未裁决删除)。

**seed 重写**:不再预置高校八类型与九条层级规则——本产品不是只给学校用的。新租户初始化 =
一个组织类型「租户根」(名字是默认值,租户可改)+ 一个以租户命名的根节点。根由结构识别
(`parent_id IS NULL`),不靠 code/systemKey/名字;高校模板整体挪进 **demo 数据**:demo 自带
学院/年级/专业/班级四类型与链式规则,并把「学院」挂在根节点所站的类型之下——按名字幂等查找,
不与租户已有的同名类型冲突。seed 的 org 漂移检查随 code 一起退场(名字本就是业务可改字段)。

**根节点类型终身不变**(新不变量):`changeNodeType` 对根节点直接拒绝(复用 `ORG_NODE_IS_ROOT`,
与移动/删除根同门)。理由写在代码里:根的特殊性在结构不在标记,而「租户的根类型」正是经由根节点
所站的类型找到的——允许改它就剪断了唯一的识别线。根类型的删除保护无需新机制:根节点站在上面,
`ORG_TYPE_IN_USE` 自然拒绝。新增测试覆盖两半;红验:关掉根守卫,用例转红。
顺带,`effect-change-type` 的全部用例原先直接改**根**的类型——按新不变量重定向到根下的子节点,
夹具路径整体对齐。

验收:typecheck 零错;`pnpm test` 762 passed | 17 skipped;`pnpm test:browser` 101 passed;
seed 6/6;`pnpm qualy generate` 报 nothing to generate;prettier 通过。

### 登录能力归登录方式:受众取代用户类型上的两个布尔(2026-08-22,用户裁决)

`user_types.allow_local_login`/`allow_sso_login` 整体删除。它们在「一种登录方式一个实例」的世界里
就已经勉强,在多实例(两个 CAS、密码 + OIDC)下根本表达不了「学生可用学校 CAS、不可用 Entra」。
新模型:**每个 AuthProvider 自带受众**——`audience_mode`(`unrestricted | allow-list`,与 placement
同款,拒绝「空集合=全部」的歧义)+ `auth_provider_user_types` 关联表 + `version` 乐观并发。

**核心判定收进身份查询**:`identityByIdentifier` join provider 并带受众谓词,受众外的身份对调用方
如同不存在——所有 driver 得到同一种拒绝;auth-local 里那句 `allowsLocalLogin` 检查删除,
`FoundIdentity` 契约同步收窄。**最后管理员保护改写**:「可登录」= enabled user + enabled type +
至少一个 enabled provider 的受众接纳该类型(rbac 的 countRemainingAdmins 换成 EXISTS);
「系统账户必须留有一扇门」从用户类型编辑挪到**受众写入**上:`setAudience` 写后校验
RecoveryChannelRequired + keepsAdministrator,读的是正要提交的终态。CLAUDE.md 的不变量句已更新。

**管理 API 落地**(为登录方式页面备):`GET /auth/providers`(带受众)与
`PUT /auth/providers/{providerId}/audience`,新权限 `auth.provider.read/manage`(目录 24→26,
带 message 标签与中文,lock 已 resolve);frozen routes 补两条。用户类型的 create/update/list
schema 与两个编辑器的「登录渠道」勾选组整体退场,死键清空。

**迁移**分两文件:`20260822150000_provider-audience.sql`(建表、加列、**本地 provider 忠实继承旧
布尔**——audience 收成 allow-list,行来自 allow_local_login=true 的类型,没有人的登录能力因换形而
改变)→ `20260822150100_login-flags-drop.sql`(destructive approved 丢两列;generate 的自愈把我
手写 FK 的 on-update 语义差一并纠正在此文件)。升级测试建旧形态(一开一关两类型)断言继承准确、
列已消失。红验:拆掉身份查询里的受众谓词,「受众外的密码被拒」用例转红。

夹具波及:十余个套件的 user_types 裸 SQL 去掉布尔列;所有依赖「管理员可登录」的 fixture 补上一行
enabled 的 local provider(受众谓词现在真的要看到一扇门);entity-parity 两处表清单补新表;
「无登录通道」徽章与其用例随字段一起退役(那个事实以后属于登录方式页)。

验收:typecheck 零错;`pnpm test` 764 passed | 17 skipped;`pnpm test:browser` 100 passed;
`pnpm qualy generate` 报 nothing to generate;catalogs 8/8;seed 6/6;prettier 通过。

## 启动报错收口、申报阶段闸门前置、Ctrl+C 优雅停机修复(2026-08-23)

**数据库连不上时的启动输出**从两遍完整堆栈收成一行人话。根因两层:main.ts 的 onExit 失败分支
原本 `Effect.void`,渲染全靠上游 runMain 的默认 logger(在 `Effect.provide(logs)` 之外,把
Cause 当 message 直接 inspect);现在 host 自己报——带 `_tag` 的 Error 视为「有意的启动失败」
只打 message,未打标的缺陷才附完整 Cause,`disableErrorReporting: true` 关掉上游重复输出。
database 插件在 `attempt` 咽喉点识别连接类故障(`adviseOn`:ECONNREFUSED 族/28P01/28000/57P03,
`failedWith` 的走树键补 `errors` 以覆盖 AggregateError),`MigrationFailed` 消息带上目标
host:port 与指路语——「测试 postgres 占着 5432 时报 role qualy 不存在」这类误导从此自我解释。
实测:连 59999 端口启动,输出恰一行
`startup failed: could not apply the lineage: connect ECONNREFUSED ... (postgres is not reachable at 127.0.0.1:59999; ...)`,退出码 1。
红验:startup.test 新断言(不可达带 host、错角色带 rejected the credentials)先红后绿。

**申报页在渲染前就穿上阶段闸门**(裁决 §32.76)。`listMyEntries` 增 `filing` 块:按题下发
create/submit 的三态可用性,服务端 `participantGates` 一次 roster + 一次 gateView、逐题纯
`decide` 细化——顺带修复 item-scoped 补充期把全部条目动作一刀切 blocked 的既有缺陷(现在补充期
恰好放行它指定的题;filing-gates.test 两用例,红验=去掉 decide 的 itemId 后 scoped 用例转红)。
前端:「去申报/一键声明」在 create 关闭时禁用 + tooltip 给原因(Paper 三个按钮位共用 Shut 包装,
`data-gate` 承载事实);EntryDialog「保存并提交」按 submit 闸门禁用(草稿半边照常);撤回确认在
「本阶段提交已关闭」时转 destructive 并明说单向门后果(新文案 withdraw-final-hint,ConfirmDialog
增 `data-tone` 测试钩子)。SSE 增 `phase-changed` 事件:手动 advancePhase 事务内广播、
sweepDueBoundaries 物化任何边界后广播(≤1 分钟),四个订阅页按 sync 级整组失效;手动刷新键补上
getBatch 失效。浏览器测试四用例(禁用创建/禁用提审/destructive 撤回/普通撤回),红验=拆掉
oneWay 后 destructive 用例转红。

**一次 Ctrl+C 不再打断优雅停机**。实证:tty 按进程组投递 + pnpm 向子进程转发,一次按键到达进程
两个 SIGINT,08-08 加的升级路径把第二个当「操作员坚持」立即 130。修法:升级判定加 1 秒同击去抖
(毫秒级重复=同一次按键的扇出,>1s 的再按才升级);另实测 vite 依赖优化器忙时 close 会吃满上游
20s drain 封顶,dev 收尾给 vite close 加 3s 封顶 + 超时告警。三向验证:pnpm 下组信号一次→
优雅退出 0;150ms 双发→仍优雅;拖住 drain 后隔 1.5s 二按→照旧立即 130。

验收:typecheck 零错;`pnpm test` 767 passed | 17 skipped;`pnpm test:browser` 104 passed;
prettier 通过。另:mikro-orm 上游 PR 已开(#8197 的修复,一行 regex + 回归测试,本仓照旧保持
等值 OR 写法直至上游发版)。

**追补(同日)**:用户实测停机仍要十多秒——真凶不是 vite,是**客户端连接钉住 drain**:浏览器
标签页的空闲 keep-alive 与 SSE 长连接都让 `server.close` 等到上游 20s 封顶(runtime.ts 的旧注释
早已记过同类事故)。修法在 NodeServer 层装催逐器:首个停机信号即刻并每 250ms 清空闲连接,2s 宽限
后掐掉剩余连接(在途响应有宽限,被掐的流是客户端 runtime 的重连场景不是错误);main.ts 收到首个
信号立即打一行 `shutting down; press Ctrl+C again to give up waiting`(此前静默 drain 与没按到
无法区分)。实测:挂着空闲 + 半截两条连接单发 SIGINT,2.1s 优雅退出 0;pnpm 组信号回归照常 0.1s。
`pnpm test` 767 passed 复跑通过。

**再追补(同日)**:用户指出信号提示行与装配期报错都绕过 logger(裸 console,无时间/级别/颜色,
json 模式下采集器也看不见)。修法:logging.ts 把行渲染抽成单一 `render`(logger 本体与带外调用
共用,pretty/json 同源),新增 `logLine(settings, level, message, failure?)` 供无 fiber 场景使用
(沿用同一套 per-source/全局最低级别门槛);main.ts 三条信号行(shutting down=Info、再按放弃=Warn、
超时强退=Error)全部走它,pre-launch 带(manifest 读取、resolveLogging、verifyAssembly、
loadAssembly/makeApplication)失败统一 `refuse()`:精心措辞的裸 Error 只打 message,真缺陷附
inspect 证据,退出码 1——装配期不再出现无格式的 unhandled rejection 堆栈。实测:坏 manifest 路径
一行格式化 ERROR + exit 1;SIGINT 提示行 `INFO app shutting down; ...`;json 模式下信号行是完整
json 记录;坏数据库路径不回归。`pnpm test` 767 passed 复跑通过。

## 前端产物瘦身:Scalar 参考 UI 出局、静态资源预压缩(2026-08-23)

用户对生产构建跑 Lighthouse:性能 55(模拟 4G),本机实测 FCP 249ms / LCP 707ms / TBT 0 / CLS 0——**执行没问题,是下载量**。产物 5.8MB,单个分块 3.4MB 且在首屏 preload 里。

**归因用 sourcemap 做实**(临时 `vite build --sourcemap` 后按 `sources` 归并):那个分块里
`effect/unstable/httpapi/internal/httpApiScalar.js` **一个模块占 3.1MB**——Effect 内嵌的整份 Scalar
接口文档界面。进来的路径是一条边界破洞:六个插件的 `src/client/api.ts` 与 web-runtime 只用
`Api.local(...)`,却从 `@qualy/api-kit/plugin` 取,而该模块顶层 import 了 `HttpApiScalar`,且
`HttpApiScalar.layer` 挂在被真实使用的 `Api` 对象字面量上——tree shaking 摇不掉。顺带把
`HttpApiBuilder`/`HttpRouter`/`HttpServerRequest|Response`/`Multipart`/`multipasta` 一并拖进浏览器。

**修法**:新增浏览器安全叶子 `@qualy/api-kit/local`(只导出 `Api.local`,无任何通向服务端的 import),
七个浏览器入口改指它;`plugin.ts` 从叶子再导出,服务端调用点不变。门禁扩到既有的
`tools/tests/browser-graph.test.ts`(它本来就真打包每个 client 入口):①图里不得出现挂载面
(`httpApiScalar`/`HttpApiBuilder`);②单入口打包体重上限 600KB(当前 130–155KB)。名单刻意只列这两个——
上游 client 自身会牵出 `Multipart`/`multipasta` 等约 100KB,那是上游内部耦合,不该由本仓库断言。
红验:把 rbac 的 client api 改回 `/plugin`,门禁立刻报出 `['HttpApiBuilder','httpApiScalar']`。

**第二件:静态资源此前零压缩**(Lighthouse 每条资源 transferSize≈resourceSize)。staging 期为
js/css/html/json/svg/map 写 `.br`(brotli 最高档)与 `.gz` 双胞胎(小于 1KB 或压不小的不写),
sirv 开 `brotli/gzip` 按 Accept-Encoding 选发。压缩成本落在构建期而非每次请求。生产 smoke 增一条
断言:带 `accept-encoding: br` 取首个哈希资源必须回 `content-encoding: br`——两半各自失败都是静默的
(缺双胞胎只是发原文)。红验:关掉 sirv 压缩,smoke 报 `served with content-encoding none, expected br`。

**实测**:产物文本资源 5.18MB → **2.13MB**,实际上线字节 **0.55MB**(≈9.4×);最大分块 3.27MB → 351KB
(brotli 90KB);staging 报告 `precompressed 95 file(s), 1.57 MB saved on the wire`。

**顺手两条**:`--muted-foreground` 由 oklch(0.556) 调到 **0.54**——shadcn 默认值在本产品的浅色面板上
是 4.34:1 / 4.40:1,达不到 WCAG AA 的 4.5:1(Lighthouse 无障碍 96 的唯一扣分项);index.html 补
`meta description`(SEO 90 的扣分项)。最佳实践 81 是误伤:扣分的 unload handler 弃用与 bf-cache
失败都来自浏览器扩展,报告自身也警告了,无痕窗口重跑即可。

验收:typecheck 零错;`pnpm test` 767 passed | 17 skipped;`pnpm test:browser` 104 passed;
`pnpm build` 成功并报压缩量;生产 smoke 八条全过(含新的 brotli 断言);prettier 通过。

## 前端交付第二轮:上传 sdk 离开启动路径、分块按往返成本重排(2026-08-23)

用户第二次 Lighthouse(模拟 4G / 移动):性能 **75**,TBT 0、CLS 0.001 满分,失分**全部**在
FCP 0.52 与 LCP 0.21——仍然是下载,不是执行。报告点名 83 个请求、**77 个脚本**,其中一大批不足
1KB。

**第一件:一个没人打开的 sdk 压在每次页面加载上**。用 sourcemap 按包归并入口分块(947KB 源码):
`cos-js-sdk-v5` **392KB**,与 react-dom 并列。进来的路径是 `Ui.browser('./client/upload.ts')`——
这条声明的语义就是「每次启动都为副作用执行」,而该模块顶层 `import COS from 'cos-js-sdk-v5'`。
报告里 "Legacy JavaScript" 的两条信号也在它身上:按报告给的字节偏移在产物里回查,line10@1299 是
babel 的 `_classCallCheck`,line9@47913 是 js-md5 的 `Array.isArray` polyfill。
修法:`sdk()` 改动态 import,注册照旧同步(注册只值一个名字和一个函数)。入口分块
**359KB → 195KB**(gzip 108 → 62),sdk 成为 165KB 的独立分块,由第一次上传去取。

**门禁补上这个洞**:browser-graph.test 此前只探 `src/client/api.ts`,而这个驱动**没有** api.ts。
现按 `collectWebPlugins` 发现**每个 `Ui.browser` 模块**逐个打包,断言其**静态可达**闭包
(entry + `chunk.imports` 递归,动态 import 正确地不计)< 24KB。红验:把静态 import 放回去,
门禁报 `costs 229 KB on every page load`。两个探针共用抽出的 `bundle()`。

**第二件:分块按往返成本重排**(Vite 8 = rolldown 1.2,`output.codeSplitting`,依据读
`rolldown/dist/shared/define-config-*.d.mts` 的 `CodeSplittingGroup`)。
①**每个 locale 一个文件**:七个插件各自 `import('./locales/zh-CN.ts')` 再加宿主一个,八个请求排成
一列且都在首屏前 await;按路径里的 locale 归组(不点名插件、不点名语种),`includeDependenciesRecursively: false`
(叶子表,带上 helper 反而重复 16KB)。8 → 1 个文件,还小了 1KB。
②**扫掉自动分块留下的灰尘**:被两个页面分块引用的模块各自成块,而本仓库的这类模块大多是图标再导出、
`cn`、一行包装——批次列表页 61 个文件里 22 个不足 2KB、合计仅 13KB。规则:**≤1KB 且被 ≥2 个入口引用**
的模块入池,`entriesAware`(按「谁引用」分组,页面仍不下载别的页面的代码)+ 48KB 合并阈值。
1KB 这个天花板是刻意的:实测抬到 4KB,较大的共享模块开始与启动图同池,首屏波多付 600ms 换请求数。

**实测(批次列表页,brotli 字节 + Lighthouse 自己的 Lantern 参数 150ms RTT / 1638.4Kbps / HTTP1.1 六连接)**:

|     | 文件   | 字节(br)   | 模型网络成本 |
| --- | ------ | ---------- | ------------ |
| 前  | 68     | 368 KB     | ~3749 ms     |
| 后  | **33** | **331 KB** | **~2664 ms** |

启动波 16f/229KB → 8f/214KB(文件少一半、字节反而略降)。分块名另作处理:`entriesAware` 会把每个
引用它的入口名拼进块名,超过一百字符且在壳的 preload 列表与每个引用方里重复,故 `chunkFileNames`
统一收成 `shared-[hash].js`——哈希本来就够区分。

**生产产物真跑一遍**(playwright 起真生产装配,`locale: 'zh-CN'`):js 请求 21 个,locale 分块**恰 1 个**,
cos sdk **未被请求**,中文文案正常渲染。

**两条小的**:批次列表的筛选片计数此前 `undefined` 时不渲染,数字落地时每个片一起变宽——报告里唯一那
条 layout shift(0.0005)。改成从首帧就用 `min-w-[1ch]` 占位(tabular 数字下 1ch 恰是一位)。
ticker 的注释断言 blur「归合成器所有」,这是错的:blur 会读取元素外的像素,Chrome 因此无法把该动画
交给合成器——注释已改正并写明这是 Lighthouse 报 7 个非合成动画的原因;**动画本身保留**(该审计是
informative,metricSavings 为 0,而这是一处有意的设计)。

**两条查过但决定不做**:①**不 preload 字体**——`font-display: swap` 意味着没有任何东西在等它,
提前拉取只会跟真正挡住 LCP 的 JS 抢六条连接里的一条和带宽;②**渲染阻塞的 CSS 无处可削**——167KB
里 143.8KB 是 `@layer utilities`(properties 2.5 / theme 3.2 / base 4.1),即按 `@source packages/plugins`
超集扫出来的真业务样式,上线 21.6KB(br),Lighthouse 说的 150ms 就是「有一张样式表」的固有代价。

验收:`pnpm typecheck` 零错;`pnpm test` **770 passed | 17 skipped**(新增 3 条);
`pnpm test:browser` 104 passed;`pnpm build` 成功;生产 smoke 八条全过;prettier 通过。

## 排期对话框:空的「」、被叠成一列的时间栏、以及一个自己写的时分秒输入(2026-08-23)

**「」是空的**。`assessment/schedule/start-now-body` 的英文默认串**没有** `{name}` 占位符,zh-CN
翻译却自己加了一个——ICU 拿不到这个参数,渲染成一对空书名号,静静地上线了。

**这类缺陷此前无人能看见**:catalogs.test 校验的是「每个 locale 齐全、没有孤儿键」,不校验**参数对齐**。
现补上:用 `@lingui/message-utils` 的 `compileMessage`(浏览器运行时用的同一个编译器)把默认串与译文
各自编译,比对参数集合——译文多出的参数=渲染成空,译文丢掉的参数=句子在说的那个数没了。
**不用正则**:`{count, plural, =0 {Add} other {Add #}}` 里 `{Add}` 是复数分支不是参数,分不清这两者的
正则会把写对的报成错、把写错的漏掉(实测过)。全仓扫描:除这一条外无其他不对齐。红验:把 `{name}`
放回去,门禁报 `invented: ['name']`。

**时间选择器重做**。两处缺陷:①两栏被叠成上下——`PopoverContent` 的基础类里有 `flex-col gap-4`,
调用处只写了 `flex`,tailwind-merge 认为不冲突于是 `flex-col` 幸存,一个共享原语的默认值悄悄重塑了
消费方;②滚轮要先点一下某栏才生效。而且它本来就慢:选 09:30 要在 24 项与 60 项两个列表里各滚一次。

**改成一个控件**:一个触发器(整条填满 Field,此前 `w-60` 比上面的「开始方式」卡片短一截),
一个浮层 = 日历 + 底下一行时分秒。选日期不再关闭浮层,因为时间是同一个答案的另一半、就在这块面板上。

**时分秒是自己写的 `@qualy/ui/time-field`**(用本仓库的 `Input`,不是 `input[type=time]`——那个由浏览器
绘制,每个浏览器长得都不一样,也没法和周围对齐)。`093045` 一路打完自动跨格;上下箭头步进并循环
(23→00、59→00);左右箭头在格间走;**首位数字大到不可能再接一位就当场收尾**(小时的 5、分钟的 6
不必等两秒配对窗口超时);光标透明、按键全部拦截解释——半个时间不是时间,让 `9` 孤零零留在小时格里,
之后就得有人决定它是几点。`role="spinbutton"` + `aria-valuemin/max/now/text`,两位数的格子靠名字区分。

秒是应要求加的,并且是对的:系统据以动作的时刻就是一个时刻,一个悄悄把它抹到整分的控件是在替人做
没被要求做的决定。**注意**:边界扫描每分钟物化一次,所以秒是「不早于」的下界,实际进入可能晚至一分钟内。
时钟图标留在左侧,与触发器上「图标在前」的排法一致。

浏览器测试六条(开场值、整串打完并交接光标、首位过大提前收尾、箭头循环、选日期后面板不关、清除),
`pnpm test:browser` 13 文件 110 通过。消息:`pick-date` → `pick-datetime`,`pick-time` 移除,
common 增 `clockSecond`。

验收:`pnpm typecheck` 零错;`pnpm test` 770 passed | 17 skipped;`pnpm test:browser` 110 passed;
`pnpm build` 成功;生产 smoke 八条全过;prettier 通过。

## 组织与权限五页重排(2026-08-23)

用户提供了「组织与权限 v2」设计稿(claude.ai/design 项目,3a–3k 共 11 屏),要求**参考骨架、
不照搬文案**,按本仓库既有风格优化五个页面。已落地:

**组织架构(重做,原页面无任何测试覆盖、交互最弱)**:单页两个面孔,`?view=` 切换。
①**组织结构**:左树(搜索即答匹配集而非通往它的枝、前两级默认展开、子级计数、不可管理带锁),
右侧详情——类型徽章、上级/同级次序/完整位置、名称与类型的行内编辑、**下级组织行**(类型+子级数+打开)
与**行内新建**;②**组织类型**:左侧类型列表(使用计数+可建摘要),右侧**按类型编辑语法**——
「允许的下级」勾选面板(带各类型组织数),保存写**规则对的 diff**(逐对 put/delete,失败停在拒绝
的那一对);「可作为下级」反向只读;删除按客户端已知计数先行拦截。三处设计稿思想被采纳并加强:

- **新建控件只提供合法类型**(规则永远轮不到变成报错);
- **移动目标同时按规则过滤**(除了可管理与子树排除,还要求目标类型允许本类型作下级);
- **删除阻塞前置陈述**(有下级时按钮禁用并说「先移走或删除 N 个下级组织」,人员/授权仍由服务端拒绝)。

**用户(重做)**:锚点下拉 → **左树右名单**。左侧组织树(搜索、选中即切换名单);右侧工具行
(搜索、**本级/含下级** ToggleGroup、**用户类型筛选**——`listUsers` 早就支持 `userTypeId` 但从未
上过界面)+ 表格化名单(姓名/学工号/类型/所在组织/状态)+ **keyset 加载更多**(useInfiniteQuery
累积,替换掉原来只说「还有更多」却给不出下一页的版本)+ 计数行(路径 · 已列出 N 人,`data-testid`
承载事实)。

**用户类型 / 角色(改排版)**:两页都从上下堆叠改为**左列表右编辑**的主从两栏(列表 sticky);
角色列表按**租户级/组织级分组**(组头小字:整个租户范围生效 / 授予时选定生效的组织),权限摘要从
裸 code 串改为「N 项权限」。编辑器(UserTypeEditor/RoleEditor)未动,identity.browser.test 的
全部行为契约保持绿。

**用户详情(加头部)**:头像(initialsOf)+姓名+状态徽章+学工号+类型+完整组织路径的身份卡,
停用/启用移入头部;下方面板保持。

**文案**依规范重写(引导不解释):如用户页提示从「用户在组织中所处的位置决定了谁能管理他们。」
(解释模型)改为「先在左侧选组织，右侧列出站在那里的人。」(指引动作);org/tree/title 由「组织树」
(控件名)改为「组织架构」(页面名)。全部新增文案 en 默认 + zh-CN 双语,catalogs 门禁绿。

**新增浏览器测试** apps/web/tests/org-admin.browser.test.tsx 三条:合法类型限定的新建(断言选项
恰为占位+1)、语法编辑保存 pair diff(断言 putRule/deleteRule 各自的参数)、不可管理节点零控件。

**设计稿中有意未做**(范围裁决,非遗漏):登录方式独立页(`listAuthProviders`/`setAuthProviderAudience`
API 在而无任何界面,值得单独一轮);导入人员/导入组织向导;名单多选与批量移动/改类型;组织树上的
在册人数(需要跨插件计数的服务端工作);拖拽排序。

验收:`pnpm typecheck` 零错;`pnpm test` 777 passed | 17 skipped;`pnpm test:browser` **113 passed**
(新增 3 条);`pnpm build` 成功;生产 smoke 八条全过;prettier 通过。

## 组织与权限五页推翻重做:去卡片,按设计稿骨架重排(2026-08-23)

用户驳回上一轮:「还原太差,还保留了很多之前的烂摊子,设计稿中没有那么多的卡片」。这次逐屏读了设计稿的
**源码**(不是截图),把 3a–3f 的 DOM 抽出来看结构,而不是照着图猜。

**设计稿自己写明的骨架**:「沿用现有页面的骨架……工作区固定 1080 居中……列表统一为细框行……
**分段用细线不用色块**;主操作深色,其余描边」。回头看仓库,assessment 那几页本来就是这个语言
(`rounded-lg border` 盒子 + `border-t` 行 + `divide-y`),**org/iam/rbac 五页是唯一的异类**——
它们把每一段都塞进 `<Card>`。所以这轮的核心动作就是:**把卡片全部拆掉**。

**新增 `@qualy/ui/screen`**(共享给四个页面):`Screen` 画通栏标题带(下边一条线,不是内嵌卡片)+ 正文容器;
`Segmented` 视图切换(填充式,因为它标的是「读者站在哪」而不是「可以做什么」);`SectionHead`、`Facts`
(标签/值一行)、`DefRow`(设置行)、`Blocker`(阻塞项:圆点 + 事实 + 处理方式)。
**`Panel` 由卡片改为细线分段**(`border-t pt-4`,首个不画线)——全仓只有 5 处用它、assessment 一处没用,
所以改它一处就把所有编辑器一起去卡片化了。

**尺寸与间距不复刻**(按用户明确要求):设计稿的 19/15/13/12.5/11.5px 与 28px 控件一律换成项目自己的
`text-lg / text-base / text-sm / text-xs`、`size="sm"` 控件、`gap-3/4/5/6`。复刻的是**结构、信息架构与密度**,
不是像素。

**五页**:

- **组织架构**:两个面孔共用骨架。结构面 = 左树(搜索、折叠、锁标、子级计数、页脚统计)+ 右侧
  「名称+类型徽章+重命名/移动」、四格 Facts(上级/位置/同级次序/类型)、「下级组织」细框行表
  (类型/子级数/打开 + 行内新建)、「删除组织」阻塞项清单。类型面 = 三栏:类型列表 / 「允许的下级」
  勾选面板(保存写 pair diff)+ 可作为下级 + 删除 / **层级关系阶梯**(设计稿右栏,由规则推导成树)。
- **用户**:三栏 —— 组织树 / 名单表格(筛选行 + keyset 加载更多 + 计数行)/ **右侧人员详情栏**
  (头像、学工号、状态、用户类型、组织路径、角色、完整资料)。设计稿的核心改进就是这一栏:
  看一个人不必牺牲正在读的名单;打开的人也进 query string。
- **用户类型 / 角色**:左列表 + 右编辑器,无卡片;角色列表按租户级/组织级分组。
- **新建表单一律进对话框**(新建用户/用户类型/角色):设计稿里新建是标题栏的动作,不是常驻页面底部的表单。

**顺手修掉用户报的一个抖动**:从组织结构切到组织类型时「新建类型」按钮才出现,把 tabs 往左顶。
现在创建动作排在视图切换**左边**,换面孔时 tabs 一动不动。

验收:`pnpm typecheck` 零错;`pnpm test` 777 passed | 17 skipped;`pnpm test:browser` 113 passed;
`pnpm build` 成功;生产 smoke 八条全过;prettier 通过。

**仍未做**(与上一轮相同,非本轮遗漏):登录方式独立页、导入人员/导入组织向导、名单多选与批量操作、
组织树上的在册人数(需跨插件计数的服务端工作)、角色编辑器内部的 tab 化(概览/权限/适用范围/任命/成员)。

## 三个编辑器按设计稿重做,登录方式页从无到有(2026-08-23)

用户驳回:「组织架构和用户两页复刻依然不够完整;用户类型、角色页、登录方式页都完全没优化」。
上一轮改的是页面骨架(去卡片、分栏、导轨),**编辑器内部一个字没动**——三个页面的右半边仍然是
「一段 CheckboxGroup + 一个保存」堆叠。这一轮读的是 3d/3e/3f 的源码,把编辑器本身重做。

**新增编辑器原语**(@qualy/ui/screen 追加):`EditorHead`(名字 + 事实徽章 + 动作)、`ModeChoice`
(规则说成两个单选,而不是一个复选框——「不限」与「仅这些」是两条规则,空名单意味着「谁都不行」,
单选说得出来,未勾选的复选框说不出来)、`PickGrid`(细框勾选格,带用量数)、`PickList`(带全选表头的
分组勾选盒)、`SaveBar`(左边说清这次保存影响谁,右边放弃与保存)、`Rail`/`RailRow`(导轨与它的行)。

**用户类型**(3d):重命名进对话框,主体是「允许归属」单选 + 三列细框类型格 + 保存;下面三条 DefRow——
**登录入口**(哪些入口接纳这类人,没有就红字说明「持有该类型的人无法登录」,右侧「去设置」直达新页)、
**可担任角色**、**停用与删除**(阻塞项 + 按钮)。后两条走**允许失败的查询**:入口与角色是别的域的事实,
没有那两个读权限的人看到的是少了两行的页面,而不是加载不出来的页面。

**角色**(3e):四个 tab——权限 / 可担任的人 / 可任命 / 状态。tab 外是**事实条**(生效范围、状态、现任、
开放给),因为无论为哪个 tab 而来,这四条都要先看到。权限 tab 是**两列分组盒**(表头带 3/7 计数与全选,
行尾是等宽字体的权限码)+ 搜索框 + 底部保存条(左边「N 项权限 · M 人担任 · K 个角色可任命」)。
分组名来自**声明权限的插件自己**:`PermissionDefinition` 新增 `group?: UiText`(与 `name` 同理——
谁定义权限,谁给它所在的分区起名,语言在浏览器里选),四个插件各自声明并各自翻译。

**登录方式**(3f):**这个页面此前根本不存在**——`listAuthProviders`/`setAuthProviderAudience`
两个端点服务端早就有,前端一直没有入口。现在是导轨 + 编辑器:每个入口的受众用同一套
`ModeChoice` + `PickGrid`(格子上带各用户类型的人数),空名单当场标红说明「没有人能从这个入口登录」,
下面是地址标识与登录页次序,底部保存条。**没有做的不画**:添加、删除、停用、测试连接在设计稿里有,
API 里没有,于是页面上也没有。

**用户页补完**(3c):名单加**账号列**(identityCount,0 标红——有记录不等于登得进来);人员栏补
**登录账号**与**移动组织**(下拉限定在本人可管辖的节点,`setUserPlacement`)。
**组织页补完**(3a):补**人员**一节,链到用户页并把该节点预选好。

**顺手修掉一个真实的 flaky**:`scheduler.test.ts` 的「日程被改则重新瞄准」三次里红一次。原因是
plan 变更的通知走 LISTEN/NOTIFY 是**墙钟**,而测试在通知到达前就把虚拟钟一次性推了 125 秒,循环随后
才重新瞄准,之后虚拟钟再也不动。改成在墙钟重试循环里**逐次推进虚拟钟**。中途踩到并纠正了一个判断:
`TestClock.adjust` 不能放进 `TestClock.withLive`——`testClockWith` 是**经 `Clock.Clock` 取到
TestClock 再 cast** 的(repos/effect/packages/effect/src/testing/TestClock.ts:444-446),
withLive 把 Clock 换成了实时钟,adjust 当场 `not a function`。所以推进在 withLive 之外,等待在里面。
连跑五次全绿。

验收:`pnpm typecheck` 零错;`pnpm test` 777 passed | 17 skipped;`pnpm test:browser` 116 passed
(新增 login-methods 三条);`pnpm build` 成功;生产 smoke 全过;prettier 通过。

**仍未做**:导入人员 / 导入组织向导、名单多选与批量操作、组织树上的在册人数与人员构成
(都需要先有服务端端点或跨插件计数)。

## 用户资料页落地,五页去原生控件与文案整改(2026-08-23)

**后端三处改动**(都是前端做不下去才动的):

1. `getUser` 返回 `identities`——每个人绑定了哪些登录入口(入口名、类型、标识、最近登录、入口是否停用、
   是否自带口令)。3i 的主体就是这一段,没有它这页只能画个空壳。查询在 users.ts 里 join
   `auth_providers`,凭据本身一列都不取。
2. `getUserOptions` 的每个节点多一个 `userCount`。一次改动补上三处:组织树行尾的人数、组织页的「人员」
   一节、以及**删除组织前的真实校验**。
3. `createUserType` / `createRole` 的 `code` 改为可选,缺省时服务端派生
   (`codeFrom`:能转写就用名字的 slug,中文名则 `role-<8位>`)。code 是机器键,不该让人在命名一个角色
   的时候先发明一个;仍然接受传入,导入场景照旧。

**去原生控件**:五个页面里已无一个裸 `<select>` / `<input type=checkbox|radio>`。`Segmented` 改建在
shadcn `Tabs` 上(h-9,与按钮、输入框同高——之前自己写的那版矮一截,和右边的控件对不齐);
`ModeChoice` 用 `RadioGroup`;`PickGrid`/`PickList` 用 `Checkbox`;下拉一律 `Select`。
新增 **`NodePicker`**(Popover + 搜索 + 保留层级缩进的列表),用于移动组织、授予角色的锚点、
人员栏的移动——组织名靠层级才区分得开,拍平成一列 option 就废了。

**空状态**:新增 `Blank`(基于 `Empty`,虚线框、图标、标题、说明,至少 22rem 高)。五个页面进入时的
一行小字全部换掉,文案从「在左侧选中一个 X」改成「点开一个 X」+ 该页在做什么。
另加 `RailSkeleton` / `EditorSkeleton`,组织页、资料页加载时先占位再落内容;登录方式与资料页的列表
经 `Stagger` 逐行入场。

**删除阻塞改为徽章**:新增 `Barred`(动作名 + ✕/✓ 徽章 + 一行原因),替掉原来的 `Blocker` 圆点句子。
用户类型的「不能停用,也不能删除」现在是两枚徽章。组织删除的「人员与角色授权在删除时校验」**整句删除**——
改成读真实人数与子级数,两个都为 0 才放开按钮;「逐个处理」一并删掉。

**树行整行可点**:用户页与组织页的树行都重写成**一个从左到右整宽的 button**,箭头画在按钮内部而不是
浮在左端。原来越深的节点,名字前面那条「看着能点、点了是别的行为」的空带就越宽。现在点一行 = 打开它并展开。

**新建对话框**:去掉 code 字段;用户类型是「名称 + 允许归属(单选)+ 类型格」,角色是「名称 + 生效范围
(卡片式单选)」,新建用户的类型改 `Select`。

**文案整改**(五页 zh-CN 与英文默认值一并):清掉「这」「·」「锚定」「站在」「不是…而是」「它」
「左侧/右侧」。页面说明从教操作改成讲职责:组织架构「维护组织的名称、上级与下级」、
用户「按组织维护人员名单、类型与归属」、角色「维护角色的权限、可担任的人与可任命的角色」。

验收:`pnpm typecheck` 零错;`pnpm test` 777 passed | 17 skipped;`pnpm test:browser` 116 passed;
`pnpm build` 成功;生产 smoke 全过;prettier 通过。

**仍未做**:绑定/解绑登录方式与重置密码(3i 里有,API 没有,故不画);导入向导;名单批量操作。

## 请求上下文落地(audit 计划 Phase 1)(2026-08-24)

按 docs/audit-design.md Phase 1 落地请求关联基础层:`RequestContext`(requestId / clientIp /
userAgent / traceId / sessionId)进 `@qualy/api-kit/request` 新叶子,serve 中间件
`requestContext({trustedProxies})` 每请求提供。三个关键裁决:

- **traceId 不自造**:上游 `HttpEffect.toHandled` 对每个请求无条件包 `HttpMiddleware.tracer`
  的 server span(repos/effect/packages/effect/src/unstable/http/HttpEffect.ts:89-91),默认
  NativeSpan 无父时生成 W3C 128 位 traceId 并继承来访 `traceparent`(Tracer.ts:693)。
  RequestContext 只从 `Tracer.ParentSpan` 读,排除禁用态的 `'noop'` 哨兵
  (internal/effect.ts:5645-5648)。也就是说接 OTel 之前 traceId 就已真实可关联。
- **消费侧一律 `Effect.serviceOption`**:`HttpRouter.Provided` 是封闭集合(HttpRouter.ts:805-809),
  handler 经 R 要求 RequestContext 会把 requirement 泄漏到 group layer 构建期;而 audit/登录记录
  的调用方本来也会从 job/CLI 进来——「没有请求」是答案,不是错误。
- **client IP 走受信代理策略**:socket 对端是唯一自己观察到的事实。对端不受信即视为客户端、
  其 X-Forwarded-For 直接无视;受信才从右向左走链,跳过受信跳,第一个不受信地址胜出;
  伪造/畸形条目返回 undefined(unknown 好过 attacker-chosen)。CIDR 用 node:net 的 BlockList;
  配置 `QUALY_TRUSTED_PROXIES`(逗号分隔地址/CIDR,缺省空=只信 socket 对端),非法条目在
  配置期抛错。上游 `HttpMiddleware.xForwardedHeaders` 是无条件信任,不采用。

**sessionId 是槽不是字段**:上下文在 cookie 解析之前创建,auth 的两条 session 解析路径
(viewer 与 Authenticated)解析成功后 `bindSessionId`,同请求的后续读者可见。

**接线**:runtime 中间件链 `requestContext(accessLog(app))`(tracer 在最外,平台保证);
access log 每行注解 requestId(pretty 走尾缀、json 结构化);`completeLogin` 的
loginIp/userAgent 改读 RequestContext——顺带修正:代理部署下原来记进 sessions 的是代理地址。
auth 的 effect-sign-in 测试装配补上同一中间件(它守的正是「会话没记地址」回归)。

新增 packages/core/api-kit/tests/request.test.ts 14 条:地址策略矩阵(信任门控、右起第一个
不受信、CIDR、端口/括号/v4-mapped 规整、伪造条目→unknown、非法配置抛错)+ 真服务器四条
(requestId 每请求新铸、XFF 经受信 loopback 解析、traceparent 继承、bindSession 请求内可见
且请求间隔离)。

验收:`pnpm typecheck` 零错;`pnpm test` 791 passed | 17 skipped(新增 14 条);
`pnpm test:browser` 116 passed;`pnpm build` 成功;生产 smoke 八条全过;prettier 通过。

## 审计落地(audit 计划 Phase 2):契约、写入器与只读日志页(2026-08-24)

按 docs/audit-design.md Phase 2 落地 `@qualy/audit-contract`(packages/contracts/audit)与
`@qualy/plugin-audit`(packages/plugins/base/audit),照 rbac 的 contract+provider 分工。

**契约包**(根只放纯类型,`./action` `./effect` `./plugin` 三叶子):`AuditAction.define`
(code/target/version/name/details Schema)——details 的 Schema 约束为
`Schema.Codec<any, any, never, never>`(服务通道钉死 never,writer 编码任意注册动作不携带
open requirement);`Audit` 服务标签与 `AuditActionCatalog`(prepare 相值,与权限目录同构);
`Audit.actions(owner, actions)` 贡献 + `Audit.provider` 编译(重复 code、非法格式、version<1
均在装配期拒绝)。扩展点**不带 capability 键**:动作不留 per-assembly 状态给 resolve 管,
「声明了动作但装配里没有 audit 插件」由 boot 装配器的完整性规则硬失败——这就是
mandatory base capability 的落点。

**写入器**(writer.ts):`record(action, input)` 无错误通道,一切拒绝都是 defect——
声明了要审计的操作,事件写不进就不许提交。注册校验(未声明/版本不符)→ schema encode
(allowlist 第一道)→ writer guard 第二道(凭据形键名 password/token/secret/… 全树拒绝、
单串 ≤4096、整体 ≤32KiB)→ INSERT。**同事务语义零成本**:`db.query` 经 ambient
TransactionManager 落在调用方连接上(orm.ts 的 join-existing 传播),测试证明事件在事务内
可见、随 abort 消失、随 commit 留存。请求关联(requestId/traceId/sessionId/clientIp/
userAgent)由 writer 自己读 Phase 1 的 RequestContext——调用方**传不进也伪造不了**;
source 缺省:有请求上下文为 http,否则 system。actor 由调用方显式传入,writer 不依赖
auth/rbac(读侧 API 才可以)。

**表** audit_events:租户 FK cascade 是唯一的边,actor/target 只存 id+快照 label(无跨插件
FK,历史不因所指对象消亡而失效);checks 钉 actor_kind/outcome/source/action_code 格式;
四条索引,其中 keyset 索引 `(tenant_id, occurred_at, id)` 特意全升序——`order by … desc, … desc`
是这条索引的倒序扫描,而 schema 比较器会把混合方向声明归一成 `(desc, asc)`,那个谁也服务不了。
迁移 20260824132054_audit-base.sql。

**查询 API**(`GET /audit/events` + `GET /audit/event-options`,frozen-routes 同笔更新):
keyset 分页 + 过滤(actionCode/actorUserId/outcome/targetKind+Id/from/to),权限
`audit.event.read`(tenant target,经 rbac.require)。**cursor 踩了一个真实精度坑**:
`Date.toISOString()` 只有毫秒而 `now()` 写微秒,边界行连同同瞬间的行整页消失——改为查询
同时取 `occurred_at::text`(pg 自己的全精度文本)作 cursor 键,回程 `::timestamptz` 逐字节
往返。同一事务三事件共享 now(),分页测试靠 id tiebreak 钉住不重不漏。**零新错误码**
(BadRequest/AccessDenied 复用),append-only:应用层只有 INSERT/SELECT,API 不提供任何
update/delete。

**UI**:audit/events 页(/organization/audit,`permissionOf('audit.event.read')`)——
时间/操作人/操作/对象/结果/IP 六列,动作与结果两个过滤,行展开显示来源/原因/requestId/
traceId/UA/details JSON,加载更多;actionName 由目录携带 UiText,语言在浏览器选。
i18n en+zh-CN 全量;权限目录经描述器自动进 seed(seed.test 权限计数 26→27)。

**范围裁决**:`audit.event.export` 权限与导出端点未做(导出机制本身不存在,声明无人消费的
权限码更糟);sessionId 不出 API(写入保留,关联归 Phase 2 之后的诊断需要)。现有插件的
mutation 接入是 Phase 5;Phase 3(用户生命周期)按计划下一步。

测试 packages/plugins/base/audit/tests/effect-audit.test.ts 九条:记录与缺省、**事务内可见/
随滚回消失/随提交留存**、未声明动作拒绝、版本不符拒绝、schema 外 details/凭据键/超限三连拒
(且零残留)、请求关联落列、同瞬间分页不重不漏 + 租户隔离、目录编译三种拒绝。

验收:`pnpm typecheck` 零错;`pnpm test` 803 passed | 17 skipped(新增 12 条);
`pnpm test:browser` 116 passed;`pnpm build` 成功;`pnpm qualy deploy` 应用迁移后生产 smoke
八条全过;prettier 通过。

## 用户生命周期落地(audit 计划 Phase 3):软删除、version 与身份可撤销(2026-08-24)

按 docs/audit-design.md Phase 3 一次做完:users 加 `deleted_at` + `version`,UserIdentity 加
`revokedAt/revokedBy`,授权与登录史随删除收回,全部写路径过 version 栅栏,并且这些操作从第一天
就产生审计事件(auth 经 `Audit.actions('auth', userActions)` 声明七个动作,auth 因此
dependsOn plugin-audit——首个真实的审计接入方)。

**三态生命周期一扇门**:`PUT /iam/users/{id}/status` 载荷升级为
`{status: active|disabled|deleted, version, userTypeId?, primaryOrgNodeId?}`,路径集**零变更**。
active↔disabled(manage)、disabled→deleted(新权限 `auth.user.delete`)、deleted→disabled
(新权限 `auth.user.restore`,即恢复;可带新归属)。删除必须从 disabled 出发
(USER_NOT_DISABLED),恢复只回到 disabled——**交还的是这个人的连续性,不是权限**:身份与授权
不随恢复复活,businessNo 永久占用(同一个人回来是 Restore 不是新建,§28)。deleted 上的
update/move/enable 一律 USER_DELETED。删除事务内:rbac 端口 `revokeAllGrantsOfUser`(新增,
授权是历史,撤销不删除)→ 身份全撤(revoked_at/by)→ 会话清空 → deleted_at,四步一个事务,
审计事件带三个计数落在同一提交里。

**Schema 的三个不变量**:`deleted ⟹ disabled`(CHECK)——这条买到一个大简化:所有已过滤
`u.enabled = true` 的谓词(rbac held CTE、survivors、会话校验、登录投影、assessment 名册写入)
**自动**排除已删除用户,全仓真正要补 `deleted_at is null` 的只有不滤 enabled 的名单/计数/守卫类
查询(auth 三处计数、placement 三连、rbac userExists/userForGrant、assessment 五处、seed 三处,
按清点逐一落)。`live ⟹ 有类型有归属`(CHECK)+ FK 改
`on delete set null (列子集)`(PG15+ 语法,比较器实测通过):删类型/删节点对 deleted 用户是
detach,对 live 用户由 CHECK 拒绝——**23514 因此进 TRANSLATABLE**(soft delete 把「活人挡删除」
从 restrict fk 换成了 check 拒绝 set null,域错误必须照旧到达,org 补
`chk_users_live_user_is_placed → NodeInUse` 映射)。role_grants 与 user_identities 的 user FK
cascade→restrict:授权与绑定是历史,「withdrawn rather than deleted」不再被外键背刺。
身份唯一索引改 live-only(`where revoked_at is null`),登录/seed 查找全部滤 revoked。
迁移 20260824135549(重跑 no-op 已验)。

**顺手修掉一个潜伏的保护洞**:`administratorSurvivors` 漏了 `inForce`——已撤销的管理员授权仍计
入幸存者,last-admin 保护恰好在最需要拒绝的时刻放行。补上,并有测试钉住(撤销唯一活授权后,
停用最后一位真实管理员必须 LAST_ADMINISTRATOR)。

**version 并发**:update/move/status 全带 `expectedVersion`(USER_VERSION_CONFLICT),每次
生命周期写 `version+1`;wire 的 user 投影带 version 与三态 status,userType/primaryOrgNode
变 NullOr(仅 deleted 行可空)。**已删除视图**:`GET /iam/users?status=deleted`(cursor
指纹含 status);单位已消失的 deleted 用户无锚可依,只对租户级读者可见(子树读者的权威由节点
定义,没有节点就没有定义域)。UI:用户页加「在册/已删除」切换,资料页 disabled 时出删除
(确认语如实说明可恢复什么、不恢复什么),deleted 时出恢复;version 全线程化。

**审计动作**:auth.user.create/update/move/enable/disable/delete/restore(七条,detail schema
各自极小——改了哪些字段、从哪到哪、收回了几条),actor 带 displayName 快照,动作名进 auth 的
catalog(en+zh-CN)。新错误码 USER_VERSION_CONFLICT/USER_NOT_DISABLED/USER_DELETED 全量翻译。

**迁移无数据步骤**(纯 DDL:加列、改约束、重建部分索引),空库重放即覆盖,未另写升级测试;
seed 测试的硬删 fixture 先清 grants(restrict FK 正是为拦住生产代码里的硬删而立)。

新增 packages/plugins/base/auth/tests/effect-lifecycle.test.ts 五条:删除级联(计数、原子性、
审计行序列)、恢复语义(USER_DELETED 拒绝面、回到 disabled、不复活访问)、version 栅栏三写路径、
在册/已删除互斥可见、survivors 修复。七个既有 harness 补 audit 层与实体闭包。

验收:`pnpm typecheck` 零错;`pnpm test` 808 passed | 17 skipped(新增 5 条);
`pnpm test:browser` 116 passed;`pnpm build` 成功;`pnpm qualy deploy` 后生产 smoke 八条全过;
prettier 通过。

**Phase 3 未做**(裁决):绑定/解绑登录方式与重置密码仍无 API(3i 待做);已删除视图的批量
恢复;恢复时重选归属的专用 UI(API 已支持 userTypeId/primaryOrgNodeId,原归属健在时无需选择)。
下一步按计划 Phase 4:SignInAttempt 与 sign_in_events。

## 登录记录落地(audit 计划 Phase 4):sign_in_events 与统一 attempt 契约(2026-08-24)

按 docs/audit-design.md Phase 4:登录成败进 auth 自己的 `sign_in_events`(§15——认证是本域的
高频安全事实,不进 audit_events 稀释管理操作的轨迹),记录统一由 core 执行,驱动经契约上报。

**表**(auth 拥有,迁移 20260824143226):tenant FK 之外零外键(历史活得比所指对象久);
door 快照(provider_id + type/code 当时的样子);**没有 identifier 列**——攻击者输入的字符串
不值得存,已解析的尝试记 ids,分析靠 IP/provider/时间窗(§19;将来真要做撞库聚合再引
HMAC pseudonym)。请求关联四列(requestId/traceId/clientIp/userAgent)由 core 从 Phase 1 的
RequestContext 读,调用方递不进也伪造不了。索引三条:tenant+时间、tenant+用户+时间、
tenant+IP+时间(撞库的样子就是一个地址敲很多扇门)。**tenant 非空**是对 §16 的一处已裁决偏离:
事件从 resolveProvider 成功起才记——URL 都解析不到门的请求不是对任何租户账号的尝试,
是访问日志的噪音。

**契约**(@qualy/auth-contract/login):新增 `SignInFailureReason` 七值与
`failAttempt(provider, {reason, userId?, identityId?})`;`completeLogin` 增 providerId。
驱动只说它看得见的(凭据不对、身份不存在);**账号级拒绝由 core 自己记**:completeLogin 的
合并谓词说不之后,core 用一次慢路径专用的分类查询把「不」拆回精确原因
(user-deleted/user-disabled/user-type-disabled/tenant-disabled/user-not-found)——记录的
全部价值就是线上答案刻意没有的精度,wire 仍然只有 INVALID_CREDENTIALS,时序拉平不动。

**completeLogin 事务化**(§17):session 插入(改 returning id)+ identity.lastUsedAt +
成功事件,三写一个事务,存在与否一起决定;随后 `bindSessionId` 把新会话绑回请求上下文,
同请求内后续的审计事件立即携带 sessionId。auth-local 四个失败口全部上报
(空标识/查无身份/受众拒绝合并为 identity-not-found,密码不符为 invalid-credentials 且带
userId/identityId);解析不到 provider 的路径**不记**。

**门禁适配**:entity-parity 的表清单补 sign_in_events(auth 的 TABLES 与 rbac 的
UPSTREAM_TABLES——lineage 里已有的表,generator 不重建)。

**范围裁决**:sign_in_events 暂无读 API 与界面(先收数据;呈现留给安全面板或用户详情的
「最近登录」一节,届时按 keyset 惯例开 /audit 或 /iam 路径);oauth-state/cas-ticket 类
reason 值随对应驱动落地时扩展联合类型。

新增 effect-sign-in 测试四条:成功事件带 session/请求关联且 session 同事务存在、密错事件
指认账号但 session 为空、未知名字只记 identity-not-found 且**不存输入**、停用账号被拒时
记录精确原因而 wire 仍是统一拒绝。

验收:`pnpm typecheck` 零错;`pnpm test` 812 passed | 17 skipped(新增 4 条);
`pnpm test:browser` 116 passed;`pnpm build` 成功;`pnpm qualy deploy` 后生产 smoke 八条全过;
prettier 通过。下一步:Phase 5(逐插件补齐 mutation 审计)或 Phase 6(OpenTelemetry)。

## 审计扫尾(audit 计划 Phase 5):四插件 mutation 全面接入(2026-08-24)

按 docs/audit-design.md Phase 5 逐插件扫 mutation。四个插件共新增 **29 个审计动作**:

- **auth 补齐**(7):user-type create/update/enable/disable/placement.update/delete +
  provider.audience.update。五个 user-type 服务操作与 setAudience 原先不带 Principal,
  统一在签名末尾线程 `as: Principal`(handlers 与全部测试调用点同笔更新);actor 快照
  经共享的 `server/audit-actor.ts`(users.ts 原地重构复用同一实现)。
- **org**(10):node create/update/move/retype/delete、type create/update/delete、
  type-rule update/delete。moveNode 的同父 reorder 分支记为 update(fields=[sortOrder]),
  putRule 的幂等重复请求不产事件;delete 事件在 FK/CHECK 拒绝之后才可能到达,天然只记成功。
- **rbac**(10):role create/update/enable/disable/permissions.update(**带 added/removed
  码表 diff**,§7 的动机)/eligibility.update/appointment.update/delete + role-grant
  create/revoke。码走 **iam.\*** 而非 rbac.\*(与 URL、权限码同一产品域纪律)。
  `grants.grant`/`createScopedAssignment`/`revoke` 三个入口经同一 grantRole/revoke 落点
  一次覆盖;**revokeAssignment 端口也记**(assessment removeStaff 走它;actorId 为空记
  system),`revokeGrant` 改 returning 整行以供记录。roles create/update/setEligibility/
  remove 补 actor 参数。
- **assessment**(2):batch.create/delete——**只有这两个**,是裁决不是遗漏:该域的管理写
  几乎全部已有带 actor 的 domain history(config revisions、lifecycle/phase/participant
  events、roster imports、item revisions),按「已有 Domain Event 不复制」跳过。清点出的
  真空白(模板 CRUD、item delete/status/score-groups、access 面离散事件、draft 期
  updateBatch)记入下方 backlog。

**audit 读侧 actor 名称补全**:org/rbac/assessment 的闭包看不见 users(依赖方向),写侧只记
`{kind:'user', userId}`;listEvents 左连 users 取
`coalesce(actor_label, displayName)`——快照优先(auth 写侧仍记快照,活得过删人),
现名兜底。audit 的 Db.entities 因此增 dependsOn '@qualy/plugin-auth'(只读),UI 的 user 无名
兜底改为 id 前八位。

**波及面**:org/rbac/assessment 的 serviceLayer 均新增 Audit requirement;十个测试 harness
(rbac 3、assessment round.ts+6、org 3 的 catalog 扩容)统一补 audit 层 + 各自域的动作目录;
audit 自己的测试闭包补 auth 实体。i18n:29 个动作名 en+zh-CN 全量(catalogs 门禁绿)。
新增两条落库断言:org 的结构写在同一提交里留下事件序列(update+retype,actor 正确);
rbac 的授予事件指认授予者与受与者。

**过程教训**:rbac roles.ts 的 import 注入曾静默未生效(锚点字符串跨行不匹配),`Audit`
未定义让整个 make 的推断塌成 unknown、错误却在 500 行外的 handlers 报——二分(逐个中和
record 调用)才定位;教训是脚本化批量编辑必须断言锚点命中(后续脚本已全部 assert)。

**backlog(触发即做)**:assessment 模板 CRUD 与 item delete/status/score-groups 无任何
痕迹,补 domain event 或 audit 二选一;audit UI 的 actionCode 过滤下拉现已有 29 项,需按
插件分组;`audit.event.export` 仍未做(导出机制不存在)。

验收:`pnpm typecheck` 零错;`pnpm test` 814 passed | 17 skipped(新增 2 条);
`pnpm test:browser` 116 passed;`pnpm build` 成功;生产 smoke 八条全过;prettier 通过。

## 遥测核心包落地(OTel 计划 Phase 6.1):@qualy/telemetry(2026-08-24)

按 docs/PHASE6-OPENTELEMETRY-DESIGN.md §26 的 6.1 建核心遥测包并接入组合根。

**关键裁决:不引 `@effect/opentelemetry` 与 `@opentelemetry/*` SDK 家族**(对设计 §5.1 的
偏离,依据是 §9.2「先检查 Effect 自带」与仓库「Effect 内置优先」纪律)。effect core 的
`effect/unstable/observability` 已内置完整 OTLP/HTTP 导出栈:`OtlpTracer`/`OtlpMetrics`
(`layerFromConfig` 解析标准 OTEL_* 环境变量)、`OtlpSerialization`(protobuf 与 json 双
序列化,零外部依赖)、`OtlpExporter`(批量、瞬时错误重试 3 次、连续失败自禁 60s 并丢弃
缓冲、shutdown flush 以 `shutdownTimeout` 有界——§22 的 best-effort 语义上游已实现)、
`OtlpResource`(OTEL_SERVICE_NAME/OTEL_RESOURCE_ATTRIBUTES 合并)。实际读过:
repos/effect/packages/effect/src/unstable/observability/{Otlp,OtlpTracer,OtlpMetrics,
OtlpExporter,OtlpSerialization,OtlpResource,internal/otlpEnv}.ts、ConfigProvider.ts、
Config.ts、platform-node/src/NodeHttpClient.ts,以及对照弃用的
packages/opentelemetry/src/{NodeSdk,Resource,OtelTracer}.ts。触发再引 SDK 家族的条件:
6.5 若裁定采用 pg auto-instrumentation(需要 OTel context bridge 与全局 provider)。

**包形态**(packages/core/telemetry,`@qualy/telemetry`,export "." → src/sdk.ts):

- `resource.ts`:进程身份一次解析。env 赢过缺省(OTEL_SERVICE_NAME > 属性形式 >
  `qualy-server`;OTEL_SERVICE_VERSION > QUALY_VERSION);只补环境没说的:
  `service.namespace=qualy`、`deployment.environment.name`(按 NODE_ENV 二分)、
  `service.instance.id`(QUALY_INSTANCE_ID 或 boot 时铸一枚 UUID,进程内稳定)。
- `sdk.ts`:`telemetryLayer: Layer<OtlpExporter.Flusher>`。无 endpoint 或
  OTEL_SDK_DISABLED → 纯 flusher(不建 HttpClient、不换 tracer,`pnpm dev` 零负担);
  有 endpoint → OtlpTracer+OtlpMetrics(共享 Flusher registry)+ 按
  OTEL_EXPORTER_OTLP_PROTOCOL 选序列化(缺省 http/protobuf;**grpc 是启动拒绝**,不是
  静默降级)+ 自带 `NodeHttpClient.layerUndici`。`ConfigProvider.layerAdd` 兜底三个
  缺省:OTEL_TRACES_EXPORTER/OTEL_METRICS_EXPORTER=otlp(上游把未设读成关,OTel 规范
  读成 otlp,按规范)、OTEL_METRIC_EXPORT_INTERVAL=60000(设计 §6)。

**接入**:main.ts 单点 `Effect.provide(telemetryLayer.pipe(Layer.provideMerge(logs)))`
(Effect LSP 的 multipleEffectProvide 拒绝链式 provide,合成一次)。层序即语义:应用 scope
先关(drain 被 trace 到),telemetry 后 flush,logger 最后退场。平台 `HttpMiddleware.tracer`
与既有 `Effect.fn` 命名 span 无需改动即被导出;Phase 1 的 RequestContext.traceId 自动从
noop 变为真实 128-bit id,audit/sign-in 关联(§10)不需要新代码。

**测试**(packages/core/telemetry/tests,端口 3201,8 条):真 http receiver 断言 OTLP/HTTP
JSON 线格式——span 与 metric 到达且带 service 身份、env 覆盖缺省(namespace)、signal 级
endpoint 单独启用、disabled 与无 endpoint 双静默、collector 死掉业务 effect 照常成功
(flush 有界 ~3s)、grpc 启动拒绝;resource 优先级两条单测。

**端到端实证**:带 OTEL_EXPORTER_OTLP_ENDPOINT 重跑生产 smoke(真启动、真请求、SIGTERM),
receiver 收到 33 个 span(Database.prepare、Rbac.make、Auth.signIn.make 等——6.4 的清理
素材已可见),八条 smoke 断言照常全过,退出码 0(导出不阻塞 shutdown)。

验收:`pnpm typecheck` 零错;`pnpm test` 822 passed | 17 skipped(新增 8 条);
`pnpm test:browser` 116 passed(首跑遇既知 playwright 收尾崩溃,重跑干净);`pnpm build`
成功;生产 smoke 全过(有/无 OTEL endpoint 各一遍);prettier 通过。
下一步按计划 6.2(本地 observability compose profile)或 6.3(HTTP span 路由模板与
RequestContext 关联)。

## 本地可观测性栈落地(OTel 计划 Phase 6.2):collector + LGTM profile(2026-08-25)

按 docs/PHASE6-OPENTELEMETRY-DESIGN.md §15/§26 的 6.2,给开发机一条默认关闭的
traces+metrics 通路;应用侧零改动——它只认识 `127.0.0.1:4318`,这正是 6.1 的全部意义。

**交付**:

- `ops/observability/collector.local.yaml`:otlp 双协议 receiver →
  memory_limiter(先拒绝后缓冲)+ batch → otlp 转发 LGTM;health_check extension
  开 13133。**已在 pin 定镜像内 validate 通过**(README 记了升级时的复验命令)。
- docker-compose.yml 新增 `observability` profile 两个服务,照既有风格
  (container_name、restart、logging 限额、localhost-only 端口):
  `otel/opentelemetry-collector-contrib:0.159.0`(4317/4318/13133;镜像 scratch 基底
  无 shell,docker healthcheck 不可能,13133 就是探针——注释与 README 都写明)与
  `grafana/otel-lgtm:0.31.0`(Grafana 映射 localhost:3001,healthcheck 走
  `/api/health`,镜像内 curl 实查存在;**不带 volume**——本地遥测的保留期就是容器
  生命期)。collector `depends_on` LGTM healthy。版本 pin 自 Docker Hub 当日最新
  stable(nightly 与 latest 拒绝)。
- `ops/observability/README.md`(中文):启动、健康、停止、升级。一个实测出的坑
  写进了文档:启用 profile 后不带服务名的 `docker compose down` 会把默认组的
  postgres 一并停掉,停栈必须点名 `down otel-collector otel-lgtm`(已实测:postgres
  不受影响)。
- `.env.example` 补注释掉的 `OTEL_EXPORTER_OTLP_ENDPOINT`(无值即 no-op 的语义一并说明)。

**端到端实证**(§27 条 1 提前达成):`up -d --wait` 双容器 healthy;13133 探针
`Server available`;带 endpoint 重跑生产 smoke 全过、退出 0;经 Grafana API 查
Tempo:`service.name=qualy-server` 的 trace 15 种 root(`http.server GET` 请求 span、
`Database.prepare` 114ms、`Auth.signIn.make` 等——span 命名与路由模板归 6.3);
metrics 通路以合成 OTLP counter 实证:POST 4318/v1/metrics →
Prometheus 查回 `qualy_pipeline_probe_total=1`(应用侧业务指标归 6.6,Effect 注册表
现在为空是预期)。

验收:collector config validate 通过;`pnpm typecheck` 零错;`pnpm test`
822 passed | 17 skipped;prettier 通过(本阶段未动任何 TS/web 源,browser 与 build
不受影响)。下一步按计划 6.3:HTTP span 路由模板、W3C 传播与 access log 的
requestId/traceId 关联。

## HTTP 关联落地(OTel 计划 Phase 6.3):路由模板 span 名与日志双 id(2026-08-25)

按 docs/PHASE6-OPENTELEMETRY-DESIGN.md §9/§10/§14 与 §26 的 6.3。上游已给的不重做:
`HttpMiddleware.tracer` 建 server span 时继承 W3C traceparent(Phase 1 已测)、设全套
semconv 属性(http.request.method、url.*、client.address、http.response.status_code、
redacted headers);`HttpRouter.asHttpEffect` 在路由命中时把模板路径写进 `http.route`
属性(vendored HttpRouter.ts:220-223)。**缺口只有 span 名**:命名发生在路由之前,
默认 `http.server GET`,而 `Tracer.Span` 接口没有改名操作(实查 Tracer.ts:371-387,
httpapi 层也不管命名)。

**裁决:api-kit 新增 `routeSpanNames` serve 中间件**,响应结束后读 span 的 `http.route`
属性,命中则把 `name` 赋成 `{method} {route}`。这是对声明接口的一处越界,依据三条实查
事实:OTLP tracer 的 span 对象经 Object.assign 建 `name` 自有可写属性、导出序列化在
`end()` 时才读名(OtlpTracer.ts);NativeSpan 的 `name` 是赋值类字段(Tracer.ts:655+);
noop span 的 `attribute()` 是空操作、共享 attributes Map 永远没有 `http.route`,改名对
禁用态天然短路。**pinning 测试钉住导出名**——升级若让任一实现不再迟读 `name`,测试直接
红而不是所有 span 名静默回退。404 无模板保持 `http.server GET`,原始 URL 永不成为名字。

**access log 补全 §14**:annotations 在 requestId 之外新增 traceId 与 spanId(server
span 自身的 id,请求作用域内可靠;noop 哨兵不记)。生产 JSON 实测逐字达标:
`{"message":"GET /api/app/manifest 200 2ms","annotations":{"requestId":"7bd8…",
"traceId":"e579…","spanId":"0288…"}}`。runtime.ts 组合为
`withRequestContext(accessLog(routeSpanNames(httpApp)))`。Audit/SignIn 的 traceId
传播不需要新代码:RequestContext.traceId(Phase 1)读的就是这颗 span,写入器
(Phase 2/4)已在读 RequestContext——链上每环都各自有测试。

**测试**:api-kit request.test.ts 的 harness 换上真 OTLP tracer(receiver 3203 端口,
JSON 序列化),新增两条:带 traceparent 的请求导出名为 `GET /things/:thingId` 且
traceId 等于入站值、`http.route` 属性在;未命中路由保持方法名。既有 traceparent
继承测试不动。

**真机闭环**(§27 条 3/4/7):本地栈里 Tempo 的 root span 名全部成为模板——
`GET /api/assessment/batches/:batchId/events`、`GET /health/ready`、`GET /*`(静态
兜底,同样低基数);从生产 JSON 日志抄下 traceId 到 Tempo 查回同一 trace:root
`GET /api/app/manifest` 下挂 `app.getManifest.handler`、`Ui.manifest.build/collect/
viewer` 四个业务 span——HTTP root + Effect 业务 span 一条链(DB 边界归 6.5)。

验收:`pnpm typecheck` 零错;`pnpm test` 824 passed | 17 skipped(新增 2 条);生产
smoke 全过(带/不带 OTEL endpoint 各一遍,退出 0);prettier 通过(未动 web 源,
browser 套件不涉及)。下一步按计划 6.4(业务 span 名清点)或 6.5(数据库边界 span)。

## Effect 基线迁移:4.0.0-beta.103 → 4.0.0-rc.111(2026-08-25)

Effect v4 已进入 RC(官网安装指令即 `effect@rc`,rc tag 停在 rc.111,beta 线停在
beta.107)。在 Phase 6 余下阶段继续之前把 runtime 基线推到 RC,理由:项目已承担
prerelease 风险,留在旧 beta 只是用更旧的 prerelease;RC 阶段以修复为主
(rc.111 含 Effect.fn `{self}` overload 绑定、Deferred waiter 中断恢复、fiber observer
cancellation、finalizer failure 合并等 runtime correctness 修复,对这个大量使用
Effect.fn/结构化并发/Layer 的服务端就是升级理由本身);观测代码从第一天就写在 RC API 上。

**版本策略(写进 catalog 注释)**:基线冻结在 rc.111,此后只按需升级——Qualy 实际
碰到的修复、runtime correctness、stable 发布;不追逐每个 RC。`@effect/tsgo` 是另一条
工具版本线(0.36.4),不随 train 动。

**执行**:catalog 三包(effect、@effect/vitest、@effect/platform-node)与
minimumReleaseAgeExclude 四条(含传递的 platform-node-shared)同切 rc.111;
`pnpm vendor:update` 同步 repos/effect 至 tag effect@4.0.0-rc.111
(commit 648f566d,内容 hash 校验过);逐版通读 beta.104→rc.111 changelog
(不只看 rc.111——真正的断裂常在 beta.104 这种跨段)。

**破坏面:一处改名,4532 个错误全是它的级联**。`Schema.TaggedErrorClass` →
`Schema.TaggedError`(v4 prerelease 线内改名,MIGRATION.md 不载;新签名 identifier
挪到第一段调用,fields/annotations 第三参形态未变,`httpApiStatus` 注解仍在)。
11 个文件 97 处机械改名后 typecheck 从 4532 → 0:其余"错误"(error 类塌成 never 后
i18n 键、typed client、Effect R 通道全部连锁误报)无一真实。**unstable/** 使用面
盘点**:仅 httpapi(33)/http(23)/observability(2)三模块;6.1-6.3 依赖的三处载重
事实在 rc.111 逐一复核仍成立——`HttpRouter` 仍写 `http.route`(rc.110 #7248 动过
tracer/中间件性能,行为未变)、`HttpMiddleware.tracer` 仍从 traceparent 继承、
OTLP span 的 `name` 仍在导出时才读(api-kit 的 pinning 测试在新版本下通过即为证)。

顺带的直接收益:beta.104 修了「OTLP metric export 失败时保留 delta checkpoint」,
正是 6.1 导出器失败语义的一块补强。

验收(全部真实执行):`pnpm typecheck` 零错(effect-diagnostics 门禁确认 tsgo patch
在 rc.111 下仍抓 fixture);`pnpm test` 824 passed | 17 skipped(error-codes、
frozen-routes、OpenAPI 深比较、catalogs 全过);`pnpm test:browser` 116 passed
(exit 0;既知 playwright 收尾 flake 出现一次,重跑两次干净);`pnpm build` 成功;
生产 smoke 全过退出 0;`pnpm vendor:check` 两树一致;prettier 通过。
独立 commit(chore(effect): upgrade v4 baseline to rc.111),与 Phase 6 代码不混。

## 业务 span 清点(OTel 计划 Phase 6.4):全量盘点后的小修(2026-08-25)

按 docs/PHASE6-OPENTELEMETRY-DESIGN.md §11 与 §26 的 6.4,对生产源码全部
`Effect.fn`/`Effect.withSpan` 命名做了一次全量盘点(约 300 处,含 handler 层),
结论:**覆盖面与命名纪律已经达标,需要动的只有四处**。

**盘点结果**:§11.1 点名的每一类操作都已有 span——Iam.users 全生命周期(setStatus
统摄 delete/restore)、Rbac.require/canAt 与 grants.grantRole/revoke、
Assessment.setEntryStatus(submit/withdraw/abandon 一个落点)/decideReview/
appealReview/advancePhase、Storage.prepareUpload/completeUpload 与两个 sweep、
Audit.record、Auth.signIn 全链(resolveProvider/findIdentity/failAttempt/
completeLogin/record)、Auth.resolveSession。命名统一为 `Service.operation`
(服务)与 `domain.op.handler`(handler);**零动态构造的 span 名**(§27.4 的
UUID/动态 URL 红线在源头上就不存在)。四个看似可疑的扁平名(audit.timeBound、
authLocal.login.fail、health.ready、iam.requireUserRead)逐一读过,均为真实边界。

**四处修正**:

- 一个真缺口:`Assessment.patrolReviewRounds`(评审巡逻,调度器的另一半)裸奔,
  补 `Effect.withSpan`——sweepDueBoundaries 早有,巡逻没有,§11.1 的
  「Scheduler.run / boundary processing」至此两翼齐全。
- 三个纯函数退场(§11.2):`Iam.users.requireVersion`(版本比对)、
  `Iam.users.mayAssignType`(字段检查)、`audit.timeBound`(时间戳解析)从
  `Effect.fn` 改 `Effect.fnUntraced`——纯比对/解析不产 span,拒绝落在所属操作
  自己的 span 上。曾用脚本按「函数体只有 typed fail」批量筛,被参数类型注解里的
  花括号大面积误报(Org.createNode 这种真写库的都被标成纯),最终以人工逐个读
  定案——assert 类(assertNoSelfEscalation、roles.assertComplete)都有真查询,
  span 全部保留。

§11.3 的 qualy.* 低风险属性是「允许的示例」而非本阶段清单项,未加;真机验证沿用
6.2/6.3 的 Tempo 证据(业务 span 已在 trace 里挂在 HTTP root 之下)。

验收:`pnpm typecheck` 零错;`pnpm test` 824 passed | 17 skipped;prettier 通过
(未动 web 源)。下一步按计划 6.5:数据库边界 span(pg auto-instrumentation 评估
与 orm.ts 手动兜底)。

## 数据库边界 span 落地(OTel 计划 Phase 6.5)(2026-08-25)

按 docs/PHASE6-OPENTELEMETRY-DESIGN.md §12 与 §26 的 6.5。

**裁决:pg auto-instrumentation 暂不采用**(§12.1 评估后走 §12.3 兜底)。三条理由:
①它要求 `@opentelemetry/*` SDK 家族(TracerProvider + context manager),正是 6.1
裁决不引入的第二套 SDK;②被 patch 的驱动只能 parent 进 OTel context,而本进程的
span 归 Effect tracer 所有,桥接需要 `@effect/opentelemetry` 的 OtelTracer——为一层
驱动 span 引入整个桥是本末倒置;③设计自己就把 Node 24 + ESM + tsx 下的 loader hook
标为不可靠并预设了 fallback。重新评估仅当:驱动级连接获取 span 成为排障必需;
需要安全的按操作/查询摘要而现有 DB 抽象边界拿不到;Qualy 因其他独立理由已引入
OTel JS SDK;Effect/OTel 提供了官方 context bridge;或 ESM instrumentation 已可靠
且被生产入口的 out-of-process 集成测试证明。**DB pool 可观测性不因此延期,归
Phase 6.6**(以 pg.Pool 的文档化公开属性从数据库基础设施层导出)。

**实现**(packages/plugins/infra/database/src/server/orm.ts,全部查询的唯一漏斗):

- `query()` 穿 `db.query` span(kind=client,`db.system.name=postgresql`);
- `transaction()` 只在**真 BEGIN 分支**穿 `db.transaction`(覆盖 begin..commit/
  rollback 全程);join 分支零新 span——加入不是开启,JOIN-EXISTING 语义分毫未动;
- 有意不带 SQL text/参数/行数据:此边界只见 opaque thunk,§21 的禁令在结构上成立。

**测试**(tracing.test.ts,2 条,真 postgres):recording tracer(上游文档的
`Tracer.make` + `NativeSpan` 收集模式,零端口占用)断言:db.query 带属性、kind 与
正确父 span;真事务单 span、其内两次查询(含一次嵌套 join 调用)都是 db.transaction
的子且**只有一个** db.transaction——tracing 与事务传播互不破坏由同一条测试钉住。

**真机闭环**:本地栈 + 生产 smoke,TraceQL `{name="db.query"}` 查到:请求 trace
`GET /api/assessment/batches/:batchId/events` 的 root 之下挂 db.query(§27.3 的
HTTP root + 业务 span + DB 边界三层,结合 6.3 的 handler 证据齐备);另有 boot 期
迁移检查与后台巡逻的独立 db.query/db.transaction root。注:Tempo 的 tag 式
search 参数查不到 span 名,TraceQL 才是对的查法(踩过)。

验收:`pnpm typecheck` 零错;`pnpm test` 826 passed | 17 skipped(新增 2 条);
prettier 通过;生产 smoke(带 OTEL)退出 0。下一步按计划 6.6:Metrics(HTTP RED、
runtime、DB pool、第一批业务指标与 cardinality guard)。

## Metrics 落地(OTel 计划 Phase 6.6):RED、runtime、DB 与第一批业务指标(2026-08-25)

按修订后的 docs/PHASE6-OPENTELEMETRY-DESIGN.md §13 与 §26 的 6.6,零新依赖
(全部经 Effect Metric registry,由 6.1 的 OtlpMetrics 导出)。四个交付面:

**① HTTP RED**:一个 histogram 就是全部——`http.server.request.duration`(stable
semconv 名,semconv 桶,单位 s;count 即请求率,status 标签分出错误率,桶即延迟
分布)。api-kit 新 serve 中间件 `httpMetrics` 记录,标签只有三个来源都低基数:
`http.request.method`(解析器有界集)、`http.response.status_code`、`http.route`
(**只来自 router 写在 span 上的模板**;未命中路由不发明标签而是省略;event stream
排除——那是连接寿命不是延迟,一个挂着的 tab 会独占 p99)。实测标签集:
`GET /api/assessment/batches/:batchId/events`、`POST /api/auth/local/:providerCode/login`、
`GET /*`(静态兜底,UUID 路径落在这里而非原始 URL)。

**② runtime**:数据源全部是稳定 Node API,零 instrumentation 包——
`process.cpuUsage`(→ process.cpu.time counter,user/system 差分)、
`process.memoryUsage`(→ process.memory.usage、v8js.memory.heap.used,单位 By)、
`perf_hooks.monitorEventLoopDelay` + `eventLoopUtilization`
(→ nodejs.eventloop.delay.mean/.max、nodejs.eventloop.utilization)。15s 轮询
fiber 由 telemetry layer fork,随其 scope 消亡;GC 指标显式不做(要额外
PerformanceObserver 订阅,等真有人分析 GC 再说)。

**③ DB**:`db.client.operation.duration`(stable semconv)直接记在 `query()` 漏斗
(Effect.trackDuration,成败都计——失败的查询同样占用了连接)。pool 指标经
**MikroORM 7.1.13 的公开钩子 `driverOptions.onPoolCreated`** 拿到 pg.Pool,读的
全是 pg 文档化公开属性:`idleCount`/`totalCount`/`waitingCount` →
`db.client.connection.count{state=idle|used}`、`db.client.connection.pending_requests`
(这两个语义约定仍是 Development 状态,已注明)。**明确不做的**:acquisition
wait time——需要包 acquire 路径本身,按 §12.1 那是重评触发条件而不是 hack 的理由。
两个实战教训:(a) v7 的 `MikroORM.init` 不连接,pool 懒建,轮询每拍重读槽位而非
构建期判定;(b) **pool 采样改用 node timer(unref)+ `updateUnsafe` 携带构建期
context,故意脱离 ambient Clock**——最初的 Effect.sleep 轮询 fiber 在 scheduler
测试套件里把 TestClock 的静默等待锁死(5 条测试超时),二分定位后改为墙钟采样,
这也更诚实:采样节拍本就属于墙钟域。

**④ 业务指标 + cardinality guard**:@qualy/telemetry 新 `./metrics` 叶子,
`boundedCounter`/`boundedDurationHistogram`——每个 label key 与允许值先声明,
编译期是字面量联合(带 `string & {}` 通道容纳驱动类型这类动态但受 clamp 的来源),
**运行期不在允许列表的值一律 clamp 成 'other',未声明的 key 直接丢弃**。第一批:
`qualy.auth.sign_in{outcome,provider_type}`(sign-in record 单点,双结局)、
`qualy.assessment.entry.submit{outcome=success|refused}`(setEntryStatus 外围,
defect 不计入业务数)、`qualy.assessment.review.decision{decision}`、
`qualy.scheduler.run.duration/.failure{job=phase-sweep|review-patrol}`、
`qualy.storage.operation.duration/.failure{operation}`(9 个操作枚举,service 与
cleanup 的 withSpan 旁同点包裹)。counter 带 `incremental: true`(单调 → OTLP
monotonic sum → Prometheus `_total`)。

**guard 的证明**(不是承诺):telemetry 3 条单测把 UUID、`DROP TABLE`、原始
URL、未声明的 userId/tenantId 喂进构造器,读回 registry 断言只剩 'other' 与声明
键;api-kit 1 条测试打真请求(含 UUID 路径与 404)后快照断言:`http.route` 只含
模板、任何标签不含 UUID、标签键集封闭、404 无 route 标签。

**真机闭环**(Prometheus 查回):`http_server_request_duration_seconds_*` 三路由
标签集零 UUID;`db_client_operation_duration_seconds_*`;
`db_client_connection_count{db_client_connection_state=idle|used}` 与 pending
(修了两次命名:unit 属性是 effect 导出器声明 OTLP unit 的通道,不声明时 unitless
gauge 会被 Prometheus 加 `_ratio` 后缀——内存 gauge 补 `By`、连接 gauge 补
`{connection}`/`{request}` 花括号单位后缀消失);`qualy_auth_sign_in_total
{outcome=failure,provider_type=local}=1`(真实失败登录);runtime 全家
(`process_cpu_time_seconds_total`、`process_memory_usage_bytes`、
`nodejs_eventloop_*`);scheduler 与 storage duration 直方图。

验收:`pnpm typecheck` 零错;`pnpm test` 830 passed | 17 skipped(新增 6 条);
生产 smoke(带/不带 OTEL)退出 0;prettier 通过(未动 web 源)。下一步 6.7
(生产 Collector:腾讯云 APM/TMP 路由)或 6.8(CLS 日志关联)。

## 6.6 语义约定修正(2026-08-25)

审阅指出 6.6 有六处对当前 OTel Semantic Conventions 的偏差,补一笔修正
(架构不动,不引入任何 @opentelemetry 包):

- **HTTP RED 对齐 stable semconv**:补 Required 的 `url.scheme`(与 trace 同源,
  从 server span 已写的属性读取,一个来源两处答案不可能分叉);未知 method 归一
  `_OTHER`;5xx 补 conditionally-required 的 `error.type`(状态码字符串);
  **SSE 回归计数**——标准指标定义没有流式豁免,「count 即请求率」重新成立,
  普通 API 延迟看板按 `http.route` 排除流式路由,而不是记录器按 content type
  篡改标准指标的含义。一处按事实记录的偏离:semconv 要求
  `http.response.status_code` 为 int,而 rc.111 的 `Metric.AttributeSet` 是
  `Record<string, string>`——数字相同,Prometheus 路径的标签本就是字符串,
  OTLP int 类型等上游。
- **DB pool 改 UpDownCounter + 必填 `db.client.connection.pool.name=primary`**:
  非增量 effect counter 导出为非单调 sum,采样器喂差分,累计值即池的当前数——
  标准名与标准 instrument 语义不再错配。真机验证:
  `db_client_connection_count{db_client_connection_state=idle|used,
db_client_connection_pool_name=primary}`。
- **DB operation duration 失败路径补 `error.type`/`db.response.status_code`**:
  复用 pg-errors 的 cause 树解包取 SQLSTATE(五位、有界词表,`^[0-9A-Z]{5}$`
  校验),非法或缺失时 `error.type=QueryFailed`;永不带 message。
- **runtime 两处标准名纠正**:`process.memory.usage` 改 UpDownCounter(差分喂
  非单调 sum,真机报 rss 绝对值正确);heap 总量**不再冒充** `v8js.memory.heap.used`
  (那个约定按 heap space 计量、要求 `v8js.heap.space.name`),改名
  `qualy.runtime.heap.used`;Resource 补 `process.runtime.name=nodejs` 与
  `process.runtime.version`。
- **`monitorEventLoopDelay` 补 finalizer**:acquireRelease 配对 enable/disable,
  telemetry scope 关闭时停止采样而不是弃置。
- **storage failure 计 defect**:`qualy.storage.operation.failure` 从 tapError
  改为按 Exit 判定(非成功且非纯 interruption 都计)——运维指标里崩溃比 typed
  拒绝更是 failure;`entry.submit` 的业务 outcome 指标保持不计 defect,那是
  另一回事。

顺手核实了审阅提出的 unit 疑点:effect 导出器确实把 metric 的 `unit` 属性
**同时**用作 OTLP instrument unit 与 datapoint attribute——每个系列多一个常量
`unit="s"` 标签(真机标签键集:method/status/route/url_scheme/unit + resource
标签),低基数、无害、已知。guard 的编译期文字联合本质上因 `string & {}` 而弱,
真正的防线是 runtime clamp 与测试(审阅认可);拆「字面量来源/动态来源」双 API
留作后续。

验收:`pnpm typecheck` 零错;`pnpm test` 830 passed | 17 skipped;受影响五套件
166 passed;生产 smoke 退出 0;prettier 通过;真机 Prometheus 复验上述全部修正。

## 生产 Collector 落地(OTel 计划 Phase 6.7):腾讯云路由(2026-08-25)

按修订后的 docs/PHASE6-OPENTELEMETRY-DESIGN.md §16-§18 与 §26 的 6.7。应用侧零改动
——vendor boundary 不破:Qualy 进程始终只认 `127.0.0.1:4318`,腾讯云只存在于
`ops/observability/collector.production.yaml` 与部署 secrets。

**配置**(全部在 pin 定的 0.159.0 镜像内 validate 通过,不抄旧文档字段):

- receivers 只绑 `127.0.0.1`(与本地配置的 `0.0.0.0` 不同——生产 collector 与
  server 同机,回环即边界);health_check 13133。
- **traces → 腾讯云 APM**:otlp gRPC 出口;`resource/tencent_apm` processor 在
  trace pipeline 上注入 APM 要求的 `token` 与 `host.name`(与应用 resource 同一
  `QUALY_INSTANCE_ID`)——应用永不携带;私网 endpoint 走明文 gRPC
  (`tls.insecure: true`,console 若发 TLS endpoint 则去掉,注释写明)。
- **metrics → 腾讯云 TMP**:`prometheusremotewrite`(组件真名;设计文档旧写法
  `prometheus_remote_write` 不是 0.159 的组件名),HTTP client 配置按 0.159 推荐
  放进 `http:` 块(旧平铺形态仍 validate、无弃用告警,实测两种都过,采用前瞻
  形态);Bearer token、external_labels service/environment、
  `resource_to_telemetry_conversion: false`。
- 五个环境变量(APM endpoint/token、TMP url/token、QUALY_INSTANCE_ID)只经
  `${env:...}` 引用;**初期无 sampling**,traces pipeline 注释标出未来
  `tail_sampling` 的插入位(memory_limiter 与 resource 注入之间)与目标比例。

**验证**:validate 通过之外,还带假 endpoint 真启动了一次——`Everything is
ready`,APM 不可达是后台 gRPC 重试告警而非启动失败(§22 语义在 collector 侧
同样成立)。

**新门禁**(tools/tests/observability.test.ts,§25 的 grep/lint 落地):生产配置
携带值的行(attribute value、Authorization)必须是 `${env:...}` 引用,字面 token
进不了仓库;本地配置的非注释部分不得出现 tencent 与 env 引用;compose 里的
observability 镜像必须 pin 精确版本(latest 直接红)。README 补生产节:env 契约、
`--network host` 运行方式、health 探针、升级时双配置的复验命令。

真实云端联调(拿真 token 发真 trace/metrics 进 APM/TMP、CLS 按 traceId 检索)
属 §27 条 9-11,归 6.9 的 staging 验证——那一步需要真实凭据,不在本仓库完成。

验收:`pnpm typecheck` 零错;`pnpm test` 833 passed | 17 skipped(新增 3 条门禁);
prettier 通过;collector validate + 真启动实测。下一步 6.8:CLS 日志关联(logger
边界统一注入 request_id/trace_id/span_id 顶层键)。

## CLS 日志关联落地(OTel 计划 Phase 6.8):每行日志的 trace 归属(2026-08-25)

按修订后的 docs/PHASE6-OPENTELEMETRY-DESIGN.md §14/§19 与 §26 的 6.8。不换
Pino/Winston,不启用 OTel Logs SDK,改动全部在既有 logger 的渲染边界。

**核心**:关联从「access log 一条手工注解」升级为「每行 JSON 的顶层键」——
`request_id` / `trace_id` / `span_id` 由 qualyLogger 在**发射点**从说话的 fiber
读取(`fiber.context` 取 RequestContext、`fiber.currentSpan` 取当时最内层 span,
Fiber 接口公开属性,实查 Fiber.ts:80)。于是业务 child span 里的日志带的是**那颗
span 的 id**,不再永远是 HTTP root 的;调用方零改动,不需要手动 annotateLogs。
无请求/无 trace(noop 哨兵)时键缺席,不伪造。顶层键(snake_case)是为 CLS
键值索引直达设计的,与腾讯云 APM ↔ CLS 按 TraceID/SpanID 关联的查询方式对齐。

**access-log 随之减负**:6.3 加的 requestId/traceId/spanId 手工注解拆除(logger
已知道的事中间件不再复述),annotations 回到只有 source;dev pretty 行也因此
不再拖 trace id 尾巴。pretty 格式不注入关联——那是给终端读者的。

**测试**(logging.test.ts +1):双层嵌套 span 内发日志,断言 JSON 行的
trace_id/span_id **精确等于内层 span**(`Effect.currentSpan` 取证,名字
business-operation),request_id 等于所提供的 RequestContext;请求外的行三键
全部缺席。**真机**:生产 JSON 实测
`{"request_id":"a265…","trace_id":"dbc2…","span_id":"2741…","message":"GET
/api/app/manifest 200 2ms"}`,且该 trace_id 在 Tempo 查回同一条 trace(root +
handler + Ui.manifest 三业务 span)——日志↔trace 闭环。

**文档**:ops README 新 CLS 节(stdout/文件采集契约、LogListener JSON、键值索引
恰好七个字段、15 天保留、无全文索引起步);设计文档 §9.3 样例与 §19 索引字段表
同步为顶层 snake_case 键。腾讯云真实 APM→CLS 跳转验证需真实凭据,归 6.9。

验收:`pnpm typecheck` 零错;`pnpm test` 834 passed | 17 skipped(新增 1 条);
生产 smoke 退出 0;prettier 通过(未动 web 源)。Phase 6 余下 6.9:本地
walkthrough 已零散完成,staging/腾讯云端到端与 dashboard 待真实凭据。

## 浏览器不再宣告它永远不会讲述的 trace(2026-08-25)

真机排查定位:前端 typed client 走 Effect `FetchHttpClient`,其 client tracing 为
每个出站请求建 `http.client` span,且 `HttpClient.TracerPropagationEnabled` 缺省
为 true(实查 HttpClient.ts:1615-1617,缺省 constTrue;:698-700 把 span 写进
`TraceContext.toHeaders`,rc.111 同时产 `traceparent` 与 `b3`)。而 Browser
RUM/export 是 Phase 6 明确非目标——于是「建 span ✅ 传播 ✅ 导出 ❌」三件套缺一角:
服务端如实继承了一个永远不会被上报的 parent,Tempo 显示
`<root span not yet received>`,上生产就是 APM 里成片的 orphan trace。

**修复**(packages/web/runtime/src/api.ts,只动浏览器 client,服务端入站不动):
`clientFor` 经 `HttpApiClient.make` 的 `transformClient` 给 client 包
`HttpClient.transformResponse(Effect.provideService(TracerPropagationEnabled,
false))`——与上游 OtlpExporter 给自己关传播的形态同款(传播判定在请求时 fiber 上
getRef,构造期 Effect.provide 够不着,必须烘进 client 管线)。服务端继续接受
traceparent/b3:反向代理、worker、未来的 Browser RUM 都是合法的远端 parent 来源;
届时把这里重新打开,client span 就成为真正的 root。理由整段写在代码注释。

**测试**(packages/web/runtime/tests/propagation.test.ts,2 条,经 `FetchHttpClient.
Fetch` reference 注入捕获 fetch,零网络、纯 DOM 类型):`clientFor` 的请求在活跃
span 之下**既无 traceparent 也无 b3**;**control 反证**——默认 client 同一环境下
两个头都在(traceparent 格式断言),证明缺席是 clientFor 的作为而非 tracing 整体
关闭。服务端入站继承的既有测试(api-kit:显式 traceparent 被尊重、导出 trace id
等于入站值)原样保留,继续守护另一半契约。

验收:`pnpm typecheck` 零错;`pnpm test` 836 passed | 17 skipped(新增 2 条);
`pnpm test:browser` 116 passed(一次既知 flake,重跑 exit 0);`pnpm build` 成功
(web bundle 已含修复);生产 smoke 退出 0;prettier 通过。浏览器侧最终确认
(Brave 发请求无两头、Tempo root 完整)留给真实浏览器一次点击。

## 腾讯云 staging 第一步(OTel 计划 Phase 6.9):本地 → APM trace 上行(2026-08-25)

渐进接入的第一步,最小改动、不动任何已工作的东西:`collector.local.yaml` 与本地
LGTM 栈原样;新增 `collector.staging.yaml` = 本地全链路 + traces 双写(本地 Tempo

- 腾讯云 APM 公网 OTLP gRPC/TLS `ap-beijing.apm.tencentcs.com:4320`,token 走
  `authorization` header)。metrics 第一步仍纯本地;APM→TMP 指标同步归控制台配置;
  `10.20.0.11` 的 VPC 内网 remote write(collector.production.yaml)等真有 collector
  站进 VPC 再启用,本地永不直连。

**凭据边界**:token 只进 collector 容器——独立的 `ops/observability/collector.env`
(gitignored,新增显式条目;tracked 的 `.example` 只有变量名与空值),compose 经
`env_file: required: false` 喂给 collector 服务;应用进程的 `.env` 不放它,Qualy
进程环境里永不出现 vendor credential。配置切换经 compose 插值变量
`QUALY_COLLECTOR_CONFIG`(非机密,缺省 `collector.local.yaml`),实测双向插值正确。

**验证已做**(占位 token):staging 配置在 pinned 0.159.0 镜像内 validate 通过;
真启动后 collector healthy、生产 smoke 全过、**本地 Tempo 照常收到 trace**(双写
互不拖累);APM 上行实测打到腾讯服务端并收到 `No Data Report` 应答——即
DNS/TLS/gRPC/authorization header 全链路已通,只差真实 token(错误是 Permanent、
被丢弃,不阻塞本地信号)。门禁扩展:staging 配置纳入「凭据只能 env 引用」规则,
新增「collector.env 必须被 gitignore、example 的 secret 值必须为空」断言。

真实 token 验证、APM→Prometheus 关联与指标同步规则、腾讯云 Grafana 关联由用户在
控制台侧完成;第二步(metrics 经 APM 公网上报)待 trace 确认后再动。

验收:`pnpm typecheck` 未涉及(零 TS 源改动,门禁测试除外);`pnpm test`
837 passed | 17 skipped(observability 门禁 4 条);prettier 通过;compose 插值、
staging validate、真启动、本地栈完好性全部实测。

## 腾讯云 staging 第二步(OTel 计划 Phase 6.9):metrics 经 APM 公网上行(2026-08-25)

APM trace 已在控制台确认、APM↔TMP(qualy-staging)已绑定后,staging 配置的
metrics pipeline 加上既有的 APM exporter——本地链路原样,双写:
本地 LGTM 照旧,APM 公网 OTLP 同批送达,控制台的指标同步规则决定什么继续进 TMP;
本地永不直连 `10.20.0.11`。真机验证:collector 重建后 healthy,完整导出周期
(60s+)**零错误**(真 token 下 APM 接受 metrics),本地 Prometheus 照常收数。

顺手修正:0.159 弃用了 exporter 类型别名 `otlp`,三份 collector 配置统一改为
`otlp_grpc/*`(行为不变;各自在 pinned 镜像内 validate 通过,重启后告警消失)。

首轮同步建议(低基数):`process.cpu.time`、`process.memory.usage`、
`qualy.auth.sign_in`;直方图(http.server.request.duration 等)桶展开系列多,
留第二轮。

验收:`pnpm test` 837 passed | 17 skipped;prettier 通过;三配置 validate;
collector 无错运行、本地链路完好实测。

## 腾讯云 staging 第三步(OTel 计划 Phase 6.9):logs 经 CLS 原生 OTLP(2026-08-25)

修正此前判断:CLS 已原生支持标准 OTLP/HTTP 上报,LogListener/机器组整条路线作废,
日志走与 traces/metrics 同一个 collector。设计文档 §19 已改写。

**应用侧**(sdk.ts 一处):telemetry 层加 `OtlpLogger.layerFromConfig`。**opt-in
钉死**——不为 OTEL_LOGS_EXPORTER 铺缺省,不设即零导出;`mergeWithExisting: true`,
stdout JSON logger 照常是主日志面。上游 LogRecord 原生带发射 fiber 的
TraceId/SpanId(实查 OtlpLogger.ts:230-233,与 6.8 stdout 顶层键同语义),关联
能力零重复实现;annotations(source)、fiberId、cause(log.error)进 attributes,
resource 与 tracer/metrics 共用。

**collector**:local 加 logs pipeline(LGTM 原生吃 OTLP logs 落 Loki);staging
logs 双写 Loki + `otlp_http/tencent_cls`(CLS 公网 base endpoint,exporter 自动拼
/v1/logs)。**Basic Auth 经 contrib 0.159 自带的 basicauth extension**,SecretId/
SecretKey 从 collector.env 注入,不手工 Base64;topic 经 `topic_id` header。
所有 env 引用带缺省值(`:-unset`)——**CLS 变量未填时 collector 照常启动**,
CLS 出口运行期 401、按 exporter 独立丢弃,已验通的 traces/metrics 分毫不动
(三场景 validate:全变量/缺变量/local 均过)。

**验证**:collector 原地重建 healthy;真跑服务器(OTEL_LOGS_EXPORTER=otlp)后
**Loki 实收**,流标签带 trace_id/span_id/severity_text/service_name;CLS 线路
打到 `https://ap-beijing.cls.tencentcs.com/v1/logs` 收 **401**(空凭据的预期
应答;无 404,路径拼接正确,DNS/TLS/Basic-Auth header 全链路已通,只差真实
SecretId/SecretKey/topic_id)。新测试 +1(telemetry 套件):logs 不设开关零导出;
设开关后导出的 record 的 traceId/spanId **精确等于**发射时的 span。门禁扩展:
username/password 行纳入「只能 env 引用」规则。

**已知缺口(记录,不在本步修)**:OTLP record 的 attributes 来自 log annotations,
`request_id` 只在 stdout JSON 顶层键——CLS↔审计暂经 trace_id 关联;若要 request_id
进 CLS,在 requestContext 中间件 annotateLogs 一行即可,等真实需要再加。

验收:`pnpm typecheck` 零错;`pnpm test` 838 passed | 17 skipped(新增 1 条);
prettier 通过;三配置 validate、collector 重建、Loki 实收、CLS 401 全部实测。

## CLS 真凭据联调通过,一处真实兼容性修复(2026-08-25)

真实凭据下的错误阶梯:401(空凭据)→ 404(topic 建错地域,用户重建)→ 400
InvalidArgument。逐层排查定位:curl 直发实证 CLS 的 OTLP 端点**只收 protobuf**
(json content-type 直接拒);用 effect 自己的 OtlpSerialization.layerProtobuf
造合法 payload 直发 → 200;回放应用真实导出的整批 payload → 全 200;最后用
gzip 变体复现 400——**CLS 无视 `Content-Encoding: gzip`,对压缩字节直接做 proto
解析**,而 collector 的 otlp_http exporter 默认开 gzip。修复一行:CLS 出口
`compression: none`(注释记下探针证据)。重建后完整导出周期零错误,Loki 双写
不受影响。APM/TMP/CLS 三信号至此全部真凭据验通;探针 trace
`09492bb4a826527141d29bc1e460c01b` 可在 CLS 按 TraceId 检索对账。

## Phase 6.9 收口:腾讯云联调验收完成(2026-08-25)

本条是 Phase 6(OpenTelemetry)的验收记录,以下事实由用户在腾讯云控制台人工确认

- 本地自动化复核,不再是计划:

**已完成**:

- 本地 observability 栈(collector 0.159.0 + LGTM:Tempo/Prometheus/Loki/Grafana);
- traces → Tencent APM(公网 OTLP gRPC/TLS):完整 HTTP/业务/DB span,失败登录的
  INVALID_CREDENTIALS 与 401 状态正确;
- metrics → APM → TMP:`qualy_auth_sign_in_total` 在云端 Grafana 可查,
  outcome=success|failure、provider_type=local 标签正确,APM 附加的
  apm_instance/apm_service_name/region 标签正常;
- logs → CLS(公网 OTLP/HTTP protobuf,Basic Auth + topic_id header);
- 三信号全部本地+云**双写**,本地 Tempo/Prometheus/Loki 全程不受影响;
- APM ↔ CLS 关联验通:APM trace 详情直接展示对应 span 的 CLS 日志,
  TraceId/SpanId 两侧一致;
- 真实凭据 smoke、三份 collector 配置 pinned 镜像 validate、全量回归。

**实现细节(真实联调发现)**:CLS 的 OTLP/HTTP 当前对 gzip payload 返回 400
(无视 Content-Encoding、对压缩字节直接 proto 解析;curl 探针:identity 200、
gzip 400),CLS exporter 因此 `compression: none`,未压缩 protobuf 已真实验证
成功。此为当次联调实测行为,不构成对腾讯云产品的长期保证。

**最终回归**(全部真实执行):typecheck 零错;`pnpm test` 838 passed | 17
skipped;`pnpm test:browser` 116 passed;`pnpm build` 成功;生产 smoke 退出 0;
`pnpm vendor:check` 两树一致;`prettier --check .` 通过;三配置 validate 通过;
collector 运行日志零 deprecation。仓库无独立 lint/e2e 脚本(prettier 与生产
smoke/浏览器套件即其等价物)。最终 acceptance:staging 配置 + 真凭据下完整导出
周期,云出口(APM×2 + CLS)**零 error/retry/drop**,本地三信号同期实收。

**剩余(标记,不在本轮执行)**:
`remaining: real cloud staging deployment / in-VPC production path verification`
——collector.production.yaml 的启用、TMP private remote write(10.20.0.0/16 内网)
与生产 boot 路径验证,须等真实 staging 服务器存在。定制 dashboard 与告警属后续
沉淀项(§23 的查询能力已由 LGTM Drilldown 与 TMP/云端 Grafana 覆盖),不阻塞
6.9 验收。secret 状态:真实凭据仅存于 gitignored 的 collector.env,tracked
文件/文档/测试均无。

## UI 平台 pivot:PrimeReact 实验冻结,Mantine 底座就位前的 salvage(2026-08-26)

裁决与全案见 [ADR 0010](docs/adr/0010-ui-widget-platform.md) 与 docs/ui-platform-migration-mantine.md。

- **PrimeReact 11 实验冻结**:分支 `ui-platform` 推进到 overlay 家族中途后中止,未提交
  的中间态以 wip commit 封存于 c0b51d7b,打只读 tag `ui-prime-m4-checkpoint`;实查
  事实(NodeNext 类型分发失效、trigger 缺 type="button"、compound 层不自足、CSS 层
  序陷阱、主题渗漏等)存 docs/notes/primereact.md,原设计文档 docs/ui-platform-migration.md
  加 superseded 标注后历史保留。
- **新分支 `refactor/ui-mantine` 建自真实迁移基线 af2c71ab**(= main HEAD,main 期间
  未动),不含任何 Prime 依赖与残留;Prime 分支只作 salvage 来源,按 KEEP/PORT/DROP
  逐项甄别,不做整体 merge。
- **salvage 落地(6 个提交)**:①StyleX 工具链(@stylexjs/stylex+unplugin 0.19.0 进
  catalog、unref patch、vite/vitest 双管线接线、tokens.stylex.ts + `--q-*` 语义
  token 层);②StyleX 探针组件与浏览器测试;③admin.tsx/screen.tsx 单文件拆为
  admin/、screen/ 目录(纯重排,shadcn 实现原样);④`--q-*` token 引入(shadcn 变量
  改为别名指向);⑤供应商中立的组件契约测试(overlay 六场景、button、checkbox 玻璃态
  与灰阶钉、theme 探针、date-time-picker、shell)——业务断言不绑库 DOM 形状,已在
  Radix 基线上全绿;⑥本文档组(Mantine 设计文档、ADR 0010、历史文档回收)。
- **验收(全部真实执行)**:`pnpm typecheck` 零错误;`pnpm test` = Test Files 123
  passed | 3 skipped,Tests 838 passed | 17 skipped;`pnpm test:browser` = 19 files
  / 129 tests 全通过;`pnpm build` 成功(staged 89 files precompressed)。残留扫描:
  docs 之外源码零 primereact/@primeuix/VITE_PRIMEUI 引用,pnpm-lock.yaml 零命中。
  M3M(Mantine 底座接入)未开始,按设计文档等待下一阶段指令。

## UI 平台 M3M:Mantine commodity primitives 落地(2026-08-26)

设计见 docs/ui-platform-migration-mantine.md 的 M3M 节;裁决背景见 [ADR 0010](docs/adr/0010-ui-widget-platform.md)。分支 refactor/ui-mantine,共 9 个提交(6a71f64a…1c7a8b3b)。

- **基座**:@mantine/core + @mantine/hooks 9.5.2 进 catalog,仅 @qualy/ui 消费;layered
  distribution(styles.layer.css,全部规则在 `@layer mantine`)。**层序单点声明**
  `theme, base, mantine, components, utilities, priority1..5`,三处同步(index.html 首
  元素 / app.css / 浏览器测试 setup)——实测踩到层序首声明陷阱:dev 下 StyleX 的
  transformIndexHtml link 先于 app.css 声明 priority 层,把 StyleX 压到 mantine 之下,
  显式全序声明后 StyleX-over-Mantine 契约转绿。
- **主题桥**:@qualy/ui/provider 的 `UiProvider({scheme})` 挂 MantineProvider,
  `forceColorScheme` 跟随产品 ThemeProvider 的 resolved,零自有主题状态(测试断言无
  mantine localStorage 键);qualyMantineTheme 只做系统级最小面——产品字体、radius md、
  36/32/24/40 控件节奏(theme vars resolver)、`variantColorResolver` 以 q-* 变体名全量
  映射 --q-* token(light/dark 随 token 自翻转);cssVariablesResolver 把 Mantine 语义
  变量(text/surface/border/placeholder/error/disabled)与其控件用到的灰阶指向产品
  token,压掉原生灰阶的蓝调。
- **八件迁移,公共 API 不动**:Button(变体/尺寸词表、asChild 经 renderRoot 多态、icon
  尺寸走 ActionIcon、form 内默认 type=button)、Input/Textarea(原生 props 直达 input,
  className 仍作用于 input 元素,新增 wrapperClassName 逃生口;aria-invalid 桥到 error
  通道)、Checkbox(checked/'indeterminate' + onCheckedChange над原生 input,mixed=原生
  indeterminate)、RadioGroup(原生同名 radio,方向键/radiogroup role 平台自带)、
  Badge/Skeleton/Separator。calendar 留 shadcn 配方为局部私有;input-group 直接子选择器
  放宽为后代。
- **用户目检抓到三处回归,已修并钉进 commodity 契约**:①控件内 icon 失去尺寸约束按自身
  24px 裸跑(components 层恢复 16/12px 几何 + size-* 逃生口);②Badge 内容折行(label 是
  普通块 + preflight 把 svg/flex span 变块级;label 改 flex 行);③禁用态蓝调(disabled
  变量并入 token 桥)。
- **新契约**:widget-platform(主题桥双侧同步 + 无第二存储;StyleX 无 !important 压过
  mantine 层)、form-controls(checkbox 受控/mixed/Space/label;radio 方向键与禁用;
  input 的 label/FormData/ref/aria-invalid)、button 表单安全(非显式 submit 不提交)。
- **依赖修正**:apps/web 补 @stylexjs/stylex devDependency——测试直接 import 它,pnpm
  隔离下未声明的解析靠优化缓存侥幸,冷缓存即断。
- **验收(全部真实执行)**:`pnpm typecheck` 零错误;`pnpm test` = 838 passed | 17
  skipped;`pnpm test:browser` = 21 files / **142 passed**(P0 基线 129 + 新增 13,无删
  除无弱化);`pnpm build` 成功(staged 89 files precompressed);`prettier --check`
  通过(唯一告警是未跟踪的本地 .mcp.json,不入库)。Prime 残留:源码零引用。
- **明确未做(等下一阶段)**:M4M 的 overlay 家族;@mantine/dates(日期/日历族仍是
  Radix/shadcn 基线,是否换 @mantine/dates 是 M4M 前的待裁决项);Radix Slot 已从
  Button 退场但包依赖仍在(其余未迁组件在用)。

## UI 平台 M4M:overlay 家族落上 Mantine(2026-08-26)

设计见 docs/ui-platform-migration-mantine.md 的 M4M 节。分支 refactor/ui-mantine,7 个提交(9e2562ea…adc078d3)。@qualy/ui 公共边界不动,业务零 Mantine 泄漏。

- **七件迁移**:Tooltip(compound→单组件收集,focus 也触发,带箭头)、Popover(Target/Dropdown
  对映;受控根补 click toggle——库只给非受控接;`withRoles` 会覆写触发器 id 切断 label-for,
  关掉后 aria/tabIndex 由适配器自持)、Dialog/AlertDialog(Modal compound;alertdialog role 与
  aria-describedby 经稳定身份 ref 回调写属性——库在 props 展开后硬编码这两项,且 ref 身份不稳
  会让 focus trap 每次渲染抢焦点,两条候选 upstream issue)、Sheet(Drawer 四向;PhotoView 共存
  经 body MutationObserver 喂 closeOnEscape)、DropdownMenu(Menu 全对映含 Sub/Radio/Checkbox
  items)、Select(Combobox children 注册,无数组/索引反查;唯一派生结构是关闭态触发器回显)。
- **产品自有 a11y 层**:modal 开启时背景(页面 + 叠层时下层 modal 的 portal 分支)标
  `inert` + `aria-hidden`(lib/inert-background.ts,引用计数)——旧底座内建的行为,Mantine 只
  trap 焦点不隐藏背景,补齐后跨层 role 查询与点击语义与 Radix 时代一致。
- **嵌套 Escape 统一机制**:内层 overlay 处理完的 Escape 在层内截断传播(Modal 的 window 监听
  按 target 的 data-mantine-stop-propagation 忽略 + 层内 stopPropagation),Dialog→Popover 与
  Dialog→Select 一次一层,契约钉死。
- **入场动画归 CSS 插入动画**(components 层):库的 transition 机对"挂载即 open"判 entered,
  按需挂载的申报弹窗曾无入场——keyframe 对每次插入统一生效,出场仍归库;两者都俯首
  prefers-reduced-motion,theme 同步开 respectReducedMotion。用户目检抓的三处(弹窗未居中/
  侧拉位置错=className 被复制到定位 inner,改走 classNames.content;入场丢失)全修并覆盖。
- **modal-guard 删除**:releaseStuckBody 是 Radix dismissable-layer 记账竞态的补丁,守它的回归
  契约(双 modal 交接不留死 body)在新底座上继续绿,守卫单独一笔退场。
- **新契约 12 条**(overlay-widgets):菜单方向键/Enter/Escape/焦点归位/禁用项;tooltip 键盘
  焦点 + describedby;select 表单内不误提交/回显/键盘走查;Dialog↔Select 逐层 Escape;dialog
  的 title/description/aria-modal;alertdialog 落焦安全键;sheet 三向停靠/scroll lock/焦点归位。
- **验收(全部真实执行)**:`pnpm typecheck` 零错误;`pnpm test` = 838 passed | 17 skipped;
  `pnpm test:browser` = 22 files / **154 passed**(M3M 基线 142 + 12,零删除零弱化);
  `pnpm build` 成功;生产 smoke 全过(探针/壳/manifest/brotli 资源/SIGTERM 退出 0)。
- **Radix 现状**:overlay 七件的 radix 依赖已无消费者但包共享(radix-ui umbrella 仍被
  avatar/breadcrumb/tabs/collapsible/scroll-area/toggle/hover-card/label 等未迁件使用,M9 清
  场);日期族(C 类)未动,@mantine/dates 未引入,取舍待单独 ADR。

## UI 平台跟进:Select 触发器归原生面,浏览器套件改为「有样式断言」(2026-08-26)

- **Select 触发器去 shadcn 配方**(16f27fbe):InputBase over button、库自带 chevron 与
  placeholder 声部、尺寸走 input 档、aria-invalid 桥 error 通道;调用方 className 落
  wrapper(全部调用点都在用它定宽);选项行只留结构(预留指示器席位),hover/active/禁用
  归库。三浮层关 hideDetached(触发器滚出视野不再拉黑打开的列表——旧底座从不如此)。
- **测试基建大修**(a0c05eb2):①harness 加载真实 app.css——裸奔断言的是用户永远见不到的
  页面,本轮连续三个真 bug(hideDetached 拉黑、图标遮盖、响应式藏元素)都是它捂出来的;
  ②套件默认桌面视口 1280×800,手机流测试自声明;③「可见实例」定位(clickVisible/
  expectVisibleText)替代 .first()——同一 testid 在响应式布局下有多个席位;④每测试开场
  「静场守卫」(先 unmount 前树、等 overlay 与 scroll-lock 真正退场、清 localStorage 视图
  态与 sonner 全局队列——四类曾隐形前泄的状态);⑤套件模拟 prefers-reduced-motion(产品
  已尊重;此前 context 键名无效被静默忽略,修为 provider 级 contextOptions 后才生效);
  ⑥保留 retry:1,对应已插桩实证的 runner 竞态(点击派发落在 tester iframe 外,document
  级捕获零事件而 click() 报成功);⑦org-admin 补选项渲染等待(原为点开即同步计数)。
- **验收**:typecheck 零错;node 838 passed | 17 skipped;浏览器 **连续三轮全量 156/156**;
  build 成功。**screenshots** 仅存失败现场且已 gitignore,tests 根下历史遗留 png 清除。

## UI 平台 M5:共享产品层整体迁 StyleX,xstyle 成为正式扩展 API(2026-08-26)

- **范围**:admin 四件(page/async/field/dialog)、screen 五件(shell/sections/pick/rail/
  blank)、PageContainer、PersonCell、Steps、field 系统(field.tsx)、Empty/Alert(admin 的
  结构基底)、Motion 件残余样式(ticker、reveal 的 CountdownRing/DoneMark)。**缓迁并记录
  理由**:card(唯一消费者 LoginPage→M6)、pagination/breadcrumb/timeline(唯一消费者在
  assessment→M7)、input-group(样式整体是对 vendor input DOM 的补偿,归 adapter 族)、
  button-group(零消费者,M9 删除候选)。业务页零改动。
- **层序裁决(前置)**:utilities 移到 StyleX priority 层**之后**(index.html/app.css/
  cascade-layers.ts 三处同笔)。旧世界消费者 className 与组件类同层、由 tailwind-merge 裁决
  且消费者赢;若 priority 压过 utilities,业务页现存的每一处同属性覆盖(ItemConfigEditor 对
  Empty 的整套紧凑化、DoneMark size-12、'font-normal' 标签等)都会静默反转。迁移窗口契约由
  CascadeYieldProbe + 浏览器测试钉住;M9 删除 utility 层后该顺序自然失义。
- **xstyle API 规则(会中新增,已入 docs/stylex.md)**:Qualy 产品组件的正式样式扩展是
  `xstyle?: StyleXStyles`(spread 末位,属性级合成);`className` 只作 legacy/interop 逃生口
  且必须注明;禁用 `style` 命名。M5 内 23 个产品组件带 xstyle;仍保留 className 的 6 个
  (PageContainer/Empty 族/Alert 族/AsyncSection/Blank/DoneMark)各有真实 Tailwind 业务消费
  者;PageContainer 的 xstyle 用 `StyleXStylesWithout` 锁宽度契约(size prop 的领地)。
  组合契约由 xstyle-contract.browser.test 钉住(覆盖基值/未触属性存活/穿透组合链)。
- **选择器迷宫 → 显式状态**(§8):Field 以 context 携带 orientation/hasContent/inContent,
  has-[…] 全部退场;FieldLabel 改原生 label 全量 StyleX;admin 卡片选中态由已知的 selected
  值直接驱动(新 tokens --q-selected-border/surface,明暗各自配比)。已死选择器(legend 相邻
  负 margin、data-invalid/data-disabled 钩、nth-last-2)不复刻,列入报告。调用方内容的浅层
  后代规则(alert 图标席位、empty/field 描述内链接)集中 theme.css components 层,循 M3M
  图标几何惯例。
- **视觉走查修复两处**:①ModeChoice 选项自 M3M 起竖排挤压——Mantine Radio.Group 根是
  InputWrapper、子项在无样式 inner 盒里,根上的 flex 从未生效;改为组件自持行容器。
  ②destructive Feedback 文字失色——variant 色放在 components 层被自身 StyleX(priority 层)
  压住;改为 Alert 经 context 传 tone、描述按状态取色,并入 theme 套件计算断言。走查覆盖
  5 场景 × 明暗 + 2 窄屏(414px)截图逐张审看。
- **上游档案**:docs/notes/mantine-upstream.md 收 M4M 四条 issue-ready 复现(className 复制
  到 inner、role/describedby 硬写、focus-trap 随 ref 身份重抓焦、Target 覆盖显式 id)与
  四条行为差异备忘(含本轮 Radio.Group inner 盒)。
- **质量表**:业务代码 Mantine import 0;产品层 Mantine 布局件/style props 0;M5 范围
  Tailwind 残余 7 处 class 字符串(全部是向未迁适配器的同属性边界覆盖:sheet 宽度/footer
  方向、RadioGroup root 网格、avatar 配色,各带注释);cn/cva 在 M5 范围 0;新增
  !important 0;vendor 细节泄漏 0(产品件不识 data-mantine-*)。
- **验收(全部真实执行)**:`pnpm typecheck` 零错误;`pnpm test` = 838 passed | 17 skipped;
  `pnpm test:browser` = 24 files / **164 passed**(154 原有零删除零弱化 + field 行为 3 +
  xstyle 契约 3 + cascade 让位 1 + alert tone 1 + probe 2 重排);`pnpm build` 成功;生产
  smoke 全过(探针/壳/manifest/brotli/SIGTERM 退出 0);prettier 全仓通过(.mcp.json 除外,
  用户本地文件不动)。

## UI 平台 M6 第一刀:RBAC Roles/RoleEditor 竖切迁 StyleX(2026-08-26)

- **范围**:RolesPage / RoleEditor / NewRoleForm 三件全量;业务(query/mutation、version 乐观
  并发、locked 语义、任命门控、query-string 选中、i18n、路由)零改动,既有 12 条 roles 相关
  浏览器用例零改动通过即为证。
- **共享层直接受益**:RolesPage 手搓的角色列表(hairline 行/hover/选中面/badge 声调/计数)
  与 M5 Rail/RailRow 语义逐项吻合,整段删除换共享件;其余布局(19rem 分栏、权限 xl 双栏、
  堆叠、quiet 段落、facts 面板底)全部 semantic HTML + StyleX,tokens 经 @qualy/ui/theme/
  tokens.stylex 首次被业务插件消费(rbac 补 @stylexjs/stylex 依赖)。搜索框尺寸以编译后
  StyleX 类穿 input 适配器边界(该适配器 className 直落 input 槽、无内部 utility 冲突)。
- **xstyle 实战结论**:该 slice **零处需要覆盖共享组件默认样式**——Field/PickGrid/PickList/
  Segmented/FormDialog/ConfirmDialog/EditorHead/Facts/SaveBar/ModeChoice/Blank/AsyncSection
  原样即合身;xstyle 席位保持零使用(机制本身由 M5 的 xstyle-contract 钉住)。共享层无一处
  为 Roles 反向修改。
- **度量**:className 34→1(唯一一处携带编译 StyleX 类,零 Tailwind);cn 3→0;cva 0→0;
  业务直接 Mantine import 0;新 !important 0;新 unsafe cast 0;stylex.props 23 处。
- **补测**:活跃角色改权限 → SaveBar 保存 → 影响面确认框 → 确认后 payload 带 version 与
  终态 codes(identity 套件 +1,共 13)。
- **视觉走查**:9 场景截图逐张审看(列表+权限明暗、可担任、可任命门控、锁定角色、新建
  对话框、暗色删除确认、414 窄屏、空列表、长名字/多选中),零回归;RailRow 采纳带来 2px
  行距收紧(共享节奏,记录不回调)。
- **验收(全部真实执行)**:typecheck 零错;node 838 passed | 17 skipped;浏览器 24 files /
  **165 passed**(164 + 1,零删除零弱化,连续两轮);build 成功;生产 smoke 全过;prettier
  通过(.mcp.json 除外,用户本地文件不动)。Users/Organization/Shell 未开始。

## UI 平台 M6 第二刀:Users/UserDetail 竖切迁 StyleX,Avatar 迁 Mantine(2026-08-26)

- **范围**:UsersPage(三栏工作台+PersonPane)、UserDetailPage、NewUserForm、GrantRoleForm、
  UserGrants、NodePicker、OrgTree 七件全量;auth 插件补 @stylexjs/stylex 依赖。业务零改动:
  infinite cursor、300ms 防抖、五个 query-string 键(anchor/scope/type/q/user/view)、version
  payload、placement 过滤、grant 先选 target、状态机全部原样,既有 identity/org-admin/shell
  用例零改动通过。主从架构与滚动归属未动(树盒自滚 60vh,页面整体滚,三栏 lg 拆分)。
- **Avatar 裁决:现在迁**(§7 条件全满足)——全仓 7 个消费者只走 initials 回退路径,零
  AvatarImage/Badge/Group 消费;适配器改为挖掘 AvatarFallback 声明喂给 Mantine placeholder
  槽,compound API 原样,消费者一行未改(UserMenu/DrawerIdentity/Review 页的 Tailwind 覆盖
  经 utilities>mantine 继续生效);person.tsx 的 M5 遗留 avatar 边界字符串就地转为编译
  StyleX 类,未用到的 Image/Badge/Group/Count 出口随 Radix 依赖一并退场。Tabs(仅经
  Segmented 正常消费)、ScrollArea(NodePicker 一处,非阻塞)、HoverCard(PersonCard,
  slice 外)均缓迁。
- **Blank 的 legacy className hatch 删除**:slice 内两处消费者(max-lg:hidden、min-h-[14rem])
  转 xstyle 后全仓归零,prop 收缩;PageContainer hatch 保留(M7 assessment 尚余 3 处)。
- **度量**:七文件 className 118→7(全部是 Select 触发器宽度 ×6 与 PopoverContent ×1 的
  适配器同属性边界,携注释);另有 24 处 className 携带编译 StyleX 类穿 clean 边界(input/
  button/skeleton/spinner/PageLink/ScrollArea/Stagger);cn 4 文件→0;stylex.props 106 处;
  xstyle 4 处(Blank 窄屏隐藏、Blank 紧凑高、PageContainer 页布局、NodePicker 定宽);业务
  Mantine import 0;新 !important 0;新 unsafe cast 0。
- **补测**:users workspace 三条——点开人员进 query-string(?user=)+ aria-current + 侧栏
  事实;深链直开;选树节点后 listUsers 以该 orgNodeId 重新请求且 anchor 入址(identity 套件
  13→16)。
- **视觉走查**:10 场景(工作台明/暗/空态/空名册/窄屏、详情页明/暗/编辑框/停用确认/窄屏,
  fixture 含超长姓名与组织、停用行、never-used 入口)。两个"疑似回归"均实证为测试环境产物:
  空 manifest 下 PageLink 正确降级为纯文本(生产 manifest 含目标页);名册在 414px 的列挤压
  与迁移前逐类一致(固定列模板的既有债,记入 follow-up)。文案修正一处随行提交(返回链接
  去掉与图标重复的箭头)。
- **验收(全部真实执行)**:typecheck 零错;node 838 passed | 17 skipped;浏览器 24 files /
  **168 passed**(165+3,连续两轮,零删除零弱化);build 成功;生产 smoke 干净退出;prettier
  通过(.mcp.json 除外)。Organization/Shell 未开始。

## UI 平台 M6 第三刀:Organization 竖切迁 StyleX(2026-08-26)

- **范围**:OrgPage 全量(结构视图:树 rail/塌缩行走/节点面板/行内 rename·move·create 表单/
  删除区;类型视图:TypeRail/规则勾选网格/pair-diff 保存/TypeLadder/新建类型)+ OrgNodePicker
  布局层(自然清理点);org 插件补 @stylexjs/stylex。领域零改动:forest roots 构建、sortOrder
  排序、塌缩行走、moveTargets 计算(排除自身/后代/现父 + parent-type 规则)、规则顺序保存、
  删除双计数门、根节点不可移/删、query keys、payloads、query-string(view/node/type)。
- **OrgTree 复用裁决**:不直接复用——OrgPage 的树语法不同(headcount 列、锁、展开全部、
  塌缩持久化)且插件隔离禁止 org→auth import;OrgTree 零改动继续服务 Users 与 OrgNodePicker
  单选态,未 fork、未塞 page hack。TreeSelect 选择代数原样(OrgNodePicker 仅迁布局)。
- **商品件裁决**:Collapsible 本 slice 零消费(唯一消费者 RosterPanel 在 M7)→ deferred;
  ScrollArea 零消费(树盒本就是原生 overflow + StyleX)→ 无需裁决;ToggleGroup(OrgNodePicker
  内,Radix)→ M9;Tabs/HoverCard 不涉及。
- **度量**:OrgPage className 85→2、OrgNodePicker 21→1(剩 3 处全为 Select 触发器宽度边界);
  cn 2 文件→0;stylex.props 104 处;产品组件方向 legacy className 0(Blank/Facts/DefRow/
  Barred/SectionHead 本就干净消费,M5 抽象第三次零返工)。**Select 宽度边界全仓累计 14 处**
  (已迁 slices 9 + M7 5),已成系统性模式:判定 **ADAPTER FOLLOW-UP RECOMMENDED**——把触发器
  内部 `w-fit` 从 utility 移入适配器自有样式(或给 SelectTrigger 开 xstyle 席位),使消费端
  编译类可按层序覆盖;本阶段未动 Select API。
- **补测**:org-admin 3→6——move 流(非法目标不出现:自身/后代/现父/类型不合;payload 带新
  parentId)、delete 流(确认框往返 + payload)、有下级时删除保持 barred。
- **视觉走查**:8 场景(结构深节点明/暗、根选中、move 打开、暗色删除确认、类型+梯子明/暗、
  414 窄屏;fixture 含超长名、锁定单位、真实 headcount)。零回归。
- **验收(全部真实执行)**:typecheck 零错;node 838 passed | 17 skipped;浏览器 24 files /
  **171 passed**(168+3,连续两轮,零删除零弱化);build 成功;生产 smoke 干净退出;prettier
  通过(.mcp.json 除外)。Shell 未开始。

## UI 平台 M6.5:Select 触发器宽度契约收敛(2026-08-26)

- **根因定案**:14 处宽度边界不是 Mantine 也不是消费者滥用——是适配器自己把 `w-fit` 写在
  utilities 层(层序在 StyleX priority 之上),任何消费端编译宽度类都输给它,消费者被迫
  留在 Tailwind 字符串靠 tailwind-merge 取胜。
- **新契约**:fit-content 仍是默认(14 处实证 3 全宽/7 固定/2 弹性/2 本征,无压倒多数;
  闭合控件以 fit 为最少惊讶),但移入适配器自有 StyleX base;SelectTrigger 增 `xstyle` 席位
  与 base 同一次 stylex.props 组合——**属性级覆盖是正式保证**;`className` 留作 legacy 逃生口,
  其 utility 经层序继续取胜(这是层序契约,不是 prop 顺序承诺,注释言明)。
- **消费者迁移**:已迁 slices 的 9 处全部改 xstyle(users 6:类型筛选/两表单全宽/授予三段;
  org 3:移动 max-w+flex/子类型定宽/OrgNodePicker 种类筛选),**已迁 slices 宽度 Tailwind
  边界归零**;M7/audit 的 5 处零改动且经新契约测试证明兼容(legacy `w-56` 在 400px 座内
  计算命中 224px)。
- **契约测试**:select-sizing.browser.test 四断言——默认 fit(<200px)、xstyle 固定 240、
  xstyle 全宽 400、legacy utility 层序取胜;零 !important、零 Mantine 内部 DOM 断言。
- **验收(全部真实执行)**:typecheck 零错;node 838 passed | 17 skipped;浏览器 25 files /
  **173 passed**(171+2;四轮全量中三轮全绿,一轮单条未捕获名称的失败未再复现,特征与已
  存档的 runner 派发竞态一致);build 成功;生产 smoke 干净退出;prettier 通过(.mcp.json
  除外)。Shell 未开始。

## UI 平台 M6 收官刀:Shell 迁 StyleX(2026-08-26)

- **范围**:layout-default 全部(WorkspaceShell/TopBar+SectionBar/AppShell)+ auth 壳家具四件
  (UserMenu/DrawerIdentity/DrawerAccount/DrawerSignOut);layout-default 补 @stylexjs/stylex。
  架构冻结项全部原样:manifest/collection/capability 准入、layout provider、fill() 参数填充、
  1024 断点与 useIsBelow、NAV_STATE history 抽屉语义(open=push、hide=navigate(-1))、capsule
  常驻挂载(CI 竞态注释保留)、inert 折叠模式、预热隐藏槽、ScreenFootScope。滚动模型逐条
  保持并写成注释:body 不滚(根即视口)、main 拥有页滚、rail 与抽屉导航区各自滚。
- **显式状态替代**:NavLink 函数式 className 直接产出 stylex 组合;UserMenu 触发器的
  data-[state=open] 改为 onOpenChange 显式受控;lineage 展开/收起、rail 折叠、capsule 显隐
  全部 props 组合。`accent-foreground`(shadcn 别名,非 --q-*)按 M5 Rail 先例归一到
  tokens.foreground(14px 文本灰阶差不可辨),不再制造 M9 债。
- **度量**:七文件 className 111→2(剩两处注明的适配器同属性边界:底部抽屉的 SheetContent
  串——overflow 与 sheet 内部 utility 冲突;DrawerAccount 的 ToggleGroupItem——Radix 内部
  冲突)+ 23 处编译类穿干净边界;cn 4 文件→0;业务 Mantine import 0;Mantine 布局件 0;
  新 !important 0;新 unsafe cast 0;xstyle 0(壳无需覆盖任何共享默认)。
- **真回归一例,已修并转契约**:paper-reading 四条失败——根因不在壳代码,而是两个测试
  fixture 的视口骨架(h-dvh/overflow-y-auto/min-h-0)**寄生于生产源码的 Tailwind 扫描**:
  tests 目录不在 @source,这些 utility 此前恰因 WorkspaceShell 使用而存在,壳迁 StyleX 后
  从产物消失,fixture 静默失去窗高滚动(review-layout 同病,断言未及故未红)。修法:两个
  fixture 改 inline style,并注释立规——**测试骨架不得向扫描借 utility**。M6.5 那类未捕获
  runner 失败本阶段未再出现;此项为独立的 test-infra 教训,与 runner 竞态无关。
- **补测**:shell 套件 +1——抽屉关闭消费其 history 条目且地址不动(打开原地 push、Escape/
  返回 pop 落回原页;window.history.back() 在 MemoryRouter harness 下会杀 tester 页,已注释
  说明用 pop 等价表达)。
- **视觉走查**:9 场景(桌面工作台明/暗、rail 折叠、账户菜单明/暗、手机 capsule、手机抽屉
  明/暗、AppShell 段栏;fixture 含超长用户名/入口名、30 行正文撑滚动)。零壳回归;走查
  过程中两处"空席位"均为 gallery 接线(slot key、registry)而非产品问题。
- **验收(全部真实执行)**:typecheck 零错;node 838 passed | 17 skipped;浏览器 25 files /
  **174 passed**(173+1,连续两轮,零删除零弱化);build 成功;生产 smoke 干净退出;prettier
  通过(.mcp.json 除外)。M7 未开始。

## UI 平台 M6.6:测试 fixture 样式隔离(2026-08-26)

- **全量 sweep 结果**:测试基建里字面 className 仅 6 处。寄生扫描的 4 处已隔离——
  form-controls 的搜索镜片遮挡场景(定位/内边距契约靠真实样式成立)改测试内 stylex.create;
  overlay-widgets 的菜单行骨架改 inline style。刻意的 2 处保留并注明:button asChild 的
  `mt-2`(断言 class 属性字符串本身,不依赖编译产物)、select-sizing 的 `w-56`(层序契约
  探针必须是真实产物 utility;注释写明其供给来源与 M9 退役条件)。assessment 套件
  (batch-admin/entry-workflow/item-chain)零命中;harness/settled 无样式类;cn 零使用。
- **规则入档**:docs/stylex.md 增「Test fixture styling」——fixture 布局必须自持(inline/
  测试内 StyleX),唯一豁免是以 legacy 类行为为契约的测试,且须在门禁中点名。
- **防回归门禁**:tools/tests/fixture-styling.test.ts——扫 apps/web/tests 的字面 className,
  文件级豁免名单即上述两个契约文件;实现是十几行 walk+grep,零解析器、零误报面
  (node 套件 838→839)。生产源码零改动、零 safelist、零新增 @source。
- **验收(全部真实执行)**:typecheck 零错;node **839** passed | 17 skipped;浏览器 25
  files / **174 passed** 连续两轮;build 成功;生产 smoke 干净退出;prettier 通过(.mcp.json
  除外)。M6.5 型 runner 派发失败零复现。M7 未开始。

## UI 平台 M7-A:批次/阶段管理纵切迁 StyleX(2026-08-26)

- **范围**:assessment 管理侧批次/阶段家族全量——共享层 table 语义包装器、phase 家族
  (PhaseRow/PhaseTimelineEditor/PhaseDetailsPanel/PhaseDialogs)、batch 家族(Screen/Card/
  Flow/Progress/Switcher/两 ContextBar/StatusBadge/SettingsForm)、页面(BatchListPage/
  BatchOverviewPage/RosterPanel/NewBatchForm)。Entry/Item(M7-B)与 Review(M8)未触碰。
  业务语义全冻结:阶段排序/startRule/endRule/advancePhase/version 乐观并发/query keys/
  useBatchLive/i18n 与全部 data-testid 契约逐字保留,浏览器断言零弱化。
- **共享层裁决**:①table 迁 StyleX——切片需要行级同属性覆盖(ended/wrong 行态、fixed 布局、
  seam 行),每个部件开 `xstyle` 席位,className 留 legacy 逃生口;caller-content 结构规则
  (末行去边、含 aria-expanded 行着色、checkbox 列内边距)入 theme.css components 层。
  ②Collapsible 零样式 Radix 壳,裁决 DEFER 到 M9。③Timeline 保持 Tailwind 内部实现:其部件
  靠 orientation data 属性自我布局,消费端覆盖按层序契约留 utility 字符串(BatchFlow 内注明)。
  ④Pagination/InputGroup/ToggleGroup 同理为 utility 适配器边界,覆盖不迁。⑤FieldGroup 补上
  产品组件契约规定的 xstyle 席位(内部 gap 是 StyleX,className 层序覆盖并不可靠)。
  ⑥PageContainer 消费者全数改 xstyle 后 legacy className 逃生口**删除**(全仓零消费实证)。
- **语义色令牌**:standing 色从裸 palette 类(emerald/amber)收敛为 --q-warning/--q-success
  - foreground 对(light amber/emerald 500 基色 + 700 前景,dark 只翻转前景为 300 档);
    中途一次真事故:两对令牌只落了 .dark 前景覆盖、:root 基值漏写,var() 解析为空导致全部
    绿色透明消失(用户现场报告),补 :root 后即恢复——教训:成对令牌必须同笔写完两个作用域。
    BatchProgress 的 soon 档从 amber-600/400 归一到 warningForeground(700/300,一档之差,
    与 StatusBadge pending 同源)。
- **显式状态替代**:BatchCard 卡级 group-hover(页脚增亮+箭头位移)与 StageBar 分段
  group-hover/segment(名字浮现+条增高)改 useState 悬停;BatchSwitcher 触发器
  data-[state=open] 改用已有 open 状态;PhaseRow 铅笔、SettingsForm 的 divide-y(实际单行
  恒渲染,直接删除)同理。动画三处(StatusBadge ping/BatchProgress 呼吸/BatchFlow ping)
  stylex.keyframes + prefers-reduced-motion 条件。
- **度量**:切片 17 文件 className ~340 → 字面 12(BatchFlow 7 + BatchListPage 3 +
  Switcher/PhaseContextBar 各 1,全部为上述注明的适配器边界);stylex.props 295;cn 仅
  BatchFlow(Timeline 边界);业务 @mantine import 0;新 !important 0;PageContainer/Empty/
  Table/FieldGroup/BatchProgress/StatusBadge/BatchFlow/PhaseContextBar 的 xstyle 消费落地。
  Select 宽度:切片内零残留;剩余 3 处在 ItemConfigEditor/Choice(M7-B)与 ReviewInboxPage
  (M8)。PhaseContextBar 迁毕后发现全仓零消费者(疑为 M7-B 页面预留),已记录。
- **日期子系统判定:KEEP CURRENT DATE SUBSYSTEM**——DateTimePicker/DateRangePicker 在
  ScheduleDialog/SettingsForm 中以纯 props 消费,迁移全程零摩擦、零内部断言;@mantine/dates
  与 dayjs 未引入,无 ADR 必要。
- **视觉走查**:15 场景(列表明/暗/414、概览明/暗/414 横滑 strip、阶段表明/暗/414 卡片、
  设置明/暗、名册明/暗、切换器菜单明/暗;fixture 含超长批次名、四种 standing、未排期
  entryNote)。绿色/琥珀 standing 色、行态、seam、当前阶段 pill、倒计时全部如前。零回归。
- **runner 备案**:全量浏览器套件第 1/2 轮 button.browser「variants paint from the shared
  palette」失败,值恰为 q-primary hover mix(oklch 0.205/0.8),失败截图显示 primary 按钮
  处于 hover 渲染——CDP 指针停驻视口左上(前序文件点过 context bar 返回键同一坐标)所致的
  指针残留,单跑/与 batch-admin 连跑/第 3、4 轮全量均绿。未弱化测试,按协议记录。
- **验收(全部真实执行)**:typecheck 零错;node 839 passed | 17 skipped;浏览器 25 files /
  **174 passed** 连续两轮;build 成功;生产 smoke 干净退出(/health、壳、manifest、brotli
  资源、SIGTERM 0);prettier 通过(.mcp.json 除外)。M7-B(Entry/Item)未开始。

## UI 平台 M7-B:Entry/Item 纵切迁 StyleX(2026-08-26)

- **范围**:参评人申报全家族(MyEntriesPage 双栏工作台/Paper/EntryDialog/EntrySheet/
  EntryHistory/EvidenceForm/AttachmentLink/EntryStanding/Basis/DocumentLightbox/Appeal 与
  Supplement 两对话框)+ 管理侧项目配置全家族(ItemSettingsPage/StructureTable/FieldTable/
  ItemConfigEditor/StageSheet/GroupEditor/Impact/Reason/Void 对话框/PaperStart/Choice/
  PermissionProfileEditor)。Review/paper-reading 未触碰(见共享边界)。业务语义全冻结:
  entry 状态机、withdraw/resubmit、expectedItemRevisionId 乐观并发、stale-config 快照协议
  (mark-never-adopt + 409 双路径)、query keys/live 失效、gate 三态、上传传输、item 类型/
  字段身份铸造/版本与 impact 决议 payload——逐字保留,浏览器断言零弱化。
- **token 完整性契约**(M7-A 事故的正式门禁):tools/tests/semantic-tokens.test.ts——
  .dark 覆盖必有 :root 基值、18 个核心配对齐全、tokens.stylex.ts 指向的每个 var 必有声明、
  sheet 内 var() 交叉引用可解析;纯 regex 读扁平块,零 CSS parser(node 套件 839→843)。
- **切片内债务清零**:SelectTrigger 宽度消费 2 处全改 xstyle(Choice 的 className 透传 API
  换成 xstyle 席位,StructureTable/FieldTable 两消费者随迁);拖拽 ghost 的 classList 借
  utility(ItemConfigEditor/FieldTable)改为内联样式/编译类——生产侧扫描寄生照 M6.6 规则
  出清。ROW_DOT 裸 palette 表(amber/emerald/rose)从 standing.ts 迁出为唯一消费者内的
  StyleX 映射,rose→danger mixes、amber→warning、emerald→success;stale 横幅、退回通知、
  行内 urgent 字 全部落 warning/danger 令牌。
- **共享层反哺**:Badge 增 labelClassName 席位(Input.wrapperClassName 同型)——widget 的
  label span 裁 overflow,把 live dot 的呼吸 halo 切成矩形;compact 徽章补 flexShrink 免压扁。
- **动效所有权定案(用户连报七项,全修)**:动效探针实测 Mantine 过渡机在本装配从未运行
  (关闭 30ms 硬 unmount),且 reduced-motion 块特异性低于带 data-side 的入场规则从未生效。
  裁决:**sheet 动效单一所有者归 adapter**——Mantine transition 归零,退场由 closing 状态机
  - data-closing CSS 按方向滑出/overlay 同步淡出(Escape/点外/角钮/父级状态四路同径),
    入场保持 insertion keyframe(mount-already-open 语义不变);dialog/sheet 面板常驻
    position:relative,角部关闭钮不再在入场 transform 释放瞬间跳去视口角(审核决定 Sheet 的
    跳角即此);overlay 去 backdrop-blur(iOS 重栅格化闪烁);段头 strip 改工具栏下覆盖层
    (布局恒定,滚动条 thumb 不再伸缩);触屏文本控件 16px 起(iOS 聚焦不再缩放页面);
    paper-reading 的 .backdrop-blur-sm 探针改 data-testid="band-strip" 定位。
    胶囊点击延迟为冻结的 history 语义固有(open=push→整页重渲染→再动画),备案不改。
- **度量**:切片 24 文件 utility className 689 → 字面 22(全部注明边界:Sheet/Dialog 内容与
  标题、Breadcrumb、Tabs、DropdownMenuContent、InputGroupInput、FileTile、FieldLabel、
  sr-only-on-SheetTitle);cn 15 文件→0;cva 0;stylex.props 720;业务 @mantine 0;
  新 !important 0;新 cast 0。Select 宽度残留全仓 1 处(ReviewInboxPage,M8)。
- **商品件裁决**:Timeline/Pagination/ToggleGroup/Collapsible 切片内零消费(无需裁决);
  Tabs ×2、Breadcrumb ×1、InputGroup ×1、ScrollArea ×2、dropdown-menu ×3 正常消费不阻塞,
  全部 DEFER 到 M9(ScrollArea 经 safe-list 编译类消费)。日期子系统:判定不变(KEEP)。
  PhaseContextBar:**DEFER**(用户确认:申报页未来会补批次上下文,但载体未定;历史考证其
  唯一消费者随 2a/2b desk 改版移除)。
- **视觉走查**:16 场景(工作台明/暗/414、段头覆盖层实景、claim 抽屉明/暗、填报对话框
  明/暗/414、**stale 横幅(409 真路径触发)**、items 列表明/暗、编辑器明/暗/414;fixture 含
  四种 standing、未读点、退回+补充材料并存)。零回归;走查过程中顺手抓获并修复 compact
  badge 两缺陷(用户同步报告)。
- **验收(全部真实执行)**:typecheck 零错;node **843** passed | 17 skipped;浏览器 25
  files / **174 passed** 连续两轮(本阶段 pointer 残留零复现);build 成功;生产 smoke 干净
  退出;prettier 通过(.mcp.json 除外)。Review(M8)未开始。

## UI 平台 M8-A:Review 收件箱与决策面迁 StyleX(2026-08-26)

- **范围**:审核核心决策链——ReviewInboxPage(三种排布/筛选/统计/空态)、AwaitingSection、
  QueueBadge、decision-dialogs(通过/退回/复核三对话框 + DecisionSheet)、SupplementDialog、
  touch(SlideKey)、history(版本选择器),以及 ReviewInstancePage 内的决策区(EscalationNotice/
  DecisionBar/ActionKey/SiblingSheet/UndoPill/KeysPanel/DoneScreen)。**M8-B 边界成立**:同文件
  的阅读工作台组合(Workbench/QueueRail/RunStrip/PersonStrip/PartStrip/Pane/Flow/Filing/
  Context 三列,约 1900 行)一行未动、零业务重构污染——按区域迁,不拆文件。业务语义全冻结:
  决策 payload(WordedDecision/suggestedPayload)、reason 必填规则、快捷键协议(数字选事由/
  ⌘↵/⌥G/⌥数字/JK)、blocked reason 码表、五秒撤销 staging、run scope、live 失效与全部
  data-* 契约逐字保留。
- **Select 宽度契约**:切片内最后一处(`max-w-52`)改 SelectTrigger xstyle,切片归零。**但全仓
  未清零**:扫描发现 auth/audit 还有 3 处 M6.5 时代豁免的 legacy(PeoplePicker `w-auto`、
  AuditEventsPage `w-56`/`w-36`)——此前"全仓只剩 1 处"的台账少计了,已纠正,留 M9。
- **verdict 色板收敛**:决策键与实心确认钮的裸 emerald/rose 全部改 success/danger 令牌 mixes
  over background(danger 自翻转,无需新令牌);Kbd 边界上的着色改 token 取值的 arbitrary
  utilities(`bg-[color-mix(...var(--q-success)...)]`),不再有原始 palette;升级卡加入 warning
  令牌同款处理。
- **SlideKey 两轮打磨(用户现场反馈)**:①静止色斑——trail 只填到把手左缘;②拖动丑+不跟手——
  覆盖区改为与把手同内缩同圆角的"填充胶囊"(把手作盖帽),几何在读到指针的同一事件里直写
  DOM(state 照旧跟进 attribute 与文字淡出),不再等 render 提交。
- **bottom sheet 拖拽关闭(用户新需求)**:adapter 增 drag-down-to-dismiss——手势只在
  `data-sheet-grab` 区域起手(SheetHeader 自带;各抽屉的 grabber/顶栏手动标注),内容区下拉
  照常滚动;跟手直写,过阈值把面板连同当前位移交给既有 data-closing 退场续动画,不足弹回;
  抓取区 touch-action: none。
- **度量**:切片 8 文件 utility className 454 → 决策面字面 20(全部注明边界:Sheet*/Dialog*
  家族、Tabs、ToggleGroup*、Kbd/KbdGroup、Label 一处待后续)+ ReviewInstancePage 的 M8-B 区
  213(原样待迁);cn 仅存两文件且全部服务 M8-B 区与 ToggleGroupItem 边界;stylex.props 241;
  业务 @mantine 0;新 !important 0;新 cast 0;Badge.labelClassName 产品消费 0(无摩擦)。
- **商品件裁决**:Timeline/Pagination/Breadcrumb/InputGroup/Collapsible 切片内零消费;Tabs、
  ToggleGroup(ReasonPicker)、Kbd、Avatar 正常消费不阻塞,DEFER M9。共享阅读件
  (AttachmentLink/EntryHistory/Basis)直接消费 M7-B 成果,零 Review 分支。
- **视觉走查**:13 场景(收件箱按项目明/暗、待补充视图、全部处理完、无审核身份、414 收件箱、
  工作台明/暗、退回对话框明/暗(事由数字键+修改建议)、通过对话框、撤销 pill(真 staging
  路径)、414 决策面 2×2 + 滑动确认 sheet)。零回归。
- **验收(全部真实执行)**:typecheck 零错;node 843 passed | 17 skipped;浏览器 25 files /
  **174 passed** 连续两轮(pointer 残留零复现);build 成功;生产 smoke 干净退出;
  vendor:check 两树一致;prettier 通过(.mcp.json 除外)。M8-B(paper-reading/工作台)未开始。

## UI 平台 M8-B:Review 阅读工作台迁 StyleX(2026-08-26)

- **范围**:审核纵切的收尾——ReviewInstancePage 的阅读工作台(三列 Pane、QueueRail、
  Run/Person/Part 三条 strip、Flow/Filing/Context 三列内容、shell/pager/横幅/脚注),约 213
  处 utility className 归零。滚动模型、选中态、导航、快捷键、响应式断点、业务状态归属逐一
  保持;M8-A 决策面全程冻结未动。
- **结构拆分(先拆后迁,独立提交)**:迁移前先做逐字搬运的抽取提交(3078→1666 行,新增
  Pane/QueueRail/WorkbenchStrips/EscalationNotice/FlowColumn/FilingColumn/ContextRail 七文件 +
  useBeside 归 pointer.ts),className/DOM/props/state 原样、43/43 绿后才动样式——抽取回归与
  样式回归可分离归因。所有权按「页面=编排与状态、区域=呈现」划界:live 失效、决策 staging、
  键盘监听、pager 元素与 IntersectionObserver root、部件 spy 全留在页面;新组件全部
  Review-局部,零个进 @qualy/ui(无第二消费者)。Pane 契约 = as/part/xstyle/innerXstyle/
  footer,滚动归 ScrollArea 编译类。
- **滚动契约(迁移前成文,迁移后逐条复核)**:页面不滚(shell 高度 flex 链 min-h-0 到底);
  QueueRail 只在自己的 ScrollArea 里滚;strip 定高;<lg 时 stack 横向 snap 分页、lg 起三列
  grid overflow-hidden;每列在任何宽度都只在自身 Pane 内滚;Filing 脚注钉在列底;
  UndoPill/KeysPanel 绝对定位于 relative 根。抽取与迁移后 43/43 与实滚截图双重验证。
- **色板收敛**:lostTurn 横幅与决策 caution 卡的裸 amber → warning 令牌 mixes over
  background;PersonStrip 升级灯 badge 同款;Route opinions 的 emerald/rose →
  successForeground/danger;机器批注的 indigo Sparkles 按「工作台除两个 verdict 色外全灰阶」
  条令归 mutedForeground。切片后全 review 目录零原始 palette。
- **测试定位迁移一处**:review-layout:424 借 `[class*="rounded-xl"]` 找上一轮卡片,StyleX 化
  后类名消失——按纪律改 `data-testid="prior-round-card"` 稳定钩子,断言原样(前例:M7-B 的
  band-strip)。
- **顺手修复(用户报告)**:实心按钮上的快捷键 chip 钉死 white/primary-foreground,disabled
  的浅灰底上靠色不可见(暗色方案下 picked 亮底同病)——五处统一改 `bg-current/20
text-current` 跟随按钮墨色,enabled 外观不变。
- **度量**:切片 8 文件(页面+七新文件)utility className 213 → 字面 4(全部注明边界:
  DialogContent/DialogTitle、Kbd ×2);cn 0;stylex.props 全区覆盖;业务 @mantine 0;
  新 !important 0;新 cast 0;死代码清除(Explained 组件、Basis/27 处失效 import)。Select
  宽度 legacy 全仓 3 处不变(auth/audit,M9)。
- **商品件裁决**:Breadcrumb/Timeline/Pagination/Collapsible/HoverCard/ToggleGroup 切片内
  零消费;Tabs(收件箱)、Kbd、ScrollArea(safe-list 编译类消费)不阻塞,全部 DEFER M9。
  react-resizable-panels/文档渲染器不存在;PhotoView 经 AttachmentLink 沿用 M7-B 成果零改动。
- **视觉走查**:24 场景(desk/laptop/tablet/phone 明暗、长队列 rail 实滚、长材料 filing
  明暗实滚、flow/about 实滚、附件卡、复核路线明暗、只读、待补充、已完成、staged 撤销 pill、
  撤回后、run 完成屏、414 caution 卡、键盘面板、失去任务横幅);决策集成走查(读→staged→
  撤回→再决→自动前进→done)真路径全绿。零回归。
- **验收(全部真实执行)**:typecheck 零错;node 843 passed | 17 skipped;浏览器 25 files /
  **174 passed** 连续两轮(pointer 残留零复现);build 成功;生产 smoke 干净退出;
  vendor:check 两树一致;prettier 通过(.mcp.json 除外)。M9 未开始。
