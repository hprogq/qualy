# 公式认定与计分运行时

Qualy 的可编程计分由三层组成：Assessment 定义业务事实和计划，Formula 插件提供 calculator，Sandbox 在隔离进程中编译和执行管理员提供的源码。业务服务不执行源码，沙箱也不认识租户、用户、审核或数据库。

## 类型和事实

`@qualy/value-schema` 是 typed value 的唯一协议，负责 schema、规范化、赋值兼容、canonicalization 和 hash。Evidence 描述参评人提交的事实，Recognition 描述终局认定，ScoringPlan 把已认定值绑定到 calculator 参数。

```text
EntryRevision payload
        ↓ review / determination
EntryRecognition values
        ↓ assignment + converter
ScoringPlan parameters
        ↓ calculator
ScoreAmount / ledger lines
```

Recognition 与计分分离：审核决定不携带分值，公式只消费已经证明与参数兼容的终局认定。计划、认定和发布的 artifact 使用不可变 identity，历史执行不依赖 `latest`。

## 编写和发布

FormulaFunction 持有草稿，FormulaVersion 是不可变发布物。Authoring Sandbox 对源码执行 AST policy、权威 TypeScript 检查和 deterministic bundle；服务端重新验证返回的 contract、schema 和 provenance，再以 CAS revision 发布。Production 没有在主进程编译的 fallback。

发布前服务端证明：

- 导出形状、输入和输出 schema 符合 calculator contract；
- 示例与声明的约束通过；
- 当前 assignment 的 recognition profile 可以赋给 calculator 参数；
- artifact hash、工具链身份和数据库记录一致。

## 运行

Runtime Sandbox 通过 Unix Domain Socket 接收不可变 artifact 和 JSON input，在 worker 中用 QuickJS-WASM 执行。容器无网络、只读根、非 root，不接收应用 `.env`。服务端对输出重新做长度、schema、profile 和 ScoreAmount 校验；超时、sandbox 不可用、artifact 不匹配和 contract 违约保持不同失败语义，不能压成 0 分。

沙箱不得在数据库事务内执行。需要落库的流程先在事务外 prove/probe，再在事务内锁定并重读相关身份，确认候选仍然相同后 settle，避免长时间持锁和过期结果写入。

## 配置变化

修改计分规则前，系统计算对已有 Recognition 的影响。仍生效的 Recognition 不能因新 assignment 变得不可计算；需要人工确认的变化用绑定候选 identity 生成 token，提交时重新证明 token 和候选仍然一致。

当前实现与门禁位于 `packages/core/{value-schema,formula,sandbox-*}`、`packages/plugins/assessment/{core,formula}` 和 `apps/sandbox-*`。进程隔离与部署边界见[沙箱架构](sandbox.md)，领域规则见[公式认定设计](../assessment-formula-recognition.md)。完整施工过程与阶段验收保存在[历史方案](../archive/designs/formula-runtime-plan.md)。
