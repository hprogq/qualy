import type { Random } from './context.ts'

export type SecondaryActivityKind = 'culture' | 'service' | 'competition'

const EVIDENCE = {
  culture: {
    instructions: '请补充活动通知中载明参与认定的页面',
    file: '活动通知',
    suffix: 'notice',
  },
  service: {
    instructions: '请补充服务单位盖章并载明具体职责的实践鉴定意见',
    file: '实践鉴定意见',
    suffix: 'opinion',
  },
  competition: {
    instructions: '请补充组委会公布的获奖名单，名单应包含英语学院的参赛记录',
    file: '获奖名单',
    suffix: 'award-list',
  },
} as const

const activity = (
  kind: SecondaryActivityKind,
  key: string,
  name: string,
  work: string,
  award?: string,
) => ({
  kind,
  key,
  name,
  work,
  award,
  proof: `english-${key}-proof`,
  ask: {
    instructions: `${EVIDENCE[kind].instructions}，对应活动为${name}`,
    file: EVIDENCE[kind].file,
    asset: `english-${key}-${EVIDENCE[kind].suffix}`,
    filename: `${name}${EVIDENCE[kind].file}.jpg`,
  },
})

/** Business descriptions and their evidence pairs stay independent of the service runtime. */
export const SECONDARY_ACTIVITIES = [
  {
    title: '语言文化活动',
    value: '0.30',
    activities: [
      activity('culture', 'drama', '英语戏剧展演', '完成剧本研读、排练和舞台演出'),
      activity('culture', 'workshop', '跨文化交际工作坊', '参加小组研讨并完成跨文化案例展示'),
      activity('culture', 'reading', '经典文学读书会', '完成作品阅读并参与现场分享'),
      activity('culture', 'hosting', '校园双语主持比赛', '完成双语主持展示和现场互动'),
    ],
  },
  {
    title: '志愿服务与社会实践',
    value: '0.50',
    activities: [
      activity('service', 'community', '社区英语公益课堂', '协助备课并完成社区英语课堂教学'),
      activity('service', 'exchange', '国际交流活动志愿服务', '承担来宾引导和双语咨询服务'),
      activity('service', 'library', '图书馆外文书目整理', '核对外文书目信息并完成分类归架'),
      activity('service', 'rural', '乡村英语公益课堂', '整理教学材料并完成公益英语教学'),
    ],
  },
  {
    title: '学科竞赛',
    value: '1.00',
    activities: [
      activity('competition', 'speech', '大学生英语演讲比赛', '完成英文演讲和现场问答', '一等奖'),
      activity(
        'competition',
        'interpreting',
        '全国口译邀请赛校内选拔',
        '完成现场口译选拔任务',
        '优胜奖',
      ),
      activity('competition', 'writing', '大学生英语写作比赛', '独立完成英文写作作品', '二等奖'),
      activity(
        'competition',
        'video',
        '多语种短视频创作大赛',
        '完成短视频脚本和作品制作',
        '优秀作品奖',
      ),
    ],
  },
] as const

export type SecondaryActivity = (typeof SECONDARY_ACTIVITIES)[number]['activities'][number]

/** Pick distinct events for one participant without separating their evidence from the event. */
export const drawSecondaryActivities = (random: Pick<Random, 'int'>, count: number) => {
  const available = SECONDARY_ACTIVITIES.flatMap((spec) =>
    spec.activities.map((activity) => ({ spec, activity })),
  )
  if (!Number.isInteger(count) || count < 0 || count > available.length) {
    throw new RangeError('Secondary activity count is outside the available catalog')
  }
  return Array.from(
    { length: count },
    () => available.splice(random.int(0, available.length - 1), 1)[0]!,
  )
}
