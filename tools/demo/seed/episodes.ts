import type { ItemSpec, Term } from '../rules.ts'
import { SCRIPTED_ASKS } from './asks.ts'
import type { Claim } from './claims.ts'
import type { Moment } from './stages.ts'

// What the student a visitor signs in as went through, term by term.
//
// Everybody else's claims take their chances (term.ts). These are written
// out, so that six terms of history show every turn a claim can take rather
// than a column of first-round approvals: an ask for more material, a claim
// sent back and filed again, one sent back twice, one staff returned for
// revision, a doubt settled by the major leads together, appeals that were
// granted and appeals that were not, a re-examination staff opened, a
// determination raised and an approval revoked outside any round, a recorded
// deduction taken back, a question voided under a claim, and a route changed
// while a claim was on it. term.ts plays each one on its term's calendar.

export const EPISODE_KINDS = [
  // the class lead asks for more; the student answers; approved
  'supplement',
  // refused, revised and filed again, approved
  'revise',
  // refused twice, revised twice, approved on the third round
  'rounds',
  // the assessment lead returns it for revision while it is under review
  'return',
  // the class lead escalates; the major leads sit together; a counsellor concludes
  'panel',
  // refused and left; appealed; the appeal is granted
  'appeal-corrected',
  // refused and left; appealed; the appeal is not granted
  'appeal-upheld',
  // approved on a lowered determination; a counsellor re-examines it; raised back
  'reopen',
  // approved; the inspection office raises the determination
  'raise',
  // filed twice for one afternoon, both approved; the inspection office revokes the second
  'revoke',
  // a counsellor records a deduction, then takes it back
  'record-void',
  // filed on a question the lead then voids; filed again on the right one
  'item-void',
  // under review when the lead adds a step to the question's route
  'reroute',
] as const
export type EpisodeKind = (typeof EPISODE_KINDS)[number]

/**
 * The moments an episode acts at through a door not every stage holds open,
 * counted from the day filing opens. Whichever term plays the episode must be
 * staged to hold it open then (stages.ts `shutDoors`); term.ts acts at them.
 */
export const EPISODE_DOORS = {
  // the counsellor takes the recorded deduction back
  'record-void': { at: [7, '10:00'], opens: 'assessment.entry.record' },
  // a counsellor re-examines the lowered determination
  reopen: { at: [6, '10:20'], opens: 'assessment.review.reopen' },
} as const satisfies Partial<Record<EpisodeKind, { readonly at: Moment; readonly opens: string }>>

export interface Episode {
  readonly kind: EpisodeKind
  /** what is filed; for `rounds`, what the second revision corrects */
  readonly claim?: Claim
  readonly corrected?: Readonly<Record<string, unknown>>
  /** for `item-void`, what is filed again once the question is gone */
  readonly refiled?: Claim
  /** for `revoke`, the claim filed first, which `claim` duplicates */
  readonly first?: Claim
}

const campus = (
  activity: string,
  participation: string,
  awardLevel: 'none' | 'college' | 'university',
  awardRank: number,
): Claim => ({
  item: 'campus',
  payload: { activity, participation, 'award-level': awardLevel, 'award-rank': awardRank },
  proof: awardLevel === 'none' ? 'campus-1' : 'campus-2',
  filename: `${activity}.jpg`,
})

/** a provincial first prize, on the certificate that says so, a team's or one student's */
const competition = (name: string, team: boolean): Claim => ({
  item: 'competition',
  // the award day is placed inside the term's material window when filed
  payload: { name, level: 'provincial', rank: 1, team },
  proof: team ? 'competition-1' : 'competition-4',
  filename: '获奖证书.jpg',
})

const practice = (
  activity: string,
  type: 'practice' | 'volunteer',
  evidence: string,
  proof: string,
): Claim => ({
  item: 'practice',
  payload: { activity, type, evidence },
  proof,
  filename: `${activity}证明.jpg`,
})

/**
 * What the batch description says of the question a term tries: announced
 * when the batch is set up, and said to have stopped once it is voided, so the
 * overview never goes on announcing a question marked voided below it.
 */
export const TRIAL_NOTICE = {
  tried: '本学期试行「志愿服务时长认定」，志愿服务可按服务时长申报。',
  voided: '「志愿服务时长认定」试行已停止，请改在「社会实践与志愿服务」申报。',
} as const

