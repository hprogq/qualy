# Qualy UI Platform Migration Design v2

## Mantine 9 + StyleX Pivot

> Status: **Approved architecture / implementation baseline**
>
> Decision date: 2026-08-26
>
> Supersedes: PrimeReact 11 + StyleX migration design
>
> Target: Qualy web frontend (`apps/web`, `packages/web/ui`, web plugins)
>
> Primary widget substrate: **Mantine 9.5.x**
>
> Product styling/layout: **StyleX**
>
> Product motion: **Motion**
>
> Business-facing UI boundary: **`@qualy/ui`**

本文件是正式执行设计。`MUST` / `MUST NOT` / `SHOULD` 等约束视为工程规则。若本地仓库现实与文档不符，以源码事实为准，但必须先说明偏差，不能静默改变架构。

---

# 0. Executive decision

Qualy **停止扩张 PrimeReact 11 迁移，pivot 到 Mantine 9 + StyleX**。

这不是“PrimeReact 很差”的泛化结论，而是 Qualy 当前 migration proof 的项目级结论。

PrimeReact 迁移约进行到 M4 一半，期间产生了大量可复用的 vendor-neutral 成果：

- StyleX infrastructure
- semantic tokens
- `@qualy/ui` 边界整理
- `admin` / `screen` 拆分
- browser regression tests
- overlay contract tests
- accessibility 修复
- native form semantics 修复
- Qualy 原技术债修复
- 组件 API/contract 澄清

这些成果不是 sunk cost，必须保留。

Prime-specific 实现则在核心 commodity widget 层暴露了反复摩擦：

- NodeNext declaration/export 失败并需要消费端 shim
- Trigger/Close 的 native form `type` 语义问题
- Checkbox indicator/state/indeterminate hooks 不完整
- `data-*` ownership/forwarding 意外
- Skeleton inline sizing 压过消费者样式
- Select compound API 与内部 options-array 模型互相冲突
- 官方部分样式习语隐含 Tailwind 假设，与 M9 删除 Tailwind 的目标冲突
- preset/CSS layer/theme leakage 调试成本高
- adapter 与 upstream bug 边界难判断

Mantine spike 用同一批关键 overlay/widget contracts 做对照，最终 9/9 green，adapter 显著更薄，失败均能归因到使用错误或明确的 Mantine 机制，没有观察到 library-level defect。

因此，从**今天开始的未来成本与风险**看，应该现在 pivot，而不是因已做到 M4 而继续 PrimeReact。

---

# 1. Architecture objective

本迁移不是：

> “把 shadcn/PrimeReact 组件替换成 Mantine 组件。”

而是：

> **保留并强化 Qualy 自己的产品 UI 层，只替换底层 commodity widget substrate，并继续把产品布局/视觉迁移到 StyleX。**

目标：

```text
Business plugins / product pages
              │
              ▼
          @qualy/ui
              │
      ┌───────┴──────────────────────────────┐
      │                                      │
      ▼                                      ▼
Qualy-owned product UI                 Commodity widgets
StyleX + semantic HTML                 Mantine 9
Screen                                 Button
PageContainer                          Input / Textarea
WorkspaceShell                         Checkbox / Radio
TopBar                                 Select / Combobox
EditorHead                             Modal / Drawer
Facts                                  Popover / Tooltip
PickList / PickGrid                    Menu
PhaseTimeline                          Tabs
ReviewWorkbench                        Tree primitives where suitable
Assessment/IAM/RBAC UI                 ...
      │                                      │
      └──────────────────┬───────────────────┘
                         ▼
                 Qualy semantic tokens
                      `--q-*`
```

Motion 独立：

```text
Mantine transitions     → widget-local presence/overlay
StyleX/CSS transitions  → small visual state transitions
Motion                  → Qualy product motion/layout/workflow
```

---

# 2. Non-negotiable architecture rules

## 2.1 Vendor boundary

业务插件和产品页面 **MUST NOT** 大面积直接 import `@mantine/*`。

依赖方向：

```text
business plugin
    ↓
@qualy/ui
    ↓
Mantine
```

Mantine 是 `@qualy/ui` 的 implementation detail。

极少数例外必须有明确架构理由；“wrapper 麻烦”不是理由。

## 2.2 Mantine 是 Widget Library，不是 Qualy 的 Layout DSL

Mantine 默认负责真正有行为/状态/无障碍价值的 commodity widgets：

- Button / ActionIcon
- Input primitives
- Textarea
- Checkbox
- Radio
- Select / Combobox
- Modal
- Drawer
- Popover
- Tooltip
- Menu
- Tabs / SegmentedControl（适合时）
- Pagination
- Loader / Skeleton
- HoverCard
- Tree primitives（契约合适时）
- 后续经过评估的 commodity widgets

Qualy 产品布局默认使用：

```text
semantic HTML + StyleX
```

以下 Mantine layout primitives **不得成为全项目默认布局语言**：

- `AppShell`
- `Container`
- `Grid`
- `SimpleGrid`
- `Group`
- `Stack`
- `Flex`
- `Box`
- `Space`

不是绝对禁用。只有当其提供明显高于直接 CSS 的行为/抽象价值时才用。仅为了少写 `display:flex` / `gap` 不够。

不要让代码演化成：

```tsx
<Stack gap="md">
  <Group justify="space-between">
    <Box p="lg">
```

如果那本质上是 Qualy 产品布局。

## 2.3 不让 Mantine style props 扩散

不要把：

```tsx
<Button mt="md" px="lg" radius="xl" />
```

变成项目主样式方法。

组件语义 prop 正常：

```tsx
<Button size="sm" disabled />
```

