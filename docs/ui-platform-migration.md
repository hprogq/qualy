# Qualy UI Platform Migration Design

> **目标**：将 Qualy Web UI 平台从当前的 Tailwind CSS + shadcn 风格组件 + Radix primitives，渐进迁移到 **PrimeReact 11 Styled + StyleX**，同时保留 Qualy 已形成的产品 UI 抽象、插件边界、路由/权限架构、业务交互语义和浏览器测试契约。

---

## 0. 文档状态与源码基线

本设计基于对 `hprogq/qualy` 当前 Web/UI 架构的源码阅读，基线 commit：

```text
af2c71ab728c2fcfb841a97fda27b90081f3b2e1
```

实施前必须先检查当前 HEAD。若当前代码已变化：

1. 以当前代码为准重新确认文件路径、exports、依赖和测试；
2. 保持本设计中的**架构边界、迁移原则、阶段划分和验收标准**；
3. 不要为了机械匹配本文路径而回退或覆盖后续代码；
4. 若出现与本设计根本冲突的新架构，先记录差异，再调整执行细节，不要擅自改变迁移目标。

当前关键文件：

```text
apps/web/src/App.tsx
apps/web/src/main.tsx
apps/web/src/app.css
apps/web/vite.config.ts
vitest.browser.config.ts

packages/web/ui/package.json
packages/web/ui/src/styles/theme.css
packages/web/ui/src/components/admin.tsx
packages/web/ui/src/components/screen.tsx
packages/web/ui/src/components/button.tsx
packages/web/ui/src/components/dialog.tsx
packages/web/ui/src/components/select.tsx
packages/web/ui/src/components/field.tsx
packages/web/ui/src/components/table.tsx
packages/web/ui/src/components/tree-select.tsx
packages/web/ui/src/components/date-time-picker.tsx
packages/web/ui/src/components/dropzone.tsx
packages/web/ui/src/components/reveal.tsx
packages/web/ui/src/lib/modal-guard.ts

packages/web/runtime/src/index.tsx
packages/web/runtime/src/theme.tsx

packages/plugins/base/layout-default/src/client/TopBar.tsx
packages/plugins/base/layout-default/src/client/WorkspaceShell.tsx
packages/plugins/base/rbac/src/client/RoleEditor.tsx
packages/plugins/base/auth/src/client/iam/UsersPage.tsx
packages/plugins/assessment/core/src/client/PhaseTimelineEditor.tsx
packages/plugins/assessment/core/src/client/review/ReviewInstancePage.tsx

apps/web/tests/*.browser.test.tsx
```

---

# 1. 背景

Qualy 当前的 `@qualy/ui` 已经不只是 shadcn primitives 的集合。

它同时承担三层职责：

1. **通用控件层**：Button、Input、Dialog、Select、Checkbox、Tabs、Tooltip 等；
2. **Qualy 产品 UI 层**：`admin.tsx`、`screen.tsx`、PageContainer、Person、Timeline 等；
3. **专用交互组件层**：DateTimePicker、TimeField、TreeSelect、Dropzone、Reveal、PhotoView 等。

与此同时 Tailwind 已经从 `@qualy/ui` 扩散到：

- `apps/web`；
- `packages/web/runtime`；
- layout plugin；
- IAM / RBAC；
- assessment；
- 其他业务插件。

当前 `apps/web/src/app.css` 必须显式 `@source` 整个 plugin tree，说明 Tailwind 已经是 Web 平台级 styling runtime，而不是单纯的 shadcn 实现细节。

因此本次工作不是“替换几个组件”，而是一次：

> **UI Platform Migration**

---

# 2. 总目标

迁移完成后的目标结构：

```text
业务页面 / 插件
    │
    ├── Qualy 产品 UI（@qualy/ui/admin、screen、specialized）
    │       │
    │       ├── StyleX：页面布局、产品语义、Qualy 专用视觉
    │       └── PrimeReact adapters：通用 widget
    │
    └── StyleX：仅用于业务页面本身的布局与视觉

PrimeReact 11 Styled
    └── 仅作为 @qualy/ui 内部通用控件实现

ThemeProvider
    ├── 继续拥有 light / dark / system
    ├── 继续使用 document.documentElement.dark
    └── PrimeReact darkModeSelector = '.dark'
```

最终应删除：

```text
tailwindcss
@tailwindcss/vite
shadcn
tw-animate-css
radix-ui                 # 若无剩余必要用途
class-variance-authority # 若无剩余必要用途
tailwind-merge
```

但这些依赖只能在最后阶段、确认无使用后删除。

---

# 3. 非目标

本次迁移**明确不做**以下事情。

## 3.1 不重做信息架构

不修改：

- Page / Layout Contract / Layout Provider / Collection / Slot / Theme 的 Composition Runtime 模型；
- app-shell / workspace-shell 的语义；
- manifest 驱动的页面与导航；
- Batch 工作区路由模型；
- RBAC / capability / authorization 逻辑。

UI library migration 不应演变成路由或插件架构重写。

## 3.2 不同时重新设计所有页面

允许新控件因为 PrimeReact Styled 产生系统性的视觉变化。

不允许借迁移机会：

- 改页面信息层级；
- 改业务流程；
- 改按钮含义；
- 改表单语义；
- 改桌面/移动端核心交互模型；
- 把现有专用页面套成 PrimeReact Demo 风格。

## 3.3 不追求“PrimeReact 纯度”

以下第三方库默认保留：

```text
lucide-react
motion
react-dropzone
react-photo-view
react-resizable-panels
sonner
```

PrimeReact 是 commodity widget provider，不是整个前端的唯一依赖来源。

