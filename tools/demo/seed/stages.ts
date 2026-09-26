import type { Term } from '../rules.ts'
import type { Claim } from './claims.ts'
import { EPISODE_DOORS, TRIAL_NOTICE, type Episode, type EpisodeKind } from './episodes.ts'

// How each term's batch is staged: the plan the assessment lead writes when
// setting it up, what each stage is for, and the moment the story moves the
// batch into it.
//
// No two terms are staged alike, the way no two terms of a real college's
// calendar are: the first term in the system; one that splits review in
// two; one whose appeals stay open longer; one that publishes its rules
// before filing opens; one that settles appeals inside the appeal stage; and
// one that reopens filing, after filing has closed, for a single question.
//
// Whatever the plan, the story keeps its own moments: filing opens at D 08:00
// and closes at D+5 00:00, appeals open at D+9 09:00 and are all in by
// D+11 17:00, open rounds are settled at D+12 20:00 and the batch is
// archived at D+13 10:00. tests/phases.test.ts holds every plan to them.

const CREATE_FAMILY = [
  'assessment.entry.create',
  'assessment.entry.edit',
  'assessment.entry.submit',
  'assessment.entry.withdraw',
  'assessment.entry.abandon',
] as const

export const FILING: readonly string[] = [
  ...CREATE_FAMILY,
  'assessment.entry.record',
  'assessment.review.process',
  'assessment.review.escalate',
]
// Staff may send a concluded claim through the escalation route again
// (re-examination) while review runs and while students may appeal - the
// same windows the selection opens it in. Settling what was appealed opens
// nothing new.
export const REVIEW: readonly string[] = [
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.entry.record',
  'assessment.review.reopen',
]
export const APPEAL: readonly string[] = [
  'assessment.entry.appeal',
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.entry.record',
  'assessment.review.reopen',
]
export const SETTLING: readonly string[] = [
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.entry.record',
]
/**
 * Filing opened again while review goes on. The stage's question scope
 * narrows filing to its questions and would narrow recording by staff the
 * same way, so recording stays shut rather than open for one question only.
 */
export const LATE_FILING: readonly string[] = [
  ...CREATE_FAMILY,
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.review.reopen',
]

/** days after the day filing opens, and a Beijing wall-clock time */
export type Moment = readonly [days: number, time: string]

export interface Stage {
  readonly phaseKey: string
  readonly displayName: string
  /** what the stage is for, as the lead wrote it on the plan */
  readonly description: string
  readonly permissionProfile: readonly string[]
  /** when the lead moves the batch in */
  readonly enters: Moment
}

/** a stage the lead adds once the term is under way, open to some questions only */
export interface ScopedStage {
  /** the stage it goes in after, which is the current one when it is added */
  readonly after: string
  /** when the lead adds it */
  readonly added: Moment
  readonly stage: Stage
  /** the questions it opens, by key */
  readonly items: readonly string[]
  /** the kinds of claim on those questions that waited for it, by the filed `kind` */
  readonly awaited: readonly string[]
  /** of the claims that waited, the share filed only once it opens */
  readonly late: number
  /** the days of the stage students file in, the evening of the first to that of the last */
  readonly filedOn: readonly [first: number, last: number]
  /** what the student a visitor signs in as files in it, and when it is filed and approved */
  readonly persona: {
    readonly claim: Claim
    readonly files: Moment
    readonly approved: Moment
  }
}

export interface Staging {
  /**
   * The batch's own description, shown at the top of its overview above the
   * stages: only what this term has of its own. What filing asks for every
   * term is the filing stage's to say.
   */
  readonly descriptionMd: string
  readonly stages: readonly Stage[]
  readonly scoped?: ScopedStage
}

/** the stages a term's plan ends up with, in the order the batch enters them */
export const stagesOf = (staging: Staging): readonly Stage[] => {
  const scoped = staging.scoped
  if (scoped === undefined) return staging.stages
  return staging.stages.flatMap((stage) =>
    stage.phaseKey === scoped.after ? [stage, scoped.stage] : [stage],
  )
}

/** a moment as minutes from the day filing opens, for putting moments in order */
export const minutesOf = ([days, time]: Moment) => {
  const [hours, minutes] = time.split(':').map(Number)
  return days * 1440 + hours! * 60 + minutes!
}

/** the stage a batch staged so stands in at a moment of its story */
export const stageAt = (staging: Staging, moment: Moment): Stage | undefined =>
  stagesOf(staging)
    .filter((stage) => minutesOf(stage.enters) <= minutesOf(moment))
    .at(-1)

/**
 * Of `kinds`, the episodes a batch staged so keeps from playing: the door
 * each walks through at its moment (EPISODE_DOORS) is shut in the stage the
 * batch stands in then.
 */
export const shutDoors = (staging: Staging, kinds: Iterable<EpisodeKind>): EpisodeKind[] =>
  [...new Set(kinds)].filter((kind) => {
    const door = (EPISODE_DOORS as Partial<Record<EpisodeKind, { at: Moment; opens: string }>>)[
      kind
    ]
    if (door === undefined) return false
    return !(stageAt(staging, door.at)?.permissionProfile.includes(door.opens) ?? false)
  })

/**
 * The description a term's batch is created with: a term that tries a
 * question for a few days (the `item-void` episode) announces it first.
 */
export const openingDescription = (staging: Staging, episodes: readonly Episode[]) =>
  episodes.some((episode) => episode.kind === 'item-void')
    ? `${TRIAL_NOTICE.tried}\n${staging.descriptionMd}`
    : staging.descriptionMd

/** the same description once the tried question is voided, which it then says instead */
export const voidedDescription = (description: string) =>
  description.replace(TRIAL_NOTICE.tried, TRIAL_NOTICE.voided)