布局、间距、产品视觉默认写 StyleX。

## 2.4 Product components 继续 Qualy-owned

以下概念不因换 Mantine 而被库组件吞掉：

- `Screen`
- `PageContainer`
- `PageHeader`
- `Panel`
- `AsyncSection`
- `Feedback`
- `Field`
- `FormDialog`
- `SidePanel`
- `ConfirmDialog`
- `EditorHead`
- `Facts`
- `DefRow`
- `PickList`
- `PickGrid`
- `ModeChoice`
- `SaveBar`
- `WorkspaceShell`
- `TopBar`
- `PhaseTimeline`
- Review Workbench
- IAM/RBAC/Assessment domain UI

Mantine 可替换内部 commodity primitives，但不能抹掉这些产品语义。

## 2.5 No purity migration

Mantine 有同类组件，不代表要顺手替换所有现有依赖。

第一轮默认保留：

- `motion`
- `sonner`
- `react-dropzone`
- `react-photo-view`
- `react-resizable-panels`
- Lucide
- Qualy DateTimePicker behavior
- Qualy TimeField behavior
- Qualy tree-selection algebra
- specialized calendar/date behavior
- ordinary semantic table wrappers

目标不是 “100% Mantine”。

---

# 3. Baseline and source-of-truth policy

本文件基于：

1. 原 PrimeReact migration design；
2. PrimeReact M0–M4 部分实际实现；
3. 一次正式 PrimeReact vs Mantine 复盘；
4. Mantine spike 对同一 overlay/widget contract 的重放。

**本地迁移分支比公开 main 更新，必须先读本地 git。**

开始任何阶段前：

```bash
git status
git branch --show-current
git branch -vv
git log --oneline --decorate --graph -n 100
```

并通过 merge-base/history/diff 确认真正 migration base，不能默认 `main`。

此前报告提到这些可能有价值的 commit：

- `0c07825d`
- `32102737`
- `4666b7ab`
- `7a8662ba`
- `13a8a8ae`（mixed，只有部分可能 neutral）
- `1e7adfa7`
- `c443a58b`
- `d0edc879`

它们只是线索，**每个都要先 inspect，再决定 cherry-pick/partial-port**。

---

# 4. Package responsibilities

## 4.1 `packages/web/ui`

负责：

- vendor adapters
- Qualy primitive contracts
- shared Qualy product components
- semantic tokens
- Mantine theme bridge/config
- shared StyleX
- UI behavior tests
- 明确标记为 temporary 的 compatibility code

正常情况下，`@mantine/core` 只应在这一层出现。

## 4.2 `packages/web/runtime`

继续负责：

- QueryClient/runtime host
- Theme choice/resolution
- global toaster（若当前在此）
- 运行时基础设施

Theme preference ownership 不迁到 Mantine。

## 4.3 `apps/web`

保持薄：

- provider composition
- router host
- plugin manifest host
- CSS entrypoint

不要把 Mantine imports 从根向全 app 扩散。

## 4.4 Business plugins

主要消费：

```text
@qualy/ui/*
@qualy/web-runtime
@qualy/ui-contract
```

以及已经确立的 StyleX 产品布局能力。

---

# 5. Theme architecture

## 5.1 Qualy ThemeProvider 仍是唯一真相源

现有 theme state：

```ts
type ThemeChoice = 'light' | 'dark' | 'system'
```

并解析为：

```ts
'light' | 'dark'
```

现有正确行为继续保留：

- localStorage: `qualy.theme`
- `prefers-color-scheme`
- OS theme live change
- root `.dark`
- root `colorScheme`

MantineProvider **不得建立第二套持久化 theme preference**。

## 5.2 Mantine bridge

Mantine 需要把自身 `data-mantine-color-scheme` 与 Qualy resolved theme 同步。

概念实现：

```tsx
function QualyMantineProvider({ children }: { children: ReactNode }) {
  const { resolved } = useTheme()

  return (
    <MantineProvider theme={qualyMantineTheme} forceColorScheme={resolved}>
      {children}
    </MantineProvider>
  )
}
```

具体文件位置按现有 package dependency direction 决定。

目标：

```text
Qualy ThemeProvider
      │
      ├ owns light/dark/system
      ├ owns persistence
      ├ owns `.dark`
      ▼
Mantine bridge
      └ synchronizes `data-mantine-color-scheme`
```

不要启用一套独立 Mantine localStorage colorSchemeManager。

Provider 结构预计：

```text
I18nProvider
  ThemeProvider
    QualyMantineProvider
      RuntimeProvider
        BrowserRouter
```

若实际依赖要求微调，必须解释。

## 5.3 `--q-*` semantic tokens

`--q-*` 是 Qualy 稳定视觉语义 contract，描述“用途”，不是 palette index。

建议薄层：

```css
--q-bg;
--q-surface;
--q-surface-subtle;
--q-surface-hover;

--q-fg;
--q-fg-muted;
--q-fg-subtle;
--q-fg-inverse;

--q-border;
--q-border-strong;

--q-primary;
--q-primary-hover;
--q-primary-fg;

--q-danger;
--q-danger-surface;
--q-warning;
--q-success;

--q-focus-ring;

--q-radius-control;
--q-radius-panel;
```

不要扩成另一个 Tailwind：

```css
--q-space-1;
--q-space-2;
--q-gray-500;
--q-blue-600;
```

普通间距/布局数值直接写 StyleX。

## 5.4 Token direction

稳定方向：

```text
Qualy semantic meaning
        ↓
      `--q-*`
        ↓
Qualy StyleX components
```

以及：

```text
Qualy visual constants/palette
        ↓
Mantine theme
        ↓
Mantine widgets
```

