// The questions each term asked, and where every number in them comes from.
//
// Four kinds of value, kept apart on purpose, because they are four
// different people's decisions:
//
// - fixed by the administrator for the batch: a `constant` binding, or a
//   `fixed` score. Changing one between terms is how the rules evolved.
// - submitted when filing: the form's `fields`, filled by the student - or,
//   on an administrative question, by the staff member recording the fact.
// - determined on review: a `recognition`, what the reviewer confirms or
//   corrects when approving. The formula only ever reads these.
// - bound: a recognition's `fromField` names the filed field that pre-fills
//   it. The student says "provincial, third place"; the reviewer sees that
//   and may change it to "second" before approving.
//
// Terms differ in three places, which are the rule changes the demonstration
// is there to show: the youth-study question exists until 25-26-1, the
// vocational certificate becomes a language certificate in 25-26-2, the
// college-level campus prize was worth 0.3 until 23-24-2 raised it to 0.4,
// and the competition formula's second version (team places step down by
// 0.1) is used from 23-24-2 on.

import {
  CADRE_POSTS,
  LANGUAGE_CERTIFICATES,
  PRACTICE_EVIDENCE,
  RESEARCH_KINDS,
  RESEARCH_ROLES,
  VOCATIONAL_CERTIFICATES,
} from './catalog.ts'
import type { TERMS } from './compile.ts'

export type Term = (typeof TERMS)[number]

/** the score tree; `parent` names another group of the same batch */
export interface GroupSpec {
  readonly key: string
  readonly name: string
  readonly parent: string | null
  readonly cap: string
  readonly floor: string | null
}

export const GROUPS: readonly GroupSpec[] = [
  { key: 'paper', name: '综合素质测评', parent: null, cap: '100.00', floor: '0.00' },
  { key: 'moral', name: '品德行为表现', parent: 'paper', cap: '15.00', floor: '0.00' },
  { key: 'honour', name: '优秀学生教官与国旗班', parent: 'moral', cap: '3.00', floor: null },
  { key: 'practice', name: '社会实践与志愿服务', parent: 'moral', cap: '1.00', floor: null },
  { key: 'academic', name: '学业表现', parent: 'paper', cap: '75.00', floor: '0.00' },
  { key: 'sports', name: '文体表现', parent: 'paper', cap: '10.00', floor: '0.00' },
  { key: 'cadre', name: '学生干部', parent: 'sports', cap: '3.00', floor: null },
  { key: 'activity', name: '文体活动', parent: 'sports', cap: '4.00', floor: null },
]

/** a form field, in the evidence driver's own terms */
export type FieldSpec =
  | {
      readonly key: string
      readonly type: 'text'
      readonly label: string
      readonly required?: boolean
      readonly maxLength?: number
      readonly description?: string
    }
  | {
      readonly key: string
      readonly type: 'date'
      readonly label: string
      readonly required?: boolean
      readonly inMaterialRange?: boolean
    }
  | {
      readonly key: string
      readonly type: 'integer'
      readonly label: string
      readonly required?: boolean
      readonly min?: number
      readonly max?: number
      readonly description?: string
    }
  | {
      readonly key: string
      readonly type: 'decimal'
      readonly label: string
      readonly required?: boolean
      readonly maxScale: number
      readonly min?: string
      readonly max?: string
      readonly description?: string
    }
  | {
      readonly key: string
      readonly type: 'choice'
      readonly label: string
      readonly required?: boolean
      readonly options: readonly { readonly value: string; readonly label: string }[]
    }
  | {
      readonly key: string
      readonly type: 'boolean'
      readonly label: string
      readonly required?: boolean
    }
  | {
      readonly key: string
      readonly type: 'attachment'
      readonly label: string
      readonly required?: boolean
      readonly maxCount: number
      readonly description?: string
    }

export type ScoringSpec =
  /** one score per claim, fixed by the administrator */
  | { readonly kind: 'fixed'; readonly value: string }
  | {
      readonly kind: 'formula'
      readonly formula: string
      /** which published version, 1-based */
      readonly version: number
      /** fixed by the administrator for this batch */
      readonly constants: Readonly<Record<string, string>>
      /**
       * determined on review, each read by the formula input of the same
       * name; `fromField` is the filed field that pre-fills it
       */
      readonly recognitions: Readonly<
        Record<string, { readonly label: string; readonly fromField?: string }>
      >
    }

