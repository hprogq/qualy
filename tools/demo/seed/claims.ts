import library from '../library.json' with { type: 'json' }
import {
  ARTICLE_KINDS,
  ARTICLE_TITLES,
  CAMPUS_ACTIVITIES,
  COMPETITIONS,
  LANGUAGE_CERTIFICATES,
  OFF_CAMPUS_EVENTS,
  PRACTICE_ACTIVITIES,
  PRACTICE_EVIDENCE,
  RESEARCH_KINDS,
  RESEARCH_ROLES,
  RESEARCH_SUBJECTS,
  RESEARCH_TREATMENTS,
  VOCATIONAL_CERTIFICATES,
} from '../catalog.ts'
import type { Term } from '../rules.ts'
import type { Random } from './context.ts'
import { PROOF_ASSETS } from './files.ts'
import type { Student } from './world.ts'

// What each student files in a term: how many claims of each kind, drawn
// from how many the real cohort filed that term, leaning on the student's
// own activity so the busy stay busy; and what each claim says, drawn from
// the catalog.

export interface Claim {
  readonly item: string
  /** the payload without its files; the proof is uploaded when filing */
  readonly payload: Record<string, unknown>
  readonly proof: string
  readonly filename: string
}

type TermSummary = (typeof library.terms)['23-24-1']

/** a count from a histogram, at a position the student's traits choose */
const countAt = (histogram: Readonly<Record<string, number>> | undefined, u: number) => {
  if (histogram === undefined) return 0
  const entries = Object.entries(histogram)
    .map(([value, n]) => [Number(value), n] as const)
    .sort((a, b) => a[0] - b[0])
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  let at = u * total
  for (const [value, n] of entries) {
    at -= n
    if (at < 0) return value
  }
  return entries[entries.length - 1]![0]
}

const dayIn = (random: Random, material: { start: string; end: string }) => {
  const start = new Date(`${material.start}T00:00:00Z`).getTime()
  const end = new Date(`${material.end}T00:00:00Z`).getTime() - 86_400_000
  return new Date(start + random.next() * (end - start)).toISOString().slice(0, 10)
}

const rankFor = (random: Random) =>
  random.weighted([
    { rank: 1, weight: 18 },
    { rank: 2, weight: 30 },
    { rank: 3, weight: 32 },
    { rank: 4, weight: 12 },
    { rank: 5, weight: 5 },
    { rank: 6, weight: 3 },
  ]).rank

const proofOf = (random: Random, kind: keyof typeof PROOF_ASSETS) => random.pick(PROOF_ASSETS[kind])

