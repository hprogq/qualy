我现在觉得batch阶段配置承担的职责太重了，我有几个想法：

1. 移除offset功能，只保留定时开始的功能，因为offset是没有意义的，能用offset表示的情况都可以用定时表示，而它想表达工作日的概念也是不可能的，万一中间隔个春假秋假这个东西不会自动计算，所以还是需要人手动定时。
2. 考虑从阶段设置中保留还是移除“随公示发布”功能，或让公示去绑定阶段而不让阶段绑定公示，或阶段只负责管理公示页面的可访问性，不负责公示的整体逻辑。

这样在阶段编辑页面，没了这两个问题的影响，就非常容易理解了，要么定时，要么待定。

你帮我思考下

我觉得这个方向是对的，而且可以比“只删两个功能”再往前收一层：**Phase 应该退回到“批次当前处于什么业务状态、这个状态允许做什么、何时进入下一个状态”这三个职责。公示、审核完成、申诉截止等领域事件，不应该反过来成为 Phase 自己的一套小型规则引擎。**

我会这样定。

第一，`offset` 可以直接删，而且我倾向于彻底删，不留 UI 入口也不留数据库语义。

你说的理由成立：如果没有“学校工作日历”这个一等领域对象，那么“+3 天”“+5 个工作日”都只是看起来自动化，实际上无法正确处理国庆、寒暑假、调休、学院临时安排。继续保留 `offset`，最终只会演化成：

```text
offset
+ business calendar
+ holiday exception
+ reschedule propagation
+ anchor invalidation
+ derived planned time
```

这对于 Phase 来说完全过重。

真正需要“公示后 3 个工作日内申诉”时，法规上的规则可以仍然记录在业务配置里，但**实际这一次批次的截止时间由管理员排成一个明确 datetime**。二者不是一回事：

```text
规则：公示后原则上开放 3 个工作日
本批次实际截止：2026-09-14 17:00
```

后一项才应该驱动状态机。

因此我会把：

```ts
entry_offset
```

整个移除。

---

第二，我甚至会进一步考虑把 `entry_trigger` 也弱化掉。

如果 Phase 最终只有：

- 定时；
- 尚未排期；

那么数据库实际上不一定需要：

```ts
entry_trigger: 'scheduled' | 'manual'
```

完全可以就是：

```ts
planned_entry_at: Date | null
actual_entry_at: Date | null
```

语义非常直接：

```text
planned_entry_at != null
→ 已排期，时间到了由 scheduler 进入

planned_entry_at == null
→ 尚未排期
```

而“最后实际上为什么进入这个阶段”，应该属于**事实记录**，而不是配置：

```text
actual_entry_at = ...
cause = scheduler | administrator | publication
actor = ...
reason = ...
```

也就是说，把：

> “怎么计划”

和：

> “实际上为什么发生”

分开。

这是一个很重要的简化。

---

## 公示我建议从 Phase 中拿出去

这一点我倾向比较明确：

**不要再让 Phase 绑定 Publication。**

也就是不要：

```text
Phase
  entry_trigger = publication
  opens_publication_id = xxx
```

因为语义方向其实反了。

真实世界发生的是：

> 某次公示在某个时间生效，然后系统因此进入申诉阶段。

不是：

> 申诉阶段在等待一个 publication 把自己打开。

所以如果确实存在“公示一发布就进入某阶段”的刚性业务规则，我会反转关系：

```text
Publication
  effective_at
  ...
  enter_phase_id?   // optional
```

更准确一点可以叫：

```ts
onEffectiveEnterPhaseId
```

或者服务层概念：

```ts
PublicationEffect {
  advanceBatchToPhase?: phaseId
}
```

于是事件方向变成：

```text
Publication becomes effective
            │
            ▼
PhaseService.advance(targetPhase, {
  cause: 'publication',
  publicationId
})
```

而不是 Phase 去观察 Publication。

这个边界会干净很多。

---

## 但我也不建议让 Publication 过度控制 Phase

这里还有一层取舍。

我不会做成：

```text
每个 Publication 都必须绑定一个 Phase
```

应该是 optional。

因为 Publication 本身首先是：

- 一次结果快照；
- 一次发布行为；
- 有 READY / SCHEDULED / EFFECTIVE / RETRACTED 等自己的生命周期；
- 有自己的 audience / historical readability。

只有部分 Publication 生效时才意味着：

> 顺便推进 Batch 状态。

例如：

```text
第一次公示
→ effective
→ 进入“申诉期”
```

这时绑定是合理的。

但：

```text
某个补充说明公示
```

未必需要推进阶段。

所以关系应该属于 Publication 的**副作用配置**，而不是 Publication 与 Phase 互相定义对方的生命周期。

---

# 我尤其不建议“Phase 负责公示页面是否可访问”

这里要特别区分两个概念：

### 1. Publication 是否可读

应该由 Publication 自己决定。

例如：

```text
effective
audience
retracted
historical visibility
```

因为第一次公示即使申诉期结束了，历史上也仍然可能应该可读。

如果你让 Phase 决定：

```text
当前不是申诉期
→ 第一次公示不可访问
```

很容易重新踩到“历史 Publication 可读”和“当前可申诉”混在一起的问题。

### 2. 当前可以对 Publication 做什么

这才属于 Phase permission profile。

比如：

```text
审核整理期：
  publication.prepare
  publication.schedule

申诉期：
  publication.read
  appeal.create

最终阶段：
  publication.read
  appeal.create ×
```

