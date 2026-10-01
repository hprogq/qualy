# 按时间点恢复(PITR):技术验证与生产前要定的事(2026-09-30)

## 现状

每天 03:17 一次 `pg_dump`(连同附件、异地复制),最坏丢近 24 小时。综测最忙的是截止前几天,那时丢一天的申报与审核是真实事故。
PITR 把丢失窗口缩到分钟级:一份基础备份 + 持续归档的 WAL,可以回放到任意时刻。

## 已证明的(`node tools/quality/pitr-drill.ts`)

用生产同 digest 的 PostgreSQL,断网的一次性容器:`wal_level=replica`、`archive_mode=on`、`archive_command` 拷进归档目录 →
写 A → `pg_basebackup -X none` → 写 B → 记下时刻 T → 写 C → `pg_switch_wal()` 等归档 → 销毁原库 → 新容器以基础备份为数据目录、
`recovery.signal` + `restore_command` + `recovery_target_time = T` + `promote` 启动。结果只有 A、B,C 不在,日志写明
「recovery stopping before commit」停在 C 之前。本机:起库 1.4 s、基础备份 1.7 s、回放与提升 1.4 s,归档 4 个 WAL 段。

这只证明技术路径可行,**没有改生产的任何配置**。

## 生产之前要回答的(每一条都要人定)

1. **归档去哪、谁能写**:WAL 应当像备份一样离开本机,进备份桶的独立前缀(如 `qualy/wal/`),沿用「服务器只能写、不能读和删」的身份分离;
   `archive_command` 失败时 PostgreSQL 会一直重试并在本地堆积 WAL,**磁盘会满**——要有归档失败的告警(`pg_stat_archiver.failed_count`、
   `last_failed_time`),doctor 也应核对。
2. **基础备份的节奏**:每周一次基础备份 + 其间的 WAL?回放一周的 WAL 要多久要实测;基础备份也要进桶、也要演练。
3. **保留与删除**:WAL 与基础备份的对应关系决定能删什么——一份基础备份之前的 WAL 在更早的基础备份过期后才能删;桶生命周期(现在 30 天)要与之对齐。
4. **附件不在 WAL 里**:数据库能回到 03:14:27,附件卷与 COS 不会跟着回去。回放后的行可能指向那之后才上传(本地)或被清扫的对象,
   或者相反:多出没有行引用的文件(无害)。要么接受「行比附件新时附件可能缺」并在恢复手册里写清核对步骤(恢复演练脚本已能逐个核对附件),
   要么把附件也做成可按时间取回(COS 版本控制已开,local 后端没有)。
5. **重启**:`archive_mode` 改动需要重启 PostgreSQL——双色零空窗管不到数据库,是一次停机;安排在维护窗口。
6. **时钟**:`recovery_target_time` 按数据库时区理解;恢复手册里写明用 UTC 或带时区的时间。
7. **演练**:恢复演练 workflow(`recovery-drill.yml`)要扩展成「基础备份 + WAL 回放到指定时刻」,否则 PITR 同样是没人验证过的承诺。

AGENTS.md 的数据层冻结规则要求新机制由实际事故或需求触发;PITR 是否属于「预防性建设」由用户裁决,在那之前最低限度是把
「最多丢 24 小时」写成明确承诺。