业务代码不要直接依赖随机 `--mantine-*` token。

Mantine theme 与 `--q-*` 尽量来自同一组 Qualy 视觉常量，避免循环映射。

## 5.5 Pivot 期间不做品牌重设计

保留当前视觉目标：

- calm professional productivity UI
- restrained radius
- high information density
- neutral surfaces
- 清晰 hierarchy
- 少装饰卡片
- 默认无 gradient/glass
- muted text 满足合理对比度
- motion 克制

---

# 6. CSS and StyleX architecture

## 6.1 Mantine CSS 使用 layered distribution

默认：

```ts
import '@mantine/core/styles.layer.css'
```

不得同时 import：

```ts
@mantine/core/styles.css
@mantine/core/styles.layer.css
```

后续若引入额外 Mantine package，同样优先其 `.layer.css` 版本。

## 6.2 保留已经验证的 StyleX toolchain

Prime migration 中建立的 StyleX：

- Vite integration
- plugin ordering
- Fast Refresh compatibility
- browser-test/Vitest integration
- rootDir/tsconfig adjustments
- probe test

均应保留。

换 widget library 不应重新发明 StyleX 配置。

## 6.3 Cascade contract

必须做到：

> Qualy 的 StyleX/product override 可以稳定覆盖 Mantine baseline，不依赖 `!important`、import-order 猜谜或 DOM hack。

Mantine spike 已验证过一套可行 layer ordering；正式代码应复现已经证明的方案，而不是凭记忆另造。

保留/建立 computed-style browser test，至少证明：

- Mantine-backed Button baseline 生效
- Qualy StyleX override 生效
- light/dark 必要状态正常

## 6.4 不因 Mantine 内部 CSS Modules 而扩散 Qualy CSS Modules

Qualy-owned product UI 默认继续 StyleX。

Global CSS 只保留：

- fonts
- unavoidable third-party global CSS
- reset/base
- semantic token declarations
- portal/global fixes
- CSS layer declarations
- 极少数全局浏览器规则

---

# 7. Motion architecture

Mantine 默认动画克制是可接受的。

三层分工：

## Mantine transition

用于 library-owned widget presence：

- Modal
- Drawer
- Tooltip
- Popover
- Menu

## StyleX/CSS transition

用于：

- hover color
- border
- focus ring
- opacity
- selected background
- small transform
- simple rail transition

## Motion

继续负责 Qualy 产品语义 motion：

- Reveal
- Swap
- Resizing
- Drill
- CountdownRing
- DoneMark
- workflow transitions
- review undo
- layout animation
- completion feedback

保留 reduced-motion。

不要为了“统一”把 Motion 换成 Mantine Transition。

---

# 8. Component taxonomy

## Class A — commodity widget → Mantine candidate

- Button
- Input
- Textarea
- Checkbox
- Radio
- Badge
- Skeleton
- Separator
- Tooltip
- Popover
- Dialog adapter
- AlertDialog adapter
- Sheet/Drawer adapter
- DropdownMenu/Menu adapter
- Select/Combobox adapter
- Tabs
- HoverCard
- Pagination

## Class B — Qualy product/semantic component

- admin abstractions
- screen abstractions
- person
- WorkspaceShell
- TopBar
- PhaseTimeline
- ReviewWorkbench
- product editors
- domain UI

主要工作是 Tailwind → StyleX，不能用 Mantine layout components 粗暴替换。

## Class C — specialized behavior，第一轮保护

- DateTimePicker
- TimeField
- tree-selection algebra
- Dropzone
- PhotoView
- resizable panels
- Sonner
- Motion
- specialized calendar

## Class D — separate evaluation

- TreeSelect rendering
- date/calendar primitives
- future rich grids
- future virtualized surfaces

必须先做 behavior equivalence / product-need 评估。

---

# 9. Public API preservation

## 9.1 Pivot first, redesign later

M3M/M4M 期间，优先保留现有 `@qualy/ui` consumer contracts：

- Button
- Select
- Dialog
- AlertDialog
- Sheet
- Popover
- Tooltip
- DropdownMenu
- Checkbox
- RadioGroup

不能因为 Mantine 偏好的 API 不一样就顺手全仓改调用。

## 9.2 Compatibility 不是永久标准

保留 API 是为了隔离 vendor pivot，不代表 Radix/shadcn API 形状永远神圣。

例如现有 compound Select 可以在 M4M 继续兼容：

```tsx
<Select>
  <SelectTrigger />
  <SelectValue />
  <SelectContent>
    <SelectItem />
  </SelectContent>
</Select>
```

M4M GO 以后，若证明长期 API 不合理，可以另开 ADR/重构。

**禁止在 vendor pivot 同时做 API redesign。**

## 9.3 `asChild`

当前代码有大量 `asChild` consumer。

M3M 不得为了去掉 Slot 全仓改 Link/button composition。

如果 Mantine polymorphism 不能完全覆盖当前 `asChild` syntax，可临时：

- 保留 `@radix-ui/react-slot`，或
- 使用同等窄 compatibility

要求：

- 仅封在 `@qualy/ui`
- 明确 temporary
- 有 deletion condition
- 不因 Slot 保留整套 Radix

---

# 10. Component-specific design

## 10.1 Button

Mantine Button 或更低层合适 primitive 做内部实现。

保持 Qualy 语义：

Variants：

- default
- outline
- secondary
- ghost
- destructive
- link

Sizes：

- default
- xs
- sm
- lg
- icon variants

要求：

- loading/disabled 正确
- icon-only accessible
- `asChild` pivot compatibility
- 除明确 submit 外，native `<button>` 必须 `type="button"`
- Qualy API 不暴露 Mantine color names