export interface ItemSpec {
  readonly key: string
  readonly title: string
  readonly group: string
  /**
   * who files it: the participant, staff recording a fact, or nobody - a
   * base score every participant has
   */
  readonly channel: 'participant' | 'administrative' | 'constant'
  readonly maxEntries: number | null
  readonly fields: readonly FieldSpec[]
  readonly scoring: ScoringSpec
  readonly aggregator: 'sum' | 'max'
  readonly description?: string
}

const proof = (label = '证明材料', maxCount = 3): FieldSpec => ({
  key: 'proof',
  type: 'attachment',
  label,
  required: true,
  maxCount,
})

const LEVEL_OPTIONS = [
  { value: 'national', label: '国家级' },
  { value: 'provincial', label: '省部级' },
  { value: 'municipal', label: '市级' },
]

const choicesOf = (items: readonly { value: string; label: string }[]) =>
  items.map(({ value, label }) => ({ value, label }))

// --- 品德行为表现 ------------------------------------------------------------

const moralBase: ItemSpec = {
  key: 'moral-base',
  title: '品德行为基础分',
  group: 'moral',
  channel: 'constant',
  maxEntries: null,
  fields: [],
  scoring: { kind: 'fixed', value: '9.00' },
  aggregator: 'sum',
  description: '教师评价 8 分与学生互评 1 分',
}

const dorm: ItemSpec = {
  key: 'dorm',
  title: '优秀寝室',
  group: 'moral',
  channel: 'administrative',
  maxEntries: 1,
  fields: [
    { key: 'room', type: 'text', label: '寝室号', required: true, maxLength: 20 },
    {
      key: 'role',
      type: 'choice',
      label: '寝室身份',
      required: true,
      options: [
        { value: 'leader', label: '寝室长' },
        { value: 'member', label: '寝室成员' },
      ],
    },
    {
      key: 'average',
      type: 'decimal',
      label: '学期卫生检查平均分',
      required: true,
      maxScale: 1,
      min: '90',
      max: '100',
    },
  ],
  scoring: {
    kind: 'formula',
    formula: 'dorm',
    version: 1,
    constants: { scoreUnit: '0.1' },
    recognitions: { role: { label: '寝室身份', fromField: 'role' } },
  },
  aggregator: 'sum',
}

const blood: ItemSpec = {
  key: 'blood',
  title: '无偿献血',
  group: 'moral',
  channel: 'participant',
  maxEntries: 1,
  fields: [
    { key: 'donated-on', type: 'date', label: '献血日期', required: true, inMaterialRange: true },
    { key: 'certificate-no', type: 'text', label: '献血证编号', required: true, maxLength: 30 },
    proof('献血证照片', 2),
  ],
  scoring: { kind: 'fixed', value: '1.00' },
  aggregator: 'sum',
}

const veteran: ItemSpec = {
  key: 'veteran',
  title: '退役复学',
  group: 'moral',
  channel: 'participant',
  maxEntries: 1,
  fields: [proof('退役证书', 1)],
  scoring: { kind: 'fixed', value: '3.00' },
  aggregator: 'sum',
}

const instructor: ItemSpec = {
  key: 'instructor',
  title: '优秀学生教官',
  group: 'honour',
  channel: 'participant',
  maxEntries: 1,
  fields: [proof('荣誉证书', 1)],
  scoring: { kind: 'fixed', value: '2.00' },
  aggregator: 'sum',
}

const flagGuard: ItemSpec = {
  key: 'flag-guard',
  title: '国旗班成员',
  group: 'honour',
  channel: 'participant',
  maxEntries: 1,
  fields: [proof('国旗班成员证明', 1)],
  scoring: { kind: 'fixed', value: '2.00' },
  aggregator: 'sum',
}

const youthStudy: ItemSpec = {
  key: 'youth-study',
  title: '青年大学习',
  group: 'moral',
  channel: 'administrative',
  maxEntries: 1,
  fields: [
    {
      key: 'score',
      type: 'decimal',
      label: '学习完成度得分',
      required: true,
      maxScale: 2,
      min: '0',
      max: '1',
      description: '按团支部导出的完成率折算',
    },
  ],
  scoring: {
    kind: 'formula',
    formula: 'identity',
    version: 1,
    constants: {},
    recognitions: { value: { label: '认定分值', fromField: 'score' } },
  },
  aggregator: 'sum',
}

const practice: ItemSpec = {
  key: 'practice',
  title: '社会实践与志愿服务',
  group: 'practice',
  channel: 'participant',
  maxEntries: 6,
  fields: [
    { key: 'activity', type: 'text', label: '活动名称', required: true, maxLength: 60 },
    {
      key: 'type',
      type: 'choice',
      label: '活动类型',
      required: true,
      options: [
        { value: 'practice', label: '社会实践' },
        { value: 'volunteer', label: '志愿服务' },
      ],
    },
    {
      key: 'evidence',
      type: 'choice',
      label: '佐证材料类型',
      required: true,
      options: choicesOf(PRACTICE_EVIDENCE),
    },
    proof(),
  ],
  scoring: { kind: 'fixed', value: '0.50' },
  aggregator: 'sum',
  description: '每项 0.5 分，本组最高 1 分',
}