## 3.4 不把所有 Table 换成 DataTable

`@qualy/ui/table` 当前是轻量 semantic table。

只有真正需要以下能力的场景才考虑 PrimeReact DataTable：

- sorting；
- filtering；
- pagination；
- row selection；
- cell editing；
- frozen columns；
- resizing；
- server-side data grid behavior。

简单 table、timeline table、静态属性表继续使用轻量实现。

## 3.5 不在第一轮重写专用业务组件行为

首轮必须保留：

- DateTimePicker；
- TimeField；
- TreeSelect selection algebra；
- Dropzone rejection contract；
- Review Workbench interaction；
- Motion / reveal behavior。

可替换内部 primitive，但不得改变它们的业务 API 与测试语义。

---

# 4. 核心架构原则

## 4.1 PrimeReact 不得成为业务层 API

### 强制依赖规则

业务插件不得直接 import：

```text
@primereact/*
@primeuix/*
primereact/*
```

允许范围：

```text
packages/web/ui/**
apps/web/src/App.tsx       # PrimeReactProvider，仅此类 platform wiring
```

业务代码应继续使用：

```ts
import { Button } from '@qualy/ui/button'
import { FormDialog } from '@qualy/ui/admin'
import { Segmented } from '@qualy/ui/screen'
```

而不是：

```ts
import { Button } from '@primereact/ui/button'
```

原因：

```text
业务 → @qualy/ui → PrimeReact
```

必须保持可替换性。

---

## 4.2 StyleX 可以直接用于业务页面

StyleX 是 styling compiler，不是产品 widget API。

业务插件可以：

```ts
import * as stylex from '@stylexjs/stylex'
```

用于页面布局、局部视觉和 responsive behavior。

但应优先使用 Qualy semantic tokens，而不是在各页面重复硬编码颜色、圆角和 focus ring。

---

## 4.3 `admin.tsx` / `screen.tsx` 是产品层，不是旧组件包袱

以下 API 默认保留：

```text
@qualy/ui/admin
  PageHeader
  Panel
  AsyncSection
  Feedback
  Field
  RequiredMark
  CheckboxGroup
  RadioGroup
  FormDialog
  SidePanel
  ConfirmDialog

@qualy/ui/screen
  Screen
  Segmented
  SectionHead
  Facts
  DefRow
  Barred
  EditorHead
  ModeChoice
  PickGrid
  PickList
  SaveBar
  Blank
  ...
```

允许内部重构文件结构。

禁止让调用方为了 PrimeReact 改成大量 library-specific props。

---

## 4.4 行为兼容优先于 DOM 兼容

迁移时必须保持：

- accessible role；
- accessible name；
- keyboard behavior；
- focus behavior；
- open / close semantics；
- loading / error / retry states；
- URL / query state；
- mutation results；
- test IDs 中明确属于产品 contract 的部分。

不要求保持：

- Radix `data-state`；
- shadcn DOM nesting；
- Tailwind class string；
- 内部 portal structure。

Browser tests 若依赖 implementation detail，应只在确认行为等价后调整。

---

# 5. 技术选型

## 5.1 PrimeReact 版本与模式

目标：**PrimeReact 11 Styled mode**。

当前官方 Vite Styled 安装使用：

```text
@primereact/ui
@primereact/core
@primeuix/themes
```

禁止混用旧版本 API 或旧 import 风格。

统一使用子路径 import，例如：

```ts
import { Button } from '@primereact/ui/button'
import { Select } from '@primereact/ui/select'
import { PrimeReactProvider } from '@primereact/core'
import Aura from '@primeuix/themes/aura'
import { definePreset } from '@primeuix/themes'
```

不要为了示例代码引入 `@primeicons/react`；Qualy 继续统一使用 Lucide。

### License

PrimeReact 11 Styled 当前需要通过 `PrimeReactProvider` 提供 PrimeUI license。

实现要求：

- 代码只接受配置值；
- 不提交真实 key；
- 不把 key 写入测试 fixture；
- license 获取、采购与法律决策不属于本迁移设计；
- 若本地/CI 必须存在 key 才能完成 styled verification，使用项目既定环境配置机制注入。

注意：该 license 按官方使用方式存在于 client provider 中，因此不要把它错误当作服务器 secret 来设计后端 secret exchange。

---

## 5.2 PrimeReact Theme

建立：

```text
packages/web/ui/src/theme/qualy-preset.ts
packages/web/ui/src/theme/prime.ts
```

基础 preset：

```text
Aura
```

第一阶段只定制：

- primary / neutral relationship；
- surfaces；
- form field；
- focus ring；
- border radius；
- component density 中确有必要的少量差异。

不要第一阶段创建庞大的 token catalog。

### Dark mode

必须：

```ts
options: {
  darkModeSelector: '.dark'
}
```

继续由现有 `ThemeProvider` 控制：

```text
light
dark
system
localStorage
prefers-color-scheme
.documentElement.classList.toggle('dark', ...)
```

不要创建第二套 PrimeReact theme state。

---

## 5.3 Qualy semantic tokens

新增稳定的 Qualy semantic CSS custom properties，建议使用 `--q-*` 命名。

例如：

```text
--q-background
--q-foreground
--q-surface
--q-surface-muted
--q-surface-elevated
--q-border
--q-input
--q-focus-ring
--q-primary
--q-primary-foreground
--q-danger
--q-danger-foreground
--q-muted-foreground
--q-radius-sm
--q-radius-md
--q-radius-lg
```

### 共存期

当前 shadcn/Tailwind variables 保留并映射到 Qualy tokens：

```css
--background: var(--q-background);
--foreground: var(--q-foreground);
--border: var(--q-border);
...
```