## 10.2 Input / Textarea

选择能保持现有 DOM contract 的最低 Mantine primitive。

不要因为 `TextInput` 常见，就重复引入已经由 Qualy `Field` 管理的 label/description wrapper。

保持：

- name/value/change/ref
- disabled
- invalid
- readOnly
- native form semantics
- Qualy focus visual

## 10.3 Checkbox

必须验证：

- unchecked
- checked
- indeterminate
- keyboard Space
- label interaction
- accessible checked state
- indicator visibility 不需 consumer workaround

## 10.4 RadioGroup

保持：

- group semantics
- value/onValueChange
- keyboard arrows
- controlled state
- Qualy fieldset/legend 语义

## 10.5 Select

复杂现有 contract **优先以 Mantine Combobox 为内部 substrate**，不要机械用 opinionated `Select`。

必须覆盖真实需求：

- controlled value
- nullable/clearable
- placeholder
- disabled
- option description
- disabled option
- keyboard navigation
- selected visible value
- portal
- Select inside Dialog
- no accidental form submit
- selected indicator 不造成 layout jump
- 不依赖 Tailwind
- consumer styling ownership predictable

不要重演 Prime options-array reverse engineering。

简单新场景若 Mantine `Select` 足够，可以后续单独使用，但仍应经 `@qualy/ui` 暴露。

## 10.6 Dialog / FormDialog

内部使用 Mantine Modal/适合 primitive，但 Qualy abstractions 保持。

必须保持：

- public contract
- title/description accessibility
- focus trap
- Escape
- outside-dismiss policy
- scroll lock
- focus restore
- DialogBody header/body/footer scrolling model
- FormDialog semantics
- ConfirmDialog transition lifecycle requirements

旧 Radix `releaseStuckBody` 类 workaround 只有在 Mantine regression suite 证明无需后才能删。

## 10.7 AlertDialog

不能只“长得像确认框”。

保持：

- alert-dialog semantics
- destructive confirmation semantics
- accessible title/description

## 10.8 Sheet

优先 Mantine Drawer。

保持：

- 实际用到的 side
- responsive behavior
- Escape
- focus restore
- scroll lock
- WorkspaceShell history-backed mobile drawer

**不要把 WorkspaceShell 改成 Mantine AppShell。**

## 10.9 Popover / Tooltip / Menu

保持：

- keyboard
- focus
- portal layering
- nested Escape
- disabled trigger
- accessible name
- pointer behavior
- consumer styling contract

优先 Mantine documented mechanism。不得随意引入 setTimeout/focus hack。

## 10.10 Tabs / Segmented

Mantine 合适则使用。

不能借组件迁移修改路由/页面 IA。

## 10.11 Tree / TreeSelect

Qualy 有自定义 subtree/minimal-cover selection semantics。

删除算法前必须 property-level 证明：

```text
select parent
→ minimal value contains parent

unselect one child
→ 正确展开剩余 coverage

重新全选 descendants
→ collapse back to parent

无 nested redundant selected nodes
```

如果 Mantine 完全等价，可后续替换。

否则允许：

```text
Mantine rendering
+
Qualy selection algebra
```

M3M/M4M 默认不动。

## 10.12 DateTimePicker

本 pivot 不替换。

当前行为与 browser tests 均为保护 contract。

## 10.13 Table

普通 table 继续 semantic HTML。

未来真正 heavy data surface 再单独评估 TanStack Table + StyleX / virtualization。

Qualy 不应为了 Prime DataTable 继续依赖 PrimeReact。

---

# 11. Overlay regression contract

这些测试是架构资产，必须跨 vendor 保留。

## 11.1 Native form safety

以下触发器放进 `<form>` 时，非提交操作不得提交表单：

- Select trigger
- Dialog trigger
- Drawer trigger
- Menu trigger
- Popover trigger
- close buttons

## 11.2 Modal handoff

```text
Dialog A open
→ close A
→ immediately/transition-time open B
→ body/page remains interactive
→ no stale pointer-events
→ scroll lock correct
→ focus correct
```

## 11.3 Nested Escape

例如：

```text
Modal
  Popover
```

第一次 Esc：

- 只关闭 inner overlay
- Modal 保持

第二次 Esc：

- 关闭 Modal

Select/Menu 等 nested overlay 同理。

## 11.4 Select inside Modal

必须验证：

- open
- keyboard navigate
- choose
- onChange only once
- no form submit
- correct focus behavior
- expected close behavior

## 11.5 Drawer

- correct side
- Esc
- outside-click policy
- focus restore
- scroll lock
- responsive size

## 11.6 Tooltip

- pointer
- keyboard focus
- disabled-trigger scenario（若当前 API 支持）
- no focus theft

## 11.7 Checkbox

- unchecked
- checked
- indeterminate
- keyboard
- accessible state

## 11.8 Theme

- `choice = light/dark/system`
- resolved state correct
- `.dark` correct
- `data-mantine-color-scheme` 与 resolved 一致
- system preference live change 在 `system` 下同步

## 11.9 CSS cascade

computed-style test 证明 StyleX/Qualy override 在应该赢时稳定赢 Mantine baseline。

---

# 12. Accessibility requirements

Mantine 的 accessibility 只是 baseline，不替代产品测试。

每个 adapter 必须保持或改善：

- semantic role
- accessible name
- title/description association
- keyboard interaction
- focus-visible
- disabled semantics
- form semantics
- Escape
- focus restoration
- checked/expanded/selected state

测试优先使用 role/name/state。

不要为了适配 vendor DOM，把 browser tests 改成依赖内部 `data-*`。

