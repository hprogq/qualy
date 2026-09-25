// The proof pictures of the demonstration, as the HTML they are drawn from.
// tools/demo/render-assets.ts turns each into tools/demo/assets/<name>.jpg,
// and the rendered files are what gets committed and uploaded.
//
// A claim needs something attached, and real certificates carry real names,
// numbers and seals. These are drawn from HTML instead: a certificate, a
// participation note, a volunteering record, a score report - each with a
// made-up seal and a watermark saying what it is. None names a person, so
// the same image can stand behind any claim of its kind. The ones every term
// shares carry no date either: a certificate dated after the term it is
// filed in, or before it, would contradict the claim it backs. A picture one
// episode or scene cites alone is dated to fit that one claim.

const seal = (text: string) => `
<svg class="seal" viewBox="0 0 200 200" width="150" height="150">
  <circle cx="100" cy="100" r="92" fill="none" stroke="#d0342c" stroke-width="6"/>
  <defs><path id="arc" d="M 30 105 A 70 70 0 1 1 170 105"/></defs>
  <text font-size="22" fill="#d0342c" font-weight="700" letter-spacing="3">
    <textPath href="#arc" startOffset="50%" text-anchor="middle">${text}</textPath>
  </text>
  <text x="100" y="118" font-size="44" fill="#d0342c" text-anchor="middle">★</text>
  <text x="100" y="160" font-size="18" fill="#d0342c" text-anchor="middle">演示专用章</text>
</svg>`