更准确地说：

> Publication 决定资源自身处于什么状态；  
> Phase 决定当前业务状态允许用户执行什么动作。

这两个 gate 可以同时存在。

例如：

```text
能否发起申诉 =
  当前 Phase 允许 appeal.create
  &&
  Publication 确实是当前可申诉 Publication
```

这个责任分配很稳。

---

# 最终 Phase 可以简化成非常小的模型

我会希望它最后大致只有：

```ts
BatchPhase {
  id
  batchId

  ordinal
  phaseKey
  displayName

  plannedEntryAt: Instant | null
  actualEntryAt: Instant | null

  permissionProfile
  itemScope
  participantScope

  configRevision
}
```

甚至可以没有：

```text
entry_trigger
entry_offset
estimated_entry_at
opens_publication_id
```

`estimated_entry_at` 我也会重新审视。

如果它只是 UI 上的“预计 9 月 10 日”，但不驱动任何业务，那未必值得成为核心 Phase schema。可以保留，但我更倾向它属于运营备注/计划而不是状态机核心。

Phase 的概念终于变成：

```text
阶段 1
计划开始：9/1
实际开始：9/1

阶段 2
计划开始：9/5
实际开始：-

阶段 3
尚未排期
```

非常容易理解。

---

# “审核期”也因此不再特殊

例如：

```text
学生填报期
开始：9月1日
下阶段：9月5日进入审核期

审核期
开始：9月5日
下阶段：尚未排期

申诉期
开始：尚未排期
```

管理员看到：

```text
审核期                进行中

开始
9月5日 23:59

下一阶段
尚未排期
审核完成后再安排
```

就够了。

不需要解释：

```text
manual trigger
conditional end
elastic phase
unknown duration
```

这些词统统消失。

---

## 这里我建议引入一个很简单的 UI 概念：“排期待续”

这可以解决你之前一直觉得很别扭的：

> 为什么审核期后面的阶段现在不能设置时间？

时间线可以是：

```text
① 填报期
9/1 08:00 → 9/5 23:59

② 审核期
9/5 23:59 → 待定
当前

──────────── 排期待续 ────────────
审核完成后，再安排后续阶段时间

③ 第一次公示准备
待排期

④ 申诉期
待排期

⑤ 最终确认
待排期
```

注意这里：

**阶段结构仍然可以全部提前配置。**

包括：

- 名称；
- 顺序；
- permission profile；
- scopes。

只是时间：

```text
从第一个未排期边界开始，后面的时间都暂不排。
```

这比强迫用户理解“因为 Phase ③ 的 entry depends on Phase ② 的 semantic end”简单得多。

---

# 我甚至建议保留一个非常简单的“连续排期前缀”约束

也就是：

```text
Phase 1  9/1
Phase 2  9/5
Phase 3  null
Phase 4  null
Phase 5  null
```

允许。

但：

```text
Phase 1  9/1
Phase 2  null
Phase 3  9/10
```

不允许。

为什么？

因为如果 Phase 2 审核到 9/12 才结束，Phase 3 的 9/10 到底是什么意思？

系统要么：

- 自动跳阶段；
- 把 Phase 3 变 overdue；
- 默默等待 Phase 2；
- 自动重排。

每一种都会重新增加复杂度。

所以最简单的不变量就是：

> **未来阶段的排期必须形成连续前缀；遇到第一个“待定”，之后全部待定。**

这个规则非常容易向用户解释：

> “前一个阶段时间尚未确定，因此后续阶段暂不排期。”

而不是：

> “系统存在 armed prefix materialization semantics……”

这是同一个思想，但产品语言干净得多。

---

# 那么第一次公示怎么办？

我推荐的实际流程是：

```text
审核期
当前阶段
后续尚未排期
```

管理员审核结束：

```text
生成 ScoreRun
→ 创建第一次 Publication
→ 选择发布时间 9/10 09:00
```

此时 Publication 页面可以明确提示：

```text
第一次公示将在 9月10日 09:00 发布。

发布后进入：
申诉期
```

这里甚至可以顺手把目标 Phase 的计划时间显示出来：

```text
申诉期
计划开始：9月10日 09:00
来源：第一次公示
```

但这个“来源”属于 Publication 的安排，不需要 Phase 配置页出现“随公示发布”这种 trigger。

两种实现都可以：

### A. 不 materialize Phase planned time

Publication 到点：

```text
effective
→ advance Phase
```

Phase 之前一直显示：

```text
待定
```

优点：最纯粹。

缺点：明明已经知道 9/10，Phase 页面还写待定，不够友好。

### B. Publication 排期时 materialize `planned_entry_at`

Publication schedule：

```text
publish_at = 9/10 09:00
target phase planned_entry_at = 9/10 09:00
```

同时记录 provenance：

```text
planned by publication X
```

取消公示排期：

```text
如果 Phase 尚未进入
→ 清除这项派生 planned time
```

这其实就是你原来设计里较复杂的那套行为，但现在区别在于：

> Phase 本身不再有 publication trigger。  
> Publication 只是作为 owner 把一个普通的 planned time 写进去。

如果你还想继续极简，我会先选 **A**。

如果后续发现运营上很需要在 Phase 时间线上提前看到公示排期，再加 B。

不要一开始就把它塞回 Phase schema。

---

# 我给你的最终责任边界

我建议明确成这样：