若旧测试断言 vendor-specific detail，先判断它是否真的是产品 contract；可以的话改成行为/无障碍断言，而不是换一个 vendor selector。

---

# 13. Test strategy

## 13.1 Browser tests 是 interaction gate

已有真实浏览器测试覆盖：

- shell
- theme
- org admin
- identity
- date-time behavior
- review layout
- entry workflow
- batch admin
- localization
- routing/navigation
- 其他 product surfaces

尽量保留原断言。

## 13.2 Unit tests

适合：

- selection algebra
- variant mapping
- option normalization
- token/helper
- state reducer

Overlay/focus/keyboard 不用模拟 DOM 测试替代真实浏览器测试。

## 13.3 Adapter contract tests

为 `@qualy/ui` commodity API 保留 focused tests。

M5–M8 应建立在 M3M/M4M 已经稳定的 adapter 上，不能每个业务页面重新发现 widget bug。

## 13.4 Manual visual review

M3M/M4M 每个重要 adapter 至少 review：

- normal
- hover
- focus-visible
- disabled
- destructive（适用时）
- dense form
- dialog context
- light
- dark

测试绿但视觉明显退化不能验收。

---

# 14. Git and branch strategy

## 14.1 Freeze PrimeReact experiment

Prime migration branch 是历史证据和 salvage source。

不得：

- 删除
- rebase/rewrite 已有历史
- 继续 M4

若有 valuable uncommitted work：

- 区分正式工作与 scratch
- 安全保存正式成果
- 不误提交 spike/tmp/generated files

适合时创建：

```text
ui-prime-m4-checkpoint
```

如果 tag 已存在，不覆盖。

## 14.2 Clean Mantine branch

优先从真正 migration base 创建干净分支，不在 Prime HEAD 上原地 uninstall/rewrite。

目标：

```text
migration base
    │
    ├── Prime experiment (frozen)
    │
    └── Mantine migration
          ├ vendor-neutral commits
          ├ clean partial ports
          └ Mantine implementation
```

建议分支名：

```text
refactor/ui-mantine
```

若冲突，按仓库现状安全命名。

## 14.3 Salvage by intent

三类：

### KEEP

Vendor-neutral changes；验证后尽量完整 cherry-pick。

### PORT

保留 API/tests/product intent，vendor implementation 重写。

### DROP

Prime-only integration/workaround。

禁止 wholesale merge Prime branch。

## 14.4 Mixed commits

可以：

```bash
git cherry-pick -n <commit>
```

然后只 stage neutral hunks；或者：

```bash
git restore --source=<prime-ref> -- <wanted-path>
```

最终 commit message 应描述 Mantine branch 里实际保留的内容，不能保留误导性 Prime migration message。

---

# 15. KEEP / PORT / DROP baseline

必须按本地分支验证。

## 15.1 KEEP

优先保留：

- StyleX Vite/unplugin integration
- StyleX browser-test integration
- StyleX probe tests
- StyleX authoring rules
- vendor-neutral semantic tokens
- non-Prime theme refactor
- `admin` / `screen` decomposition
- vendor-neutral overlay contract tests
- accessibility fixes
- native-form behavior fixes
- product bug fixes
- browser test robustness
- product component cleanup
- neutral palette decisions
- `@qualy/ui` boundary improvements

## 15.2 PORT

保 contract/behavior，换 internals：

- Button
- Input
- Textarea
- Checkbox
- RadioGroup
- Badge
- Skeleton
- Separator
- Tooltip
- Popover
- Dialog
- AlertDialog
- Sheet
- DropdownMenu
- Select
- provider/test harness
- adapter contract tests

## 15.3 DROP

Mantine branch 应逐步移除：

- `PrimeReactProvider`
- Prime/Aura preset
- Prime token/component preset sections
- Prime Pass Through
- Prime NodeNext d.ts shim
- Prime `data-*` forwarding hacks
- Prime Select reverse engineering
- Prime license/config
- Prime optimizeDeps
- Prime package dependencies
- Prime-only overlay helper
- Prime-only CSS layer workaround
- Prime-only tests

`docs/notes/primereact.md` 可作为历史证据保留，但标注 superseded。

---

# 16. Mantine dependency policy

初始 pivot 只添加真正需要的 package。

预计 base：

```text
@mantine/core
@mantine/hooks
```

遵循 monorepo 现有 catalog/version policy，不能在 leaf manifest 随意绕过 catalog。

M3M/M4M 默认**不添加**：

- `@mantine/form`
- `@mantine/dates`
- `@mantine/dropzone`
- `@mantine/notifications`
- `@mantine/charts`
- 其他 extensions

Mantine 有这个 package ≠ Qualy 需要迁它。

当前稳定线以 Mantine 9 为目标，lockfile 必须可复现。

---

# 17. Migration milestones

原 M0–M2 的 vendor-neutral 成果概念上保留。

新的 vendor pivot 从 P0 开始，然后 M3M/M4M。

---

# P0 — Pivot preparation and salvage

## Goal

建立干净 Mantine branch：

- 保住全部 vendor-neutral 价值
- 不把 Prime-specific 实现带进新基线
- 不开始 Mantine 批量实现

## Tasks

1. 确认 migration base。
2. 安全冻结/checkpoint Prime branch。
3. audit Prime migration commits。
4. 分类 KEEP / PORT / DROP。
5. 从 base 创建 Mantine branch。
6. cherry-pick verified KEEP。
7. mixed commits 只 port neutral hunks。
8. 在 Mantine 尚未实现前，先验证 StyleX/token/test baseline。
9. 创建/更新 ADR。
10. 停止，不进 M3M。

## Acceptance

尽可能执行：

```bash
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
```

