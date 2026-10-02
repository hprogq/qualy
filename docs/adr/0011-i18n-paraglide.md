# ADR 0011:i18n 迁移到 Paraglide JS,语言随文档固定,展示文字在服务端渲染

- 状态:**已接受**(2026-10-01)。阶段 0 至 4 已实施:阶段 1 的对照测量通过(见文末),切换到 Paraglide;实施中的修正见"已裁决的细节""实施中的修正""阶段 3 的实施"三节,与上文不同处以它们为准
- 相关：`docs/notes/web-performance.md`、`apps/web/vite.config.ts` 中 code splitting 的注释，以及本文末尾保留的实测基线。原始讨论已经由本 ADR 吸收，需要逐字追溯时使用 Git 历史。

> 本文是一轮较长架构讨论的结论。“被否决的方案”中的选项已经逐一权衡；除非实测数据推翻理由，不重新开启讨论。

## 背景

### 现状

- `@lingui/core` 6.6 只被当作格式化器使用:`setupI18n` 加 `setMessagesCompiler(compileMessage)`,ICU 在浏览器现场编译;语言包是手写 TS(`client/locales/zh-CN.ts`);客户端 4216 条 descriptor 各自携带英文 `defaultMessage`。
- `virtual:qualy/plugins` 静态 import 全部插件的 `catalogs` 与 `errorMessages`,所有 descriptor 进入启动图;`I18nProvider` 要等全部插件的当前语言包到齐才渲染。
- 所有插件的中文合并成一个 `locale-zh-CN` chunk,生产 Brotli 54.7 KB。
- `assessment/core/src/client/i18n.ts` 共 8437 行,所有 assessment 页面共同依赖它。
- 另有三套手写的双语文案:`packages/web/i18n/src/bootstrap.ts`、`auth/src/server/mail-copy.ts`、术语的 `defineTerm({ defaults })`。
- wire 上的 `UiText`(`{ kind: 'message', id, defaultMessage } | { kind: 'literal', value }`)出现在 5 处合约:app manifest、ui surfaces、auth api、org api、assessment surfaces;服务端去重后共 184 条。
- 邮件语言取自 `Accept-Language`(`auth/src/server/index.ts` 多处 `mailLocaleOf`),与用户在 Qualy 里选择的语言无关。`updateUser`(`tellAddressLeft`)和 `createUserEmailVerification` 是给他人发信,却用了操作者的语言。

### 实测数据

- 2026-09-30 PoC:仅把静态 `defaultMessage` 抽成空串,首屏 i18n 模块 Brotli 82.8 → 43.7 KB,手机 LCP 改善 2 至 377 ms。语言包随页面预取没有收益,React 提交反而晚约 300 ms。
- 全产品 4193 条中英消息,Brotli q11:带 id 的中文 54.0 KB(与生产 54.7 KB 吻合);只算文案值:中文 32.4 KB,英文 35.5 KB,中英合计 69.7 KB(是单语的 2.15 倍)。
- 184 条 wire 消息,中英合计 3.9 KB。
- `@lingui/message-utils@6.6.0` 与 `@inlang/plugin-icu1@1.1.0` 使用同一个 `@messageformat/parser@5.1.1`。

## 决定

