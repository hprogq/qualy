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
