# 演示数据

展示实例用的数据：三学年六个已归档的综测批次，加一个进行中的推免批次。工具在 `tools/demo/`，
服务器上的用法见 `deploy/demo/README.md`。

## 来源与隐私

素材是本年级六个学期的真实综测结果、申诉记录与推免表（`docs/seed/`，不入库）。公开站点不能出现其中任何能指回
真人或学校的东西，所以分三层：

1. `tools/demo/compile.ts` 读原始表，只输出数字到 `tools/demo/library.json`（提交）：每人每类申报条数的分布、
   获奖等级 / 名次 / 集体与否 / 得分的频率、各专业分数分位数、班级结构、学期间人员变动的计数、各学期申诉的
   条数与结论比例。里面没有任何名称。
2. 被至少 5 个学生报过的活动名写到 `data/demo/pools.json`（gitignored），只供人工整理时参考。门槛挡得住个人，
   挡不住学校：讲座人、合作高校、本地企业、「六十周年校庆」都能直接指向学校，所以这一层从不进 seeder。
   校名与城市名的替换表同样放在 `docs/seed/place-words.json` 里，不写进 compile.ts：写进提交的代码就等于
   公开了它要抹掉的名字。
3. `tools/demo/catalog.ts`（提交）是手写的公开申报库：按类别泛化后的名称（「校运动会观众」「就业指导讲座」
   「心理健康主题班会」……），权重沿用真实频率。

人员全部虚构：姓名由姓氏与名字库随机组合且不重名，学号用不存在的学院代码 `099`。证明材料是
`tools/demo/render-assets.ts` 按 `tools/demo/pictures.ts` 里的 HTML 渲染的示例图片（虚构印章、「演示材料 ·
非真实证明」水印、不含人名），每条申报一个存储对象，靠硬链接共用字节。

- **各学期共用的图不带日期**（`PROOF_ASSETS`：参与证明、获奖证书、成绩报告、时长记录、献血证等）：同一张图要撑起
  2024 年春到 2026 年秋的申报，写哪个日期都会与多数申报矛盾；`pictures.test.ts` 守住这一点。
- **只有某段经历或场景引用的图按那条申报写日期**：23-24-1 的时长记录与盖章服务证明、25-26-1 的图书馆与马拉松记录、
  24-25-1 被维持驳回的那张证书（活动在上学期、证书在本学期颁发）、推免的赛区选拔赛证书等；`episodes.test.ts`
  核对经历用的图，日期都在所属学期的材料期内、且早于该学期开始填报（被维持驳回的那条除外，它本就因时间被驳回）。
- **推免资格材料各有「齐全」与「缺一样」两种**（`tools/demo/seed/papers.ts`）：签了字 / 没签字的申请表、带 / 不带
  班主任意见的考核表、盖章 / 未盖章的成绩单、完整 / 截在分数之前的四级成绩报告（完整的有三份，分数各不相同，申报的
  分数与所附报告一致）。约两成申请人某份材料缺一样；审核时齐全的通过，缺一样的被要求补上那一样或因此驳回（申请表
  只补件不驳回，驳回就等于退出推免），补件答复上传的是齐全的那份。
- 补件答复用的图与原件不同：获奖名单公示、更正公告、组委会通知、赛事成绩册、省级立项通知、任务书成员分工页、
  活动通知参与分值页、盖章的实践鉴定意见、班主任签字页等。

`node tools/demo/render-assets.ts <名字…>` 只重画点名的几张，其余已提交的图片字节不变。

## 怎么写进去

- **业务状态全部走真实服务**（`tools/demo/runtime.ts`）：与 runtime 档 CLI 同一套装配建服务图，不绑端口、
  不跑迁移。启动钩子逐个归类：权限目录、各类注册表要跑；阶段调度器、审核巡检、上传清理、本地存储暂存区清扫
  这类会自己写库或删文件的循环不跑，入口密钥自检只写日志也不跑，出现未归类的新钩子直接失败。公式发布与计分
  要经沙箱进程：生成前 `pnpm sandbox:up`，在 worktree 里生成时用 `QUALY_SANDBOX_AUTHORING_SOCKET` /
  `QUALY_SANDBOX_RUNTIME_SOCKET` 指向主工作目录下 `.qualy/run/sandbox/` 的两个 socket。