1. **框架:Paraglide JS 2**。`@inlang/paraglide-js` 与 `@inlang/plugin-icu1` 精确钉版本;升级作为单独改动,附 ICU 往返、消息契约与代表性渲染测试。
2. **消息源:ICU MessageFormat 1 JSON,正式长期格式**。每个插件自有 `messages/en-US.json` 与 `messages/zh-CN.json`。任何语言缺任何 key 即构建失败,不允许靠 `baseLocale` 静默回退。`baseLocale` 只是编译配置;产品默认语言 `zh-CN` 是 Qualy 自己的独立常量。
3. **构建**:assembly collector 做命名空间与冲突检查后,把活跃插件的消息合并进临时目录 `.qualy/i18n-build/` 下的 inlang project,不提交、不写回插件。不使用多 `pathPattern` 数组(导出时会写进每个路径),不写自定义 inlang storage plugin。开发环境 `locale-modules`,生产环境 `message-modules`。`experimentalPerLocaleBuild` 是观察项,正确性不依赖它。
4. **导入 ABI:`@qualy/messages/<namespace>`**,在三种情形下都必须可解析:插件单独开发、测试与 typecheck(plugin-kit 只编译该插件自己的消息);assembly 开发与构建(集中编译,全局只有一个 runtime);已发布的 dist-only 第三方插件(specifier 保持 external,包内携带 ICU JSON,由宿主编译)。插件只能 import 自己命名空间的消息;平台通用消息另设显式契约。先依赖 `sideEffects: false` 下 Rolldown 的 tree-shaking,不预先写 import 改写。消息 key 在插件文件内用本地名,由 collector 加命名空间前缀;从现有 Qualy id 到新 key 的映射规则要确定、可逆,供差分测试使用。
5. **类型 facade**:由 inlang 规范化模型生成 `@qualy/messages/<namespace>` 的 `.d.ts`(缺信息时退回同版本的 `@messageformat/parser`,不引入 FormatJS 的第二个解析器)。规则:`plural`、`selectordinal`、`number` 参数为 `number`;`date`、`time` 参数为 `DateInput`(见待定事项);普通插值为 `string`;带 `other` 的 `select` 参数为 `string`,合法值由调用处的领域类型经 `selectKey` 约束,不让消息文件反过来定义领域枚举。JS 输出只是 re-export,没有运行时包装。背景:Paraglide 对带兜底分支的 match 生成 `NonNullable<unknown>`,不加这层 facade 会丢掉现有 `defineMessage<Values>` 的类型安全。
6. **浏览器**:删除 `I18nProvider`、`loadCatalogs`、`compileMessage`、`MessageDescriptor`、`defineMessage`、`CatalogFor`、`formatText`、`LocalizedText`、`ErrorMessageMap`。组件直接调用消息函数。Paraglide 客户端使用自定义 strategy,只读 `<html data-locale>`;`useLocale()` 只是返回这个常量。API 错误翻译改为 feature 内的"错误码 → 消息函数"映射,通用的传输与认证错误放在平台通用消息里。
7. **语言生命周期:一个文档从创建到关闭只有一种语言**。创建时依次取:显式 cookie、`navigator.languages`、`zh-CN`;boot script 写入 `lang` 与 `data-locale`。cookie 只在用户明确选择时写入。账户上的 `preferredLocale` 可为空,只在登录用户明确选择时写入。切换:先弹出模态确认,说明整页重载与未保存表单可能丢失;确认后才由同一个接口同时写账户偏好并 `Set-Cookie`,最后整页重新载入(原有 beforeunload 保护保留)。取消不保存偏好。多标签页用 BroadcastChannel 给出不打断的提示,不自动刷新。
8. **服务端文字:`UiText` 从 wire 与内部同时退役**。新建仅服务端使用的包 `@qualy/text`(不放进 i18n-contract),只有三种构造:`text(消息函数, inputs)`、`term(TermRef)`、`literal(value)`;inputs 的类型来自 facade,`string` 类参数也可以接受 `Text`(用于术语)。`render(text, ctx)` 是同步纯函数,`ctx = { locale, terms }`,术语表每个请求查询一次并缓存。HTTP DTO 字段一律是 `string`,handler 显式渲染;api-kit 不做自动递归渲染。只在构造响应时渲染;渲染结果不缓存、不持久化,唯一例外是显式按源语言渲染的镜像(如 `Permission.name`);后台任务只存 code。服务端 Paraglide 使用自定义 strategy,未显式传 `locale` 的调用直接抛错。API client 在每个请求上附带 `x-qualy-locale`(取 `data-locale`);服务端解析顺序:该 header、cookie、`Accept-Language`、产品默认。WebSocket 与 SSE 把语言放进连接 URL。
9. **邮件与导出**使用同一个 `render`。本人触发的,用当前文档语言;发给他人的,用收件人的 `preferredLocale`,没有则用产品默认,绝不使用操作者的语言。删除 `mail-copy.ts`。
10. **术语库**:合约里只保留 `TermRef`(只有身份);`TermDefinition` 移到声明侧,`default`、`label`、`description` 都是引用 Paraglide 消息的 `Text`;删除 `defaults` 记录。管理端 DTO 通过逐语言渲染得到各语言默认值;`normalizeOverride` 与渲染出的默认值比较;assembly 门禁对每种语言渲染默认值,要求非空且不超过 maxLength。当前文档语言下的生效术语由 settings 插件通过 manifest 的 document-context 扩展点下发(ui-registry 不依赖 settings),`useTerm` 变为同步查表;管理员术语编辑接口保留,保存后重新获取 manifest。document-context 只放整个文档生命周期内稳定、体积小、多个 feature 都要用的数据,并设体积预算。术语只允许出现在不受词形变化影响的位置。
11. **bootstrap 文案**改为普通 Paraglide 消息,构建时渲染两种语言写入现有的 `#qualy-boot-copy`;维护页测试改为对照生成结果。
12. **插件隔离**:拆开前后端混用的模块(例如 `assessment/core/src/client/items/editor/ItemEditor.tsx` 第 26 行从 `surfaces.ts` 引入 `calculatorAuthoringOptions`)。客户端禁止 import `@qualy/text`、插件声明模块、服务端渲染辅助;这些规则加入 `tools/tests/plugin-isolation.test.ts`。
13. **chunk 策略**:删除 `locale-*` codeSplitting group;保留现有 `shared`(entriesAware)策略;平台通用消息显式声明。`qualyChunkGraph` 增加对结果的检查(首屏静态闭包的请求数、小于 1 KB 与 2 KB 的 chunk 数、压缩字节、chunk 环、不该出现的 feature 泄漏)。不采用"被 N 个入口引用就放进 boot"这类源码启发式规则。

## 被否决的方案

