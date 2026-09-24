// The scoring formulas the demonstration's rules use, as a school's staff
// would write them in the formula workbench.
//
// A formula sees three kinds of input, and the rules module decides which
// is which for every question that uses it:
//
// - a constant the administrator fixed for the batch (0.2 for taking part,
//   0.5 for a team, the score of a first place) - formulas cannot write a
//   fractional literal, so every such number is a constant by construction,
//   and a later batch changing one is a rule change nobody had to recode
// - a value the reviewer determines on approval (the level, the place, the
//   points an organiser set), which the student's own filing pre-fills
// - nothing else: no formula reads the form directly
//
// Tables that are pure structure (research kind by role) are written in
// tenths and multiplied by a score-unit constant.

export interface FormulaTest {
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
  readonly expected: string
}

export interface FormulaVersion {
  readonly releaseName: string
  readonly releaseNotes?: string
  readonly source: string
  readonly tests: readonly FormulaTest[]
}

export interface FormulaSpec {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly versions: readonly FormulaVersion[]
}

const zh = (title: string, description?: string) =>
  `{ title: '${title}'${description === undefined ? '' : `, description: '${description}'`}, i18n: { 'zh-CN': { title: '${title}'${description === undefined ? '' : `, description: '${description}'`} } } }`

const decimalInput = (title: string, minimum: string, maximum: string, description?: string) =>
  `Schema.decimal({ minimum: '${minimum}', maximum: '${maximum}', maxScale: 2, ...${zh(title, description)} })`

const LEVELS = `{ national: '国家级', provincial: '省部级', municipal: '市级' }`

const identity: FormulaSpec = {
  key: 'identity',
  name: '认定分值',
  description:
    '得分即认定的分值。用于学业成绩、青年大学习、其他加减分等由管理员直接给出分值的项目。',
  versions: [
    {
      releaseName: '初版',
      source: `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: ${decimalInput('认定分值', '-20', '75')},
  }),
  output: Schema.scoreAmount(),
  run: (input) => input.value,
})
`,
      tests: [
        { name: '正分', input: { value: '61.16' }, expected: '61.16' },
        { name: '扣分', input: { value: '-0.5' }, expected: '-0.5' },
      ],
    },
  ],
}

