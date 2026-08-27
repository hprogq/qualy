# ADR 0010:commodity widget 底座选 Mantine 9,产品样式归 StyleX

- 状态:**已接受**(2026-08-26)
- 相关:docs/ui-platform-migration-mantine.md(执行设计)、docs/ui-platform-migration.md(被取代的 PrimeReact 设计,历史保留)、docs/notes/primereact.md(实查记录)、git tag `ui-prime-m4-checkpoint`(冻结的 PrimeReact 实验分支)

## 背景

Web 前端的样式底座原是 Tailwind CSS + shadcn 风格组件 + Radix primitives。它有三个结构性负担:Tailwind 的 `@source` 扫描横跨全部插件目录,使样式引擎成为平台级运行时;`@qualy/ui` 同时承担通用控件、产品语义组件与专用交互件三层职责而无清晰分界;组件视觉靠逐组件的 utility 类字符串维护。目标架构是:成熟的 commodity widget 库承担通用控件,StyleX 承担产品布局与视觉,`@qualy/ui` 是业务代码与任何第三方库之间的唯一边界。

第一次尝试选择 PrimeReact 11 Styled + StyleX(设计见 docs/ui-platform-migration.md),按里程碑推进到 M4(overlay 家族)约一半后中止。该实验分支完整保留于 tag `ui-prime-m4-checkpoint`。

## PrimeReact 迁移实证发现(M0–M4,均可在冻结分支复现)

以下为客观工程事实,不含审美判断:

1. **类型分发在 NodeNext 下失效**:`@primereact/core` 的 exports map 以 `import` 条件把 CJS 味的 `.d.ts` 配给 ESM 产物,内部又用带内点文件名的无扩展名相对导入(`./PrimeReact.context`),TS 解析失败后 `export *` 静默丢弃 `PrimeReactProvider` 等符号(`--traceResolution` 实证),需要消费端模块增补 shim。
2. **表单安全缺陷**:全部 Trigger/Close 组件渲染原生 `<button>` 而不设 `type`,在 `<form>` 内默认 `type="submit"`——点击 Select 触发器即提交表单(org-admin 双次 create 实测)。七个适配器逐一补 `type="button"`。
3. **compound 层不自足**:Checkbox 的 Indicator 内容不随选中态显隐(未选中渲染深色勾);indeterminate 在根元素无任何状态类;Select 的 `Option` 不是自注册的组合件,而是根上 options 数组的视图(按 `index`/`uKey` 反查),保持既有 compound API 需要遍历 children 重建数组、把触发器样式提升到根、自渲染回显。
4. **属性所有权冲突**:库覆写消费者传入的 `data-slot`,popup 根上部分 `data-*` 不落地;测试"按 role 定位后读事实属性"的契约需经 `pt` 转发补偿。
5. **CSS 层序陷阱**:运行时注入的无层 CSS 压过一切有层规则(调用方响应式类失效,实测);`cssLayer` 只给 name 时,首发的 `@layer` 声明使其沉到 Tailwind preflight 之下(按钮背景被清空,实测)。需以完整层序字符串双写(运行时 + 构建产物)。
6. **主题渗漏**:Aura 的 primary 调色板默认 emerald,仅覆写 `primary.color` 不阻断 `{primary.50}` 类引用,高亮渗绿;需按 noir 方式整阶映射。
7. **官方习语依赖 Tailwind**:官方示例以 Tailwind 类表达关键行为(如 `data-unselected:invisible` 控制选中指示器占位),与本迁移"最终移除 Tailwind"的目标相抵。
8. **成熟度**:`@primereact/ui` 首个 stable(11.0.0)发布于 2026-07-15,决策时全历史仅两个 stable 版本;v11 是全量重写,上述各项与"重写初版"的特征一致。
9. **商业授权是运行时依赖**:Styled 模式无 license key 时在页面渲染常驻水印,key 须进入客户端构建管线。
10. **每个复合组件(Button 之外)在迁移中至少暴露一处库级问题**;适配器合计约 1,900 行,其中相当比例是对上述各项的补偿逻辑。