- **完整 Lingui(编译期 catalog,只加载当前语言)**:完全可行,是 PoC 失败时的备选方案。它的优势是只下载一种语言、文件少而大;劣势是需要人工设计 catalog 分组、存在异步 activation 门槛、延迟消息丢失参数类型。
- **保留原地切换语言**:要求每个组件、模块顶层字符串、Intl 缓存、`document.title`、第三方组件都跟着更新;与服务端渲染不兼容;阻断将来的单语言构建。换来的只是极低频操作不刷新页面。
- **wire 保留 `UiText` 加生成的分发表**:浏览器需要两条出文字的路径,版本错位要靠 fallback,服务端无法按显示文字搜索、排序、分页,也无法带参数,纯服务端插件被迫把文案编译进前端。前提是原地切换,已被否决。
- **把 `UiText` 改个名字留在服务端内部(`MessageRef | Literal` 加 `defaultMessage`)**:`defaultMessage` 的三个职责在新架构中都已消失;改用第 8 条的 `Text`。
- **自行实现每种语言一套完整构建**:由 Paraglide 的 `experimentalPerLocaleBuild` 覆盖,稳定后再评估。
- **inlang 原生格式、PO、MF2**:原生格式绑定 inlang,复杂消息更冗长,而 Qualy 用不到它的 markup;PO 只在专业译员与 TMS 流程下有价值;MF2 目前没有成熟的一等存储插件,出现后直接评估 ICU1 到 MF2 的迁移,不经过原生格式。
- **把 2026-09-30 的 defaultMessage 抽取 PoC 正式落地**:属于 Lingui 专用的工作,不要做。
- **自定义 inlang storage plugin、多 `pathPattern` 数组**:见第 3 条。

## 实施阶段

**阶段 0(与框架无关,可以先做)**:语言 cookie、账户 `preferredLocale`、`x-qualy-locale`、切换改为 leave guard 加整页重新载入;邮件按收件人选择语言;拆开混用模块并补充隔离规则。

**阶段 1(PoC,决定是否切换)**:(实施时与阶段 2 合并:全部调用点用 codemod 一次迁完,再对全量产物做对照测量——部分迁移时 Lingui 与全部描述符仍在启动图里,测出的数字不能说明任何事;测量不通过时回退的成本与只迁四页相同)

- 用脚本把全部现有消息机械转换为各插件的 ICU1 JSON;搭好第 3 至 5 条的流水线;验证三种 ABI 情形;把 `login`、`batches`、`my-entries`、`org-tree` 四个页面的调用点迁到 Paraglide。
- 对照组是生产可用的完整 Lingui:编译期 catalog、只加载当前语言、剥离 defaultMessage。
- 验收(手机 Lighthouse 每项 3 次取中位数,外加生产构建分析):四个页面的首屏静态闭包请求数不多于对照组,小于 2 KB 的 chunk 数没有明显增加,闭包 Brotli 字节不高于对照组,没有 chunk 环,LCP 中位数不变差。同时记录开发服务器冷启动与构建时间。
- 正确性:三种 ABI 情形都能通过;类型测试证明 `m.itemsSelected({ count: 'abc' })` 编译失败;服务端未传 `locale` 的调用抛错。
- 请求数明显增加且调不回来时,改为落地完整 Lingui,第 2、6 至 13 条中与框架无关的内容照样执行。

**阶段 2(全量迁移)**:4193 条消息做新旧差分测试(两种语言、同一组样例参数,逐条比对);迁移全部调用点与错误映射;删除 Lingui。差分测试完成后保留一份 golden fixture,不在 CI 中长期同时运行两套渲染器。

**阶段 3**:`@qualy/text`、术语库改造与 document-context、bootstrap 与邮件改造,删除 `UiText` 与 `i18n-contract` 中的旧类型。

**阶段 4**:更新 AGENTS.md 与相关文档,删除残留。

## 已裁决的细节(2026-10-01,用户确认)

1. **登录写 cookie,但只写空白设备**:设备没有 `qualy.locale` cookie 且账户 `preferredLocale` 非空时,登录响应写入该 cookie;设备已有 cookie 时登录永不覆盖。优先级:设备上显式的 cookie > 账户 `preferredLocale` > `navigator.languages` / `Accept-Language` > 产品默认 `zh-CN`。cookie 是这台设备的选择,`preferredLocale` 是新设备的默认值与站外通知(邮件)的语言;在设备 B 上显式切换,同时更新 B 的 cookie 与账户偏好。
2. **登录前选的语言与账户偏好不同**:显示以设备 cookie 为准;登录既不改 cookie,也不把登录前的 cookie 写进仍为空的 `preferredLocale`(共用设备上的 cookie 可能是上一个人选的)。账户偏好只在登录后显式选择时写入。从未选过的用户 `preferredLocale` 为 null,按产品默认 `zh-CN` 处理。
3. **date/time 消息参数只收 `Date`**:不收时间戳,不收 ISO 字符串;DTO 里的 ISO 字符串在应用边界转成 `Date`。facade 映射:`date`/`time`/`datetime` → `Date`,`number`/`plural`/`selectordinal` → `number`。实测现有 4241 条消息没有一条用 ICU 的 date/time/number 格式化(日期都在组件里走 `Intl`),这条规则暂时只约束新消息。
4. **Lingui 对照组是"生产代表性"的测量基线,不是可上线版本**:全量真实消息、真实 Vite/Rolldown 生产构建、构建期编译 catalog、浏览器不带 ICU 编译器、剥离静态 defaultMessage、只加载当前语言、真实 Brotli、真实 code splitting 配置与页面懒加载图。不要求语言切换体验、邮件、插件 ABI、错误恢复与最终目录结构。

## 实施中的修正(与上文"决定"不同之处,以此为准)

