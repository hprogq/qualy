# CLAUDE.md

毕设项目「Qualy · 插件化综合素质测评系统」。当前阶段:P1 基座迁移(P0 已收官,基线 tag p1-base)。
文档职责:docs/PLAN.md 管决策与纪律,docs/p1-tutorial.md 管 P1 逐会话操作(p0-tutorial 已归档),docs/notes/p1-migration-audit.md 管旧代码迁移台账,STATUS.md 管进度交接。
旧代码只读参考在 legacy/(gitignored):qualy_old 为旧 Qualy,algryth 为 RBAC 参考。

## 每次会话

1. 开场按顺序读:本文件 → docs/PLAN.md 相关节 → docs/p1-tutorial.md 当次会话节 → STATUS.md。读完再动手。
2. 执行中遇到 beta/rc 包行为与文档不符:用 `node -e "import('包').then(m=>console.log(Object.keys(m)))"` 实查,结论写入 docs/notes/<包名>.md,以实查为准。
3. 收场:验收命令逐条真实执行并把输出摘录进 STATUS.md(不许只声称完成);更新 STATUS.md 的进度与下一步;提交。

## 提交规范

Conventional Commits,永远用英文编写,scope 用对外的模块名(如 web/server/db/repo),例:`feat(web): manifest-driven routing`。
禁止在 message 中出现内部阶段或会话编号(p0、s1 等);不要添加 Co-Authored-By 等署名信息。

## 工程基线