const campusSource = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    participation: ${decimalInput('参与分', '0', '1', '活动主办方公布的参与分值')},
    awardLevel: Schema.choice(
      { none: '未获奖', college: '院级', university: '校级' },
      { title: '获奖级别', i18n: { 'zh-CN': { title: '获奖级别', enumLabels: { none: '未获奖', college: '院级', university: '校级' } } } },
    ),
    awardRank: Schema.integer({ minimum: 1, maximum: 4, ...${zh('获奖名次', '1 至 3 为第一至第三名，4 为第三名以下')} }),
    collegeFirst: ${decimalInput('院级第一名加分', '0', '1')},
    universityFirst: ${decimalInput('校级第一名加分', '0', '1')},
    rankStep: ${decimalInput('名次递减', '0', '1')},
  }),
  output: Schema.scoreAmount(),
  run: (input, q) => {
    const d = q.decimal
    if (input.awardLevel === 'none') return input.participation
    const first = input.awardLevel === 'college' ? input.collegeFirst : input.universityFirst
    const award = d.max(d.sub(first, d.mulInteger(input.rankStep, input.awardRank - 1)), d.fromInteger(0))
    return d.add(input.participation, award)
  },
})
`

const campusConstants = { collegeFirst: '0.4', universityFirst: '0.5', rankStep: '0.1' }

const campus: FormulaSpec = {
  key: 'campus',
  name: '校园文化活动',
  description: '参与分加获奖加分。获奖加分按级别与名次递减，第三名以下按第四名计。',
  versions: [
    {
      releaseName: '初版',
      source: campusSource,
      tests: [
        {
          name: '只参与',
          input: { ...campusConstants, participation: '0.2', awardLevel: 'none', awardRank: 1 },
          expected: '0.2',
        },
        {
          name: '校级第一名',
          input: {
            ...campusConstants,
            participation: '0.2',
            awardLevel: 'university',
            awardRank: 1,
          },
          expected: '0.7',
        },
        {
          name: '院级第三名以下',
          input: { ...campusConstants, participation: '0.2', awardLevel: 'college', awardRank: 4 },
          expected: '0.3',
        },
      ],
    },
  ],
}

const competitionConstants = {
  nationalFirst: '3',
  provincialFirst: '2',
  municipalFirst: '1',
  rankStep: '0.2',
  teamFactor: '0.5',
}

const competitionSource = (
  teamStep: boolean,
) => `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    level: Schema.choice(${LEVELS}, { title: '竞赛级别', i18n: { 'zh-CN': { title: '竞赛级别', enumLabels: ${LEVELS} } } }),
    rank: Schema.integer({ minimum: 1, maximum: 20, ...${zh('折算名次', '一等奖为第 1 名，依次类推')} }),
    team: Schema.boolean(${zh('集体项目')}),
    nationalFirst: ${decimalInput('国家级第一名', '0', '10')},
    provincialFirst: ${decimalInput('省部级第一名', '0', '10')},
    municipalFirst: ${decimalInput('市级第一名', '0', '10')},
    rankStep: ${decimalInput('名次递减', '0', '1')},
    teamFactor: ${decimalInput('集体项目系数', '0', '1')},${
      teamStep
        ? `
    teamRankStep: ${decimalInput('集体项目名次递减', '0', '1')},`
        : ''
    }
  }),
  output: Schema.scoreAmount(),
  run: (input, q) => {
    const d = q.decimal
    const first =
      input.level === 'national'
        ? input.nationalFirst
        : input.level === 'provincial'
          ? input.provincialFirst
          : input.municipalFirst
    const base = input.team ? d.mul(first, input.teamFactor) : first
    const step = ${teamStep ? 'input.team ? input.teamRankStep : input.rankStep' : 'input.rankStep'}
    return d.max(d.sub(base, d.mulInteger(step, input.rank - 1)), d.fromInteger(0))
  },
})
`

const competition: FormulaSpec = {
  key: 'competition',
  name: '市级以上学术竞赛',
  description: '按级别取第一名分值，名次每后一名递减，集体项目减半。',
  versions: [
    {
      releaseName: '初版',
      source: competitionSource(false),
      tests: [
        {
          name: '省级第三名（个人）',
          input: { ...competitionConstants, level: 'provincial', rank: 3, team: false },
          expected: '1.6',
        },
        {
          name: '国家级第一名（集体）',
          input: { ...competitionConstants, level: 'national', rank: 1, team: true },
          expected: '1.5',
        },
      ],
    },
    {
      releaseName: '集体项目递减 0.1',
      releaseNotes: '按新版细则，集体项目的名次递减由 0.2 调整为 0.1。',
      source: competitionSource(true),
      tests: [
        {
          name: '省级第三名（集体）',
          input: {
            ...competitionConstants,
            teamRankStep: '0.1',
            level: 'provincial',
            rank: 3,
            team: true,
          },
          expected: '0.8',
        },
        {
          name: '国家级第四名（集体）',
          input: {
            ...competitionConstants,
            teamRankStep: '0.1',
            level: 'national',
            rank: 4,
            team: true,
          },
          expected: '1.2',
        },
        {
          name: '省级第三名（个人）',
          input: {
            ...competitionConstants,
            teamRankStep: '0.1',
            level: 'provincial',
            rank: 3,
            team: false,
          },
          expected: '1.6',
        },
      ],
    },
  ],
}

const SPORT_AWARDS = `{ none: '未获奖', national: '国家级', provincial: '省部级', municipal: '市级' }`

const sportConstants = {
  nationalParticipation: '1.5',
  provincialParticipation: '1.2',
  municipalParticipation: '1',
  nationalFirst: '1',
  provincialFirst: '0.8',
  municipalFirst: '0.6',
  rankStep: '0.2',
  teamRankStep: '0.1',
  teamFactor: '0.5',
}

const sport: FormulaSpec = {
  key: 'sport',
  name: '非专业领域文体实践',
  description: '按参与级别给参与分；获市级以上奖励另加奖分，名次递减，集体项目减半。',
  versions: [
    {
      releaseName: '初版',
      source: `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    participationLevel: Schema.choice(${LEVELS}, { title: '参与级别', i18n: { 'zh-CN': { title: '参与级别', enumLabels: ${LEVELS} } } }),
    awardLevel: Schema.choice(${SPORT_AWARDS}, { title: '获奖级别', i18n: { 'zh-CN': { title: '获奖级别', enumLabels: ${SPORT_AWARDS} } } }),
    rank: Schema.integer({ minimum: 1, maximum: 20, ...${zh('折算名次')} }),
    team: Schema.boolean(${zh('集体项目')}),
    nationalParticipation: ${decimalInput('国家级参与分', '0', '5')},
    provincialParticipation: ${decimalInput('省部级参与分', '0', '5')},
    municipalParticipation: ${decimalInput('市级参与分', '0', '5')},
    nationalFirst: ${decimalInput('国家级第一名奖分', '0', '5')},
    provincialFirst: ${decimalInput('省部级第一名奖分', '0', '5')},
    municipalFirst: ${decimalInput('市级第一名奖分', '0', '5')},
    rankStep: ${decimalInput('名次递减', '0', '1')},
    teamRankStep: ${decimalInput('集体项目名次递减', '0', '1')},
    teamFactor: ${decimalInput('集体项目系数', '0', '1')},
  }),
  output: Schema.scoreAmount(),
  run: (input, q) => {
    const d = q.decimal
    const participation =
      input.participationLevel === 'national'
        ? input.nationalParticipation
        : input.participationLevel === 'provincial'
          ? input.provincialParticipation
          : input.municipalParticipation
    if (input.awardLevel === 'none') return participation
    const first =
      input.awardLevel === 'national'
        ? input.nationalFirst
        : input.awardLevel === 'provincial'
          ? input.provincialFirst
          : input.municipalFirst
    const base = input.team ? d.mul(first, input.teamFactor) : first
    const step = input.team ? input.teamRankStep : input.rankStep
    const award = d.max(d.sub(base, d.mulInteger(step, input.rank - 1)), d.fromInteger(0))
    return d.add(participation, award)
  },
})
`,
      tests: [
        {
          name: '省级参与、省级第一名（集体）',
          input: {
            ...sportConstants,
            participationLevel: 'provincial',
            awardLevel: 'provincial',
            rank: 1,
            team: true,
          },
          expected: '1.6',
        },
        {
          name: '市级参与、未获奖',
          input: {
            ...sportConstants,
            participationLevel: 'municipal',
            awardLevel: 'none',
            rank: 1,
            team: false,
          },
          expected: '1',
        },
      ],
    },
  ],
}

/** a table in tenths, by a choice, times the score unit */
const tableSource = (
  choices: readonly { key: string; label: string; tenths: number }[],
  input: { name: string; title: string },
) => {
  const labels = `{ ${choices.map((c) => `'${c.key}': '${c.label}'`).join(', ')} }`
  const table = `{ ${choices.map((c) => `'${c.key}': ${c.tenths}`).join(', ')} }`
  return `import { Schema, defineFormula } from '@qualy/formula'