```text
Batch Phase
────────────────────────
当前处于哪个业务阶段
阶段顺序
阶段计划开始时间
阶段实际开始时间
这个阶段允许做什么
作用范围
```

```text
Publication
────────────────────────
发布什么结果
何时发布
何时实际生效
谁可看
是否撤回
是否在生效时推进到某阶段
```

```text
Review
────────────────────────
审核是否完成
是否还有 pending / blocked
能否进入公示前流程
```

```text
Appeal
────────────────────────
申诉记录及其业务规则
当前 Phase 是否开放申诉动作
```

这样 Phase 不再成为：

> “所有领域事件的中央编排器”。

这对插件化架构尤其重要。

---

所以针对你的两个想法，我的结论是：

1. **删 offset：赞成，而且建议彻底删除，不用另一种更复杂的时间表达替代它。**
2. **“随公示发布”从 Phase 配置中删除：赞成。**
3. **如果公示生效必须推动阶段，让 Publication 可选地指向目标 Phase，而不是 Phase 指向 Publication。**
4. **Publication 页面可读性不要交给 Phase；Publication 管资源状态/可见性，Phase 只管当前允许的动作。**
5. **Phase 本身最终最好只剩 `plannedEntryAt | null`：有时间就是已排期，没时间就是待排期。**
6. **从第一个待排期阶段开始，后面的阶段时间全部待定，形成简单的“连续排期前缀”。**

这样改完之后，你之前那些前端问题基本会消失，因为页面终于可以只表达两种状态：

```text
已排期：9 月 10 日 09:00
```

或者：

```text
待排期
```

不再要求管理员理解 offset、semantic anchor、publication binding、materialization 这些实现概念。

estimated_entry_at要不要改成纯文本，这样就可以手动填写，比如“待审核完成后开始”，“待上级审批通过后开始”，“将于近期开始”这样的。

还有，你说的materialize我觉得挺好，在发布公示时，如果即将进入的下一个阶段尚未排期，可以选择绑定该阶段，此时提交发布后，该阶段将被排期且锁定，此时可以在数据库内存下来源（比如由公示发布设置），也可以取消定时（你觉得是否应该允许取消，还是只能去公示那里取消绑定，还是说公示那里是否绑定由是否定时决定），你帮我想想。

尽可能保持低耦合，我感觉再拆拆，可以把batch和publication拆成两个不同的插件，尽量不要在batch内包含publication的代码和字段。

可以，但要区分两件事：

如果你说的是“绑定关系的事实由 Phase/PhaseSchedule 一侧持有”，我赞成；如果你说的是在 `batch_phases` 里直接加 `publication_id`、`bound_publication_id` 之类字段，我不建议。后者会重新让 Batch 插件依赖 Publication。

真正低耦合的做法是：**绑定的 source of truth 放在 Batch Core 的通用排期记录里，但 Batch Core 完全不知道 Publication 是什么。**

例如不要：

```ts
batch_phases {
  plannedEntryAt
  publicationId // 不要
}
```

而是：

```ts
phase_schedules {
  id
  phaseId
  plannedEntryAt

  ownerKind: 'manual' | 'external'

  // external 时才有
  ownerNamespace: string | null
  ownerRef: string | null
  ownerLabel: string | null

  status: 'scheduled' | 'cancelled' | 'consumed'
}
```

公示创建的就是：

```ts
{
  phaseId: appealPhase.id,
  plannedEntryAt: publication.publishAt,

  ownerKind: 'external',
  ownerNamespace: 'assessment-publication',
  ownerRef: publication.id,
  ownerLabel: '第一次公示发布',
}
```

这样 Phase 页面天然就能看到：

```text
申诉期

计划开始
9 月 10 日 09:00

🔒 由“第一次公示发布”排期
```

而 Publication 插件不需要在 Batch 里留下任何 publication-specific schema。

---

更重要的是：**“是否绑定”不要另外存一个 boolean。**

不要出现：

```ts
Publication {
  bindPhase: true
}
```

同时：

```ts
Phase {
  publicationBinding: ...
}
```

这会产生双 source of truth。

我建议定义：

> 存在一个 `ownerNamespace = assessment-publication` 且 `ownerRef = 当前 publication.id` 的 active PhaseSchedule  
> = 该公示当前绑定了阶段。

也就是说：

```text
绑定不是 Publication 的一个属性，
绑定就是那条 PhaseSchedule 本身。
```

这其实很漂亮。

---

### 公示管理页面怎么工作

打开 Publication 页面时，通过 Batch Core 提供的 capability 查询：

```ts
PhaseScheduling.findOwnedSchedule({
  ownerNamespace: 'assessment-publication',
  ownerRef: publication.id,
})
```

没有结果：

```text
发布后进入下一阶段

☐ 同时排期“申诉期”
```

有结果：

```text
发布后进入下一阶段

☑ 同时排期“申诉期”
   9 月 10 日 09:00

[解除绑定]
```

所以 UI 上仍然可以表现成 checkbox，但 checkbox 本身不是数据库字段。

---

## 取消绑定时，我赞成你说的“这边立刻响应”

Publication 页面执行：

```ts
PhaseScheduling.cancelOwnedSchedule({
  ownerNamespace: 'assessment-publication',
  ownerRef: publication.id,
})
```

于是：

```text
phase_schedules.status
scheduled → cancelled
```

Phase 当前 active schedule 消失。

Phase 页面下一次 query invalidation / subscription 后立刻变成：