这样旧 Tailwind 页面和新 StyleX 页面可以同时存在。

### StyleX token layer

建立 `.stylex.ts` token 文件，例如：

```text
packages/web/ui/src/theme/tokens.stylex.ts
```

通过 `stylex.defineVars` 暴露 Qualy semantic tokens，值引用稳定的 `--q-*` custom properties。

业务 StyleX 不应直接依赖 PrimeReact 私有/生成 token 名称。

### PrimeReact alignment

`QualyPreset` 只在需要跨系统视觉一致的 token 上使用同一组 Qualy values；其余 widget-specific token 让 Aura 自己提供默认值。

不要为了让所有 PrimeReact token 都由 Qualy 控制而复制整个 Aura preset。

---

# 6. StyleX 集成设计

使用：

```text
@stylexjs/stylex
@stylexjs/unplugin
```

如项目已有 lint 基础设施并适合接入，再增加：

```text
@stylexjs/eslint-plugin
```

不要仅为了此次迁移引入一套全新的 ESLint 流程。

## 6.1 Vite

`apps/web/vite.config.ts` 中 StyleX Vite plugin 必须位于 React plugin 之前。

迁移共存期：

```ts
plugins: [
  qualyPlugins(),
  stylex.vite({
    useCSSLayers: true,
    dev: process.env.NODE_ENV !== 'production',
    runtimeInjection: false,
  }),
  react(),
  tailwindcss(),
]
```

最终阶段删除 `tailwindcss()`。

Qualy 当前以 `apps/web/index.html` 为 Vite HTML entry，因此按 StyleX 官方 Vite 说明，不应额外引入 React-entry 专用的 `DevStyleXInject` workaround，除非实际 HMR 验证证明需要。

## 6.2 Browser Vitest

`vitest.browser.config.ts` 必须同步加入 StyleX Vite plugin，并保持在 React plugin 前。

原因：浏览器测试必须运行与生产 Vite pipeline 等价的 StyleX 编译，否则测试可能在未加载真实样式的环境中假通过。

## 6.3 CSS entry

保留：

```text
apps/web/src/app.css
```

StyleX Vite plugin 会把生成 CSS 聚合进 Vite CSS asset；`app.css` 继续承担：

- global reset；
- font；
- third-party global CSS import；
- migration compatibility variables。

最终 `app.css` 不再承担 Tailwind source scanning。

---

# 7. `@qualy/ui` 分层目标

不要求一次移动所有文件，但最终概念上应形成：

```text
packages/web/ui/src/
├── components/
│   ├── commodity/       # PrimeReact adapters
│   ├── admin/           # Qualy product semantics
│   ├── screen/          # Qualy screen language
│   └── specialized/     # product-specific controls
├── hooks/
├── lib/
├── theme/
└── styles/
```

**公共 exports 路径尽量保持不变**。

例如内部可以从：

```text
components/admin.tsx
```

拆成：

```text
components/admin/page.tsx
components/admin/async.tsx
components/admin/field.tsx
components/admin/dialog.tsx
components/admin/index.ts
```

但仍保持：

```ts
import { Field, FormDialog } from '@qualy/ui/admin'
```

---

# 8. 组件迁移分类

以下分类是默认策略。只有经过源码阅读和测试证明后才允许改变类别。

## 8.1 A 类：PrimeReact commodity adapters

优先迁移：

```text
button
input
textarea
checkbox
radio-group
select
dialog
alert-dialog
sheet → Drawer
popover
tooltip
dropdown-menu
avatar
badge/tag
skeleton
tabs
pagination
button-group
separator/divider
scroll-area
```

原则：

- 保持 `@qualy/ui/*` public API；
- 内部使用 PrimeReact；
- 尽量通过 Prime theme tokens 实现视觉，不通过深层 CSS selector 魔改 Prime DOM；
- Lucide icon 作为 children 继续使用。

## 8.2 B 类：Qualy 自有结构组件，StyleX 重写

```text
page-container
admin
screen
person
ticker
timeline
alert / feedback 外壳
empty
kbd
```

这些组件主要表达 Qualy 产品语义，不应该为了 PrimeReact 改成 library-native API。

## 8.3 C 类：专用控件，保留行为并渐进替换内部 primitive

```text
calendar
date-picker
date-range-picker
date-time-picker
time-field
tree-select
dropzone
photo-view
resizable
portal
reveal
```

首轮只允许：

```text
Tailwind → StyleX
Radix primitive → Prime primitive（仅在行为完全等价时）
```

不允许直接替换整个产品组件。

## 8.4 D 类：Native control

`native-select` 若确实用于需要浏览器原生 `<select>` 的场景，则保留 native implementation，不要为了统一而换 Prime Select。

---

# 9. 关键组件兼容设计

## 9.1 Button

当前 Qualy Button contract：

```text
variant:
  default
  outline
  secondary
  ghost
  destructive
  link

size:
  default
  xs
  sm
  lg
  icon
  icon-xs
  icon-sm
  icon-lg

asChild
```

PrimeReact mapping 目标：

```text
default      → default
outline      → variant="outlined"
secondary    → severity="secondary"
ghost        → variant="text"
destructive  → severity="danger" + appropriate visual variant
link         → variant="link"
```

尺寸由 Qualy adapter 统一映射，不允许业务代码开始使用 Prime 的 `small|normal|large` 语义。

### `asChild`

PrimeReact Styled Button 支持 polymorphic `as`，但当前 Qualy `asChild` API 与其并不完全相同。

迁移策略优先级：

