# @stylexjs/unplugin 实查记录

版本:0.19.0(catalog)。UI 平台迁移(docs/ui-platform-migration.md)M0 接入时实查。

## 行为确认(以安装产物为准)

- Vite 适配器从 `@stylexjs/unplugin/vite` 取 default export;选项类型 `UserOptions = StyleXOptions & {...}`,
  所以 `dev` / `runtimeInjection` 来自 babel-plugin 选项,`useCSSLayers` / `devMode` 是 unplugin 自己的。
- `treeshakeCompensation` 在 vite/rollup/rolldown 下**默认已开**(`lib/es/core.mjs`),不必显式设置。
- `@stylex;` CSS 入口标记只属于 PostCSS 插件路径(Next.js);unplugin 路径完全不识别它——
  production build 在 `generateBundle` 里把聚合 CSS 直接追加进 bundle 已有的第一个 CSS asset
  (可用 `cssInjectionTarget` 指定),没有 CSS asset 才落 `assets/stylex.css` 兜底。app.css 无需任何标记。
- dev(`devMode: 'full'`,默认):`transformIndexHtml` 自动注入 `/@id/virtual:stylex:runtime` 脚本与
  `/virtual:stylex.css` 链接;runtime 脚本 fetch CSS 端点并注入 `<style>`,监听 `stylex:css-update` 热更。
  vitest browser 页面不经 index.html,测试需自行 `import('virtual:stylex:runtime')`
  (见 apps/web/tests/stylex-probe.browser.test.tsx)。
- 插件自动发现依赖 `@stylexjs/stylex` 的已装包并把它们从 `optimizeDeps` 排除,workspace symlink 源码
  因此走正常 transform,monorepo 下无需 `externalPackages`。

## 上游缺陷与本仓库 patch

`lib/{es/,}vite.js` 的 `configureServer` 每 150ms 轮询共享 CSS 版本号推送热更事件,timer 只在
`server.httpServer` 的 `close` 事件里清除,且**未 `unref`**。vitest browser 场景该事件不触发,
timer 压住事件循环:每次 `pnpm test:browser` 结束都挂 10 秒后被 vitest 强制关闭并打
"close timed out / something prevents the main process from exiting" 告警(已实测:去掉插件即干净退出)。

patch(`patches/@stylexjs__unplugin@0.19.0.patch`,pnpm 的版本化命名)在 setInterval 后补一行
`interval.unref?.()`,两个构建产物(esm/cjs)各一处。移除条件:上游修复该 timer 泄漏并升级到含修复的版本。

同一份 patch 的第二组 hunk(2026-09-13,断点常量接入时实查):`defineConsts` 的消费方编译成
`var(--<constKey>){…}` 占位规则,由 `processStylexRules` 在**聚合**时用常量模块自己的规则
(`constKey` / `constVal`)替换成真正的 `@media …`。production build 在 `generateBundle` 里一次性
聚合全部模块,没问题;dev(含 vitest browser)在**每个模块 transform 之后**都重新生成整张样式表,
消费方常常先于常量模块被 transform,此时占位规则解析不到,lightningcss 对 `var(--x){…}` 报
`Invalid empty selector`,整张表 500,Vite 错误遮罩盖住页面——浏览器套件里表现为对话框"找不到"、
点击超时,一整批用例连锁失败(已实测:去掉常量导入即恢复)。

hunk 给 `processCollectedRulesToCSS` 加了 `unresolvedConstants: 'skip' | 'throw'`(缺省 `throw`),
`collectCss(mode)` 透传:**只有 dev 的 CSS 端点**(`vite.mjs` / `vite.js` 里 `DEV_CSS_PATH` 那条
middleware)传 `'skip'`,引用了尚未收集的常量的规则暂时排除,常量模块到达后下一次聚合自然补上;
`generateBundle` / `writeBundle`(vite 与 rollup 适配器)走缺省 `'throw'`——build 期还有常量没解析到
就抛错点名 `--<key>`,而不是让一条 `@media` 规则在线上悄悄消失、门禁却全绿。esm/cjs 各一处。
护栏:`tools/tests/stylex-unplugin-patch.test.ts` 直接往共享规则表里放一条引用不存在常量的规则,
断言 build 语义抛错、dev 语义跳过、定义到齐后写出真正的 at-rule。

这是绕上游缺陷的临时方案,不是最终修法:它靠 `/^var\(--([^)]+)\)/` 从**生成结果字符串**猜"这是一条
未解析的常量引用"——只看 `ltr`、只看开头第一个 `var()`、`known` 只说明定义规则出现过、
rule metadata 结构一变就失效;而且 dev 下的"跳过"会把真正的解析 bug 也暂时变成"CSS 消失"。
上游正确的修法应在规则收集 / 依赖层:transform 时记下"规则 A 依赖常量 X",X 未到就标 pending,
定义 X 的模块 transform 后解析 pending 规则再重生成样式表,而不是事后解析字符串。
移除条件:上游在依赖层处理常量的收集顺序(或改为 transform 期内联)并升级到含修复的版本。

## 条件键的实查边界(2026-08-28,编译产物验证)

`stylex.create` 的条件键支持范围比想象宽,但结论一律以**编译出的 CSS** 为准,不以文档为准。

- **`:has()` 可用**。`':has(> svg)'`、`':has([data-slot="alert-action"])'` 都正常编译,选择器形如
  `.x888gsh:has( > svg){grid-template-columns:auto 1fr}`(注意 `(` 后有一个空格,写 grep 时会踩)。
  自定义属性也可以按 `:has()` 分支取值,于是「父元素知道、子元素问不到」的情形有了不引入 JS 的解法:
  父元素条件性地写 `--q-alert-title-column`,子元素读它。alert 的图标栅格与 table 的复选框列
  就是这样从 theme.css 迁进组件的。
- **`null` 不是「解除」而是「不生成这条声明」**。`maxWidth: { default: '20rem', [WIDE]: null }` 在宽屏
  下仍然是 20rem——因为宽屏分支根本没有声明,默认那条继续生效。要在某个条件下取消上限,必须显式
  写 `'none'`。(alert-dialog 的窄屏上限踩过:宽屏本该 448,实测 320。)
- 已确认的其他条件键:同元素属性选择器、`:not()`、伪元素读宿主状态、`@media`。**取值相同的条件会被
  合并成一条规则**,所以源码顺序不构成优先级,互斥判据要写成互斥的。

判断一条规则能不能进组件,只有一个标准:**它作用的元素是不是这个组件自己渲染的**。
`:has()` 把「自身盒子里有什么」变成可问的,但后代选择器仍然不可表达——
`[data-slot='alert'] > svg` 这类指向调用方所写元素的规则,只能留在 theme.css。
