import { Effect } from 'effect'
import type { Principal } from '@qualy/rbac-contract'
import { Org } from '@qualy/plugin-org/server'
import { Iam } from '@qualy/plugin-auth/server'
import { Access } from '@qualy/plugin-rbac/server'
import { UserProvisioning } from '@qualy/auth-contract/provisioning'
import { transaction } from '@qualy/plugin-database/server'
import library from '../library.json' with { type: 'json' }
import { makeNames } from './names.ts'
import type { Random, Story } from './context.ts'

// The school as it stood in August 2023: one college, one grade, five
// majors and their classes, the students the first term counted, and the
// people who run the assessment.
//
// Class leads, major leads and the grade lead are students, as they are in
// the real process; counsellors and the assessment lead are staff. Every
// office is a role granted at the node it answers for, so the review ladder
// finds its people the way the product always does.

export const MAJORS = [
  { key: 'cs', name: '计算机科学与技术', short: '计科' },
  { key: 'se', name: '软件工程', short: '软工' },
  { key: 'ne', name: '网络工程', short: '网工' },
  { key: 'is', name: '信息管理与信息系统', short: '信管' },
  { key: 'bd', name: '大数据管理与应用', short: '大数据' },
] as const
export type MajorKey = (typeof MAJORS)[number]['key']

export interface ClassUnit {
  readonly key: string
  readonly no: number
  readonly major: MajorKey
  readonly name: string
  readonly nodeId: string
}

export interface Student {
  readonly id: string
  readonly name: string
  readonly number: string
  classKey: string
  major: MajorKey
  /** how much this person takes part, 0 to 1, stable across terms */
  readonly activity: number
  /** where this person tends to sit in the grade's academic distribution, 0 to 1 */
  readonly standing: number
}

export interface World {
  readonly tenantId: string
  readonly admin: Principal
  readonly types: {
    readonly college: string
    readonly grade: string
    readonly major: string
    readonly class: string
  }
  readonly college: string
  readonly grade: string
  readonly majors: ReadonlyMap<MajorKey, string>
  readonly classes: Map<string, ClassUnit>
  readonly userTypes: { readonly student: string; readonly faculty: string }
  readonly students: Student[]
  readonly roles: {
    readonly classLead: string
    readonly majorLead: string
    readonly gradeLead: string
    readonly counsellor: string
    readonly manager: string
    readonly ruleKeeper: string
  }
  readonly staff: {
    readonly counsellors: readonly { id: string; name: string }[]
    readonly manager: { id: string; name: string }
  }
  /** the students holding each class's lead office now, two per class */
  readonly classLeads: Map<string, string[]>
  readonly majorLeads: readonly string[]
  readonly gradeLead: string
  /** grant ids by holder and role, so a handover can revoke them */
  readonly grants: Map<string, string>
  readonly nextName: () => string
  /** people the demonstration signs in as, who must stay where they are */
  readonly personas: Set<string>
}

const classKeyOf = (cohort: string, no: number) => `${cohort}-${no}`

/** a class the way the school writes it: 软件2023级5班（软工） */
export const classNameOf = (cohort: string, no: number, major: MajorKey) =>
  `软件${cohort}级${no}班（${MAJORS.find((m) => m.key === major)!.short}）`

const ORG_TYPES = ['学院', '年级', '专业', '班级'] as const