const page = (body: string, tone: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 960px; height: 680px; font-family: 'PingFang SC', 'Songti SC', serif; background: ${tone}; }
  .frame { position: absolute; inset: 22px; border: 10px double #b8872b; padding: 56px 72px; }
  h1 { text-align: center; font-size: 56px; letter-spacing: 18px; color: #9b1c1c; margin-bottom: 34px; }
  p { font-size: 25px; line-height: 1.9; color: #222; text-indent: 2em; }
  .sign { position: absolute; right: 90px; bottom: 70px; text-align: center; font-size: 22px; color: #333; line-height: 1.7; }
  .seal { position: absolute; right: 120px; bottom: 58px; opacity: 0.85; }
  .mark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          font-size: 68px; color: rgba(160, 160, 160, 0.28); transform: rotate(-24deg); font-weight: 700;
          letter-spacing: 12px; pointer-events: none; }
  table { border-collapse: collapse; width: 100%; font-size: 21px; }
  td, th { border: 1px solid #999; padding: 9px 12px; text-align: left; }
  th { background: #eef1f6; }
  .plain { position: absolute; inset: 0; padding: 48px 56px; background: #fff; }
  .plain h2 { font-size: 30px; margin-bottom: 22px; color: #1d3a6e; }
  .bar { height: 10px; background: linear-gradient(90deg, #2b59c3, #6d8fe0); margin-bottom: 30px; }
</style></head><body>${body}<div class="mark">演示材料 · 非真实证明</div></body></html>`

/** a certificate; `date` only on one a single claim cites */
const certificate = (
  title: string,
  text: string,
  issuer: string,
  date?: string,
  tone = '#fbf6ea',
) =>
  page(
    `<div class="frame"><h1>${title}</h1><p>${text}</p>
     <div class="sign">${issuer}${date === undefined ? '' : `<br/>${date}`}</div>${seal(issuer.slice(0, 10))}</div>`,
    tone,
  )

const table = (
  heading: string,
  head: readonly string[],
  rows: readonly (readonly string[])[],
  note: string,
) =>
  page(
    `<div class="plain"><div class="bar"></div><h2>${heading}</h2>
     <table><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr>
     ${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</table>
     <p style="margin-top:26px;font-size:19px;color:#555;text-indent:0">${note}</p></div>`,
    '#fff',
  )

/** a form the applicant fills and signs: rows of what it asks, a statement, a place to sign */
const form = (
  title: string,
  rows: readonly (readonly [string, string])[],
  statement: string,
  signer: string,
) =>
  page(
    `<div class="plain"><div class="bar"></div><h2>${title}</h2>
     <table>${rows.map(([label, value]) => `<tr><th style="width:32%">${label}</th><td>${value}</td></tr>`).join('')}</table>
     <p style="margin-top:26px;font-size:21px;text-indent:0">${statement}</p>
     <div class="sign">${signer}：________<br/>二〇二六年九月</div></div>`,
    '#fff',
  )

export const PICTURES: Readonly<Record<string, string>> = {
  'campus-1': certificate(
    '参与证明',
    '兹证明该同学参加由示例大学软件学院组织的校园文化活动，全程认真参与，表现良好。',
    '示例大学软件学院团委',
  ),
  'campus-2': certificate(
    '荣誉证书',
    '该同学在校园文化活动中表现突出，荣获<b>二等奖</b>，特发此证，以资鼓励。',
    '示例大学学生工作处',
    undefined,
    '#fdf2f2',
  ),
  'campus-3': table(
    '校园文化活动参与名单（节选）',
    ['序号', '学院', '班级', '参与形式'],
    [
      ['1', '软件学院', '软件2023级', '工作人员'],
      ['2', '软件学院', '软件2023级', '观众（全天）'],
      ['3', '软件学院', '软件2023级', '志愿者'],
      ['4', '软件学院', '软件2023级', '观众'],
    ],
    '名单由活动主办单位公示，本页为演示用截图。',
  ),
  // 24-25-1: an award from the term before, on a certificate issued in this one
  'campus-4': certificate(
    '荣誉证书',
    '该同学在二〇二四年五月举办的心理情景剧微电影大赛中荣获<b>三等奖</b>，特发此证。',
    '示例大学学生工作处',
    '二〇二四年十月',
    '#fdf2f2',
  ),
  'competition-1': certificate(
    '获奖证书',
    '该参赛队在省级大学生学科竞赛中表现优异，荣获<b>省级一等奖</b>。',
    '省大学生竞赛组织委员会',
  ),
  'competition-2': certificate(
    '获奖证书',
    '该同学在全国大学生学科竞赛中荣获<b>国家级三等奖</b>，特发此证。',
    '全国竞赛组织委员会',
    undefined,
    '#f4f7fd',
  ),
  'competition-3': certificate(
    '荣誉证书',
    '该同学在市大学生程序设计竞赛中荣获<b>二等奖</b>。',
    '滨海市大学生竞赛委员会',
  ),
  'certificate-1': table(
    '全国大学英语等级考试 成绩报告（示例）',
    ['考试科目', '总分', '听力', '阅读', '写作和翻译'],
    [['英语四级', '531', '189', '196', '146']],
    '本截图仅用于系统演示，成绩与任何个人无关。',
  ),
  'certificate-2': table(
    '全国大学英语等级考试 成绩报告（示例）',
    ['考试科目', '总分', '听力', '阅读', '写作和翻译'],
    [['英语六级', '476', '162', '181', '133']],
    '本截图仅用于系统演示，成绩与任何个人无关。',
  ),
  'certificate-3': certificate(
    '合格证书',
    '该同学参加全国计算机等级考试，成绩合格，特发此证。',
    '考试中心（示例）',
    undefined,
    '#f3f8f3',
  ),
  'practice-1': certificate(
    '社会实践证明',
    '该同学于假期参加“返家乡”社会实践活动，按要求完成调研与服务任务，经考核合格。',
    '示例大学团委',
  ),
  'practice-2': table(
    '志愿服务时长记录（示例）',
    ['服务项目', '时长（小时）', '状态'],
    [
      ['社区养老院助老服务', '4', '已认证'],
      ['图书馆志愿服务', '3', '已认证'],
      ['城市马拉松志愿者', '8', '已认证'],
    ],
    '数据截取自志愿服务平台，本页为演示用截图。',
  ),
  'practice-3': certificate(
    '志愿服务证明',
    '该同学在志愿服务活动中认真负责、热情周到，累计服务时长 12 小时。',
    '示例大学青年志愿者协会',
    undefined,
    '#f4f7fd',
  ),
  'research-1': certificate(
    '立项通知书',
    '经评审，该同学主持的大学生创新创业训练计划项目获准<b>校级立项</b>。',
    '示例大学教务处',
  ),
  'research-2': table(
    '计算机软件著作权登记证书（示例）',
    ['软件名称', '登记号', '权利取得方式'],
    [['校园服务数据可视化平台 V1.0', '2025SR000000（示例）', '原始取得']],
    '登记号为演示用虚构编号。',
  ),
  'blood-1': table(
    '无偿献血证（示例）',
    ['献血量', '献血地点', '编号'],
    [['300 ml', '校园流动献血车', 'DEMO-0000']],
    '编号为演示用虚构编号。',
  ),
  'honour-1': certificate(
    '荣誉证书',
    '该同学在新生军训中表现突出，被评为<b>优秀学生教官</b>。',
    '示例大学武装部',
    undefined,
    '#fdf2f2',
  ),
  'article-1': table(
    '文章发表页（截图示例）',
    ['栏目', '标题'],
    [['校园动态', '青春助老践初心，温情陪伴暖夕阳']],
    '截图来自演示用网页，链接与内容均为虚构。',
  ),
  'sport-1': certificate(
    '荣誉证书',
    '该同学代表学校参加市高校学生阳光体育长跑比赛，荣获<b>团体第三名</b>。',
    '滨海市高校体育协会',
  ),
  // what a reviewer asks for beyond the filing, and a student uploads in answer
  'notice-1': table(
    '获奖名单公示（节选）',
    ['序号', '学院', '作品或队伍编号', '奖项'],
    [
      ['15', '计算机学院', 'DEMO-2025-0388', '二等奖'],
      ['16', '信息学院', 'DEMO-2025-0402', '二等奖'],
      ['17', '软件学院', 'DEMO-2025-0415', '二等奖'],
      ['18', '软件学院', 'DEMO-2025-0521', '三等奖'],
    ],
    '名单截取自竞赛组委会公示页面，本页为演示用截图。',
  ),
  'notice-2': certificate(
    '获奖通知',
    '本届竞赛初赛由各市承办赛区组织，赛区获奖名单报省组委会统一审核公布，赛区获奖按<b>省级</b>认定。',
    '省大学生竞赛组织委员会',
    '二〇二六年七月',
    '#f4f7fd',
  ),
  'roster-1': table(
    '参赛队伍名单与成绩（节选）',
    ['序号', '参赛单位', '项目', '队员编号', '成绩'],
    [
      ['7', '示例大学', '健身操舞', 'DEMO-07-01 至 07-08', '团体第三名'],
      ['8', '滨海理工大学', '健身操舞', 'DEMO-08-01 至 08-08', '团体第四名'],
    ],
    '成绩册由赛事组委会印发，本页为演示用截图。',
  ),
  'research-3': certificate(
    '立项通知书',
    '经评审，该同学主持的大学生创新创业训练计划项目获准<b>省级立项</b>，请按计划开展研究。',
    '省教育厅高等教育处（示例）',
    '二〇二五年十一月',
  ),
  'application-1': form(
    '推荐免试研究生申请表',
    [
      ['申请类别', '学术学位'],
      ['前三学年平均学分绩', '见学院导入数据'],
      ['英语水平', '全国大学英语四级'],
    ],
    '本人自愿申请推荐免试攻读硕士学位研究生，保证所填信息与所附材料真实有效。',
    '申请人（签字）',
  ),
  'conduct-1': form(
    '推免生思想品德考核表',
    [
      ['政治表现', '积极参加理论学习与主题教育活动'],
      ['遵纪守法', '无违纪处分记录'],
      ['集体活动', '积极参加班级与学院组织的集体活动'],
    ],
    '本人鉴定：在校期间认真学习，遵守校纪校规，团结同学，积极参加志愿服务。',
    '本人（签字）',
  ),
  'signature-1': certificate(
    '考核意见',
    '经班级评议与班主任审核，该生思想政治表现良好，遵守校纪校规，同意推荐。',
    '示例大学软件学院',
    '班主任（签字）　二〇二六年九月',
    '#f3f8f3',
  ),
  'transcript-1': page(
    `<div class="plain"><div class="bar"></div><h2>学生成绩单（前三学年，节选）</h2>
     <table><tr><th>学年</th><th>课程</th><th>学分</th><th>成绩</th></tr>
     <tr><td>2023-2024</td><td>高等数学</td><td>5</td><td>91</td></tr>
     <tr><td>2023-2024</td><td>程序设计基础</td><td>4</td><td>95</td></tr>
     <tr><td>2024-2025</td><td>数据结构</td><td>4</td><td>93</td></tr>
     <tr><td>2025-2026</td><td>操作系统</td><td>4</td><td>89</td></tr></table>
     <p style="margin-top:26px;font-size:19px;color:#555;text-indent:0">教务处盖章后有效，本页为演示用截图。</p>
     ${seal('示例大学教务处')}</div>`,
    '#fff',
  ),
}
