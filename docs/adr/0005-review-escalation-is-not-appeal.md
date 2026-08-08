# ADR 0005:审核中的「不确定」与学生「申诉」是两个工作流

- 状态:**已接受**(2026-08-08)
- 领域:综合素质测评(docs/assessment-design.md §7 ADR-2、§14、§15)
- 相关:[ADR 0004](0004-assessment-publication-is-immutable.md)

## 背景

两件事看起来都是「向上走」:审核员觉得材料可疑,把它交给上一级;学生觉得结果不对,要求复查。
合并它们很有诱惑力——同一张表、同一个状态机、同一套权限点。

## 决定

**分开,数据库、状态机、权限点全部分开。**

- **Review Escalation**:审核员点「不确定,向上提审」,走的是主链的疑点延伸段(普通流程天然是
  疑点链的前缀,不存在两张图)。动作词汇:通过 / 驳回 / 上提。
- **Appeal**:学生对**已公示结果**或其中的既有审核决定提出异议,独立的 `AppealCase` 与
  `AppealPolicy`。终局动作词汇:**维持原决定 / 更正原决定 / 上提复核**。

配套约束:

- 申诉**必须锚定不可变对象**(S1 的 publication_row 或其中的既有决定),绝不指向实时 Entry。
- AppealPolicy 是**复制**出来的独立配置(缺省 = 主链某 stage 起的后缀),不运行时引用主链;
  「申诉中间负责人不能驳回」是 AppealPolicy 的属性,**不做 phase overlay**——阶段切换不改变
  某条申诉内部的合法动作。
- CORRECT 的产物是新的 decision 事件,成为 S2 的计算输入;S1 永不修改。

## 后果

- 两个流程的词汇对用户是分开的,不需要在同一个界面里解释「上提」和「上提复核」的区别。
- 申诉可以在主链早已完成之后发生,不必让主链状态机长出一个「已完成但还能再动」的状态。

## 修订(2026-08-09):概念仍分,存储统一为「轮」

原文的代价条款(两套近乎镜像的表与投影)被后续设计消解:申诉期的行为其实是三个 phase 开关的
组合——开放对终态条目的重新提审、开放疑点上提、关闭非链尾驳回——独立的 AppealCase 在这一
组合下失去了存在理由。定稿:**escalation 是审核员在一轮内部的向上流转;申诉/复查是对已定结果
发起的新一轮**——`review_instances` 增加 `round_no / origin('initial'|'appeal') /
initiator('participant'|'staff') / publication_id? / anchor_line_id? / re_entry_stage_index`,
appeal_cases 等四表与 appeal.* 权限点取消。申诉轮不需要新链:在同一条已快照的链上越过
normalTerminal 继续。原则四条动机全部保留——锚定不可变对象(轮携带 publication 引用)、
词汇分离(按 origin 换文案)、仅终点可驳(phase 开关)、审计可分(按 initiator/origin 统计)。
详见 docs/assessment-design.md §15 与 §32.14。