export const buildWorld = (input: {
  tenantId: string
  admin: Principal
  story: Story
  random: Random
}) =>
  Effect.gen(function* () {
    const { tenantId, admin, story, random } = input
    const org = yield* Org
    const iam = yield* Iam
    const access = yield* Access
    const provisioning = yield* UserProvisioning

    // the vocabulary, and which kind of unit may sit under which
    const typeIds = new Map<string, string>()
    for (const [index, name] of ORG_TYPES.entries()) {
      const type = yield* story.step(
        org.createType(tenantId, { name, sortOrder: (index + 1) * 10 }, admin),
      )
      typeIds.set(name, type.id)
    }
    const rootType = (yield* org.listTypes(tenantId, admin)).find(
      (type) => !typeIds.has(type.name),
    )!.id
    const chain = [rootType, ...ORG_TYPES.map((name) => typeIds.get(name)!)]
    for (let i = 0; i < chain.length - 1; i++) {
      yield* story.step(org.putRule(tenantId, chain[i]!, chain[i + 1]!, admin))
    }
    const root = (yield* org.readForest(tenantId, undefined, admin)).roots[0]!
    yield* story.step(org.updateNode(tenantId, root, { name: '示例大学' }, admin))

    const node = (parentId: string, type: string, name: string, sortOrder?: number) =>
      story.step(
        Effect.map(
          org.createNode(
            tenantId,
            {
              parentId,
              orgTypeId: typeIds.get(type)!,
              name,
              ...(sortOrder === undefined ? {} : { sortOrder }),
            },
            admin,
          ),
          (created) => created.id,
        ),
        5,
      )
    const college = yield* node(root, '学院', '软件学院')
    const grade = yield* node(college, '年级', '2023级')
    const majors = new Map<MajorKey, string>()
    for (const [index, major] of MAJORS.entries()) {
      majors.set(major.key, yield* node(grade, '专业', major.name, index))
    }

    // the classes the first term counted; the big-data class is numbered
    // after the rest, as its own major's single class
    const classes = new Map<string, ClassUnit>()
    const firstTerm = library.terms['23-24-1'].classes
    for (const unit of firstTerm) {
      const major = unit.major as MajorKey
      const no = major === 'bd' ? 29 : unit.classNo
      const name = classNameOf('2023', no, major)
      const nodeId = yield* node(majors.get(major)!, '班级', name, no)
      classes.set(classKeyOf('2023', no), { key: classKeyOf('2023', no), no, major, name, nodeId })
    }

    // the kinds of people, and where each may stand
    const student = yield* story.step(
      iam.userTypes.create(
        tenantId,
        {
          code: 'student',
          name: '学生',
          placementPolicy: { mode: 'allow-list', orgTypeIds: [typeIds.get('班级')!] },
        },
        admin,
      ),
    )
    const faculty = yield* story.step(
      iam.userTypes.create(
        tenantId,
        {
          code: 'faculty',
          name: '教职工',
          placementPolicy: {
            mode: 'allow-list',
            orgTypeIds: [typeIds.get('学院')!, typeIds.get('年级')!],
          },
        },
        admin,
      ),
    )

    // the students, class by class, as one directory import
    const nextName = makeNames(random)
    const planned: Omit<Student, 'id'>[] = []
    for (const unit of firstTerm) {
      const major = unit.major as MajorKey
      const no = major === 'bd' ? 29 : unit.classNo
      for (let seat = 1; seat <= unit.size; seat++) {
        planned.push({
          name: nextName(),
          number: `23099${String(no).padStart(2, '0')}${String(seat).padStart(2, '0')}`,
          classKey: classKeyOf('2023', no),
          major,
          activity: random.next() ** 1.6,
          standing: random.next(),
        })
      }
    }
    const staffPlanned = [
      { name: nextName(), number: 'T2019031', placement: grade },
      { name: nextName(), number: 'T2021017', placement: grade },
      { name: nextName(), number: 'T2016004', placement: college },
    ]
    const created = yield* story.step(
      transaction(
        Effect.gen(function* () {
          const students = yield* provisioning.createUsers(
            tenantId,
            planned.map((person) => ({
              displayName: person.name,
              businessNo: person.number,
              userTypeId: student,
              primaryOrgNodeId: classes.get(person.classKey)!.nodeId,
            })),
            admin,
          )
          const staff = yield* provisioning.createUsers(
            tenantId,
            staffPlanned.map((person) => ({
              displayName: person.name,
              businessNo: person.number,
              userTypeId: faculty,
              primaryOrgNodeId: person.placement,
            })),
            admin,
          )
          return { students, staff }
        }),
      ),
      600,
    )
    const students: Student[] = planned.map((person, index) => ({
      ...person,
      id: created.students[index]!.id,
    }))
    const staffIds = created.staff.map((row) => row.id)

    // the offices
    const role = (
      code: string,
      name: string,
      permissions: readonly string[],
      holders: string,
      anchor: string | null,
    ) =>
      Effect.gen(function* () {
        const id = yield* story.step(
          access.roles.create(
            tenantId,
            { code, name, kind: anchor === null ? 'tenant' : 'org' },
            admin,
          ),
        )
        let version = (yield* access.roles.get(tenantId, id, admin)).role.version
        version = yield* story.step(
          access.roles.setPermissions(tenantId, id, permissions, version, admin),
        )
        version = yield* story.step(
          access.roles.setEligibility(
            tenantId,
            id,
            {
              holderPolicy: { mode: 'allow-list', userTypeIds: [holders] },
              anchorPolicy:
                anchor === null ? null : { mode: 'allow-list', orgTypeIds: [typeIds.get(anchor)!] },
            },
            version,
            admin,
          ),
        )
        yield* story.step(access.roles.setStatus(tenantId, id, 'active', version, admin))
        return id
      })
    const classLead = yield* role(
      'class-lead',
      '班级综测负责人',
      ['assessment.review.process'],
      student,
      '班级',
    )
    const majorLead = yield* role(
      'major-lead',
      '专业负责人',
      ['assessment.review.process'],
      student,
      '年级',
    )
    const gradeLead = yield* role(
      'grade-lead',
      '年级负责人',
      ['assessment.review.process'],
      student,
      '年级',
    )
    const counsellor = yield* role(
      'counsellor',
      '辅导员',
      [
        'assessment.review.process',
        'assessment.review.reopen',
        'assessment.entry.record',
        'assessment.entry.proxy',
      ],
      faculty,
      '年级',
    )
    const manager = yield* role(
      'assessment-manager',
      '综测负责人',
      [
        'assessment.batch.manage',
        'assessment.batch.force-advance',
        'assessment.entry.record',
        'assessment.review.process',
      ],
      faculty,
      '学院',
    )

    // what the assessment lead does across the whole school rather than at a
    // unit: writing formulas, and reading everyone's results
    const ruleKeeper = yield* role(
      'assessment-rules',
      '综测规则维护',
      ['assessment.formula.author', 'assessment.result.view-peers', 'assessment.ranking.view'],
      faculty,
      null,
    )

    const grants = new Map<string, string>()
    const grant = (
      userId: string,
      roleId: string,
      nodeId: string,
      coverage: 'self' | 'subtree' = 'self',
    ) =>
      Effect.gen(function* () {
        const made = yield* story.step(
          access.grants.grant(
            tenantId,
            { userId, roleId, target: { kind: 'org-node', orgNodeId: nodeId, coverage } },
            admin,
          ),
          5,
        )
        grants.set(`${userId}:${roleId}`, made)
      })

    // one lead per class, chosen among its students; three major leads from
    // different majors, the first of whom also leads the grade
    const classLeads = new Map<string, string[]>()
    for (const unit of classes.values()) {
      const inClass = students.filter((person) => person.classKey === unit.key)
      const first = random.int(0, inClass.length - 1)
      const second = (first + 1 + random.int(0, inClass.length - 2)) % inClass.length
      const leads = [inClass[first]!.id, inClass[second]!.id]
      classLeads.set(unit.key, leads)
      for (const lead of leads) yield* grant(lead, classLead, unit.nodeId)
    }
    const majorLeads = (['se', 'is', 'cs'] as const).map((major) => {
      const leading = new Set([...classLeads.values()].flat())
      const pool = students.filter((person) => person.major === major && !leading.has(person.id))
      return pool[random.int(0, pool.length - 1)]!.id
    })
    for (const lead of majorLeads) yield* grant(lead, majorLead, grade)
    yield* grant(majorLeads[0]!, gradeLead, grade)
    for (const id of staffIds.slice(0, 2)) yield* grant(id, counsellor, grade, 'subtree')
    yield* grant(staffIds[2]!, manager, college, 'subtree')
    grants.set(
      `${staffIds[2]!}:${ruleKeeper}`,
      yield* story.step(
        access.grants.grant(
          tenantId,
          { userId: staffIds[2]!, roleId: ruleKeeper, target: { kind: 'tenant' } },
          admin,
        ),
      ),
    )

    const world: World = {
      tenantId,
      admin,
      types: {
        college: typeIds.get('学院')!,
        grade: typeIds.get('年级')!,
        major: typeIds.get('专业')!,
        class: typeIds.get('班级')!,
      },
      college,
      grade,
      majors,
      classes,
      userTypes: { student, faculty },
      students,
      roles: { classLead, majorLead, gradeLead, counsellor, manager, ruleKeeper },
      staff: {
        counsellors: staffIds
          .slice(0, 2)
          .map((id, index) => ({ id, name: staffPlanned[index]!.name })),
        manager: { id: staffIds[2]!, name: staffPlanned[2]!.name },
      },
      classLeads,
      majorLeads,
      gradeLead: majorLeads[0]!,
      grants,
      nextName,
      personas: new Set(),
    }
    return world
  })