如果因 P0 暂缺 commodity adapter 导致预期 failure，必须逐项列清，不得隐藏。

如果 baseline 本可保持 green，则必须 green。

## Stop condition

P0 后报告：

- migration base
- Prime frozen ref/tag
- Mantine branch
- KEEP/PORT/DROP
- tests
- residue
- M3M readiness

然后 STOP。

---

# M3M — Mantine commodity primitives

## Scope

第一批低复杂度：

- Button
- Input
- Textarea
- Checkbox
- RadioGroup
- Badge
- Skeleton
- Separator

以及确实必要的小 supporting primitive。

## Requirements

- Mantine only behind `@qualy/ui`
- pivot 期间 preserve Qualy API
- 不 mass-rewrite business page
- 不引 Mantine layout DSL
- layered Mantine CSS
- Qualy→Mantine theme bridge
- StyleX override probe
- button type safety
- checkbox indeterminate
- light/dark sync

## Theme scope

创建最小 `qualyMantineTheme`，只处理真正的 system-level baseline：

- typography
- primary palette
- radius
- control density/height
- focus
- neutral surface（必要时）
- 少量 required defaultProps

不要把 Prime preset 逐项翻译成 Mantine theme。

不要 speculative override 每个 Mantine component。

## Acceptance

- M3M adapter tests green
- theme browser test green
- typecheck
- relevant unit/browser
- build
- manual light/dark review
- no new Prime dependency
- no Mantine leakage into business code

## Stop

M3M 完成后 STOP，先 review。

---

# M4M — Interactive widgets / overlays

## Scope

- Tooltip
- Popover
- Dialog
- AlertDialog
- Sheet/Drawer
- DropdownMenu/Menu
- Select/Combobox
- related portal/focus infrastructure

## Principle

M4M 是 Mantine 正式 Go/No-Go。

不能掩盖 friction。

若出现：

- undocumented DOM assumption
- unexplained timer
- repeated `!important`
- vendor patch/shim
- library-level bug

必须立即记录。

## Select

复杂 Qualy contract 优先 Mantine Combobox。

不要为了使用 Mantine `Select` 而重新制造数据反推/children reverse engineering。

## Overlay

优先官方 documented mechanisms：

- focus trap
- nested overlay Escape
- portal
- scroll lock
- focus return

如果需要类似 `data-mantine-stop-propagation` 的官方 escape hatch：

- 限定在最小 scope
- comment 说明要保持的 contract
- 有 browser test

## Mandatory acceptance

全部通过：

1. form trigger non-submit
2. Dialog A → B
3. nested Escape layering
4. Select inside Dialog
5. Drawer side/Escape/focus
6. Popover
7. Menu
8. Tooltip
9. light/dark/system sync
10. StyleX cascade
11. focus restore
12. scroll lock
13. accessible names/roles
14. relevant existing browser tests

---

# 18. M4M Second Go / No-Go

M4M 后必须正式 review，不能自动 M5。

输出 quality table：

| Metric                                     | Target    |
| ------------------------------------------ | --------- |
| Prime-specific packages                    | 0         |
| direct Mantine imports outside `@qualy/ui` | 0         |
| vendor declaration shims                   | 0 desired |
| undocumented DOM workaround                | 0 desired |
| new `!important` for Mantine               | 0 desired |
| new focus `setTimeout` hacks               | 0 desired |
| Mantine-caused unsafe TS casts             | 0/minimal |
| overlay contracts                          | all green |
| form-trigger safety                        | green     |
| theme sync                                 | green     |
| StyleX cascade                             | green     |

同时 review：

- adapter LOC（仅辅助，不机械比较）
- workaround count
- vendor internal dependencies
- TypeScript quality
- test rewrites caused only by vendor DOM
- source/debugging experience
- visual result

## GO

满足以下大方向才进 M5：

- suite green / unrelated known failure only
- 无 systemic library defect
- adapter complexity 可接受
- 无 vendor leakage
- overlay stable
- CSS predictable
- maintainer confidence positive

## NO-GO

出现以下 pattern 则停止：

- repeated core library defects
- consumer shims proliferate
- adapters depend on internals
- overlay 靠 brittle hacks
- TypeScript integration materially broken
- Mantine forces product-architecture distortion

不能因为“已经换 Mantine”而继续。

---

# M5 — Shared Qualy product layer → StyleX

## Scope

剩余 Tailwind-heavy shared UI：

- `admin`
- `screen`
- PageContainer
- person/shared UI
- 其他 shared semantics

## Rule

保持 API/i18n/a11y/product semantics。

复杂 Tailwind selectors 不应逐字符翻译；适合时把隐式 selector logic 改成明确的 component/style state。

不要用 Mantine Stack/Grid/Container 粗暴替代。

---

# M6 — RBAC + IAM + Shell vertical slices

推荐顺序：

1. Roles / RoleEditor
2. Users
3. Organization
4. Shell

## Roles

第一真实 product benchmark，覆盖：

- Field
- FormDialog
- ConfirmDialog
- Segmented
- PickGrid/PickList
- Button/Input
- async feedback
- mutation state

不改角色业务语义/route。

## Users

保持 master/detail roster。

不要因为 Mantine 没 DataGrid 就重新选 grid library。

## Organization

保持组织树/domain semantics。

Mantine Tree rendering 只在不改变 selection/data contract 时采用。

## Shell

WorkspaceShell / TopBar 继续 Qualy-owned。

Mantine 可提供 Drawer/Menu/Tooltip。

**禁止迁到 Mantine AppShell。**

保留 history-backed mobile drawer。

---

# M7 — Assessment Batch / Phase / Entry

保持：