- **导入 ABI 改为包私有的 `#messages`**(取代第 4 条的 `@qualy/messages/<namespace>`):每个包在自己的 `package.json` 的 `imports` 里声明 `#messages`,指向构建生成的 `./.qualy/messages.{js,d.ts}`(gitignored)。Node、TypeScript、Vite 都按导入文件所在的包原生解析它,所以插件天然只能拿到自己的消息,不需要另写隔离门禁;不存在一个中央 `@qualy/messages` 包,第三方插件也不需要改任何中央文件。已发布的 dist-only 插件不写入 node_modules:构建的 Vite 插件按导入方所在的包把 `#messages` 解析到中央生成的 facade(`tools/tests/dist-only-plugin.test.ts` 与 `packed-plugin.test.ts` 用只有 `dist/` + `messages/` 的包、以及真正打包安装的 tarball 验证,页面 chunk 里编进了中英两种文案)。平台通用消息由 `@qualy/web-i18n/messages` 显式再导出。
- **命名空间由包名派生,插件不声明**:合并后的消息 key 是 `<包名派生的命名空间>.<本地 key>`(如 `@qualy/plugin-assessment` → `qualy-plugin-assessment`),插件代码里永远只写本地 key。原因:编译产物是插件代码要导入的东西,必须在任何插件代码运行之前存在;若命名空间靠描述器声明,编译前就得导入描述器,而描述器会传递导入服务端模块,服务端一旦也导入 `#messages` 就成了循环。所以消息源只从产品根 package.json 的 dependencies 中带 `messages/` 目录的包里发现,不执行任何插件代码;两个包不可能同名,也就不会冲突。
- **本地 key 规则**:旧 id 去掉命名空间,`/` 变 `_`,每段的 kebab-case 连成 camelCase,例如 `assessment/review/standing-ready` → `review_standingReady`;规则可逆,迁移时逐条校验了往返。
- **导入规范化**(`@inlang/plugin-icu1` 1.1.0 与 Paraglide 2.25.4 之间的两处真实缺陷,在合并工程的导入结果上修正,不另写 storage plugin):ICU 的 `#` 被导入成 Paraglide 不认识的 `icu:pound`,会原样插值数字(其他 ICU 实现都会按语言格式化,如 `1,234.5`);`=0` 这类精确匹配用字符串 `"0"` 与数字输入做 `===` 比较,永远不命中。两者都改写为 number 格式化。plural offset、≥1000 的精确匹配、未知格式化函数在编译门禁里直接拒绝。
- **不用 Paraglide 的 runtime.js**:消息模块只从 runtime 取 `getLocale` 与 `experimentalStaticLocale`,编译器替换为十几行的 locale 源:页面上读 `<html data-locale>`,其余场合未传 `{ locale }` 即抛错;构建时校验编译产物从 runtime 导入的名字不超出这份清单,Paraglide 升级引入新导入会当场失败。策略、cookie、重定向那套运行时不进产物。
- **facade 类型**:plural/selectordinal/number → `number`,date/time → `Date`,select → `string`,**普通插值 → `string | number`**(与第 5 条"普通插值为 string"不同:现有消息大量把计数直接插进某一种语言的句子,强制调用处 `String()` 只增加噪音,抓不到错;需要格式化的数字位置仍由 plural/number 强制为 number)。类型从同版本 `@messageformat/parser` 解析两种语言的源文推出(与 inlang 导入用的是同一个解析器)。
- **错误翻译**:仍是插件级错误表,由聚合模块汇总后在启动时安装(实测 189 个错误码、中英合计约 3 KB Brotli);按 feature 拆错误表留作后续,触发条件是错误表成为首屏的可测负担。
- **codeSplitting**:删除 `locale-*` 分组;新增 `messages` 分组(entriesAware、`minShareCount: 2`、子组合并阈值 64 KiB、不带依赖)。消息模块只依赖同为叶子的 runtime 与 registry,合并不会形成 chunk 环;实测阈值 0 时每种页面组合都成为一个几百字节的 chunk,首屏请求数比对照组多 15–30 个。
- **迁移中暴露并修正的真实缺陷**(旧的宽松类型放过了它们):`ASSESSMENT_FORMULA_VERSION_UNCHANGED` 的版本号一直渲染为空;`AUTH_BINDING_USER_FIELD_MISSING` 永远落在 other 分支;`GRANT_ESCALATION_REFUSED` 给了消息并不读取的参数;若干 id 在客户端描述与服务端 wire 上写了两份不同的英文(以用户实际看到的 wire 版本为准,共 9 条)。
- **失去的东西**:i18n.ts 里给译者看的注释没有迁进 ICU JSON(JSON 不带注释);需要保留的写作理由应进 docs/。

## 阶段 3 的实施(2026-10-01)