1. 搜索所有 `Button asChild` 调用；
2. 若数量小且语义清晰，迁移调用点到新的 Qualy polymorphic API；
3. 若数量大，先在 adapter 保留 `asChild` compatibility；
4. 不要仅为了 compatibility 永久保留整个 Radix dependency；
5. 最终 Radix Slot 是否保留由实际剩余 usage 决定。

不要在第一阶段同时改所有 router/link semantics。

---

## 9.2 Dialog / FormDialog / ConfirmDialog

PrimeReact Dialog 11 提供 compound primitive、focus management、focus trap、scroll lock 与 dismiss behavior。

迁移分两层：

```text
@qualy/ui/dialog
    Radix → PrimeReact Dialog

@qualy/ui/admin
    FormDialog / ConfirmDialog 保持产品 API
```

必须保持：

- controlled open state；
- escape close；
- click outside policy；
- focus restore；
- title / description accessibility；
- header/body/footer structure；
- long form body scroll、footer 可达；
- `restfulFocus` 的产品语义；
- closing animation 期间 ConfirmDialog 文案不丢失。

若 Prime API 无法直接表达 `restfulFocus`，可以在 adapter 中增加最小兼容逻辑，但不得把 workaround 扩散到业务调用方。

---

## 9.3 Sheet → Prime Drawer

`@qualy/ui/sheet` public API 可保留，但内部使用 PrimeReact Drawer。

必须验证：

- right side panel；
- mobile full-width；
- footer；
- scroll area；
- close behavior；
- nested PhotoView；
- focus restore。

`admin.SidePanel` public contract 不变。

---

## 9.4 Select

当前 Qualy Select 已经是 compound API，并支持 option description。

目标：继续允许类似：

```tsx
<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="x" description="...">
      X
    </SelectItem>
  </SelectContent>
</Select>
```

内部改成 PrimeReact 11 Select compound components。

必须保持：

- controlled value；
- empty/sentinel use cases；
- trigger accessible name；
- disabled option；
- item description；
- portal positioning；
- keyboard selection；
- nested dialog behavior。

不要要求业务页面改写为 `options/optionLabel/optionValue` 数据 API，除非单独证明该页面因此明显更简单且没有损失现有语义。

---

## 9.5 Table

保留 `@qualy/ui/table`。

迁移 Tailwind 样式到 StyleX 或普通局部 CSS，不使用 Prime DataTable 作为默认实现。

DataTable 必须按**页面需求**显式采用，而不是成为 `Table` adapter 的内部实现。

---

## 9.6 Field

`field.tsx` 不允许机械 class-by-class 转译。

当前组件包含：

- orientation；
- responsive/container-query behavior；
- nested label；
- checkbox/radio alignment；
- field descriptions；
- error dedupe；
- ARIA semantics。

迁移时应重新明确 DOM parts：

```text
FieldRoot
FieldLabel
FieldContent
FieldControl
FieldDescription
FieldError
```

StyleX 样式优先由明确 props/state 决定，不要重新制造依赖复杂 descendant selector 的 StyleX 版本。

---

# 10. 专用组件保护规则

## 10.1 DateTimePicker

禁止首轮整体替换成 Prime DatePicker。

现有 contract 包括：

- value 是 ISO instant / null；
- 选择日期时保留时间；
- 未选择日期先输入时间时，以今天为日期；
- hour/minute/second 独立 typed boxes；
- 连续输入自动移动 focus；
- impossible prefix 自动完成；
- ArrowUp/ArrowDown wrap；
- 选日期后 panel 保持打开；
- clear action。

上述行为已有 browser tests，应视为产品 contract。

第一轮最多：

```text
Popover → Prime Popover
Calendar styling → StyleX
Button → adapter
```

TimeField 与核心 date/time arithmetic 保持不变。

## 10.2 TreeSelect

Qualy TreeSelect 并不是普通 tree widget。

它的 value 是“最小 subtree cover set”，具有：

- 父节点 cover whole subtree；
- untick child 会拆分 cover；
- indeterminate based on descendant selection；
- selection algebra 由 `tree-selection.ts` 管理。

因此禁止直接换 Prime TreeSelect。

允许替换：

```text
Checkbox primitive
Collapsible primitive
visual styles
```

不得更改 selection math。

## 10.3 Dropzone

继续使用 `react-dropzone`。

必须保留 Qualy rejection contract：

```text
too-large
type
too-many
```

业务层继续负责本地化文案。

## 10.4 Sonner

第一轮保留 Sonner。

理由：

- API 已扩散；
- 行为稳定；
- 替换没有直接降低 Tailwind/Radix 耦合；
- Prime Toast 并非此次核心收益来源。

如果迁移全部完成后另有统一 notification 的产品理由，再单独设计。

## 10.5 Motion / Reveal

保留 `motion`。

不要将产品动画换成 Prime animation 仅为了统一 library。

---

# 11. Overlay 历史问题与回归要求

当前 Qualy 存在 `modal-guard.ts`，用于处理 Radix modal 交接时 body 遗留：

```css
pointer-events: none;
```

的历史问题。

`theme.css` 还存在 PhotoView 与 modal portal pointer-events workaround。

这说明 overlay migration 是高风险区。

## 11.1 删除 workaround 的条件

以下全部通过后，才允许删除：

```text
modal-guard.ts
Radix data-state animation compatibility
PhotoView/Radix pointer workaround
```

## 11.2 必须新增/保留的 browser regression

至少覆盖：

1. Dialog open → close → underlying page clickable；
2. Dialog A closing 时 Dialog B opening；
3. Drawer open → PhotoView open → viewer clickable；
4. Escape closes topmost overlay；
5. focus returns to trigger；
6. body scroll lock correctly releases；
7. Popover inside Dialog；
8. Select inside Dialog；
9. ConfirmDialog consecutive open/close；
10. mobile Drawer close/back behavior 不被破坏。

