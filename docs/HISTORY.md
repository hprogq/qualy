# 综测系统毕设论文题目命名

- 会话 ID：`21ddadb7-baec-4976-8060-e27e4f6ca495`
- 创建时间：2026-07-05 08:58
- 更新时间：2026-07-26 21:47

---

## [2026-07-05 08:58] Hangqi Guo

我正在进行我的毕设自助选题。如果我想把我之前写的综测系统包装成毕设论文题目，你推荐起什么名字？

## [2026-07-05 08:58] Claude

毕设题目一般要突出"设计与实现"加上一两个技术亮点，避免太宽泛。基于你的综测系统，推荐几个方向：

**稳妥常规型**

- 《基于 NestJS 的高校学生综合素质测评管理系统的设计与实现》

**突出动态表单（你的核心亮点）**

- 《基于动态表单引擎的高校综合测评系统的设计与实现》
- 《支持可配置题型的高校综测管理平台的设计与实现》

**突出审批流**

- 《基于多级审批工作流的学生综合测评系统的设计与实现》

**技术含量拉满型（适合想让答辩老师觉得有深度）**

- 《基于插件化架构的动态表单与审批流综合测评系统的设计与实现》

我个人推荐第二类。"动态表单引擎"是你系统里最有设计含量的部分（约 30 种题型的插件化设计），比单纯写"管理系统"更能撑起论文的第三、四章，答辩时也有东西可讲。技术栈（NestJS、Drizzle）一般不放标题里，放在摘要和技术选型章节就够了。

需要我帮你顺便拟一下对应的论文摘要或章节大纲吗？

<details>
<summary>Thinking</summary>

> I'm thinking through thesis title options for their comprehensive evaluation management system built with NestJS and PostgreSQL. Since they're a CS student at Dalian University of Foreign Languages, I should suggest titles that highlight the technical architecture and practical application, keeping them concise enough for mobile contexts. I'll offer several variations that emphasize different aspects—the dynamic form system, the multi-tenant workflow capabilities, or the statistical analysis features—so they can choose based on their research focus.

</details>

## [2026-07-05 08:59] Hangqi Guo

你推荐在毕设标题里强调 ai 辅助审批么，ai 初审复审建议，ai 动态智能生成表单，你推荐在标题中强调技术栈么

## [2026-07-05 08:59] Claude

**AI 要不要放标题：推荐放，但有前提。**

前提是你真的打算把 AI 功能做出来并写进论文核心章节。如果 AI 只是接个大模型 API 生成一段建议文本，标题却写"AI 智能审批"，答辩时老师追问模型怎么评估、准确率多少、和人工审批对比如何，你会很被动。标题写了什么，论文就欠什么。

如果你确实想做（你有 LangChain.js 的经验，这不算从零开始），我建议 AI 作为**辅助定位**出现在标题里，而不是主导词：

- 《基于 AI 辅助审批的高校学生综合测评系统的设计与实现》
- 《融合大语言模型辅助审核的高校综测管理系统的设计与实现》
- 《基于 LLM 的智能表单生成与审批辅助综测系统的设计与实现》

"辅助"两个字很关键——它降低了论文的举证责任。"AI 初审建议"是辅助，答辩好讲；"AI 自动审批"是决策，你需要证明它可靠，这在毕设周期内很难。

三个 AI 功能里我建议标题只体现一个（审批辅助最合适，因为它和业务耦合最深、最有故事讲），表单智能生成可以作为论文里的第二亮点，不用挤进标题。标题塞太多亮点反而显得每个都不深。

**技术栈要不要放标题：不推荐。**

"基于 NestJS 的 XX 系统"这种写法在毕设里很常见，但它有两个问题：一是框架不是学术贡献点，老师不会因为你用了 NestJS 加分;二是标题里的"基于 X"位置很宝贵，应该留给设计思想（动态表单、插件化、AI 辅助），而不是工具。技术栈放摘要和第二章即可。

例外情况：如果你的学校模板或指导老师明确偏好"基于某某技术"的命名习惯，那就随大流，用《基于 Node.js 的……》也无妨，不值得为此和老师拉扯。

<details>
<summary>Thinking</summary>

> Considering whether to highlight AI capabilities in the title and whether the technology stack should be included there too.

</details>

## [2026-07-05 09:02] Hangqi Guo

你推荐在毕设标题里强调 ai 辅助审批么，ai 初审复审建议，ai 动态智能生成表单，你推荐在标题中强调技术栈么。在你刚才给我的几个标题上添加

## [2026-07-05 09:02] Claude

先给结论：**AI 值得进标题，但前提是你真的会实现它**；技术栈（NestJS、Drizzle 这类具体框架名）不建议进标题。

**关于 AI 进标题**

值得强调，理由是：答辩老师近两年很吃"AI 赋能"这套，而且 AI 初审建议、AI 生成表单确实能撑起独立章节，让论文从"CRUD 管理系统"升级成有研究点的题目。但注意两点：

- 标题写了就必须实现，答辩时一定会被追问 prompt 设计、准确率评估这些细节。建议挑一个 AI 点写进标题就够，不要三个全堆上去，其余作为系统功能在论文里展开。
- "AI 初审复审建议"比"AI 动态生成表单"更好答辩——前者有明确的输入输出和评价标准，后者容易被问"生成的表单质量怎么保证"。

**关于技术栈进标题**

不推荐写具体框架名。"基于 NestJS 的××系统"显得像课程设计；标题里的"基于××"应该放**方法或架构**（如"基于大语言模型""基于插件化架构"），框架名留给摘要和技术选型章节。

**修改后的标题**

- 《基于大语言模型的高校综合测评智能审批系统的设计与实现》
- 《融合 AI 辅助审批的动态表单综合测评系统的设计与实现》
- 《基于 LLM 的高校综测智能初审与动态表单生成平台的设计与实现》
- 《基于插件化架构与大语言模型的学生综合素质测评系统的设计与实现》

我最推荐第二个：它同时保住了你原有的动态表单亮点和 AI 审批新亮点，范围又不至于大到收不住。第三个把两个 AI 点都塞进去了，工作量风险最大，慎选。

需要的话我可以帮你规划一下 AI 初审这个模块的技术方案，让你选题答辩时能讲清楚可行性。

<details>
<summary>Thinking</summary>

> I'm thinking through whether to highlight the AI features—AI-assisted approval, review suggestions, and dynamic form generation—in the title. The key consideration is that examiners will definitely ask about implementation status, so I should only emphasize these if they're actually built or have concrete plans. As for the tech stack, it's generally better to avoid listing specific frameworks in the title, though "基于XXX" is a common convention in Chinese contexts. Instead, I should focus on architecture or methodology terms that better convey the approach, then incorporate these insights into the previous title options.

</details>

## [2026-07-05 09:04] Hangqi Guo

我确实想做成插件化架构，甚至我把章程发给 ai 就可以智能生成一道题目的前端和后端计分逻辑（类似于每道题的计分逻辑都是一个类似于系统 pac 代理那样的函数），你觉得可行么，还是不推荐

## [2026-07-05 09:05] Claude

可行，而且这个思路本身就有不错的论文价值——但关键在于你要把它设计成"**AI 生成 + 人工确认 + 沙箱执行**"三段式，而不是 AI 直接生成代码就上线跑。

**PAC 式计分函数这个类比很准**。技术上就是：每道题的计分逻辑是一个纯函数 `(answer, context) => score`，存在数据库里，运行时在沙箱中执行。这在架构上完全成立，难点有三个：

1. **沙箱安全**。绝对不能用 `eval` 或 `new Function` 裸跑 AI 生成的代码。Node 侧的 vm2 已经因为逃逸漏洞停止维护了，现在的正路是 `isolated-vm`，或者用 QuickJS 编译到 WASM（如 quickjs-emscripten）跑纯函数——后者对你这种"无 IO 的纯计分函数"场景非常合适，天然隔离、可限时限内存。
2. **正确性保障**。章程条文是自然语言，AI 理解错边界条件（比如"六个月滚动衰减"这种)很常见。所以生成的函数必须配套生成**测试用例**，让管理员在 UI 里看到"输入 X 应得 Y 分"的表格确认后才发布。这一步同时也是你论文里"AI 输出可信性"的研究点。
3. **函数签名收敛**。把 context 设计成固定 schema（题目配置、用户答案、历史数据），AI 只需生成签名固定的纯函数，生成成功率会高很多，前端表单也可以只让 AI 生成 JSON schema 而不是裸 JSX——前端渲染交给你已有的 30 种题型插件，AI 只做"章程 → 题型配置 + 计分函数"的翻译。

我不推荐的版本是：AI 直接生成前端组件代码并动态挂载。那个安全面和调试成本会失控，答辩时也容易被打。推荐的收敛版是"AI 生成配置 + 计分函数，函数进沙箱，配置进插件系统"，这样毕设的工作量、安全性、可讲性都在可控范围内。

要不要我帮你画一下这个"章程 → AI → 沙箱函数"的流程和数据结构设计？这部分可以直接变成论文第三章的核心。

<details>
<summary>Thinking</summary>

> This is a solid technical challenge — the user wants to feed regulations into an AI system that generates both the frontend interface and backend scoring logic for each question, where that logic runs as a sandboxed function similar to a PAC proxy script. It's definitely doable but comes with real tradeoffs: security concerns around executing AI-generated code, correctness verification, and for a thesis project this could actually be a compelling research angle if I scope it carefully around those constraints.
>
> For the execution layer, I'd need to think through sandboxing options since vm2 is deprecated — isolated-vm or QuickJS compiled to WASM could work depending on the complexity needed. There's also the question of whether to constrain the AI to generate a domain-specific language rather than full JavaScript, which trades flexibility for safety. And realistically, any production system would need a human review step before executing generated scoring logic, which is worth building into the architecture from the start.

</details>

## [2026-07-05 09:07] Hangqi Guo

大概可以。然后 ai 可以辅助管理员审批，提供 ai 初审给用户看“审核通过率”、多模态 ai 审批辅助给管理员草拟审批建议、辅助管理员找到用户提交材料里的问题、ai 智能分数解释等。你推荐么，这样的话我的标题怎么写

## [2026-07-05 09:07] Claude

推荐，这几个功能方向都对——它们共同点是 **AI 只出建议、人做决定**，不碰"AI 直接改分数/直接通过审批"这条红线，答辩时立得住。逐个说一下：

- **AI 初审 + 通过率给用户看**：好功能，但建议措辞上叫"预检提示"而不是"通过率百分比"。给用户看一个具体数字（如"通过率 78%"）会引来两个麻烦：数字没有统计依据（答辩会被问怎么算的），以及用户拿它跟最终人工结果对质。改成"材料完整性检查 + 风险项提示"更稳。
- **多模态审批辅助**：亮点最大的一个。用户上传的获奖证书、成绩单是图片/PDF，用视觉模型提取关键信息（奖项名称、级别、日期）并与申报内容比对，草拟审批意见——这是真实痛点，且"多模态"在标题里很值钱。
- **材料问题定位**：和上一条其实是同一个模块的两个输出，合并实现。
- **AI 分数解释**：实现成本最低（把计分函数的执行轨迹喂给 LLM 转成自然语言），但对用户体验价值很高，值得做。

这样你的系统就有了完整的 AI 故事线：**AI 生成题目（章程→计分函数）→ AI 预检（用户侧）→ AI 审批辅助（管理员侧）→ AI 分数解释（结果侧）**，覆盖整个业务闭环，这比单点 AI 功能强很多。

标题建议：

- 《基于大语言模型的高校综合测评智能化系统的设计与实现》（稳妥，全覆盖）
- 《融合多模态大模型的高校综测智能审批与动态计分系统的设计与实现》（突出多模态审批+计分函数两大亮点，我最推荐）
- 《基于 LLM 的插件化综合测评平台：智能出题与审批辅助的设计与实现》（副标题式，突出研究点）

我最推荐第二个。"多模态"和"动态计分"分别对应你两个最有技术含量的模块，而且范围写清楚了，不会被质疑"智能化"太空泛。

<details>
<summary>Thinking</summary>

> 用户想要添加AI辅助审查功能，我需要评估这些功能的可行性，推荐哪些值得保留，并为它们提出标题建议。这需要用中文回答，考虑到移动端的长度限制，但内容应该是实质性的——大约2-3段落加上标题。

</details>

## [2026-07-05 09:09] Hangqi Guo

这样又体现不出来插件化架构、动态审批流等，你再想几个

## [2026-07-05 09:09] Claude

确实,一个标题塞不下四个亮点——插件化、动态审批流、多模态 AI、智能计分,全写上会变成 30 多字的怪物。给你两条路:

**路线一:主标题 + 副标题(推荐,容量最大)**

- 《插件化高校综合测评系统的设计与实现——基于大语言模型的智能出题与审批辅助》
- 《基于插件化架构的高校综测平台设计与实现——融合多模态 AI 审批与动态计分引擎》
- 《面向动态表单与审批流的综合测评系统——大语言模型驱动的智能化设计与实现》

**路线二:单标题,挑"架构 + AI"各一个词**

- 《基于插件化架构与大语言模型的高校综合测评系统的设计与实现》(最平衡,架构和 AI 各占一半)
- 《融合 LLM 智能审批的插件化动态表单综测系统的设计与实现》
- 《基于动态审批流与多模态大模型的插件化综合测评平台的设计与实现》(信息量最大,但已经接近长度上限)

我最推荐**路线二的第一个**:《基于插件化架构与大语言模型的高校综合测评系统的设计与实现》。理由是"插件化架构"天然涵盖了动态表单和动态计分(它们都是插件系统的产物),"大语言模型"涵盖了出题、审批、解释所有 AI 功能——两个词把四个亮点都收编了,标题还干净。动态审批流、多模态这些具体亮点放到摘要第一句和论文章节标题里去展开,效果反而比堆在标题里好。

如果你们学院偏好副标题式(有些学院查重系统或格式要求不允许破折号,先确认一下),路线一第一个也很好。

<details>
<summary>Thinking</summary>

> I'm thinking through how to create titles that weave together these four key components—the plugin architecture, dynamic forms with approval workflows, multimodal AI review capabilities, and intelligent scoring and question generation. Since a single title can't capture everything, I should suggest a main title paired with a subtitle approach, along with a few different combinations that emphasize different aspects of the system.

</details>

## [2026-07-05 09:09] Hangqi Guo

这样又体现不出来插件化架构、动态审批流、多租户等内容，你再想几个

## [2026-07-05 09:10] Claude

先提醒一句:标题塞不下所有亮点,这是正常的。毕设标题一般控制在 25 字左右,塞四五个技术点会显得大而空,答辩老师反而会怀疑"每个都做了多深"。通常的做法是**标题挑 2 个最硬的点,其余亮点放摘要和章节标题里**。

但如果你确实想让架构特性露出,给你几个组合方案:

**架构为主，AI 为辅**

- 《基于插件化架构与大语言模型的多租户综合测评平台的设计与实现》
- 《面向多租户的插件化智能综测系统的设计与实现》

**双主线均衡型**

- 《融合 LLM 智能审批的插件化动态表单综测平台的设计与实现》
- 《基于插件化架构的高校综测系统设计与实现——面向 AI 辅助审批与动态计分》(副标题式，容量最大)

**用抽象词概括架构特性**

- 《可扩展、可配置的高校综合测评智能化平台的设计与实现》("可扩展"暗指插件化+多租户，"可配置"暗指动态表单+审批流，但偏空，不太推荐)

几点具体建议：

- **多租户要慎重进标题**。写了就意味着论文要有完整的租户隔离设计章节（数据隔离方案、租户解析、权限边界），而你毕设的实际落地场景大概率只有本校一家。答辩被问"第二个租户是谁"会比较尴尬。它更适合作为架构设计章节里的一小节，体现你的设计前瞻性。
- **动态审批流和插件化可以合并表述**。审批流本质上也是你可配置体系的一部分，标题里用"插件化"或"可配置"一个词就能罩住。
- 我在这批里最推荐**第一个**：插件化（架构深度）+ 大语言模型（时髦研究点）+ 多租户（平台格局），三个词各占一个维度不重复，字数也还收得住。如果想再稳一点，就把"多租户"三个字去掉，变成《基于插件化架构与大语言模型的综合测评平台的设计与实现》。

定了标题之后，建议倒推一下五章结构，确认标题里每个词都有对应章节支撑——需要的话我帮你排一版。

<details>
<summary>Thinking</summary>

> I need to craft a title that captures the core features—plugin architecture, dynamic approval workflows, multi-tenant support, and AI capabilities like multimodal processing and dynamic scoring—while being mindful not to oversell by cramming everything in. I should present a few title options that balance comprehensiveness with clarity.

</details>

## [2026-07-05 09:11] Hangqi Guo

这样又体现不出来插件化架构、动态审批流、多租户等内容，你再想几个。叫（学生）综合素质测评系统，要写全，倒也不一定是学生。

## [2026-07-05 09:12] Claude

标题塞不下所有亮点，这是毕设标题的常见矛盾——一般原则是**标题里放 1~2 个最有辨识度的点，其余亮点靠摘要和章节标题承载**。答辩老师翻开目录看到"插件化题型引擎""多租户数据隔离""AI 审批辅助"各占一章,效果比标题堆砌好。

不过既然你想写全一些，我按不同侧重给你几组（都用"综合素质测评系统"全称）：

**架构为主，AI 为辅**

- 《基于插件化架构的多租户综合素质测评系统的设计与实现》
- 《面向多租户的插件化综合素质测评平台的设计与实现》

**架构 + AI 双主线**

- 《基于插件化架构与大语言模型的综合素质测评系统的设计与实现》
- 《融合大语言模型的插件化多租户综合素质测评系统的设计与实现》

**尽量写全型（长，但院校一般也接受）**

- 《基于多租户架构的智能化综合素质测评系统的设计与实现——插件化题型与 AI 审批辅助》
- 《支持动态审批流与智能计分的多租户综合素质测评平台的设计与实现》

**我最推荐**：《融合大语言模型的插件化多租户综合素质测评系统的设计与实现》。理由：

- "插件化"和"多租户"是架构词，天然暗示了动态表单、动态审批流这些能力，不用逐个列；
- "融合大语言模型"把智能出题、审批辅助、分数解释全部收进来了；
- 长度还在正常范围（24 字左右），没有副标题也能过格式审查。

"动态审批流"我建议不进标题——它在答辩老师眼里属于工作流引擎的常规功能，辨识度不如插件化和多租户，放在系统功能章节里写透即可。

<details>
<summary>Thinking</summary>

> I need to find the right balance for the titles—incorporating plugin architecture, dynamic approval workflow, multi-tenant capabilities, and the full Chinese name 综合素质测评系统 without overloading them. I'll present several options that emphasize different combinations of these elements and explain the trade-offs for each.

</details>

## [2026-07-05 09:12] Claude

先说实话：标题塞不下所有亮点。插件化、多租户、动态审批流、多模态 AI 四个全放进去会变成关键词罗列，反而显得没重点。学界惯例是**标题放 2~3 个最有辨识度的点，其余亮点靠摘要和章节标题体现**。多租户尤其建议不进标题——它是部署形态而非研究点，放进去还会被追问"你有几个真实租户"。

按不同侧重给你几组，均用"综合素质测评系统"全称：

**架构为主，AI 为辅**

- 《基于插件化架构与大语言模型的多租户综合素质测评系统的设计与实现》（三个点都有，这是塞得最满还不算难看的版本）
- 《插件化多租户综合素质测评平台的设计与实现——基于大语言模型的智能出题与审批辅助》

**AI 为主，架构为辅**

- 《融合多模态大模型的插件化综合素质测评系统的设计与实现》
- 《基于大语言模型的可配置综合素质测评系统的设计与实现——插件化计分与动态审批流》

**副标题式（研究点最清晰，适合答辩）**

- 《面向多租户的综合素质测评系统的设计与实现——插件化架构与 AI 审批辅助》

如果只能选一个，我推荐第一个：《基于插件化架构与大语言模型的多租户综合素质测评系统的设计与实现》。它把你三大卖点（插件化、LLM、多租户）都点到了，长度也还在毕设标题正常范围内（26 字左右，一般上限 30 字上下）。"动态审批流"我建议让位——它在这几个亮点里最像"普通功能"，放章节里写《第 X 章 动态审批流引擎的设计》完全够用。

另外提醒一句：最终措辞最好对照你们学院的选题系统字数限制和格式惯例（有的学校不允许副标题），定稿前查一下往届题目库。

<details>
<summary>Thinking</summary>

> They're looking for a system that combines plugin architecture, dynamic approval workflows, multi-tenancy, and AI/LLM capabilities with multimodal support — the full name is "综合素质测评系统" (Comprehensive Quality Assessment System). The title alone can't capture all these features, so I should recommend they either prioritize which elements to highlight or consider using a subtitle approach to present the key capabilities.

</details>

## [2026-07-05 09:13] Hangqi Guo

这样又体现不出来插件化架构、动态审批流等高技术难度内容，你再想几个。叫（学生）综合素质测评系统，要写全，倒也不一定是学生。

## [2026-07-05 09:13] Claude

标题塞不下所有亮点，这是毕设标题的普遍矛盾。原则是：**标题放 2 个最硬的点，其余亮点用摘要和章节标题体现**。答辩老师翻开目录看到"插件化题型引擎""沙箱计分函数""多模态审批辅助"这些章节名，比标题堆砌印象更好。

按不同侧重给你几组：

**架构 + AI 双主线（推荐）**

- 《基于插件化架构与大语言模型的综合素质测评系统的设计与实现》
- 《融合插件化题型引擎与 AI 审批辅助的综合素质测评系统的设计与实现》

**三亮点全塞型（长，但写全了）**

- 《基于插件化架构的综合素质测评系统的设计与实现——融合动态审批流与多模态大模型辅助审批》
- 《支持动态审批流与 AI 智能计分的插件化综合素质测评系统的设计与实现》

**副标题式（主标题定性，副标题列亮点）**

- 《智能化综合素质测评系统的设计与实现——基于插件化架构、动态审批流与多模态大模型》

我最推荐第一个或最后一个。第一个简洁且两个"基于"都是硬技术；最后一个用副标题把你三大亮点全列出来了，形式上也符合学位论文规范，很多学校允许破折号副标题（建议先翻一下你们学院的毕设标题格式要求）。

另外提醒一点："动态审批流"如果进了标题，你的审批流就得做成**可配置的**（管理员能定义审批层级和节点），而不是写死的两级审批。按你之前 Qualy 项目做过多租户审批工作流的经验，这块你有积累，实现没问题，但工作量要心里有数。

<details>
<summary>Thinking</summary>

> The user needs a name that captures the plugin architecture, dynamic approval workflow, and AI capabilities of this comprehensive quality assessment system — I should explore different title combinations that balance all these elements without being too long.

</details>

## [2026-07-05 09:13] Hangqi Guo

再给我几个，你优化下

## [2026-07-05 09:14] Claude

优化思路：把"插件化架构"提炼成更学术的表达（如"可扩展""引擎"），AI 部分统一用"大语言模型/多模态大模型"这种正式术语，控制在 30 字上下。这一批：

**双引擎概念型（把你的两大核心抽象成"引擎"，很有论文相）**

- 《基于插件化题型引擎与智能审批引擎的综合素质测评系统的设计与实现》
- 《面向可配置化的综合素质测评系统的设计与实现——基于插件化架构与大语言模型》

**突出"可配置/可扩展"这个学术卖点**

- 《可扩展的智能综合素质测评系统的设计与实现——基于插件化题型与动态审批流》
- 《基于插件化架构的可配置综合素质测评系统的设计与实现》

**突出 AI 全流程赋能**

- 《大语言模型驱动的插件化综合素质测评系统的设计与实现》
- 《基于多模态大模型与动态工作流的智能综合素质测评系统的设计与实现》

**最全版（副标题式）**

- 《插件化综合素质测评系统的设计与实现——融合动态审批流与大模型智能辅助》

我最推荐两个：

1. **《大语言模型驱动的插件化综合测评系统的设计与实现》**——最短最有力，"驱动"比"基于"更能体现 AI 深度参与（生成计分函数、审批辅助、分数解释都在这个词里），"插件化"保住了架构亮点。
2. **《插件化综合素质测评系统的设计与实现——融合动态审批流与大模型智能辅助》**——三个亮点全覆盖，主副标题结构清晰。

如果你们学院不允许副标题，就选第一个，然后在开题报告的"研究内容"里把动态审批流列为第二研究点即可。

<details>
<summary>Thinking</summary>

> Now I'm generating some alternative title options that are more polished and strategically optimized.

</details>

## [2026-07-05 09:15] Hangqi Guo

《大语言模型驱动的插件化综合素质测评系统的设计与实现》
《基于多模态大模型与动态工作流的智能综合素质测评系统的设计与实现》

这两个你更推荐哪个，或者你融合融合给我第三个？然后尽量不要破折号

## [2026-07-05 09:15] Claude

两个各有优劣，先对比：

**第一个（大语言模型驱动的插件化…）**
优点：短、有力，"插件化"是架构亮点，"驱动"暗示 AI 贯穿全流程。
缺点："多模态"和"审批流"没体现，而多模态审批恰恰是你答辩时最好演示的功能。

**第二个（基于多模态大模型与动态工作流…）**
优点："多模态"值钱，"动态工作流"覆盖了审批流亮点。
缺点："插件化"丢了——这是你架构设计上最核心的研究点；而且"智能"和"多模态大模型"语义有点重复。

**融合版（推荐）：**

**《多模态大模型驱动的插件化综合素质测评系统的设计与实现》**

