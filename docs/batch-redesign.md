还有你觉得角色分配在本项目应该是批次级的还是租户级的？注意角色分配不应该包含批次的相关代码。或者是和花名册一样，花名册创建的时候也把assessment相关权限拷贝一份副本，批次开始后可以再进行修改什么的。或者是创建批次的时候就复制，现在是在第一次排期的时候才复制，我觉得太晚了，万一管理员想立即开始呢，那可能就会出现各种问题，比如权限默认按租户角色分配后管理员没来得及取消导致的越权访问。

我建议不要做“Batch 级角色分配”。角色仍然是租户/组织层的通用 RBAC 概念；Batch 自己维护一份**批次访问授权快照**。这两者要刻意区分。

核心关系可以定成：

```text
租户 / 组织 RBAC
回答：
“这个人在组织里通常具有什么职责和权限？”

                ↓ 创建 Batch 时解析

Batch Access Grants
回答：
“在这个具体批次里，这个人实际被授予什么能力？”

                ↓ 再与当前 Phase 相交

Phase Permission Profile
回答：
“当前阶段现在开放哪些操作？”
```

最终有效权限：

```text
有效权限
=
Batch 授权
∩
当前 Phase 开放操作
∩
资源自身约束
```

比如辅导员租户角色有：

```text
assessment.submission.read
assessment.submission.review
assessment.submission.assist
```

创建某个 Batch 时，根据 Batch 的组织范围，把这些授权 materialize 进去：

```text
张老师

批次授权：
✓ 查看填报
✓ 审核填报
✓ 协助填报
```

到了“学生填报期”，Phase 可能只有：

```text
查看填报
协助填报
```

那么 `review` 即使张老师有，也暂时不能用。

到了“审核期”才开放。

这和你已有的 Phase permission profile 职责正好互补。

---

## 我推荐在“创建 Batch 时”就 materialize

不要等第一次排期。

现在第一次排期才复制确实太晚了。

尤其你已经支持：

```text
立即开始
```

那么：

```text
点击立即开始
→ 才创建 roster
→ 才解析权限
→ 同时进入第一阶段
```

这个事务承担的东西太多，而且管理员根本没有机会在运行前检查最终结果。

改成：

```text
创建 Batch
  ↓
立即 materialize
  ├─ 参评花名册
  └─ 批次访问授权
  ↓
Batch 草稿
  ↓
管理员检查 / 修改
  ↓
立即开始 or 定时开始
```

第一次排期以后只做：

```text
validate
→ create schedule / actual entry
```

不要再承担初始化。

这样安全边界清楚很多。

---

## 花名册也建议同步提前到创建时

也就是创建 Dialog：

```text
批次名称
材料时间
组织节点
人员类型
```

提交以后，后台：

```text
create Batch

根据：
组织节点 + 人员类型
    ↓
生成 draft roster

根据：
当前 RBAC assignments + Batch scope
    ↓
生成 batch access grants
```

然后进入 Batch Overview：

```text
草稿

参评名单
528 人                         [查看]

访问授权
12 名工作人员                 [查看]

阶段安排
尚未配置                      [配置阶段]

首阶段
尚未排期
```

管理员此时可以先检查再启动。

---

# 但我不建议简单“把当前权限永久复制下来”

这里有一个安全问题。

假设创建 Batch 时：

```text
张老师拥有“辅导员”角色
↓
Batch snapshot 给了审核权限
```

第二天学校撤销了张老师的辅导员身份。

如果 Batch 完全使用静态副本，他可能依然能审核这个 Batch。

所以我建议做成：

> **授权内容 snapshot，但授权来源仍然必须有效。**

例如：

```ts
BatchAccessGrant {
  batchId
  subjectId

  permissions: PermissionCode[]

  source:
    | {
        kind: "rbac"
        assignmentId: UUID
      }
    | {
        kind: "manual"
      }
}
```

来自 RBAC：

```text
source = rbac assignment #123
```

运行时要求：

```text
BatchAccessGrant 存在
AND
source assignment #123 仍有效
```

因此：

### 后来新给一个老师角色

不会自动进入旧 Batch：

```text
new tenant assignment
→ existing Batch 不自动增加权限
```

这保证 Batch 的访问面不会偷偷扩大。

### 后来撤销一个老师角色

立即失效：