- Node 24 LTS(mise 管理,engines ≥24);pnpm workspaces;vitest。
- tsconfig 分层:根 tsconfig.base.json 用 module: Preserve + bundler 解析(cordis 生态 d.ts 内部相对导入无扩展名,NodeNext 解析不了,实测见 docs/notes/cordis.md)。types 分层:base 带 `["node"]`,web 侧包(apps/web、web-runtime、插件 client)覆写 `"types": []` 或 `["vite/client"]` 并加 lib DOM、jsx: react-jsx,防止 Node 全局类型泄进浏览器代码。相对导入保持 `.ts` 扩展名:软约定,编译器不强制,review 时留意(与现有代码及未来 node 原生 strip-types 兼容)。
- scripts 跨平台:禁止内联环境变量语法;.env 统一走 `node --env-file-if-exists=.env`;drizzle.config.ts 顶部 `try { process.loadEnvFile() } catch {}`。
- 启动入口是 packages/app/src/main.ts(复刻 cordis bin + SIGINT/SIGTERM 优雅关闭:根 fiber dispose 级联清理、5s 超时与二次信号强退);不要直跑 node_modules/cordis/bin.js(零信号处理,Ctrl+C 即硬杀)。运行清单默认 packages/app/qualy.yml(import.meta.url 锚定,与 cwd 无关),可经 QUALY_CONFIG 指向外部清单——但外部路径只在独立部署布局(扁平 node_modules)可用;monorepo 内启动必须带 --expose-internals(loader.internal 按清单目录解析宿主依赖;无 internal 的回退从 loader 包位置解析,pnpm 隔离下静默零装载,实测见 notes/cordis.md)。生产清单不含 hmr(hmr 是 app 的 devDependency)。
- database 插件 url 可选,回退 process.env.DATABASE_URL;qualy.yml 不写连接串。
- drizzle 用 v1(rc):表/视图定义一律 `snakeCase.*` 系列构建器(定义期 casing,TS camelCase 属性自动映射 snake_case 列名,schema 自包含);**禁止**使用 `drizzle()` 或 drizzle.config 的 `casing` 选项(v0 时代产物)。跨插件取表:import 对方包的 /schema 子导出 + inject 对方服务;需要 db.query 关系 API 用 `ctx.db.withRelations(defineRelations(...))`(RQB v2),基础实例 ctx.db.drizzle 永远 schema 无知。
- 数据层聚合(零生成物):drizzle.config 经 `resolveSchemaEntries()` 直接读 qualy.yml **全量条目(含 disabled)** + 各插件 package.json `qualy.database.schemaEntry`。能力靠声明不靠探测:未声明 = 无数据库能力;声明了但解析失败 = 硬失败。停用不改变聚合(表与数据保留,有不变式测试守护)。schemaEntry 指向的文件只允许表/枚举/视图的直接命名导出,禁止辅助函数、常量与条件导出;跨插件引用(exports["./schema"])与 kit 聚合共用同一文件(不一致即抛错)。
- 迁移:`pnpm db:generate`(generate 后自动 drop-guard:新增迁移含 DROP TABLE/COLUMN/SCHEMA...CASCADE 即退出非零,`ALLOW_DESTRUCTIVE=1` 或迁移内 `-- destructive: approved` 放行;命名迁移直接 `pnpm exec drizzle-kit generate --name <名>` 再跑 guard)。已应用迁移不可回改,只 fix-forward。迁移执行在 database 插件 Service.init 内按 `migrations` 配置进行(apply 默认;off 留给部署 Job),与 `pnpm db:migrate` 共用 `@qualy/plugin-database/migrator`;**应用进程禁止 drizzle-kit generate 与写 .gen.ts**。
- codegen 自动化:dev/typecheck/test/build 均前置 `tsx scripts/gen.ts`(写前比对,无变更零写入),plugin:add 收尾自动 regen,手动 `pnpm gen` 仅调试用。不建 @qualy/tooling 包与 CodegenRegistry;重评触发条件:第四类 codegen 能力落地(如 rbac.permissions 权限码生成)、插件出现私有 codegen 需求、或 CLI 需跨仓库使用(审计全案与缓建触发表见 notes/tooling.md)。
- 手工 SQL(trigger/function 等):`pnpm db:generate:custom` 产出空迁移,SQL 首行注释 `-- owner: @qualy/plugin-<name>`;首建严格 CREATE,同签名升级 CREATE OR REPLACE,签名变更走 `_v2` 新建切换。
- **数据层冻结规则**:数据层新增任何机制,必须由触发表(docs/notes/data-layer-retrospective.md)中实际发生的事故或需求触发,禁止预防性建设。元规则:复杂度必须由已发生的问题证明其存在,外部评审意见按此过滤。
- ORM 选型已终审维持 drizzle(Orchid 生成器无 diff 范围过滤,见 notes/drizzle.md),勿重启讨论。禁止 import 任何 drizzle 内部路径(只用文档化导出);迁移 SQL 必须可脱离 Drizzle 执行(灾备 = PG18 + SQL 顺序执行);正式版发布后不追随升级,走契约矩阵重放再决策。
- Service 异步初始化必须放 `async *[Service.init]()`(yield 登记清理):依赖门控在 init 完成后才放行;构造器里的 async effect **不会**阻塞依赖方激活(实测,见 docs/notes/cordis.md)。
- 主键统一 UUIDv7 且数据库侧生成:`uuid().primaryKey().default(sql\`uuidv7()\`)`(PG18 原生函数,默认值进 DDL,兜住 psql/ETL 等一切裸写入路径);仅当应用需要插入前预拿 ID 时,在该表上叠加 `$defaultFn`(与 sql 默认并存,不是替代)。时间戳列命名 createdAt/updatedAt(禁用 at 这类含糊短名),一律 `withTimezone: true`。
- **角色与隔离**:宿主 = packages/app(后端)与 apps/web(前端),是部署单元;基础设施插件 = plugins/infra/_;业务插件 = 其余 @qualy/plugin-_;共享库 = api-client、web-runtime(零 cordis 依赖)。纪律一:**根脚本与根配置禁止枚举可选业务插件**(check-chunks 读 plugins.gen 键集、typecheck 以 glob 发现 client tsconfig);引用稳定组合根(@qualy/web-app、packages/app)不受此限。纪律二:**宿主与聚合方拥有插件依赖**——装配清单在 `packages/app/qualy.yml`(include 会把 baseUrl 锚到清单目录,插件按宿主依赖解析;hmr 因此需 `base: '../..'` 回锚仓库根,教训见 notes/hmr.md);聚合方(api-client 之于 ./contract、apps/web 之于 ./client)必须声明所聚合插件,生成器对未声明输入硬失败。
- 新增插件一律 `pnpm plugin:add <名>`:自动写 packages/app 依赖 + qualy.yml 条目,并按 exports 声明补 api-client/apps/web 依赖。新包 package.json 一律带 `"license": "AGPL-3.0-only"`。
- **前端交付走 @qualy/plugin-web**(单进程,独立 dev:web 已删):mode auto 按 NODE_ENV 分流——development 把 Vite middlewareMode 挂到 server 的 httpServer(HMR websocket 共端口),production 用 sirv 服务 staged 产物(html 壳 no-cache、哈希资源 immutable、带扩展名的缺失资源 404)。**启用即必须可服务**:缺 client-dist 或缺 vite 是启动硬失败,headless 部署显式停用该插件而非静默降级。源码归组合根 apps/web(@qualy/web-app),产物经 `pnpm build` staging 到插件的 client-dist/(gitignored);路径以插件包 import.meta.url 锚定,与 cwd 无关。server 的兜底是**单槽** Connect 风格 fallback(effect 托管,/api 前缀内永不触发)。
- 经调用方 ctx 调用的服务方法里,**可变状态禁止 `this.prop = ...` 重赋值**(traceable 代理下闭包里的身份比较与重赋值不可靠,fallback 撤销曾因此失效):装进稳定容器(box/Map)再变更,实测见 notes/cordis.md。
- 共享框架级依赖(cordis、@cordisjs/_、@orpc/_、zod、drizzle、react 系等)一律走 pnpm catalog:版本只写在 pnpm-workspace.yaml 的 catalog 节,各包内写 `"cordis": "catalog:"`,禁止写具体版本(防止版本分裂出两份 Context)。插件独享的依赖(如 bullmq、quickjs)正常写在自己包里。第三方传递依赖漂移用 pnpm.overrides 归一。
- 插件统一**具名导出**形态:`export const name/inject/Config` + `export function apply`,模块命名空间即对象插件(loader unwrapExports 无 default 导出时整体使用);禁用 `export default function` + 属性赋值(default 解包后元属性丢失)。Service 类插件维持 `export default class`(静态属性随类走)。函数插件体不要有返回值:返回值会被当作 effect 清理函数,箭头函数隐式返回是事故源。
- Config 类型双面约定:构造器/apply 的参数标 `z.input<typeof Config>`(调用方可传部分字段),体内一次 cast 到 `z.output`(cordis 先经 Config 校验再调用,运行时恒为解析后输出);参数直接标 `z.infer` 会逼调用方传全量默认值。对象型 Config 顶层统一 `.prefault({})`,**禁止**用 `.default({})` 替代:cordis resolveConfig 对 yml 缺失的 config 原样传 undefined(不预处理),裸 `z.object()` 启动即 ValidationError;Zod 4 `.default({})` 短路跳过解析,字段默认全不生效且无报错;`.prefault({})` 走完整解析,必填字段照样报字段级错误(不吞错)。
- 类型门禁:根 tsconfig.json 是 solution 式检查入口(不参与构建),include 覆盖各包 src 与 **tests**(vitest 不做类型检查,漏 include 的测试目录 = 类型盲区);`pnpm typecheck` 必须零错误,列入每次会话验收;web 侧未来单独 `tsc -p apps/web --noEmit`。不建 @qualy/tsconfig 共享包;重评触发条件:插件出现独立构建产物(tsup/dist)、出现第三种 tsconfig 变体、或有第二个仓库要复用配置。
- API handler 的服务访问一律走**本插件自己的 ctx**(inject 声明过);经 `context.cordis` 取服务会撞 rc.7 的声明检查(cannot get property without inject)。ApiContext.cordis 只作请求管道。契约模块导出名约定 `<ns>Contract`(gen-contracts 依赖);契约包禁依赖 drizzle/node 专属模块。
- **插件 API 纪律(类型体操归基座,插件只写数据)**:①错误一律 `defineDomainErrors`(@qualy/api-contract)单源声明 code/status/英文 message/可选 zod data(加载期校验 code 大写蛇形、status 为 400-599 整数、message 非空,表冻结;**错误码全局唯一**,gen-plugins 聚合期同码冲突即硬失败,跨插件的同义概念加聚合前缀区分,如 `ROLE_ORG_TYPE_NOT_FOUND` / `USER_TYPE_ORG_TYPE_NOT_FOUND`)——契约 `.errors(e.pick(...))` 与 service 的 `e.create(code, data?/message?)` 由它派生,**HTTP 状态适配对插件完全不可见**(server 用 walkProcedureContractsSync 从已构建 router 的契约里读,`contribute(ns, router)` 只有两个参数);**禁止**手写 errorStatuses/ErrorDataMap/从契约反推错误联合(InferClientError 只归 api-client);service 内授权裁决抛 `AccessDeniedError`(边界映射为 FORBIDDEN)。跨包识别走全局 symbol brand(`isDomainError`/`isAccessDeniedError`),**禁止** instanceof(第三方插件可能持另一份包实例);`DomainError` 只导出结构类型,唯一构造路径是 `e.create()`。契约声明的 status 由 server 自读并统一认领:同码异值(含同一 router 内两个 procedure)与覆盖公共码(FORBIDDEN/NOT_FOUND/AUTH_REQUIRED 等)一律在贡献期硬失败。②router 一律 `implement(contract).$context<ApiContext>().use(apiErrorBoundary).use(requireAuth)`——边界统一映射域错误、requireAuth 把 principal 精化为非可选,handler 内**禁止** try/catch 域错误与手写 requirePrincipal;AUTH_REQUIRED 状态由 server 基础表自有,插件不再声明。③契约路由元数据用 `get/post/put/patch/del`(api-contract),不手写 `oc.meta(openapi(...))`。④约束翻译用 `createConstraintTranslator`(@qualy/plugin-database/pg-errors,constraint 名→`e.create` thunk;23001=restrict 违反已内置),**禁止**插件自写 pg 错误解包。⑤client 文案与错误翻译一律 `definePluginMessages` + `defineErrorTranslations`(values 的**入参**类型来自错误定义的 zod schema、**返回值**必须恰好是 message 声明的 ICU 占位符),catalog 完整性由 scripts/tests/catalogs.test 门禁,不手工维护 declared/messages 列表。
- 插件 index.ts 超过 ~150 行且承担多种职责(注册表/授权/写入等混居)即按能力拆内部模块,index 收缩为组合根 facade(effect 一律留在 facade 方法内,保 caller-fiber 归属);不强制 MVC 分层,单一职责的长文件不拆。
- 语言规范:标识符、注释、日志、CLI 输出、错误码、contract 的 fallback message、message 的 defaultMessage 一律英文;项目文档(docs/、STATUS.md)用中文。该规范优先于教程示例,抄录示例代码时注释就地译为英文。
- **i18n 边界**(概念冻结):后端传语义,前端定语言。①浏览器文案一律走前端 catalog——组件内禁止裸中文,页面文案与 API 错误提示都经 `useI18n().format` / `formatError`;②API 返回稳定 code + 结构化安全 `data`(禁放角色码/约束名/SQL 明细),英文 message 只作 openapi 展示、非浏览器客户端与缺译兜底,浏览器不直接展示 `error.message`;③`ctx.ui` 只传 `UiText`(`message(id, en)` 可译 / `literal(value)` 业务数据),禁传已选定语言的字符串,注册期 zod 校验;④message id 为 `<plugin>/<段>/<段>` 小写连字符,插件独占自己的命名空间;⑤catalog 是纯 TS 模块(raw ICU,运行时 `setMessagesCompiler` 编译,无抽取/编译步骤),放插件 `client/locales/<locale>.ts`,并在 `catalogs.messages` 声明覆盖的 descriptor(测试据此校验全语言完整、无孤儿键、命名空间不越界);⑥`@qualy/ui` 保持零文案原语库,可见文本一律由调用方传入;⑦邮件/短信/导出/PDF 等后端直接产出的人类可读内容才需要后端 i18n(`ctx.i18n`),现在不建,触发条件见 STATUS。
- **UI 组合模型**(概念冻结见 notes/ui-composition.md):Page=唯一主组件引用 Layout Contract(非实现);布局插件 registerLayout 提供实现;导航走 Collection、松耦合组件走 Slot(token 定义于 @qualy/ui-contract);业务插件禁止依赖布局实现插件,布局插件禁止依赖业务插件;一切注册 effect 托管、ID 命名空间化、无加载顺序语义。
- **页面与可见性纪律**:①页面身份一律 `definePage({id, path})` 声明在插件的 `src/ui.ts`(零框架依赖、经 `exports['./ui']` 暴露),服务端注册与任意插件客户端导航共用同一引用;path 校验在声明期(绝对/非协议相对/无 query hash/无尾斜杠)。②`addPage`/`contribute` 必须显式给 `visibility`(`PUBLIC` / `AUTHENTICATED` / `permissionOf(code)`),**没有隐式默认**;页面自带 navigation 继承页面可见性。③manifest 是**按 principal 的授权投影**:不可见页面的 id/path/component/导航一律不下发,未使用的 layout 不下发,`visibility` 等内部声明永不出服务端;权限判定走 ui-registry 的**单槽 authorizer**(rbac 经 `ctx.inject(['ui'])` 可选注册,缺 authorizer 时权限页 fail closed)。**前端隐藏只是能力发现,不替代 API 授权**。④客户端**禁止**裸内部路径(`to="/..."` / `navigate('/...')` / `<Navigate to="/...">`),一律 `PageLink` / `usePageNavigate` / `usePageHref`(有 scripts/tests/client-paths.test 门禁);外部链接走 `{kind:'external'}` target 且限 http(s)/mailto/tel。⑤身份切换必须 `useSessionTransition()`(清空 query 缓存后按新 manifest 重取),**禁止**只 invalidate;判断"未登录"必须用 `isAuthenticationError`,不得把任意请求失败当未登录。
- **API 路径规范**(会话 6.1 冻结):第一段是产品域(auth/iam/org/app),**禁止出现实现名**(rbac/ui/ui-registry)或使用场景名(admin);状态与关系用**幂等子资源替换**(`PUT .../status`、`/placement`、`/permissions`、`/eligibility`、`/{userId}/role-assignments`),**禁止动作段**(/move、/enable、/allowed);集合用复数名词,关系名说清关系(role-assignments 不叫 assignments);二态字段一律 `status` 枚举而非 `enabled` 布尔(布尔端点长不出第三态);暂不做 /v1(触发条件:出现无法与前端同步升级的外部客户端)。**全量路径集由 scripts/tests/api-surface.test.ts 冻结**,新增/改名必须同笔更新该表——路径是唯一活得比内部重构久的东西,漏改只会在客户端依赖之后才发现。契约导出名即命名空间,须匹配 `^[a-z][A-Za-z0-9]*Contract$`(生成器硬失败),生成器 import 一律 aliased(否则插件不能导出 appContract)。
- **跨域不变量单源**:一条不变量若两个插件都能破坏,声明在**双方都已依赖的契约包**(如 `@qualy/rbac-contract` 的 `accessInvariantErrors`),实现只有一份,错误码只有一份翻译(归拥有规则的插件)。禁止各写一份 SQL——auth 与 rbac 的"最后管理员"曾各写一份并已经漂移(rbac 那份根本没 join user_types)。不变量在**自身写入之后**校验(读终态,失败整体回滚),不要用 exclude 参数预测终态。"可登录管理员" = enabled user + enabled type + **type 至少开一个登录通道**;是否已绑定 identity 属驱动知识(SSO 可首登即建),核心不得断言。
- **授权判定必须与写入同事务**:router 的前置检查在拿租户锁之前,组织节点可能在窗口内被移动。所有身份/授权写入在锁定连接上用 `canAt(principal, code, node, tx)` 复核(`RbacDbHandle`),读取则把授权范围**下推进 SQL** 求交(`anchorCoverage(anchors, alias)` 于 rbac-contract):请求范围 ∩ 授权范围,返回部分子树是正确答案,不是错误。**禁止**只靠"请求 scope"决定结果集(self 锚点曾因此读到整棵子树)。
- **列表一律 keyset 分页**(`pageInput`/`pageOutput`/`encodeCursor`/`decodeCursor`,api-contract):**禁止裸 `limit N`** 静默截断;页面在 `nextCursor` 非空时必须显式告知还有更多。
- **能力与选项走服务端**:响应带 `capabilities`(租户集合)或逐行 `manageable`(按节点授权),前端据此**不渲染**用不了的控件(不替代 API 授权);页面渲染所需的跨域选项(组织锚点、用户类型、权限目录)由**该页面自己权限可及的 options 端点**提供(`/iam/user-options`、`/iam/role-options`),**禁止**逼页面同时持有其他域的读权限——否则合法的组织管理员只会看到空下拉框。权限目录只来自 registry 活跃集,不裸读 permissions 表。
- **健康探针**:`/health/live`(不查任何依赖,永远快速 200)与 `/health/ready`(各贡献方经 `server.readiness(key, probe)` 声明,effect 托管),都在 `/api` 前缀之外、不进 openapi;失败原因只进日志不进响应体(未认证端点)。ready 只能声称"已装载的都健康",不能声称装配完整。
- **测试分层**:node 套件跑服务/契约/授权与 HTTP(真实 URL、状态码、query 强制转换);`*.browser.test.tsx` 经 `pnpm test:browser`(Vitest Browser Mode + Chromium)跑组件,覆盖模拟 DOM 盖不住的部分(原生表单提交、`<dialog>`、query string、懒加载、焦点);harness 放 `apps/web/tests/support/`。**禁止**为白盒测试暴露生产实现的内部类、私有服务或可变状态;但**资源所有者可以提供显式 `<包>/testkit` 子路径**承载该资源自己的测试生命周期(如 `@qualy/plugin-database/testkit`)——testkit 不进包根导出,生产源码不得 import 任何 testkit(门禁守)。断言按 role/label 查询,不查内部 state。**业务插件测试不得自己持有数据库**:scratch 库的创建/销毁、可用性探测、迁移执行、连接回收统一归 `@qualy/plugin-database/testkit` 的 `createTestContext()`(在生产里拥有连接的插件,在测试里也拥有——放进一个平级的公共测试包只是把越层从六个文件搬到一个包),它按**生产路径**注册 Database 插件(`migrations: 'apply'`),dispose 时先 `ctx.fiber.dispose()` 再 drop。**正常路径永不 force**;force 只在普通 drop 已经失败之后用于清除残留,且**所有错误一并 AggregateError 抛出**——强制清理成功不得把一次失败的 teardown 变绿。旧写法是「手工 runMigrations + `migrations: 'off'`」,同一个库两个所有者,插件自身的 init/dispose 路径从来没被测过,还得靠 `pool.on('error', () => {})` 吞掉强杀连接的后果。**实查**:cordis 的 `fiber.dispose()` 对抛错的 disposer 是**吞掉**的(resolve 而非 reject),所以 harness 报不出插件的释放失败,能报的只有 postgres 拒绝的那些。**约束测试照旧直接写非法 SQL**(约束的价值就在于挡住 service 永远不会发的东西),但走 `db.query()`/`ctx.db.drizzle`,不碰 `Pool`。直接用 `pg` 只允许 database 基础设施、迁移升级测试与以 PoolClient 为公开入参的脚本测试;业务插件包**不得**声明 `pg`/`@types/pg`(pnpm 隔离即硬门禁),边界由 scripts/tests/test-layers.test.ts 守。**实查**:drizzle 会包裹驱动错误,SQLSTATE 在 `error.cause` 上,`pgCode` 因此走 cause 链;timestamptz 经 drizzle 回来是字符串而非 Date,断言要断值不断 JS 类型。
**测试目录必须在某个 tsconfig 的 include 里**(根 tsconfig 覆盖 packages 下的,web 侧由各自工程覆盖):`apps/web/tests` 与 `packages/web-runtime/tests` 曾都不在任何工程里,fixture 与契约漂移了整整一轮没人发现——尤其 `x !== null` 这类判定,漏字段不会崩,只会静默把界面元素全隐藏。**迁移的数据步骤要有升级测试**(建旧库形态 → 跑迁移 → 断言),空库重放证明不了任何 UPDATE/DELETE 分支。
- **访问模型(概念冻结)**:三个概念各说一件事,禁止合并——`permission.target`(`tenant` | `org-node`)是插件的领域事实,只说这条权限对着什么判;`role.kind`(`tenant` | `org`)是建角色时的选择,决定授权要不要锚节点;`grant.coverage`(`self` | `subtree`)授权那一刻才知道。**用户类型只约束身份与站位**,**角色只承载职责与权限**;类型**不得**继承或携带角色与权限,「能进门户」这类认证状态不得建模为权限(页面用 `AUTHENTICATED` 可见性)。两侧各自的表述规则:①站位是**显式策略** `user_types.placement_mode`(`unrestricted` | `allow-list` + `user_type_allowed_org_types`),**禁止**把「空集合」读成「不限制」——那让取消最后一个勾选变成悄悄放宽而非收紧,且跳过 stranded 检查(实测事故);②角色的 `eligibleUserTypeIds`(可授予哪些用户类型)**对 tenant 与 org 两种 kind 都生效**且激活时必填,`anchorOrgTypeIds`(职责作用于哪些节点类型)只对 org 角色有意义——两者说的是「谁能拿」与「在哪生效」,与持有者本人挂在哪**无关**,命名不得再用笼统的 allowed。canonical tenant-admin 是唯一豁免 eligibility 的角色(`system_key` 非空);管理员权力只来自它(唯一 `permission_mode = 'all-active'` 的行),`system-account` 类型只是恢复用的系统身份,且**必须站在租户根节点**(对人的权限就是对其所在节点的权限,根以下的任何节点都有别人管得着)。提权控制照 Kubernetes:定义角色只能用自己持有的权限(`iam.role.escalate` 逃生),授权只能给出自己有的权威且 coverage 不更宽(`iam.tenant-role.bind` / `iam.org-role.bind`)。角色走 draft → active → disabled,完整性在**激活时**检查(不留「已启用但什么都干不了」的窗口),集合替换一律带 `version` 乐观并发。
- **站位不变量(跨插件)**:「每个用户所在节点的类型满足其用户类型的 placement policy」这条不变量 auth 与 org 都能破坏——auth 经创建/改类型/调动,org 经改节点类型(人不动,节点在人脚下变了)。**判定只有一份**(auth 的 `placementLegal` 谓词),四个消费方共用:三处写入校验、org 改类型前经 `ctx.auth.iam.usersBlockingOrgType` 询问、以及全量扫描(seed 测试断言零违规)。org 因此 inject `auth`(与它 inject `rbac` 同型,不另建约束注册表)。
- **授权一致性三条**:①读过滤下推——用 `scopeCoverage()` 把授权范围翻译成 SQL 谓词,禁止先全取再过滤;②每个结构性写的第一条语句是租户行锁 `select 1 from tenants where id = $1 for update`,锁内用调用方连接(`RbacDbHandle`)重跑授权判定,**禁止**持锁时另开池连接;③解释与判定同源——诊断接口必须复用授权用的同一 SQL 片段(如 `REACHES_EVERY_NODE`),不得另写一份。
- **租户纪律(P1 起)**:tenantId 只能来自配置、session 或服务端查出的关联对象;普通 contract input 禁止出现可自由填写的 tenantId;租户拥有的 repository 查询必须显式 tenant scoped。
- 注释只写外人需要的信息,选型理由归 docs/;目录用到才创建(脚本同理,不留占位空壳)。