- **历史时间事后放置**（`tools/demo/timeline.ts`）：服务只认数据库的 `now()`，产品里也不该有「按过去时间写入」
  的口子。seeder 每一步都用数据库时钟记下真实窗口与故事时刻，跑完后只改写白名单里的列（保留窗口内的先后），
  随行的「计划时间」类列跟着所在行一起平移；最后扫描全库所有时间列，任何残留在播种时段内的值都会失败并点名。
  有九列不是数据库的 `now()` 而是服务进程的 Effect `Clock` 写的（阶段实际进入、阶段事件、批次生命周期、
  参评人移出、上传与附件，特征是整毫秒精度）。两个时钟相差比两步之间的间隔还大，按数据库窗口对这些值会落进
  相邻一步、被搬到几小时之外（第一版里约 2.4% 的附件和第一学期的归档时间就是这样错的），所以每一步同时记
  一个进程时钟窗口，这些列（`NODE_CLOCK_COLUMNS`）按它放置。反过来，撤销任命的 `role_grants.revoked_at`
  （语句的 `now()`）偶尔读得比本步第一次取时钟还早，落在两步之间的缝里（完整生成中 116 条里有 12 条），
  所以它归「缝里的值跟随下一步」（`LEADING_COLUMNS`）；审计记录落在调用返回之后，归「跟随上一步」
  （`TRAILING_COLUMNS`）。
- **一个学期是一条事件队列**（`tools/demo/seed/queue.ts`）：提交、审核、驳回改正、上提会签、补充材料、申诉、
  阶段推进按故事时间排序后依次执行，真实执行顺序与故事一致，UUIDv7 的排序因此也一致。
- 登录记录是遥测，改写之后按「每人每天第一次操作之前」用 SQL 批量写入，地址取 RFC 5737 文档段。
- 审核动作只落在白天：两步之间的间隔若把下一步推到 23:00 至次日 08:00，就推迟到当天或次日 09 点后，保留分钟数
  （`awake`）。同一夜里被推迟的两步可能前后对调（01:50 → 09:50，02:07 → 09:07）；同一条申报的各步是串行排程的，
  不受影响。学生提交与答复不受此限，晚上提交本来就是常态。`demo:check` 数 23:00 至 08:00 之间的工作人员动作
  （审核决定、合议票、补件要求、复查、退回、迁移、重新认定、撤回），不为 0 即失败。
- **写出来的材料都真实存在**。补充材料一律要一个文件（`tools/demo/seed/asks.ts`：一项必填的文件，外加可选的
  「补充说明」），答复经产品的上传接口附上对应图片，文字只作说明。随机流程只在有专属补件的题目上补件（校园文化活动、
  社会实践、竞赛、科研、团体的文体获奖与四种推免资格材料），而且只向补件说得通的申报要：团体获奖才要成绩册，资格材料
  只向缺那一样的要。经历与场景的补件单列在 `SCRIPTED_ASKS`，各自写明针对的原件。`demo:check` 核对库里没有只要文字
  的补件、没有不带文件的答复、没有与该轮所审原件逐字节相同的答复；`asks.test.ts` 在生成前就核对同一件事。
- 申诉只带理由（接口本来也只收理由）。随机申诉的理由在 `APPEAL_REASONS`，经历与场景的在 `SCRIPTED_APPEALS`，
  代码只按名字引用；两者都不说「附……」「已补充」「补交」。申诉确实需要新材料时，由申诉轮里正在审的人发一次补件、
  学生上传后再裁决。
