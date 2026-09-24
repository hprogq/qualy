// Six terms of real results, reduced to what a demonstration may keep.
//
//   node tools/demo/compile.ts   reads docs/seed, writes tools/demo/library.json
//                                and data/demo/pools.json (gitignored)
//
// The source workbooks hold real names, student numbers and identity
// numbers, and they never leave the machine they are on. What this writes
// is the part that is not about anybody:
//
// - the shapes of what was claimed per question - levels, ranks, team or
//   not, the score it earned - counted, without the names of the things
// - how many claims a student makes per question per term, as histograms
// - score distributions per major, as quantiles
// - the size of the cohort, its majors and classes, and how many people
//   moved, left or came back between terms - counts, not people
// - how many appeals each term had, of which kind and with which outcome
//
// The names of the things claimed go to data/demo/pools.json, outside the
// repository, and only those at least K students claimed. Even those are not
// fit to publish - lecturers, partner universities and local companies name
// the school as surely as its own name does - so they are a reference for
// writing tools/demo/catalog.ts by hand, never read by the seeder.
//
// The report printed at the end has counts only: what was parsed, what was
// dropped under the threshold, what could not be read. It never prints a
// dropped name, since those are exactly the ones that identify somebody.

import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'

const SOURCE = 'docs/seed'
const OUTPUT = 'tools/demo/library.json'
const PRIVATE_POOLS = 'data/demo/pools.json'
/** how many different students must have claimed a thing before it may be shown */
const K = 5

export const TERMS = ['23-24-1', '23-24-2', '24-25-1', '24-25-2', '25-26-1', '25-26-2'] as const
type Term = (typeof TERMS)[number]

// --- reading ---------------------------------------------------------------

type Cell = ExcelJS.CellValue

const text = (value: Cell): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('')
    if ('result' in value) return text(value.result)
    if ('text' in value) return String(value.text)
  }
  return String(value)
}

const num = (value: string): number | null => {
  // the template writes "0.2分" as often as "0.2"
  const trimmed = value.trim().replace(/分$/, '')
  if (trimmed === '' || trimmed === '-') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** a sheet as rows keyed by header, headers taken from the first row that has several */
const readSheet = async (file: string, sheet?: string) => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path.join(SOURCE, file))
  const worksheet = sheet === undefined ? workbook.worksheets[0]! : workbook.getWorksheet(sheet)!
  const raw: string[][] = []
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = []
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      values[column - 1] = text(cell.value)
    })
    raw.push(Array.from(values, (value) => value ?? ''))
  })
  // distinct values, not filled cells: a merged title row repeats its one
  // value into every cell it spans
  const headerAt = raw.findIndex(
    (row) => new Set(row.map((cell) => cell.trim()).filter((cell) => cell !== '')).size > 3,
  )
  const header = raw[headerAt]!.map((cell) => cell.trim())
  return raw.slice(headerAt + 1).map((row) => {
    const record: Record<string, string> = {}
    header.forEach((name, index) => {
      if (name !== '') record[name] = (row[index] ?? '').trim()
    })
    return record
  })
}

/** the value of the first column whose header starts with this */
const field = (row: Record<string, string>, prefix: string): string => {
  for (const [name, value] of Object.entries(row)) if (name.startsWith(prefix)) return value
  return ''
}

// --- scrubbing -------------------------------------------------------------

/**
 * The school and its city, which would name the source outright. The list
 * sits with the source (`place-words.json`, `[[pattern, flags, replacement]]`)
 * rather than here: written down in this file, it would publish the very
 * names it exists to remove.
 */
const PLACE_WORDS: readonly [RegExp, string][] = (
  JSON.parse(fs.readFileSync(path.join(SOURCE, 'place-words.json'), 'utf8')) as [
    string,
    string,
    string,
  ][]
).map(([pattern, flags, replacement]) => [new RegExp(pattern, flags), replacement])

const scrub = (value: string) =>
  PLACE_WORDS.reduce((out, [from, to]) => out.replace(from, to), value)