```text
申诉期

开始时间
待排期

排期说明
待第一次公示安排
```

这正是你说的行为。

而且没有：

```text
Publication 表改一遍
Phase 表再同步一遍
```

的双写状态。

---

# 但是“取消定时”和“解除公示绑定”要严格区分

这里我会定一个非常清楚的 ownership 规则。

人工创建的排期：

```text
计划开始：9 月 10 日
来源：管理员排期

[修改]
[取消排期]
```

Publication 创建的排期：

```text
计划开始：9 月 10 日
来源：第一次公示发布 🔒

[查看来源]
```

**Phase 页面不能直接取消。**

因为这条 schedule 的 owner 是 Publication。

必须去 Publication 页面：

```text
第一次公示

发布时间
9 月 10 日 09:00

发布联动
☑ 同时进入“申诉期”

[解除阶段联动]
```

解除之后 schedule 被取消。

所以从最终用户角度：

- 人工排期 → “取消排期”
- 公示排期 → “解除公示联动”

虽然底层最后都是：

```ts
PhaseSchedule.cancel()
```

但是业务动作完全不同。

---

# “公示是否绑定由是否定时决定”我不建议

比如下面两个时间恰好一样：

```text
Publication:
9/10 09:00

Phase:
9/10 09:00
```

绝对不能因此认为：

```text
Phase 是由 Publication 绑定的
```

因为管理员完全可能独立排了同一个时间。

必须存在明确 ownership：

```ts
ownerNamespace = 'assessment-publication'
ownerRef = publication.id
```

时间值不能承担关系语义。

---

# Publication 自己还需要存 `scheduleId` 吗？

这里有两个方案。

我更倾向于**不要求存**。

因为可以通过 owner identity 唯一定位：

```ts
;(ownerNamespace, ownerRef, purpose)
```

例如：

```ts
ownerNamespace = 'assessment-publication'
ownerRef = '<publication uuid>'
purpose = 'enter-next-phase'
```

Core 建唯一约束：

```text
一个 owner 的一个 purpose 最多拥有一个 active schedule
```

于是 Publication 只需要知道自己的 ID。

调用：

```ts
scheduleExternal({
  phaseId,
  at,
  owner: {
    namespace: 'assessment-publication',
    ref: publication.id,
    purpose: 'enter-next-phase',
  },
})
```

取消：

```ts
cancelExternal({
  owner: {
    namespace: 'assessment-publication',
    ref: publication.id,
    purpose: 'enter-next-phase',
  },
})
```

查询也是同样。

这样 Publication 表完全不用：

```text
phase_schedule_id
phase_id
bind_phase
```

非常干净。

---

## 依赖方向就变成这样

```text
assessment-core

Phase
PhaseSchedule
PhaseScheduling capability
PhaseAdvance capability
        ▲
        │
        │ generic API
        │
assessment-publication

Publication
Publication lifecycle
```

Publication 认识 PhaseScheduling。

PhaseScheduling 不认识 Publication。

这就是你想要的单向依赖。

---

# 还有一个细节：PhaseSchedule 最好不要直接塞回 `batch_phases`

这一轮如果准备认真拆，我会更推荐独立表：

```sql
batch_phases
----------------
id
batch_id
ordinal
phase_key
display_name
actual_entry_at
entry_note
permission_profile
...
```

```sql
phase_schedules
----------------
id
phase_id
planned_entry_at

owner_kind
owner_namespace
owner_ref
owner_purpose
owner_label

status
created_at
cancelled_at
consumed_at
```

这样一个 Phase 的历史：

```text
9/8
管理员排到 9/10
→ cancelled

9/9
第一次公示排到 9/11
→ cancelled

9/10
第一次公示改排 9/12
→ consumed
```

全都有审计痕迹。

而 Phase 自身只保存历史事实：

```ts
actualEntryAt
```

这比不停覆盖：

```ts
batch_phases.planned_entry_at
```

更适合你的系统。

---

# 公示改期也因此特别简单

第一次公示当前：

```text
publishAt = 9/10 09:00
```

它拥有：

```text
申诉期 schedule = 9/10 09:00
```

管理员在 Publication 页面改成：

```text
9/11 09:00
```

Publication service 在同一个业务操作里：

```ts
yield* updatePublication(...)
yield* phaseScheduling.rescheduleOwned({
  owner: publicationOwner(publication.id),
  at: newPublishAt,
})
```

结果：

```text
Publication  9/11 09:00
Phase        9/11 09:00 🔒 第一次公示发布
```

这里的“立刻响应”来自**同一个 command 更新 ownership schedule**，而不是因为某个 FK 恰好放在 Phase 表里。

这是我觉得最值得明确的一点：

> **即时一致性取决于事务/服务边界，而不取决于关系字段放在哪张表。**

---

所以，我会采纳你想法的核心，但稍微改一下表述：

不是：

> “是否绑定阶段存在阶段表里。”

而是：

> **“阶段排期是绑定关系的唯一事实；Publication 不再额外保存一个‘是否绑定’状态。外部来源信息以通用 ownership metadata 存在 PhaseSchedule 中。”**

这样既能做到公示页面一解除、阶段页面立刻恢复“待排期”，又不会让 Batch Core 出现任何 `publication_*` 字段。我认为这是两边兼顾得最好的方案。

那项目设置阶段的流程就可以变化了，我首先加一个阶段备注字段。