这个版本三个字眼各司其职："多模态大模型"（AI 亮点，且比 LLM 更高一档）、"驱动"（AI 深度参与而非点缀）、"插件化"（架构亮点）。28 个字，长度标准，无破折号。

动态审批流没进标题，但这没关系——它作为系统的重要功能放在开题报告研究内容第二条、论文独立一章，答辩 PPT 单独一页，足够了。标题里"插件化"其实也能语义上罩住它（审批流节点也可以说是可插拔配置的）。

备选融合版，如果你坚持审批流要进标题：

**《多模态大模型赋能的插件化综合素质测评与动态审批系统的设计与实现》**

但这个 33 个字有点长，"测评与审批"并列也稍显头重脚轻。我还是推荐第一个融合版。

<details>
<summary>Thinking</summary>

> I should compare the two options, identify which one works better, and then create a combined version that removes the dash.

</details>

## [2026-07-05 09:15] Hangqi Guo

我还有一个备选项目，基于 OAuth2/OIDC 的校园应用统一登录平台设计与实现，你觉得这两个哪个更适合做毕设项目

## [2026-07-05 09:16] Claude

直接说结论：**综测系统更适合做毕设**，但 OAuth2 平台也不是不能做，取决于你看重什么。逐项对比：

**论文可写性（综测胜出明显）**

综测系统有需求分析、架构设计（插件化）、AI 模块、审批流、计分模型，每章都有内容可写，轻松撑起 4-6 万字。OAuth2/OIDC 平台的核心难点在于**协议本身是标准化的**——授权码流程、PKCE、JWT 签发这些都是 RFC 规定好的，你的"设计"空间很小，论文容易写成协议复述 + 实现说明，第三章"系统设计"会比较薄。答辩老师问"你的创新点/难点是什么"时，"正确实现了标准协议"不是一个好答案。

**技术含金量（OAuth2 单点深度更高，但不利于展开）**

OIDC IdP 做好确实很难（token 安全、会话管理、密钥轮换），但这些难点是"工程正确性"层面的，论文里不好体现。而且答辩老师大概率会问："为什么不直接用 Keycloak/Casdoor？"这个问题很难回答——因为确实应该直接用。

**综测系统还有个隐藏优势**：你的 OAuth2 想法可以**塞进综测系统里**。综测系统本来就需要对接学校 CAS 或自建统一认证，你完全可以把"基于 OIDC 的统一身份认证模块"作为综测系统的一章来写，两个项目合体，工作量和亮点都不浪费。你之前还做过 Hydro OJ 的 CAS 插件，这块经验直接复用。

**风险维度（唯一要提醒的）**

综测系统的风险是范围大，插件化 + AI + 审批流 + 多模态，做不完会很被动。OAuth2 平台的优势是范围收敛、一定能按时做完。所以如果你毕设期间还有考研/求职/实习挤占时间，OAuth2 是更安全的选择；如果时间充裕，综测系统的上限高得多。

综合建议：**主选综测系统，把统一认证做成它的一个模块**，OAuth2 题目留作备胎。

<details>
<summary>Thinking</summary>

> I'm weighing these two directions against what they've already accomplished—they've got solid groundwork on the 综测 system and know their way around Qualy, so the OAuth2/OIDC platform would be a natural fit as a standard identity provider project.

</details>

## [2026-07-05 09:22] Hangqi Guo

这个标题有亮点，但原句略激进、略“技术堆叠”：

多模态大模型驱动的插件化综合素质测评系统的设计与实现

它听起来前沿，但答辩风险也会变高。老师很可能会追问三个问题：

第一，“多模态”体现在哪里？
如果只是让大模型读文字、生成表单、给审核建议，那严格来说不一定算多模态。除非你确实处理了图片、PDF、证书截图、奖状扫描件、证明材料等非纯文本材料。

第二，“驱动”是什么意思？
“驱动”容易让人理解为系统核心流程由大模型主导，比如自动审批、自动判分、自动决定是否通过。这在综测场景里风险较大。更稳的说法是“辅助”或“赋能”。

第三，“插件化”有没有真正实现？
如果只是模块化开发，不建议叫插件化。插件化最好真的体现在：题型插件、评分规则插件、材料校验插件、审批节点插件、AI 审核插件等。

所以这个标题的方向是好的，但我建议你降一点口径，让它更像本科毕设论文题目，而不是产品发布会标题。

我会把它改成：

基于多模态大模型辅助的插件化高校综合素质测评系统设计与实现

这个比原题更稳。
“辅助”比“驱动”安全；“高校”让业务场景更明确；“系统设计与实现”比“系统的设计与实现”更简洁。

如果你想保留“智能审核”的重点，我更推荐：

基于插件化架构与多模态大模型辅助的高校综合素质测评系统设计与实现

这个标题比较完整，能同时覆盖你的三个亮点：插件化架构、多模态大模型、综测系统。

但它稍微有点长。

如果想更像正式论文题目，可以用：

面向高校综合素质测评的插件化申报与智能辅助审核系统设计与实现

这个标题没有直接写“大模型”，但更稳、更学术。你可以在摘要里说明系统引入多模态大模型，实现材料识别、表单生成、初审建议和复审摘要生成。

如果你确定 AI 是核心卖点，可以用：

基于多模态大模型的高校综合素质测评辅助审核系统设计与实现

这个标题会把重点放在 AI 审核上，但弱化了“插件化”。

如果你确定插件化是核心卖点，可以用：

基于插件化架构的高校综合素质测评与智能辅助审核系统设计与实现

这个标题会更偏工程架构，适合你想突出可扩展性、动态表单、规则配置、审批流扩展。

我不太建议原封不动使用：

多模态大模型驱动的插件化综合素质测评系统的设计与实现

主要问题是“驱动”这个词太重。综测这种场景最好表达成“人机协同”“智能辅助”“辅助审核”，不要表达成“AI 驱动审批”。

我给你的最终推荐是：

基于插件化架构与多模态大模型辅助的高校综合素质测评系统设计与实现

如果导师偏传统，换成：

基于动态表单与智能辅助审核的高校综合素质测评系统设计与实现

如果导师喜欢 AI 方向，换成：

基于多模态大模型辅助的高校综合素质测评系统设计与实现

我个人最建议第一个：

基于插件化架构与多模态大模型辅助的高校综合素质测评系统设计与实现

这个标题既有技术深度，又没有过度承诺。你答辩时可以解释为：

系统以综测业务流程为主体，采用插件化架构实现表单题型、评分规则、材料校验和审核策略的扩展；同时引入多模态大模型作为辅助能力，用于政策文本解析、表单草案生成、证明材料识别、材料完整性检查和审核建议生成。最终审批结果仍由人工审核人员确认。

他说的有道理吗你看看，有没有必要改，我觉得原来的更好说实话，多模态大模型驱动的插件化综合素质测评系统的设计与实现

## [2026-07-05 09:22] Claude

他说的有道理，但道理只对了一半——他的批评是站在"假设你只做了表面 AI 功能"的立场上，而你的实际设计比他假设的深。逐条看：

**"多模态是否成立"——这条对你不构成威胁。** 你明确要做证书/奖状/PDF 的视觉识别与比对审核，这就是货真价实的多模态。他的担心只适用于"只让 LLM 读文字"的项目。

**"驱动太重"——这是他最有分量的一条，但恰恰在你这里不完全成立。** 他把"驱动"理解成"AI 主导审批决策"，那确实危险。但你系统里 AI 干的是**生成每道题的计分函数**（章程→沙箱函数），这是系统核心逻辑的生成器，用"驱动"反而准确，"辅助"倒是低估了。答辩时你只需要一句话拆掉这个质疑："驱动指 AI 参与系统构建全流程——生成题型与计分逻辑、预检、审批建议、分数解释；但所有审批决策仍由人工确认。"

**"插件化是否真实现"——这取决于你自己。** 你从 2025 年就在设计 30 种题型的插件系统，这块是真的，不是包装。

**他改的几个细节里，有一条我不同意**：加"高校"。你上一轮明确说了"不一定是学生/不限定场景"，加"高校"反而把你的通用性设计说小了。"系统设计与实现"vs"系统的设计与实现"纯属个人偏好，两种在学位论文里都大量存在。

**我的结论**：原标题可以保留，它和你的实际技术方案是匹配的——这是关键。标题激进不激进不取决于措辞，取决于你能不能兜住。你能兜住。

如果你想要一个"保留驱动的锐度、又稍微降一点火力"的折中版，可以考虑：

**《多模态大模型驱动的插件化综合素质测评系统设计与实现》**（只去掉"的"，其余不动）

但说实话，如果导师没提反对意见，就用你的原版。他给的那些"更稳"的版本，稳是稳，代价是把你最有辨识度的东西磨平了——"辅助审核系统"满大街都是，"大模型驱动 + 插件化"才是能让答辩老师记住的题目。

<details>
<summary>Thinking</summary>

> The other AI made some fair points, though I'm not entirely convinced by all of them. The "多模态" framing makes sense given the user is actually working with certificates and PDFs. On "驱动" versus "辅助," there's a real argument here — the AI is generating the scoring functions themselves, which does feel like driving core functionality rather than just supporting the approval process. The "插件化" point seems to cut off, but the user clearly prefers the original framing, and I should give an honest assessment rather than just deferring to their preference.
>
> The grammar nitpick about "系统设计与实现" versus "系统的设计与实现" is pretty minor. Adding "高校" is worth considering, though the user did say earlier they weren't necessarily targeting students or universities specifically, so that might actually work against their intent. My sense is the original framing is defensible — the critic is being stylistically conservative, but given that the AI genuinely generates the scoring functions from the charter, calling it "驱动" isn't unreasonable. I'd suggest either keeping the original or finding a minor compromise.

</details>

## [2026-07-05 09:23] Hangqi Guo

多模态大模型驱动的插件化综合素质测评系统的设计与实现

给个英文标题

## [2026-07-05 09:23] Claude

**Design and Implementation of a Plugin-Based Comprehensive Quality Evaluation System Driven by Multimodal Large Language Models**

逐个词说明一下译法选择：

- **综合素质测评** → _Comprehensive Quality Evaluation_,这是国内文献最通用的译法（也有译作 Comprehensive Quality Assessment 的，两者都可以，Evaluation 更常见）。
- **插件化** → _Plugin-Based_，比 Pluggable 更正式，学术论文里更常用。
- **多模态大模型** → _Multimodal Large Language Models_，缩写 MLLM 是学界标准术语；如果嫌长可用 _Multimodal Large Models_，但前者更规范。
- **驱动** → _Driven by_ 后置，避免头重脚轻。也可以写成前置定语形式：_An MLLM-Driven Plugin-Based Comprehensive Quality Evaluation System: Design and Implementation_，但本科毕设一般用 "Design and Implementation of..." 开头的传统句式更稳。

如果你们学院对英文标题有字数限制（有些要求不超过 15 个实词），可以用精简版：

**Design and Implementation of an MLLM-Driven Plugin-Based Comprehensive Quality Evaluation System**

两个版本任选，意思完全一致。

## [2026-07-05 09:24] Hangqi Guo

评估一下究竟是用 evaluation 还是 assessment

## [2026-07-05 09:25] Claude

两个词在教育测量领域有明确的语义分工，值得认真区分：

**Assessment（评估）**：过程导向，指收集学习或表现证据的过程，偏形成性、诊断性。典型用法如 formative assessment（形成性评估）。它回答的是"这个人现在什么水平、怎么改进"。

**Evaluation（评价/测评）**：结果导向，指基于标准做出**价值判断**，偏总结性，通常伴随打分、排名、决策。它回答的是"这个人达标没有、排第几、该不该获得某项资格"。

你的综测系统是哪种？看它的实际用途：按章程量化打分、六个月滚动计算积分、排名、决定评奖评优和资格——这是典型的总结性价值判断，**Evaluation 更准确**。

从惯例上看也支持这个选择：国内文献里"综合素质测评/评价"的主流译法就是 Comprehensive Quality Evaluation，教育部相关政策文件的英译也多用 evaluation。Assessment 在英美语境里更常见于课程学习评估（如 learning assessment），和你的场景有偏差。

还有一个实用角度：CQE（Comprehensive Quality Evaluation）作为缩写在论文里比 CQA 好用——CQA 容易和 Question Answering 领域的常用缩写撞车，你的论文恰好还涉及大模型，避开为好。

结论：用 **Evaluation**，不用改。

<details>
<summary>Thinking</summary>

> I'm distinguishing between assessment and evaluation in educational contexts. Assessment is typically formative and diagnostic—it's about gathering evidence of learning as it happens. Evaluation, on the other hand, is more summative and judgmental—it assigns grades and makes decisions about value. The 综合素质测评 system involves scoring and ranking students to determine awards and scholarships, which makes it clearly evaluative in nature.
>
> In Chinese academic translation, both 评价 and 测评 appear, but "evaluation" tends to be the more common English equivalent in these contexts, whereas "assessment" is more prevalent in Western educational literature. I can recommend "evaluation" as the better translation here based on this linguistic pattern.

</details>

## [2026-07-10 04:58] Hangqi Guo

我在思考，命名是否应该局限于学生综合素质测评系统，因为同样的逻辑也可以应用于各种系统，比如社团积分管理系统、问卷反馈系统、考试系统等，都是基于活动-出题-作答-审核-计分-统计的流程，你觉得是否应该做一个通用的系统，还是应该局限于单一用途？

## [2026-07-10 04:58] Claude

你观察到的抽象是对的——综测、社团积分、问卷、考试本质上都是"**活动定义 → 题型渲染 → 作答提交 → 审核流转 → 计分聚合 → 统计导出**"这条流水线的实例。你的插件化架构天然就在暗示这个方向。但"做通用系统"和"论文写通用系统"是两个决策，我建议拆开：

**工程上：做通用内核。** 这正是插件化架构的意义所在——题型是插件、计分函数是沙箱纯函数、审批流是可配置节点，那么"综测"只是一组插件配置的组合，"考试"是另一组（限时+自动判分+禁止修改），"问卷"是第三组（无审核+匿名+不计分）。你在 Qualy 里做过多租户和 ltree 组织架构，这套底子完全支持通用化。而且通用内核会反过来逼你把抽象做干净，比如"审核"在综测里是多级审批、在考试里是判卷、在问卷里可以为空——这会让你的状态机设计更扎实。

**论文上：锚定综测，把通用性作为"设计成果"而非"题目范围"。** 理由很现实：

1. 毕设需要具体的需求分析、业务流程、用户角色——"通用测评平台"写需求分析会空洞，综测有真实章程、真实审批场景（你手里就有 DUFL 的章程做语料，AI 生成计分函数的实验数据都是现成的）。
2. 题目一旦叫"通用××平台"，答辩老师会要求你至少演示两三个完整场景，工作量直接翻倍。
3. 反过来，题目锚定综测，论文里专门写一节"架构通用性分析"，说明同一内核可实例化为考试/问卷系统——这是加分项，零风险。

所以你的标题不用改。**验证通用性有个低成本办法**：毕设做完后，用纯配置（不写新代码）搭一个小问卷或社团积分场景，截两张图放进论文"系统扩展性验证"一节，通用性主张就有了实证，答辩时非常好讲。

一句话总结：内核按通用做，论文按综测写，通用性作为你架构设计的验证结论出现。

## [2026-07-10 05:04] Claude

这是个经典的"平台 vs 产品"取舍问题。我的建议是：**架构上做通用引擎，论文命名上保留综测这个具体场景**。两个层面分开说：

**架构层面：你的直觉是对的，值得通用化**

你抽象出的"活动-出题-作答-审核-计分-统计"流程确实是一个通用范式，而且你的插件化设计天然支持这个方向——题型是插件、计分函数是沙箱纯函数、审批流可配置，这套东西本来就没有绑死综测业务。做成通用引擎后，综测只是引擎上的一个"应用模板"，社团积分（你正好有 ACM 协会的真实场景）、问卷、考试都是别的模板。这反而强化了你论文的"插件化"主张：**综测系统作为引擎的参考实现（reference implementation），恰好证明了架构的可扩展性**。

**论文命名层面：不建议改成通用名**

理由有三个：

1. **毕设需要一个具体的业务锚点**。《通用测评引擎的设计与实现》这种题目会立刻引来"需求分析怎么写""你的用户是谁""怎么验证"的质疑。具体场景给了你需求来源、业务规则（章程）、验证对象，这些是论文第二章和第六章的血肉。
2. **通用化是章节，不是标题**。正确的写法是：标题保持综测，论文第三章讲"通用测评流程模型的抽象与插件化架构设计"，最后在总结展望里演示"同一引擎配置出问卷/社团积分系统"——这是加分项，放在标题里反而是风险项。
3. **范围控制**。标题写了"通用"，答辩老师就有权要求你证明通用性，你就得真做出两三个不同领域的完整实例。作为章节案例可以点到为止，作为标题承诺就收不住了。

所以工程上放开手做引擎（这也符合你 Qualy 项目一贯的架构品味），论文上用《多模态大模型驱动的插件化综合素质测评系统的设计与实现》不变——"插件化"三个字已经为你的通用性野心留好了位置，答辩被问到"能不能用于其他场景"时，这就是你最好的展示时刻，而不是被动防守的软肋。

## [2026-07-10 05:06] Claude

你观察到的抽象是对的——"活动-出题-作答-审核-计分-统计"确实是一个通用范式，综测、社团积分、问卷、考试都是它的实例。这本质上是"表单引擎 + 工作流引擎 + 计分引擎"的组合。但我的建议是：**架构上做通用，论文命名上保持综测**。理由分两层：

**为什么架构要通用**

你的插件化设计天然就该长成这样。题型是插件、计分函数是沙箱执行的纯函数、审批流可配置——这套东西做到位了，"综测"只是其中一组插件配置。事实上这正好强化你标题里"插件化"的正当性：答辩时被问"插件化体现在哪"，最有力的回答就是"换一套插件配置，系统就能变成问卷平台或考试系统"。通用性是你架构章节的论证素材，是加分项。

**为什么命名不要通用**

毕设题目如果叫《通用测评引擎的设计与实现》这类，会踩三个坑：

1. **需求分析没有抓手**。论文第二章要写具体业务需求、用户角色、流程图。"通用系统"的需求分析只能写抽象概念，会显得空。综测有真实的章程、真实的审批链、真实的多模态材料，全是现成的血肉。
2. **答辩老师会追问边界**。"通用"意味着你要证明它真的能覆盖考试系统（考试有防作弊、限时、判卷等一堆特有需求），一旦被追问某个场景支持不了，反而露怯。
3. **AI 故事线会被稀释**。你的多模态审批辅助、章程生成计分函数，都是綁定综测场景才成立的亮点。

**推荐的写法**：标题不变，在论文里加一节（通常放在架构设计章末或结论展望里）叫"系统通用性分析"，论证核心引擎与综测业务解耦，并举一两个迁移案例（比如你手头现成的 ACM 社团积分场景就是绝佳例子——同一套引擎、另一组插件）。这样通用性成为论文的深度体现，而不是命名上的风险。

一句话总结：**做通用的引擎，写具体的论文**。这也是学术界的常见套路——论文讲一个扎实的实例，通用性放在 discussion 里展望。

## [2026-07-22 20:22] Hangqi Guo

这样一个插件化系统，你觉得应该做成哪样更好？我觉得复杂程度超乎想象，因为题型特别多。比如品德行为评价这一块，有基础分8分（人人都有，而且未曾登录过的新用户也应该有），有学生互评分1分（班级同学登录后互相匿名打分，满分1分），有献血分（每个同学登录后，自己录入献血证照片，选择时间地点类型，层层审核通过后加1分），有社会实践分（每个同学自行上传图片或文件证明材料，选择时间地点类型，审核通过后累计1项0.5分2项0.8分3项1分满）、志愿服务分（和社会实践分规则相同），有青年大学习分（上传截图，由团支书审核后得最高1分，每缺1期扣0.2分直至0分）；对于学业水平测评，有平均学分绩（管理员在后台导入每个学生每科的课程编号、课程类型、课程成绩等信息，系统自动计算每个人当前学期主修专业各科的平均学分绩，乘以0.75后四舍五入计入，仅主修首次考试的成绩才计入，公选课不计入，需要有一个成绩库的功能来维护每个学生的历史所有成绩才能计算）、挂科扣分（当前学期所有主修非公选课程每挂1科扣1分）、全科学业加分（当前学期主修所有课程均大于等于85加2分、80加1分），专业竞赛加分（学生根据文件内的竞赛名单，自主选择并上传比赛的名称、届次、获奖等级、团体信息等，审核通过后加分，竞赛名单是动态的，需要管理员进行维护），科研加分（学生自主提交刊物名称、期数，提交刊物见刊照片，上传刊物知网维普万方链接，审核通过后按等级高低进行加分）。我有下面三种插件化设想：

1. 代码内预置所有的题型和功能等，只是允许用户插件式地在后台以插件形式开关每个功能。
2. 代码内只包含主体框架本体，管理员可以在后台远程安装插件包（类似HA加载项、WP插件等）。
3. 插件作为配置项存储于数据库中，每个插件就是一段JSON可以随意迁移安装。

## [2026-07-22 20:22] Claude

先说结论：**推荐 3 为主、1 为底座的混合方案，不推荐 2**。逐个分析：

**方案 1（预置全部题型 + 开关）**：这其实不是插件化,只是功能开关（feature flag）。答辩时说"插件化"会被质疑名不副实。更致命的是它解决不了你列举的这些题型的真正难点——献血分和社会实践分的区别不在"开或关"，而在计分规则、审核链、材料要求的**参数差异**。硬编码 30 个题型意味着每来一个新需求就要发版。

**方案 2（远程安装插件包，HA/WP 模式）**：工程上最炫，但对毕设是个陷阱。动态加载代码包意味着你要解决包格式定义、版本兼容、依赖隔离、恶意代码防护、热加载/卸载的内存泄漏——每一个都是无底洞，而且 NestJS 的 DI 容器对运行时动态注册模块支持得很勉强。做到最后大概率是一个残缺的插件市场，答辩时被问"插件间冲突怎么办"就很难受。这套机制适合 WordPress 那种有生态诉求的产品，你的系统没有第三方开发者，为不存在的生态付出架构成本不值。

**方案 3（插件即 JSON 配置）**：方向正确，但纯 JSON 撑不住你的计分逻辑——"平均学分绩乘 0.75 四舍五入、仅主修首次考试、公选课不计入"这种规则用 JSON DSL 表达会发明出一个蹩脚的编程语言。

**所以真正的答案是分层**。仔细看你列的题型，会发现它们是有限几种"行为原语"的参数化组合：

| 原语（代码实现，固定几种） | 覆盖的题型                                       |
| -------------------------- | ------------------------------------------------ |
| 固定赋分                   | 基础分 8 分                                      |
| 互评                       | 学生互评 1 分                                    |
| 材料申报+审核              | 献血、社会实践、志愿服务、竞赛、科研、青年大学习 |
| 数据导入+自动计算          | 学分绩、挂科、全科加分                           |

原语只有 4-5 种，用代码写死（这是方案 1 的合理部分）。而每个具体题型是**原语 + 配置 + 计分函数**的实例，存数据库（这是方案 3）：

```
题型实例 = {
  primitive: "material_review",        // 用哪个原语
  formSchema: {...},                    // 申报表单：时间/地点/类型/图片
  reviewChain: ["班委", "辅导员"],      // 审核链配置
  scoringFn: "沙箱执行的JS纯函数",       // 累计1项0.5/2项0.8/3项封顶1
  constraints: {...}                    // 上限、周期等
}
```

这样社会实践和志愿服务就是同一原语的两份配置；青年大学习的"缺 1 期扣 0.2"是一个十行的计分函数；竞赛名单动态维护就是配置里挂一个管理员可编辑的字典表。而 AI 生成题目的故事也顺理成章——AI 读章程，输出的就是这段 JSON + 计分函数，不需要生成整个代码包。

另外注意你藏在题目里的一个真正独立的模块：**成绩库**。它不是题型，是一个领域数据源（课程、成绩、课程类型、首修/重修标记），学分绩相关的三个题型都从它取数。建议把它设计成独立模块，计分函数通过 context 注入的只读查询接口访问它，这也顺便回答了"新用户没登录也有基础分"的问题——计分是对全量学生名单批处理计算的，不依赖用户登录行为。

这个"原语内核 + 配置实例 + 沙箱函数"的三层结构，比方案 2 好写、好测、好答辩，而且论文里"为什么不做成 WordPress 式插件市场"本身就可以写一节技术选型论证。

<details>
<summary>Thinking</summary>

> 这个问题涉及深层的架构设计。我倾向于推荐混合方案——主要采用第三种选项，即配置驱动加上一套固定的代码级"问题类型原语"和能力插件，这样既避免了第二种方案的过度复杂和风险，也比第一种方案更接近真正的插件架构。我会把他们具体的问题类型映射到这些原语上，用结构化的方式来说明这个方案的优势。

</details>

## [2026-07-22 20:47] Claude

先说结论:**方案 3 为主、方案 1 打底的混合形态**,方案 2 不要做。但关键不在选哪个,而在于你要先把这些五花八门的题型**拆解成正交的能力原语**,否则哪个方案都会失控。

**先拆解你列的题型,你会发现它们只是四个维度的排列组合**

- **数据来源**:无提交(基础分)、本人上传材料(献血/社会实践/竞赛/科研)、他人输入(学生互评)、管理员导入(成绩库)、周期性提交(青年大学习)
- **审核流**:无审核(基础分、绩点)、单级审核(团支书审青大)、多级审核(献血层层审核)
- **计分逻辑**:常量、按次数阶梯(1项0.5/2项0.8/3项1)、按缺勤扣减(每缺1期扣0.2)、数据集上的公式(平均学分绩×0.75、挂科每科扣1)、按等级查表(竞赛/科研)
- **参照数据**:有些题型依赖管理员维护的动态数据(竞赛名单、成绩库)