- 修改重交保留原有附件，只做说明里说的那件事：换一张重新拍摄的照片、在原件旁补上一页，或按证书改正填写的内容。
  随机流程里被驳回后重交的申报不换材料，说明写「已核对材料，请重新审核」，不声称补了什么。
- 播种进程内把上传频率配额调高（三年压在一小时里跑完，一个活跃学生会远超每小时 20 次），只改内存里的装配，
  不动 qualy.yml 与 lock。

## 规则里的四种值

`tools/demo/rules.ts` 为每道题写明每个数值的来源：

| 值                 | 在配置里                              | 例子                                                       |
| ------------------ | ------------------------------------- | ---------------------------------------------------------- |
| 管理员固定值       | `bindings.x = constant`，或 `fixed@1` | 校园活动参与后的获奖加分、竞赛各级第一名分值、集体系数 0.5 |
| 申报时提交         | 表单 `fields`                         | 活动名称、参与分、获奖级别与名次、证明材料                 |
| 审核员认定         | `recognitions`                        | 认定参与分、认定名次、是否集体项目                         |
| 申报字段与认定绑定 | `recognitions[].defaultFromFieldId`   | 学生填「省级第三名」，审核员看到的认定表单已预填，可改     |

公式不能写小数字面量，所以一切分数值天然都是管理员常量；规则演进因此多半只是常量变了（23-24-1 院级第一名
0.3 → 之后 0.4），真正换代码的只有竞赛公式 v2（集体项目名次递减由 0.2 改为 0.1，旧批次仍引用 v1）。
行政导入与行政认定本身就是认定，认定列必须写明，不会从字段默认。

## 六个历史批次

每学期按真实时间线：D-3 建批次；D 开始填报；D+1 辅导员导入学业、全科优秀、不及格、青年大学习、寝室、
学生干部；D+2 另一位辅导员录入早晚自习缺勤与通报；D..D+4 学生晚间提交；班级负责人随交随审，
约 7% 驳回（多半在截止前重交）、约 2.5% 上提到三位专业负责人会签、不到 1% 要求补充材料（只在有专属补件的题目上）；D+5 截止；
D+9 开放申诉（条数取真实各学期），D+11 截止；D+13 归档（归档前断言没有未结束的审核轮）。

审核链：班级综测负责人（每班两位）→ 上提与申诉走「三位专业负责人会签 → 年级负责人 → 辅导员终审」。
年级负责人本身是专业负责人之一，他在会签时表过态的轮次，到年级负责人一级会被独立性规则跳过。

学期之间按真实计数：离开（停用账号）、复学（重新启用）、往届回流（新建用户）、24-25-1 前三人转专业、
25-26-2 前一人降到 2025 级（新建 2025 级节点）；大二、大三开学前班级负责人换届。

两类批次开放复查（`assessment.review.reopen`）的口径相同：**审核期与申诉期开放，处理申诉的阶段不再新开**。
综测批次是「审核整理」与「结果申诉」，推免批次是「材料审核」与「结果公示与申诉」；辅导员可在其中替学生对已定结论发起复查。
学院另设「综测督查」角色（`assessment.entry.redetermine`，学院节点、覆盖下级），授给综测负责人：重新认定按裁决
不从终审人推导、系统管理员也不天然拥有，所以单独成一个角色；它在第一个批次建立前授出，每个批次建立时随接纳基线带入。

演示学生的每个学期除了随机的申报，还按 `tools/demo/seed/episodes.ts` 写出几条固定经历，每条都走真实服务：