```text
source assignment revoked
→ existing Batch grant 也不能再使用
```

这保证安全撤权立即生效。

我认为这是非常适合你这个场景的折中：

> **新增不自动传播，撤权立即传播。**

权限系统里这往往比单纯 snapshot 更安全。

---

## 角色本身后来修改权限怎么办？

我也建议**不要自动传播到已经存在的 Batch**。

例如：

```text
辅导员角色

原来：
submission.read
submission.review
```

后来租户管理员加：

```text
publication.manage
```

已经运行半年的所有 Batch 不应该突然让辅导员获得：

```text
publication.manage
```

所以 Batch 保存的是创建/同步时的 permission-code snapshot：

```text
张老师
来源：辅导员角色
授权：
  submission.read
  submission.review
```

以后 Role Definition 改了，旧 Batch 不变。

需要更新时管理员显式：

```text
[同步组织权限]
```

并且先显示 diff：

```text
同步权限

将新增
+ 李老师：材料审核
+ 张老师：公示管理

将移除
- 王老师：材料审核

[取消] [应用变更]
```

不过对于已经运行的 Batch，我甚至建议默认不自动执行删除/新增，而是显式确认并留审计。

---

# Batch 里面不要再叫“角色”

这是我比较推荐坚持的一点。

租户层：

```text
角色
角色分配
```

Batch 层：

```text
访问授权
```

或者 UI 可以叫：

```text
工作人员权限
```

因为如果你又在 Batch 里出现：

```text
角色：审核员
角色：负责人
```

很快就会让人问：

> 这是租户角色还是批次角色？

然后你就得到两套 RBAC。

没必要。

Batch 只需要：

```text
用户 / 主体
作用范围
允许操作
来源
```

例如：

```text
批次访问授权

姓名       授权范围       权限               来源
────────────────────────────────────────────────────────
张老师     软件学院       查看、审核          辅导员角色
李老师     2024级         查看、协助填报      年级负责人
王老师     本批次         公示管理            手动授权
```

这足够了。

---

## 这里甚至不需要让 RBAC 插件知道 Assessment

依赖方向可以保持：

```text
RBAC
提供：
resolveAssignments(...)
isAssignmentActive(...)
permissions...
       ▲
       │
Assessment
```

Assessment 创建 Batch 时主动查询：

```ts
rbac.resolvePermissions(...)
```

然后只提取自己声明的 permission namespace：

```text
assessment.*
```

写进自己的：

```text
batch_access_grants
```

RBAC 完全没有：

```text
batch_id
assessment_batch
assessment_role
```

满足你说的：

> 角色分配不应该包含批次相关代码。

---

# 参评花名册和 Batch Access Grant 其实可以采用同一套生命周期

我会定义：

### 创建时

```text
Roster
materialized

Access grants
materialized
```

都是草稿态可调整。

### 首阶段排期前

做完整检查：

```text
✓ 参评名单有效
✓ 批次访问授权有效
✓ 至少一个阶段
✓ 首阶段可进入
```

### Batch 已经运行

Roster：

```text
默认稳定
特殊修改需要明确业务动作 + 审计
```

Access grants：

```text
仍允许修改
```

因为现实中工作人员变更是正常需求：

- 辅导员换人；
- 临时添加审核人员；
- 撤销某人权限；
- 增加负责人。

不应该因为 Batch 已开始就锁死工作人员授权。

但所有修改：

```text
actor
time
reason（高风险操作可要求）
before
after
```

进入审计。

---

## 一个例外：参评人自己的权限不要大量复制

比如学生本身：

```text
submission.create
submission.edit
submission.submit
appeal.create
publication.read
```

如果所有 500 个学生都写一堆 permission rows，会很啰嗦。

这里可以让 Roster 本身作为 participant entitlement：

```text
user ∈ BatchRoster
→ participant capability profile
```

然后再和 Phase Profile 相交。

也就是说可以分：

```text
Participant
= roster membership 决定基础能力

Staff
= batch_access_grants 决定基础能力
```

如果人员类型本身有不同 participant capabilities，也可以由 roster `userType` 决定。

这样不会把：

```text
500 人 × 10 permissions
```

全复制一遍。

工作人员数量少，做显式 grants 很合理。

---

# 我最终建议的模型