## pnpm 构建脚本审批

不要交互式运行 `pnpm approve-builds`。当 pnpm 报告 ignored builds 时:

1. 运行 `pnpm ignored-builds` 获取被阻止的依赖。
2. 检查每个依赖为什么需要 install/postinstall 脚本。
3. 仅对已确认可信且确实需要构建的依赖运行 `pnpm approve-builds <package...>`。
4. 对明确不需要脚本的依赖使用 `pnpm approve-builds '!<package>'`。
5. 不得使用 `--all` 或 `dangerouslyAllowAllBuilds`,除非用户明确要求。
6. 展示 `pnpm-workspace.yaml` 的变更。

## 禁止

- 重启技术选型讨论(PLAN §3 已定案)。
- 照搬 oRPC v1 教程(v2 已移除 oc.route,见 PLAN §4.8;`@orpc/openapi-client` 包已死于 1.x,勿装)。
- oRPC 使用 @beta 等浮动标签(beta 已漂过 .21,一律精确版本;升级评估只在 P0 收官后单独做)。
- 裸副作用——一切有反动作的操作必须包 ctx.effect。
- 偏离 docs/p1-tutorial.md §0.3/§0.4 的插件划分、目录结构与命名。
- p1-tutorial 中与本文件冲突的操作性指示(如 `p1-s<N>` 提交格式)以本文件为准:提交永远走英文 Conventional Commits。
- dev 脚本加 --watch(与 hmr 插件的粒度重载冲突)。