const TENTHS = ${table}

export default defineFormula({
  input: Schema.input({
    ${input.name}: Schema.choice(${labels}, { title: '${input.title}', i18n: { 'zh-CN': { title: '${input.title}', enumLabels: ${labels} } } }),
    scoreUnit: ${decimalInput('分值单位', '0', '1', '表中分值以此为单位，通常为 0.1')},
  }),
  output: Schema.scoreAmount(),
  run: (input, q) => q.decimal.mulInteger(input.scoreUnit, TENTHS[input.${input.name}]),
})
`
}

const RESEARCH_KINDS = [
  ['paper-core', '专业相关论文 - 核心刊物', [50, 30, 20, 10, 5]],
  ['paper-general', '专业相关论文 - 一般刊物', [30, 20, 10, 8, 4]],
  ['paper-proceedings', '专业相关论文 - 正式出版的论文集', [20, 10, 8, 6, 3]],
  ['project-national', '专业相关科研课题立项 - 国家级', [50, 40, 35, 30, 15]],
  ['project-provincial', '专业相关科研课题立项 - 省部级', [40, 30, 25, 20, 10]],
  ['project-university', '专业相关科研课题立项 - 校级', [20, 10, 8, 6, 3]],
  ['utility-patent', '专业相关知识产权成果 - 实用新型专利', [30, 20, 10, 5, 3]],
  ['software', '专业相关知识产权成果 - 软件著作权', [10, 8, 6, 4, 2]],
] as const
const RESEARCH_ROLES = [
  ['lead', '主持人'],
  ['first', '第一参与人'],
  ['second', '第二参与人'],
  ['third', '第三参与人'],
  ['fourth', '第四参与人'],
] as const

const research: FormulaSpec = {
  key: 'research',
  name: '科研',
  description: '按科研成果类别与参与身份查表。',
  versions: [
    {
      releaseName: '初版',
      source: `import { Schema, defineFormula } from '@qualy/formula'

