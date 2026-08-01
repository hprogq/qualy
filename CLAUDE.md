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
- 启动入口是 packages/app/src/main.ts(复刻 cordis bin + SIGINT/SIGTERM 优雅关闭:根 fiber dispose 级联清理、5s 超时与二次信号强退);不要直跑 node_modules/cordis/bin.js(零信号处理,Ctrl+C 即硬杀)。
- database 插件 url 可选,回退 process.env.DATABASE_URL;qualy.yml 不写连接串。
- drizzle 用 v1(rc):表/视图定义一律 `snakeCase.*` 系列构建器(定义期 casing,TS camelCase 属性自动映射 snake_case 列名,schema 自包含);**禁止**使用 `drizzle()` 或 drizzle.config 的 `casing` 选项(v0 时代产物)。跨插件取表:import 对方包的 /schema 子导出 + inject 对方服务;需要 db.query 关系 API 用 `ctx.db.withRelations(defineRelations(...))`(RQB v2),基础实例 ctx.db.drizzle 永远 schema 无知。
- 数据层聚合(零生成物):drizzle.config 经 `resolveSchemaEntries()` 直接读 qualy.yml **全量条目(含 disabled)** + 各插件 package.json `qualy.database.schemaEntry`。能力靠声明不靠探测:未声明 = 无数据库能力;声明了但解析失败 = 硬失败。停用不改变聚合(表与数据保留,有不变式测试守护)。schemaEntry 指向的文件只允许表/枚举/视图的直接命名导出,禁止辅助函数、常量与条件导出;跨插件引用(exports["./schema"])与 kit 聚合共用同一文件(不一致即抛错)。
- 迁移:`pnpm db:generate`(generate 后自动 drop-guard:新增迁移含 DROP TABLE/COLUMN/SCHEMA...CASCADE 即退出非零,`ALLOW_DESTRUCTIVE=1` 或迁移内 `-- destructive: approved` 放行;命名迁移直接 `pnpm exec drizzle-kit generate --name <名>` 再跑 guard)。已应用迁移不可回改,只 fix-forward。dev 与部署一律先 migrate 后 start(dev 脚本已内置)。
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
- 对象型 Config 顶层统一 `.prefault({})`,**禁止**用 `.default({})` 替代:cordis resolveConfig 对 yml 缺失的 config 原样传 undefined(不预处理),裸 `z.object()` 启动即 ValidationError;Zod 4 `.default({})` 短路跳过解析,字段默认全不生效且无报错;`.prefault({})` 走完整解析,必填字段照样报字段级错误(不吞错)。
- 类型门禁:根 tsconfig.json 是 solution 式检查入口(不参与构建),`pnpm typecheck` 必须零错误,列入每次会话验收;web 侧未来单独 `tsc -p apps/web --noEmit`。不建 @qualy/tsconfig 共享包;重评触发条件:插件出现独立构建产物(tsup/dist)、出现第三种 tsconfig 变体、或有第二个仓库要复用配置。
- API handler 的服务访问一律走**本插件自己的 ctx**(inject 声明过);经 `context.cordis` 取服务会撞 rc.7 的声明检查(cannot get property without inject)。ApiContext.cordis 只作请求管道。契约模块导出名约定 `<ns>Contract`(gen-contracts 依赖);契约包禁依赖 drizzle/node 专属模块。
- 语言规范:标识符、注释、日志、CLI 输出一律英文;业务/UI 字符串内容可中文;项目文档(docs/、STATUS.md)用中文。该规范优先于教程示例,抄录示例代码时注释就地译为英文。
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
