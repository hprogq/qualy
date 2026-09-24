// Proof images for the demonstration, rendered once and committed.
//
//   node tools/demo/render-assets.ts
//
// A claim needs something attached, and real certificates carry real names,
// numbers and seals. These are drawn from HTML instead: a certificate, a
// participation note, a volunteering record, a score report - each with a
// made-up seal and a watermark saying what it is. None names a person, so
// the same image can stand behind any claim of its kind.

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const OUT = 'tools/demo/assets'

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

const certificate = (title: string, text: string, issuer: string, date: string, tone = '#fbf6ea') =>
  page(
    `<div class="frame"><h1>${title}</h1><p>${text}</p>
     <div class="sign">${issuer}<br/>${date}</div>${seal(issuer.slice(0, 10))}</div>`,
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

const ASSETS: Record<string, string> = {
  'campus-1': certificate(
    '参与证明',
    '兹证明该同学参加由示例大学软件学院组织的校园文化活动，全程认真参与，表现良好。',
    '示例大学软件学院团委',
    '二〇二四年十一月',
  ),
  'campus-2': certificate(
    '荣誉证书',
    '该同学在校园文化活动中表现突出，荣获<b>二等奖</b>，特发此证，以资鼓励。',
    '示例大学学生工作处',
    '二〇二五年五月',
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
  'competition-1': certificate(
    '获奖证书',
    '该参赛队在省级大学生学科竞赛中表现优异，荣获<b>省级一等奖</b>。',
    '省大学生竞赛组织委员会',
    '二〇二五年六月',
  ),
  'competition-2': certificate(
    '获奖证书',
    '该同学在全国大学生学科竞赛中荣获<b>国家级三等奖</b>，特发此证。',
    '全国竞赛组织委员会',
    '二〇二四年十二月',
    '#f4f7fd',
  ),
  'competition-3': certificate(
    '荣誉证书',
    '该同学在市大学生程序设计竞赛中荣获<b>二等奖</b>。',
    '滨海市大学生竞赛委员会',
    '二〇二四年五月',
  ),
  'certificate-1': table(
    '全国大学英语等级考试 成绩报告（示例）',
    ['考试科目', '考试时间', '总分', '听力', '阅读', '写作和翻译'],
    [['英语四级', '2024 年 6 月', '531', '189', '196', '146']],
    '本截图仅用于系统演示，成绩与任何个人无关。',
  ),
  'certificate-2': table(
    '全国大学英语等级考试 成绩报告（示例）',
    ['考试科目', '考试时间', '总分', '听力', '阅读', '写作和翻译'],
    [['英语六级', '2024 年 12 月', '476', '162', '181', '133']],
    '本截图仅用于系统演示，成绩与任何个人无关。',
  ),
  'certificate-3': certificate(
    '合格证书',
    '该同学参加全国计算机等级考试，成绩合格，特发此证。',
    '考试中心（示例）',
    '二〇二四年九月',
    '#f3f8f3',
  ),
  'practice-1': certificate(
    '社会实践证明',
    '该同学于假期参加“返家乡”社会实践活动，按要求完成调研与服务任务，经考核合格。',
    '示例大学团委',
    '二〇二四年九月',
  ),
  'practice-2': table(
    '志愿服务时长记录（示例）',
    ['服务项目', '服务时间', '时长（小时）', '状态'],
    [
      ['社区养老院助老服务', '2025-04-12', '4', '已认证'],
      ['图书馆志愿服务', '2025-05-09', '3', '已认证'],
      ['城市马拉松志愿者', '2025-05-18', '8', '已认证'],
    ],
    '数据截取自志愿服务平台，本页为演示用截图。',
  ),
  'practice-3': certificate(
    '志愿服务证明',
    '该同学在志愿服务活动中认真负责、热情周到，累计服务时长 12 小时。',
    '示例大学青年志愿者协会',
    '二〇二五年六月',
    '#f4f7fd',
  ),
  'research-1': certificate(
    '立项通知书',
    '经评审，该同学主持的大学生创新创业训练计划项目获准<b>校级立项</b>。',
    '示例大学教务处',
    '二〇二四年十月',
  ),
  'research-2': table(
    '计算机软件著作权登记证书（示例）',
    ['软件名称', '登记号', '权利取得方式'],
    [['校园服务数据可视化平台 V1.0', '2025SR000000（示例）', '原始取得']],
    '登记号为演示用虚构编号。',
  ),
  'blood-1': table(
    '无偿献血证（示例）',
    ['献血日期', '献血量', '献血地点', '编号'],
    [['2024-11-20', '300 ml', '校园流动献血车', 'DEMO-0000']],
    '编号为演示用虚构编号。',
  ),
  'honour-1': certificate(
    '荣誉证书',
    '该同学在新生军训中表现突出，被评为<b>优秀学生教官</b>。',
    '示例大学武装部',
    '二〇二四年九月',
    '#fdf2f2',
  ),
  'article-1': table(
    '文章发表页（截图示例）',
    ['栏目', '标题', '发布时间'],
    [['校园动态', '青春助老践初心，温情陪伴暖夕阳', '2025-05-13']],
    '截图来自演示用网页，链接与内容均为虚构。',
  ),
  'sport-1': certificate(
    '荣誉证书',
    '该同学代表学校参加市高校学生阳光体育长跑比赛，荣获<b>团体第三名</b>。',
    '滨海市高校体育协会',
    '二〇二五年十一月',
  ),
}

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 960, height: 680 } })
const tab = await context.newPage()
for (const [name, html] of Object.entries(ASSETS)) {
  await tab.setContent(html, { waitUntil: 'load' })
  await tab.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 72 })
}
await browser.close()
console.log(`rendered ${Object.keys(ASSETS).length} images into ${OUT}`)