```text
Tenant / Org RBAC
────────────────────────
角色定义
角色分配
组织 scope

不知道 Batch
```

创建 Batch：

```text
Batch
├─ Roster snapshot
│
└─ AccessGrant snapshot
      ↑
      来源于当前有效 RBAC assignment
```

运行时：

```text
参评人：
Roster entitlement
      ∩ Phase Profile

工作人员：
Batch Access Grant
      ∩ source assignment still active
      ∩ Phase Profile
```

再加资源自己的 guard。

---

所以你的几个选择里，我最推荐的是：

1. **角色分配仍然是租户/组织级，不做 Batch Role。**
2. **Assessment 自己有 Batch 级 Access Grant，但它不是“角色”。**
3. **Roster 和 Access Grant 都在创建 Batch 时立即 materialize，而不是第一次排期。**
4. **创建后、开始前都允许管理员检查和修改。**
5. **Batch 开始后工作人员授权仍可修改并审计。**
6. **新 RBAC 授权不自动扩散到已有 Batch；RBAC 撤权则立即使其来源授权失效。**
7. **Phase Profile 继续只控制“当前阶段开放哪些操作”，不承担人员身份分配。**

尤其第 3 点我觉得应该改：**第一次排期应该只是把已经准备好的 Batch 投入运行，不应该同时完成 roster/authorization 初始化。** 这会让“立即开始”也安全得多。

要么就做一个叠加层，即Batch内可以复写租户的角色配置，RBAC内新增/删除的角色配置会立即响应，但是管理员可以进行覆盖，比如取消其权限？还是说你帮我想想应该怎么做更好

我会做“继承 + Batch 覆盖”，但不是完全实时继承。最稳的原则是：

> **租户 RBAC 的收权立即生效，扩权不能自动进入既有 Batch。Batch 还能进一步收紧权限。**

这比“RBAC 一改，所有 Batch 双向实时跟着变”安全很多。

比如创建 Batch 时，张老师因为“辅导员”角色拥有：

```text
查看填报
协助填报
审核材料
```

Batch 创建时把这三个 `assessment.*` 权限作为这个来源的 baseline 记下来。

之后租户侧发生变化：

```text
辅导员删除“审核材料”
→ Batch 立即失去“审核材料”          ✓

张老师不再是辅导员
→ Batch 立即失去这组来源授权        ✓

辅导员新增“公示管理”
→ 旧 Batch 不自动获得               ✓

李老师后来被分配为辅导员
→ 旧 Batch 不自动加入               ✓
```

这样形成一个很重要的安全性质：

> **外部 RBAC 的变化可以自动缩小既有 Batch 的权限面，但不能悄悄扩大它。**

否则如果一个系统管理员今天给“辅导员”角色新增 `assessment.publication.manage`，去年尚未归档甚至重新开启的几十个 Batch 会突然全部允许辅导员管理公示，这种隐式扩权很危险。

### Batch 覆盖层建议先只做“拒绝”

比如 Batch 权限页显示：

```text
张老师
来源：辅导员

组织权限                本批次
查看填报                 继承
协助填报                 继承
审核材料                 继承
公示管理                 —

                         [调整权限]
```

管理员可以把：

```text
审核材料
继承  →  本批次禁用
```

最终计算：

```text
RBAC 当前仍有效
        ∩
Batch 创建/同步时接受过的权限
        −
Batch 显式禁用权限
        ∩
当前 Phase 开放权限
```

我第一版甚至**不做 Batch `allow` 覆盖**。因为“这个人租户层根本没有权限，但某个 Batch 强行给他”实际上已经是另一套授权系统了。

如果以后真的有“临时指定某老师只审核这个批次”的真实需求，再单独增加：

```text
批次直接授权
```

不要和“覆盖继承权限”混成一个 tri-state checkbox。

---

### 数据上可以做得很干净

RBAC 仍然完全不知道 Batch。

Assessment 自己保存类似：

```ts
BatchAccessSource {
  batchId
  sourceAssignmentId
  acceptedPermissions: PermissionCode[]
}
```

再保存：

```ts
BatchPermissionDeny {
  batchId
  sourceAssignmentId
  permission: PermissionCode
}
```

运行时假设：

```text
创建时辅导员有：
A B C

acceptedPermissions：
A B C
```

后来角色变成：

```text
A B D
```

那么：