- **`@qualy/text`**:根导出是纯值(`Text`、`text` / `term` / `literal`、`render`、`renderTexts`、`TextSchema`),`./node` 导出 `messageRefs` 与消息表加载。声明方写 `import type * as M from '#messages'` 与 `const m = messageRefs<typeof M>(import.meta.url)`,`text(m.key, inputs)` 持有的是消息的名字(命名空间取自模块所在包的 `package.json`,与编译器同一条派生规则)而不是函数:声明在 resolve 期就被导入,那时消息可能还没编译。inputs 的类型来自 facade,`string` 类参数也收 `Text`。
- **消息表是进程级的,在启动时安装**:server 的 main 在装配校验之后、组合应用之前安装(开发态先编译,生产只加载镜像里的 `.qualy/i18n/server`,缺了拒绝启动);CLI 的 runtime 档同样安装;node 测试经 `setupFiles` 安装。服务端产物是按语言的两个模块(`locale-modules`),约 6.7 MB 源码,实测 `import` 约 50 ms,不影响冷启动的量级。开发态后端写 Node 使用的默认 locale-module tree；Vite 按 source set 与 output structure 写独立 profile。文件仍整份原子替换,但 build 的逐消息模块与 dev 的逐 locale 模块不再共享可变输出。
- **渲染在 handler**:handler 以 `requestLocale` 显式渲染。字段少的逐个 `render`;service 交回的结构里文字埋得深(登录方式的表单字段、账户记录、术语视图、manifest 的集合项)时,handler 对整个答复调用 `renderTexts`,它只走普通对象与数组,`Date` 等值原样保留,类型上把 `Text` 换成 `string`(`Rendered<T>`)。这仍是 handler 的显式一步,api-kit 不做自动渲染。集合 token 的解析类型默认就是 `Rendered<贡献类型>`。
- **镜像**:`Permission.name` / `description` 按 en-US 渲染后写入(种子脚本与 rbac 启动时的刷新同一规则);权限列表的搜索改为匹配读者语言里的名称。
- **wire 退役**:删除 `wireMessages`(插件 i18n 模块、构建聚合、组合根、测试 harness)、`formatText`、`LocalizedText`、`UiText` / `UiTextSchema` / `message` / `literal` / `plainText`(i18n-contract)与 api-kit 的 `uiText`;i18n-contract 不再依赖 effect。只剩 wire 条目的 i18n 模块(audit、ping)连同其 `Ui.i18n` 声明一并删除。`tools/tests/plugin-isolation.test.ts` 新增:浏览器源码(插件 `src/client`、`packages/web`、`apps/web/src`)不得 import `@qualy/text`。
- **邮件**:45 条 `mail_*` 消息进 auth 的 `messages/`,`mail-copy.ts` 删除,版式留在 `server/mail.ts`;语言即 `SupportedLocale`,原先的 `'en'` 别名去掉。换绑链接在无人登录的页面上被打开时,告知旧地址的邮件改用产品默认 zh-CN(原来是英文)。
- **bootstrap**:boot 文案全部是 `@qualy/web-i18n` 的消息,其中 14 行本来就是通用消息,只新增 7 条;两种语言在模块加载时按显式 locale 说出。`qualyBootFrame` 的 copy 改为延迟加载,在 `qualyMessages` 编译之后才读;维护页测试照旧对照这张表,表本身即生成结果。
- **术语**:契约只剩 `TermRef` / `termRef`;`defineTerm` 的 `defaults` 记录改为 `default: Text`,定义移到声明方插件(auth 的 `src/terms.ts`,`@qualy/auth-contract/terms` 只导出引用)。settings 在建层时把每个术语的默认词按两种语言渲染并检查(非空、不超过 `maxLength`,否则拒绝启动),管理端 DTO 的 `defaults` 是这份渲染结果,`normalizeOverride` 与它比较。生效术语经 document-context 下发:ui-registry 新增 runtime 相扩展点 `DocumentContexts`,manifest 的 `context` 字段按提供方的键携带,整页 JSON 预算 4 KiB,超出或同键两家提供即为缺陷;settings 以 `settings/terms` 提供 `{ 术语 id: 当前语言的词 }`,未登录的访客得到产品默认词(不是租户数据)。`useTerm` 同步查表,缺表时显示术语 id(只会发生在没有 settings 的 harness);术语页保存后同时刷新 manifest。术语门禁改为:源码不得出现默认词,消息里只有声明它的那一条。
- **SSE 与 WebSocket 不带语言**:现有的流(公式语言服务的诊断、SSE 事件)不携带 `Text`,第 8 条"语言放进连接 URL"暂无对象;出现第一个需要渲染的流时再加。
- **隔离门禁只查直接 import**:集合 token 所在的共享模块(`@qualy/ui-contract` 的 surfaces、assessment 的 `surfaces.ts`)为了在注册时解码贡献而带着 `TextSchema`,浏览器经它们传递地拿到 `@qualy/text` 的根导出(纯值,几百字节);浏览器源码自己不得 import 它,也拿不到 `./node` 与消息表。
- **未做**:第 13 条的 `qualyChunkGraph` 结果检查(首屏闭包请求数、小 chunk 数等)仍是阶段 1 的一次性测量,没有进门禁。

## 阶段 1 实测(2026-10-01,本地生产构建,首屏静态闭包 = 入口 + 该页 layout + 页面 chunk + 登录驱动 + 对照组的 zh-CN catalog chunk,各自的静态 import 闭包;Brotli q11)

| 页面       | 请求数 对照→Paraglide | <1 KB chunk | <2 KB chunk | 闭包 Brotli KB |
| ---------- | --------------------- | ----------- | ----------- | -------------- |
| login      | 75 → 68               | 49 → 45     | 57 → 53     | 401.3 → 333.1  |
| batches    | 109 → 105             | 75 → 71     | 88 → 84     | 451.7 → 398.6  |
| my-entries | 136 → 133             | 93 → 89     | 107 → 104   | 507.1 → 453.1  |
| org-tree   | 100 → 95              | 68 → 64     | 80 → 76     | 428.0 → 372.7  |