const TENTHS: Record<string, readonly number[]> = {
${RESEARCH_KINDS.map(([key, , row]) => `  '${key}': [${row.join(', ')}],`).join('\n')}
}
const ROLES = [${RESEARCH_ROLES.map(([key]) => `'${key}'`).join(', ')}] as const
const KINDS = { ${RESEARCH_KINDS.map(([key, label]) => `'${key}': '${label}'`).join(', ')} }
const ROLE_LABELS = { ${RESEARCH_ROLES.map(([key, label]) => `'${key}': '${label}'`).join(', ')} }

export default defineFormula({
  input: Schema.input({
    kind: Schema.choice(KINDS, { title: '成果类别', i18n: { 'zh-CN': { title: '成果类别', enumLabels: KINDS } } }),
    role: Schema.choice(ROLE_LABELS, { title: '参与身份', i18n: { 'zh-CN': { title: '参与身份', enumLabels: ROLE_LABELS } } }),
    scoreUnit: ${decimalInput('分值单位', '0', '1', '表中分值以此为单位，通常为 0.1')},
  }),
  output: Schema.scoreAmount(),
  run: (input, q) => {
    const row = TENTHS[input.kind]
    if (row === undefined) return q.fail('unknown research kind')
    return q.decimal.mulInteger(input.scoreUnit, row[ROLES.indexOf(input.role)] ?? 0)
  },
})
`,
      tests: [
        {
          name: '一般刊物主持人',
          input: { kind: 'paper-general', role: 'lead', scoreUnit: '0.1' },
          expected: '3',
        },
        {
          name: '软件著作权第三参与人',
          input: { kind: 'software', role: 'third', scoreUnit: '0.1' },
          expected: '0.4',
        },
      ],
    },
  ],
}

const tableFormula = (
  key: string,
  name: string,
  description: string,
  input: { name: string; title: string },
  choices: readonly { key: string; label: string; tenths: number }[],
  tests: readonly FormulaTest[],
): FormulaSpec => ({
  key,
  name,
  description,
  versions: [{ releaseName: '初版', source: tableSource(choices, input), tests }],
})

const article = tableFormula(
  'article',
  '学术论文、期刊投稿',
  '按发表渠道查表。',
  { name: 'outlet', title: '发表渠道' },
  [
    { key: 'news-national', label: '全国性官方新闻网站', tenths: 10 },
    { key: 'news-provincial', label: '省市级官方新闻网站', tenths: 5 },
    { key: 'journal-national', label: '校外全国性刊物', tenths: 15 },
    { key: 'journal-provincial', label: '校外省市级刊物', tenths: 10 },
    { key: 'campus', label: '校内刊物、网站或公众号', tenths: 3 },
  ],
  [
    {
      name: '全国性刊物',
      input: { outlet: 'journal-national', scoreUnit: '0.1' },
      expected: '1.5',
    },
  ],
)

const cadre = tableFormula(
  'cadre',
  '学生干部',
  '按职务等级给分，身兼多职者取最高。',
  { name: 'tier', title: '职务等级' },
  [
    { key: 'president', label: '学生组织主席团成员、分团委副书记', tenths: 30 },
    { key: 'officer', label: '学生组织部长、年级长、团支书、班长', tenths: 20 },
    { key: 'deputy', label: '学生组织副部长、学习委员', tenths: 15 },
    { key: 'member', label: '学生组织部员、其他班委', tenths: 10 },
  ],
  [{ name: '班长', input: { tier: 'officer', scoreUnit: '0.1' }, expected: '2' }],
)

const dorm = tableFormula(
  'dorm',
  '优秀寝室',
  '寝室卫生检查学期平均 90 分及以上，寝室长与成员分别给分。',
  { name: 'role', title: '寝室身份' },
  [
    { key: 'leader', label: '寝室长', tenths: 10 },
    { key: 'member', label: '寝室成员', tenths: 8 },
  ],
  [{ name: '成员', input: { role: 'member', scoreUnit: '0.1' }, expected: '0.8' }],
)

const perCount: FormulaSpec = {
  key: 'per-count',
  name: '按次数计分',
  description: '次数乘以每次分值，用于早晚自习缺勤、不及格课程等按次数扣分的项目。',
  versions: [
    {
      releaseName: '初版',
      source: `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    count: Schema.integer({ minimum: 0, maximum: 50, ...${zh('次数')} }),
    perTime: ${decimalInput('每次分值', '-5', '5')},
  }),
  output: Schema.scoreAmount(),
  run: (input, q) => q.decimal.mulInteger(input.perTime, input.count),
})
`,
      tests: [
        { name: '缺勤 5 次', input: { count: 5, perTime: '-0.5' }, expected: '-2.5' },
        { name: '不及格 2 门', input: { count: 2, perTime: '-1' }, expected: '-2' },
      ],
    },
  ],
}

const allRound: FormulaSpec = {
  key: 'all-round',
  name: '全科优秀加分',
  description: '所修课程全部 85 分及以上加 2 分，全部 80 分及以上加 1 分。',
  versions: [
    {
      releaseName: '初版',
      source: `import { Schema, defineFormula } from '@qualy/formula'