| 学期    | 经历                                                                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 23-24-1 | 报了获奖却只附参与证明的活动，班级负责人要求上传获奖名单公示页，学生上传并注明所在行后通过；只附了志愿平台时长记录的申报被驳回，在原件旁补上盖章的服务证明重交通过               |
| 23-24-2 | 证书只写参赛队获奖，班级负责人上提，三位专业负责人合议后辅导员认定；附了另一场比赛证书被驳回的竞赛经申诉，申诉中按要求上传本场的获奖证书后改判通过                               |
| 24-25-1 | 证书在本学期颁发、活动却在上学期举办的获奖被驳回，申诉后维持原决定；辅导员录入的寝室扣分五天后撤回，成绩单留「已撤销」行                                                         |
| 24-25-2 | 按公示名单被认定为二等奖的竞赛，由辅导员依组委会更正公告发起复查，复查中学生上传更正公告，改认定为一等奖；督查把参与分 0.2 重新认定为 0.5                                        |
| 25-26-1 | 综测负责人退回修改、学生在证书旁补上赛事成绩册后重交通过；同一次图书馆志愿服务以时长记录和服务证明各报一条且都已通过，督查以重复申报撤销后一条；试行题目被作废，改在正式题目重报 |
| 25-26-2 | 竞赛题改为「班级审核 → 辅导员确认」并迁移在审条目（reroute）；一条活动先因照片模糊、再因名次与证书不符两次驳回，重拍、改正后第三轮通过                                           |

经历用的每张图都与申报一致：团体获奖附参赛队证书，个人获奖附个人证书，时长记录与服务证明的日期都在该学期的材料期内。

`QUALY_DEMO_EPISODES=first` 把全部经历压进第一个学期，配合 `QUALY_DEMO_TERMS=1` 约 20 分钟跑完，用来改这些经历。

生成后抽样（2026-09-26 基线，完整生成约 120 分钟）：六个学期总分中位数 71.4–75.3（真实年级 71–75），品德 9.8–10.8、学业 57.2–60.9、文体 3–3.6。

## 推免批次（进行中）

自定规则，逐人可算：学业成绩 80（平均学分绩 × 0.8，导入）+ 素质拓展 20（竞赛与科研封顶 10；品德与文体封顶
10，取本系统六个归档批次算出的均值之和 × 0.4，导入）+ 资格材料（申请表、考核表、成绩单、四级，不计分）。
名单是全年级，72 人报名提交材料。不做「第一名赋 20 分」的归一化，那需要排名。

时间相对于生成当天：报名与材料提交从 16 天前开始，默认停在「材料审核」（`--stage=entry|review|appeal`）。
「材料审核」阶段同时开放申诉与复查：单项审核结论一出，申请人即可申诉，辅导员也可替其复查。
开放第 10 天综测负责人给竞赛与科研加了一级「专业负责人初审」并把在审条目迁到新一轮（`reroute-all`、从头审）。
大数据专业没有任命专业负责人：一名大数据专业申请人在调整前两天提交的一条竞赛还在辅导员处，迁移后停在专业负责人初审、
无人可审，综测负责人的告警面板列出它（`demo:check` 经产品的告警接口计数）；`--migration-state=before` 把这一步留给现场演示。
另有一人转班待对账、若干补充材料中、待审与草稿。

审核链：思想品德考核表由本班班级综测负责人（学生干部）审核，两位任一；它的复核链是「班级综测小组评议（本班两位
班级综测负责人合议）→ 辅导员复核 → 学院推免工作组」，工作组作结论。其余题目由辅导员审核，复核链只有学院推免工作组。
合议只能放在复核链的非末端环节（§32.66 四），所以班级合议只会出现在申诉、复查或班级负责人上提的轮里；班级负责人
上提时，上提者本人按同轮回避不进合议，合议只剩另一席，场景因此让班级合议都来自申诉。

**考核表先经学生干部这一安排待用户裁决**（生成器照现状写，没有改链）。它有两层：

- 普通链：全部申请人的考核表由同班学生干部一审，与综测批次里班级负责人审同班申报是同一种安排。
- 复核链第一环是学生合议：复查从复核链第一个有效环节走完整条链，所以辅导员或综测负责人对考核表发起的复查，
  也会先交给该生同班的两位学生干部合议，再到辅导员与工作组；申诉同理。学生干部在合议中能读到同学的考核表与
  驳回理由，场景里的驳回理由只涉及材料完整与模板，不涉及处分。