```text
accepted ∩ current
=
A B
```

所以：

- `C` 被租户撤掉，立即消失；
- `D` 是后来新增，不会进入旧 Batch。

再减 Batch deny：

```text
Batch deny B
```

最终：

```text
A
```

这个模型非常漂亮。

而且如果整个 `sourceAssignmentId` 被撤销：

```text
source inactive
→ 整组权限立即失效
```

---

### 新增权限怎么进入既有 Batch？

做显式的：

```text
[同步组织权限]
```

而且先给 diff：

```text
同步组织权限

组织权限发生了变化：

新增可用权限
+ 辅导员：公示管理

新增人员
+ 李老师：辅导员

已失效
- 王老师：年级负责人
- 张老师：审核材料

已失效的权限已经自动停止生效。
下面的新增内容需要确认后才会加入本批次。

                         [取消] [应用新增权限]
```

这里“已失效”其实已经实时生效，页面只是告诉管理员发生过什么；只有正向变化才需要批准。

这样审计也非常好写。

---

### Batch 创建时就建立 baseline

这一点我仍然坚持，不要等第一次排期：

```text
创建 Batch
    ↓
生成 Roster
生成 Batch RBAC baseline
    ↓
草稿
    ↓
管理员检查参评名单和权限
    ↓
配置阶段
    ↓
立即开始 / 定时开始
```

所以“立即开始”只是改变运行状态，不会顺便初始化权限。

创建完 Batch 后，管理导航可以有：

```text
参评名单
访问权限
```

甚至可以把它们合成一个：

```text
人员与权限
```

但数据模型还是分开的。

---

### 我不推荐“完全动态叠加”

也就是不要：

```text
effective =
currentTenantRBAC
- batchDeny
```

它表面最简单，但有一个根本漏洞：

假设 Batch 管理员今天检查完：

```text
辅导员：
✓ 查看
✓ 审核
```

确认没问题。

明天租户角色新增：

```text
✓ 代填
```

Batch 管理员从未审核过这项权限，但这些人突然全能替学生填写。

你甚至无法要求管理员提前 deny 一个当时还不存在的 permission。

所以**仅有 deny overlay 不足以控制未来扩权**。

必须有那个：

```text
acceptedPermissions
```

作为 Batch 的权限上限快照。

---

我最终推荐的权限模型可以浓缩成三层：

```text
租户 RBAC
“这个人现在还具不具备这些组织身份和基础权限？”
             ↓
Batch Access Baseline
“这个批次曾经明确接受过哪些权限？”
             ↓
Batch Deny Overrides
“本批次还要额外关掉哪些？”
             ↓
Phase Permission Profile
“当前阶段现在开放哪些？”
             ↓
Effective Permission
```

其中传播规则就四句话：

1. **创建 Batch 时立即生成 baseline。**
2. **租户撤角色、撤分配、撤权限，立即收权。**
3. **租户新增角色、人员或权限，不自动扩权到已有 Batch。**
4. **Batch 管理员可以进一步禁用继承权限，并可显式同步新的组织权限。**

我认为这比“完全复制一份”更灵活，也比“完全实时继承 + override”更安全，而且 RBAC 仍然完全不需要出现任何 Batch 代码。

批次直接授权怎么做，临时审核还是有可能的，帮我想想

可以，临时审核这种场景说明 **Batch Direct Grant 是有必要的**。但我不建议把它实现成“给这个人创建一个批次角色”，而是把它定义成独立的、可撤销的 **批次直接授权**。

最核心的数据应该不是“角色”，而是：

```ts
BatchDirectGrant {
  id
  batchId

  subjectId       // 被授权用户
  scopeNodeId     // 授权的数据范围
  permissions     // assessment.review, assessment.submission.read ...

  validFrom
  validUntil?     // 可选

  createdBy
  createdAt

  revokedAt?
  revokedBy?
  revokeReason?
}
```

例如临时让李老师审核软件 2024 级：

```text
授权对象
李老师

授权范围
软件学院 / 2024级

允许操作
✓ 查看填报材料
✓ 审核填报材料

有效期
本批次结束前
```

这条授权完全不修改李老师的租户角色。

---

我会把最终权限来源设计成三种，而不是两套角色系统：