首先，阶段模板里只存阶段名称、阶段备注和阶段开放的操作，时间线模板里只存一个按一定顺序排布的、包含多个阶段模板的一个数组，不存储任何排期相关信息。
然后，应用时间线模板也只是将一批未排期的阶段插入到时间线最后面，不会影响和污染当前批次的进程。
然后，管理员再对时间线的每一个阶段从上到下依次进行排期，继而开放一个一个批次；如果当前批次不在任何阶段中（没有任何一个阶段进行中），那么普通用户无法在系统中看到这个批次。
排期时，可以选择立即开始或定时开始，立即开始在排期请求提交到后端的一刻即开始。用户只能从上到下对未排期的批次进行排期，有多个未排期的批次时，只能排期最上面的一个（还是说你认为未排期的批次可以按照任何顺序进行排期？未排期的批次是否应该支持顺序交换？）。排期时，新排期的阶段只能排期在最后一个已排期的阶段的后面。

你觉得阶段的名称备注和操作设置和阶段的排期是否要分成两个页面，还是做成一个页面即可，毕竟现在信息量并不大？

我觉得这版已经可以收敛成一个很清楚的模型了。关键不再是“给一整条时间线建模”，而是：

> **先定义阶段序列，再从上到下逐个把阶段加入运行计划。**

这两个动作可以概念上分开，但我不建议现在拆成两个页面。

先说我最赞成的一条：**维护一个“已确定前缀 + 未确定后缀”的严格不变量。**

也就是任意时刻只能是：

```text
阶段 1    已进入 / 已排期
阶段 2    已进入 / 已排期
阶段 3    已进入 / 已排期
----------------------- 排期边界
阶段 4    未排期
阶段 5    未排期
阶段 6    未排期
```

绝不允许：

```text
阶段 1    已排期
阶段 2    未排期
阶段 3    已排期    ×
```

这一个约束能把大量复杂性直接消掉。

### 未排期阶段：我建议允许换顺序

而且只允许在“未排期后缀”里换。

例如当前：

```text
① 填报期           已结束
② 审核期           当前
③ 第一次公示准备   未排期
④ 申诉期           未排期
⑤ 最终确认         未排期
```

管理员可以把：

```text
③ 第一次公示准备
④ 申诉期
⑤ 最终确认
```

自由排序、删除、插入、套模板。

因为它们还没有产生任何运行时承诺。

但：

```text
①
②
```

已经进入/排期的前缀不能换。

所以其实可以给模型一个非常漂亮的概念：

```text
┌──────── 已确定区域 ────────┐
① 填报
② 审核
└───────────────────────────┘

          排期到这里

┌──────── 可编排区域 ────────┐
③ 公示准备
④ 申诉
⑤ 最终确认
└───────────────────────────┘
```

这比“哪些字段能改、哪些不能改”容易理解得多。

---

### 排期则只能排“第一个未排期阶段”

这一点我建议严格限制，不要允许任意挑。

假设：

```text
③ 公示准备    未排期
④ 申诉期      未排期
⑤ 最终确认    未排期
```

只能：

```text
[为 ③ 公示准备排期]
```

不能直接：

```text
[为 ⑤ 最终确认排期]
```

否则你立刻又回到了之前的问题：

> ③、④ 时间都不知道，⑤ 的绝对时间有什么意义？

所以规则就是：

> **结构可以先全部排好；时间只能从上往下逐个确定。**

这句话可以直接写进 UI 帮助文案。

---

## “立即开始”和“定时开始”也能因此变得特别简单

点当前第一个未排期阶段：

```text
③ 审核整理期

开始方式

● 立即开始
  提交后立即结束当前阶段并进入本阶段

○ 定时开始
  [2026-09-08 09:00]
```

但这里有一个必要限制。

如果前一个阶段还只是“未来已排期”，不能选立即开始。

例如：

```text
② 填报期
计划 9月5日 开始

③ 审核期
未排期
```

现在才 9月1日。

你不能给③：

```text
立即开始
```

否则③会跑到②前面。

所以“立即开始”仅在两种情况下可用：

1. 第一阶段还没开始，立即启动整个批次；
2. 前一个阶段已经实际进入，立即推进到下一阶段。

否则：

```text
立即开始    disabled

前一阶段尚未开始
```

只能选择：

```text
定时开始：必须晚于前一阶段的计划开始时间
```

---

## 这也让“结束时间”彻底从模型里消失

其实到了你这版模型，后台已经不用再配置结束时间了。

用户仍然可以在 UI 看：

```text
审核期

开始
9月5日 09:00

结束
待下一阶段排期
```

等④排期以后：

```text
审核期

开始
9月5日 09:00

结束
9月10日 09:00
```

但“结束”永远只是 projection：

```ts
endOf(phase[i]) = startOf(phase[i + 1])
```

而不再让用户编辑。

这个时候前端也完全没必要再让用户选择：

```text
按结束时间
按持续时间
```

你之前纠结的整套 duration/end 编辑器可以一起删除。

这是非常大的简化。

---

# 你的阶段模板设计我基本赞成

阶段模板：

```ts
PhaseTemplate {
  name
  note
  permissionProfile
}
```

不包含：

```text
开始时间
结束时间
offset
预计时间
publication
```

非常合理。

时间线模板：

```ts
TimelineTemplate {
  phases: [
    phaseTemplateA,
    phaseTemplateB,
    phaseTemplateC,
  ]
}
```

只表达：