const selfStudy: ItemSpec = {
  key: 'self-study',
  title: '早晚自习缺勤',
  group: 'moral',
  channel: 'administrative',
  maxEntries: 1,
  fields: [
    { key: 'absences', type: 'integer', label: '缺勤次数', required: true, min: 1, max: 30 },
  ],
  scoring: {
    kind: 'formula',
    formula: 'per-count',
    version: 1,
    constants: { perTime: '-0.5' },
    recognitions: { count: { label: '缺勤次数', fromField: 'absences' } },
  },
  aggregator: 'sum',
}

const moralOther: ItemSpec = {
  key: 'moral-other',
  title: '其他加减分',
  group: 'moral',
  channel: 'administrative',
  maxEntries: 3,
  fields: [
    {
      key: 'value',
      type: 'decimal',
      label: '加减分值',
      required: true,
      maxScale: 2,
      min: '-5',
      max: '3',
    },
    { key: 'basis', type: 'text', label: '依据', required: true, maxLength: 120 },
  ],
  scoring: {
    kind: 'formula',
    formula: 'identity',
    version: 1,
    constants: {},
    recognitions: { value: { label: '认定分值', fromField: 'value' } },
  },
  aggregator: 'sum',
}

// --- 学业表现 ----------------------------------------------------------------

const academicBase: ItemSpec = {
  key: 'academic-base',
  title: '学业成绩基础分',
  group: 'academic',
  channel: 'administrative',
  maxEntries: 1,
  fields: [
    {
      key: 'average',
      type: 'decimal',
      label: '平均学分绩',
      required: true,
      maxScale: 2,
      min: '0',
      max: '100',
    },
    {
      key: 'score',
      type: 'decimal',
      label: '学业基础分',
      required: true,
      maxScale: 2,
      min: '0',
      max: '75',
      description: '平均学分绩乘以 75%',
    },
  ],
  scoring: {
    kind: 'formula',
    formula: 'identity',
    version: 1,
    constants: {},
    recognitions: { value: { label: '学业基础分', fromField: 'score' } },
  },
  aggregator: 'sum',
}

const allRound: ItemSpec = {
  key: 'all-round',
  title: '全科优秀加分',
  group: 'academic',
  channel: 'administrative',
  maxEntries: 1,
  fields: [
    {
      key: 'tier',
      type: 'choice',
      label: '成绩档次',
      required: true,
      options: [
        { value: 'excellent', label: '全部 85 分及以上' },
        { value: 'good', label: '全部 80 分及以上' },
      ],
    },
  ],
  scoring: {
    kind: 'formula',
    formula: 'all-round',
    version: 1,
    constants: {},
    recognitions: { tier: { label: '成绩档次', fromField: 'tier' } },
  },
  aggregator: 'sum',
}

const failing: ItemSpec = {
  key: 'failing',
  title: '不及格扣分',
  group: 'academic',
  channel: 'administrative',
  maxEntries: 1,
  fields: [
    { key: 'courses', type: 'integer', label: '不及格必修课门数', required: true, min: 1, max: 20 },
  ],
  scoring: {
    kind: 'formula',
    formula: 'per-count',
    version: 1,
    constants: { perTime: '-1' },
    recognitions: { count: { label: '不及格门数', fromField: 'courses' } },
  },
  aggregator: 'sum',
}

const competition = (version: 1 | 2): ItemSpec => ({
  key: 'competition',
  title: '市级以上学术竞赛',
  group: 'academic',
  channel: 'participant',
  maxEntries: 10,
  fields: [
    { key: 'name', type: 'text', label: '竞赛名称', required: true, maxLength: 80 },
    { key: 'level', type: 'choice', label: '竞赛级别', required: true, options: LEVEL_OPTIONS },
    {
      key: 'rank',
      type: 'integer',
      label: '折算名次',
      required: true,
      min: 1,
      max: 20,
      description: '一等奖填 1，二等奖填 2，依此类推',
    },
    { key: 'team', type: 'boolean', label: '以团体身份参赛', required: true },
    { key: 'awarded-on', type: 'date', label: '获奖日期', required: true, inMaterialRange: true },
    proof('获奖证书'),
  ],
  scoring: {
    kind: 'formula',
    formula: 'competition',
    version,
    constants: {
      nationalFirst: '3',
      provincialFirst: '2',
      municipalFirst: '1',
      rankStep: '0.2',
      teamFactor: '0.5',
      ...(version === 2 ? { teamRankStep: '0.1' } : {}),
    },
    recognitions: {
      level: { label: '认定级别', fromField: 'level' },
      rank: { label: '认定名次', fromField: 'rank' },
      team: { label: '集体项目', fromField: 'team' },
    },
  },
  aggregator: 'sum',
})

