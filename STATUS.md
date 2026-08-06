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