> 这些业务状态通常按照什么顺序出现。

不表达：

> 这一次批次具体哪天发生。

这两个东西本来就不应该混。

---

### 应用时间线模板也应该改成 Append

这个我也赞成。

假设当前：

```text
① 填报期       已结束
② 审核期       当前

---------- 未排期 ----------

③ 补充审核
```

应用：

```text
“标准公示与申诉流程”
```

包含：

```text
公示准备
申诉期
最终确认
```

结果：

```text
① 填报期       已结束
② 审核期       当前

---------- 未排期 ----------

③ 补充审核
④ 公示准备
⑤ 申诉期
⑥ 最终确认
```

不碰①②。

甚至不碰已有③。

这才符合“模板是快速添加一组阶段”的语义。

我会把 UI 文案从：

> 应用时间线模板

改成：

> **从模板添加阶段**

因为“应用模板”容易让人理解成 replace。

例如：

```text
[＋ 从模板添加阶段]
```

---

# TimelineTemplate 有一个实现细节建议

如果你存：

```ts
phaseTemplateIds: [...]
```

要明确模板更新的语义。

我建议：

> 时间线模板引用阶段模板；应用时复制阶段模板当前内容到 BatchPhase，此后脱离模板。

所以：

```text
PhaseTemplate 改名
```

不会修改已经创建出来的 BatchPhase。

这一点和普通“模板”心智一致。

如果以后需要模板本身强可复现，再加 revision，不要现在先搞复杂。

---

# `note` 我建议保留，而且就是纯文本

现在的 `note` 可以承担：

```text
审核整理期间处理所有待审材料及异常情况。
```

也可以：

```text
预计待本轮审核完成后进入。
```

也可以：

```text
具体开放时间由学院另行通知。
```

它不参与任何业务判断。

我甚至建议 UI 不叫“备注”，而叫：

> **阶段说明**

因为“备注”听起来像后台管理员自用信息，而这段文字将来可能很适合直接展示给学生。

如果确实只给管理员看，那才叫“内部备注”。

你最好现在就决定 scope：

```ts
description // 可面向普通用户
```

还是：

```ts
internalNote // 管理员备注
```

不要以后发现有隐私信息却已经展示给学生。

---

# 关于“Batch 当前没有阶段时普通用户不可见”

我认为可以。

而且从你的新模型看特别自然：

初始：

```text
Batch = draft/ready
所有 Phase 未排期
currentPhase = null
```

普通用户：

```text
看不到 Batch
```

管理员给第一阶段：

```text
立即开始
```

或者：

```text
9月1日 09:00 定时开始
```

在真正达到 `actualEntryAt` 之前：

```text
currentPhase = null
```

普通用户仍看不到。

到：

```text
9月1日 09:00
```

scheduler 进入 Phase 1：

```text
currentPhase = phase1
```

Batch 才进入用户视野。

这个产品语义非常好：

> **批次真正开始运行以后才对参与者出现。**

不过有一个例外需要单独决定：

**归档后的 Batch 是否仍允许普通用户查历史？**

我不建议用：

```text
currentPhase == null
```

永久决定所有 visibility。

更合理：

```text
未开始 → 不可见
运行中 → PhaseGate 决定
已归档 → history policy 决定
```

否则归档后成绩、历史公示之类容易被一起隐藏。

---

# 关于“阶段设置”和“阶段排期”要不要拆两个页面

我的建议明确：

**现在不要拆。一个页面。**

原因不是“页面少比较方便”，而是这两个信息天然共享同一条有序阶段序列。

拆开以后会变成：

页面 A：

```text
阶段设置

① 填报期
② 审核期
③ 公示期
④ 申诉期
```

页面 B：

```text
阶段排期

① 填报期 9/1
② 审核期 9/5
③ 公示期 待排期
④ 申诉期 待排期
```

用户会频繁来回找同一个 Phase。

收益很低。

---

## 但在一个页面里，要把两种动作视觉分开

我会把 Phase 卡设计成：

```text
┌─────────────────────────────────────────────────────────┐
│ ② 审核整理期                                当前        │
│                                                         │
│ 处理学生提交材料的审核、异常与补充材料。                │
│                                                         │
│ 开始时间                                                │
│ 2026-09-05 09:00                                       │
│                                                         │
│ 下一阶段尚未排期                                        │
│ 因此本阶段结束时间暂未确定                              │
│                                                         │
│ [开放 5 项操作]                                        │
└─────────────────────────────────────────────────────────┘
```

第一个未排期：

```text
┌─────────────────────────────────────────────────────────┐
│ ③ 第一次公示准备                             待排期     │
│                                                         │
│ 准备并发布本轮第一次成绩公示。                          │
│                                                         │
│ [立即开始]      [定时开始]                              │
│                                                         │
│ [开放 3 项操作]                       [编辑阶段] [删除]  │
└─────────────────────────────────────────────────────────┘
```

更后面的：

```text
┌─────────────────────────────────────────────────────────┐
│ ④ 申诉期                                     待排期     │
│                                                         │
│ 第一次公示后开放学生成绩申诉。                          │
│                                                         │
│ 请先为“第一次公示准备”排期                              │
│                                                         │
│ [开放 2 项操作]                        [编辑阶段]        │
└─────────────────────────────────────────────────────────┘
```

这样同一个页面天然表达：

- 已运行；
- 已排期；
- 当前排期 frontier；
- 更远未来。

用户不需要理解什么“armed prefix”。