拆完你会发现:**代码里需要内置的不是"题型",而是这四类能力原语**——文件上传组件、互评收集器、周期打卡组件、成绩库模块、审批流引擎、沙箱计分执行器。而"献血分""竞赛加分"这些具体题型,只是把原语组合起来的**一份 JSON 配置 + 一个计分函数**。

**三个方案的判决**

方案 1(代码预置全部题型+开关)的问题:每加一个题型都要改代码发版,而综测细则每年都变(阶梯分值、竞赛名单、扣分规则),你会疲于奔命。而且它和你标题里"插件化"的承诺不符——那只是"功能开关"。

方案 2(远程安装插件包)是工程上最炫但最不该做的:NestJS 动态加载远程模块要处理版本兼容、依赖冲突、任意代码执行的安全问题,这是 WordPress 花了十几年才勉强做好的事,毕设周期内做不好,答辩演示翻车风险极高。

方案 3(题型=数据库里的 JSON 配置)是正解,理由有三:题型可以随细则修改而热更新;可以导出迁移(你之前设想的"换一套配置就变成社团积分系统"靠它实现);**最重要的是它和你的 AI 故事线严丝合缝**——AI 读章程生成的产物就是这份 JSON + 沙箱计分函数,只有配置化的题型才可能被 AI 生成。方案 1 和 2 里 AI 都无处发力。

**落地形态**

代码层(方案 1 性质):能力原语组件、动态表单渲染器、审批流引擎、成绩库模块、isolated-vm/QuickJS 沙箱。这些是"插件运行时",硬编码,稳定。

数据层(方案 3 性质):每个题型一条记录,包含表单 schema(用哪些控件、什么字段)、审核流配置(几级、谁审)、计分函数(沙箱执行的纯函数,处理阶梯/扣减/查表逻辑)、参照数据引用(挂在哪个竞赛名单上)。

有一个特殊点要单独处理:**成绩库不是题型,是领域数据模块**。平均学分绩的计算(主修/首次/非公选的过滤、学分加权)逻辑复杂且依赖大量历史数据,建议做成核心模块+对外暴露查询 API,计分函数只调用它的聚合结果,不要试图把整个绩点逻辑塞进沙箱 JSON 里。

这样答辩时你的说法就很漂亮:"系统内置七种能力原语和插件运行时,全校任何测评规则的变化都不需要改代码,只需增改配置——并且这份配置可以由多模态大模型读取章程自动生成草案。"复杂度看起来吓人,拆成原语之后其实收敛得很好。

<details>
<summary>Thinking</summary>

> I'm thinking through the architecture options here—a hybrid approach makes the most sense for a thesis project. I'd go with config-driven as the main mechanism paired with a fixed set of built-in question type primitives, since full remote plugins would be overengineered and introduce unnecessary risk. Now I'm analyzing the existing question types to identify what the core primitives actually are.
>
> Looking at the different scoring patterns across their system—constant scores, peer aggregation, evidence-based tiering, periodic deductions, computed grades from external data, dynamic reference lists—I can see the underlying components: data sources (user submission, peer input, imported data, or none), review workflows (none, single-level, multi-level), scoring functions (constant, tiered counts, formulas, deductions), and admin-maintained reference data. This maps directly to their earlier concept: question types as JSON configs that compose form schemas, workflow configs, and scoring functions, with built-in capability primitives in code like upload widgets, peer-review collectors, and grade-book modules. The grade-book itself is special though—it's a domain data module rather than a question type, so it should live as a core module or data source plugin in the codebase.
>
> I'm leaning toward a hybrid of options 1 and 3: keep the capability primitives and renderer in code, store question types as JSON plus scoring functions in the database for portability, and skip option 2 entirely since it's unnecessary for the thesis scope and introduces security and complexity issues with dynamic remote loading. This approach also enables the AI story—AI can generate both the JSON config and the scoring function, which only works in option 3.

</details>

## [2026-07-22 20:50] Hangqi Guo

这样一个插件化系统，你觉得应该做成哪样更好？我觉得复杂程度超乎想象，因为题型特别多。比如品德行为评价这一块，有基础分8分（人人都有，而且未曾登录过的新用户也应该有），有学生互评分1分（班级同学登录后互相匿名打分，满分1分），有献血分（每个同学登录后，自己录入献血证照片，选择时间地点类型，层层审核通过后加1分），有社会实践分（每个同学自行上传图片或文件证明材料，选择时间地点类型，审核通过后累计1项0.5分2项0.8分3项1分满）、志愿服务分（和社会实践分规则相同），有青年大学习分（上传截图，由团支书审核后得最高1分，每缺1期扣0.2分直至0分）；对于学业水平测评，有平均学分绩（管理员在后台导入每个学生每科的课程编号、课程类型、课程成绩等信息，系统自动计算每个人当前学期主修专业各科的平均学分绩，乘以0.75后四舍五入计入，仅主修首次考试的成绩才计入，公选课不计入，需要有一个成绩库的功能来维护每个学生的历史所有成绩才能计算）、挂科扣分（当前学期所有主修非公选课程每挂1科扣1分）、全科学业加分（当前学期主修所有课程均大于等于85加2分、80加1分），专业竞赛加分（学生根据文件内的竞赛名单，自主选择并上传比赛的名称、届次、获奖等级、团体信息等，审核通过后加分，竞赛名单是动态的，需要管理员进行维护），科研加分（学生自主提交刊物名称、期数，提交刊物见刊照片，上传刊物知网维普万方链接，审核通过后按等级高低进行加分）。我有下面三种插件化设想：

1. 代码内预置所有的题型和功能等，只是允许用户插件式地在后台以插件形式开关每个功能。
2. 代码内只包含主体框架本体，管理员可以在后台远程安装插件包（类似HA加载项、WP插件等）。
3. 插件作为配置项存储于数据库中，每个插件就是一段JSON可以随意迁移安装。
4. 项目主体包含一个通用框架，通过启动前选装配置npm插件包，可以快速组装启动项目（TS下有一个cordis框架，已有不少项目在用，比如我之前维护的Hydro项目和Koishi项目）

## [2026-07-22 20:50] Claude

先把你列的题型拆一下，会发现它们其实只有**五种能力原型**，其余全是参数差异：

1. **固定分**（基础分8分）——无交互，纯计分
2. **互评**（学生互评1分）——采集他人评价，聚合计分
3. **材料申报 + 审核**（献血、社会实践、志愿服务、竞赛、科研、青年大学习）——上传证明→表单字段→审批链→按规则累计。这六个题看似不同，区别只是：字段 schema 不同、审批人不同、累计函数不同（0.5/0.8/1 封顶、每缺一期扣 0.2、按获奖等级映射分值)
4. **数据导入 + 派生计算**（平均学分绩、挂科、全科加分）——不由学生作答，由管理员导入成绩库，计分函数从库里查询计算
5. **外部数据源维护**（竞赛名单、刊物等级表）——不是题型，是题型引用的**字典表**

看清这个结构后，四个方案的答案就明确了：**不是四选一，而是分层组合——能力原型用方案 4（或 1），题目实例用方案 3**。

**能力原型层（代码级插件）**：材料申报、互评、数据导入这些原型必须是代码，因为它们各自需要不同的路由、存储、前端组件。这一层用你熟悉的方式做——NestJS 动态模块或 cordis 风格都行。方案 1 和 4 的区别只是"编译时全量内置+开关"vs"启动时选装"，对毕设来说**方案 1 的简化版足够**（全量内置，后台开关），方案 4 的按需组装可以作为论文里的架构展望。你只有 5 个原型，不值得为它们建 npm 分发体系。

**题目实例层（数据库 JSON 配置，即方案 3）**：具体的"献血分"是一条配置：`{ 原型: "材料申报", 字段schema: {...}, 审批链: [...], 计分函数: "sandbox代码", 字典引用: null, 满分: 1 }`。"社会实践分"是同原型另一条配置。**这一层正是你 AI 生成的落点**——章程喂给大模型，生成的就是这段 JSON + 沙箱计分函数，不需要 AI 写原型代码。这也回答了你上次问的"AI 生成题目可行性"：AI 只在配置层工作，风险可控。

**方案 2（后台远程装插件包）明确不推荐**：等于给自己造一个插件市场 + 远程代码加载 + 版本管理体系，安全面巨大（远程代码执行），工作量是另一个毕设，而你只有一个租户在用。HA/WP 那套是面向海量第三方开发者的生态设计，你没有这个需求。

成绩库单独说一句：它不是题型插件，是一个**独立领域模块**（成绩导入、历史维护、按学期/课程类型查询的 API），平均学分绩题型的计分函数通过沙箱暴露的只读查询接口取数。这样"仅主修首次考试、公选不计"这些规则就写在计分函数里,成绩库保持中立。

复杂度没有你想的那么失控——核心工作量 = 5 个原型组件 + 配置引擎 + 沙箱执行器 + 审批流。你列的十几个题型全部退化为配置数据，而且这恰好构成答辩时最漂亮的论证："新增一个题型不需要改代码"。

<details>
<summary>Thinking</summary>

> I'm thinking through their technical architecture needs—they're dealing with several question types like form collection, approval workflows, scoring functions, and data imports. I'm leaning toward a hybrid approach: using a framework-level plugin system similar to Cordis or NestJS dynamic modules to handle the different capability types, combined with database-stored JSON configurations and AI-generated sandbox functions for the scoring logic. This lets me analyze how their question types map to these two layers.

</details>

## [2026-07-22 21:02] Hangqi Guo

这样一个插件化系统，你觉得应该做成哪样更好？我觉得复杂程度超乎想象，因为题型特别多。比如品德行为评价这一块，有基础分8分（人人都有，而且未曾登录过的新用户也应该有），有学生互评分1分（班级同学登录后互相匿名打分，满分1分），有献血分（每个同学登录后，自己录入献血证照片，选择时间地点类型，层层审核通过后加1分），有社会实践分（每个同学自行上传图片或文件证明材料，选择时间地点类型，审核通过后累计1项0.5分2项0.8分3项1分满）、志愿服务分（和社会实践分规则相同），有青年大学习分（上传截图，由团支书审核后得最高1分，每缺1期扣0.2分直至0分）；对于学业水平测评，有平均学分绩（管理员在后台导入每个学生每科的课程编号、课程类型、课程成绩等信息，系统自动计算每个人当前学期主修专业各科的平均学分绩，乘以0.75后四舍五入计入，仅主修首次考试的成绩才计入，公选课不计入，需要有一个成绩库的功能来维护每个学生的历史所有成绩才能计算）、挂科扣分（当前学期所有主修非公选课程每挂1科扣1分）、全科学业加分（当前学期主修所有课程均大于等于85加2分、80加1分），专业竞赛加分（学生根据文件内的竞赛名单，自主选择并上传比赛的名称、届次、获奖等级、团体信息等，审核通过后根据等级和获奖进行加分，竞赛名单是动态的每年变化，需要管理员进行维护），科研加分（学生自主提交刊物名称、期数，提交刊物见刊照片，上传刊物知网维普万方链接，审核通过后按等级高低进行加分）、职业证书加分（CET、专四专八、驾驶证等，列表由管理员维护，一项一分）、学生干部加分（按照每人每学期加分最高的职务进行加分，提交加分证明）、校园文化活动加分（按照不同的活动名称、参与分、是否获奖及获奖等级并提交加分证明进行加分，支持管理员批量导入和用户手动填报等）、非专业文体实践加分（参与等级、是否获奖、获奖等级等）、非专业领域论文加分（等级类型、发表地址、是否消息报道类）……（等等等等还有很多）。

我有下面三种插件化设想：

1. 代码内预置所有的题型和功能等，只是允许用户插件式地在后台以插件形式开关每个功能。
2. 代码内只包含主体框架本体，管理员可以在后台远程安装插件包（类似HA加载项、WP插件等）。
3. 插件作为配置项存储于数据库中，每个插件就是一段JSON可以随意迁移安装。
4. 项目主体包含一个通用框架，通过启动前选装配置npm插件包，可以快速组装启动项目（TS下有一个cordis依赖注入框架，已有不少项目在用，比如我之前维护的Hydro项目和Koishi项目）

## [2026-07-22 21:02] Claude

先说结论：**3 为主、1 为辅的分层混合方案**，2 和 4 都不建议。关键洞察是：你列的这一大堆题型，看似几十种，拆开后其实只有**少数几种"交互原型"**，其余全是配置和计分函数的差异。

先做个分解。把每个题型按四个维度拆：

- **数据来源**：用户填报+上传证明（献血、竞赛、科研、证书……占大多数）／同学互评（互评分）／管理员导入（成绩库、校园活动批量导入）／系统计算（学分绩、挂科、全科加分）／无来源固定值（基础分 8 分）
- **计分逻辑**：固定分、阶梯累计（1项0.5/2项0.8/3项1）、逐项扣分（青大学习）、外部数据公式（学分绩×0.75）
- **审核流**：无审核、单级（团支书）、多级
- **特殊规则**：未登录用户也有基础分、每学期取最高职务、首考成绩才计入

这样一拆你会发现：献血、社会实践、志愿服务、竞赛、科研、证书、学生干部、文体实践、论文……全都是同一个原型——"**表单字段 + 证明材料 + 审核链 + 计分函数**"，差异全在配置里。真正需要独立代码的原型只有大约 4-5 种：填报审核型、互评型、导入计算型（成绩库）、批量导入型、固定值型。

于是架构就清晰了：

**内核层（代码，方案 1 的思想）**：动态表单渲染、审核工作流引擎、沙箱计分执行器、成绩库这类数据管道。这些是"能力原语"，必须写死在代码里——互评的匿名机制、成绩库的导入与计算，配置是配不出来的。

**题型定义层（数据库 JSON，方案 3）**：每道题是一条记录，声明用哪个原型、表单 schema、审核链配置、以及一段沙箱计分函数（你的 PAC 式函数）。"3项1分封顶"和"每缺1期扣0.2"就是两个不同的函数体而已。这层正是 AI 生成的目标产物——章程喂给大模型，产出的就是这段 JSON + 函数，与你的论文故事完美闭环。

**为什么不选 2 和 4**：方案 2（远程安装插件包）意味着你要做插件市场、版本管理、热加载和更大的安全面，这是 WordPress 用二十年生态才养出来的东西，毕设做这个是给自己挖坑，而且综测场景根本没有第三方开发者。方案 4（cordis + npm 选装）你从 Hydro/Koishi 是熟的，但它解决的是"开源社区多人扩展"问题，代价是每加一种题型都要发包、重启、重新部署——而你的核心卖点恰恰是"管理员在后台配一道题、AI 生成计分函数、不用动代码就上线"。方案 4 会杀死这个卖点。

不过方案 4 可以留一个口子：**内核里的"原型"本身用依赖注入注册**（NestJS 的 DI 天然支持），未来真有新交互范式（比如考试的限时答题）再以代码模块形式加原型。这样论文里可以说"两级插件化：原型级（代码插件）+ 题型级（配置插件）"——这个分层本身就是你架构章节最有含量的一节，答辩讲起来也漂亮。

另外你提到的两个魔鬼细节值得在设计时就防住：基础分对"从未登录的用户"也要生效，说明计分不能依赖用户主动作答记录，要有"缺省题型"的概念；学分绩的"仅主修首次考试"说明成绩库要存完整历史而非当期快照。这两个都是答辩老师可能拿来试探你需求理解深度的点。

<details>
<summary>Thinking</summary>

> I'm breaking down the architecture question by looking at how the four options differ in their core components: where the data comes from, how scoring gets calculated, what approval processes are needed, and any edge cases like handling users who've never logged in. The real distinction seems to be in the configuration and scoring logic rather than fundamentally different interaction patterns.
>
> Most question types boil down to combinations of form fields, evidence uploads, approval chains, and scoring functions, though a few are genuinely distinct—peer mutual rating works as an interaction pattern, grade database computation requires a data pipeline, and admin batch imports need special handling. My recommendation is a layered approach: use option 3 (database-stored configuration with sandboxed scoring functions) as the foundation for handling the long tail of question types, supplement it with a small set of built-in code-level "archetype" plugins for the cases that can't be purely configured (submission-based, rating-based, computed, imported), and skip option 4 (npm packages) as over-engineering for a thesis project and option 2 (remote plugin installation) as a security and operational burden. This aligns perfectly with the thesis narrative of AI generating scoring functions from a charter, storing them in the database, and executing them in a sandbox—the kernel handles forms, workflows, the scoring sandbox, and data stores, while the archetypes and per-question JSON configs plus scoring functions cover roughly thirty question types.

</details>

## [2026-07-22 21:10] Hangqi Guo

这样一个插件化系统，你觉得应该做成哪样更好？我觉得复杂程度超乎想象，因为题型特别多。比如品德行为评价这一块，有基础分8分（人人都有，而且未曾登录过的新用户也应该有），有学生互评分1分（班级同学登录后互相匿名打分，满分1分），有献血分（每个同学登录后，自己录入献血证照片，选择时间地点类型，层层审核通过后加1分），有社会实践分（每个同学自行上传图片或文件证明材料，选择时间地点类型，审核通过后累计1项0.5分2项0.8分3项1分满）、志愿服务分（和社会实践分规则相同），有青年大学习分（上传截图，由团支书审核后得最高1分，每缺1期扣0.2分直至0分）；对于学业水平测评，有平均学分绩（管理员在后台导入每个学生每科的课程编号、课程类型、课程成绩等信息，系统自动计算每个人当前学期主修专业各科的平均学分绩，乘以0.75后四舍五入计入，仅主修首次考试的成绩才计入，公选课不计入，需要有一个成绩库的功能来维护每个学生的历史所有成绩才能计算）、挂科扣分（当前学期所有主修非公选课程每挂1科扣1分）、全科学业加分（当前学期主修所有课程均大于等于85加2分、80加1分），专业竞赛加分（学生根据文件内的竞赛名单，自主选择并上传比赛的名称、届次、获奖等级、团体信息等，审核通过后根据等级和获奖进行加分，竞赛名单是动态的每年变化，需要管理员进行维护），科研加分（学生自主提交刊物名称、期数，提交刊物见刊照片，上传刊物知网维普万方链接，审核通过后按等级高低进行加分）、职业证书加分（CET、专四专八、驾驶证等，列表由管理员维护，一项一分）、学生干部加分（按照每人每学期加分最高的职务进行加分，提交加分证明）、校园文化活动加分（按照不同的活动名称、参与分、是否获奖及获奖等级并提交加分证明进行加分，支持管理员批量导入和用户手动填报等）、非专业文体实践加分（参与等级、是否获奖、获奖等级等）、非专业领域论文加分（等级类型、发表地址、是否消息报道类）……（等等等等还有很多）。

我有下面三种插件化设想：

1. 代码内预置所有的题型和功能等，只是允许用户插件式地在后台以插件形式开关每个功能。
2. 代码内只包含主体框架本体，管理员可以在后台远程安装插件包（类似HA加载项、WP插件等）。
3. 插件作为配置项存储于数据库中，每个插件就是一段JSON可以随意迁移安装。
4. 项目主体包含一个通用框架，通过启动前选装配置npm插件包，可以快速组装启动项目（TS下有一个cordis依赖注入框架，已有不少项目在用，比如我之前维护的Hydro项目和Koishi项目）

其实我挺想写4的，因为感觉这样才有比较大的技术性，否则又变成CRUD项目了。

## [2026-07-22 21:11] Claude

先把你的题型清单拆一下，你会发现复杂度没有表面那么吓人。这几十个题型其实只是**六七种交互范式**的实例：

1. **固定赋分型**：基础分 8 分（无需登录、人人都有）
2. **互评型**：学生互评 1 分（匿名、班级范围、聚合计分）
3. **材料申报审核型**：献血、社会实践、志愿服务、竞赛、科研、证书、学生干部、文体实践、论文……这一大串全是同一个范式——"填表 + 传证明 + 多级审核 + 按规则计分"，差别只在表单字段和计分函数
4. **周期打卡型**：青年大学习（按期数扣分）
5. **数据导入计算型**：平均学分绩、挂科、全科（成绩库 + 纯计算，无申报无审核）
6. **混合录入型**：校园文化活动（批量导入 + 手动填报并存）

看清这一点后，架构答案就浮出来了：**插件的粒度应该是"范式"而不是"题型"**。范式是代码（表单渲染逻辑、审核流交互、聚合方式），题型是配置（字段 schema、计分函数、审核链定义）。"献血分"和"竞赛加分"不该是两个代码插件，而是"材料申报审核范式"下的两份配置 + 两个沙箱计分函数。

在这个前提下评你的四个方案：

**方案 1**（预置全部 + 开关）：这是 feature flag，不是插件化，答辩说不过去，排除。

**方案 2**（后台远程安装插件包）：工程量黑洞。远程安装意味着热加载、插件市场、插件本身的沙箱与签名、版本冲突处理——这是 WordPress 花了十几年做的事，毕设期做这个必然烂尾，排除。

**方案 3**（插件 = 数据库里的 JSON）：它其实不是和 4 竞争的方案，而是 4 的**上层**。JSON 配置能描述"字段、规则、审核链"，但描述不了"互评的匿名聚合逻辑"这种行为——行为得是代码。

**方案 4**（cordis + npm 选装包）：方向对，且你有 Hydro/Koishi 的维护经验，cordis 的 service/plugin 模型你熟，这是真实优势。它的技术性也确实够——依赖注入、插件生命周期、服务间通信，这些能撑起论文架构章节。

所以我的推荐是 **4 + 3 的双层结构**：

- **代码层（cordis 插件包）**：每个交互范式一个包——`@qualy/paradigm-declaration`（材料申报审核）、`@qualy/paradigm-peer-review`、`@qualy/paradigm-import-compute`、`@qualy/paradigm-checkin`……再加上能力型插件：多模态审核辅助、沙箱计分执行器、成绩库服务。启动前 npm 选装组合。
- **配置层（数据库 JSON）**：每个具体题型是一条配置记录，引用某个范式，携带字段 schema、审核链定义、计分函数（AI 从章程生成、沙箱执行的那个）。管理员在后台建题型、每年改竞赛名单，都只动这一层，不动代码。

这个结构还有两个额外好处。第一，它让你的 AI 故事线严丝合缝：AI 读章程后生成的就是配置层的 JSON + 计分函数，而不是危险的动态代码挂载。第二，它直接回答"通用性"——换一组范式插件配置，系统就是社团积分或问卷平台，你上次问的通用性论证有了具体机制支撑。

一个务实提醒：成绩库（范式 5）建议做成独立的领域服务插件而不是普通题型，因为"仅主修首次考试、公选课剔除、乘 0.75 四舍五入"这些规则需要一个真正的成绩数据模型支撑，它是被计分函数**引用**的数据源，而不是一道"题"。这也是答辩时展示你领域建模能力的好素材。

工作量控制上：范式做全 6 种不现实也没必要，毕设实现 3-4 个范式（申报审核、导入计算、固定分、互评选一）+ 完整双层机制 + AI 链路,其余范式写进"系统扩展性"章节作为设计验证即可。

<details>
<summary>Thinking</summary>

> Looking at how these four options break down, I'm seeing that the question really hinges on separating configuration management from scoring logic from interaction patterns. The strongest approach seems to be combining option 4 for the interaction capabilities it provides, option 3 for managing per-year rule instances in the database, and then using AI-generated scoring functions to bridge between them. Options 1 and 2 don't fit as well—one's just feature-flag CRUD, the other requires too much engineering overhead around remote installation and security concerns.

</details>

## [2026-07-22 21:35] Hangqi Guo

几个问题。

1. 数据导入计算型，这种计算是否应该交由数据库进行，而不是逐行/分批进行JS计算，还是说其实这不是一个很看重性能的场景，初期不必考虑？
2. 成绩库是否应该作为一个插件，Cordis中可以声明插件的依赖项，这样平均学分绩、挂科、全科可以声明该插件作为依赖项。如果成绩库作为插件，那么如何处理选用插件后数据库的迁移？
3. 其实每个题型的前端界面都不尽相同，及其背后的计分逻辑、审核逻辑也都不尽相同，我还在思考，是否应该将范式作为插件，同时将题型也应该作为依赖范式的插件？还是说你认为还是应该将配置项尽可能挪到前端。

未尽的问题由你来思考。

## [2026-07-22 21:36] Claude

三个问题都问到点子上了,逐个说,最后补几个你没问但迟早会撞上的。

**1. 导入计算:SQL 还是 JS?**

先算量级:一个学院几千学生 × 每人每学期几十门课,一次全量计算也就 10 万行以内。这个量级 JS 逐行算是毫秒到秒级的事,性能不是问题。所以决策依据不该是性能,而是**规则的归属**。

我的建议:**取数用 SQL,计分用 JS(沙箱)**。理由是你的架构里计分逻辑的统一形态就是沙箱纯函数——"乘 0.75 四舍五入""首考且非公选才计入"这些规则如果写进 SQL,就出现了第二套规则载体,AI 生成计分函数的故事线也断了(AI 生成 SQL 再执行,安全性完全不可控)。正确的切分是:成绩库服务负责用 SQL 做好**过滤和整形**(查出该生当学期主修首考成绩集合),计分函数拿到干净的输入数组做纯计算。SQL 干它擅长的关系运算,JS 干规则表达,各归其位。

