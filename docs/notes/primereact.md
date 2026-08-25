# PrimeReact 11 实查记录

版本:@primereact/ui、@primereact/core 11.1.0,@primeuix/themes 3.0.0(catalog)。
UI 平台迁移接入期(docs/ui-platform-migration.md)实查。

## NodeNext 下 @primereact/core 的类型声明缺陷

`@primereact/core` 的 exports map 用 `import` 条件把 `index.d.ts` 与 `index.mjs` 配对,
TS(NodeNext)因此按 ESM 语义读它的声明文件;而这些 d.ts 内部却是 CJS 风格的无扩展名
相对导入,且文件名带内点(`./PrimeReact.context` → `PrimeReact.context.d.ts`)。TS 把
`.context` 当扩展名剥掉、解析失败,`export *` 静默丢弃——`PrimeReactProvider` 从
`@primereact/core` 与 `@primereact/core/config` 的类型面上消失(TS2305),运行时导出完好。
`--traceResolution` 实证:`Module name './PrimeReact.context' was not resolved`。

`@primereact/ui` 是 `"type": "module"` 且声明文件名无内点,同结构不触雷(`@qualy/ui`
的 button 探针类型检查通过)。`@primereact/types` 的 `core/index.d.ts` 同样全是带内点的
`export type * from './Config.types'`,跨包引用其具名类型同风险。

处置:`apps/web/src/primereact-config.d.ts` 用模块增补补回 Provider 一个符号,类型面
自包含(不引 @primereact/types),文件内写明移除条件(删文件跑 `pnpm typecheck` 全绿
即可移除)。M3 起大量使用 Prime 组件时若再遇同类缺口,先查本条,统一在该 shim 扩充,
不要散布 as any。

## Provider 行为(实测)

- theme CSS(`--p-*` 变量与组件样式)**按需注入**:provider 挂载本身不注入,首个 Prime
  组件渲染时才出现(浏览器测试里渲染 Button 后 `--p-primary-color` 可见;真实应用
  M1 阶段无 Prime 组件,`--p-*` 为空)。boot 不为未用的组件付费。
- license 缺失:console 警告 `[PrimeUI] PrimeUI license is not configured.`,并在页面
  右下角渲染常驻 "Invalid PrimeUI License" 徽标;样式功能不受影响,测试可在无 key
  环境跑。key 经根 .env 的 `VITE_PRIMEUI_LICENSE` 注入(client 配置值,非服务端 secret)。
- `definePreset(Aura, ...)` 的 token 值可以直接写 `var(--q-*)` 字符串,CSS 层间接生效;
  `.dark` 翻转经两条路:--q-* 自身翻转 + `darkModeSelector: '.dark'` 管 Aura 自有的
  分 scheme token。

## M3 适配器实查沉淀(2026-08-25)

- **cascade layer 是共存期的承重墙**:Prime 运行时 CSS 无层注入会压过一切有层规则
  (实测:调用方按钮上的 `min-[84rem]:hidden` 失效);而 `cssLayer` 只给 name 时,Prime
  把 `@layer primereact` 声明插到 `<head>` 最前,首declare = 最低层,被 Tailwind preflight
  反压(实测:按钮背景全透明)。正解:`cssLayer.order` 携带完整层序
  `theme, base, primereact, components, utilities`,app.css 里有同一句给生产 asset。
- **optimizeDeps.include 必须逐子路径预注册**:@primereact 子路径若在测试/开发中途才被
  发现,vite mid-run re-optimize 会给部分模块第二份 React(invalid hook call;曾造成
  56 个并行测试失败)。每迁一个组件,vite.config 与 vitest.browser.config 同步加条目。
- **role 元素变了,事实属性要跟着走**:Radix 的 role 在根元素,Prime 的 role 在内部原生
  input。调用方放在组件上的 `data-*`/`aria-*`(测试按 role 定位后读取)必须经 `pt.input`
  转发到 input,否则 role 与事实分家(batch-admin 实测红过)。
- **Prime Skeleton 用内联 style 定尺寸**(默认 100%×1rem),会压过调用方工具类;适配器
  传空串置空,尺寸仍归 className。
- **无 severity 的产品 variant**(badge 的 outline/ghost/link、按钮的 soft destructive)
  统一走 preset 的组件 css,键在适配器写的 `data-variant` 上;不往业务层漏 Prime 词汇。
- license 警告是**每个组件挂载一条**,测试并行时刷屏到拖垮 runner;harness 与独立测试
  一律传 license(vitest 配置 envDir 指仓库根)。