const TIERS = { excellent: '全部 85 分及以上', good: '全部 80 分及以上' }

export default defineFormula({
  input: Schema.input({
    tier: Schema.choice(TIERS, { title: '成绩档次', i18n: { 'zh-CN': { title: '成绩档次', enumLabels: TIERS } } }),
  }),
  output: Schema.scoreAmount(),
  run: (input, q) => q.decimal.fromInteger(input.tier === 'excellent' ? 2 : 1),
})
`,
      tests: [{ name: '全部 85 分及以上', input: { tier: 'excellent' }, expected: '2' }],
    },
  ],
}

const scaled: FormulaSpec = {
  key: 'scaled',
  name: '按系数折算',
  description:
    '认定值乘以折算系数。推免中用于学业成绩（平均学分绩 × 0.8）与品德文体（六学期均值 × 0.4）。',
  versions: [
    {
      releaseName: '初版',
      source: `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: ${decimalInput('认定值', '0', '100')},
    factor: ${decimalInput('折算系数', '0', '1')},
  }),
  output: Schema.scoreAmount(),
  run: (input, q) => q.decimal.quantize(q.decimal.mul(input.value, input.factor), 2),
})
`,
      tests: [
        { name: '平均学分绩 94.48', input: { value: '94.48', factor: '0.8' }, expected: '75.58' },
        { name: '品德文体 21.4', input: { value: '21.4', factor: '0.4' }, expected: '8.56' },
      ],
    },
  ],
}

export const FORMULAS: readonly FormulaSpec[] = [
  identity,
  campus,
  competition,
  sport,
  research,
  article,
  cadre,
  dorm,
  perCount,
  allRound,
  scaled,
]
