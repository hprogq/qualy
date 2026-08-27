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

patch(`patches/@stylexjs__unplugin@0.19.0.patch`)在 setInterval 后补一行 `interval.unref?.()`,
两个构建产物(esm/cjs)各一处。移除条件:上游修复该 timer 泄漏并升级到含修复的版本。

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
