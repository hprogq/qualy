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

- [P1 入场收口] 基线冻结与三修复(2026-08-02):①装配清单更名 `packages/app/qualy.yml`(审计确认文件名在 cordis 库中零特殊化,仅弃用的 bin.js 有默认值;代码引用 main.ts/read-entries/plugin-add/codegen banner/两测试全量切换,归档文档与上游手册不动);②终端日志归一——db:migrate 换自研静音脚本(drizzle-orm migrate() 程序化调用,与 kit 台账实测兼容;注意 v1 必须 `drizzle({client})`,裸 `drizzle(pool)` 会被当 config 自建无凭据连接),vite 日志经 customLogger 走 `ctx.logger('vite')`;③web 壳补 index 重定向(首个 nav 项)与 404 页,根路径不再空白;④CI 增 `pnpm build` + staged assets 存在检查 + check-chunks 树摇门禁;⑤p1-tutorial.md 与 p1-migration-audit.md 入库(审计表已按真实旧仓校对路径),CLAUDE 切到 P1;⑥旧代码克隆 legacy/(gitignored,vitest 排除):qualy_old + algryth(RBAC 参考);⑦当前 HEAD 全量验收重跑并补记 P0-REPORT,打不可变基线 tag `p1-base`

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
- 启动入口定案(s2 尾声):packages/app/src/main.ts 接管 cordis bin(SIGINT/SIGTERM 优雅关闭,根 fiber dispose 级联清理,实测 Ctrl+C 退出码 0 无 ELIFECYCLE;根 fiber dispose 后状态仍 ACTIVE 属特例勿断言);hmr root 收窄为 packages;代码注释与日志一律英文
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

## 下一会话(P1 会话 4)

- 按 docs/p1-tutorial.md 会话 4 执行:RBAC 七表(permissions/user_type_permissions/roles/role_permissions/role_allowed_user_types/role_allowed_org_types/user_role_assignments)、Rbac Service(§0.11 API:definePermissions/getProfile/hasPermission/require/canAt/requireAt)、permission registry(effect 托管,稳定语义冲突硬失败,插件停用 fail closed)、bootstrap tenant-admin 系统角色 + 管理员 assignment(root/subtree)+ last-admin 保护。注意:tenant-admin 走真实 role_permissions 不做 bypass;seed 的 provision 层需接入系统角色与 assignment;demo 层接 org-manager 角色。dev .env 已有 QUALY_ADMIN_USERNAME/QUALY_ADMIN_PASSWORD(gitignored)
- 浏览器人工走查(P0-REPORT 第 3 项)在 P1 第一个 commit 前人工补记:/ping 页面与导航、改 PingPage 文本验 HMR、停用 ping 后导航与路由消失、恢复、控制台无 React 双实例/Router/chunk 错误