```text
                 Batch 可用权限
                       │
          ┌────────────┴────────────┐
          │                         │
组织权限继承                    批次直接授权
Inherited Grant                Direct Grant
          │                         │
     可被 Batch deny                │
          └────────────┬────────────┘
                       │
              Phase Permission Profile
                       │
                       ↓
                Effective Permission
```

也就是说：

### 组织继承授权

来源于：

```text
辅导员
年级负责人
学院负责人
……
```

具有我们前面说的：

```text
创建 Batch 时建立 baseline
租户收权实时生效
租户扩权不自动进入旧 Batch
Batch 可以额外 deny
```

### Batch Direct Grant

来源明确就是：

```text
本批次直接授权
```

不依赖某个租户角色。

比如：

```text
李老师
审核材料
范围：软件学院 / 2024级
来源：本批次直接授权
```

管理员删除它以后立即失效。

---

## 临时审核还需要区分“有资格审核”和“分配给他审核”

这两个概念最好不要混。

例如：

```text
BatchDirectGrant
李老师可以审核软件学院 / 2024级的数据
```

回答的是：

> 李老师最多允许审核哪些东西？

而：

```text
ReviewAssignment
李老师负责审核软件 2401 班
```

回答的是：

> 实际有哪些审核任务交给李老师？

所以：

```text
权限系统
BatchDirectGrant
        ↓
允许进入审核工作区

审核业务
ReviewAssignment / queue
        ↓
决定具体看到哪些待审核记录
```

不要为了“临时审核员”就在 RBAC 里存：

```text
reviewIds: [...]
submissionIds: [...]
```

这样权限和业务任务会纠缠。

---

# Direct Grant 一定要带 Scope

这是这套设计里非常关键的一点。

如果只存：

```text
李老师
assessment.review
```

语义实际上是：

> 可以审核整个 Batch。

通常太大。

所以推荐至少：

```ts
scope: {
  organizationNodeId: UUID
  includeDescendants: boolean
}
```

比如：

```text
王老师
审核权限

范围
软件学院
包含下级组织
```

或者：

```text
张老师
审核权限

范围
软件 2024级1班
```

这样临时负责人、年级审核员、班级审核员都能表达。

如果以后真的存在“不按组织划分的一批审核对象”，那应该由 Review Assignment 解决，不要继续把权限 scope 做复杂。

---

# Direct Grant 的有效期怎么处理

我建议默认有三个选项：

```text
有效范围

● 整个批次
○ 指定时间
○ 当前阶段
```

但从底层模型来看，我其实更推荐：

```ts
validFrom?: timestamptz
validUntil?: timestamptz
```

加可选：

```ts
phaseId?: UUID
```

“当前阶段”不是简单把阶段结束时间复制进去，因为当前 Phase 的实际结束时间可能还不知道。

如果授权是：

```text
仅审核整理期有效
```

那可以保存：

```ts
activePhaseId = reviewPhase.id
```

有效性：

```text
currentPhase.id === activePhaseId
```

这样阶段一过立即失效。

不过第一版甚至可以更简单：

```text
整个批次
指定截止时间
```

因为你本来还有：

```text
∩ Phase Permission Profile
```

假设 `assessment.review` 只在审核阶段开放，那么即使 Direct Grant 一直存在：

```text
学生填报期
→ Phase 不开放 review
→ 审不了

审核整理期
→ Phase 开放 review
→ 可以审核

公示期
→ Phase 不开放 review
→ 又审不了
```

这已经足够解决很多情况。

因此我反而建议先不要引入 `phaseId` validity，除非出现“同一个权限在两个阶段都开放，但这个临时人员只允许其中一个阶段使用”的真实需求。

---

# 更重要的是：谁有资格给别人 Direct Grant？

这里必须防止 privilege escalation。

不能变成：

```text
班长拥有 batch.access.manage
→ 给朋友 assessment.publication.manage
```

我建议引入通用的 delegation 规则：

> **授权者不能把自己无权委派的能力授予别人，也不能授予超过自己管理范围的数据 scope。**

例如管理员当前的管理范围是：

```text
软件学院 / 2024级
```

那么最多：

```text
✓ 授权软件学院 / 2024级
✓ 授权软件 2401 班

✗ 授权整个软件学院
✗ 授权国际商学院
```

权限也是同样：

```text
自己具有：
review.manage / 或 review.delegate

可以委派：
review.read
review.decide
```