## Mantine spike(同契约对照)

在独立 worktree 中以 Mantine 9.5.2 重放 Prime 侧被钉住的同一批契约:Button(含 asChild 多态)、Select(compound,选项 children 注册、描述行、对话框内选值不误提交)、Modal A→B 交接、Drawer 右侧 + Escape、Popover-in-Modal 的 Escape 分层、Menu、Tooltip、暗色翻转、StyleX 压层。结果 9/9 通过;适配器约 340 行覆盖七个组件族;首跑 5/9,全部失败可归因于本方 spike 代码错误或文档内的既定机制(`trapFocus`、`data-mantine-stop-propagation`),未发现库级缺陷。官方分发含 `styles.layer.css`(全部样式包于 `@layer mantine`),与既有层序架构直接咬合。局限:spike 未覆盖主题密度调校与全部表单件,Escape 分层需两个显式配置项。

成熟度对照:Mantine 当前架构线(CSS modules + CSS 变量)自 2023-09 的 v7 延续,9.0(2026-03)后五个月内 17 个版本,发布节奏稳定;MIT 许可。

## 决定

1. commodity widget 底座采用 **Mantine 9**;PrimeReact 实验冻结为只读历史与 salvage 来源。
2. **Mantine 只做 commodity widgets**(Button/Input/Checkbox/Radio/Select-Combobox/Modal/Drawer/Popover/Tooltip/Menu/Tabs 等),经 `@qualy/ui` 封装;业务插件不得直接 import `@mantine/*`。
3. **StyleX 承担产品布局与视觉**;Mantine 的 AppShell/Container/Grid/Group/Stack/Flex/Box 等不作为全产品布局 DSL;style props 不作为主样式方法。
4. **Qualy ThemeProvider 仍是 light/dark/system 唯一真相源**;Mantine 经 `forceColorScheme` 桥接,不建立第二套持久化主题状态。
5. 本次 pivot **不迁** `@mantine/form`、`@mantine/dates`、dropzone、notifications;Sonner/Motion/react-dropzone/PhotoView/resizable/DateTimePicker/tree-selection algebra 照 C 类保护;不借 pivot 做 API redesign。

## 代价与权衡

正面:成熟稳定的控件基线、静态分层 CSS 与 StyleX 层序可预期、源码可读利于归因、适配器显著更薄、无商业授权运行时依赖。
负面:适配层仍是 Mantine 特定的维护面;无内置重型 DataGrid(未来重表格另评 TanStack Table + StyleX);必须持续约束布局 DSL 与 style props 的扩散;产品设计仍完全由 Qualy 自持。

## 重新评估条件

仅在模式级证据下重开选型:核心控件缺陷反复出现且上游不修;无法干净修复的可访问性缺口;与工具链(NodeNext/Vite/StyleX)的持续不兼容;适配器日益依赖库内部实现;Mantine 泄漏进业务层无法遏制;产品需求发生根本变化(如重型数据网格成为核心场景)。M4M 是正式的第二次 Go/No-Go;通过之后再次更换底座的门槛必须显著更高。

## 后续变更

**`@mantine/dates` 已采纳**(2026-08-27,推翻决定 5 中「本次 pivot 不迁 dates」那一项)。

日期子系统原判定是 KEEP(react-day-picker + date-fns),理由是它属于 C 类保护件。实际动手时理由不成立:
两个日期控件的公开契约是**无时区字符串**(区间 `YYYY-MM-DD`,时刻 ISO instant),而 Mantine 的 dates
本身说的就是无时区字符串,与本仓存储格式同形——日期一路不经过 `Date`,唯一的换算是 instant ↔ 墙上时间,
集中在一个有单元测试的模块里。继续留着 react-day-picker 反而要维护两套日历外观与两套语言真源。
代价:多一个 Mantine 包的静态 CSS(见 §性能),以及区间绘制要绕开「隐藏日不触发 `:has()` 重跑」
这一浏览器行为(过程记录在 STATUS.md)。

其余四条决定不变;`@mantine/form`、notifications、dropzone 仍未引入。