---

# 12. ThemeProvider 设计

现有 `packages/web/runtime/src/theme.tsx` 保留。

它继续负责：

```text
ThemeChoice = light | dark | system
qualy.theme localStorage
prefers-color-scheme
resolved theme
documentElement.dark
colorScheme
```

PrimeReactProvider 应被接入 App tree，但不取代 ThemeProvider。

推荐：

```tsx
<I18nProvider ...>
  <ThemeProvider>
    <PrimeReactProvider
      theme={qualyPrimeTheme}
      license={primeLicense}
    >
      <RuntimeProvider ...>
        <BrowserRouter>
          ...
        </BrowserRouter>
      </RuntimeProvider>
    </PrimeReactProvider>
  </ThemeProvider>
</I18nProvider>
```

不要让 `ThemeProvider` import PrimeReact。

平台边界应保持：

```text
web-runtime theme state
          ↓
document root .dark
          ↓
Prime theme + Qualy global tokens
```

---

# 13. 构建与代码分割要求

当前 `apps/web/vite.config.ts` 有经过明确设计的 code splitting，目的是减少大量极小 chunk 和移动网络 RTT 成本。

加入 PrimeReact 后：

1. 不要一开始重写现有 code splitting；
2. 不要无测量新增巨型 `vendor` chunk；
3. PrimeReact 使用 subpath imports；
4. M0、M3、M4 后记录 build output：
   - initial JS；
   - CSS；
   - 首屏请求数；
   - representative page lazy requests；
   - tiny chunk count；
5. 若 PrimeReact 导致明显 microchunk regression，再基于实际 build graph 调整 grouping。

任何 chunk policy 修改必须附带前后数据，而不是“组件库通常应该 vendor chunk”式猜测。

---

# 14. 迁移阶段

以下阶段必须按顺序执行。

允许一个阶段内拆多个 commit/PR。

禁止一次提交 M0-M9 全部内容。

---

## M0 — Infrastructure Coexistence

### 目标

PrimeReact + StyleX 成功进入构建系统，但现有页面行为与样式不变。

### 工作

1. 添加 PrimeReact Styled dependencies；
2. 添加 StyleX dependencies；
3. `vite.config.ts` 接入 StyleX before React；
4. `vitest.browser.config.ts` 同步接入；
5. 保持 Tailwind plugin；
6. 创建最小 StyleX probe；
7. probe 必须分别位于：
   - `packages/web/ui`；
   - 一个 workspace plugin；
8. 验证 monorepo symlink source 能被 StyleX 编译；
9. 验证 Vite HMR；
10. 验证 production build CSS emitted。

### 不做

- 不迁任何实际页面；
- 不删除任何旧依赖；
- 不修改 theme visual design。

### 验收

```text
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
```

全部 PASS。

同时人工确认 StyleX probe 在 dev 和 production build 都生效。

---

## M1 — Theme Bridge + Prime Provider

### 目标

建立 Qualy semantic tokens、Prime theme 和现有 ThemeProvider 的桥。

### 工作

1. 新建 `--q-*` semantic tokens；
2. 现有 shadcn vars alias 到 q tokens；
3. 建立 StyleX token file；
4. 建立 `QualyPreset = definePreset(Aura, ...)`；
5. Prime `darkModeSelector = '.dark'`；
6. App tree 加 PrimeReactProvider；
7. license 从配置注入；
8. 增加 theme smoke test：
   - Prime button styled；
   - StyleX element styled；
   - `.dark` 改变 computed visual；
   - 旧 Tailwind component 仍 styled。

### 验收

旧 UI 不应出现全局视觉破坏。

重点看：

```text
background
foreground
muted text
border
focus ring
destructive
popover/dialog surfaces
```

---

## M2 — Internal UI Package Restructure

### 目标

在不改变 public exports 的前提下，把巨型产品组件文件拆为可迁移单元。

### 工作

拆 `admin.tsx`、`screen.tsx`。

只重构文件，不改变：

- exported symbol；
- props；
- DOM behavior；
- styling；
- tests。

### 验收

全量测试无行为差异。

此阶段必须做到“纯重构”，不要夹带 Prime migration。

---

## M3 — Low-Risk Commodity Components

### 优先顺序

```text
Button
Input
Textarea
Checkbox
Radio
Avatar
Badge/Tag
Skeleton
Separator
ButtonGroup
```

### 原则

- adapter-first；
- public API 尽量不变；
- 不改业务页面；
- 单组件 browser test/smoke；
- 每迁一个组件搜全仓使用方式，不能只看组件文件。

### Button 特别任务

先统计 `asChild` 全部 usage，再决定 compatibility 实现。

### Go/No-Go checkpoint

M3 完成后检查：

- adapter 是否比旧 wrapper 更简单；
- Prime theme 是否稳定；
- StyleX 与 Prime 是否发生 cascade fighting；
- bundle 是否出现异常；
- browser tests 是否仍以 accessible semantics 驱动。

若此时基础架构已经明显恶化，停止继续迁移并修正架构。

---

## M4 — Overlay + Select

### 范围

```text
Dialog
AlertDialog
Sheet/Drawer
Popover
Tooltip
DropdownMenu
Select
ScrollArea（若适合）
```

### 高风险要求

每迁一个 overlay primitive，都运行 overlay regression。

### 完成条件

Radix modal-specific workaround 只有在新实现不再使用 Radix 且 regression 全绿后才能删除。

不要在同一 commit 中一边迁 Dialog 一边大规模改调用页面。

---