全量 chunk 数 350 → 333。构建通过 `qualyChunkGraph`(无环、无编辑器泄漏、boot 预算内)。开发冷启动:消息编译约 6 s(4241 条),之后按输入指纹跳过;生产构建时间与对照组同量级(约 10–14 s,单次)。

正确性:4241 条消息 × 代表性参数(5507 组)× 两种语言共 11014 次渲染,与 Lingui 逐字一致(`tools/tests/fixtures/messages-golden.json`,之后只校验源文未改动的消息);`m.roster_count({ count: 'abc' })` 编译失败;服务端未传 locale 抛错;三种 ABI 情形均有测试。

**手机 Lighthouse(阶段 1 验收的最后一项,阶段 3 之后补测)**:同一台机器、同一份演示基线,两组 arm64 release 镜像先后
起在 E2E 栈上(`pnpm lighthouse … --runs 3 --form mobile`,lighthouse 13.5.0)。对照组是切换前一个提交 `cb0649417`
(完整 Lingui,阶段 0 已在),实验组是 `0bd771af1`(阶段 3 之后)。LCP 是模拟节流下的估计,三次之间大多相差不到 10 ms(对照组 my-entries 有一次低约 300 ms、org-tree 有一次高约 75 ms);
FCP 在两组里都呈双峰(约 800 ms 或 1.4–2.4 s),三次取中位数不能说明构建差异,不作比较。

| 页面       | LCP 中位数 ms Lingui → Paraglide | 性能分  | 整页传输 KB | 整页请求数 |
| ---------- | -------------------------------- | ------- | ----------- | ---------- |
| login      | 3664 → 3120                      | 89 → 93 | 558 → 430   | 95 → 69    |
| batches    | 4226 → 3704                      | 84 → 87 | 662 → 544   | 160 → 137  |
| my-entries | 5125 → 4468                      | 77 → 81 | 839 → 733   | 214 → 194  |
| org-tree   | 4072 → 3558                      | 85 → 88 | 657 → 533   | 152 → 128  |

**真人时间轴**(与 docs/notes/web-performance.md 同一做法与同一脚本:Playwright 开真 Chrome,应用节流 RTT 562.5 ms、
下行 1474.56 kbps、CPU 4×,禁缓存,学生登录后打开批次列表;两组同上的镜像,各 5 轮取中位数,本机测量,生产未测):

|                        | 首帧 | React 首次提交 | 提交时样式已生效 | 页面内容出现 | LCP  | CLS   |
| ---------------------- | ---- | -------------- | ---------------- | ------------ | ---- | ----- |
| Lingui(`cb0649417`)    | 100  | 3048           | 5/5              | 7582         | 7612 | 0.008 |
| Paraglide(`0bd771af1`) | 116  | 2590           | 5/5              | 6131         | 6152 | 0.008 |

读法:首帧是 index.html 里的启动画面,两组相同;React 首次提交早约 460 ms,页面内容与 LCP 早约 1.45 s,五轮之间各自
相差不到 350 ms(每组第一轮都偏慢约 300 ms)。这是本机应用节流下的差,不是对真实网络的预测。

## 语言切换交互与分包阈值建议(2026-10-01 下午)

- 三处语言入口(登录页、账户菜单、抽屉)先确认再保存、重载。错误时保留确认供重试;请求期间禁止重复确认。
  账户菜单的确认由菜单外的组件持有,避免菜单关闭连带卸载问题。原有表单 beforeunload 保护保留,因此浏览器仍可能再问一次。
- BroadcastChannel 的发送端与接收端是两个实例,同文档也会收到广播。消息加入每文档随机 source,本页忽略自身消息;
  其他标签页保留轻提示与手动刷新。兼容未带 source 的旧标签页。
- Cookie 是**新文档**的选择依据,不是存活文档的响应语言。B 的 `data-locale` 在 A 切换后保持原值;typed client 每次请求
  写 `x-qualy-locale`,服务端 header 优先于 cookie。前端消息、API 错误、manifest 和术语都沿用 B 的语言。
  RUM 配置与附件二进制的直接 fetch 不返回展示文案;SSE/WebSocket 仍适用上文已实施的无 Text 约束。

本次本地生产构建复测(含上述确认交互):入口 + 页面 + layout + login/local(仅登录页)的静态 import 闭包,
去重统计 JS chunk;不含 CSS、字体、API、worker、动态加载的 slot,不是整页网络请求数。
小 chunk 按**原始 UTF-8 bytes**小于 1024/2048 统计;压缩对每个 JS 文件分别做 Brotli q11 后求和,
单位统一 **KiB = 1024 bytes**。使用 Vite generateBundle 输出图与 `.qualy-browser-surfaces.json` 定位 roots,
不依赖公开文件名或源码启发式。构建共 333 个 JS chunk(不计 worker)。

| 页面       | 请求数 | <1 KiB | <2 KiB | Brotli bytes | Brotli KiB | 建议请求上限 | 建议 Brotli 上限 KiB |
| ---------- | ------ | ------ | ------ | ------------ | ---------- | ------------ | -------------------- |
| login      | 67     | 39     | 45     | 322936       | 315.4      | 72           | 350                  |
| batches    | 102    | 52     | 66     | 382442       | 373.5      | 108          | 415                  |
| my-entries | 133    | 72     | 87     | 449033       | 438.5      | 140          | 485                  |
| org-tree   | 92     | 55     | 61     | 355933       | 347.6      | 97           | 385                  |

