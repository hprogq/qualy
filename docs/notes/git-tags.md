# 仓库标签登记

标签在这个仓库里只有一个用途:**留住一段不在 `main` 里、但结论依赖它的历史**。分支会被删,
标签不会被垃圾回收,所以凡是「文档里写了某个判断,而支撑那个判断的代码不在主线上」的场合,
证据都挂在标签上。

看着名字不统一,是因为它们分两批产生,而**每一个都被文档正文引用**——改名会把那些引用变成悬空引用,
为了统一而回头重写历史报告是篡改,不是整理。所以既有名字冻结,新标签按下面的规则起名。

## 新标签的命名规则

- `archive/<主题>` —— 冻结证据:一段被裁决取代、但结论仍然依赖的工作。
- 版本标签用 `v<semver>`。
- **不用内部阶段编号**(p0/p1/M4 之类)给新标签起名。它们只在写下的当天有意义。

## 现有标签

| 标签                            | 指向     | 它是什么                                                                                                                                     | 被谁引用                                                    |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `archive/data-governance-v3`    | 2c6e8dcf | 数据层架构与评审存档,数据治理方案第三版落定处                                                                                                | architecture/database.md、notes/data-layer-retrospective.md |
| `archive/mikroorm-kysely-spike` | 59a904db | ORM 选型 spike 的全部证据:两库同一纵切跑真实 Postgres、由实体重建 org 四张表与 lineage 比对、两个生成器的缺口定位。**不在 main 里**,分支已删 | ADR 与 notes/ 的 ORM 结论建立其上                           |
| `ui-prime-m4-checkpoint`        | c0b51d7b | PrimeReact 迁移实验的冻结点(M4 一半)。**不在 main 里**,分支已删。ADR 0010 的「PrimeReact 实证发现」逐条可在此复现                            | adr/0010、ui-platform-migration\*.md、notes/primereact.md   |
| `pre-mikroorm-spike`            | 11b63e4f | spike 开始前的主线状态,用来对照 spike 改了什么                                                                                               | STATUS.md                                                   |
| `p1-base`                       | 300ac17e | p1 实现基线                                                                                                                                  | reports/P0-REPORT.md                                        |
| `p1-ready`                      | ab3d179c | p1 收口:装配清单自足                                                                                                                         | STATUS.md                                                   |
| `p1-capability-boundary`        | 5edcd26f | 数据库降为可选能力那一刻                                                                                                                     | effect-migration.md、reports/effect-migration-progress.md   |
| `p2-base`                       | d27a6faf | p2 施工基线                                                                                                                                  | STATUS.md                                                   |
| `v0.1.0-p0`                     | 44cd26c9 | p0 验收                                                                                                                                      | p0-tutorial.md、HISTORY.md、reports/P0-REPORT.md            |

前四个是**证据标签**(删了就找不回来或对不上账);后五个是**里程碑标签**,主线里都有,
留着是因为文档按名字引用它们。