另一种安排供裁决时比较：普通链由辅导员审，复核链只设辅导员复核与推免工作组；班级合议只留在综测批次的活动类申报上。

报名名单取成绩靠前的 72 人，其中必有演示学生与其同班 5 人，以及一名大数据专业学生；另取 6 名外班申请人
（不含大数据专业）。`tools/demo/seed/selection.ts` 的「what the demonstration accounts open onto」一节按固定时刻写出：

- **演示学生**：申请表、四级已通过；两条竞赛一条附参赛队证书、却按个人申报，通过后被督查按团体项目重新认定（本批次里的
  纠错经历），一条附的是赛区选拔赛证书，被辅导员以「与申报的省部级不符」驳回后申诉，推免工作组在申诉中要求上传组委会
  关于赛区获奖认定的通知，学生已上传，停在工作组；两条科研一条被辅导员要求上传省级立项通知书（原证明是校级立项）、
  学生上传后随流程调整迁到专业负责人初审再通过，一条因成果名称与登记号和登记证书不一致被综测负责人退回修改，按证书
  改正后重交通过；思想品德考核表被班级负责人以模板为由驳回，申诉后在班级合议中；成绩单没有教务处盖章，被要求上传
  盖章页，待答复；一条竞赛存为草稿未提交；截止前一晚补交的一条竞赛在辅导员处待审。
- **班级负责人**（演示学生所在班）：本班 6 份考核表（演示学生与 5 名同学）都在其审核范围。演示学生那份在申诉合议中，
  另一席已投票，只差其本人一票（合议票在形成意见前对所有人保密，界面上看到的只是合议中）；一份未经任何人审；
  一份另一位负责人要求上传班主任签字页、学生已上传，回到待审；一份被其本人驳回（缺签字页）后申诉，另一席在申诉中
  要求上传签字页、学生已上传，合议重新组成；一份被另一位负责人驳回后申诉，两席意见分歧，经辅导员复核后停在推免
  工作组；一份由其本人审核通过。
- **辅导员**（演示辅导员也是导入人）：待审、补件往返、驳回、上提、复查都由其本人做出；成绩导出漏了一名申请人，
  其学业成绩由辅导员按教务处补发的证明单独录入，同一人的成绩单缺盖章页，辅导员要求补件、学生已上传，回到其待审；
  一名申请人的品德与文体导入时误用上一学年均值，被其撤回（留「已撤销」行）并重新录入。
- **综测负责人**：推免工作组的待审里有演示学生的申诉（申诉中补件已答复）、一条三轮（证书照片反光被驳回、重拍重交、
  流程调整迁移、补件后上提）的竞赛、一条辅导员发起的复查、一份班级合议分歧的考核表；另有一条由其要求补件、学生尚未
  答复；告警面板里有一条无人可审的大数据专业竞赛；以「综测督查」身份重新认定过演示学生的一条竞赛；此前处理过的上提
  留在其审核记录里。

## 演示账号

`tools/demo/seed/personas.ts`：学生、班级综测负责人、辅导员、综测负责人四个账号，共用生成时由
`QUALY_DEMO_PERSONA_PASSWORD` 给出的密码，不入库（2026-09-25 起；之前的密码写在源码里，已随部署形态改为不公开账号而撤下）。
部署设置 `QUALY_DEMO_ACCOUNTS` 后，登录页列出它们，并冻结其密码、邮箱与登录方式（见 docs/deployment.md）；
展示实例不设，只留给将来开放受限演示。系统管理员的密码只由 `QUALY_DEMO_ADMIN_PASSWORD` 在生成时给出。