**建议,尚未启用新门禁**:请求硬上限 = 基线 + max(5, ceil(基线 × 5%));Brotli 硬上限 = 基线 × 1.10
向上取整到 5 KiB。这为新增确认、少量表单和翻译留出明确余量,但 15–30 个请求的拆分退化、重新引入全量消息池
或编辑器泄漏仍会被阻断。允许正常增长不意味着自动抬高基线;越界时先检查图,合法新功能附测量后再审阅预算。
请求和字节同时检查,不能靠合并减少请求掩盖下载增长。

<1/<2 KiB 数量先告警:各自比基线多 **4** 个以上即列出新增小 chunk,不做硬失败。小 chunk 与请求数高度相关,
且一个复用良好的小模块也可能合理;按总数硬卡会诱导过度合并。全量 chunk 数只报告,不门禁。
chunk 环继续零容忍、boot 原始 2 MiB 上限与现有隔离检查保留。Lighthouse 分数/FCP/LCP 暂不作硬门禁,
本机 FCP 双峰和加载时序方差不适合逐提交阈值;图预算越界或分组/依赖升级时再复测手机三轮中位数与真人时间轴。

本轮测试涉及 Effect 的依据实际阅读: `repos/effect/packages/effect/src/Effect.ts`(succeed/fail/gen/provideService/runPromise)
与 `repos/effect/packages/effect/src/http-api/HttpApiClient.ts`(make);生产 Effect 逻辑未改动。

## 迁移后收敛与门禁落地(2026-10-01 晚)

- 删除插件 `client/i18n.ts`、`Ui.i18n`/`I18nCatalogs`、启动 error registry 与 testkit 注入。
  没有组件 companion `*.errors.ts`、`defineApiErrorPresenter` 或 `useI18n(presenter)`。
  `useLocale()` 单独读取固定的 document locale。`useApiMutation` 是平台策略边界:会话恢复与重试沿用 API runtime,
  release refusal 沿用 transport 的刷新协调器,不重复 toast;权限、服务不可用、网络、默认限流统一 toast,
  BAD_REQUEST/origin/route failure 记录诊断。API_ROUTE_NOT_FOUND 不能单凭 404 推断 release mismatch,
  因此记录诊断与提示,不擅自重载。`onRateLimited` 是登录/重置流程显式选择的冷却回调。
  Mutation 的 `onError` 以及每次 `mutate`/`mutateAsync` 的回调只接收 `UseCaseApiFailure<E>`;
  只有平台错误的 endpoint 禁止声明业务 `onError`,有用例错误的 endpoint 必须声明。
  `mutation.error` 与 `onSettled` 保留真实 E,供本地清理,不伪造成功状态;延迟审核在平台失败后恢复暂存决定。
  多请求写入以显式 E 的 Promise 工作流逐个 `useRunApi` 请求运行,不恢复整个组合 Effect;
  会话过期只重做被认证中间件拒绝的请求,不重放此前已成功的写入。保存成功但提交失败时,
  `onSettled` 保留草稿并更新缓存,平台负责解释失败原因。未知程序异常调用现有 `captureException`,
  只有 HTTP 适配层的 TransportError 按网络失败处理,裸 TypeError 不代表离线。
  调用处直接更新字段、反馈、验证码或重认证状态,没有逐页平台判断。
  多成员联合用 `assertNever(error)` 检查;五个单一 TaggedError 类由于 TS 不收窄整个对象,
  只检查 `assertNever(error._tag)`,新增遗漏成员仍触发编译错误,不用 `as never` 掩盖。
  现有字段归属、录入拒绝理由、评分影响数量等真实共享语义仍用原有 helper。
  `useApiMutation` 保留 Effect 的 E,包含条件请求、纯 API 顺序工作流与延迟审核决定。
  目录上传、登录图标上传、公式发布本地校验与顺序保存、行政附件上传保留 Promise mutation 边界;
  预期会 reject 的上传不包进 `Effect.promise`。LocalFinding 是同文件普通 Error,首先由 instanceof 处理。
  Query 继续按 resource state 呈现,平台格式化函数明确命名 `formatPlatformFailure`。
  平台未知错误只展示本地化 unexpected,不显示 backend English fallback。
- 登录 redirect failure 归 `LoginDriver.failures: Record<code, Text>`。仅实际提供的 driver 将文案投影进
  `listLoginMethods.failureMessages`,handler 按 `requestLocale` 渲染,LoginPage 从 DTO 展示。
  auth 不枚举外部 driver,浏览器不导入全产品错误表;重复 failure code、平台码覆盖、LoginPage 已处理的 core code 与 malformed Text 在注册时拒绝。
  Local login 的 CAPTCHA_REQUIRED 按 typed `_tag` 打开 challenge,不会先转成错误字符串。
- 错误码冲突由实际 API assembly 的 endpoint/middleware schema 校验,不再通过导入浏览器翻译模块判断。
  校验允许同一 TaggedError class 跨插件复用,同码不同声明拒绝;Effect rc.118 内部导出的适配证据见 notes/effect.md。
