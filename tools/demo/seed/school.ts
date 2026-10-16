export const SCHOOL_NAME = '大连外国语大学'

export const SCHOOL_ORG_TYPES = [
  '校区',
  '学院',
  '年级',
  '专业',
  '专业方向',
  '班级',
  '部门',
] as const

/** Both direct classes and classes under an optional direction are legal. */
export const SCHOOL_ORG_RULES = [
  ['学校', '校区'],
  ['学校', '部门'],
  ['校区', '学院'],
  ['校区', '部门'],
  ['学院', '年级'],
  ['学院', '部门'],
  ['年级', '专业'],
  ['专业', '专业方向'],
  ['专业', '班级'],
  ['专业方向', '班级'],
] as const

export const SECONDARY_MAJORS = [
  { key: 'english', name: '英语' },
  { key: 'translation', name: '翻译' },
] as const
export type SecondaryMajorKey = (typeof SECONDARY_MAJORS)[number]['key']

const secondaryMajorOf = (index: number): SecondaryMajorKey =>
  index < 4 ? 'english' : 'translation'

/** The direction is a demo configuration, not a claim about the school's current programme. */
export const SECONDARY_CLASSES = Array.from({ length: 6 }, (_, index) => ({
  key: `english-2023-${index + 1}`,
  no: index + 1,
  major: secondaryMajorOf(index),
  name: `${index < 4 ? '英语' : '翻译'}2023级${index + 1}班`,
  direction: index < 2 ? '国际传播' : null,
  size: 30,
}))
