# Effect Patterns

本项目已裁决的 Effect 用法。**不是 Effect 文档的复制品**——每份都必须写清:上游在这个版本上
到底是什么(带 `repos/` 路径)、Qualy 选了哪种、以及禁止什么。

规则:

- 每份都带 Version 段。版本变了没重新校验的 pattern 视为过期。
- 每条上游主张都要有 `repos/` 路径。写「根据 Effect 最佳实践」等于没写。
- pattern 与 vendored 上游冲突 → **停下并报告**,那是版本漂移,不是二选一。
- 按里程碑逐份建立,不一次性生成。没有真实迁移代码时批量写规则,产出的是理论正确但不合身的东西。

| 文件                                     | 建立时机         | 状态                            |
| ---------------------------------------- | ---------------- | ------------------------------- |
| [core-style.md](core-style.md)           | 迁移准备         | **已建**(effect 4.0.0-beta.103) |
| [services-layers.md](services-layers.md) | 迁移准备         | **已建**(effect 4.0.0-beta.103) |
| errors.md                                | 数据库 spike 前  | 待建                            |
| drizzle-effect.md                        | 数据库 spike 前  | 待建                            |
| resources-runtime.md                     | runtime shell 前 | 待建                            |
| schema.md                                | HttpApi 切片前   | 待建                            |
| httpapi.md                               | HttpApi 切片前   | 待建                            |
| frontend-client.md                       | 前端切换前       | 待建                            |
| testing.md                               | 测试迁移前       | 待建                            |

模板见 [_TEMPLATE.md](_TEMPLATE.md)。