---

# 未排期阶段的编辑，我会允许这些操作

在 unscheduled suffix：

- 修改名称；
- 修改说明；
- 修改开放操作；
- 删除；
- 插入；
- 拖动排序；
- 从模板追加。

一旦某阶段排期：

- 顺序锁定；
- 不可删除；
- 排期进入自己的取消/改期规则；
- 名称、说明是否可继续改，可以根据审计要求决定；
- 权限 Profile 最迟在实际进入时冻结，或者继续走你的 config log。

我尤其推荐：

> **排期锁结构，进入锁历史。**

也就是：

```text
unscheduled
→ structure editable

scheduled
→ position immutable

entered
→ timing/history immutable
```

这个生命周期很好解释。

---

# 还有一个对称规则非常值得加：撤销排期只能从后往前

既然排期是：

```text
从上往下逐个排
```

撤销就应该：

```text
从下往上逐个撤
```

例如：

```text
① 已进入
② 已排期
③ 已排期
④ 未排期
```

你不能直接取消②而保留③。

应该先：

```text
取消③
```

再：

```text
取消②
```

于是永远维持：

```text
[entered/scheduled prefix][unscheduled suffix]
```

这个不变量特别值钱。

如果②来自 Publication external schedule，也一样，只不过取消入口在 Publication 插件；如果③已经存在，则 Publication 不能解除②绑定，必须先处理③。

这比做“自动级联取消所有后续排期”安全，因为后续排期可能属于其他业务 owner。

---

# 我会最终把核心模型定成这样

结构：

```text
Batch
 └── ordered BatchPhase[]
```

Phase：

```ts
BatchPhase {
  id
  batchId
  ordinal

  name
  description
  permissionProfile

  actualEntryAt
}
```

排期独立：

```ts
PhaseSchedule {
  phaseId
  plannedEntryAt

  owner
  status
}
```

模板：

```ts
PhaseTemplate {
  name
  description
  permissionProfile
}

TimelineTemplate {
  orderedPhaseTemplates
}
```

核心不变量：

```text
1. entered/scheduled phases 永远形成前缀
2. unscheduled phases 永远形成后缀
3. 只能排期第一个 unscheduled phase
4. unscheduled suffix 可以自由重新编排
5. scheduled prefix 的顺序不可变
6. 只能从 scheduled prefix 尾部撤销未来排期
7. Phase end = next Phase actual/planned start 的展示投影，不单独存储
```

最后你问“一个页面还是两个页面”，我会选：

> **一个“阶段与排期”页面，两个职责，不是两个页面。**

现在你的信息量已经足够低，拆页反而会人为制造导航成本。真正应该拆的是**领域模型和命令**：`edit phase definition` 与 `schedule phase` 是两个不同 command；前端完全可以把它们放在同一张 Phase 卡里。

而且按这版模型，你之前那个越来越复杂的时间线编辑器基本可以删掉重写了：不会再需要 offset、duration/end 互推、publication trigger、boundary editor、Popover、共享边界高亮等大部分东西。页面会简单很多。

简化一下你的前端设计，我不喜欢这个场景用卡片设计，因为本身是一个具有先后顺序的东西，用类表格元素/表格来实现从上到下一行一个，方便快捷。你设计下。

可以。你这个场景确实更适合“顺序表”而不是卡片。因为核心信息就是：

> 阶段顺序 + 阶段定义 + 排期状态

我建议做成一个很克制的类表格列表，默认浏览，点“编辑阶段”后原地编辑。

整体：

```text
阶段与排期                                            [从模板添加] [编辑阶段]

序号   阶段                     开放操作        计划开始              状态 / 操作
────────────────────────────────────────────────────────────────────────────
01    学生填报期                6 项操作         09-01 08:00           已结束
      学生提交综合测评材料

02    审核整理期                4 项操作         09-05 18:00           进行中
      审核提交材料并处理异常

03    第一次公示                3 项操作         待排期                 [立即开始] [排期]
      发布第一次测评结果
────────────────────── 排期到这里 ─────────────────────────────────────────

04    申诉期                    2 项操作         待排期                 —
      接收并处理学生申诉

05    最终确认                  1 项操作         待排期                 —
      确认最终测评结果

                                                        [+ 添加阶段]
```

我认为这基本就是最终形态。

几个关键点。

第一，列不要太多。只保留 5 列：

```text
序号 | 阶段 | 开放操作 | 计划开始 | 状态/操作
```

不要再出现：

```text
持续时间
结束时间
结束方式
```

因为你现在的新模型里这些已经不是配置项。

阶段“结束时间”如果用户需要看，可以作为辅助信息显示在“计划开始”下面：

```text
09-05 18:00
结束：待下一阶段排期
```

或者：

```text
09-05 18:00
结束：09-10 09:00
```

但不要单独占一列。

---

第二，“阶段”这一列应该承担名称 + 说明。

不要再额外搞“备注”列。

```text
审核整理期
审核提交材料并处理异常
```

第一行 `font-medium`，第二行 `text-muted-foreground text-xs`。

这样信息密度很好。

编辑模式就直接：

```text
[审核整理期                     ]
[审核提交材料并处理异常         ]
```

不用弹窗。

---

第三，“开放操作”只显示数量。

例如：

```text
[6 项操作]
```

点击打开 Drawer：

