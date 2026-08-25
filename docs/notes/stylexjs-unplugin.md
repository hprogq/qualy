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