const vocational: ItemSpec = {
  key: 'certificate',
  title: '职业技能证书',
  group: 'academic',
  channel: 'participant',
  maxEntries: 5,
  fields: [
    {
      key: 'kind',
      type: 'choice',
      label: '证书名称',
      required: true,
      options: choicesOf(VOCATIONAL_CERTIFICATES),
    },
    { key: 'certificate-no', type: 'text', label: '证书编号', required: false, maxLength: 40 },
    proof('证书照片', 2),
  ],
  scoring: { kind: 'fixed', value: '1.00' },
  aggregator: 'sum',
}

const language: ItemSpec = {
  key: 'language',
  title: '语言技能证书',
  group: 'academic',
  channel: 'participant',
  maxEntries: 3,
  fields: [
    {
      key: 'kind',
      type: 'choice',
      label: '证书类别',
      required: true,
      options: choicesOf(LANGUAGE_CERTIFICATES),
    },
    { key: 'score', type: 'integer', label: '成绩', required: false, min: 0, max: 710 },
    proof('成绩报告单', 2),
  ],
  scoring: { kind: 'fixed', value: '1.00' },
  aggregator: 'sum',
}

const research: ItemSpec = {
  key: 'research',
  title: '科研',
  group: 'academic',
  channel: 'participant',
  maxEntries: 5,
  fields: [
    { key: 'title', type: 'text', label: '成果名称', required: true, maxLength: 100 },
    {
      key: 'kind',
      type: 'choice',
      label: '成果类别',
      required: true,
      options: choicesOf(RESEARCH_KINDS),
    },
    {
      key: 'role',
      type: 'choice',
      label: '参与身份',
      required: true,
      options: choicesOf(RESEARCH_ROLES),
    },
    {
      key: 'source',
      type: 'text',
      label: '刊物、立项单位或登记号',
      required: true,
      maxLength: 100,
    },
    proof('立项书、录用或登记证明'),
  ],
  scoring: {
    kind: 'formula',
    formula: 'research',
    version: 1,
    constants: { scoreUnit: '0.1' },
    recognitions: {
      kind: { label: '认定类别', fromField: 'kind' },
      role: { label: '认定身份', fromField: 'role' },
    },
  },
  aggregator: 'sum',
}

// --- 文体表现 ----------------------------------------------------------------

const sportsBase: ItemSpec = {
  key: 'sports-base',
  title: '文体表现基础分',
  group: 'sports',
  channel: 'constant',
  maxEntries: null,
  fields: [],
  scoring: { kind: 'fixed', value: '3.00' },
  aggregator: 'sum',
}

const cadre: ItemSpec = {
  key: 'cadre',
  title: '学生干部',
  group: 'cadre',
  channel: 'administrative',
  maxEntries: 3,
  fields: [
    { key: 'post', type: 'text', label: '职务', required: true, maxLength: 40 },
    {
      key: 'tier',
      type: 'choice',
      label: '职务等级',
      required: true,
      options: [
        { value: 'president', label: '学生组织主席团成员、分团委副书记' },
        { value: 'officer', label: '学生组织部长、年级长、团支书、班长' },
        { value: 'deputy', label: '学生组织副部长、学习委员' },
        { value: 'member', label: '学生组织部员、其他班委' },
      ],
    },
  ],
  scoring: {
    kind: 'formula',
    formula: 'cadre',
    version: 1,
    constants: { scoreUnit: '0.1' },
    recognitions: { tier: { label: '职务等级', fromField: 'tier' } },
  },
  aggregator: 'max',
  description: '身兼多职者按最高职务计分',
}