/** a question some terms asked for a few days, and then voided */
export const TRIAL_ITEM: ItemSpec = {
  key: 'volunteer-hours',
  title: '志愿服务时长认定（试行）',
  group: 'practice',
  channel: 'participant',
  maxEntries: 2,
  fields: [
    { key: 'activity', type: 'text', label: '服务项目', required: true, maxLength: 60 },
    { key: 'hours', type: 'integer', label: '服务时长（小时）', required: true, min: 1, max: 200 },
    { key: 'proof', type: 'attachment', label: '时长记录截图', required: true, maxCount: 3 },
  ],
  scoring: { kind: 'fixed', value: '0.10' },
  aggregator: 'sum',
}

export const EPISODES: Readonly<Record<Term, readonly Episode[]>> = {
  '23-24-1': [
    // a second prize claimed on the participation note, which names no place
    {
      kind: 'supplement',
      claim: {
        ...campus('主题摄影比赛', '0.2', 'university', 2),
        proof: SCRIPTED_ASKS.placeInList.on,
      },
    },
    // filed with the platform's record; the stamped certificate comes with the revision
    {
      kind: 'revise',
      claim: practice('社区养老院助老服务', 'volunteer', 'hours', 'hours-1'),
    },
  ],
  '23-24-2': [
    { kind: 'panel', claim: competition('全国大学生数学建模竞赛', true) },
    // filed with a municipal contest's certificate by mistake
    {
      kind: 'appeal-corrected',
      claim: {
        ...competition('省大学生信息素养大赛', false),
        proof: SCRIPTED_ASKS.rightCertificate.on,
      },
    },
  ],
  '24-25-1': [
    // the certificate was issued this term for a contest held the term before
    {
      kind: 'appeal-upheld',
      claim: { ...campus('心理情景剧微电影大赛', '0.2', 'university', 3), proof: 'campus-4' },
    },
    { kind: 'record-void' },
  ],
  '24-25-2': [
    // a first prize the published list gave as a second, until it was corrected
    {
      kind: 'reopen',
      claim: {
        ...competition('蓝桥杯全国软件和信息技术专业人才大赛', false),
        proof: SCRIPTED_ASKS.correctedList.on,
      },
    },
    { kind: 'raise', claim: campus('校园歌手大赛工作人员', '0.2', 'none', 1) },
  ],
  '25-26-1': [
    {
      kind: 'return',
      claim: {
        item: 'sport',
        payload: {
          name: '省大学生健身操舞锦标赛',
          'participation-level': 'provincial',
          'award-level': 'provincial',
          rank: 3,
          team: true,
        },
        proof: 'sport-1',
        filename: '省大学生健身操舞锦标赛.jpg',
      },
    },
    // one afternoon's service, filed once with the platform's record and once
    // with the library's certificate for it
    {
      kind: 'revoke',
      first: practice('图书馆志愿服务', 'volunteer', 'hours', 'hours-2'),
      claim: practice('图书馆志愿服务', 'volunteer', 'certificate', 'service-2'),
    },
    {
      kind: 'item-void',
      claim: {
        item: TRIAL_ITEM.key,
        payload: { activity: '城市马拉松志愿者', hours: 12 },
        proof: 'hours-2',
        filename: '志愿时长截图.jpg',
      },
      refiled: practice('城市马拉松志愿者', 'volunteer', 'hours', 'hours-2'),
    },
  ],
  '25-26-2': [
    { kind: 'reroute', claim: competition('中国大学生计算机设计大赛', true) },
    // first filed with an out-of-focus photo of a second-prize certificate
    {
      kind: 'rounds',
      claim: { ...campus('职业生涯规划大赛', '0.2', 'college', 1), proof: 'campus-6' },
      corrected: { 'award-rank': 2 },
    },
  ],
}

/**
 * The episodes a term plays: its own, or with `QUALY_DEMO_EPISODES=first`
 * (`host` names the first term the run seeds, options.ts `episodeHostOf`)
 * every one of them in that term and none in the others, for working on them
 * without seeding three years first.
 */
export const episodesOf = (term: Term, host: Term | null): readonly Episode[] => {
  if (host === null) return EPISODES[term]
  return term === host ? Object.values(EPISODES).flat() : []
}