批量场景(全院重算)就是对每个学生调一次纯函数,串行都够快,不够再 `Promise.all` 分批。唯一值得做的工程优化是**计算结果落库 + 按需失效重算**,而不是每次查询实时算——这顺便解决了"成绩修改后综测分要更新"的一致性问题,论文里也有得写。

**2. 成绩库作为插件 + 数据库迁移**

成绩库做成插件是对的,cordis 的 `inject` 依赖声明正好用上:三个学业题型范式声明依赖 `gradebook` 服务,没装这个插件时这些题型不可用,依赖关系在框架层面显式化——这本身就是插件化论证的好素材。

迁移问题是插件化架构的经典难题,给你三个现实选项:

- **插件自带 schema,启动时注册迁移**。Hydro 的做法接近这个思路。但 Drizzle 的迁移是围绕"单一 schema 目录 + drizzle-kit 生成 SQL"设计的,对分散在各插件里的 schema 支持并不好,你需要自己写胶水。
- **约定式聚合**:每个插件在自己包里导出 Drizzle schema(如 `@qualy/plugin-gradebook/schema`),主项目有一个聚合入口把**已选装插件**的 schema 汇总,drizzle-kit 对聚合结果统一生成迁移。这和你方案 4 的"启动前选装"完美契合——选装是构建期决策,迁移也在构建/部署期完成,不需要运行时动态建表。**我推荐这个**,工程量小、和 Drizzle 工作流不打架,而且"插件携带 schema、构建期聚合迁移"写进论文就是插件化数据层设计的一节。
- 运行时动态迁移(插件启用时自动 ALTER):留给方案 2 那种热安装场景的,你不需要,别碰。

一个细节:插件表统一加前缀(`gradebook_scores`)或用 PostgreSQL schema 命名空间隔离,避免插件间表名冲突。

**3. 题型也做成插件,还是配置?**

你的直觉("每个题型前端都不尽相同")是对的,但结论不必是"题型全部代码化"。关键洞察是:**范式插件定义扩展点,题型在扩展点上填充,而填充物可以是配置也可以是代码**。

具体做法——范式插件声明三个扩展点:

- **表单描述**:字段 schema(JSON,渲染交给你已有的动态表单引擎)
- **计分函数**:沙箱纯函数(字符串存库)
- **前端定制**(可选):自定义渲染组件

绝大多数题型只需要前两者,纯配置解决——献血和社会实践的差别只是字段和函数,不该为它们各写一个包。但少数题型确实有独特交互(互评的匿名打分矩阵、青年大学习的期数日历),这些**允许注册前端组件覆盖默认渲染**,成为"重题型",以代码插件形式存在并声明依赖范式插件。

也就是说不是二选一,而是**分级**:轻题型 = 配置,重题型 = 配置 + 组件代码。这个"渐进式扩展"设计本身很有论文相(可以类比 VS Code 的 contribution points:大部分扩展只写 package.json 声明,少数才写代码)。

前端组件的插件化有个工程决策点要提前想:后端 cordis 插件容易,前端组件怎么跟着插件走?毕设范围内建议**不做前端动态加载**(module federation 那套复杂度不值得),而是前端仓库里维护一个组件注册表,按题型的 `renderer` 字段查表渲染,查不到就走动态表单默认渲染。前端组件全量打包、后端插件决定哪些题型可用——牺牲一点纯粹性换取大幅简化,论文里如实说明这个权衡即可,答辩老师只会觉得你清醒。

**你没问但会撞上的三件事:**

- **审核链也该是范式的扩展点之一**。你清单里"层层审核""团支书审核"暗示审核链因题型而异,把审核链定义(节点、角色、驳回规则)放进题型配置,和你 Qualy 的多租户审批经验直接对接。
- **互评范式的计分聚合时机**特殊:它不是"提交即计分",而是窗口关闭后聚合(去极值?平均?)。设计范式接口时要区分"即时计分"和"延迟聚合"两种生命周期,否则互评塞不进你的统一模型。
- **基础分这种"无提交题型"**提醒你:范式接口里"作答"应该是可选环节。用它检验你的抽象是否干净——一个好的范式模型应该能自然表达"没有作答、人人得分"而不用 hack。

<details>
<summary>Thinking</summary>

> I'm ready to work through these technical questions systematically.

</details>

## [2026-07-22 22:22] Hangqi Guo

你推荐使用Cordis还是nestjs还是orpc v2？cordis本身就是以插件为基本单位，nestjs是主流依赖注入框架，orpc可以提供前后端类型严格。你推荐使用postgres还是mongodb，postgres事务友好AI友好，mongodb天然适配cordis无需跑迁移？请帮我排序并给出依据。

## [2026-07-22 22:22] Claude

先纠正一个前提：**oRPC 和 Cordis/NestJS 不在同一层**。oRPC 是接口层（契约 + 类型安全 RPC），Cordis/NestJS 是应用组织层（DI + 生命周期）。它们不是三选一，而是"组织层二选一 + 是否叠加 oRPC"。所以真正的问题是两个：组织层用什么，接口层用什么。

**组织层排序：Cordis > NestJS**

1. **Cordis（推荐）**。决定性理由：你的论文核心命题是插件化，而 Cordis 的基本单位就是插件——插件生命周期、`inject` 依赖声明、服务注册、运行时启停，这些正是你论文第三章要论证的机制,用 Cordis 等于框架天然背书你的架构叙事。NestJS 的 Module 系统虽然也能做,但它的 DynamicModule 是"模块化"而非"插件化",启动后模块图基本固定,你要自己在上面搭一层插件语义,论文里反而要花篇幅解释"为什么这也算插件化"。加上你维护过 Hydro、熟悉 Koishi,Cordis 的坑你趟过,这个经验优势很实在。风险也要说清:Cordis 生态小、文档薄,遇到问题没有 Stack Overflow 可查,只能读源码——但你恰好是读过源码的人。
2. **NestJS（保守选项）**。如果你担心答辩老师不认识 Cordis、或者担心中途踩坑没有退路,NestJS 是稳妥的:主流、文档全、你也已经学了一轮。但它对你论文的独特贡献最小——"基于 NestJS 的插件化"需要你额外证明,而"基于 Cordis"插件化是自明的。

**接口层：oRPC 叠加使用,不参与排序**。你在 Qualy 里已经用过 oRPC + Hono 的组合,契约优先 + 端到端类型安全对你的动态表单场景(前后端共享 Zod schema)价值很大。Cordis 生态里 HTTP 通常经由 `@cordisjs/plugin-server`(底层 Koa),oRPC 的 fetch adapter 挂上去需要写一点胶水,这是可控的工程量,甚至可以做成你自己的 `@qualy/plugin-orpc` 插件——本身又是一个插件化的展示案例。

**数据库排序：PostgreSQL > MongoDB,差距明显**

1. **PostgreSQL(强烈推荐)**。你的业务是典型的强关系 + 强事务场景:成绩库的"主修首考非公选"过滤是关系查询的主场;审批链状态流转、计分结果落库需要事务;jsonb 列足够承载你的题型配置 JSON(配置层照样无迁移之忧,"MongoDB 免迁移"的优势其实 jsonb 也能给你一半)。加上 Drizzle + drizzle-kit 的迁移工作流是我们上一轮讨论的插件 schema 聚合方案的基础,这套只在 SQL 数据库上成立。
2. **MongoDB(不推荐,尽管 Hydro 用它)**。"天然适配 Cordis"这个说法要拆穿:Cordis 对数据库没有偏好,Hydro 用 Mongo 是历史选择而非框架要求。免迁移的代价是把 schema 一致性从数据库挪到应用层,而你的场景恰恰有大量跨集合关系(学生-成绩-题型-提交-审批记录),用 Mongo 你会花很多精力手写 JS 做本该由 JOIN 和外键完成的事。另外别忘了你答辩要讲"AI 生成计分函数读取成绩数据",关系模型的确定性 schema 对 AI 理解数据结构也更友好。

**最终推荐栈**:Cordis(组织层)+ oRPC v2 契约(接口层,经 server 插件胶水接入)+ PostgreSQL + Drizzle(数据层,插件 schema 构建期聚合迁移)。这套组合每一层都在为"插件化"这个论文主轴服务,且每一层你都有实战经验,没有盲区。

唯一要提醒的取舍:选 Cordis 意味着你放弃了 NestJS 的"简历通用性"(招聘市场认 Nest 不认 Cordis)。但毕设的目标是论文质量和答辩表现,不是简历关键词——而且你简历上已经有 NestJS 项目了,不缺这一个。

<details>
<summary>Thinking</summary>

> I'm noticing they're comparing three options for their backend, but oRPC is actually an RPC layer rather than a dependency injection framework like Cordis or NestJS, so those aren't directly comparable choices. Looking at their background, they've worked with oRPC + Hono + Drizzle in Qualy, and their thesis used NestJS + PostgreSQL + Drizzle, while they currently maintain Hydro which is built on Cordis.
>
> Given that plugin architecture seems central to what they're building, Cordis would be the strongest architectural fit, though NestJS is the safer, more mainstream choice. oRPC can complement either approach. PostgreSQL is the better database choice over MongoDB for their use case.
>
> I should give them a ranked recommendation with clear reasoning for each option.

</details>

## [2026-07-22 22:24] Hangqi Guo

你推荐使用Cordis还是nestjs还是orpc v2？cordis本身就是以插件为基本单位，nestjs是主流依赖注入框架，orpc可以提供前后端类型严格。你推荐使用postgres还是mongodb，postgres事务友好AI友好，mongodb天然适配cordis无需跑迁移？请帮我排序并给出依据。推荐联网搜索相关信息。

## [2026-07-22 22:25] Claude

先搜一下 oRPC v2 和 cordis 的现状再回答。

先澄清一个前提：这三者其实不完全是同一层的竞品——**cordis 是插件运行时/DI 元框架，NestJS 是 Web 应用框架，oRPC 是 API 契约层**。oRPC 官方甚至支持与 NestJS 集成。所以真正的选择是"以谁为骨架 + 是否叠加 oRPC"。搜索到的现状：oRPC v2 目前处于 beta 阶段（v2.0.0-beta.x），cordis 最新版本为 4.0.0-rc.4，npm 上仅 31 个项目依赖。

**框架排序**

**第 1：cordis 为骨架 + oRPC v1（稳定版）做 API 层**

理由：你的毕设核心论点是"插件化架构"，cordis 的插件即一等公民、`inject` 依赖声明、服务生命周期，这些直接就是你论文第三章的内容——用 NestJS 的话你得自己在 dynamic module 上搭一层插件语义，等于重新发明 cordis 的一部分。你维护过 Hydro 和 Koishi，学习成本为零，这个优势别人没有。风险也要直说：cordis 生态小、文档少、4.0 还在 rc，答辩老师没听过它——但这反而好答："主流框架的模块系统不满足运行时插件语义，因此选用插件优先的元框架"，这是一个有辨识度的技术选型论证。API 层用 oRPC 保住你已有的 Qualy contract-first 经验和端到端类型安全。

**第 2：NestJS + oRPC**

如果你担心 cordis 的小众风险，这是保守解。NestJS 的 DynamicModule + 自定义插件加载器也能做出插件化（你综测系统现有代码就在 NestJS 上，迁移成本最低），论文里"基于 NestJS 动态模块的插件机制设计"也成立，只是插件语义要自己造，技术叙事不如 cordis 纯粹——插件化变成了"我在 NestJS 上实现的一个特性"而非"架构基础"。

**第 3：纯 oRPC v2 做全栈骨架**

不推荐作为骨架。v2 还在 beta，毕设周期内押注 beta 版本 API 变动风险高；且 oRPC 只管 API 类型层，插件化、DI 都要另找，它注定只能当配菜。用 v1 即可，v1 已是稳定生产版本，带完整 OpenAPI 集成。

**数据库：PostgreSQL，明确不选 MongoDB**

你说"MongoDB 天然适配 cordis 无需跑迁移"——这个理由要拆穿一下：无 schema 迁移的代价是 schema 约束转移到应用层，你那些强关系数据(学生-成绩-课程-审核链-计分结果)在 Mongo 里要么冗余要么手动 join。而你系统里恰恰全是关系型场景：

- **成绩库**的"主修首考非公选"过滤是典型关系查询，SQL 一句话，Mongo 聚合管道写着难受
- **审核链、多级审批**需要事务保证状态一致性，PG 事务成熟
- **计分结果落库 + 失效重算**需要外键关联和约束
- 你的 Drizzle 积累、上次讨论的"插件携带 schema、构建期聚合迁移"方案全在 PG 上成立——迁移问题我们已经解决了，不构成选 Mongo 的理由
- 题型配置那种灵活 JSON 用 PG 的 **jsonb** 列就够了，等于关系 + 文档双能力

Koishi 用 minato 适配多数据库是因为它要跑在用户各种环境里，你的系统是自部署单一环境，不需要那种抽象。

**最终推荐栈**：cordis(插件骨架) + oRPC v1(契约层) + Drizzle + PostgreSQL + Bun/pnpm workspaces——除了骨架从 NestJS 换成 cordis，其余全是你 Qualy 项目验证过的组合。如果开题后发现 cordis 集成 oRPC 的胶水成本超预期，退回方案 2 也不伤筋动骨,因为 contract 层和数据层不用动。

<details>
<summary>Thinking</summary>

> I should look up the current status of oRPC v2 and check on cordis as well.
>
> I've got what I need now. oRPC v2 is in public beta as of mid-2026, and Cordis is at 4.0.0-rc.4. These tools aren't mutually exclusive—Cordis is a plugin framework, NestJS is a dependency injection web framework, and oRPC handles the RPC layer, with oRPC even supporting NestJS integration. I'll provide a ranking with reasoning and include a database recommendation.

</details>

## [2026-07-22 22:29] Hangqi Guo

整个系统的流程应该是怎么样的？我这个项目应该是会接着Qualy已经实现的组织架构管理的基础上去改造（保留Service和Schema部分改成几个Cordis插件），然后管理员应该是怎么创建题型、创建填报批次什么的。主要是我现在分不清，究竟是什么应该写成插件，什么应该是后台的可配置项，算分公式究竟应该是作为插件的代码，还是应该作为后台配置项。

## [2026-07-22 22:30] Claude

这是整个架构里最容易缠住的一个问题，我给你一个判定原则，然后把完整流程走一遍。

**判定原则：变更频率 × 变更者身份**

- **程序员在部署期改的东西 → 插件（代码）**。特征：包含行为逻辑、需要类型检查、改错了会崩。
- **管理员在运行期改的东西 → 配置（数据库）**。特征：描述性数据、每学期/每年都在变、改错了只影响业务结果。
- **算分公式是特例，它是"存储在配置里的代码"**——内容上是行为，管理上是配置。它以字符串形式存在题型配置里、在沙箱中执行，正因为它被配置化了，管理员（借助 AI）才能不发版就上线新题型。这就是它既不属于纯插件也不属于纯配置的原因：**载体是配置，执行归插件（沙箱执行器）管**。

按这个原则切你的系统：

**插件层（代码，cordis 插件包）**

- 核心域插件：组织架构（Qualy 迁移过来）、用户认证、审批流引擎（Qualy 的 service/schema 改造）
- 范式插件：申报审核范式、导入计算范式、互评范式、固定分范式——每个范式定义"这类题的生命周期"：怎么渲染、什么时候触发计分、走不走审核
- 能力插件：沙箱计分执行器（isolated-vm/QuickJS）、成绩库服务、AI 服务（多模态识别、函数生成、审批建议）、文件存储
- 服务间用 `inject` 声明依赖：学业范式依赖成绩库，申报范式依赖审批流和文件存储

**配置层（数据库，管理员后台操作）**

- 题型定义：名称、所属范式、表单字段 schema、**计分函数源码**、审核链定义、分值上限
- 批次：哪个学期、包含哪些题型、时间窗口
- 业务数据字典：竞赛名单、证书列表、活动名录（每年变的东西）
- 审核链的节点与角色绑定（团支书→辅导员→学院）

**完整业务流程**

1. **系统部署**（程序员，一次性）：选装 cordis 插件组合，构建期聚合各插件 schema 跑 Drizzle 迁移，启动。
2. **组织初始化**（管理员）：在 Qualy 迁移来的组织模块里建学院/班级/角色，导入学生。
3. **创建题型**（管理员，每年少量增改）：后台点"新建题型"→ 选范式（如"申报审核型"）→ 两条路：手动配置字段和规则，或**把章程文本/PDF 扔给 AI**，AI 产出字段 schema + 计分函数 + 测试用例，管理员在界面上核对"输入 X 应得 Y 分"的用例表后发布。计分函数入库，处于版本化状态。
4. **创建批次**（管理员，每学期一次）：选学期 → 勾选本批次启用的题型 → 设置填报窗口和审核截止 → 发布。批次是题型的实例化容器，同一题型在不同学期可以配不同参数（分值、名单）。
5. **学生填报**（填报窗口内）：登录看到本批次题型列表。申报类题型填表传证明，提交前 AI 预检提示材料问题；固定分和导入计算类无需操作。
6. **审核**（各级审核人）：按题型配置的审核链流转。审核界面里 AI 已经跑完多模态识别（证书上的奖项/日期 vs 申报内容），草拟了审批意见，审核人确认或改判。驳回可退回补材料。
7. **计分**（系统）：申报类审核通过即触发该题沙箱计分；导入计算类在管理员导入成绩后批量触发；互评类在窗口关闭后聚合触发。结果落库，带计分函数版本号。
8. **公示与复核**：学生查看总分和 AI 生成的分数解释（计分函数执行轨迹转自然语言），有异议走复核流程，改判后自动失效重算。
9. **统计导出**：排名、报表。

**用你清单里的例子验证一下切分**："竞赛加分"里，"申报审核范式"是插件、"竞赛加分"这道题是配置、每年更新的竞赛名单是配置里的数据字典、"国一 10 分省二 3 分"的规则是配置里存的沙箱函数。管理员全年的操作都不碰代码——这句话就是你答辩时论证插件化价值的核心句。

从 Qualy 迁移的具体建议：组织架构和审批流的 service/repo/schema 基本原样搬进两个 cordis 插件，把 NestJS 的构造器注入改成 `ctx.inject` 声明；oRPC contract 包保持独立不依赖 Drizzle 的约定继续沿用。先把这两个域插件跑通，再写第一个范式插件（申报审核型，覆盖你 80% 的题型），最小闭环就成立了。

<details>
<summary>Thinking</summary>

> I need to clarify the architecture here—specifically how plugins and configuration differ, where scoring functions fit into the system, and how everything flows together from a business perspective. Let me think through a layered model that shows this clearly.

</details>

## [2026-07-22 22:30] Hangqi Guo

整个系统的流程应该是怎么样的？我这个项目应该是会接着Qualy已经实现的组织架构管理的基础上去改造（保留Service和Schema部分改成几个Cordis插件，目前只做了多租户的登录注册和树状组织架构管理以及RBAC的基础），然后管理员应该是怎么创建题型、创建填报批次什么的。主要是我现在分不清，究竟是什么应该写成插件，什么应该是后台的可配置项，算分公式究竟应该是作为插件的代码，还是应该作为后台配置项。

## [2026-07-22 22:35] Claude

这个问题问到了插件化设计最容易糊掉的地方。先给判定标准，再给全流程。

**判定标准：看"谁在什么时候改它"，不看"它是不是代码"**

- 程序员改、发版生效、影响所有题型 → **代码插件**
- 管理员改、后台保存即生效、只影响某个题型或某次测评 → **配置项**

用这把尺子量，计分公式的归属立刻清晰：它**形式上是代码，生命周期上是配置**——章程每年微调，管理员（借助 AI）就要能改公式，不可能每年为此发版。所以答案是：**计分函数作为配置存在数据库里（字符串），沙箱执行器作为能力插件负责跑它**。这正是你自己最早提的 PAC 类比：浏览器内置 PAC 引擎（代码，随浏览器发版），PAC 脚本（配置，用户随时换）。插件提供的是**契约**——函数签名、context 的形状、超时和内存限制；配置提供的是**实例**。

按这个标准，整个系统分成两层加一条流程线：

各阶段展开说：创建批次时绑定某个测评方案、设时间窗、用组织树圈定目标人群（org 子树，你 Qualy 的 ltree 结构直接用上）。填报阶段学生提交材料，AI 预检在提交时跑（完整性 + 风险项提示）；同期管理员导入成绩，导入计算型题目由成绩库服务过滤取数、沙箱函数出分，不走审核。互评窗口独立开关，关窗时才触发聚合计分。审核阶段是工作台形态：审核任务按审核链推进，AI 多模态提取和建议稿挂在每个任务旁，人点通过/驳回。结算是批次关闭后的一次性动作——逐人跑分类封顶和权重聚合，进入公示与申诉期，期满归档冻结，总分不再变动。

最后给一张边界速查，把你最容易犹豫的几个东西逐一归位：

- 计分公式 → 配置（沙箱函数字符串，AI 生成、管理员确认、带版本号存库；发布过的批次引用旧版本，保证历史可复算）
- 审核链定义 → 配置（节点顺序 + 角色引用，管理员画）；审核链的推进引擎 → 代码（基座或能力插件）
- 表单字段 → 配置（JSON schema）；表单渲染器 → 代码（前端動態表单 + 少数重题型的注册组件）
- 互评的去极值/平均聚合 → 代码（范式行为语义），但去几个极值、权重多少 → 暴露为该题型的配置参数
- 分类封顶与权重 → 方案级配置；执行它的结算引擎 → 代码
- 竞赛名单、证书表 → 数据字典配置，表单字段以数据源方式引用
- "1 项 0.5 / 2 项 0.8 / 3 项封顶 1 分"这类阶梯 → 写在计分函数里（配置），不要为它发明配置 DSL——函数就是最好的 DSL，这正是你选沙箱函数方案的意义

判断时如果还犹豫，就问一句："章程明年微调时，这个东西要不要跟着改？"要改的进配置层，不改的留代码层。按这个流程，你的开题报告里"系统总体设计"一章的骨架其实已经出来了。

<details>
<summary>Thinking</summary>