- PhaseTimeline Qualy-owned
- ordinary table semantic
- DateTimePicker protected
- live updates
- batch/phase rules
- toast behavior

不能借 UI migration 修改阶段算法、时间规则或业务状态机。

---

# M8 — Review workbench + remaining product styling

Review 是 final boss：

- responsive panes
- keyboard shortcuts
- deferred decisions
- live updates
- dialogs/tooltips
- scroll
- queue/history
- touch
- animations

M4M 必须先证明 widgets，不允许在 Review 页继续验证 Mantine 基础能力。

Review migration 应主要是：

```text
Qualy product code + StyleX + established @qualy/ui
```

---

# M9 — Legacy stack removal

只在 M5–M8 完成并通过 tests 后执行。

目标清理：

- Tailwind utilities
- `@tailwindcss/vite`
- `tailwindcss`
- `tailwind-merge`
- CVA（若无 intentional usage）
- `tw-animate-css`
- shadcn dependency
- 不再使用的 Radix
- Tailwind theme/source/apply/custom variant
- PrimeReact packages/config/shims
- Prime license/config
- Prime-only notes 以外的 runtime remnants

`@radix-ui/react-slot` 可因 `asChild` 暂留，但必须单独 track。

依赖删除必须配合 typecheck/tests/build，不可只 grep。

---

# 19. Final CSS entrypoint target

M9 后 app CSS entrypoint 概念上只包含：

- Mantine layered CSS
- Qualy global/theme CSS
- StyleX entry/output requirements
- 必要 third-party global CSS（如 PhotoView）
- font
- minimal global/base

不再需要 Tailwind 跨 plugins `@source` scan。

---

# 20. Density and sizing

Qualy 是 high-information-density work software。

不能盲收 Mantine default density。

Theme/adapters 建立统一 control rhythm。

此前 migration 提到约 36px control rhythm；以当前已迁 UI/token 的真实视觉为 source of truth，不把数字机械塞进所有组件。

重点 review：

- Button height
- Input height
- Select trigger height
- Menu item density
- Dialog padding
- admin forms
- list/table row density

不要靠 page-level style props 修 density。

---

# 21. Form strategy

Pivot 不采用 `@mantine/form`。

这是 separate architecture change，会影响：

- validation ownership
- controlled/uncontrolled
- registration
- errors
- business forms

Mantine widgets 先作为正常 React/native form controls 接入现有架构。

---

# 22. Date strategy

Pivot 不因为 Mantine 有 dates 就加 `@mantine/dates`。

当前 DateTimePicker 有明确 product semantics 与 browser tests。

以后另 ADR 比较：

- current date-fns/react-day-picker
- Mantine dates/dayjs
- React Aria/internationalized-date

---

# 23. Tree strategy

明确区分：

```text
tree rendering
```

与：

```text
Qualy subtree selection algebra
```

可以 Mantine 渲染 + Qualy algebra。

不得因为 TreeSelect 有 cascade/checkedStrategy 就先删除数学 contract。

---

# 24. Data-table strategy

当前 Qualy 不值得围绕 DataGrid 选择整个 widget substrate。

未来 heavy data surface 再独立评估：

```text
TanStack Table + StyleX
```

以及 virtualization。

本 pivot 不额外引入 TanStack Table，除非当前 page 真需要。

---

# 25. Error handling / debugging policy

Mantine adapter 出问题时：

1. 最小复现 Qualy contract
2. 分类：
   - Qualy adapter bug
   - Mantine misuse
   - documented Mantine behavior
   - browser/platform behavior
   - Mantine library bug
3. 查官方 docs/source
4. 优先 documented extension point
5. 避免 DOM archaeology
6. 不做跨 adapter 的神秘 vendor patch

若确认 library bug：

- regression test first
- workaround 封在 `@qualy/ui`
- 记录 upstream issue/version
- 写 deletion condition
- 若重复出现，触发 M4M Go/No-Go 重新评估

---

# 26. Temporary compatibility policy

Temporary compatibility 必须：

- narrow
- 有原因注释
- 有删除条件
- 不泄漏 business code

允许例：

- `asChild` Slot
- old ConfirmDialog lifecycle bridge
- old Select API → Combobox internals

不要建立通用 compat framework。

---

# 27. Performance policy

迁移不能明显退化：

- initial JS
- CSS
- route splitting
- interaction responsiveness
- Review rendering
- large lists

M4M 和 M9 比较 build output。

Mantine static CSS 可接受。

不要为未使用组件引 optional Mantine package。

是否 per-component CSS import 必须基于 bundle evidence，不能为了理论最小化制造维护复杂度。

---

# 28. ADR requirement

创建/更新：

```text
docs/adr/00xx-ui-widget-platform.md
```

若仓库已有编号规范按规范。

ADR 包括：

## Context

- Tailwind/shadcn/Radix baseline
- StyleX + mature widget substrate 的目标
- PrimeReact migration proof

## PrimeReact findings

只写 objective facts：

- NodeNext declaration integration
- button semantics
- Checkbox state exposure
- Select adaptation complexity
- `data-*` forwarding
- CSS layer/theme issues
- maturity
- license/runtime config
- adapter/debugging cost

不得写“像 AI 写的”。

## Mantine spike

记录：

- replayed scenarios
- final results
- adapter size 仅作 context
- initial failures and causes
- spike limitations

## Decision

Mantine 9 + StyleX。

## Consequences

Positive：

- mature widget baseline
- static layered CSS
- StyleX integration predictable
- source/debugging readable
- thinner adapter

Negative：

- Mantine-specific adapter maintenance
- no built-in heavy DataGrid strategy
- 必须约束 layout DSL/style props
- Qualy 仍需拥有 product design

## Revisit

