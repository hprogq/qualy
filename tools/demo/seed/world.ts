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
import { choosePersonaStudents } from './personas.ts'
import { privateIdentityOf } from './private-identity.ts'
import type { DemoAccounts } from '../accounts.ts'
import {
  SCHOOL_NAME,
  SCHOOL_ORG_TYPES,
  SCHOOL_ORG_RULES,
  SECONDARY_CLASSES,
  SECONDARY_MAJORS,
  type SecondaryMajorKey,
} from './school.ts'

// A fictional cohort inside the real school's organisation. The main
// college owns the six-term story; the second has its own people and
// directory, kept separate so historical cohort movements cannot mix them.
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

export interface StaffMember {
  readonly id: string
  readonly name: string
}

export interface SecondaryClassUnit extends Omit<ClassUnit, 'major'> {
  readonly major: SecondaryMajorKey
}

export interface SecondaryStudent extends Omit<Student, 'major'> {
  major: SecondaryMajorKey
}

export interface SecondaryCollege {
  readonly college: string
  readonly grade: string
  readonly majors: ReadonlyMap<SecondaryMajorKey, string>
  readonly classes: ReadonlyMap<string, SecondaryClassUnit>
  readonly students: readonly SecondaryStudent[]
  readonly classLeads: ReadonlyMap<string, readonly string[]>
  readonly staff: { readonly counsellor: StaffMember; readonly manager: StaffMember }
}

export interface World {
  readonly tenantId: string
  readonly admin: Principal
  readonly types: {
    readonly campus: string
    readonly college: string
    readonly grade: string
    readonly major: string
    readonly direction: string
    readonly class: string
    readonly department: string
  }
  readonly root: string
  readonly campuses: { readonly lushun: string; readonly zhongshan: string }
  readonly college: string
  readonly grade: string
  readonly majors: ReadonlyMap<MajorKey, string>
  readonly classes: Map<string, ClassUnit>
  readonly userTypes: {
    readonly student: string
    readonly demoStudent: string
    readonly faculty: string
    readonly business: string
  }
  readonly students: Student[]
  readonly roles: {
    readonly classLead: string
    readonly majorLead: string
    readonly gradeLead: string
    readonly counsellor: string
    readonly manager: string
    readonly ruleKeeper: string
    readonly formulaAuthor: string
    readonly inspector: string
    readonly formulaSharer: string
    readonly officeRecorder: string
  }
  readonly staff: {
    readonly counsellors: readonly StaffMember[]
    readonly manager: StaffMember
    readonly schoolFormulaAuthor: StaffMember
    readonly offices: readonly StaffMember[]
  }
  readonly secondary: SecondaryCollege
  /** the students holding each class's lead office now, two per class */
  readonly classLeads: Map<string, string[]>
  readonly majorLeads: readonly string[]
  readonly gradeLead: string
  /** grant ids by holder and role, so a handover can revoke them */
  readonly grants: Map<string, string>
  readonly nextName: () => string
  /** people the demonstration signs in as, who must stay where they are */
  readonly personas: Set<string>
  /**
   * The two students among them, fixed before anybody holds an office: the
   * student whose terms are written out, and a classmate who leads their
   * class from the first term to the last.
   */
  readonly cast: { readonly student: Student; readonly classLead: Student }
}

const classKeyOf = (cohort: string, no: number) => `${cohort}-${no}`

/** a class the way the school writes it: 软件2023级5班（软工） */
export const classNameOf = (cohort: string, no: number, major: MajorKey) =>
  `软件${cohort}级${no}班（${MAJORS.find((m) => m.key === major)!.short}）`