`pnpm demo:check` 在分数分布之后逐项清点上面每个账号应当看到的情况（`tools/demo/situations.ts`）：待审一律经产品自己的
收件箱接口数（逐页读完），工作人员做过的事按做事的人计数（复查按发起人、撤回按撤回人、补件按提出人），其余读库；
任何一项为 0 就列出并以非零退出。在这之前它先核对整库：申报与所站的轮一致、没有落后于最新认定的申报、没有无人指向的
在途轮、没有只要文字的补件、没有不带文件的答复、没有与原件逐字节相同的答复、没有 23:00 至 08:00 的工作人员动作，
任何一项不为 0 同样失败。它接受与 `demo:seed` 相同的 `--stage` 与 `--migration-state`：停在「报名与材料提交」
的基线没有申诉、复查与流程调整，把流程调整留给现场演示的基线没有迁移过的条目，这些项照常打印、标注 `not seeded at this stage`，
不算缺失。

辅导员一项另问产品能否从名单打开演示学生。名单与参评人详情现在只对名册管理与重新认定开放，辅导员只有录入与审核
权限，这一项是 0；录入权限的持有者是否读成绩账页待用户裁决（docs/assessment-design.md §30 第 12 条），所以它单列为
「待裁决」，只打印不判失败，演示辅导员的角色不因此加权限。裁决后若放开，把它改回必需项。

## 核对：当前基线的 `demo:check`

2026-09-26 早晨的基线（`pnpm demo:reset-db` → `pnpm demo:seed`，默认 `--stage=review`、做了流程调整，生成 7189 秒，
退出码 0 → `pnpm demo:check`，退出码 0 → `pnpm demo:snapshot --clear-runtime`）。`demo:check` 的输出原样如下
（只去掉了开头一行开发用主密钥的告警）：