export const claimsOf = (
  student: Student,
  term: Term,
  random: Random,
  material: { start: string; end: string },
): Claim[] => {
  const summary = library.terms[term] as TermSummary & {
    itemsPerStudent: Record<string, Record<string, number>>
  }
  const perStudent = summary.itemsPerStudent
  // The trait is drawn skewed (random ** 1.6), and a histogram read at a
  // skewed position files far fewer claims than the cohort did. Undone to a
  // uniform position first, then mixed with chance: a mixture of uniforms is
  // uniform, so the term's volume matches the real one while the busy stay
  // busy more often than not.
  const position = student.activity ** (1 / 1.6)
  const lean = (weight = 0.75) => Math.min(0.999, random.chance(weight) ? position : random.next())
  const claims: Claim[] = []
  const add = (count: number, make: () => Claim) => {
    for (let i = 0; i < count; i++) claims.push(make())
  }
  const usedCampus = new Set<string>()

  add(Math.min(countAt(perStudent['campus'], lean()), 12), () => {
    let activity = random.weighted(CAMPUS_ACTIVITIES)
    for (let tries = 0; usedCampus.has(activity.name) && tries < 8; tries++) {
      activity = random.weighted(CAMPUS_ACTIVITIES)
    }
    usedCampus.add(activity.name)
    const awarded = activity.contest !== 'none' && random.chance(0.35)
    return {
      item: 'campus',
      payload: {
        activity: activity.name,
        participation: activity.participation,
        'award-level': awarded ? activity.contest : 'none',
        'award-rank': awarded
          ? random.weighted([
              { rank: 1, weight: 15 },
              { rank: 2, weight: 25 },
              { rank: 3, weight: 30 },
              { rank: 4, weight: 30 },
            ]).rank
          : 1,
      },
      proof: awarded ? 'campus-2' : random.pick(['campus-1', 'campus-3']),
      filename: `${activity.name}.jpg`,
    }
  })

  add(Math.min(countAt(perStudent['practice'], lean()), 4), () => {
    const activity = random.weighted(PRACTICE_ACTIVITIES)
    return {
      item: 'practice',
      payload: {
        activity: activity.name,
        type: activity.type,
        evidence: random.weighted(PRACTICE_EVIDENCE).value,
      },
      proof: proofOf(random, 'practice'),
      filename: `${activity.name}证明.jpg`,
    }
  })

  add(Math.min(countAt(perStudent['competition'], lean(0.85)), 4), () => {
    const competition = random.weighted(COMPETITIONS)
    const level =
      competition.levels.length > 1 && random.chance(0.3)
        ? competition.levels[0]!
        : competition.levels[competition.levels.length - 1]!
    return {
      item: 'competition',
      payload: {
        name: competition.name,
        level,
        rank: rankFor(random),
        team: random.chance(0.62),
        'awarded-on': dayIn(random, material),
      },
      proof: proofOf(random, 'competition'),
      filename: '获奖证书.jpg',
    }
  })

  const last = term === '25-26-2'
  add(
    Math.min(countAt(perStudent[last ? 'language' : 'certificate'], lean(0.5)), last ? 2 : 3),
    () => {
      if (last) {
        const kind = random.weighted(LANGUAGE_CERTIFICATES)
        return {
          item: 'language',
          payload: {
            kind: kind.value,
            ...(kind.value.startsWith('cet') ? { score: random.int(425, 612) } : {}),
          },
          proof: proofOf(random, 'language'),
          filename: '成绩报告单.jpg',
        }
      }
      const kind = random.weighted(VOCATIONAL_CERTIFICATES)
      return {
        item: 'certificate',
        payload: { kind: kind.value, 'certificate-no': `DEMO${random.int(100000, 999999)}` },
        proof:
          kind.value === 'cet4' || kind.value === 'cet6'
            ? random.pick(['certificate-1', 'certificate-2'])
            : 'certificate-3',
        filename: `${kind.label}.jpg`,
      }
    },
  )

  add(Math.min(countAt(perStudent['research'], lean(0.85)), 3), () => {
    const kind = random.weighted(RESEARCH_KINDS)
    const title = random
      .pick(RESEARCH_TREATMENTS)
      .replace('{subject}', random.pick(RESEARCH_SUBJECTS))
    const source =
      kind.value === 'software'
        ? `登记号 DEMO-SR-${random.int(10000, 99999)}`
        : kind.value.startsWith('project')
          ? '大学生创新创业训练计划'
          : `《计算机应用示例》${random.int(2024, 2026)} 年第 ${random.int(1, 12)} 期`
    return {
      item: 'research',
      payload: { title, kind: kind.value, role: random.weighted(RESEARCH_ROLES).value, source },
      proof: kind.value === 'software' ? 'research-2' : 'research-1',
      filename: '成果证明.jpg',
    }
  })

  add(Math.min(countAt(perStudent['sport'], lean(0.6)), 2), () => {
    const event = random.weighted(OFF_CAMPUS_EVENTS)
    const awarded = random.chance(0.5)
    return {
      item: 'sport',
      payload: {
        name: event.name,
        'participation-level': event.level,
        'award-level': awarded ? event.level : 'none',
        rank: awarded ? rankFor(random) : 1,
        team: event.team,
      },
      proof: proofOf(random, 'sport'),
      filename: `${event.name}.jpg`,
    }
  })

  add(Math.min(countAt(perStudent['article'], lean(0.9)), 2), () => {
    const outlet = random.weighted(ARTICLE_KINDS)
    return {
      item: 'article',
      payload: {
        title: random.pick(ARTICLE_TITLES),
        outlet: outlet.value,
        link: `https://news.example.org/campus/${random.int(100000, 999999)}.html`,
      },
      proof: proofOf(random, 'article'),
      filename: '发表页截图.jpg',
    }
  })

  // the rarer moral claims, at the rate the real term had them
  const numbers = summary.numbers as Record<string, { frequencies?: Record<string, number> }>
  const rate = (name: string) => {
    const table = numbers[name]?.frequencies ?? {}
    return Object.values(table).reduce((sum, n) => sum + n, 0) / summary.students
  }
  if (random.chance(rate('blood'))) {
    claims.push({
      item: 'blood',
      payload: {
        'donated-on': dayIn(random, material),
        'certificate-no': `DEMO-${random.int(1000000, 9999999)}`,
      },
      proof: 'blood-1',
      filename: '献血证.jpg',
    })
  }
  if (random.chance(rate('instructor'))) {
    claims.push({
      item: 'instructor',
      payload: {},
      proof: 'honour-1',
      filename: '优秀学生教官证书.jpg',
    })
    if (random.chance(0.12)) {
      claims.push({
        item: 'flag-guard',
        payload: {},
        proof: 'honour-1',
        filename: '国旗班证明.jpg',
      })
    }
  }
  return claims
}