> The user is asking about system architecture—specifically how to structure plugins versus backend configuration and where scoring logic should live. This is a design question that would benefit from a visual diagram to show the overall flow, so I should consider using a flowchart to illustrate the architecture clearly.
>
> The key insight is that the placement of components depends on their rate of change: code plugins handle things that evolve with development cycles (paradigms, capabilities, services), while database configuration stores things that admins adjust seasonally (question types, batches, review chains, scoring functions). Scoring functions are particularly interesting because they're code-like in form but behave as configuration in practice—admins create new rules each year without redeploying, so they should live in the database as versioned strings executed in a sandbox. The plugin provides the execution engine and function contract; the function itself is data, similar to how a browser ships the PAC engine but the PAC script is user configuration.
>
> The full lifecycle starts with system assembly at deployment time, where cordis plugins define the paradigms and capabilities, then flows into annual admin setup where evaluation schemes are created with their question types, scoring functions, and review chains, followed by batch creation where admins select a scheme and define the time window and target scope.
>
> Then during the batch execution phase, students submit declarations with evidence while AI pre-checks validate submissions, admins import grades that trigger auto-computation, peer review windows open and close, reviewers process queues with AI assistance for suggestions and multimodal extraction, and finally the batch closes with score aggregation applying category caps and weights before publication and appeals periods, ending with archival where scores freeze and exports generate.
>
> The core entities are Scheme (the overall evaluation container), QuestionType/Indicator (the specific question paradigm with its config), Batch (the time-bound instantiation of a scheme for a population), and Submission (the student's declaration record).
>
> For plugins, there are paradigm plugins like declaration-review, import-compute, peer-review, checkin, and fixed-score that each provide form rendering contracts and lifecycle hooks for submission, review pass, and batch close events plus aggregation logic. Then capability plugins handle the sandbox execution environment, AI assistance with multimodal extraction and draft suggestions, the gradebook domain service, notifications, and file storage.
>
> The key insight on scoring functions is that they're technically code but functionally configuration — the real question is who changes them and when. Since administrators update scoring rules annually while the paradigm itself stays stable, storing the scoring function as a sandboxed string in the database makes it configuration that can be updated without redeploying the plugin. The sandbox executor remains the actual code plugin that interprets these stored functions.
>
> Now I'm thinking through the distinction between paradigm-level aggregation logic versus per-question formulas. The timing of when to score — whether on approval or batch close — is architectural and belongs in code, but the specific scoring rules for individual questions are admin-managed configuration. This gives me a clearer rule of thumb: changes requiring developers that affect all question types go in the plugin, while changes administrators can make that only affect specific questions or batches stay in configuration. Custom UI components for special question types blur this line depending on whether they're paradigm-specific or registered separately.
>
> For the Qualy refactor, I'm envisioning the auth, org, and RBAC services becoming foundational cordis plugins that expose services through the context — so paradigm plugins can inject and use ctx.auth, ctx.org, and ctx.rbac. The four-layer architecture (errors, repo, service, router) can live within each plugin. I should create an architecture diagram to show how these two layers interact and the overall flow.
>
> I'm thinking about whether to use a flowchart or a more comprehensive HTML widget. Given the complexity — admin setup, batch lifecycle, the code plugin layer (base/paradigm/capability), and the config layer (solution → question type → batch → dictionary) — a single diagram combining the layering on the left and right columns with a timeline of the batch lifecycle at the bottom would be clearer. Let me call read_me with the diagram module first, then build the visualization.
>
> For the text answer itself, I should establish the core principle upfront: the distinction between code plugins and config items hinges on who changes it and when, not on whether it's written as code. Programmers modifying it at release time affecting all question types means it's a code plugin; admins changing it in the backend for specific question types or evaluations means it's a config item. Scoring formulas are interesting — they're code in form but config in lifecycle, so they live in the config layer and get executed by the capability plugin's sandbox engine. I'll use the PAC analogy the user mentioned to illustrate this concept.
>
> Then I need to walk through the three-layer plugin architecture plus the config entity layer, explain how Qualy gets restructured, and map out the complete workflow across three phases: assembly (developers selecting plugins via package.json, schema aggregation, migration, deployment), construction (admins each academic year setting up evaluation schemes with categories and weights, then building question types under those schemes), and batch execution phases. I'll include a diagram to visualize this.
>
> For the batch phase specifically, I'm detailing the full lifecycle: creating batches tied to schemes with time windows and target populations, student submissions with AI pre-checks and admin score imports, review workbenches where AI extracts multimodal data and suggests decisions before human arbitration, and finally batch settlement with score aggregation, capping, weighting, public announcement, appeals, and archival. The entity chain flows from scheme → question type (referencing templates) → batch.
>
> Now I'm mapping out the instantiation flow: scheme instance → submission records → review tasks → score records → final totals. I'm also identifying the paradigm hooks that trigger at key moments like submission, approval, and batch settlement. There's an important distinction between configuration and plugin logic—review chains are pure configuration with node and role references, capping rules like social practice scoring are calculation logic within configuration, category capping and weighting sit at the scheme level and execute through a settlement engine, while aggregation methods for peer review like outlier removal are template code since they're part of the interaction pattern.
>
> For the Qualy refactor, I'm breaking down the existing auth, org, and RBAC services into separate plugin packages that each export their Drizzle schemas for build-time aggregation and register their services with Cordis. The four-layer structure stays internal to each plugin, and I'm deciding whether to keep contracts centralized or distribute them as plugin-specific contract fragments that get aggregated—leaning toward the latter so plugins are self-contained. I need to maintain the convention that the contracts package stays free of Drizzle dependencies.
>
> Now I'm sketching out a diagram showing the three-tier architecture: the code plugin layer with base plugins for auth/org/RBAC, pattern plugins for assessment workflows, and capability plugins for execution and storage; the configuration layer mapping assessment schemes to question types with form schemas and scoring functions; and the batch lifecycle at the bottom, with arrows showing how pattern definitions extend through question type implementations and how scoring functions feed into the sandbox executor.
>
> I need to call the visualization function first with the diagram module, then build an HTML widget since a single SVG would be too cramped. The flow diagram directly answers the system architecture question, so it's worth doing.
>
> I'll structure the response to weave together the intro, decision criteria, the diagram, detailed flow breakdown, and edge cases. Let me make the tool calls now and build out the widget with proper styling.
>
> I'm planning two diagrams to show the architecture: first a structural diagram with the code plugin layer on the left and configuration layer on the right connected by arrows, then a separate flowchart showing the batch lifecycle. I'll keep each simple and add prose descriptions between them.
>
> For the structural diagram, I'm laying out two side-by-side containers with the left showing three plugin types (foundation, paradigm, capability) and the right showing four configuration elements (assessment plan, question type instances, submission batches, data dictionary), with arrows indicating how the paradigm plugins extend into question type configuration and how the sandbox executor connects to scoring functions. I'm working out the arrow connections between the two containers—one from the pattern plugin box to the type instance box to show how definitions extend, and another in reverse from the scoring function to the sandbox. The left container's right edge sits at x=320, so the arrows will span across the gap cleanly. The boxes on each side are at different vertical positions, so arrows between them would be diagonal. I could use straight lines with markers to handle that, but I need to be careful about crossing arrows — maybe just draw one direction of flow: 范式 pointing to 题型 to show the extension point definition, and 计分函数 pointing back to 沙箱执 for the scoring logic.
>
> Now I'm calculating the exact container heights and box positions. The left side has three boxes (基座, 范式, 能力) centered at y=118, 190, 262, which fits in a container of height 270. The right side has four boxes with centers at 118, 190, 262, 334, needing a container height of 340 to accommodate them with proper padding.
>
> For the arrows connecting these elements, I'm drawing a horizontal line from 范式 to 题型 at y=190 since they share the same vertical center, crossing the container borders at the edges. Then I need a diagonal arrow from 计分函数 down to 能力插件.
>
> 沙箱执行 — starting around y=210 to avoid overlapping with the horizontal arrow. This captures both the pattern extension relationship and the scoring function execution flow without visual clutter.
>
> For the labels, the gap is too narrow to fit text directly, so I'll explain the arrow meanings in the accompanying prose instead. On the legend front, I'm skipping it since the container titles already make clear which elements are code-based versus configuration-based — purple for programmer-deployed code, teal for backend configuration. The container titles themselves will carry that distinction, so a separate legend would be redundant. For the text sizing, the container title "代码插件层 · 程序员发版生效" fits within the 260px width at standard CJK font sizing.
>
> Now checking the inner box text widths — the subtitles like "认证 · 组织 · RBAC" and "申报审核 · 导入计算 · 互评" all fit comfortably within their allocated space at 12px font size.
>
> For the batch lifecycle flowchart, I have seven steps which is too many for a single horizontal row, so I'm considering a two-row layout with four boxes on top and three below, connected by arrows, keeping each box around 140px wide. I'm refining the box dimensions and layout—keeping titles single-line at 44px height for simplicity, with Row 1 positioned at y=40 and Row 2 at y=150. The connector path will run from the last box in Row 1 down and across to the first box in Row 2.
>
> Now I'm adjusting the horizontal spacing: with boxes at x=50, 200, 350, 500 and width 120px each, the layout fits within the 640px width constraint, leaving 30px gaps between boxes for the connecting arrows.
>
> For the visual design, I'm considering coloring the steps that involve AI assistance—specifically the form submission/pre-check and review decision stages—in teal, with a legend indicating which steps have AI support. The titles for each step are short enough to fit comfortably within the box widths, and I'm placing the legend near the bottom of the diagram.
>
> Now I'm moving into the prose section, which will cover the judgment criteria, then present two diagrams—one showing the two-layer structure with quality improvement points, and another focusing on the batch period workflow. I'll also include a quick reference guide for edge cases that clarifies where different configuration decisions are made across the system.
>
> Writing SVG diagram... Writing SVG arrows... Now I'm setting up the second diagram as a flowchart with teal boxes representing the stages where the AI model participates, adding a legend to clarify this. I'm drawing connector paths between the rows—a vertical line from the top box down to the second row, then horizontal connectors between boxes in the first row with proper spacing and arrow markers at the endpoints. Using dominant-baseline central for the legend text at y=232, and setting the overall height to 270. I'm styling the teal boxes for 填报预检 and 审核裁决 distinctly, while keeping other boxes neutral with a gray class. After the diagram, I need to add prose sections covering the 建设期 details and the boundary list, plus explain how the Qualy transformation maps services and schemas to base plugins while preserving the four-layer structure within them. For the admin workflow question, I'm describing the concrete backend wizard process: selecting a paradigm, feeding the charter text to AI to generate the form schema, scoring function, and test cases, then handing it to the admin.
>
> After sample verification, the admin configures the review chain by referencing RBAC roles and publishes the solution, while batch creation involves selecting the solution, setting the time window, circling people within the org subtree, and opening it.
>
> I need to walk through the two arrows and explain the Qualy mapping, then cover the admin flow and batch lifecycle diagram, and finally list out the boundary cases.
>
> 我梳理了系统架构：实线箭头表示范式定义扩展点，虚线箭头表示计分函数（配置侧的字符串）由代码侧的沙箱执行器运行；Qualy 现有模块（登录、组织、RBAC）拆成三个基座插件注入依赖，每个插件内部保留原有四层结构，oRPC 契约按插件分片聚合。接下来我会详细说明装配期、建设期、批次期三个阶段的完整流程。
>
> I should walk through each stage with clear explanations and include a quick reference for edge cases, keeping it conversational without heavy formatting.

</details>

## [2026-07-22 22:48] Hangqi Guo

每个范式有很多的配置项。每种题型前端需要展示和提交的值不同，这些值应该怎么配置，使用React Hook Form或其他更好的方式（你可以上网搜索），如何在前端进行展示和检查，后端如何存储（jsonb?）？根据不同的填写项，计分函数传入的参数应该也是不同类型的，能否让计分函数类型严格，可以在保存前进行检查和测试，甚至允许在前端接入LSP进行动态类型检查？

## [2026-07-22 22:50] Claude

这个问题值得先搜一下现在动态表单和浏览器内 TS 类型检查的最新方案，再给你完整设计。

再搜一下浏览器内 TypeScript 类型检查和 Monaco 的方案：

搜完了，方案可以定下来。核心设计一句话：**字段配置是唯一事实源，从它派生三样东西——Zod 校验、前端渲染、计分函数的 TS 类型声明**。你问的三个问题（前端怎么展示检查、后端怎么存、函数怎么类型严格）全部由这一份配置派生解决。

**一、表单方案：自定义字段配置 + RHF + Zod，不用 RJSF/JSON Forms**

现成的 schema 驱动表单库主要是 RJSF、JSON Forms、Uniforms、Form.io 这几家，它们都能从 JSON Schema 声明式生成表单，但我不推荐你用，原因有三：它们绑定 JSON Schema 这个表达力有限又啰嗦的格式；深度定制样式和交互很痛（你有约 30 种题型，定制是常态不是例外）；而且你的校验栈是 Zod，引入 JSON Schema 等于养两套校验语言。这篇对比文章最后推崇的"registry 模式"——schema 数据层 + 组件注册表 + 渲染器分离——正是你该自己做的，而且和上一轮说的"前端组件注册表按 `renderer` 字段查表"是同一个东西。

具体结构：字段配置是你自己定义的 `FieldConfig[]`（类型如 text/number/select/date/file/repeat-group 等，带 label、校验规则、数据源引用如"竞赛名单字典"）。前端一个 `DynamicForm` 组件遍历配置，从注册表取组件，用 React Hook Form 管状态（`useFieldArray` 正好处理"社会实践可提交多项材料"这种重复组），校验不用 RHF 自带规则，而是**由字段配置动态生成 Zod schema**，通过 `zodResolver` 接入。关键收益：同一个"配置 → Zod"派生函数在后端提交接口里再跑一次，前后端校验天然一致，永不漂移。

**二、后端存储：jsonb，但要点在版本化**

三个地方用 jsonb：题型表存 `fieldConfig`（用 Drizzle 的 `.$type<FieldConfig[]>()` 拿到编译期类型）、存 `scoringFn`（TS 源码 + 编译后 JS 两个字段）、提交表存 `answers`。写入 `answers` 前必须先过派生 Zod 校验，jsonb 里只放已验证数据；文件不进 jsonb，附件表存文件元数据，answers 里只放引用 ID。需要按答案内容查询再加 GIN 索引，初期不用。

真正重要的是版本：题型配置每次修改产生新版本号，**提交记录和计分函数都钉死在某个配置版本上**。否则管理员改了字段，历史提交的 answers 和新配置对不上，重算历史分数就崩了。

**三、计分函数的类型严格化——这是你系统最出彩的一环**

完全可行，而且不需要真的架 LSP 服务器。链路是这样的：

第一步，从字段配置**生成 .d.ts**。写一个 `fieldConfigToDts()`，映射规则大致是 number 字段 → `number`，date → `string`（ISO），file → `FileMeta`，repeat-group → 数组，而 select 字段生成**字面量联合类型**——比如竞赛等级字段配置了国家级/省级/校级三个选项，生成的就是 `level: "national" | "provincial" | "school"`，计分函数里 switch 漏写或拼错分支，编辑器当场红线。这是动态类型生成最值钱的地方：

```ts
// 由"专业竞赛"题型的字段配置自动生成
interface Answer {
  competitionId: string; // 来自字典数据源
  level: "national" | "provincial" | "school";
  award: "first" | "second" | "third";
  isTeam: boolean;
}
declare function score(answer: Answer, ctx: ScoringContext): ScoreResult;
```

第二步，前端编辑器用 Monaco。Monaco 内置完整的 TypeScript 语言服务（跑在 web worker 里），通过 `monaco.languages.typescript.typescriptDefaults.addExtraLib()` 注入 .d.ts 后就能获得补全和类型检查——管理员打开某题型的函数编辑器时，你把这个题型刚生成的 .d.ts 注入进去，补全、悬停提示、实时红线全有，体验就是 VS Code。你问的"接入 LSP"其实不必：真正的外置 LSP 方案是本地起 typescript-language-server、通过 WebSocket 接 monaco-languageclient，它解决的是 Monaco 内置 worker 只能理解单文件、无法跨文件分析的局限——而你的计分函数**恰好就是单文件纯函数**，内置 worker 刚好够用，省掉一整个服务端组件。

第三步，保存时后端**复检**（前端检查可被绕过，不可信）。用 `@typescript/vfs` 在内存虚拟文件系统里跑真正的 TypeScript 编译器：函数源码 + 同一份生成的 .d.ts + lib.d.ts 组成虚拟项目，`getSemanticDiagnostics()` 有错就拒绝保存。通过后用 `ts.transpileModule` 或 esbuild 转成 JS 存库，沙箱只执行编译产物。

第四步，类型检查之外还要**跑测试**才允许发布：AI 生成函数时同时生成测试用例（管理员可补充），保存时在沙箱里全部跑一遍金样例；再附加几条属性检查——输出分数落在 0 到该题满分之间、同一输入跑两次结果一致（确定性）、限时限内存不超。类型 + 样例 + 属性三道关，这一节写进论文就是"AI 生成代码的可信性保障"。

最后一个必须处理的联动：**字段配置一改，类型就变了**——管理员给竞赛题型加了个选项，旧计分函数可能瞬间类型不匹配。所以配置保存时要对该题型的现存函数重跑第三步的类型检查，不过的标记为"待修复"并禁止用于新批次。配置版本、类型声明、函数版本三者绑定的一致性机制，本身又是论文一小节。

整条链路总结：一份 `FieldConfig` → Zod（前后端运行时校验）→ RHF 渲染（注册表组件）→ .d.ts（Monaco 编辑体验 + vfs 保存门禁）→ 沙箱（执行编译产物）。每一环都是现成成熟技术，组合起来却是一个有辨识度的设计，答辩时从"管理员建题型"演示到"改个选项旧函数飘红"，效果会非常好。

<details>
<summary>Thinking</summary>

> The user is asking about two main challenges: how to dynamically configure form fields based on question type using React Hook Form or similar, including frontend rendering/validation and backend storage (possibly with JSONB), and whether we can add type safety to scoring functions that vary by question type, including validation and testing before saving. They're suggesting I search for current solutions, so I'm looking into JSON schema form libraries and related tools.
>
> I'm thinking through a design approach: store field definitions as JSON in a JSONB column with a custom field DSL rather than raw JSON Schema, then derive both the runtime Zod schema on the backend for validation and the frontend form configuration from that same source. I'll also search for how to use Monaco editor with TypeScript intellisense for the scoring function editor, leveraging addExtraLib to provide type hints for custom types, and potentially sandbox type-checking with the TypeScript compiler API.
>
> For storage, I'd use JSONB columns for the form schema and submissions, with Drizzle's type system to keep everything typed end-to-end. I'll add versioning through a question_type_version table so submissions can reference the exact schema they were validated against. The scoring function needs a clear signature that takes the answer and context, then returns a score result.
>
> Now for the tricky part — the answer type itself should be derived from the form schema, so I'm generating TypeScript definitions from the field config. The key insight is using Monaco Editor with its built-in TypeScript language service; I can inject the generated type definitions via addExtraLib, which gives full IntelliSense and type checking right in the browser without needing a separate LSP server. Monaco's web worker already has the full TypeScript compiler, so that's the answer to integrating language support — no external LSP protocol needed.
>
> On the backend, I'm running the TypeScript compiler API in-memory against the same generated definitions to catch type errors at save time, then transpiling to JavaScript with esbuild before storing both versions and executing the JS in a sandbox. For validation, I'm generating test cases that run in the sandbox, checking score bounds and determinism, plus using Zod schemas at runtime to validate answers and results. The whole chain stays type-safe from field config through to execution — the config generates both the Zod schema for runtime validation and the .d.ts for compile-time checking.
>
> I like framing this as configuration-driven dual-type generation. Let me check what's available in the current library ecosystem and how Monaco handles this.
>
> I should look into how Monaco Editor handles TypeScript checking in the browser, specifically the addExtraLib method for adding type definitions.
>
> I'm considering @typescript/vfs for in-memory type checking on the backend during saves — it lets me run the TypeScript compiler without hitting the filesystem, which is how the TS playground handles this. Now I'll structure the answer around a single source of truth: the field configuration stored as JSONB that derives the Zod runtime schema, frontend validation, and backend type checking.
>
> For the frontend form, I'm using React Hook Form with Zod resolver and a component registry that maps field types to shadcn-style components — this beats RJSF because I already have custom components and thirty question types, plus the registry pattern gives me better control over styling and behavior. The key is sharing the Zod schema between frontend and backend validation.
>
> On the backend, I'm storing field configs and submission answers as JSONB columns via Drizzle with type safety, validating answers against the derived Zod schema before insert, and handling attachments in a separate table with fileId references. For scoring functions, I'm generating .d.ts type declarations from the field config — mapping field types to TypeScript types like literal unions for select options, which prevents typos in switch statements. The frontend Monaco editor runs the full TypeScript language service in a web worker, injecting the generated .d.ts via addExtraLib to give real-time autocomplete and error checking.
>
> On save, the backend double-checks the scoring function using @typescript/vfs to run tsc in memory against the same .d.ts, then transpiles to JavaScript with esbuild and stores both the source and compiled output alongside a config version hash. For testing, I'm generating test cases with AI and letting admins add more, running them in a sandbox, and validating properties like score boundaries, determinism across runs, and timeout/memory limits.
>
> At runtime, I still need Zod to validate both inputs and outputs since type checking can't catch runtime value issues inside the sandbox. When field configuration changes, the types shift and existing scoring functions need re-validation — binding the config version to the function version ensures this consistency.

</details>

## [2026-07-22 23:00] Hangqi Guo

大模型这方面，你帮我选择一下都需要什么技术栈呗，然后我专攻去学习，LangChain, LangGraph. DeepAgents, Vercel AI SDK, Nest, Redis, PostgreSQL, Redis, ElasticSearch, Neo4j, MinIO, Docker Compose, Mem0、LangSmith、LangFuse 及还有我没提到的种种技术栈，你认为本项目应该应用哪些，尤其是对于题型生成、预审、助审、用户端分数构成解释、章程问答等，为了达到更好的效果，你帮我规划下，并给出每个技术在本项目内的用处。

## [2026-07-22 23:01] Claude

你列的清单里大概一半该用、一半该砍。先给结论清单，再逐个功能映射，最后是砍掉理由和学习顺序。

**入选的栈**

- **Vercel AI SDK**（核心 LLM 层）：取代 LangChain 作为所有 AI 调用的统一层。选它的理由正好长在你的审美上：`generateObject()` 直接吃 Zod schema 返回强类型结构化输出，和你全栈 Zod 的架构无缝；`streamText` 做流式；`tool()` 做工具调用；类型干净，没有你当初和 `StructuredToolInterface` 搏斗的那种类型泥潭。通过 openai-compatible provider 接 DashScope 的 Qwen 端点即可。你的 LangChain 知识不浪费——概念（模型/工具/结构化输出/ReAct 循环）全部平移，只是 API 更薄。
- **PostgreSQL + pgvector**：关系数据你已有，加 pgvector 扩展后向量检索也在同一个库里，章程问答的 RAG 不需要任何新存储。Drizzle 支持 vector 列类型。
- **MinIO**：证书照片、PDF 证明材料的对象存储，S3 兼容、预签名 URL 直传，多模态模型从这里取文件。必选。
- **任务队列**：AI 调用动辄几秒，绝不能阻塞 HTTP 请求——提交触发预审、审核触发多模态提取、批次结算，全走异步任务。两个选项：pg-boss（基于 PG，零新增服务，契合你一贯的简洁偏好）或 BullMQ + Redis（业界标准，文档多）。我倾向 pg-boss 起步，Redis 留到确实需要跨实例缓存/发布订阅时再进场——你清单里的 Redis 不是必需品。
- **Langfuse**（可观测 + 评估）：记录每次 AI 调用的完整 trace（prompt、输出、耗时、token 成本），还有 prompt 版本管理和评估数据集功能。选它不选 LangSmith 的理由：开源可自托管（官方 docker-compose 一键起，或直接用云端免费额度），不绑定 LangChain。它对你有个隐藏的巨大价值：**论文的"实验与评估"章节**——预审准确率、多模态提取正确率这些指标，就靠 Langfuse 的数据集 + 打分功能来做。
- **Docker Compose**：编排 postgres(+pgvector)、minio、langfuse 这几个服务，开发和部署一致。必选。
- **模型侧（DashScope/Qwen 系）**：按任务分配——计分函数生成用 qwen3-coder 或 qwen-max；多模态识别（证书/奖状/PDF）用 qwen-vl 系列；嵌入用 text-embedding 系列；分数解释、章程问答这类轻任务用 qwen-plus 控制成本。

**五个功能的具体映射**

- **题型生成**（章程 → 字段配置 + 计分函数 + 测试用例）：`generateObject` 按 FieldConfig 的 Zod schema 出配置；`generateText` 出函数源码；接上一轮设计的 vfs 类型检查——**不过就把编译诊断喂回模型重试**，这个"生成 → 检查 → 修复"循环手写一个带上限的 while 就够（约 50 行），不需要 LangGraph。这个闭环本身是论文亮点："以类型系统作为 AI 代码生成的自动验证器"。
- **预审**（用户侧）：提交时入队 → qwen-vl 读材料 + 申报内容 → `generateObject` 输出 `{完整性问题[], 风险项[]}` → 落库展示。
- **助审**（管理员侧）：同一条队列任务的加强版——多模态提取关键信息（奖项名称、级别、日期）→ 与申报字段逐项比对 → 生成建议稿 `{建议结论, 依据, 疑点}`；需要查竞赛字典或该生历史提交时用 tool calling 现查。
- **分数构成解释**：让沙箱计分函数在执行时输出轨迹日志（命中了哪个档位、各项数值），把轨迹 + 题型规则喂给模型，`streamText` 经 SSE 流式转成自然语言。最便宜的功能，体验收益最高。
- **章程问答**：按条款结构切块（不要无脑定长切）→ 嵌入进 pgvector → 检索 top-k → 回答并引用条款号。诚实说一句：章程加五个细则总共几万字，塞长上下文直接问效果可能更好——但 RAG 版本可扩展到多租户多文档、能给条款级引用，且是论文该有的一节，所以按 RAG 设计、论文里把长上下文作为对照实验，正好凑一组评估数据。

**砍掉的及理由**

LangGraph（你的流程都是单次调用或短管道，状态机手写更可调试，图编排是杀鸡用牛刀）；DeepAgents（面向开放式长任务的规划/子代理框架，与你场景完全不匹配）；NestJS（骨架已定 cordis）；ElasticSearch（pgvector 够用，ES 是纯运维负担，中文全文检索真有需要时 PG 加 pg_jieba 也比上 ES 轻）；Neo4j（没有图查询需求，别为了"知识图谱"四个字引入一整个数据库）；Mem0（没有跨会话个性化记忆的场景，你的"记忆"就是业务数据库本身）；LangSmith（被 Langfuse 替代）。

**学习顺序**（按依赖关系排）：① AI SDK 核心三件套 `generateObject` / `streamText` / `tool`，用你现有的 DashScope key 直接练；② qwen-vl 多模态调用，拿真实证书照片试提取；③ pgvector + 嵌入 + 检索，在 Drizzle 里建 vector 列跑通章程问答最小闭环;④ pg-boss 异步任务，把预审挂上队列；⑤ Langfuse 接入 trace，最后建评估数据集。每一步都产出系统里一个真实模块，学完栈也就搭完了。

<details>
<summary>Thinking</summary>

> Looking at the tech stack options for the LLM side, I need to consider what fits best for the use cases mentioned—question generation that converts charters into form schemas with scoring functions, and a pre-review stage. The user has listed quite a few tools across different layers: orchestration frameworks like LangChain and LangGraph, backend options like Nest, data stores like PostgreSQL and Redis, search capabilities with ElasticSearch, and observability tools like LangSmith and LangFuse.
>
> Given their existing stack—cordis instead of NestJS, Drizzle ORM, PostgreSQL, and Bun/pnpm—I should recommend what actually fits rather than what's trendy. They've already worked with LangChain.js against Qwen and GLM APIs, so there's existing familiarity there. The real decision is whether to stick with LangChain or switch to Vercel AI SDK. Vercel AI SDK is leaner with better TypeScript support and has structured output capabilities through Zod integration, which aligns perfectly with their Zod-everywhere approach. LangChain adds abstraction layers they probably don't need for this scope. I should weigh whether their prior experience justifies staying with LangChain or if the cleaner approach of Vercel AI SDK makes more sense for the specific features they're building.
>
> Looking at their five features—题型生成 needs structured JSON output with code generation, 预审 requires multimodal handling with risk extraction, 助审 involves multimodal document analysis with comparison logic, 分数解释 is straightforward streaming text, and 章程问答 is RAG with embeddings. None of these require complex multi-agent orchestration; a simple tool-calling loop handles 助审 just fine. Vercel AI SDK covers all of this—generateText, generateObject with Zod schemas, streamText, and tool calling—and it's provider-agnostic so it works with their DashScope/Qwen endpoints. LangGraph could handle stateful workflows for 审批 assist, but that's probably overengineering at this stage.
>
> The 题型生成 flow—parsing the charter, generating config, generating functions, generating tests, validating, and looping on repair—is really just a state machine that a while-loop with retry logic handles fine. I'd recommend skipping LangGraph entirely and writing plain async pipelines in TypeScript; they're more debuggable and the features don't justify the complexity. If they really want to show technical depth, the repair loop could be a small graph, but honestly a sequential pipeline is cleaner for what they're building.
>
> For RAG on the 章程问答 feature, I'm thinking pgvector on their existing PostgreSQL with Drizzle for vector columns and DashScope embeddings since they're already using Qwen. The key is chunking by 章程 structure—articles and clauses—rather than naive splitting. Hybrid search gets tricky with Chinese full-text search in Postgres though; the built-in tools need extra extensions like zhparser or pg_jieba, which adds friction.
>
> Actually, stepping back: for a small corpus like a charter plus a few regulations (maybe 20-50k characters total), I could just stuff the whole thing into context using Qwen's long-context models (qwen-long supports 1M tokens, qwen-max has 32k+). That's simpler and more accurate than RAG for this scale. But RAG is architecturally cleaner if the system grows to multiple tenants with many policy documents, and it's also more thesis-valuable from a research angle. So the recommendation is to design it with pgvector RAG as the foundation—it scales properly—while noting that for the current scope, context stuffing would work fine.
>
> For the rest of the stack: ElasticSearch is overkill and adds operational burden without thesis benefit; pgvector with optional jieba or trigram search handles it. Neo4j is unnecessary too—there's no graph structure to exploit here, and GraphRAG would be over-engineering. Mem0 for memory personalization can be skipped since there's no cross-conversation state to track.
>
> For observability and evaluation, I'm leaning toward Langfuse over LangSmith—it's open-source and self-hostable via Docker Compose, which is better for a thesis project. It gives me tracing, prompt management, cost tracking, and evaluation datasets, which directly supports the experimental and evaluation chapter. The key metrics to track are question generation accuracy and retrieval precision.
>
> On infrastructure: PostgreSQL with pgvector extension handles both relational and vector data in one database. Redis is needed but narrowly scoped—specifically for BullMQ to queue async AI tasks like document review and multimodal extraction, since LLM calls block otherwise. This also lets me rate-limit API calls and cache embeddings.
>
> For job queuing, I'm weighing pg-boss (Postgres-native, fewer dependencies) against BullMQ with Redis (more conventional). Since they listed Redis explicitly, I'll recommend BullMQ as the standard choice, though pg-boss is leaner if they want to minimize infrastructure.
>
> For object storage, MinIO is essential—it handles uploaded documents and certificates that the multimodal AI needs to process, with S3-compatible presigned URLs for secure access.
>
> On the observability side, I'm weighing Langfuse options: their v3 self-hosted setup requires ClickHouse, Redis, and S3, which adds operational overhead. For a thesis project, their free cloud tier or v2 self-hosted (simpler dependencies) makes more sense than the full v3 stack. I'll suggest using their official Docker Compose or just going with Langfuse Cloud.
>
> For models, I'm mapping DashScope's Qwen offerings to specific tasks: qwen-max or qwen-plus for generation, qwen-vl-max for document recognition, text-embedding-v3/v4 for embeddings, and qwen3-coder for code generation. Since DashScope exposes an OpenAI-compatible endpoint, the AI SDK's OpenAI provider works directly.
>
> Now I'm connecting features to the stack: for question generation, I'm using the AI SDK to generate structured FieldConfig objects via Zod schemas, then generating code for scoring functions with repair loops that feed back diagnostics up to N retries. The model choice depends on the task complexity—qwen3-coder for code, qwen-max for reasoning-heavy generation.
>
> For pre-review, submissions trigger a multimodal check with qwen-vl that returns structured completeness issues and risk flags. During assistant review, I extract award details from documents, compare against declared fields, and generate suggestions with reasoning and flagged discrepancies—calling tools to fetch reference data as needed. For score explanation, I trace the scoring function execution to log which branches executed, then stream the natural language interpretation back to the user via SSE. For charter Q&A, I'm using pgvector RAG with chunk-level embeddings and retrieval, citing specific clauses—or for smaller corpora, stuffing the full context into a long-context model.
>
> On tooling: I'm dropping LangChain since the Vercel AI SDK handles structured output, tool calling, and multimodal better with cleaner TypeScript types—they've struggled with LangChain's type complexity before. Cutting LangGraph too since hand-rolled pipelines work fine here. No need for DeepAgents, NestJS (cordis is already in place), ElasticSearch (pgvector covers it), Neo4j, Mem0, or LangSmith—using Langfuse instead for observability since it's self-hostable.
>
> The learning sequence focuses on AI SDK fundamentals first, then pgvector embeddings and RAG, multimodal with qwen-vl, async job handling, and finally Langfuse for tracing and evaluation. For reliability, I'm emphasizing Zod schema validation with retries and prompt versioning in Langfuse to track changes.
>
> For the thesis, I should structure this as a comprehensive architecture answer with a clear tech stack, feature-to-technology mapping, what to exclude, and the learning progression in order. A table mapping features to models and key techniques would make this scannable. I'll keep it moderate length, prose-forward with some structured elements, all in Chinese.
>
> On versions: I need to be careful here — AI SDK is somewhere around v5 or v6 by mid-2026, so I'll just reference it loosely as "AI SDK（v5+）" to avoid being wrong. Qwen's qwen3 family is solid ground (announced April 2025), with qwen3-vl and qwen3-coder variants by mid-2025, plus text-embedding-v4 for embeddings. DashScope supports OpenAI-compatible endpoints, which simplifies integration. For Langfuse self-hosting, I'll mention the official docker-compose setup or cloud free tier without diving into ClickHouse dependencies.
>
> Now I'm drafting the full answer — aiming for around 700–900 words in Chinese equivalent, keeping bullets substantive (1–2 sentences minimum), using bold selectively to match my established style in this conversation, and avoiding unnecessary bloat.

</details>

## [2026-07-22 23:02] Hangqi Guo

大模型这方面，你帮我选择一下都需要什么技术栈呗，然后我专攻去学习，LangChain, LangGraph. DeepAgents, Vercel AI SDK, Nest, Redis, PostgreSQL, Redis, ElasticSearch, Neo4j, MinIO, Docker Compose, Mem0、LangSmith、LangFuse 及还有我没提到的种种技术栈，你认为本项目应该应用哪些，尤其是对于题型生成、预审、助审、用户端分数构成解释、章程问答等，为了达到更好的效果，你帮我规划下，最好联网搜索相关知识与近期新兴技术栈，并给出每个技术在本项目内的用处。

## [2026-07-22 23:04] Claude

这个选型值得认真搜一圈再定，我分几次搜。

搜完了，可以给你一份明确的"用/不用"清单。先给三条判断原则：你的五个 AI 场景（题型生成、预审、助审、分数解释、章程问答）全部是**短流程、结构化输出**的任务，不是开放式长程 agent；你的技术底色是 Zod + TypeScript 全链路类型严格；这是毕设，每多一个自托管组件都是运维税。以下结论都由这三条推出。

**核心采用**

**Vercel AI SDK（v6）——你的 AI 调用层，取代 LangChain**。这是最重要的一个选型变更。你五个场景的本质都是"给模型输入，拿回一个符合 Zod schema 的对象"，而这正是 AI SDK 的看家能力：用 Zod 定义结构化输出，类型贯穿整个 TS 类型系统，生产团队反馈 JSON 解析错误率接近于零。注意 API 有变化：v6 已正式发布，废弃了 `generateObject()`，改用 `generateText` + `Output.json()`/`Output.object()` 模式。你之前学的 LangChain.js 不算白学（概念全通用），但工程上 AI SDK 更薄、更贴你的 Zod 栈，且没有 LangChain 那些类型体操痛点——你在 NestJS 里为 `StructuredToolInterface` 斗争过的那些问题，AI SDK 里基本不存在。

**PostgreSQL + pgvector——章程问答的 RAG 底座，不引入向量数据库**。对几万条级别的文档检索，专门跑一个向量库、一条同步管道、一套凭据和部署，是为一个最近邻查询付出的过重代价；pgvector 让文档和向量在同一张表、同一个事务里。你的章程撑死几百个条款块，量级差好几个数量级。pgvector 还能和 Postgres 全文检索配合做混合检索，也支持向量相似度叠加普通关系过滤。中文全文检索需要 zhparser/pg_jieba 扩展，毕设阶段可以先纯向量检索，效果不够再加。embedding 用 DashScope 的 text-embedding 系列，和你现有 API key 同一家。

**Qwen 系列（DashScope）——模型层不变**。文本任务（题型生成、建议稿、分数解释）用 qwen-max/qwen-plus；多模态（证书识别、材料预审）用 Qwen-VL 系列。你已有的 OpenAI 兼容接入经验直接复用，AI SDK 配 OpenAI-compatible provider 一行接入。

**Redis + BullMQ——异步任务队列，AI 功能的工程骨架**。LLM 调用动辄几秒到几十秒，绝不能在 HTTP 请求里同步等。学生提交材料 → 入队 → worker 调 VL 模型预审 → 结果落库推送，审核建议、批次结算重算同理。BullMQ 是 Node 生态标准答案，顺带解决重试、限流（DashScope 有 QPM 限制）、失败告警。另外用 Redis 按材料文件哈希缓存提取结果，同一张证书不重复花钱。

**MinIO——证明材料的对象存储**。S3 兼容，学生上传的图片/PDF 存这里，给 VL 模型时生成预签名 URL 或转 base64。比裸文件系统强在：多副本部署不用共享磁盘、生命周期管理、和你未来上云的 S3 无缝。

**Langfuse（自托管）——可观测性 + 论文实验数据来源，明确不选 LangSmith**。理由很硬：Langfuse 是 MIT 开源、自托管是一等公民部署模式；LangSmith 是闭源专有平台，后端、UI、存储层都不开源，且自托管需要企业合同，没有开源免费自托管路径。Langfuse 基于 OTel，AI SDK 有现成集成。对毕设的额外价值：它的 traces 记录每次调用的 token、延迟、成本，datasets + scores 功能直接支撑你论文第五章的实验——预审准确率、字段提取准确率这些数据从这里来，答辩演示后台调用链也很唬人。

**Docker Compose——把 Postgres、Redis、MinIO、Langfuse 一键拉起**。开发和部署环境一致，没什么可说的，必用。

**明确不采用**

- **LangChain 核心库**：AI SDK 覆盖其全部所需能力，两套抽象并存只会打架。
- **LangGraph**：可选项而非必需。你唯一有"环"的流程是计分函数的"生成→类型检查→沙箱测试→把报错喂回去修复"循环，但这是个有界重试循环，一个 for 循环 + 状态对象就能写清楚。想在论文里画状态机可以引入，工程上不装它更干净。
- **DeepAgents**：它面向长时程规划型 agent（子代理、虚拟文件系统、任务规划），你的场景全是单轮或短管线，完全用不上。
- **NestJS**：架构已定 cordis，不回头。
- **Elasticsearch**：Postgres 内向量方案的实用上限在千万级向量，你差得远；ES 的运维重量对毕设是纯负担。
- **Neo4j**：你没有图遍历查询需求，组织树用 ltree 已解决。
- **Mem0**：它解决的是"AI 助手跨会话记住用户偏好"，你的系统里所有该记住的东西本来就在业务数据库里，章程问答也不需要个性化记忆。

**五个场景的具体管线**

题型生成：管理员贴章程条文 → 先用 pgvector 召回相关条款做上下文 → `Output.object(FieldConfigSchema)` 生成表单配置 → 单独一次调用生成计分函数源码 → @typescript/vfs 类型检查 + 沙箱跑 AI 同时生成的测试用例 → 失败把诊断信息喂回去修复（限 3 轮）→ 管理员确认发布。预审：提交触发 BullMQ 任务 → VL 模型读材料 → 结构化输出完整性检查和风险项列表 → 展示给学生。助审：VL 按该题型字段的 Zod schema 提取材料关键信息 → 代码比对申报值与提取值 → 差异列表 + `streamText` 生成建议稿流式展示给审核人。分数解释：沙箱执行时记录命中的规则分支和中间值 → 连同计分函数注释喂给模型转自然语言，最便宜的一个功能。章程问答：条款切块 → embedding → pgvector 检索 →（需要的话 AI SDK 6 原生支持的 rerank 重排）→ 生成带条款引用的回答。

**学习优先级**：AI SDK 结构化输出与流式（一周内可上手）→ pgvector + embedding 检索 → BullMQ 队列模式 → Langfuse 接入与 datasets 评测 → 其余按需。这套栈里每一件都直接映射到论文的某一节，没有一个是装饰品。

<details>
<summary>Thinking</summary>

> I'm looking at the tech stack they've proposed for their thesis project—LangChain, LangGraph, and several infrastructure tools like PostgreSQL, Redis, and Docker—and they want me to research emerging alternatives too. They're building AI features around question generation and assessment, though the description cuts off mid-feature list.
>
> I need to search for current information on a few key areas: where Vercel AI SDK stands in 2026 compared to LangChain.js, the status of LangGraph and DeepAgents, and what's best for RAG in a Node/TypeScript environment. My initial thinking is leaning toward Vercel AI SDK with Qwen models via DashScope for their multimodal needs and China deployment, since they're already using Zod schemas everywhere and the SDK's structured output capabilities would fit well.
>
> For their specific workflows — the review assistance with multimodal extraction and comparison is a fixed pipeline, not an open-ended agent, so LangGraph is probably unnecessary. The score generation loop with feedback and repair is bounded, so a simple while loop handles it. DeepAgents is definitely overkill for their use case. For the charter Q&A RAG, I'd stick with pgvector on their existing PostgreSQL rather than introducing Elasticsearch or Neo4j — chunk by article, use hybrid search with pgvector and PostgreSQL's full-text search capabilities.
>
> On infrastructure: Redis makes sense for BullMQ to handle async AI tasks like review generation and batch pre-screening, plus rate limiting. MinIO for object storage to handle uploaded evidence files and pass images to the vision model — either that or local disk depending on their deployment constraints. Docker Compose ties everything together for development and deployment. For observability, self-hosted Langfuse is the better call over LangSmith since it's open source and keeps their data local rather than sending it to a SaaS provider.
>
> Skipping Mem0 since their "memory" is really just domain data in Postgres, Neo4j since the org tree uses ltree without needing graph queries, and Elasticsearch since Postgres's tsvector is sufficient for the thesis scope. For evaluation, promptfoo or Langfuse datasets would be useful for prompt regression testing and supporting the experimental chapter with accuracy metrics — promptfoo is a lightweight option worth mentioning. Zod handles structured outputs, and isolated-vm/QuickJS are already part of the stack. Need to check current versions: AI SDK 6, Langfuse v3, DeepAgents JS.
>
> AI SDK 6 just dropped with generateObject deprecated in favor of using Output.object/json through generateText, so I should look into how Langfuse self-hosted integrates with that, and maybe check out DeepAgents for JavaScript too.
>
> I'm considering a few more searches to round out my answer—pgvector versus Elasticsearch for RAG implementations would give me a solid citation, and I should verify the exact naming for Qwen's multimodal models on DashScope. I know DeepAgents is LangChain's agent framework for complex planning tasks, but that's probably overkill for what we're discussing here.
>
> Now I'm organizing the final recommendations with a verdict table structure, mapping each technology choice against the five AI features, using adoption/non-adoption decisions for the model layer, where Qwen is selected via DashScope with OpenAI compatibility, covering both text models like qwen-max and multimodal options like qwen-vl, plus embedding models from DashScope.
>
> For the application layer, Vercel AI SDK v6 serves as the core invocation framework with structured outputs via generateText and Output.object() paired with Zod validation—aligning with their existing stack—and I'm noting that ToolLoopAgent/agents are available if needed for more complex workflows. On orchestration, LangGraph.js is optional and only recommended for the question-generation pipeline's cyclic flow of generation, type-checking, testing, and repair; otherwise a bounded loop suffices, and I'm making the case against pulling in the full LangChain ecosystem since AI SDK already covers the essentials. For retrieval, pgvector on Postgres handles the constitution Q&A RAG with hybrid search possibilities using tsvector and reciprocal rank fusion, though for the thesis I can simplify with pure vector search plus keyword matching or leverage DashScope's reranking, and I'm noting that AI SDK v6 has native reranking support. Finally, Redis with BullMQ manages the asynchronous task queue for batch pre-review and audit workflows.
>
> For infrastructure, MinIO provides S3-compatible object storage for evidence materials with presigned URLs for vision-language models, Docker Compose orchestrates the full stack in one command, and Langfuse self-hosted—being MIT-licensed and OTel-native with AI SDK integration—serves as the observability layer for collecting experimental metrics like token costs, latency, and accuracy for the thesis evaluation chapter.
>
> I'm ruling out several tools: Nest since the architecture is already defined with Cordis, Elasticsearch because PostgreSQL's full-text search plus pgvector handles the requirements more simply, Neo4j since there's no graph query need and organizational hierarchies work fine with ltree or closure tables, Mem0 because the "memory" is just the business database itself without cross-session personalization requirements, LangSmith due to its closed-source nature and enterprise licensing for self-hosting, and DeepAgents since all five scenarios are short-horizon tasks rather than long-horizon planning with sub-agents.
>
> Now mapping out how each scenario uses the core stack:题型生成 uses Qwen Max with structured output validation through Zod, generating scoring functions that get tested in a sandbox with diagnostic feedback loops handled by LangGraph; 预审 runs as a BullMQ task that processes materials through a vision-language model to extract structured completeness and risk data; 助审 uses the VL model to extract fields matching the Zod schema, then compares submitted values against extracted ones to generate suggestions shown as streamed output to reviewers.
>
> For score explanation, I'm capturing the execution trace of the scoring function—inputs, rule branches hit, caps applied—and converting that to natural language via streaming for low overhead. The 章程问答 module chunks bylaws by clause, embeds them with DashScope, stores in pgvector with optional reranking, then generates cited answers; this also feeds back into题型生成 by retrieving relevant clauses during generation rather than stuffing the full text.
>
> I'll structure this with an opening summary of the three judgment lines, then a checklist format where each item gets one sentence on its purpose. I'm skipping a diagram this time since the response is already dense—keeping it to prose.
>
> Now I'm thinking through the learning path priorities: start with AI SDK, then pgvector and RAG, move into BullMQ, add Langfuse observability, and optionally LangGraph later. I need to make sure my citations are accurate—pulling from the docs on AI SDK's deprecation of generateObject, its type-safe Zod support, native reranking, Langfuse's MIT self-hosting versus LangSmith's enterprise model, and pgvector's sufficiency for hybrid search. I'll format this with bold section leads, flowing prose, and measured bullet points, all in Chinese.

</details>

## [2026-07-23 20:36] Hangqi Guo

由于Cordis框架的文档不太完整，阅读Cordis框架的相关文档，帮我理一下Cordis所提供的各种方法和功能，以及你推荐我通过怎样的层级和顺序去开发本项目（插件依赖树）。

## [2026-07-23 20:41] Claude

Cordis 的文档确实散，我来实际翻一遍它的文档和源码仓库，再给你整理。

找到了 npm 上的文档，再去它的 GitHub 仓库看最新版说明。

找到正主了（cordiverse/cordis），拉一下它的 README 看最新 API。

GitHub 主仓库的 README 几乎是空的，真正的文档在 npm 包页面上，拉全文：

npm 页面有反爬，换个路子——直接从 npm registry API 拉包的 README：

核心 API 全拿到了。再看看它的 CLI 入口和配套包（loader、hmr 这些）：

验证完毕。cordis 4 的文档虽然缺，但类型声明 + 实测足以还原全貌。以下手册基于 4.0.0-rc.7 的 d.ts 和我刚跑通的行为验证，不是从 3.x 记忆里推的。

**版本形势先说清**：npm 上 latest 标签就是 4.0.0-rc.7（3.x 最终版是 3.18.1）。你在 Hydro/Koishi 里熟悉的是 3.x 语义，4.x 把核心概念重构了：`EffectScope` 变成了 **Fiber**，`using` 变成了 `inject`，`ctx.lifecycle` 变成了 `ctx.events`。3.x 的 fork/reusable 机制在 4.x 的 d.ts 里已不见踪影（每次 `ctx.plugin()` 调用本身就产生一个独立 Fiber，Runtime 持有 fibers 列表），这点我没做完整验证，用到多实例加载时你需要自己试。毕设我建议直接上 4.x——概念更干净、Standard Schema 支持是新增的（下面会讲为什么这对你特别重要）——但要接受 rc 版 API 可能微调的风险，锁死小版本号。

**一、cordis 4 核心 API 手册**

**Context 与四个内置服务**。`new Context()` 后自带 `ctx.events`（事件）、`ctx.logger`（日志）、`ctx.reflect`（服务注册表）、`ctx.registry`（插件注册表），加上每个上下文关联的 `ctx.fiber`。三个上下文操作：`ctx.extend(meta)` 原型继承出新上下文；`ctx.isolate(name)` 服务隔离（多租户场景可用但你未必需要）；`ctx.intercept(name, config)` 对某服务在当前上下文注入配置拦截。

**插件的三种形态与元属性**。函数 `(ctx, config) => {}`、类 `new (ctx, config)`、对象 `{ apply(ctx, config) }` 都是合法插件。挂在插件上的元属性有五个：`name`（显示名）、`inject`（依赖声明，数组或带配置的对象）、`provide`（声明本插件提供哪些服务）、`intercept`、以及最关键的 **`Config`——它接受任何 Standard Schema 规范的校验器，而 Zod 4 原生实现了这个规范**。我实测确认：把 `z.object({...})` 直接赋给 `plugin.Config`，加载时自动校验、应用 `.default()` 默认值、非法配置抛 `ValidationError`。你的全 Zod 技术栈和 cordis 在这里无缝咬合，一行胶水都不用写。

```ts
function sandboxPlugin(ctx: Context, config: SandboxConfig) {
  /* ... */
}
sandboxPlugin.Config = z.object({
  timeoutMs: z.number().int().positive().default(1000),
  memoryMb: z.number().int().max(512).default(64),
});
sandboxPlugin.inject = ["logger"];
```

**Service 抽象类——领域服务的标准写法**。继承 `Service` 并在构造器里 `super(ctx, 'gradebook')`，插件加载时该实例自动注册为 `ctx.gradebook`，全局可注入。配 TypeScript 声明合并获得类型：

```ts
declare module "cordis" {
  interface Context {
    gradebook: Gradebook;
  }
}
export class Gradebook extends Service {
  constructor(ctx: Context) {
    super(ctx, "gradebook");
  }
  async getMajorFirstAttempts(uid: string, term: string) {
    /* SQL 过滤取数 */
  }
}
```

类上还有几个符号钩子可覆写：`[Service.init]`（异步初始化）、`[Service.check]`（就绪检查）、`[Service.invoke]`（让服务本身可调用，内置 logger 就是这么做到 `ctx.logger('name')` 的）、`[Service.extend]`。

**Fiber 生命周期与热插拔——cordis 最值钱的机制**。状态机是 PENDING(0) → LOADING(1) → ACTIVE(2)，另有 FAILED、UNLOADING、DISPOSED。`ctx.plugin()` 返回 `Fiber & PromiseLike<Fiber>`，可以直接 `await` 到就绪。我实测验证的关键行为链：先加载声明了 `inject: ['gradebook']` 的插件，它停在 PENDING 不执行；随后加载 Gradebook 服务插件，依赖方立即自动执行并能访问 `ctx.gradebook`；**卸载 Gradebook 时，依赖它的插件被联动回卷——effect 全部释放、状态退回 PENDING；重新提供服务后，依赖插件自动重新执行、回到 ACTIVE**。这就是你答辩时"插件热插拔"的实证：依赖图上的联动装卸是框架自动的，你不用写一行协调代码。Fiber 上的方法：`await()`、`restart()`、`update(config)`（不重启地更新配置，配合 `internal/update` 事件可做配置热更）、`dispose()`。

**Effect——副作用的托管释放**。`ctx.effect(() => { ...创建资源; return () => 释放 })` 把副作用登记到当前 fiber，插件卸载时自动执行清理。支持返回生成器（yield 多个释放函数）和异步 effect。你所有"注册路由、启动定时器、建立连接、往注册中心塞题型"类操作都必须走 effect，这是插件能被干净卸载的前提。`fiber.getEffects()` 能拿到 effect 树用于调试。

**事件系统——五种派发模式，正好映射你的业务语义**。`ctx.on(name, listener, { prepend?, global? })` 监听（返回取消函数，且随 fiber 自动清理）；派发有五种：`emit`（同步广播不收集结果）、`parallel`（异步并发全跑）、`serial`（异步串行，遇非空返回即中断）、`bail`（同步串行，首个非空返回即胜出）、`waterfall`（把返回值接力传递）。对应到你的系统：结算完成后的通知用 parallel，审核链上"是否拦截该提交"用 bail/serial，配置在保存前的多插件加工用 waterfall。事件名用 TypeScript 声明合并扩展 `Events` 接口即可获得全类型安全。另有 `internal/service`、`internal/status` 等元事件，可以监听服务上线下线做管理面板。

**Reflect 层**。`ctx.get(name, strict?)` / `ctx.set` / `ctx.provide(name, value)`（轻量提供服务，返回释放函数，适合不想写 Service 类的小服务）/ `ctx.accessor`（定义 getter/setter 属性）/ `ctx.mixin`（把服务方法平铺到 ctx 上，官方警告勿滥用）。

**生态包与启动方式**。monorepo 里有：`@cordisjs/plugin-loader`（配置文件驱动的插件装载）、`plugin-include`（引入 cordis.yml）、`plugin-hmr`（开发期热重载，配合 Fiber 机制实现改代码不重启进程）、`group`（插件分组）、`timer`（`ctx.setTimeout` 等托管定时器）、`logger-console`（日志输出到控制台）、`create`（脚手架）。`cordis` 包自带 CLI：`new Context()` → 加载 Loader → 读取 `cordis.yml` 装配插件——**这正是你方案 4"启动前选装配置组装项目"的官方实现路径**：选装哪些范式、哪些 AI 能力，就是编辑 cordis.yml 加一段配置的事，配置里的参数还会被各插件的 Zod Config 校验。

**二、插件依赖树与开发顺序**

图里是主干依赖方向，几条不在主干上的具体边值得点明：范式插件同时 `inject` 题型中心和审核链（申报审核范式要挂审核流）；导入计算范式额外依赖成绩库；AI 层的题型生成依赖沙箱（跑测试用例）和题型中心（写入配置），章程问答依赖数据库（pgvector）；结算依赖题型中心和成绩库。每个插件的 `inject` 数组就是这张图的机器可读版本——论文里可以直接把 `inject` 声明汇总生成依赖图，作为架构章节的实证图表。

开发顺序按里程碑走，每个里程碑以"能演示什么"为验收：

**M0 行走骨架（约一周）**：core + logger-console + loader/cordis.yml + hmr，自己写两个 L0 服务插件——`server`（Hono 实例 + oRPC 挂载点，提供 `ctx.server.route()` 之类的注册 API，用 effect 保证卸载时摘除路由）和 `database`（Drizzle + pg 连接池，提供 `ctx.db`）。验收：一个 ping 插件通过 cordis.yml 装配、路由可访问、改代码热重载生效。这一步把"插件写法、effect 纪律、声明合并"的手感建立起来，后面全是复制这个模式。

**M1 基座迁移（一到两周）**：把 Qualy 的 auth、org、rbac 三块 service + schema 原样搬进三个 L1 插件（四层结构保留在插件内部），加 dict 字典插件。同步搭"插件导出 schema → 构建期聚合 → drizzle-kit 迁移"的流水线。验收：登录、组织树 CRUD、角色授权全部经 oRPC 契约走通。

**M2 双层机制核心（两到三周，全项目最关键）**：题型中心（题型配置 CRUD + 版本化 + 范式扩展点注册表）、sandbox 插件（QuickJS-WASM 或 isolated-vm）、第一个范式插件 paradigm-declaration、submission 提交模块。验收：**手写**（不用 AI）一个"献血分"题型配置，端到端跑通：学生填表上传 → 数据落 jsonb → 沙箱执行计分函数出分。此时你的核心论点已经成立，后面都是增量。

**M3 流程闭环（两周）**：审核链引擎（Qualy 审批经验直接迁移）、批次、结算、gradebook + paradigm-import。验收：一个批次从创建、圈人、填报、审核、结算封顶到归档冻结全流程，外加导入成绩自动算平均学分绩。

**M4 AI 链路（两到三周）**：L0 的 ai 插件（AI SDK 封装成 `ctx.ai`）和 queue 插件（BullMQ），然后 L4 五个 AI 插件依次上：genform（章程→配置+函数→vfs 类型检查→沙箱测试→发布）、precheck、review-assist（多模态）、explain、qa（pgvector）。验收：答辩演示主线——贴一段章程，AI 生成题型，管理员确认测试样例，发布，学生填报，AI 预检，审核台看 AI 建议稿。

**M5 补全与打磨**：互评/固定分范式、公示申诉、Langfuse 接入采集实验数据、通用性验证（用 ACM 社团积分场景换一套配置跑起来，反哺论文的通用性章节）。

两个工程提醒：第一，从 M0 起就为每个插件写一个最小 vitest（加载→断言服务可用→卸载→断言资源释放），cordis 的 Context 天然适合单测隔离，这些测试就是论文"系统测试"章节的素材。第二，rc 版本要在根 package.json 里精确锁定 `4.0.0-rc.7` 不带脱字符，升级手动做，避免某天 `rc.8` 悄悄改 API 打断你。

## [2026-07-23 20:45] Hangqi Guo

详细列一下Cordis的概念、使用和接口文档给我呗，官方真没有，讲一下其涉及到的各种基本概念，以及各种接口文档和生命周期。

## [2026-07-23 20:50] Claude

官方没有的话，我就基于类型声明 + 实测行为给你写一份完整手册。先把上一轮没验证到的行为补测一遍（事件五种派发模式的确切语义、waterfall 怎么传值、生成器 effect 的释放顺序、同插件多次加载），保证手册里每句话都有实证：

手册写好了，共 16 节，覆盖全部 API 面。除了上一轮讲过的内容，这次补测出了四个此前没验证、而且容易踩坑的行为，值得你先记住：

**waterfall 不是返回值接力，是洋葱中间件**。调用形式是 `ctx.waterfall(name, ...args, inner)`——最后一个参数是"最内层默认实现"，每个监听器收到 `(...args, next)`，自己决定在 `next()` 前后做什么、要不要放行。框架自己的 `fiber.update()` 就是用它让插件拦截配置变更实现免重启热更的。你的审核链"是否拦截该提交"这类扩展点，用它比 bail 表达力更强。

**事件监听本质上也是 effect**。源码里 `EventsService.register` 直接把监听器登记到 `ctx.fiber.effect`，所以插件卸载时监听器自动移除（实测确认）。Service 注册、provide 同理——这就是"插件能被干净卸载"的统一机制，论文里讲插件化原理时这是最核心的一句话。

**生成器 effect 的释放是 LIFO**。`yield d1; yield d2` 卸载时先执行 d2 再 d1，符合"先建的最后拆"的资源依赖直觉，多段资源初始化就该用这个写法。

**bail/serial 的"非空"判定以 undefined 为界**——第一个返回 undefined 的监听器会被跳过，首个返回非 undefined 值的胜出并短路后续。

手册里凡是我实测过的都标了"实测"，没测过的（isolate 细节、Inject 装饰器、Transform 配置）也明确标注了，你用到那几处时先自己验一下。文档结构照着"概念 → 快速开始 → 逐服务 API → 生命周期 → 生态包 → 3.x 迁移对照 → 实践守则"排的，可以直接当团队内部文档用，以后发现新行为往里补就行。

## [2026-07-23 21:13] Hangqi Guo

你这文档写的我都没太看懂，你能不能像Nestjs官方文档那样，分章节分类来讲，而且主要是讲编码方法和概念而不是讲框架的内部底层实现逻辑。比如说你讲了一大堆，我连waterfall是用来干什么的都没听懂。

## [2026-07-23 21:16] Claude

你说得对，上一版是"考古报告"不是"使用文档"。我重写一版：按 NestJS 文档的方式分章节，每章先说"这东西是拿来干什么的、什么时候用"，再给能抄的代码，内部实现一概不讲。例子全部换成你综测系统里的真实场景。

重写好了。这版的组织方式完全变了：11 章，每章开头先回答"这个东西解决什么问题、什么时候用"，然后才是代码，所有例子都用你综测系统的业务（成绩库、申报审核、AI 预检），框架内部怎么实现的一个字没提。

顺便用一段话把 waterfall 给你讲明白，检验一下这版有没有讲清：**waterfall 就是"我有一套默认做法，但允许别的插件插手"**。比如审核链分派任务的默认逻辑是按角色找人，你后来想加个"回避规则"插件（审核人和提交人有利益关系时换人）——默认逻辑不应该知道回避规则的存在，它只需要用 waterfall 把自己包出去；回避插件监听这个事件，先调 `next()` 拿到默认结果，有冲突就换人，没冲突就原样放行。和 Koa 中间件是一个思想。对应地：emit 是"吼一嗓子不用回复"，parallel 是"吼一嗓子等大家做完"，bail/serial 是"问一圈谁能处理，第一个应答的算"。

五种模式在第 8 章各配了一个你项目里真实会写的场景（提交广播、结算善后、范式路由、黑名单否决、审核回避），照着抄就能用。第 11 章是一张"我想干什么 → 怎么写"的速查表，日常开发基本只需要看那一页。

## [2026-07-23 23:08] Hangqi Guo

在用Cordis的情况下，前端怎么办？有那种动态的前端系统吗？否则我插件加载和卸载，前端怎么办，否则我前端和后端就不能都写在插件里了，感觉很别扭

## [2026-07-23 23:10] Claude

问到了插件化架构最经典的难题。先快速确认一下 cordis 生态里现成的动态前端方案（Koishi 控制台那套是不是已经通用化了），再给你完整答案：

确认了：**现成的动态前端系统真的存在，而且就在你熟的生态里**——`@cordisjs/plugin-webui` + `@cordisjs/client`（0.8.x），就是 Koishi 控制台通用化出来的东西。它的原理是"运行时前端插件"的完整实现：每个后端插件把自己前端部分的构建产物（ESM bundle）通过 `addEntry` 挂出去，浏览器里的客户端运行时通过 WebSocket 拿到入口列表、`import()` 动态加载，加载进来的模块拿到一个前端版的 ctx，往共享运行时里注册页面、路由、插槽——而且前端同样用 effect 模型，后端插件一卸载，对应的前端页面立刻消失。Koishi 控制台里在线装个插件、界面上多出一个菜单页，就是这么做到的。

所以你的"别扭"在技术上是有解的。但我不推荐你的毕设走这条路，先把动态性这个词拆开你就知道为什么了。插件的前端动态性其实分三级：

**数据级**：前端代码不变，渲染什么由后端数据决定。你的动态表单引擎就是这级——新题型 = 新的字段 schema JSON，前端通用渲染器直接消化，根本不需要新前端代码。你系统里约 30 种题型的绝大部分动态性在这一级就消化掉了。

**构建级**：前端代码按选装清单在构建时装配。这级对应你的方案 4"启动前选装"。

**运行级**：浏览器运行时远程加载新代码，就是 webui 那套。代价清单很长：共享依赖治理（React 不能被加载进来两份，要 import maps 或 Module Federation）、样式冲突、**类型安全跨界断裂**（动态加载的模块和 oRPC 契约的端到端类型推导接不上，你最珍视的东西没了）、每个插件一条独立前端构建链、加载的 JS 的安全边界。webui 还是 Vue 3 绑定的，和你的 React 栈不合。这一级是 Koishi 那种"用户在线装第三方插件"的场景才必需的，你的系统是自部署、部署前就确定插件组合，为它付这些代价不值。

所以推荐方案是**同包双端 + 构建期双侧装配**，"前后端都写在插件里"的诉求完全满足，只是装配时机在构建期：

```
packages/plugin-paradigm-declaration/
  src/index.ts        # cordis 后端插件
  client/index.tsx    # 前端部分：重题型组件、路由、菜单项声明
  package.json        # exports: { ".": "./src", "./client": "./client" }
```

关键机制一个 codegen 脚本：读 cordis.yml（后端的装配清单同时就是前端的），生成 `apps/web/src/plugin-registry.gen.ts`，内容是对每个选装插件 `/client` 导出的**静态 import** 和注册调用。之后 Vite 正常构建——tree-shaking 有效、类型完整、oRPC 契约端到端推导不断。一份选装清单，两端各自装配：后端由 loader 在启动时装，前端由 codegen 在构建时装。换一套插件组合 = 改 yml + 重新构建，这和你"综测系统换套配置变社团积分系统"的部署模型完全一致。

还剩最后一个缺口：**运行时**后端插件被停用了（cordis.yml 里 `disabled: true` 或管理员在线关闭），前端代码还在 bundle 里怎么办？用能力清单闭环：做一个 `capabilities` 小服务，每个后端插件加载时通过 effect 注册自己的能力标识（提供哪些范式、哪些 AI 功能、哪些菜单），卸载时自动消失——这正是 effect 模型的用武之地。前端启动时拉一次 `/api/capabilities`，菜单显隐、路由守卫全部由它驱动。插件停用 → 能力项消失 → 前端对应入口隐藏；就算用户硬敲 URL，后端路由也已随插件卸载而 404。前端代码"存在但不可达"，这在自部署场景下完全够用。

论文里这就是现成的一节："插件前端动态性的三级模型与选型"——数据级靠 schema 驱动表单、构建级靠清单驱动装配、运行级引 webui 为先例作为展望，并论证构建级是类型安全与复杂度的最优平衡点。答辩被问"前端怎么插件化"时，你有完整的层次化答案，而不是一句"没做"。

## [2026-07-23 23:20] Hangqi Guo

在用Cordis的情况下，前端怎么办？有那种动态的前端系统吗？否则我插件加载和卸载，前端怎么办，否则我前端和后端就不能都写在插件里了，感觉很别扭。我理解上我可以在每个插件的函数内直接ctx.nav.add(XXX)这样声明一个侧边栏项之类的。如果用后端渲染又舍弃了前端的流畅性，如果用纯前端，那么就代表每装一个插件都需要重新跑一次构建。你帮我规划思考下，我应该选用哪种方案。

## [2026-07-23 23:23] Claude

你把两个问题缠在一起了，先拆开，答案就清晰了：

**问题一：UI 元数据（导航项、路由、"这个题型用哪个渲染器"）由谁声明？** 你的直觉 `ctx.nav.add(...)` 完全正确——这叫**贡献点**（contribution points，VS Code 扩展就是这个模型），后端插件用 effect 声明，装卸自动增删，这件事没有任何争议。

**问题二：组件的 JS 代码怎么送达浏览器？** 这才是"要不要重新构建"的争论所在。元数据可以运行时下发，代码交付才分方案。

我推荐的结论：**毕设主体用图里这套"贡献点运行时下发 + 组件构建期聚合"的方案，把真·运行时动态加载做成一个扩展性演示**。理由展开说：

**"装插件要重建"在你的架构里根本不是缺陷，而是既定语义**。回想你自己选的方案 4：启动前选装 npm 包组装系统。数据库那条线你已经接受了同样的节奏——插件携带 Drizzle schema、构建期聚合、跑迁移，这本来就要一次构建部署。前端跟随同一节奏（cordis.yml 里启用哪些插件，生成脚本就把哪些插件的 `client/` 入口写进 `plugins.gen.ts`，Vite 打一次包）在工程上完全自洽，一点都不别扭。真正要求"浏览器里点一下就装好、零构建"的是方案 2（WP/HA 式插件市场），那个你早就正确地否决了。

而日常运营里高频的操作其实是**停用/启用**，这在此方案下无需重建：manifest 是运行时按当前已装载插件 + 请求者 RBAC 权限动态生成的，停用插件后它贡献的导航、路由、渲染器立即从 manifest 里消失，前端壳拿不到就不渲染——对应的 lazy chunk 连请求都不会发。运行时可见性由后端插件状态驱动，重建只在"新增前端组件代码"时发生。

还有一个让压力骤降的事实：你的题型绝大多数是**纯配置**（动态表单引擎渲染 JSON schema），根本没有自定义前端代码；需要 `client/` 入口的只有少数重题型（互评矩阵、打卡日历）和管理面板类插件。需要动态交付的代码总量很小。

**具体怎么写**，三段式：

```ts
// 后端：ui-registry 插件提供 ctx.ui（贡献点全部 effect 化）
ctx.ui.addNav({
  key: "review",
  label: "审核工作台",
  path: "/review",
  order: 30,
  permission: "review:read",
});
ctx.ui.addRenderer("peer-review", "PeerReviewMatrix"); // 题型 → 渲染器名
```

manifest 经 oRPC 暴露（`GET /ui/manifest`），服务端按登录者权限过滤后返回导航树、路由表、渲染器映射——权限过滤放服务端做，前端永远见不到无权菜单，这比前端自己 if 判断干净得多。

```ts
// 构建期：scripts/gen-plugins.ts 读 cordis.yml，产出 plugins.gen.ts
export const clientRegistry = {
  ...declarationClient.renderers, // '@qualy/plugin-paradigm-declaration/client'
  PeerReviewMatrix: lazy(
    () => import("@qualy/plugin-peer-review/client/matrix"),
  ),
};
```

```tsx
// 前端壳：启动拉 manifest，导航和路由全是数据驱动
const { nav, routes, renderers } = useManifest();
// 渲染题型时：const C = clientRegistry[renderers[qt.key]] ?? DynamicForm
```

**方案 B（真·运行时加载）留作论文的"扩展性验证"一节**，因为它的原理你其实很熟——Koishi 的控制台就是这么干的：每个插件包在发布时把 client 构建成 ES Module，后端插件用 `ctx.server` 把这个文件静态服务出来，前端壳读 manifest 后 `import(url)` 动态载入，React、组件库这些共享依赖通过 import map 指回壳内同一实例（保证全应用只有一个 React）。关键点是：**它和方案 A 的贡献点契约完全相同，只是把"注册表来自构建期聚合"换成"注册表来自运行时 import"**。所以你可以在毕设后期挑一个演示插件走这条路，论文里写"系统预留了运行时交付通道并验证可行"，工作量可控，答辩效果拉满；但不要把整个系统押在上面——单 React 实例约束、共享库版本偏移、CSS 隔离这些坑足够再写半篇论文。

SSR 和 iframe 微前端两条路明确不走：前者放弃你整个 React + oRPC 类型链路，后者（qiankun 之类）的隔离重量和交互割裂感对校园系统是杀鸡用牛刀。

一句话收尾：**元数据动态、代码静态聚合，是"可插拔"与"工程可控"之间对毕设最优的切点**——而且它给未来留好了升级到全动态的门。

## [2026-07-23 23:31] Hangqi Guo

用户运行的时候只有一个cordis.yml，怎么才能生成plugins.gen.ts并由前端使用啊？你理清一下整个流程，插件函数、cordis.yml、前端聚合manifest究竟都负责哪部分工作，大体长什么样子。

## [2026-07-23 23:32] Claude

你卡住的点在时间轴上：**cordis.yml 是唯一事实源，但它被读两次——构建期被生成脚本读一次，运行期被 loader 读一次**。`plugins.gen.ts` 是构建产物（和 dist 一样，gitignore 掉），不是运行时生成的东西。捋一遍五个角色的分工，再给你每个文件的真实长相。

**分工总表**

- **插件包**：一个 pnpm 包，两个入口。`src/`（server 入口）= cordis 插件函数，做业务 + 用字符串声明贡献点；`client/`（前端入口）= React 组件 + 一张"渲染器名 → 组件"的导出表。server 侧只写字符串，绝不 import React。
- **cordis.yml**：装配清单。启用哪些插件、各什么配置。
- **生成脚本**（构建期跑）：读 yml → 找出启用插件里带 `./client` 导出的 → 生成 `plugins.gen.ts`。
- **ui-registry 插件**（运行期）：提供 `ctx.ui`，收集各插件声明的导航/渲染器元数据，暴露 `GET /ui/manifest`（按登录者 RBAC 过滤）。
- **前端壳**：启动拉 manifest 决定"显示什么"；用编译进包的 `plugins.gen.ts` 注册表决定"用什么代码渲染"。

**1）插件包的样子**（以互评为例）

```jsonc
// packages/plugin-peer-review/package.json
{
  "name": "@qualy/plugin-peer-review",
  "exports": {
    ".": "./src/index.ts", // server 入口（cordis 插件）
    "./client": "./client/index.ts", // 前端入口（可选，纯配置题型没有这个）
  },
}
```

```ts
// src/index.ts —— server 入口：业务 + 贡献点（全是字符串）
import { z } from "zod";
export function peerReview(ctx: Context, config: Config) {
  ctx.questionTypes.registerParadigm("peer-review", {
    /* 生命周期钩子 */
  });
  ctx.server.mount(peerReviewRouter); // oRPC 路由
  ctx.ui.addNav({
    key: "peer",
    label: "互评",
    path: "/peer",
    permission: "peer:read",
  });
  ctx.ui.addRenderer("peer-review", "PeerReviewMatrix"); // 题型 → 渲染器名（字符串！）
}
peerReview.inject = ["questionTypes", "server", "ui", "db"];
peerReview.Config = z.object({ anonymous: z.boolean().default(true) });
```

```ts
// client/index.ts —— 前端入口：渲染器名 → 组件加载器
export const renderers = {
  PeerReviewMatrix: () => import("./PeerReviewMatrix"), // thunk，由壳包 lazy
};
```

**2）cordis.yml**

```yaml
- name: "@qualy/plugin-ui-registry"
- name: "@qualy/plugin-paradigm-declaration" # 纯配置题型，无 client 导出
- name: "@qualy/plugin-peer-review"
  config: { anonymous: true }
- name: "@qualy/plugin-ai-precheck"
  disabled: true # 停用：manifest 里消失，前端自动不显示，无需重建
```

**3）生成脚本**（挂在 build 前置：`"build": "tsx scripts/gen-plugins.ts && vite build"`）

```ts
// scripts/gen-plugins.ts —— 核心逻辑不到 30 行
const entries = YAML.parse(fs.readFileSync("cordis.yml", "utf8")).filter(
  (e) => !e.disabled,
);

const lines = [`// 本文件由 gen-plugins.ts 生成，勿手改`];
const spreads: string[] = [];
for (const [i, e] of entries.entries()) {
  try {
    resolve(`${e.name}/client`); // 有 ./client 导出才收编
    lines.push(`import { renderers as r${i} } from '${e.name}/client'`);
    spreads.push(`...r${i}`);
  } catch {
    /* 纯后端插件，跳过 */
  }
}
lines.push(`export const clientRegistry = { ${spreads.join(", ")} }`);
fs.writeFileSync("apps/web/src/plugins.gen.ts", lines.join("\n"));
```

生成产物长这样：

```ts
// apps/web/src/plugins.gen.ts（构建产物）
import { renderers as r2 } from "@qualy/plugin-peer-review/client";
export const clientRegistry = { ...r2 };
```

Vite 打包时每个 thunk 自动成为独立 chunk（按需加载），没被写进这个文件的插件前端代码根本不会进产物。

**4）运行期：ui-registry 收集并下发 manifest**

```ts
// GET /ui/manifest 的返回（已按当前登录者权限过滤）
{
  "nav": [{ "key": "peer", "label": "互评", "path": "/peer" }],
  "renderers": { "peer-review": "PeerReviewMatrix" }
}
```

**5）前端壳消费两样东西**

```tsx
const manifest = useManifest(); // 运行时数据：显示什么
const registry = useMemo(() => mapValues(clientRegistry, (t) => lazy(t)), []);

function QuestionRenderer({ qt }) {
  const name = manifest.renderers[qt.paradigm]; // 'PeerReviewMatrix'
  const C = name && registry[name];
  if (name && !C) console.warn(`渲染器 ${name} 不在构建产物中，回退动态表单`); // 防呆
  return C ? (
    <Suspense fallback={<Spin />}>
      <C qt={qt} />
    </Suspense>
  ) : (
    <DynamicForm qt={qt} />
  );
}
```

**端到端时间线**，新增一个插件是五步：装包（pnpm add）→ cordis.yml 加一条 → `pnpm build`（gen 先跑、Vite 后跑）→ 部署 → 服务启动时 loader 读同一份 yml 装载后端插件，插件执行贡献点声明，浏览器拉到新 manifest，点开页面时按需加载它的 chunk。停用一个插件是一步：yml 里 `disabled: true`（或运行时 dispose），manifest 即刻少了它的条目，前端界面同步消失——代码还躺在包里但永远不会被请求，等下次重建时自然被剔除。

最后那个 `console.warn` 回退不是装饰：它兜住"有人只在服务器上改了 yml 启用新插件、忘了重建前端"的错位场景——界面会用动态表单降级渲染并留下线索，而不是白屏。这个防呆写进论文的容错设计一节正合适。

## [2026-07-23 23:45] Hangqi Guo

我还是决定使用orpc v2（即使是beta），因为v2应该是（没细看）解决了挂载middleware时不挂载中间件的errors的问题，而且增加了不少新功能。但是如何在cordis和本项目里优雅地使用orpc？因为orpc和express、hono、koa、fastify之类的声明式语言不太一样，那几种大多是app.get('/example', (ctx) => {...})的形式，但是orpc的路由就是一个{greeting: { hello: XXX, bye: XXX }, test: { healthz: XXX, test: XXX }}，其中的XXX是os的变体，orpc支持openapi模式。文档参考[https://orpc.dev](https://v2.orpc.dev)，对于v2的文档可以参考https://v2.orpc.dev，项目在https://github.com/middleapi/orpc。你看看，是否不推荐使用orpc而是转为koa、fastify、hono、express，目的是实现尽可能功能丰富类型严格的路由，不是非要锁死orpc？

## [2026-07-23 23:48] Claude

先去把 v2 的文档和仓库翻一遍再下结论。

看关键的两页：Router（能否惰性/动态组合）和 Middleware（errors 合并问题）：

结论先行：**留在 oRPC，不要换 Hono/Fastify/Express**。而且你担心的那个"别扭点"其实要反过来看——对象式路由恰恰是插件系统最好伺候的形态。但你选 v2 的那条理由，我查到的证据要给你泼点冷水。

**先泼冷水：middleware errors 的问题未必如你所想**

在官方讨论区里，作者明确表态过：procedure 不继承 middleware 的 errors 是预期行为，这个特性请求他尝试多次后决定不支持，理由是 middleware 会变得过于复杂，且希望类型安全错误保持可选；有人追问"v2 会有吗"，但从 v2 当前的 error-handling 文档看，相关章节内容与 v1 基本一致（自定义错误仍是在 middleware 里 catch 后转成 ORPCError 的模式），没有出现"middleware errors 自动并入 procedure 类型"的新机制。所以动手前先去 v2 的 release notes 里确认这一点，别把选型押在一个未验证的假设上。即便 v2 没做这个，社区惯用解法也够用：把公共 errors 定义在 base builder 上（`const base = os.errors({...})`），所有 procedure 从 base 派生，middleware 抛的错自然在类型内——错误类型跟着 builder 走而不是跟着 middleware 走。

**为什么"对象路由"对插件系统反而是优势**

你把 `app.get('/x', fn)` 式的命令式注册当成了插件友好的形态，但想一步深的问题：**插件卸载时怎么办？** Express/Koa 的中间件栈压根没有官方的"反注册"——路由进去了就出不来，热插拔要靠重建整个 app 或黑魔法。而 oRPC 的路由就是一个普通对象、一个**值**。值的世界里增删合并是平凡操作：

- 装载插件 = 往注册表里放一个路由片段
- 卸载插件 = 从注册表里删掉它，重建 handler
- handler 重建 = `new OpenAPIHandler(mergedRouter)`，纯内存操作，微秒级

卸载后路由是**真正消失**（404），不是被绕过。这比任何命令式框架都干净。你在 cordis 里要的 `ctx.server.contribute(...)` 长这样：

```ts
// L0 server 插件
export class ServerService extends Service {
  private fragments = new Map<string, AnyContractRouter>();
  private handler!: OpenAPIHandler<any>;

  constructor(ctx: Context, config: Config) {
    super(ctx, "server");
    // HTTP 服务器只建一次；监听函数永远委托给"当前的" handler
    const httpServer = createServer((req, res) =>
      this.handler.handle(req, res, {
        context: { cordis: this.ctx /* 每请求上下文 */ },
      }),
    );
    ctx.effect(() => {
      httpServer.listen(config.port);
      return () => httpServer.close();
    });
    this.rebuild();
  }

  contribute(ns: string, router: AnyRouter) {
    return this.ctx.effect(() => {
      // effect 化：插件卸载自动摘除
      this.fragments.set(ns, router);
      this.rebuild();
      return () => {
        this.fragments.delete(ns);
        this.rebuild();
      };
    });
  }

  private rebuild() {
    this.handler = new OpenAPIHandler(Object.fromEntries(this.fragments), {
      plugins: [
        /* CORS、OpenAPI Reference 等 */
      ],
    });
  }
}
```

```ts
// 业务插件（contract-first 照旧）
function peerReview(ctx: Context) {
  ctx.server.contribute(
    "peer",
    implement(peerContract).router({
      submit: implement(peerContract.submit).handler(({ input, context }) => {
        return context.cordis.db; /* ... */
      }),
    }),
  );
}
peerReview.inject = ["server", "db"];
```

注意两个细节：HTTP 服务器和 handler 解耦（重建只换 handler 引用，在途请求用旧的跑完，原子切换）；每请求把 cordis 的 `ctx` 塞进 oRPC 的 context，handler 里就能访问所有服务。OpenAPI 文档也是重建时自动重生成的——停用一个插件，Swagger 页面上它的接口同步消失，演示效果很好。

**类型怎么办：和前端 plugins.gen.ts 完全对称**

运行时的路由是动态合并的对象，但 TypeScript 类型是静态的——"整个应用的契约类型"只在构建期存在。解法你已经有了：每个插件包导出 `./contract`（保持无 Drizzle 依赖的老规矩），生成脚本读 cordis.yml 产出 `contracts.gen.ts`：

```ts
// contracts.gen.ts（生成产物）
import { contract as peer } from "@qualy/plugin-peer-review/contract";
import { contract as batch } from "@qualy/plugin-batch/contract";
export const appContract = { peer, batch };
export type AppContract = typeof appContract;
```

前端 `createORPCClient<ContractRouterClient<AppContract>>(link)`，全链路类型就位。一份 cordis.yml，三个生成物（前端组件注册表、契约聚合、Drizzle schema 聚合），同一条构建期装配哲学——这个对称性本身就能在论文里画成一张很漂亮的图。

**换 Hono/Fastify 会丢什么**：契约先行、OpenAPI 自动生成、客户端端到端类型、类型安全错误——这些正是你从 Qualy 起就在经营的资产。Hono 的 RPC 类型绑在 handler 链式调用上，契约先行能力弱；Fastify 的 JSON Schema 不给你 TS 端到端客户端；Express/Koa 什么类型都不给。真正合理的组合是**共存**：server 插件里 oRPC handler 处理 API，旁边挂一个极薄的 Hono/原生路由处理非 RPC 流量（对象存储回调、健康检查、插件的 client 静态文件——方案 B 动态加载要用）。oRPC 官方本来就支持挂在任意 fetch/node adapter 后面，v2 还把 OpenTelemetry 做成了一等公民并保留了 lazy router，和你的 Langfuse 观测线也是顺的。

**风险控制**：beta 就锁死小版本号（和 cordis rc 同一纪律）；契约层是你的隔离墙——万一 v2 某个 beta 改动伤到你，contract 定义和业务 handler 几乎不用动，降级回 v1 的代价被限制在 server 插件那一百行胶水里。这笔风险，换你已经验证过的开发体验和这套类型故事，值得。

## [2026-07-24 00:07] Hangqi Guo

定一下开发规划，大概按照什么一个顺序开发，先开发什么后开发什么。

## [2026-07-24 00:08] Claude

按"先风险后装饰、主干永远可跑"的原则排，整个开发分六个阶段。每阶段给你三样东西：做什么、验收标准（做到什么程度算完）、对应论文哪部分。时长按你边上课边做的节奏估。

**P0 · 装配骨架（1–1.5 周）——先把"流水线"建起来，再谈业务**

- monorepo（pnpm workspaces）+ cordis（锁 4.0.0-rc.7）+ loader/include/hmr + logger-console
- 两个 L0 插件：server（oRPC v2 handler + contribute/rebuild 机制）、database（Drizzle + pg 连接池）
- **三个生成脚本的雏形**：schema 聚合 → drizzle-kit 迁移、contracts.gen.ts、plugins.gen.ts——它们是整个装配哲学的地基，必须最先通，哪怕各只处理一个插件
- 前端壳最小版：Vite + React + 拉 manifest + 数据驱动路由；ui-registry 插件先只做导航
- docker-compose 起 pg；vitest 骨架（"装载→断言→卸载→断言清理"模板）

验收：写一个 ping 插件，从 cordis.yml 装配 → oRPC 契约 → 前端页面调用成功；改插件代码 hmr 热重载；停用 ping，导航和路由消失。这一步通了，后面所有插件都是复制模式。

**P1 · 基座迁移（1–2 周）——已知领域，严格限时不镀金**

- Qualy 的 auth、org、rbac 三块 service + schema 原样搬进三个插件，加 dict 字典插件
- RBAC 和 manifest 权限过滤打通（无权菜单服务端就滤掉）

验收：登录、组织树 CRUD、角色授权全走通；两个不同角色登录看到不同导航。这段是搬家不是重写，超时就说明在过度打磨。

**P2 · 双层机制（2–3 周）——全项目的心脏，最大投入**

- question-type 中心：题型配置 CRUD + 版本化 + 范式注册表（bail 事件路由）
- 动态表单链路：FieldConfig → Zod 派生（前后端共用）→ RHF + 渲染注册表
- sandbox 插件（QuickJS-WASM，限时限内存）
- 类型门禁链：fieldConfigToDts → Monaco 编辑器（addExtraLib）→ @typescript/vfs 保存复检
- paradigm-declaration 范式 + submission 提交（answers 进 jsonb，附件先落本地盘）

验收：**手写**（不用 AI）一个"献血分"题型，端到端跑通：管理员建题型 → 学生填表传图 → 沙箱计分出分；再验证联动——改字段配置，旧计分函数在编辑器里飘红、被标记待修复。此刻你的核心论点已经成立。

**P3 · 流程闭环（约 2 周）**

- 审核链引擎（waterfall/serial 扩展点，Qualy 审批经验迁移）、batch 批次、settle 结算（分类封顶 + 权重）、公示申诉基础
- gradebook 成绩库 + paradigm-import 导入计算范式
- MinIO 插件转正（附件从本地盘迁过去）

验收：一个批次从创建、圈人、填报、多级审核、结算、公示到归档冻结全流程；导入成绩单自动算出平均学分绩、挂科扣分。

**P4 · AI 链路（2–3 周）**

- L0 补两个：ai 插件（AI SDK v6 封装 DashScope）、queue 插件（BullMQ + Redis）
- 五个 AI 插件按性价比顺序上：genform（章程 → 配置 + 函数 → 类型检查 → 沙箱测试 → 修复循环）→ precheck → review-assist（Qwen-VL 多模态提取比对）→ explain → qa（pgvector）
- **Langfuse 在本阶段开头就接**，让后面每次调用自动积累实验数据

验收：答辩主线演示能跑——贴章程、AI 生成题型、确认测试样例、发布、学生填报、AI 预检、审核台看建议稿。

**P5 · 收尾与实验（约 2 周 + 论文时间）**

- 互评/固定分范式补全，前端打磨
- 实验章节数据：用 Langfuse datasets 评 precheck 和字段提取准确率、沙箱执行耗时统计
- 通用性验证：ACM 社团积分场景换一套配置跑起来（论文通用性一节的实证）
- 可选加分项：方案 B 运行时前端加载做一个演示插件

**与论文进度的咬合**：开题报告在 P0–P1 期间写（总体设计那时已定型，P2 未动工正好写"拟实现"）；中期检查卡在 P3 结束（有完整业务闭环可演示）；P4 边做边写第四章，P5 专注实验章节和成稿。git 提交记录从 P0 就规范起来，它本身就是工作量证明。

**如果时间崩了，砍单顺序**（从先砍到不可砍）：方案 B 演示 → 章程问答 qa → 互评范式 → 公示申诉细节。**不可砍的底线**：双层机制 + 沙箱 + genform + 多模态助审——这四样是标题承诺的东西，标题里写了的必须站在答辩台上。

## [2026-07-24 00:57] Hangqi Guo

我在思考前端怎么架构。比如说登录功能，每个登录方式作为一个插件，登录功能本身也应该成为一个插件。那么登录功能本身一定会暴露出大量的前端页面，我应该怎么在ctx.ui里注册每个前端页面及其路由，并保证前端优化和树摇没问题。我理想中是，有个UI的底座，提供了基本的页面架构（比如侧边栏、顶部栏什么的），然后剩下的功能都是往上插。

## [2026-07-24 00:58] Claude

你理想中的形态是对的，而且登录这个例子恰好逼出了前端插件化缺的最后一块抽象：除了"页面"，还需要**插槽（slot）**。把这两个概念定下来，整个前端架构就闭合了。

**壳（底座）与插件的分界**

壳只负责四件事：布局（AdminLayout 带侧边栏顶栏 / BlankLayout 全屏空白）、设计系统与全局 Provider（oRPC client、auth context、动态表单引擎）、按 manifest 组装路由、以及一个 `<Slot id="..."/>` 组件。**壳里没有任何业务页面，连登录页都没有**——登录页属于 auth-core 插件。

插件的前端贡献物就两种：

- **页面**：一条路由 + 布局选择 + 组件名 +（可选）导航项 + 权限
- **插槽部件**：往某个具名插槽里塞一个组件（登录方式、仪表盘卡片、审核侧栏面板，全是这个模式）

**ctx.ui 的最终 API**（后端声明，全是字符串，effect 托管）：

```ts
// auth-core 插件（server 侧）
ctx.ui.addPage({
  path: "/login",
  layout: "blank",
  component: "LoginPage",
  public: true,
});
ctx.ui.addPage({
  path: "/profile",
  layout: "admin",
  component: "ProfilePage",
  nav: { label: "个人中心", icon: "user", order: 90 },
});

// auth-password 插件：往登录页的插槽里塞一个登录方式
ctx.ui.addWidget("login.methods", {
  component: "PasswordLoginForm",
  order: 10,
});

// auth-cas 插件
ctx.ui.addWidget("login.methods", { component: "CasLoginButton", order: 20 });
```

manifest 相应多一段 `widgets: { "login.methods": [{component,order}...] }`。**停用 CAS 插件，登录页上那个按钮就消失了，零重建**——这正是插槽比硬编码强的地方。

**前端侧**，auth-core 的 client 入口导出页面组件，登录页内部用 `<Slot/>` 拉取部件：

```tsx
// @qualy/plugin-auth-core/client/LoginPage.tsx
export function LoginPage() {
  return (
    <CenteredCard title="综测系统登录">
      <Slot id="login.methods" />{" "}
      {/* 渲染 manifest 里该插槽的所有部件，按 order 排 */}
    </CenteredCard>
  );
}
```

```ts
// @qualy/plugin-auth-core/client/index.ts —— 注意：全部是 thunk，不做顶层 import
export const components = {
  LoginPage: () => import("./LoginPage"),
  ProfilePage: () => import("./ProfilePage"),
};
// @qualy/plugin-auth-password/client/index.ts
export const components = {
  PasswordLoginForm: () => import("./PasswordLoginForm"),
};
```

**壳怎么消费**（启动流程里有一个登录特有的坑要先说）：manifest 接口必须**允许匿名访问**，匿名身份能看到的就是 `public: true` 的页面和它们的插槽（即登录页 + 登录方式们）；登录成功后重新拉一次 manifest，拿到 RBAC 过滤后的完整导航路由。壳的组装逻辑：

```tsx
const manifest = useManifest()          // 匿名→公共子集；登录后→完整
const registry = clientRegistry          // 来自 plugins.gen.ts

<Routes>
  <Route element={<BlankLayout/>}>
    {pagesOf(manifest, 'blank').map(p => <Route path={p.path} element={lazyOf(p)}/>)}
  </Route>
  <Route element={<AuthGuard><AdminLayout nav={manifest.nav}/></AuthGuard>}>
    {pagesOf(manifest, 'admin').map(p => <Route path={p.path} element={lazyOf(p)}/>)}
  </Route>
</Routes>
```

`<Slot id>` 的实现十行以内：查 manifest 的 widgets 表 → 按 order 排 → 逐个从 registry 取 lazy 组件渲染，查不到的 warn 并跳过。

**树摇和构建优化为什么天然没问题**——机制说清楚你就放心了：

1. **禁用的插件是零字节**。gen 脚本只 import 启用插件的 client 入口；没被 import 的包根本不进 Vite 的模块图，不存在"打进去再摇出来"的问题——是压根没进来。
2. **启用插件内部按组件分包**。注册表里全是 `() => import(...)` thunk，Vite 对每个动态 import 自动切 chunk。用户不点开审核工作台，就永远不会下载它的代码；登录页首屏只加载 LoginPage + 两个登录方式组件的小 chunk。
3. **共享依赖自动去重**。所有插件都是 workspace 包、由同一次 Vite 构建编译，React、组件库、RHF、Zod 只有一份，不存在方案 B（运行时加载）才有的多实例问题。
4. 两条纪律要守住：插件 client 包的 package.json 标 `"sideEffects": false`（有全局 CSS 就列白名单），入口文件只导出 thunk 表、**不许有顶层副作用和顶层重型 import**；超重依赖（Monaco 编辑器）在组件内部再嵌套一层动态 import，让它成为 chunk 中的 chunk，只在管理员打开计分函数编辑器时才落地。

最后一个收益顺手指出：登录方式插件化在你的场景不是过度设计——你有真实的 CAS 对接历史（Hydro 那套），学校统一认证、密码登录、未来可能的企业微信扫码，恰好就是"同一插槽的三个部件"，答辩时这一页能把"插件化不止于题型"讲得非常具体。

## [2026-07-26 21:34] Hangqi Guo

第一步应该干什么，P0，给我列出具体的操作方案。

## [2026-07-26 21:39] Claude

P0 的方案里有两个我还没实证过的风险点——oRPC v2 beta 的包名/入口，和"cordis CLI 能不能直接跑 TS 插件"。先花几分钟把这两个坑蹚了，再给你写操作手册：

v2 把 `.route()` 换成了 meta 插件体系。看 openapi 包里的路由声明方式：

找到了：v2 用 `openapi()` meta 插件声明路由。重跑端到端：

手册按 D0–D9 排好了，每天有明确的产出物、可抄的关键文件全文、当日验收标准，最后是 8 条 P0 总验收和一张实测坑速查表。

先记住这次实验换来的三个硬结论，它们直接写进了手册：**一**，`NODE_OPTIONS='--import tsx' node node_modules/cordis/bin.js` 可以直接装载 cordis.yml 里相对路径声明的 TS 插件，D2 不需要任何编译步骤；**二**，oRPC v2 beta.21 有破坏性变更——`oc.route()` 没了，路由声明改成 `oc.meta(openapi({ method, path }))`，网上搜到的 v1 教程在这点上全部失效；**三**，v2 的 `OpenAPIHandler` 从 `@orpc/openapi/node` 导入、`RPCHandler` 在 `@orpc/server/node`，最小闭环我已跑通返回 200，D4 的 server 插件代码照抄即可。

执行时守两条纪律。第一，**顺序不能乱**：D2 的 cordis 闭环和 D3 的生成器流水线是后面一切的地基，哪怕 ping 插件简陋得可笑也要先让"yml → 后端 → 迁移 → manifest → 前端页面"整条线亮起来，再谈功能。第二，**beta 期以实查代替记忆**：手册里凡是标注"导出位置以实查为准"的地方，用那句 `node -e "import('包名').then(...)"` 一行命令确认，别信任何教程包括我的记忆——这次 `oc.route` 就是教训。

D9 收尾时那 8 条验收里最重要的是第 4、5 两条（停用零重建、剔除后树摇成立），它们是你整个装配哲学的第一次实证，跑通那一刻记得截图留档——这就是论文第四章"系统实现"的第一组素材。P0 全绿之后，P1 的 Qualy 迁移就是往这条流水线上挂车厢了。

## [2026-07-26 21:43] Hangqi Guo

由于对话不互通，我现在需要给Claude Code写一个PLAN.md，你能否帮我草拟一份详细的，从基本信息到各种理念、理由、设计等？

## [2026-07-26 21:47] Claude

这份文档的价值取决于信息密度——把这场对话里所有的决策、理由、实测结论都固化进去，让 Claude Code 拿到就能开工而不用重新探索。我来写：

PLAN.md 写好了，12 节结构：项目概况 → 六条核心理念 → 技术选型定案表（含否决清单）→ **已实测事实清单** → 五层架构与仓库结构 → 七大关键机制规范 → 业务域模型 → P0–P5 路线图 → 九条工程纪律 → 风险与砍单预案 → 文档索引 → 术语表。

为 Claude Code 的消费习惯做了几个针对性设计，值得你知道：

**决策写成定案，不留讨论口子**。选型表明确标注"勿重启讨论"和已否决项——否则 Claude Code 很容易在新会话里重新掂量一遍 NestJS vs cordis，浪费你的对话额度还可能推翻既有结论。

**第 4 节"已实测事实"是全文档最值钱的部分**。12 条实测结论（cordis 热插拔回卷、waterfall 洋葱语义、`oc.route` 已死改 `oc.meta(openapi(...))`、tsx 装载 TS 插件的确切命令……）都是 Claude Code 的训练数据里没有的，明确标注"直接信任，勿重新调研"，能省掉它大量的试错循环；同时第 9 节的"实查代替记忆"纪律防止它照搬网上的 v1 教程掉坑。

**留了两个待验证标记**（oRPC middleware errors、`$context` 形态），并给了规避方案——对 beta 依赖诚实标注比假装确定更能让 Claude Code 做对。

使用建议：把这份 PLAN.md 放仓库根，另建 `docs/` 放之前三份文档（cordis 教程、手册、P0 施工手册），PLAN 第 11 节已经按这个路径索引了它们。然后你的 CLAUDE.md 里只需要一句"开工前先读 PLAN.md，按其中纪律执行，当前阶段 P0 参照 docs/p0-manual.md 逐日推进"。每完成一个阶段，让 Claude Code 在 PLAN 的路线图表格里勾掉验收项——这份文档同时就成了进度台账。

## [2026-07-26 22:20] Hangqi Guo

如果由Claude Code来完成P0，你推荐分为几次执行，每个步骤都做什么？对于文件夹架构和路径命名，你也可以再多加思考。

## [2026-07-26 22:22] Claude

推荐拆成 **8 次会话**，一次会话 = 一个可独立验收的增量 + 一次 git 提交序列。拆分依据不是工作量均匀，而是**风险隔离**（hmr、oRPC beta 这两个坑各自关在单独会话里，炸了不污染别的进度）和**上下文自足**（每次会话开场只需读固定的两三份文档就能接上）。

**先说两个我重新思考后的结构升级**，比之前的草案更适合 Claude Code：

第一，**插件目录按层分组**。二十多个插件平铺在 `packages/` 下，Claude Code 找文件全靠猜；按层分组后路径本身就是架构文档。npm 包名保持统一的 `@qualy/plugin-*`（层级可能调整，目录挪动便宜、改包名贵）：

```
qualy-next/
  CLAUDE.md  PLAN.md  cordis.yml  docker-compose.yml  drizzle.config.ts
  scripts/           # lib/read-entries.ts + 三个 gen-*.ts
  db/                # migrations/(提交) + schema.gen.ts(忽略)
  docs/
    p0-manual.md  cordis-tutorial.md  cordis-4-handbook.md
    notes/           # 实查记录(orpc-v2.md 等,会话中随手沉淀)
    reports/         # 每阶段验收报告
  packages/
    app/             # 后端宿主
    web-runtime/     # ★新增,见下
    api-client/      # createApiClient + contracts.gen.ts(忽略)
    plugins/
      infra/    server  database  storage  queue  ai  sandbox  ui-registry
      base/     auth  org  rbac  dict  gradebook
      core/     question-type  submission  batch  review  settle
      paradigms/ declaration  import  fixed  peer
      ai/       genform  precheck  review-assist  explain  qa
      demo/     ping    # 永久保留的冒烟插件,生产 yml 不含
  apps/web/          # 前端壳,src/plugins.gen.ts(忽略)
```

workspace glob 写 `packages/*` 和 `packages/plugins/*/*`；`.gitignore` 统一忽略 `**/*.gen.ts`。

第二，**新增 `@qualy/web-runtime` 包，修掉我之前草案里的一处坏味道**：之前 PingPage 里 `import { api } from '../../../apps/web/src/api'`——插件 client 反向伸手进壳，是循环依赖的种子。正解是插件 client 只依赖 web-runtime（`useApi()` hook、`<Slot/>`、布局类型、设计 tokens），壳负责实现 Provider。manifest 的类型不用重复定义——它顺着 ui-registry 的 contract 经 api-client 流到前端，天然有类型。

**8 次会话的执行卡**（每张卡：目标 → 自动验收 → 备注）：

1. **仓库奠基**（D1）：workspace/tsconfig/docker-compose/.gitignore/CLAUDE.md/目录空壳全建好。验收：`pnpm i` 零报错、`docker compose up -d` 后 psql 连通。纯脚手架，让 Claude Code 严格按上面的树建，禁止自由发挥目录名。
2. **cordis 启动闭环**（D2）：app 包 + cordis.yml + demo/ping 最小版 + hmr。验收：dev 启动打印装载日志；非法 config 报 ValidationError。备注：hmr×tsx 是本会话唯一风险，提示词里写死"限时排查，不通则按预案退 tsup watch 并把决定记入 docs/notes/"。
3. **生成器基建 + database 插件**（D3）：read-entries、gen-schema、plugin-database、ping 的 schema 表、迁移跑通。验收：`pnpm db:generate && pnpm db:migrate` 后 `psql -c '\d ping_logs'` 有表。
4. **server 插件 + oRPC v2 接入**（D4）：会话开场**先做实查仪式**——`node -e "import('@orpc/server/plugins').then(...)"` 等三条探针，结果写进 `docs/notes/orpc-v2.md`，再动手写 contribute/rebuild。验收：`curl :3000/api/x` 返回 404（链路通、无路由）。备注：把 PLAN §4 的第 8–11 条粘进会话提示词，防它照 v1 教程写 `oc.route`。
5. **ping 后端全链路 + 契约聚合 + api-client**（D5）：contract、implement、gen-contracts、api-client。验收三连：curl 200 且落库；node 脚本经 api-client 类型调用成功；**yml 停用 ping 后同 curl 变 404**。
6. **ui-registry + manifest**（D6）：addPage/addNav + 匿名 manifest。验收：curl manifest 含 ping 页；停用后条目消失。
7. **前端壳 + web-runtime + plugins.gen**（D7–8）：壳双布局、useManifest、注册表 lazy、PingPage 改用 `useApi()`。验收（全部命令化，不依赖开浏览器）：`vite build` 成功；写 10 行 node 脚本断言 dist 里 PingPage 是独立 chunk、且从 gen 输入剔除 ping 重 build 后该 chunk 不存在。浏览器走查留给你人工做。
8. **测试骨架 + 总验收固化**（D9）：给现有每个插件补"装载→断言→卸载→断言清理"vitest；逐条跑 P0 的 8 条清单；产出 `docs/reports/P0-REPORT.md`（含各条验收的命令与输出摘录）；打 tag `v0.1.0-p0`。

**贯穿 8 次会话的三条仪式**，写进 CLAUDE.md 让每次开场自动执行：开场读 `CLAUDE.md → PLAN.md 对应节 → docs/p0-manual.md 当日节`，不读完不动手；收场更新根目录 `STATUS.md`（本次完成项、验收输出、遗留问题）并规范提交——STATUS.md 就是跨会话的记忆接力棒；凡遇到 beta 包行为与文档不符，实查结论当场沉淀进 `docs/notes/`，这些笔记会越攒越值钱。

一个额外建议：会话 2 和会话 4 这两个高风险会话，你本人最好在场盯着跑；3、5、6、8 这种模式明确的会话可以放手让它自己跑完再验收。