不要简单使用：

```text
grantable = currentUser.permissions
```

最好让插件声明哪些权限可委派，例如：

```ts
assessment.review.decide: {
  delegatable: true,
}

assessment.batch.delete: {
  delegatable: false,
}

assessment.batch.access.manage: {
  delegatable: false,
}
```

或者更明确：

```ts
delegatedBy: 'assessment.review.delegate'
```

例如：

```text
assessment.review.delegate
    ↓ 可以授予
assessment.review.read
assessment.review.decide
```

这样安全边界比“拥有 A 就能把 A 给别人”清楚。

---

# UI 我会怎么做

在 Batch Sidebar 的管理区域，我会考虑：

```text
管理
  阶段安排
  参评名单
  人员权限
  公示管理
  批次设置
```

其中“人员权限”页面：

```text
人员权限                                  [添加授权]

继承自组织                                            12 人

张老师
辅导员
范围：软件学院
查看填报    审核材料
                                        [调整本批次权限]


本批次直接授权                                         2 人

李老师                                      [临时授权]
范围：软件学院 / 2024级
查看填报    审核材料
有效至：批次结束
                                        [修改] [撤销]

王老师                                      [临时授权]
范围：软件 2401 班
审核申诉
有效至：9 月 20 日 18:00
                                        [修改] [撤销]
```

点击：

```text
[添加授权]
```

Dialog：

```text
添加批次授权

人员
[搜索姓名 / 工号...]

数据范围
[软件学院 / 2024级                 ▾]

允许操作
审核
  ☑ 查看填报材料
  ☑ 审核材料

申诉
  ☐ 查看申诉
  ☐ 审核申诉

公示
  ☐ 管理公示

有效期
● 批次结束前
○ 指定时间

                     [取消] [添加授权]
```

这里也不要出现“创建角色”。

---

## Direct Grant 还能解决一种现实问题

比如学校某老师平时没有综测职责，但某次临时抽调：

```text
陈老师
原租户 RBAC：
没有 assessment 权限
```

这个 Batch 临时：

```text
BatchDirectGrant:
  scope = 软件学院/2024级
  permissions = [review.read, review.decide]
```

于是：

```text
陈老师进入系统

测评
→ 能看到这个 Batch

进入 Batch
→ Sidebar 出现“审核工作”

其他 Batch
→ 完全不可见
```

这正是 Batch Direct Grant 应该解决的问题。

一旦：

```text
撤销 Direct Grant
```

他就失去该 Batch 的访问能力，而完全不用碰全局角色。

---

# 那 Batch deny 应不应该作用于 Direct Grant？

我建议**不要**。

也就是说：

```text
Inherited Grant
→ 可以有 deny override

Direct Grant
→ 自己就是显式配置结果
```

如果管理员要取消 Direct Grant 的某个权限，直接编辑 Direct Grant：

```text
审核材料 ✓
↓
审核材料 ✗
```

或者撤销整条授权。

否则会出现：

```text
DirectGrant says allow
BatchDeny says deny
```

两个 Batch 层配置互相打架。

所以模型保持：

```text
组织继承：
accepted baseline
− deny overrides

直接授权：
direct permissions

两者 union

然后：
∩ Phase Profile
∩ resource guards
```

即：

```text
effective =
(
    (inherited_current ∩ inherited_baseline − inherited_denies)
    ∪ direct_grants
)
∩ phase_permissions
∩ resource_guards
```

这是我最推荐的最终表达。

---

还有一个细节：**Direct Grant 也不应该突破系统级 hard constraints。**

例如：

- 用户账号被冻结；
- 用户离开租户；
- Batch 不在其 tenant；
- 权限码已经被插件移除；
- Batch 已归档且该操作禁止；
- PhaseGate 不开放。

即使数据库还有 Direct Grant，也不能继续生效。

所以可以理解为：

```text
Direct Grant 是 Batch 里的授权来源之一，
不是 bypass。
```

最终这套设计可以非常稳定地支持三类人：

```text
参评人
→ Roster

正常工作人员
→ Org RBAC → Batch inherited grants

临时工作人员
→ Batch Direct Grants
```

我认为这个划分比“Batch 角色”干净很多，也正好覆盖你说的临时审核、临时代填负责人、临时申诉审核等真实场景。