export const buildWorld = (input: {
  tenantId: string
  admin: Principal
  story: Story
  random: Random
  accounts: DemoAccounts
}) =>
  Effect.gen(function* () {
    const { tenantId, admin, story, random, accounts } = input
    const privateIdentity = privateIdentityOf()
    const org = yield* Org
    const iam = yield* Iam
    const access = yield* Access
    const provisioning = yield* UserProvisioning

    // the vocabulary, and which kind of unit may sit under which
    const typeIds = new Map<string, string>()
    for (const [index, name] of SCHOOL_ORG_TYPES.entries()) {
      const type = yield* story.step(
        org.createType(tenantId, { name, sortOrder: (index + 1) * 10 }, admin),
      )
      typeIds.set(name, type.id)
    }
    const rootType = (yield* org.listTypes(tenantId, admin)).find(
      (type) => !typeIds.has(type.name),
    )!.id
    typeIds.set('学校', rootType)
    for (const [parent, child] of SCHOOL_ORG_RULES) {
      yield* story.step(org.putRule(tenantId, typeIds.get(parent)!, typeIds.get(child)!, admin))
    }
    const root = (yield* org.readForest(tenantId, undefined, admin)).roots[0]!
    yield* story.step(org.updateNode(tenantId, root, { name: SCHOOL_NAME }, admin))
    // the bootstrap's placeholder name for the kind of unit at the top,
    // renamed the way an administrator would, on the types page
    yield* story.step(org.updateType(tenantId, rootType, { name: '学校' }, admin))

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
    const campuses = {
      lushun: yield* node(root, '校区', '旅顺校区', 10),
      zhongshan: yield* node(root, '校区', '中山校区', 20),
    }
    const academicOffice = yield* node(root, '部门', '教务处', 30)
    const college = yield* node(campuses.lushun, '学院', '软件学院', 10)
    const collegeOffice = yield* node(college, '部门', '教务办公室', 90)
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
    const demoStudent = yield* story.step(
      iam.userTypes.create(
        tenantId,
        {
          code: 'demo-student',
          name: '演示学生',
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
    const business = yield* story.step(
      iam.userTypes.create(
        tenantId,
        {
          code: 'business-account',
          name: '业务账号',
          placementPolicy: {
            mode: 'allow-list',
            orgTypeIds: [rootType, typeIds.get('学院')!, typeIds.get('部门')!],
          },
        },
        admin,
      ),
    )

    // the students, class by class, as one directory import
    const nextName = makeNames(random)
    let planned: Omit<Student, 'id'>[] = []
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
    const plannedCast = choosePersonaStudents(
      planned.map((person) => ({ ...person, id: person.number })),
    )
    const personaNumberByOriginal = new Map([
      [plannedCast.student.number, privateIdentity.student],
      [plannedCast.classLead.number, privateIdentity.classLead],
    ])
    planned = planned.map((person) => ({
      ...person,
      number: personaNumberByOriginal.get(person.number) ?? person.number,
    }))
    if (new Set(planned.map((person) => person.number)).size !== planned.length) {
      return yield* Effect.die(
        new Error('Private persona business numbers overlap the generated cohort'),
      )
    }
    const personaNumbers = new Set([privateIdentity.student, privateIdentity.classLead])
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
              userTypeId: personaNumbers.has(person.number) ? demoStudent : student,
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
      holders: string | readonly string[],
      anchor: string | readonly string[] | null,
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
              holderPolicy: {
                mode: 'allow-list',
                userTypeIds: typeof holders === 'string' ? [holders] : holders,
              },
              anchorPolicy:
                anchor === null
                  ? null
                  : {
                      mode: 'allow-list',
                      orgTypeIds: (typeof anchor === 'string' ? [anchor] : anchor).map((name) =>
                        typeIds.get(name)!,
                      ),
                    },
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
      [student, demoStudent],
      '班级',
    )
    const majorLead = yield* role(
      'major-lead',
      '专业负责人',
      ['assessment.review.process'],
      [student, demoStudent],
      '年级',
    )
    const gradeLead = yield* role(
      'grade-lead',
      '年级负责人',
      ['assessment.review.process'],
      [student, demoStudent],
      '年级',
    )
    // looking over a student's whole account is the counsellor's own
    // reading, not something recording or reviewing lends them
    const counsellor = yield* role(
      'counsellor',
      '辅导员',
      [
        'assessment.review.process',
        'assessment.review.reopen',
        'assessment.entry.record',
        'assessment.entry.read-all',
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
      [faculty, business],
      null,
    )
    const formulaAuthor = yield* role(
      'formula-author',
      '公式编写',
      ['assessment.formula.author'],
      [faculty, business],
      null,
    )
    // offering what the lead wrote to the college's other authors: a unit's
    // permission, so a role of its own anchored at the college - put into
    // the lead's batch role it would carry a code no round hands out, and a
    // round refuses a role it cannot take whole
    const formulaSharer = yield* role(
      'assessment-formula-share',
      '综测公式共享',
      ['assessment.formula.share'],
      [faculty, business],
      ['学校', '学院'],
    )
    // correcting a concluded claim outside any round is granted on purpose,
    // never implied by judging at the end of a route; the college's
    // inspection office holds it, and every batch accepts it at creation
    const inspector = yield* role(
      'assessment-inspector',
      '综测督查',
      ['assessment.entry.redetermine'],
      [faculty, (yield* iam.userTypes.list(tenantId)).find((type) => type.isSystem)!.id],
      '学院',
    )
    const officeRecorder = yield* role(
      'academic-recording',
      '教务成绩录入',
      ['assessment.entry.record'],
      business,
      '学院',
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

    // two leads per class, chosen among its students; in the class of the
    // student a visitor signs in as, one seat is the classmate who signs in
    // as its lead, and the student themself holds none. Three major leads
    // from different majors, the first of whom also leads the grade.
    const cast = choosePersonaStudents(students)
    const classLeads = new Map<string, string[]>()
    for (const unit of classes.values()) {
      const inClass = students.filter((person) => person.classKey === unit.key)
      let leads: string[]
      if (unit.key === cast.student.classKey) {
        const others = inClass.filter(
          (person) => person.id !== cast.student.id && person.id !== cast.classLead.id,
        )
        leads = [cast.classLead.id, others[random.int(0, others.length - 1)]!.id]
      } else {
        const first = random.int(0, inClass.length - 1)
        const second = (first + 1 + random.int(0, inClass.length - 2)) % inClass.length
        leads = [inClass[first]!.id, inClass[second]!.id]
      }
      classLeads.set(unit.key, leads)
      for (const lead of leads) yield* grant(lead, classLead, unit.nodeId)
    }
    const majorLeads = (['se', 'is', 'cs'] as const).map((major) => {
      const leading = new Set([...classLeads.values()].flat())
      const pool = students.filter(
        (person) =>
          person.major === major && !leading.has(person.id) && person.id !== cast.student.id,
      )
      return pool[random.int(0, pool.length - 1)]!.id
    })
    for (const lead of majorLeads) yield* grant(lead, majorLead, grade)
    yield* grant(majorLeads[0]!, gradeLead, grade)
    for (const id of staffIds.slice(0, 2)) yield* grant(id, counsellor, grade, 'subtree')
    yield* grant(staffIds[2]!, manager, college, 'subtree')
    yield* grant(staffIds[2]!, inspector, college, 'subtree')
    yield* grant(staffIds[2]!, formulaSharer, college, 'subtree')
    yield* grant(admin.userId, inspector, college, 'subtree')
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

    const createOffice = (name: string, email: string, placement: string) =>
      Effect.gen(function* () {
        const id = yield* story.step(
          iam.users.create(
            tenantId,
            { displayName: name, email, userTypeId: business, primaryOrgNodeId: placement },
            admin,
          ),
        )
        return { id, name }
      })
    const schoolFormulaAuthor = yield* createOffice(
      '校级综测规则维护',
      accounts.offices.schoolRules,
      academicOffice,
    )
    const primaryOffice = yield* createOffice(
      '软件学院教务办公室',
      accounts.offices.software,
      collegeOffice,
    )
    yield* grant(primaryOffice.id, officeRecorder, college, 'subtree')
    yield* grant(schoolFormulaAuthor.id, formulaSharer, root, 'subtree')
    yield* story.step(
      access.grants.grant(
        tenantId,
        { userId: schoolFormulaAuthor.id, roleId: formulaAuthor, target: { kind: 'tenant' } },
        admin,
      ),
    )

    const secondaryCollege = yield* node(campuses.lushun, '学院', '英语学院', 20)
    const secondaryGrade = yield* node(secondaryCollege, '年级', '2023级')
    const secondaryOfficeNode = yield* node(secondaryCollege, '部门', '教务办公室', 90)
    const secondaryMajors = new Map<SecondaryMajorKey, string>()
    for (const [index, major] of SECONDARY_MAJORS.entries()) {
      secondaryMajors.set(major.key, yield* node(secondaryGrade, '专业', major.name, index))
    }
    const directions = new Map<string, string>()
    const secondaryClasses = new Map<string, SecondaryClassUnit>()
    for (const unit of SECONDARY_CLASSES) {
      let parentId = secondaryMajors.get(unit.major)!
      if (unit.direction !== null) {
        const key = `${unit.major}:${unit.direction}`
        if (!directions.has(key)) {
          directions.set(key, yield* node(parentId, '专业方向', unit.direction))
        }
        parentId = directions.get(key)!
      }
      secondaryClasses.set(unit.key, {
        key: unit.key,
        no: unit.no,
        major: unit.major,
        name: unit.name,
        nodeId: yield* node(parentId, '班级', unit.name, unit.no),
      })
    }
    const secondaryPlanned = SECONDARY_CLASSES.flatMap((unit) =>
      Array.from({ length: unit.size }, (_, seat) => ({
        name: nextName(),
        number: `23998${String(unit.no).padStart(2, '0')}${String(seat + 1).padStart(2, '0')}`,
        classKey: unit.key,
        major: unit.major,
        activity: random.next() ** 1.6,
        standing: random.next(),
      })),
    )
    if (secondaryPlanned.some((person) => personaNumbers.has(person.number))) {
      return yield* Effect.die(
        new Error('Private persona business numbers overlap the secondary cohort'),
      )
    }
    const secondaryCreated = yield* story.step(
      transaction(
        provisioning.createUsers(
          tenantId,
          secondaryPlanned.map((person) => ({
            displayName: person.name,
            businessNo: person.number,
            userTypeId: student,
            primaryOrgNodeId: secondaryClasses.get(person.classKey)!.nodeId,
          })),
          admin,
        ),
      ),
      120,
    )
    const secondaryStudents: SecondaryStudent[] = secondaryPlanned.map((person, index) => ({
      ...person,
      id: secondaryCreated[index]!.id,
    }))
    const secondaryStaffPlanned = [
      { name: nextName(), number: 'T2022035', placement: secondaryGrade },
      { name: nextName(), number: 'T2018012', placement: secondaryCollege },
    ]
    const secondaryStaffCreated = yield* story.step(
      transaction(
        provisioning.createUsers(
          tenantId,
          secondaryStaffPlanned.map((person) => ({
            displayName: person.name,
            businessNo: person.number,
            userTypeId: faculty,
            primaryOrgNodeId: person.placement,
          })),
          admin,
        ),
      ),
    )
    const secondaryStaff = {
      counsellor: { id: secondaryStaffCreated[0]!.id, name: secondaryStaffPlanned[0]!.name },
      manager: { id: secondaryStaffCreated[1]!.id, name: secondaryStaffPlanned[1]!.name },
    }
    yield* grant(secondaryStaff.counsellor.id, counsellor, secondaryGrade, 'subtree')
    yield* grant(secondaryStaff.manager.id, manager, secondaryCollege, 'subtree')
    yield* grant(secondaryStaff.manager.id, inspector, secondaryCollege, 'subtree')
    yield* grant(secondaryStaff.manager.id, formulaSharer, secondaryCollege, 'subtree')
    yield* grant(admin.userId, inspector, secondaryCollege, 'subtree')
    yield* story.step(
      access.grants.grant(
        tenantId,
        { userId: secondaryStaff.manager.id, roleId: formulaAuthor, target: { kind: 'tenant' } },
        admin,
      ),
    )
    const secondaryClassLeads = new Map<string, string[]>()
    for (const unit of secondaryClasses.values()) {
      const candidates = secondaryStudents
        .filter((person) => person.classKey === unit.key)
        .sort((a, b) => b.activity - a.activity)
        .slice(0, 2)
      secondaryClassLeads.set(
        unit.key,
        candidates.map((person) => person.id),
      )
      for (const person of candidates) yield* grant(person.id, classLead, unit.nodeId)
    }
    const secondaryOffice = yield* createOffice(
      '英语学院教务办公室',
      accounts.offices.english,
      secondaryOfficeNode,
    )
    yield* grant(secondaryOffice.id, officeRecorder, secondaryCollege, 'subtree')
    const secondary: SecondaryCollege = {
      college: secondaryCollege,
      grade: secondaryGrade,
      majors: secondaryMajors,
      classes: secondaryClasses,
      students: secondaryStudents,
      classLeads: secondaryClassLeads,
      staff: secondaryStaff,
    }

    const world: World = {
      tenantId,
      admin,
      types: {
        campus: typeIds.get('校区')!,
        college: typeIds.get('学院')!,
        grade: typeIds.get('年级')!,
        major: typeIds.get('专业')!,
        direction: typeIds.get('专业方向')!,
        class: typeIds.get('班级')!,
        department: typeIds.get('部门')!,
      },
      root,
      campuses,
      college,
      grade,
      majors,
      classes,
      userTypes: { student, demoStudent, faculty, business },
      students,
      roles: {
        classLead,
        majorLead,
        gradeLead,
        counsellor,
        manager,
        ruleKeeper,
        formulaAuthor,
        inspector,
        formulaSharer,
        officeRecorder,
      },
      staff: {
        counsellors: staffIds
          .slice(0, 2)
          .map((id, index) => ({ id, name: staffPlanned[index]!.name })),
        manager: { id: staffIds[2]!, name: staffPlanned[2]!.name },
        schoolFormulaAuthor,
        offices: [primaryOffice, secondaryOffice],
      },
      secondary,
      classLeads,
      majorLeads,
      gradeLead: majorLeads[0]!,
      grants,
      nextName,
      personas: new Set([cast.student.id, cast.classLead.id]),
      cast,
    }
    return world
  })
