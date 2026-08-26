# Mantine 上游问题档案(M4M 实查,9.5.2)

四个在 M4M 适配期用源码实查确认的上游行为。每条都已在 `@qualy/ui` 内以文档化的补偿封住,
业务代码不知情;这里保存最小复现要点与删除条件,供提 issue 与升级时复核。**不阻塞 M5+;
提交 issue 前先在当时版本的干净 sandbox 里重放一遍。**

## 1. Modal/Drawer 的 `className` 被复制到定位用 inner 元素

- **现象**:`Modal`/`Drawer` 的 content `className` 同时落在语义 content 与外层定位 inner 上。
  消费者给 content 的布局类(如 `overflow-y: auto`、尺寸)同时作用于定位容器,模态框不再
  垂直居中、抽屉落到错误的角。
- **复现**:`<Modal opened onClose={...} className="anything"><…>`,检查 DOM:`.m_…`(inner)
  与 content 均带 `anything`。
- **期望**:`className` 只属于 content;定位 inner 是实现细节。
- **本仓补偿**:一律 `classNames={{ content: … }}`(dialog.tsx / alert-dialog.tsx / sheet.tsx)。
- **删除条件**:上游把 content `className` 收窄到单元素后,可回归普通 `className`。

## 2. `ModalBase.Content` 在 props 展开之后硬写 `role="dialog"` 与 `aria-describedby`

- **现象**:适配层想给确认框 `role="alertdialog"`、或自管 `aria-describedby`,经 props 传入
  会被组件在展开后覆盖,属性不可设置。
- **复现**:`<Modal.Content role="alertdialog" aria-describedby="x">` → DOM 仍是
  `role="dialog"`,describedby 是库生成 id。
- **期望**:调用方显式给出的 aria 属性应当获胜(spread 后不再改写)。
- **本仓补偿**:稳定身份的 ref 回调在节点挂载时写回属性(alert-dialog.tsx 的 `applyA11y`;
  content 经库的 transition 状态在适配层渲染之外重挂载,所以必须在 ref attach 时机写)。
- **删除条件**:上游让 role/aria-describedby 可被 props 覆盖。

## 3. `use-focus-trap` 在 ref 身份变化时重新执行 `focusNode`

- **现象**:content 的 ref 若是内联箭头函数,每次重渲染 ref 身份都变,focus trap 重新抓焦点:
  用户在 modal 内点选一个数字后,焦点从 textarea 被夺走。
- **复现**:受控 Modal + 内联 `ref={el => …}` + 任意触发重渲染的内部 state,观察焦点回跳。
- **期望**:trap 只在挂载/开启时抓焦点,不追随 ref 身份。
- **附带**:`querySelector('[data-autofocus]')` 只查后代,content 自身带 `data-autofocus` 不生效。
- **本仓补偿**:所有喂给 content 的 ref 都是稳定 `useCallback`,最新值经 ref 盒读取。
- **删除条件**:上游 focusNode 的执行与 ref 身份解耦。

## 4. `Popover.Target`(withRoles)覆盖子元素显式 `id`

- **现象**:Target 克隆子元素时用自生成 id 覆盖调用方显式 id,`<label for>` 断链;日期区间
  选择器经 label 不可达。
- **复现**:`<Popover.Target><button id="mine">…</button></Popover.Target>` → DOM id 非 `mine`。
- **期望**:调用方显式 id 应保留(仿 Radix:有 id 则不覆盖)。
- **本仓补偿**:`withRoles={false}` + 适配层自佩 `aria-haspopup`/`aria-expanded` 与 dropdown
  的 `role`/`tabIndex`(popover.tsx)。
- **删除条件**:上游 Target 尊重既有 id。

## 顺带记录(非缺陷,行为差异)

- `Transition` 把「挂载即 open」当作已入场,首开无入场动画 → 入场动画整体改为 CSS 插入
  keyframes(theme.css components 层),退场仍归库。
- `Menu`/`Popover` 的 outside-press 在 mousedown 判定,portal 中的子浮层选项会被误判为
  「外部」→ 子浮层 dropdown 在自身边界 stopPropagation(mousedown/touchstart)。
- `hideDetached` 默认开启:触发器滚出视口即隐藏已打开的浮层,与旧底座行为不符 → select/
  popover/menu 一律显式关闭。
- Mantine `Radio.Group` 根是 InputWrapper,子项被包进一个无样式 inner 盒:放在根上的
  flex/grid 类永远作用不到选项(M5 时 ModeChoice 因此改为组件自持行容器)。
