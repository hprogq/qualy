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