```text
2023-2024学年第一学期综合素质测评 [archived] 1009 people, sampled 85
  total     p10 65.22 · median 75.32 · p90 82.62
  品德行为表现   p10 10.00 · median 10.80 · p90 11.80
  学业表现     p10 51.58 · median 60.72 · p90 68.19
  文体表现     p10 3.00 · median 3.40 · p90 5.00
2023-2024学年第二学期综合素质测评 [archived] 1007 people, sampled 84
  total     p10 65.83 · median 72.49 · p90 78.57
  品德行为表现   p10 10.00 · median 10.80 · p90 11.30
  学业表现     p10 50.30 · median 57.87 · p90 64.29
  文体表现     p10 3.00 · median 3.60 · p90 5.20
2024-2025学年第一学期综合素质测评 [archived] 1002 people, sampled 84
  total     p10 62.99 · median 73.86 · p90 80.81
  品德行为表现   p10 10.00 · median 10.80 · p90 11.80
  学业表现     p10 48.42 · median 59.60 · p90 65.35
  文体表现     p10 3.00 · median 3.20 · p90 5.60
2024-2025学年第二学期综合素质测评 [archived] 998 people, sampled 84
  total     p10 63.61 · median 71.41 · p90 76.71
  品德行为表现   p10 10.00 · median 10.80 · p90 11.80
  学业表现     p10 49.61 · median 57.20 · p90 62.74
  文体表现     p10 3.00 · median 3.20 · p90 6.30
2025-2026学年第一学期综合素质测评 [archived] 982 people, sampled 82
  total     p10 62.73 · median 71.72 · p90 79.83
  品德行为表现   p10 10.00 · median 10.80 · p90 11.80
  学业表现     p10 48.19 · median 57.22 · p90 65.83
  文体表现     p10 3.00 · median 3.00 · p90 4.60
2025-2026学年第二学期综合素质测评 [archived] 984 people, sampled 82
  total     p10 61.29 · median 73.61 · p90 80.27
  品德行为表现   p10 9.00 · median 9.80 · p90 10.00
  学业表现     p10 48.74 · median 60.85 · p90 67.76
  文体表现     p10 3.00 · median 3.00 · p90 4.50
2027届推荐优秀应届本科毕业生免试攻读硕士学位研究生综合评价 [active] 984 people, sampled 82
  total     p10 0.00 · median 0.00 · p90 0.00
  学业成绩     p10 0.00 · median 0.00 · p90 0.00
  素质拓展     p10 0.00 · median 0.00 · p90 0.00
  资格材料     p10 0.00 · median 0.00 · p90 0.00
claims off their verdict 0 · behind their determination 0 · open rounds nobody stands on 0
asks for no file 0 · answers without the file 0 · answers repeating the filed picture 0
staff decisions between 23:00 and 08:00 0

what the demonstration accounts open onto (selection at review):
  student       3  past: an ask for more material, answered with the file
  student       4  past: refused, revised, filed again and approved
  student       1  past: three rounds or more
  student      13  past: judged by a panel
  student       4  past: appeal against a refusal, granted
  student       1  past: appeal against a refusal, not granted
  student       2  past: an ask for material inside an appeal or a re-examination
  student       1  past: re-examined by staff
  student       1  past: re-determined upwards
  student       1  past: approval revoked by re-determination
  student       1  past: recorded fact taken back
  student       1  past: claim on a voided question
  student       1  past: a revoked line on their own result
  student       1  past: a voided question on their own result
  student       1  past: returned for revision by staff
  student       1  past: moved onto a changed route
  student       1  running: returned for revision by staff
  student       1  running: moved onto a changed route
  student       7  running: claims approved
  student       2  running: claims in_review
  student       2  running: claims rejected
  student       1  running: claims draft
  student       2  running: appeal under way
  student       1  running: ask for more material open
  student       2  running: an ask answered with the file
  student       1  running: a determination corrected outside any round
  student       1  running: class panel sitting
  class-lead    4  running: waiting in the inbox
  class-lead    1  running: panel with the other seat voted
  class-lead    2  running: back after an answered ask
  class-lead    2  running: appeal at the class panel
  class-lead    2  running: rounds concluded
  lead          4  running: waiting in the inbox
  lead          2  running: appeal waiting
  lead          1  running: re-examination waiting
  lead          4  running: waiting after earlier rounds
  lead          2  running: waiting after an answered ask
  lead          1  running: waiting after a split panel
  lead          2  running: own ask still out
  lead          1  running: rounds nobody can review, in the alerts
  lead         11  running: rounds concluded
  lead          1  running: determinations corrected outside any round
  counsellor   38  running: waiting in the inbox
  counsellor    7  running: back after an answered ask
  counsellor   12  running: own ask still out
  counsellor   18  running: refusals
  counsellor   14  running: escalations
  counsellor    1  running: re-examinations opened
  counsellor    2  running: facts recorded by hand
  counsellor    1  running: recorded facts taken back
  counsellor    0  running: opens a participant from the roster  (awaiting a ruling, not required)

awaiting a ruling (docs/assessment-design.md §30, item 12: whether the recording permission reads the roster):
  counsellor: running: opens a participant from the roster = 0
```

同一套代码另跑过两次短生成（`QUALY_DEMO_TERMS=1 QUALY_DEMO_EPISODES=first`），`demo:check` 均以 0 退出：默认阶段一次，
各项都不为 0；`--stage=entry` 一次，申诉、复查、班级合议、流程调整与无人可审告警这些项标为 `not seeded at this stage`，
没有缺失项。

## 本地预览

`pnpm demo:preview`：把 `data/demo-baseline/` 的快照还原到演示容器里单独的 `qualy_demo_preview` 库，附件解到
`data/demo-preview/storage`，然后照常启动 `pnpm dev`（开发会话里 shell 变量优先于 `.env`，所以只有数据库、存储与
演示账号三项被改指向，其余沿用自己的 `.env`）。浏览器开 http://localhost:5173；设了 `QUALY_DEMO_PERSONA_PASSWORD`
时登录页列出四个演示账号，没设时按邮箱手动登录。

- 每次运行都先还原，登录产生的会话与登录记录只落在预览副本里，与服务器上复原一样；`--keep` 跳过还原。
- 不碰 `qualy_demo`（下一次快照从它打）也不碰开发库；普通 `pnpm dev` 仍然是自己的开发数据。
- 需要演示容器在跑：`docker compose --profile demo up -d postgres-demo`；快照不在时先 `pnpm demo:snapshot`。