- 编译器在 ICU 解析前哈希 raw JSON、源码与实际工具链包 identity;检查 stamp 中全部输出的存在与大小。
  dev 的 locale-modules 只编译一次,server 复用;缺失输出重新生成。拒绝非 object catalog、非 string value、
  number/date/select 的冲突;plain 与一个 specialized kind 可兼容。watcher 75ms coalesce,编译中变化再跑一次,监听 unlink。
- release messages 跟 active selection;仓库 typecheck/Node/browser suites 显式 all,仍检查 disabled source packages。
  namespace 算法归单一零依赖子路径。保留当前 plain `string | number` 与已验证的 ICU 兼容限制,不开 experimental flags。
- 每个拥有 messages 的包提交独立 `project.inlang/settings.json`,单一相对 pathPattern;IDE ICU 1.1.0、
  matcher 2.2.9 固定。`plugin:add` 初始化,仓库 gate 查覆盖与版本。生产仍用临时 merged project,不读取这些 IDE 配置。
  根目录 merged project 会碰撞本地 key 且多 path export 会破坏 ownership,不采用。
  依据:[Sherlock quick start](https://inlang.com/m/r7kp499g/app-inlang-ideExtension/quick-start)、
  [ICU1 plugin](https://inlang.com/m/p7c8m1d2/plugin-inlang-icu-messageformat-1)、
  [pathPattern resolution](https://inlang.com/docs/install-plugin)。
- TextSchema 验证完整 reference、input 与嵌套 Text,拒绝循环。新增 explicit-table `createTextRenderer`,不同 renderer
  与嵌套 render 互不影响。既有服务保留 Node startup 安装的默认表;本次不为迁移全部服务再增一轮 Effect DI 改造。
  UI collection token/schema 拆分、contract 改名同样不纳入本轮,避免扩大 API 变更。
- 已无 Lingui runtime/code imports,移除残余 catalog/root dependency 与 lockfile 闭包;golden fixture 数据保留。

实际扫描命令:`node tools/quality/measure-web-chunks.ts --sweep --output=/tmp/qualy-pooling-central-final.json`。
与上节相同 JS 静态闭包口径,login 用 blank shell 与 local driver,my-entries 用 workspace shell;Brotli q11 每文件求和。
下表每格为 **请求数 / Brotli KiB**:

| pool KiB | login      | batches     | my-entries  | org-tree   | 全部 JS chunks |
| -------- | ---------- | ----------- | ----------- | ---------- | -------------- |
| 16       | 68 / 302.0 | 103 / 353.9 | 136 / 420.9 | 92 / 332.3 | 350            |
| 32       | 68 / 304.2 | 102 / 356.6 | 132 / 421.0 | 92 / 334.5 | 339            |
| 48       | 67 / 305.4 | 102 / 361.0 | 131 / 423.1 | 92 / 337.0 | 334            |
| 64       | 67 / 310.3 | 101 / 365.2 | 130 / 424.4 | 92 / 337.0 | 330            |
| 96       | 67 / 310.4 | 101 / 365.3 | 130 / 427.2 | 92 / 337.1 | 329            |

选择 **48 KiB**:相对 32 KiB,login/entry 各少 1 请求;相对 64 KiB,batches/entry 各多 1 请求,
但 login 少约 4.9 KiB、batches 少约 4.2 KiB、entry 少约 1.3 KiB。org 的几十 bytes 差异不作收益。
96 KiB 没有进一步减少四页请求,录入下载更大。48 KiB 是当前图上的折中,不是所有页面同时最优。
扫描不声称 LCP 改善,也不把一张图的结果外推到所有页面。
最终 48 KiB source 复测:67/102/131/92 请求,312768/369636/433292/345062 Brotli bytes,
<1 KiB 39/52/72/55,<2 KiB 45/66/87/61;334 chunks。入口 Brotli 57129 bytes(55.8 KiB)。
生成的 release/hash 字符会带来几十 bytes 差异,正常构建可能不与扫描逐 byte 一致。

`apps/web/performance-budget.ts` 与 qualyChunkGraph **已启用**:请求上限72/108/138/97,
Brotli 上限340/400/470/375 KiB,按 baseline +5%(至少5 requests)与 +10%(向上5 KiB取整)。
入口独立 **62 KiB**(+10% 向上1 KiB取整),构建报告 top10 rendered module contributors。
小 chunk 各增长超过4个告警,环与原始boot 2MiB继续硬卡;LCP/FCP仍不作逐提交硬门禁。
预算不随本次测量自动抬升;越界须检查图,合法新功能带测量与预算修改一起 review。

入口主要贡献为 react-dom-client(453202 rendered bytes);剩余全量 surface/lifecycle table为7613 rendered bytes,
不再包含领域错误文案。保留静态可分析 lazy imports 与 Vite preload,本轮不另加 registry waterfall,
也不改成服务器下发 hashed URL。是否进一步拆表应另做有 preload/release recovery 验收的实验。

本轮 Effect 代码实际依据:`repos/effect/packages/effect/src/Effect.ts`(gen/map/asVoid/Error/promise/tryPromise),
`repos/effect/packages/effect/src/http-api/HttpApiClient.ts`(错误解码),
`repos/effect/packages/effect/src/http-api/HttpApiEndpoint.ts` 与 `repos/effect/packages/effect/src/SchemaAST.ts`
(装配错误 schema 与类 identity)。pipeline schema 也参与保留错误码检查,防止没有 endpoint 声明时被插件抢占。