```text
审核整理期 · 开放操作

学生操作                 审核操作

☑ 创建材料              ☑ 审核
☑ 修改材料              ☑ 驳回
☑ 提交                  ☐ 转交
☐ 撤回

                    [完成]
```

桌面端直接两列：

```tsx
className = 'grid gap-4 md:grid-cols-2'
```

这一块和排期完全分离。

---

第四，真正重要的是中间这个“排期边界”。

比如：

```text
01 已结束
02 进行中
03 待排期
──────── 排期到这里 ────────
04 待排期
05 待排期
```

实际上如果第 03 是第一个未排期阶段，我更推荐：

```text
02 审核整理期      进行中

──────────── 下一阶段 ────────────

03 第一次公示      待排期     [立即开始] [排期]

04 申诉期          待排期     请先排期上一阶段
05 最终确认        待排期     请先排期上一阶段
```

也就是说只有 frontier row 有操作。

比每行都放 disabled button 干净。

---

第五，排期操作本身非常简单。

点：

```text
[排期]
```

弹一个小 Dialog：

```text
排期“第一次公示”

开始时间
[ 2026-09-10 09:00 ]

                    [取消] [确认排期]
```

点：

```text
[立即开始]
```

ConfirmDialog：

```text
立即进入“第一次公示”？

当前“审核整理期”将结束，
批次将立即进入“第一次公示”。

[取消] [立即开始]
```

不要为了这个操作把 DateTimePicker 永久塞进表格。

因为排期不是高频 inline edit，放 Dialog 更干净。

---

第六，“编辑阶段”和“排期”要区分。

顶部：

```text
[编辑阶段]
```

进入编辑模式后：

```text
[完成编辑]
```

表格变化：

```text
序号   阶段                           开放操作      计划开始       操作
──────────────────────────────────────────────────────────────────
01    [学生填报期]                   [6 项操作]     09-01 08:00    🔒
      [学生提交综合测评材料]

02    [审核整理期]                   [4 项操作]     09-05 18:00    🔒
      [审核提交材料并处理异常]

03    [第一次公示]                   [3 项操作]     待排期          [删除]
      [发布第一次测评结果]

04    [申诉期]                       [2 项操作]     待排期          [删除]
      [接收并处理学生申诉]
```

只有未排期 suffix：

- 名称可改；
- 说明可改；
- 操作可改；
- 可删除；
- 可排序。

已排期前缀最好直接锁结构：

```text
🔒 已排期
```

这样用户很容易理解。

---

第七，未排期阶段排序建议用 drag handle。

比如：

```text
⋮⋮ 03  第一次公示
⋮⋮ 04  申诉期
⋮⋮ 05  最终确认
```

只在编辑模式显示。

已排期部分没有 handle。

所以视觉上天然表达：

```text
固定区域
──────────
可编辑区域
```

---

第八，插入阶段不要再做那条巨宽的线。

直接做表格行 hover seam：

正常：

```text
03 第一次公示
04 申诉期
```

hover 中间 4~6px 区域：

```text
03 第一次公示
──────────── + 插入阶段 ────────────
04 申诉期
```

实现仍然是：

```tsx
<div className="group relative h-0">
  <div className="absolute inset-x-0 top-0 ... opacity-0 group-hover:opacity-100">
```

不占布局高度。

不过我甚至认为第一版可以不做每行插入。

只保留底部：

```text
[+ 添加阶段]
[+ 从模板添加]
```

再支持拖拽排序，已经足够用了。

这样 UI 更干净。

---

第九，计划开始这一列的状态文案统一成三个。

只需要：

```text
09-10 09:00
```

```text
待排期
```

```text
09-10 09:00
由第一次公示设置 🔒
```

如果还有 `entry_note`：

```text
待排期
待审核完成后安排
```

第二行小字即可。

不用设计更多 badge。

---

第十，最下面的保存条也可以取消。

既然阶段定义编辑现在这么轻，可以顶部就：

```text
[取消] [保存修改]
```

进入编辑模式：

```text
阶段与排期                              3 处修改   [取消] [保存]
```

如果你仍然喜欢 fixed footer，就缩成：

```text
┌────────────────────────┐
│ 3 处修改   取消   保存 │
└────────────────────────┘
```

但我觉得这版已经没必要做 floating bar 了。

---

我最终会采用这样的视觉：

```text
阶段与排期                                  [从模板导入] [编辑阶段]

      阶段                    开放操作       计划开始             状态
──────────────────────────────────────────────────────────────────────
01    学生填报期              6 项操作        09-01 08:00          已结束
      学生提交综合测评材料

02    审核整理期              4 项操作        09-05 18:00          进行中
      审核材料及处理异常

──────────────────────── 以下阶段尚未排期 ────────────────────────────────────

03    第一次公示              3 项操作        待排期                [排期]
      发布第一次测评结果

----------------------------- [+ 在此添加阶段] （鼠标移入空隙后出现本行，不影响布局间距）-----------------------------

04    申诉期                  2 项操作        待排期                    请先排期其他阶段
      接收并处理学生申诉

----------------------------- [+ 在此添加阶段] （鼠标移入空隙后出现本行，不影响布局间距）-----------------------------

05    最终确认                1 项操作        待排期                    请先排期其他阶段
      确认最终测评结果

                                               [+ 添加阶段]
```

这版的好处是：没有卡片、没有复杂时间轴、没有共享边界、没有 duration/end 的解释负担。用户从上往下看，就是业务实际运行顺序。前端也会比你前面那几版少大量状态和组件。