const sport: ItemSpec = {
  key: 'sport',
  title: '非专业领域文体实践',
  group: 'activity',
  channel: 'participant',
  maxEntries: 5,
  fields: [
    { key: 'name', type: 'text', label: '活动名称', required: true, maxLength: 60 },
    {
      key: 'participation-level',
      type: 'choice',
      label: '参与级别',
      required: true,
      options: LEVEL_OPTIONS,
    },
    {
      key: 'award-level',
      type: 'choice',
      label: '获奖级别',
      required: true,
      options: [{ value: 'none', label: '未获奖' }, ...LEVEL_OPTIONS],
    },
    {
      key: 'rank',
      type: 'integer',
      label: '折算名次',
      required: true,
      min: 1,
      max: 20,
      description: '未获奖填 1',
    },
    { key: 'team', type: 'boolean', label: '以团体身份参加', required: true },
    proof(),
  ],
  scoring: {
    kind: 'formula',
    formula: 'sport',
    version: 1,
    constants: {
      nationalParticipation: '1.5',
      provincialParticipation: '1.2',
      municipalParticipation: '1',
      nationalFirst: '1',
      provincialFirst: '0.8',
      municipalFirst: '0.6',
      rankStep: '0.2',
      teamRankStep: '0.1',
      teamFactor: '0.5',
    },
    recognitions: {
      participationLevel: { label: '认定参与级别', fromField: 'participation-level' },
      awardLevel: { label: '认定获奖级别', fromField: 'award-level' },
      rank: { label: '认定名次', fromField: 'rank' },
      team: { label: '集体项目', fromField: 'team' },
    },
  },
  aggregator: 'sum',
}

const campus = (collegeFirst: string): ItemSpec => ({
  key: 'campus',
  title: '校园文化活动',
  group: 'activity',
  channel: 'participant',
  maxEntries: 20,
  fields: [
    { key: 'activity', type: 'text', label: '活动名称', required: true, maxLength: 60 },
    {
      key: 'participation',
      type: 'decimal',
      label: '活动参与分',
      required: true,
      maxScale: 2,
      min: '0.1',
      max: '1',
      description: '以活动通知中公布的参与分值为准',
    },
    {
      key: 'award-level',
      type: 'choice',
      label: '获奖级别',
      required: true,
      options: [
        { value: 'none', label: '未获奖或不评奖' },
        { value: 'college', label: '院级' },
        { value: 'university', label: '校级' },
      ],
    },
    {
      key: 'award-rank',
      type: 'integer',
      label: '获奖名次',
      required: true,
      min: 1,
      max: 4,
      description: '第三名以下填 4，未获奖填 1',
    },
    proof('参与证明或获奖证书'),
  ],
  scoring: {
    kind: 'formula',
    formula: 'campus',
    version: 1,
    constants: { collegeFirst, universityFirst: '0.5', rankStep: '0.1' },
    recognitions: {
      participation: { label: '认定参与分', fromField: 'participation' },
      awardLevel: { label: '认定获奖级别', fromField: 'award-level' },
      awardRank: { label: '认定获奖名次', fromField: 'award-rank' },
    },
  },
  aggregator: 'sum',
})

const article: ItemSpec = {
  key: 'article',
  title: '学术论文、期刊投稿',
  group: 'activity',
  channel: 'participant',
  maxEntries: 5,
  fields: [
    { key: 'title', type: 'text', label: '文章标题', required: true, maxLength: 100 },
    {
      key: 'outlet',
      type: 'choice',
      label: '发表渠道',
      required: true,
      options: [
        { value: 'news-national', label: '全国性官方新闻网站' },
        { value: 'news-provincial', label: '省市级官方新闻网站' },
        { value: 'journal-national', label: '校外全国性刊物' },
        { value: 'journal-provincial', label: '校外省市级刊物' },
        { value: 'campus', label: '校内刊物、网站或公众号' },
      ],
    },
    { key: 'link', type: 'text', label: '刊期或链接', required: true, maxLength: 200 },
    proof('发表页截图'),
  ],
  scoring: {
    kind: 'formula',
    formula: 'article',
    version: 1,
    constants: { scoreUnit: '0.1' },
    recognitions: { outlet: { label: '认定发表渠道', fromField: 'outlet' } },
  },
  aggregator: 'sum',
}

/** the questions a term asked, in the order the centre shows them */
export const itemsOf = (term: Term): readonly ItemSpec[] => {
  const first = term === '23-24-1'
  const last = term === '25-26-2'
  return [
    moralBase,
    dorm,
    blood,
    veteran,
    instructor,
    flagGuard,
    ...(last ? [] : [youthStudy]),
    practice,
    selfStudy,
    moralOther,
    academicBase,
    allRound,
    failing,
    competition(first ? 1 : 2),
    last ? language : vocational,
    research,
    sportsBase,
    cadre,
    sport,
    campus(first ? '0.3' : '0.4'),
    article,
  ]
}

export const CADRE_TIER_OF: ReadonlyMap<string, string> = new Map(
  CADRE_POSTS.map((post) => [post.post, post.tier]),
)