只在 pattern-level evidence 下 revisit：

- repeated core defects
- major a11y gap
- toolchain incompatibility
- internal-dependent adapters
- vendor leakage
- fundamentally new product requirement

---

# 29. Forbidden during migration

禁止：

- “先把 Prime M4 做完”
- wholesale merge Prime branch
- redesign IA
- WorkspaceShell → Mantine AppShell
- Group/Stack/Grid 变主布局 DSL
- theme ownership → Mantine
- 顺便迁 `@mantine/form`
- 顺便迁 dates
- 为纯度迁 Sonner
- 为纯度迁 Motion
- 为纯度迁 react-dropzone
- 为纯度迁 PhotoView
- 为纯度迁 resizable
- 无 proof 删除 tree algebra
- every table → grid
- business direct Mantine imports
- vendor pivot 同时全仓 API redesign
- 弱化 tests 来适配 vendor DOM
- tests green 但接受明显视觉退化
- `!important` 作为常规 override
- 无证据的 focus `setTimeout`
- accidental commit scratch
- 删除 Prime historical notes

---

# 30. Milestone protocol

每阶段：

## Before coding

1. 读本设计。
2. `git status`。
3. 看相关 recent commits。
4. 读真实 component。
5. 搜所有 consumer。
6. 读 tests。
7. 若 design 与 repo 不符，先说明。

## During

- coherent changes
- behavior-first
- vendor behind `@qualy/ui`
- bug fix 配 regression
- 不做 unrelated cleanup，除非 correctness 必需
- 发现重要技术债：低风险且必要可修，否则记录

## After

通常运行：

```bash
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
```

迭代时可先 narrow test，milestone 完成必须跑适当 full gate。

若仓库还有 mandatory vendor/smoke 等 gate，最终也执行。

## Report

- changed files
- architecture decisions
- tests/results
- verified behaviors
- temporary compatibility
- discovered debt
- upstream issues
- next-stage recommendation

## Stop

**每个 milestone 边界必须 STOP。**

不能自动开始下一阶段。

---

# 31. Commit policy

小而 coherent。

示例：

```text
docs(ui): record Mantine widget platform pivot
build(ui): add Mantine layered style baseline
refactor(ui): port button primitives to Mantine
refactor(ui): port form controls to Mantine
test(ui): preserve overlay interaction contracts
refactor(ui): port overlays to Mantine
refactor(ui): port select contract to Mantine Combobox
```

不能一个：

```text
refactor: migrate PrimeReact to Mantine
```

塞 salvage/theme/all adapters/business pages。

遵循仓库实际 commit style。

---

# 32. Final cleanup gates

最终预计：

```text
PrimeReact imports                 → 0
PrimeReact config/license          → 0
Prime-specific shim                → 0

shadcn dependency                  → 0
tailwind-merge                     → 0
tw-animate-css                     → 0
@tailwindcss/vite                  → 0
tailwindcss                        → 0
Tailwind @apply                    → 0
Tailwind @source                   → 0
Tailwind @theme                    → 0

Radix packages                     → 0 or explicit temporary Slot
CVA                                → 0 or explicit justification
direct Mantine business imports    → 0
```

不能只 grep；必须 typecheck/tests/build。

---

# 33. Definition of Done

迁移完成必须同时满足：

1. Mantine 成为稳定 commodity-widget substrate。
2. Mantine 被封在 `@qualy/ui`。
3. Qualy product components 继续 Qualy-owned。
4. StyleX 是主要 layout/product styling。
5. Qualy ThemeProvider 继续控制 light/dark/system。
6. `--q-*` 是稳定 visual semantic contract。
7. Mantine layered CSS 与 StyleX cascade 可预测。
8. Motion 继续 product animation。
9. Tailwind/shadcn legacy 在无需要处清理。
10. active product runtime 无 PrimeReact。
11. critical browser interaction contracts 全绿。
12. 不存在系统性 Mantine workaround layer。
13. IA/business behavior 不因 UI migration 改变（除独立批准 bug fix）。
14. typecheck/tests/browser/build gates green。
15. ADR 准确记录 Prime proof → Mantine pivot。

---

# 34. Revisit policy

不要因为 Mantine 出一个普通 bug 又重开选型。

只有出现 pattern-level evidence 才 revisit：

- repeated core-widget defects
- accessibility 无法干净修正
- persistent TS/toolchain incompatibility
- adapters 越来越依赖 internals
- Mantine leakage 无法控制
- fundamental product requirement 改变

M4M 是正式第二 Go/No-Go，因此之后再次 pivot 的门槛必须高。

---

# 35. Immediate next action

**下一步只执行 P0。**

1. freeze/checkpoint Prime branch；
2. 找真正 migration base；
3. create clean Mantine branch；
4. salvage vendor-neutral work；
5. 写/update ADR；
6. 验证 StyleX/token/tests baseline；
7. STOP。

不要在同一次对话执行里进入 M3M。

---

# 36. External implementation notes verified at decision time

截至 2026-08-26：

- Mantine current stable: 9.5.2。
- Mantine component styles are distributed as static CSS; official `.layer.css` files wrap styles in `@layer mantine`。
- `MantineProvider` supports `forceColorScheme="light" | "dark"` and sets `data-mantine-color-scheme` on the root element, which fits a bridge from Qualy’s already-resolved theme.
- Mantine `Select` is intentionally an opinionated component built on `Combobox`; advanced Select contracts should use `Combobox`.
- Mantine TreeSelect supports checkbox/cascade/checked-strategy features, but Qualy’s custom minimal-cover algebra remains protected until equivalence is proven.

You should re-check official docs if an exact Mantine API changed after this decision date.