## M5 — Qualy Product UI → StyleX

### 范围

```text
PageContainer
PageHeader
Panel
AsyncSection
Feedback
Field
CheckboxGroup
RadioGroup
FormDialog
SidePanel
ConfirmDialog
Screen
Segmented
SectionHead
Facts
DefRow
EditorHead
ModeChoice
PickGrid
PickList
SaveBar
Blank
Empty
Person
```

### 原则

- 不改产品 API；
- Tailwind → StyleX；
- 复杂 selector 改成明确 state/part；
- 不为了 StyleX 创建大规模 helper DSL；
- 一般 styles 写在组件旁，shared semantic vars 写 theme。

### M5 验收

`admin` 与 `screen` 本身不应再依赖 Tailwind utility class。

---

## M6 — First Vertical Slices

这一步验证“业务页面 + Qualy product layer + Prime widgets + StyleX”完整组合。

### Slice 1：RBAC

优先：

```text
RolesPage
RoleEditor
NewRoleForm
```

RoleEditor 是首个完整 benchmark，因为它覆盖：

```text
AsyncSection
ConfirmDialog
Feedback
Field
FormDialog
DefRow
EditorHead
Facts
ModeChoice
PickGrid
PickList
SaveBar
Segmented
Button
Input
```

### RBAC Go/No-Go Gate

目标：RoleEditor 页面范围内：

```text
Tailwind dependency = 0（页面及其 Qualy product composition）
Radix dependency = 0（除尚未迁移且真正共享的 specialized primitive）
PrimeReact widgets 正常
StyleX layout 正常
light/dark 正常
browser tests PASS
```

只有通过后继续全仓。

### Slice 2：IAM Users

迁：

```text
UsersPage
PersonPane
OrgTree/NodePicker 周边 UI
```

注意：Users roster 保持 clickable roster，不强改 DataTable。

### Slice 3：Layout Shell

迁：

```text
TopBar
SectionBar
WorkspaceShell
AppShell
mobile Drawer
rail
```

Shell 应主要使用 StyleX；Prime 只提供 Drawer/commodity controls。

不得用 Prime NavigationMenu 重写 manifest navigation model。

---

## M7 — Assessment Batch / Phase / Entry

### Phase A：Batch / Phase

```text
BatchScreen
Batch context bars
Batch overview
PhaseTimelineEditor
PhaseRow
PhaseDetailsPanel
PhaseDialogs
```

PhaseTimeline 保持轻量 Table，不换 DataTable。

### Phase B：Entry / Item

```text
Paper
EvidenceForm
Entry editor/dialog
MyEntries
StructureTable
FieldTable
item config UI
attachment UI
```

Dropzone / PhotoView 产品行为保持。

每个子域完成后跑对应 browser tests，不要等 assessment 全迁完才测试。

---

## M8 — Review Workbench + Remaining UI

Review Workbench 最后迁。

原因：

- multi-pane responsive layout；
- keyboard shortcuts；
- nested dialogs；
- tooltip；
- scroll areas；
- animations；
- deferred decisions；
- live updates；
- query-state queue；
- mobile pointer behavior。

迁移目标不是“Prime 化 Workbench”。

正确目标：

```text
Workbench product layout → StyleX
Button/Dialog/Tooltip/etc → Qualy adapters → PrimeReact
Motion → 保留
business state → 不动
```

### 验收重点

```text
review-layout.browser.test.tsx
entry-workflow.browser.test.tsx
paper-reading.browser.test.tsx
keyboard behavior
mobile layout
focus
undo/deferred decision
```

---

## M9 — Tailwind / shadcn / Radix Removal

只有当全仓业务迁移完成后执行。

### 必须先做 code search

以下应为 0，或有明确保留理由：

```text
@qualy/ui/cn
className="...Tailwind utilities..."
twMerge
class-variance-authority
radix-ui
@radix-ui/*
shadcn
tw-animate-css
@custom-variant
@theme
@apply
@source
tailwindcss
@tailwindcss/vite
```

### 删除

- Tailwind Vite plugin；
- app.css `@source`；
- shadcn stylesheet；
- Radix-specific animation custom variants；
- legacy modal workaround（仅已验证）；
- 无 usage 的 CVA/twMerge/clsx helper；
- 旧 theme aliases 若已无消费者。

### 不强求删除

若 `clsx` 仍有普通非 Tailwind class composition 用途，可以保留。

依赖删除必须基于 usage，而不是 checklist 强迫。

---

# 15. Vertical Slice 测试矩阵

迁移时优先复用现有 Browser Test Suite。

关键测试：

```text
batch-admin.browser.test.tsx
capability-scope.browser.test.tsx
date-time-picker.browser.test.tsx
entry-workflow.browser.test.tsx
identity.browser.test.tsx
item-chain.browser.test.tsx
localization.browser.test.tsx
login-methods.browser.test.tsx
org-admin.browser.test.tsx
paper-reading.browser.test.tsx
review-layout.browser.test.tsx
shell.browser.test.tsx
slots.browser.test.tsx
theme.browser.test.tsx
```

原则：

1. 测试首先保持不改；
2. 若因底层 DOM 不同失败，先判断测试是否描述产品行为；
3. 只有 implementation-specific selector 才可改；
4. 改测试时必须保持或增强 accessible behavior assertion；
5. 不允许通过降低断言强度换绿灯。

---

# 16. 测试策略

## 16.1 每个小组件 commit

至少：

```text
pnpm typecheck
对应 browser test / targeted test
```

## 16.2 每个 milestone

必须：

```text
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
```

若 milestone 涉及 vendor 或生成树：

```text
pnpm vendor:check
```

## 16.3 最终验收