/** what makes two spellings of one activity the same activity */
const keyOf = (name: string) =>
  scrub(name)
    .normalize('NFKC')
    .replace(/(19|20)\d{2}(年|-|—|~|－)?((19|20)?\d{2}年?)?/g, '')
    .replace(/第[一二三四五六七八九十\d]+(届|期|季)/g, '')
    .replace(/[“”"'‘’《》「」【】（）()\s·、，,。.!！?？:：\-—_]/g, '')
    .toLowerCase()

/** a display form: the commonest spelling, with its year left for the seeder to fill */
const displayOf = (spellings: Map<string, number>) => {
  const [best] = [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return scrub(best![0])
    .normalize('NFKC')
    .replace(/(19|20)\d{2}(?=年|-|—|届|学年|$|[^\d])/, '{year}')
    .trim()
}

// --- the detail text -------------------------------------------------------

const KNOWN_KEYS = [
  '活动名称',
  '类型',
  '佐证材料',
  '竞赛名称',
  '最高获奖等级',
  '折算名次',
  '证书名称',
  '证书类别',
  '最高参与等级',
  '活动参与加分',
  '活动获奖加分',
  '参与加分',
  '活动参与得分',
  '文章标题',
  '投稿类型',
  '发表至',
  '科研类型',
  '参与身份',
  '文章/项目名称',
  '文章名称',
] as const

export interface ParsedItem {
  readonly fields: Readonly<Record<string, string>>
  readonly team: boolean
  readonly noAward: boolean
  readonly noParticipation: boolean
  readonly special: boolean
  readonly newsReport: boolean
  readonly score: number | null
}

const ITEM = /计分项\d+：【([\s\S]*?)】/g
const KEY = new RegExp(
  `(?:^|，)\\s*(${KNOWN_KEYS.map((k) => k.replace('/', '\\/')).join('|')})：`,
  'g',
)

/** one scoring item's text, split at the keys the template writes */
export const parseItem = (body: string): ParsedItem | null => {
  const trimmed = body.trim()
  // the flags and the final score trail the fields, after the first
  // sentence that is not a key: "该项为…" or "「最终…」"
  const tailAt = trimmed.search(/，\s*(该|「)/)
  const head = tailAt === -1 ? trimmed : trimmed.slice(0, tailAt)
  const tail = tailAt === -1 ? '' : trimmed.slice(tailAt)
  const marks = [...head.matchAll(KEY)]
  if (marks.length === 0) return null
  const fields: Record<string, string> = {}
  marks.forEach((mark, index) => {
    const start = mark.index + mark[0].length
    const end = index + 1 < marks.length ? marks[index + 1]!.index : head.length
    fields[mark[1]!] = head.slice(start, end).trim()
  })
  const score = /「最终(?:总)?加分：(-?[\d.]+)分」/.exec(tail)?.[1]
  return {
    fields,
    team: tail.includes('集体参与'),
    noAward: tail.includes('未获奖或不评奖'),
    noParticipation: trimmed.includes('无参与加分'),
    special: tail.includes('特殊奖项'),
    newsReport: tail.includes('消息报道'),
    score: score === undefined ? null : Number(score),
  }
}

export const parseItems = (detail: string) => {
  const items: ParsedItem[] = []
  let unreadable = 0
  for (const match of detail.matchAll(ITEM)) {
    const parsed = parseItem(match[1]!)
    if (parsed === null) unreadable += 1
    else items.push(parsed)
  }
  return { items, unreadable }
}

// --- the categories --------------------------------------------------------

/**
 * The questions, by the column their detail text is in. `nameKey` is the
 * field a pool groups by; a category without one keeps no names at all.
 */
const CATEGORIES = {
  practice: { column: '分数构成详情-社会实践、志愿服务', nameKey: '活动名称' },
  competition: { column: '分数构成详情-市级以上学术竞赛', nameKey: '竞赛名称' },
  certificate: { column: '分数构成详情-职业技能证书', nameKey: '证书名称' },
  language: { column: '分数构成详情-语言技能证书', nameKey: '证书名称' },
  research: { column: '分数构成详情-科研', nameKey: null },
  sport: { column: '分数构成详情-非专业领域文体实践', nameKey: '活动名称' },
  campus: { column: '分数构成详情-校园文化活动', nameKey: '活动名称' },
  article: { column: '分数构成详情-学术论文、期刊投稿', nameKey: null },
} as const
type Category = keyof typeof CATEGORIES

/** the numeric columns kept as distributions, by the prefix of their header */
const NUMBERS = {
  moralBase: '品德行为表现测评-基础分',
  blood: '品德行为表现测评-献血',
  veteran: '品德行为表现测评-退役复学',
  instructor: '品德行为表现测评-优秀学生教官',
  mentor: '品德行为表现测评-优秀班导生',
  dorm: '品德行为表现测评-寝室',
  youthStudy: '品德行为表现测评-青年大学习',
  practice: '品德行为表现测评-社会实践',
  selfStudy: '品德行为表现测评-早晚自习',
  moralOther: '品德行为表现测评-其他',
  moralTotal: '品德行为表现测评-品德总分',
  weighted: '学业表现-学业成绩加权',
  allRound: '学业表现-全科额外加分',
  failing: '学业表现-不及格学业扣分',
  competition: '学业表现-市级以上学术竞赛',
  certificate: '学业表现-职业技能证书',
  language: '学业表现-语言技能证书',
  research: '学业表现-科研',
  academicTotal: '学业表现-学业总分',
  sportsBase: '文体表现-基础分',
  cadre: '文体表现-学生干部',
  sport: '文体表现-非专业领域文体实践',
  campus: '文体表现-校园文化活动',
  article: '文体表现-学术论文',
  activityTotal: '文体表现-活动总分',
  sportsTotal: '文体表现-文体总分',
  total: '总分',
} as const

// --- accumulating ----------------------------------------------------------

interface PoolEntry {
  readonly spellings: Map<string, number>
  readonly students: Set<string>
  readonly variants: Map<
    string,
    { fields: Record<string, string | boolean | number | null>; n: number }
  >
}

const pools = new Map<Category, Map<string, PoolEntry>>()
const typeTables = new Map<Category, Map<string, number>>()
const report = {
  terms: {} as Record<
    string,
    { students: number; items: Record<string, number>; unreadable: number }
  >,
  pools: {} as Record<string, { distinctNames: number; kept: number; droppedUnderK: number }>,
}

type Shape = Record<string, string | number | boolean | null>

const variantOf = (category: Category, item: ParsedItem): Shape => {
  const f = item.fields
  switch (category) {
    case 'practice':
      return { type: f['类型'] ?? null, evidence: f['佐证材料'] ?? null }
    case 'competition':
      return {
        level: f['最高获奖等级'] ?? null,
        rank: num(f['折算名次'] ?? '') ?? null,
        team: item.team,
        score: item.score,
      }
    case 'certificate':
    case 'language':
      return { kind: f['证书类别'] ?? null, score: item.score }
    case 'sport':
      return {
        participation: f['最高参与等级'] ?? null,
        level: f['最高获奖等级'] ?? null,
        rank: num(f['折算名次'] ?? '') ?? null,
        team: item.team,
        score: item.score,
      }
    case 'campus':
      return {
        participation: num(f['活动参与加分'] ?? f['参与加分'] ?? f['活动参与得分'] ?? '') ?? 0,
        level: f['最高获奖等级'] ?? null,
        rank: num(f['折算名次'] ?? '') ?? null,
        award: num(f['活动获奖加分'] ?? '') ?? null,
        special: item.special,
        score: item.score,
      }
    case 'research':
      return { type: f['科研类型'] ?? null, role: f['参与身份'] ?? null, score: item.score }
    case 'article':
      return { type: f['投稿类型'] ?? null, news: item.newsReport, score: item.score }
  }
}

const addToPool = (category: Category, student: string, item: ParsedItem) => {
  const variant = variantOf(category, item)
  const nameKey = CATEGORIES[category].nameKey
  if (nameKey === null) {
    // no names at all: only how often each shape occurs
    const table = typeTables.get(category) ?? new Map<string, number>()
    const key = JSON.stringify(variant)
    table.set(key, (table.get(key) ?? 0) + 1)
    typeTables.set(category, table)
    return
  }
  const name = item.fields[nameKey]
  if (name === undefined || name === '') return
  const key = keyOf(name)
  if (key === '') return
  const pool = pools.get(category) ?? new Map<string, PoolEntry>()
  pools.set(category, pool)
  const entry = pool.get(key) ?? { spellings: new Map(), students: new Set(), variants: new Map() }
  pool.set(key, entry)
  entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1)
  entry.students.add(student)
  const variantKey = JSON.stringify(variant)
  const known = entry.variants.get(variantKey)
  if (known) known.n += 1
  else entry.variants.set(variantKey, { fields: variant, n: 1 })
}

/** a frequency table as a sorted object, for small discrete values */
const frequencies = (values: readonly number[]) => {
  const table = new Map<string, number>()
  for (const value of values) table.set(String(value), (table.get(String(value)) ?? 0) + 1)
  return Object.fromEntries([...table.entries()].sort((a, b) => Number(a[0]) - Number(b[0])))
}

/** twenty-one evenly spaced quantiles, enough to sample a smooth distribution from */
const quantiles = (values: readonly number[]) => {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  return Array.from({ length: 21 }, (_, i) => {
    const at = (i / 20) * (sorted.length - 1)
    const low = Math.floor(at)
    const high = Math.ceil(at)
    return Math.round((sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low)) * 100) / 100
  })
}

// --- the terms -------------------------------------------------------------

const MAJORS: Record<string, string> = {
  计算机科学与技术: 'cs',
  软件工程: 'se',
  网络工程: 'ne',
  信息管理与信息系统: 'is',
  大数据管理与应用: 'bd',
}

interface TermRow {
  readonly student: string
  readonly major: string
  readonly classNo: number
  readonly cohort: string
  readonly flag: string
}

const termRows = new Map<Term, TermRow[]>()
const termOut: Record<string, unknown> = {}

for (const term of TERMS) {
  const rows = (await readSheet(`result/${term}.xlsx`)).filter((row) =>
    /^\d{9}$/.test(field(row, '学号').split('.')[0]!),
  )
  const kept: TermRow[] = []
  const counts: Record<string, number> = {}
  let unreadable = 0
  const perStudent: Record<string, number[]> = {}
  const numbers: Record<string, number[]> = {}
  const weightedByMajor: Record<string, number[]> = {}
  const cadres = new Map<string, { score: number; n: number }>()
  const practiceValid: number[] = []
  const selfStudyAbsences: number[] = []
  const moralOtherReasons = new Map<string, number>()

  for (const row of rows) {
    const student = field(row, '学号').split('.')[0]!
    const major = MAJORS[field(row, '专业')] ?? 'other'
    const className = field(row, '班级')
    const classMatch = /(\d{4})级(\d+)班/.exec(className)
    kept.push({
      student,
      major,
      classNo: classMatch ? Number(classMatch[2]) : 0,
      cohort: classMatch ? classMatch[1]! : '',
      flag: field(row, '学生标识').replace(/[（）()]/g, ''),
    })

    for (const [category, { column }] of Object.entries(CATEGORIES) as [
      Category,
      (typeof CATEGORIES)[Category],
    ][]) {
      const detail = field(row, column)
      if (detail === '') continue
      const { items, unreadable: bad } = parseItems(detail)
      unreadable += bad
      counts[category] = (counts[category] ?? 0) + items.length
      ;(perStudent[category] ??= []).push(items.length)
      for (const item of items) addToPool(category, student, item)
      if (category === 'practice') {
        const valid = /有效社会实践：(\d+)个，有效志愿服务：(\d+)个/.exec(detail)
        if (valid) practiceValid.push(Number(valid[1]) + Number(valid[2]))
      }
    }

    for (const match of field(row, '分数构成详情-学生干部').matchAll(
      /计分干部类型：(.*?)，「获得分数：(-?[\d.]+)分」/g,
    )) {
      const post = scrub(match[1]!.trim())
      const known = cadres.get(post) ?? { score: Number(match[2]), n: 0 }
      known.n += 1
      cadres.set(post, known)
    }
    const absences = num(field(row, '分数构成详情-自习缺席次数'))
    if (absences !== null) selfStudyAbsences.push(absences)
    for (const match of field(row, '分数构成详情-"其他"加减分详情').matchAll(
      /【(加分|减分)原因：/g,
    )) {
      moralOtherReasons.set(match[1]!, (moralOtherReasons.get(match[1]!) ?? 0) + 1)
    }

    for (const [name, prefix] of Object.entries(NUMBERS)) {
      const value = num(field(row, prefix))
      if (value === null) continue
      ;(numbers[name] ??= []).push(value)
      if (name === 'weighted') (weightedByMajor[major] ??= []).push(value)
    }
  }

  termRows.set(term, kept)
  report.terms[term] = { students: kept.length, items: counts, unreadable }

  const classes = new Map<string, number>()
  for (const row of kept) {
    const key = `${row.cohort}-${row.classNo}-${row.major}`
    classes.set(key, (classes.get(key) ?? 0) + 1)
  }

  termOut[term] = {
    students: kept.length,
    byMajor: Object.fromEntries(
      Object.values(MAJORS).map((major) => [
        major,
        kept.filter((row) => row.major === major).length,
      ]),
    ),
    classes: [...classes.entries()]
      .map(([key, size]) => {
        const [cohort, classNo, major] = key.split('-')
        return { cohort, classNo: Number(classNo), major, size }
      })
      .sort((a, b) => a.cohort!.localeCompare(b.cohort!) || a.classNo - b.classNo),
    flags: frequenciesOfText(kept.map((row) => row.flag)),
    itemsPerStudent: Object.fromEntries(
      Object.entries(perStudent).map(([category, values]) => [category, frequencies(values)]),
    ),
    practiceValid: frequencies(practiceValid),
    cadres: Object.fromEntries(
      [...cadres.entries()].filter(([, { n }]) => n >= K).map(([post, value]) => [post, value]),
    ),
    selfStudyAbsences: frequencies(selfStudyAbsences),
    moralOther: Object.fromEntries(moralOtherReasons),
    numbers: Object.fromEntries(
      Object.entries(numbers).map(([name, values]) =>
        name === 'weighted' || name.endsWith('Total') || name === 'total'
          ? [name, { quantiles: quantiles(values) }]
          : [name, { frequencies: frequencies(values) }],
      ),
    ),
    weightedByMajor: Object.fromEntries(
      Object.entries(weightedByMajor).map(([major, values]) => [major, quantiles(values)]),
    ),
  }
}

function frequenciesOfText(values: readonly string[]) {
  const table: Record<string, number> = {}
  for (const value of values) table[value] = (table[value] ?? 0) + 1
  return table
}

// --- movements between terms, as counts ------------------------------------

const movements = TERMS.slice(1).map((term, index) => {
  const before = new Map(termRows.get(TERMS[index]!)!.map((row) => [row.student, row]))
  const after = new Map(termRows.get(term)!.map((row) => [row.student, row]))
  let left = 0
  let joined = 0
  let majorChanged = 0
  let classChanged = 0
  let cohortChanged = 0
  for (const [student, row] of before) {
    const next = after.get(student)
    if (next === undefined) {
      left += 1
      continue
    }
    if (next.major !== row.major) majorChanged += 1
    else if (next.cohort !== row.cohort) cohortChanged += 1
    else if (next.classNo !== row.classNo) classChanged += 1
  }
  const olderCohorts = new Map<string, number>()
  for (const [student, row] of after) {
    if (before.has(student)) continue
    joined += 1
    const cohort = `20${student.slice(0, 2)}`
    olderCohorts.set(cohort, (olderCohorts.get(cohort) ?? 0) + 1)
    void row
  }
  return {
    from: TERMS[index],
    to: term,
    left,
    joined,
    joinedByCohort: Object.fromEntries(olderCohorts),
    majorChanged,
    classChanged,
    cohortChanged,
  }
})

// --- appeals, as counts ----------------------------------------------------

const appealOut: Record<string, unknown> = {}
const APPEAL_TYPES: Record<string, string> = {
  漏加: 'missing',
  忘加: 'missing',
  补加: 'missing',
  补充: 'missing',
  错加: 'wrong',
  多加: 'excess',
  学业成绩有误: 'grades',
  不要了: 'withdraw',
}
for (const term of TERMS.slice(1)) {
  const rows = await readSheet(`appeal/${term}.xlsx`)
  const kinds: Record<string, number> = {}
  const verdicts: Record<string, number> = {}
  for (const row of rows) {
    const kind = APPEAL_TYPES[(row['申诉类型'] ?? row['项目'] ?? '').trim()] ?? 'other'
    kinds[kind] = (kinds[kind] ?? 0) + 1
    const verdict =
      row['终审结果'] ?? row['终审建议'] ?? row['审核意见'] ?? row['终审'] ?? row['审核结果'] ?? ''
    const settled = /驳回|未通过|不予|维持/.test(verdict)
      ? 'rejected'
      : /通过|已补|已更|已修|已删|已调|同意|采纳/.test(verdict)
        ? 'accepted'
        : 'unclear'
    verdicts[settled] = (verdicts[settled] ?? 0) + 1
  }
  appealOut[term] = { total: rows.length, kinds, verdicts }
}

// --- the pools, thresholded ------------------------------------------------

const poolOut: Record<string, unknown> = {}
const shapesOut: Record<string, unknown> = {}
for (const [category, pool] of pools) {
  const kept = [...pool.values()]
    .filter((entry) => entry.students.size >= K)
    .sort((a, b) => b.students.size - a.students.size)
    .map((entry) => ({
      name: displayOf(entry.spellings),
      students: entry.students.size,
      variants: [...entry.variants.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, 8)
        .map(({ fields, n }) => ({ ...fields, n })),
    }))
  report.pools[category] = {
    distinctNames: pool.size,
    kept: kept.length,
    droppedUnderK: pool.size - kept.length,
  }
  poolOut[category] = kept
  // every claim's shape, whatever it was called, for the seeder to sample
  const shapes = new Map<string, number>()
  for (const entry of pool.values()) {
    for (const [key, { n }] of entry.variants) shapes.set(key, (shapes.get(key) ?? 0) + n)
  }
  shapesOut[category] = [...shapes.entries()]
    .map(([key, n]) => ({ ...JSON.parse(key), n }))
    .sort((a, b) => b.n - a.n)
}
for (const [category, table] of typeTables) {
  shapesOut[category] = [...table.entries()]
    .map(([key, n]) => ({ ...JSON.parse(key), n }))
    .sort((a, b) => b.n - a.n)
  report.pools[category] = { distinctNames: 0, kept: table.size, droppedUnderK: 0 }
}

fs.writeFileSync(
  OUTPUT,
  `${JSON.stringify(
    {
      note: 'Compiled by tools/demo/compile.ts from private source workbooks. Counts, distributions and things at least K students claimed; no person, name or number of anybody.',
      k: K,
      terms: termOut,
      movements,
      appeals: appealOut,
      shapes: shapesOut,
    },
    null,
    2,
  )}\n`,
)

fs.mkdirSync(path.dirname(PRIVATE_POOLS), { recursive: true })
fs.writeFileSync(PRIVATE_POOLS, `${JSON.stringify(poolOut, null, 2)}\n`)

// --- the report ------------------------------------------------------------

console.log(`wrote ${OUTPUT} and ${PRIVATE_POOLS}`)
for (const [term, summary] of Object.entries(report.terms)) {
  console.log(
    `${term}: ${summary.students} students, items ${JSON.stringify(summary.items)}, unreadable ${summary.unreadable}`,
  )
}
for (const [category, summary] of Object.entries(report.pools)) {
  console.log(
    `pool ${category.padEnd(12)} names ${String(summary.distinctNames).padStart(5)}  kept ${String(summary.kept).padStart(4)}  dropped under k=${K}: ${summary.droppedUnderK}`,
  )
}
for (const move of movements)
  console.log(`move ${move.from} -> ${move.to}: ${JSON.stringify(move)}`)
for (const [term, appeal] of Object.entries(appealOut))
  console.log(`appeals ${term}: ${JSON.stringify(appeal)}`)