const SEASONS: Readonly<Record<Term, string>> = {
  '23-24-1': '2023年秋季学期',
  '23-24-2': '2024年春季学期',
  '24-25-1': '2024年秋季学期',
  '24-25-2': '2025年春季学期',
  '25-26-1': '2025年秋季学期',
  '25-26-2': '2026年春季学期',
}

const filing = (term: Term): Stage => ({
  phaseKey: 'entry',
  displayName: '材料填报',
  description: `提交${SEASONS[term]}的加分材料，每项附证明；学业成绩、寝室卫生与学生干部任职由辅导员统一导入，无需申报。`,
  permissionProfile: FILING,
  enters: [0, '08:00'],
})

const review: Stage = {
  phaseKey: 'review',
  displayName: '审核整理',
  description: '班级综测负责人逐条审核本班申报，拿不准的上提专业负责人合议；本阶段不再接受新申报。',
  permissionProfile: REVIEW,
  enters: [5, '00:00'],
}

const appeal = (more = ''): Stage => ({
  phaseKey: 'appeal',
  displayName: '结果申诉',
  description: `审核结果已公布，对某条申报的结论有异议的，在本阶段内提出申诉并写明理由。${more}`,
  permissionProfile: APPEAL,
  enters: [9, '09:00'],
})

const settling = (enters: Moment = [11, '17:00']): Stage => ({
  phaseKey: 'appeal-review',
  displayName: '申诉处理',
  description: '专业负责人、年级负责人与辅导员依次复核已提出的申诉，不再接受新的申诉。',
  permissionProfile: SETTLING,
  enters,
})

const archive: Stage = {
  phaseKey: 'archive',
  displayName: '归档',
  description: '本学期综测结束，成绩以归档时为准。',
  permissionProfile: [],
  enters: [13, '10:00'],
}

// A batch's description says what its term has of its own: a change of
// rules, a stage moved or merged, and why. What filing asks for every term is
// the filing stage's to say, and the overview shows both on one screen.
export const STAGING: Readonly<Record<Term, Staging>> = {
  // the first term the school ran in the system
  '23-24-1': {
    descriptionMd:
      '本学期起综合素质测评改在系统内填报与审核，不再收取纸质材料，证明请拍照或扫描后上传。',
    stages: [filing('23-24-1'), review, appeal(), settling(), archive],
  },
  // review split in two: the class leads' own, then what is left over
  '23-24-2': {
    descriptionMd:
      '本学期审核分为「班级审核」与「复核与补件」两段。\n校园文化活动院级第一名加分调整为0.4分，团体竞赛名次每降一名减0.1分。',
    stages: [
      filing('23-24-2'),
      {
        ...review,
        displayName: '班级审核',
        description:
          '班级综测负责人审核本班申报，拿不准的上提专业负责人合议；未审完的在「复核与补件」中继续处理。',
      },
      {
        phaseKey: 'recheck',
        displayName: '复核与补件',
        description: '继续处理尚未审完的申报、上提的合议与补充材料，审核结果在本阶段结束后公布。',
        permissionProfile: REVIEW,
        enters: [7, '18:00'],
      },
      appeal(),
      settling(),
      archive,
    ],
  },
  // appeals stay open until the next day's noon, and the plan says so by name
  '24-25-1': {
    descriptionMd: '转专业的同学按新专业参评。\n因学院春季运动会，结果申诉的截止时间顺延。',
    stages: [
      filing('24-25-1'),
      review,
      { ...appeal('截止时间顺延至3月15日 12:00。'), displayName: '结果申诉（顺延）' },
      settling([12, '12:00']),
      archive,
    ],
  },
  // the rules are published three days before filing opens
  '24-25-2': {
    descriptionMd: '开放填报前先公示本学期细则，对细则有疑问的请在公示期内向班级综测负责人反映。',
    stages: [
      {
        phaseKey: 'rules',
        displayName: '细则公示',
        description:
          '学院公示本学期综测细则与各项材料要求，请对照细则准备证明材料；9月1日 08:00开放填报。',
        permissionProfile: [],
        enters: [-3, '16:30'],
      },
      filing('24-25-2'),
      review,
      appeal(),
      settling(),
      archive,
    ],
  },
  // appeals are settled inside the appeal stage, with no stage of their own;
  // the question tried this term is announced by its episode (openingDescription)
  '25-26-1': {
    descriptionMd: '本学期结果公示与申诉合并进行，请在公示期内核对本人结果。',
    stages: [
      filing('25-26-1'),
      review,
      {
        ...appeal(),
        displayName: '结果公示与申诉',
        description: '公示审核结果并受理申诉，已提出的申诉在公示期内处理完毕。',
      },
      archive,
    ],
  },
  // the new language question reopened for the certificates that came late
  '25-26-2': {
    descriptionMd: '本学期起「职业技能证书」改为「语言技能证书」，青年大学习不再计入。',
    stages: [filing('25-26-2'), review, appeal(), settling(), archive],
    scoped: {
      after: 'review',
      added: [5, '15:20'],
      stage: {
        phaseKey: 'late-language',
        displayName: '语言技能证书补充提交',
        description:
          '六月四、六级成绩报告单9月7日起由教务处发放，填报期内未能申报的同学可在本阶段补报「语言技能证书」；其他项目不再接受新申报，审核照常进行。',
        permissionProfile: LATE_FILING,
        enters: [6, '09:00'],
      },
      items: ['language'],
      awaited: ['cet4', 'cet6'],
      late: 0.5,
      filedOn: [6, 8],
      persona: {
        claim: {
          item: 'language',
          payload: { kind: 'cet6', score: 476 },
          proof: 'certificate-2',
          filename: '六级成绩报告单.jpg',
        },
        files: [6, '20:30'],
        approved: [7, '19:40'],
      },
    },
  },
}