```text
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
pnpm vendor:check
生产 smoke（若当前项目 smoke 流程可直接运行）
```

全部必须 PASS。

---

# 17. Accessibility 要求

PrimeReact 替换不得降低现有 accessibility。

特别检查：

```text
Field label ↔ input id
fieldset / legend
checkbox group
radio group
Dialog title/description
Alert role
button accessible names
icon-only button aria-label
Select trigger name
keyboard navigation
focus-visible
focus restore
inert/aria-hidden behavior
```

当前 Qualy 的 browser tests 大量通过 role/name 驱动，这是应保留的设计资产。

不要为了组件库 DOM 结构改成大量 `data-testid` 驱动。

---

# 18. i18n 要求

`@qualy/ui` 继续保持“尽量 text-free”。

组件可接受：

```text
label
hint
description
emptyLabel
loadingLabel
retryLabel
clearLabel
...
```

但不应在 `@qualy/ui` 内新增固定业务文案。

PrimeReact 自带 locale 文案若会出现在 Qualy 可见 UI 中，必须：

1. 接入 Qualy i18n；或
2. 显式通过 prop 覆盖；
3. 不允许页面出现一半中文、一半 Prime 默认英文。

---

# 19. Responsive 设计要求

迁移前已有明确 responsive behavior 的页面，不允许仅靠 Prime 默认响应式取代。

重点：

```text
WorkspaceShell 1024 breakpoint
mobile nav drawer
SidePanel mobile full-width
UsersPage desktop three-column
PhaseTimeline mobile/desktop dual renderer
Review Workbench beside/stacked
screen foot / navigation capsule
```

StyleX media query 应表达这些产品规则。

不要因为 Prime component 有 responsive props 就改掉页面当前交互模型。

---

# 20. CSS / StyleX 编码规范

## 20.1 优先顺序

1. Prime token/preset：Prime widget 自己的视觉；
2. StyleX：Qualy product/component/page visual；
3. global.css：只能放真正全局规则和 third-party CSS；
4. inline style：只用于动态运行时值，且无法合理由 StyleX 表达时。

## 20.2 禁止

不要：

- 用 StyleX 深度覆盖 `.p-*` 内部结构；
- 写依赖 Prime DOM nesting 的全局 selector；
- 为每个页面创建自己的颜色 token；
- 把 Tailwind utility 字符串搬进自制 JS helper；
- 创建一个“StyleX 版 Tailwind” utility object 大全；
- 在迁移时大规模使用 `!important`。

## 20.3 Styles location

普通组件：

```ts
const styles = stylex.create(...)
```

与组件同文件或同目录。

全局 semantic tokens：

```text
theme/tokens.stylex.ts
```

避免一个数千行的中央 styles 文件。

---

# 21. Public API 迁移策略

每个 `@qualy/ui` export 迁移前必须做：

1. 搜全仓 usage；
2. 列出实际使用的 props；
3. 将 props 分为：
   - product contract；
   - compatibility artifact；
   - unused；
4. 先保持 product contract；
5. compatibility artifact 可在独立阶段清理；
6. unused 可删除，但必须由 typecheck/code search 证明。

不要仅依据组件实现文件推断 public API。

---

# 22. 迁移期临时兼容层

允许短期存在：

```text
legacy shadcn CSS vars alias
Tailwind + StyleX 共存
Radix Slot compatibility
old overlay workaround
old cn helper
```

但每个临时兼容层必须满足：

- 注释说明为什么存在；
- 注释注明移除条件；
- M9 有明确 code search；
- 不允许新代码继续扩大其 usage。

---

# 23. Bundle / Performance Gate

迁移不能只以“测试通过”为完成。

至少在：

```text
M0
M3
M4
M7
M9
```

记录 production build 指标。

建议保存：

```text
total JS
initial JS
total CSS
initial CSS
chunk count
<2KB chunk count
representative lazy page request count
```

若某阶段显著回归：

- 先确认是否 import 了 barrel package；
- 检查是否错误引入 PrimeIcons；
- 检查是否 import 整个 component suite；
- 再考虑 Vite grouping。

不要在没有数据时调 chunk 策略。

---

# 24. Commit / PR 规则

## 24.1 不建长期不可合并巨型分支

推荐每个 milestone 或 slice 独立 PR。

## 24.2 一个 commit 只做一种主要变化

例如：

```text
chore(ui): wire StyleX into Vite
feat(ui): add PrimeReact theme provider
refactor(ui): split admin composition helpers
refactor(ui): move Button onto PrimeReact
refactor(rbac): migrate role editor layout to StyleX
```

不要：

```text
rewrite entire frontend to PrimeReact
```

## 24.3 不把“重构 + 行为变化 + 文案变化”混在一起

这样 browser regression 才能定位。

---

# 25. Claude Code 执行协议

Claude Code 在执行本文时必须遵守：

## 25.1 开始一个 milestone 前

先：

1. 阅读当前相关源码；
2. 搜索所有调用点；
3. 阅读对应 browser tests；
4. 检查当前 package versions；
5. 必要时查 PrimeReact / StyleX 当前官方文档；
6. 写出该 milestone 的短执行清单；
7. 然后直接实施，不要先全仓重写。

## 25.2 每完成一个小块

立即运行最小相关测试。

不要积累 50 个文件变化后再第一次 typecheck。

## 25.3 遇到 API 不匹配

优先级：

```text
保持 Qualy product contract
    ↓
在 @qualy/ui adapter 解决
    ↓
必要时最小调整 public API
    ↓
最后才改大量业务调用方
```

## 25.4 遇到测试失败

禁止直接改测试。

必须先判断：

```text
产品行为 regression？
accessibility regression？
旧 DOM implementation assumption？
style loading failure？
portal/focus timing difference？
```

确认属于最后一种“旧 implementation assumption”后才能调整测试。

## 25.5 不得擅自扩大范围

若看到顺手可重构的业务代码：

- 与迁移无关 → 不改；
- 明显阻塞迁移 → 做最小改动并说明；
- 大型架构改动 → 留 TODO/记录，不在本 PR 做。

---

# 26. 首个 Proof of Migration

在全面迁移前，必须完成一个完整 proof：

```text
M0
M1
M2
M3（必要基础控件）
M4（RoleEditor 使用到的必要 overlay）
M5（必要 product helpers）
+ RBAC RoleEditor vertical slice
```

最终 RoleEditor 应达到：

```text
页面业务逻辑不重写
页面没有 Tailwind utility
通用控件由 @qualy/ui → PrimeReact
Qualy composition 由 StyleX
light/dark 正常
a11y 正常
browser test 正常
production build 正常
```

这是全量迁移的 Go / No-Go Gate。

若 Proof 结果显示：

- adapter API 极度复杂；
- PrimeReact Styled 与 StyleX 持续 cascade 冲突；
- bundle 明显不可接受；
- browser focus/portal 行为难以稳定；

则应先修正平台设计，而不是继续扩大迁移面。

---

# 27. 最终 Definition of Done

整个 UI Platform Migration 只有同时满足以下条件才算完成。

## Architecture

- [ ] 业务插件无直接 PrimeReact import；
- [ ] `@qualy/ui` 仍是业务 UI 边界；
- [ ] ThemeProvider 仍是 light/dark/system 单一状态源；
- [ ] plugin composition/runtime 架构未被 UI library 侵入。

## Styling

- [ ] Tailwind 不再参与 production build；
- [ ] StyleX 覆盖 Qualy product/page styling；
- [ ] PrimeReact theme 覆盖 commodity widgets；
- [ ] global CSS 只保留合理全局样式；
- [ ] 无 shadcn theme infrastructure。

## Dependencies

- [ ] `tailwindcss` removed；
- [ ] `@tailwindcss/vite` removed；
- [ ] `shadcn` removed；
- [ ] `tw-animate-css` removed；
- [ ] `tailwind-merge` removed if unused；
- [ ] `class-variance-authority` removed if unused；
- [ ] `radix-ui` / `@radix-ui/*` removed if unused；
- [ ] Lucide / Motion / Sonner / Dropzone 等按设计保留。

## Behavior

- [ ] DateTimePicker browser contract unchanged；
- [ ] TreeSelect algebra unchanged；
- [ ] WorkspaceShell navigation behavior unchanged；
- [ ] mobile Drawer/back behavior unchanged；
- [ ] Review keyboard/deferred behavior unchanged；
- [ ] overlay/focus regressions covered。

## Quality

- [ ] `pnpm typecheck` PASS；
- [ ] `pnpm test` PASS；
- [ ] `pnpm test:browser` PASS；
- [ ] `pnpm build` PASS；
- [ ] `pnpm vendor:check` PASS；
- [ ] production smoke PASS when applicable；
- [ ] no unexplained bundle regression。

---

# 28. 建议的最终依赖方向

```text
business plugins
  ├── @qualy/ui
  ├── @qualy/ui-contract
  ├── @qualy/web-runtime
  ├── @qualy/web-i18n
  └── @stylexjs/stylex

@qualy/ui
  ├── @primereact/ui
  ├── @stylexjs/stylex
  ├── lucide-react
  ├── motion
  ├── react-dropzone
  ├── react-photo-view
  ├── react-resizable-panels
  ├── sonner
  └── date utilities as needed

apps/web
  ├── @primereact/core        # provider wiring
  ├── @qualy/ui theme config
  ├── @qualy/web-runtime
  └── routing/bootstrap
```

禁止：

```text
business plugin → @primereact/ui
layout plugin → business plugin
web-runtime → Prime widget
ui-contract → Prime widget
```

---

# 29. 参考的当前官方 API

实施时应重新核对最新官方文档，不要只依赖本文示例。

- PrimeReact Styled Vite installation: `https://primereact.dev/docs/styled/guides/installation/vite`
- PrimeReact Styled theming: `https://primereact.dev/docs/styled/guides/theming/styled`
- PrimeReact configuration/provider: `https://primereact.dev/docs/styled/guides/configuration`
- PrimeReact Button: `https://primereact.dev/docs/styled/components/button`
- PrimeReact Select: `https://primereact.dev/docs/styled/components/select`
- PrimeReact Dialog primitives: `https://primereact.dev/docs/primitive/components/dialog`
- StyleX Vite: `https://stylexjs.com/docs/learn/installation/vite/`
- StyleX variables/themes: `https://stylexjs.com/docs/learn/theming/defining-variables/`

---

# 30. 最终裁决摘要

这次迁移的正确理解不是：

```text
shadcn component
→ PrimeReact component
```

而是：

```text
Qualy product UI contract
        │
        ├── commodity widget implementation
        │       Radix/shadcn → PrimeReact
        │
        └── product styling/layout
                Tailwind → StyleX
```

必须保住已经成熟的：

```text
admin/screen product language
plugin composition
manifest routing
a11y semantics
browser-test contracts
specialized business interactions
```

真正被替换的是：

```text
widget implementation layer
styling engine
legacy theme infrastructure
```

如果实施过程中某个改动要求大量业务页面去理解 PrimeReact 的内部 API，默认说明抽象边界做错了；优先回到 `@qualy/ui` 修正 adapter，而不是继续向业务层扩散。
