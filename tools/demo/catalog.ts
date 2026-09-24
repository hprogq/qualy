// What students in the demonstration claim, written out by hand.
//
// Every name here is a generalisation of something real students claimed
// often (the private pools compile.ts writes), with the part that would name
// the school taken out: no lecturer, partner university, company, city or
// anniversary. The weights follow how often the real thing was claimed, so a
// cohort sampled from these looks like one, while no line belongs to anybody.
//
// A record carries what a student fills in when filing: the name, and the
// tier the rules ask about. What a reviewer determines is decided later, by
// the seeder, starting from these.

/** a thing, and how often it turns up relative to its neighbours */
export interface Weighted {
  readonly weight: number
}

/**
 * A campus activity: the participation points its organiser set, and
 * whether it was a contest that awards places, and at which level.
 */
export interface CampusActivity extends Weighted {
  readonly name: string
  readonly participation: '0.1' | '0.2' | '0.5' | '0.8' | '1'
  readonly contest: 'none' | 'college' | 'university'
}

export const CAMPUS_ACTIVITIES: readonly CampusActivity[] = [
  { name: '校运动会观众（全天）', participation: '1', contest: 'none', weight: 120 },
  { name: '校运动会观众', participation: '0.2', contest: 'none', weight: 200 },
  { name: '校运动会工作人员', participation: '1', contest: 'none', weight: 40 },
  { name: '校运动会裁判员', participation: '0.8', contest: 'none', weight: 25 },
  { name: '校运动会方队队员', participation: '0.8', contest: 'none', weight: 30 },
  { name: '校运动会仪仗队', participation: '0.8', contest: 'none', weight: 30 },
  { name: '冬季义务扫雪', participation: '0.2', contest: 'none', weight: 110 },
  { name: '新生报到迎新志愿者', participation: '0.5', contest: 'none', weight: 120 },
  { name: '迎新晚会演职人员', participation: '0.5', contest: 'none', weight: 20 },
  { name: '毕业典礼工作人员', participation: '0.5', contest: 'none', weight: 35 },
  { name: '春季大型招聘会志愿者', participation: '0.5', contest: 'none', weight: 45 },
  { name: '职业生涯规划大赛观众', participation: '0.2', contest: 'none', weight: 140 },
  { name: '职业生涯规划大赛', participation: '0.2', contest: 'college', weight: 40 },
  { name: '就业指导讲座', participation: '0.1', contest: 'none', weight: 120 },
  { name: '反诈骗宣传讲座', participation: '0.2', contest: 'none', weight: 70 },
  { name: '人工智能前沿学术讲座', participation: '0.2', contest: 'none', weight: 90 },
  { name: '大数据应用专题讲座', participation: '0.2', contest: 'none', weight: 80 },
  { name: '出国留学经验分享会', participation: '0.2', contest: 'none', weight: 45 },
  { name: '朋辈经验分享会', participation: '0.2', contest: 'none', weight: 40 },
  { name: '心理健康主题班会', participation: '0.2', contest: 'college', weight: 110 },
  { name: '心理情景剧微电影大赛', participation: '0.2', contest: 'university', weight: 18 },
  { name: '“21天好习惯”打卡活动', participation: '0.2', contest: 'college', weight: 80 },
  { name: '读书打卡活动', participation: '0.2', contest: 'none', weight: 25 },
  { name: '寝室公约大赛', participation: '0.2', contest: 'college', weight: 50 },
  { name: '公寓文化节', participation: '0.2', contest: 'university', weight: 50 },
  { name: '最美笔记征集大赛', participation: '0.2', contest: 'college', weight: 45 },
  { name: '新生辩论赛', participation: '0.2', contest: 'college', weight: 25 },
  { name: '辩论赛观众', participation: '0.2', contest: 'none', weight: 45 },
  { name: '计算机编程挑战赛', participation: '0.2', contest: 'college', weight: 25 },
  { name: '简历设计大赛', participation: '0.2', contest: 'college', weight: 30 },
  { name: '校园歌手大赛观众', participation: '0.2', contest: 'none', weight: 25 },
  { name: '校园歌手大赛工作人员', participation: '0.5', contest: 'none', weight: 15 },
  { name: '话剧专场演出观众', participation: '0.2', contest: 'none', weight: 30 },
  { name: '高雅艺术进校园观众', participation: '0.2', contest: 'none', weight: 22 },
  { name: '主持人大赛观众', participation: '0.2', contest: 'none', weight: 15 },
  { name: '校园迷你马拉松', participation: '0.2', contest: 'university', weight: 25 },
  { name: '环校园长跑', participation: '0.2', contest: 'university', weight: 15 },
  { name: '健身操舞大赛', participation: '0.2', contest: 'university', weight: 25 },
  { name: '武术比赛', participation: '0.2', contest: 'university', weight: 18 },
  { name: '趣味运动会', participation: '0.2', contest: 'university', weight: 12 },
  { name: '民族文化节工作人员', participation: '0.5', contest: 'none', weight: 15 },
  { name: '社团嘉年华工作人员', participation: '0.5', contest: 'none', weight: 20 },
  { name: '外语配音大赛', participation: '0.2', contest: 'college', weight: 25 },
  { name: '外语朗读大赛', participation: '0.2', contest: 'college', weight: 18 },
  { name: '书法大赛', participation: '0.2', contest: 'college', weight: 20 },
  { name: '主题摄影比赛', participation: '0.2', contest: 'university', weight: 12 },
  { name: '知识竞赛', participation: '0.2', contest: 'college', weight: 15 },
  { name: '劳动教育周服务实践', participation: '0.2', contest: 'none', weight: 20 },
  { name: '绿植领养活动', participation: '0.2', contest: 'none', weight: 15 },
  { name: '捐书公益活动', participation: '0.2', contest: 'none', weight: 15 },
  { name: '招生宣传“返校宣讲”活动', participation: '0.5', contest: 'none', weight: 30 },
  { name: '先进集体先进个人表彰大会观众', participation: '0.2', contest: 'none', weight: 15 },
  { name: '急救知识讲座', participation: '0.2', contest: 'none', weight: 12 },
  { name: '企业技术开放日参观', participation: '0.2', contest: 'none', weight: 20 },
  { name: '征兵宣传宣讲会', participation: '0.2', contest: 'none', weight: 10 },
  { name: '班导生迎新助手', participation: '0.5', contest: 'none', weight: 15 },
]

export interface PracticeActivity extends Weighted {
  readonly name: string
  readonly type: 'practice' | 'volunteer'
}

export const PRACTICE_ACTIVITIES: readonly PracticeActivity[] = [
  { name: '寒假“返家乡”社会实践', type: 'practice', weight: 60 },
  { name: '暑期“三下乡”社会实践', type: 'practice', weight: 45 },
  { name: '暑期企业实习', type: 'practice', weight: 55 },
  { name: '招生宣传“摆渡人”行动', type: 'practice', weight: 60 },
  { name: '乡村教育云端陪伴计划', type: 'practice', weight: 20 },
  { name: '非遗文化传承调研', type: 'practice', weight: 12 },
  { name: '城市马拉松志愿者', type: 'volunteer', weight: 25 },
  { name: '全国大学生体育赛事志愿者', type: 'volunteer', weight: 20 },
  { name: '无偿献血活动志愿者', type: 'volunteer', weight: 20 },
  { name: '社区养老院助老服务', type: 'volunteer', weight: 30 },
  { name: '孤独症儿童关爱活动', type: 'volunteer', weight: 18 },
  { name: '图书馆志愿服务', type: 'volunteer', weight: 25 },
  { name: '爱心义卖', type: 'volunteer', weight: 15 },
  { name: '劳动周服务实践志愿者', type: 'volunteer', weight: 20 },
]

/** how a practice claim is proven, as the real claims spread over the options */
export const PRACTICE_EVIDENCE = [
  { value: 'report', label: '社会实践或志愿服务报告', weight: 60 },
  { value: 'certificate', label: '学校或学院开具的参与证明', weight: 18 },
  { value: 'hours', label: '电子志愿服务时长记录', weight: 10 },
  { value: 'award', label: '受认可的大型活动获奖证书', weight: 6 },
  { value: 'post', label: '学校或学院公众号推文', weight: 6 },
] as const

/** a competition the school recognises, and the level it is held at */
export interface Competition extends Weighted {
  readonly name: string
  readonly levels: readonly ('national' | 'provincial' | 'municipal')[]
}

export const COMPETITIONS: readonly Competition[] = [
  { name: '蓝桥杯全国软件和信息技术专业人才大赛', levels: ['national', 'provincial'], weight: 30 },
  { name: '中国大学生计算机设计大赛', levels: ['national', 'provincial'], weight: 30 },
  {
    name: '“挑战杯”全国大学生课外学术科技作品竞赛',
    levels: ['national', 'provincial'],
    weight: 14,
  },
  { name: '中国国际大学生创新大赛', levels: ['national', 'provincial'], weight: 14 },
  {
    name: '全国大学生电子商务“创新、创意及创业”挑战赛',
    levels: ['national', 'provincial'],
    weight: 10,
  },
  { name: '“泰迪杯”数据分析技能赛', levels: ['national'], weight: 10 },
  { name: '全国大学生数学建模竞赛', levels: ['national', 'provincial'], weight: 8 },
  { name: '全国大学生信息安全竞赛', levels: ['national'], weight: 5 },
  { name: '省大学生日语技能大赛', levels: ['provincial'], weight: 22 },
  { name: '省大学生翻译大赛', levels: ['provincial'], weight: 12 },
  { name: '省大学生虚拟现实与新媒体创新设计大赛', levels: ['provincial'], weight: 12 },
  { name: '省普通高校大学生无线电测向竞赛', levels: ['provincial'], weight: 12 },
  { name: '省大学生创新创业年会', levels: ['provincial'], weight: 6 },
  { name: '省大学生信息素养大赛', levels: ['provincial'], weight: 6 },
  { name: '省大学生大数据挑战赛', levels: ['provincial'], weight: 10 },
  { name: '省大学生人工智能挑战赛', levels: ['provincial'], weight: 6 },
  { name: '市大学生程序设计竞赛', levels: ['municipal'], weight: 6 },
]

/** vocational certificates, the older rules' question */
export const VOCATIONAL_CERTIFICATES = [
  { value: 'driving', label: '机动车驾驶证', weight: 380 },
  { value: 'cet4', label: '大学英语四级证书', weight: 520 },
  { value: 'cet6', label: '大学英语六级证书', weight: 150 },
  { value: 'ncre2', label: '全国计算机等级考试二级', weight: 50 },
  { value: 'jlpt2', label: '日本语能力测试 N2', weight: 30 },
  { value: 'mandarin', label: '普通话水平测试二级甲等', weight: 25 },
  { value: 'tem4', label: '英语专业四级', weight: 6 },
] as const

/** language certificates, the question that replaced it */
export const LANGUAGE_CERTIFICATES = [
  { value: 'cet6', label: '大学英语六级考试（CET-6）425 分及以上', weight: 30 },
  { value: 'cet4', label: '大学英语四级考试（CET-4）425 分及以上', weight: 14 },
  { value: 'jlpt2', label: '日本语能力测试（JLPT）N2 级', weight: 8 },
  { value: 'jlpt1', label: '日本语能力测试（JLPT）N1 级', weight: 2 },
] as const

/** non-professional sport and arts events off campus, by the level they are held at */
export const OFF_CAMPUS_EVENTS = [
  { name: '市高校学生阳光体育长跑比赛', level: 'municipal', team: true, weight: 20 },
  { name: '市国际徒步大会', level: 'municipal', team: false, weight: 8 },
  { name: '省大学生田径锦标赛', level: 'provincial', team: false, weight: 10 },
  { name: '省大学生健身操舞锦标赛', level: 'provincial', team: true, weight: 12 },
  { name: '省大学生合唱比赛', level: 'provincial', team: true, weight: 8 },
  { name: '省大学生羽毛球锦标赛', level: 'provincial', team: false, weight: 6 },
  { name: '全国青少年模拟政协提案征集活动', level: 'national', team: true, weight: 6 },
  { name: '全国大学生武术套路锦标赛', level: 'national', team: false, weight: 3 },
] as const

/** research outputs: the kinds the rules tabulate, weighted as they were claimed */
export const RESEARCH_KINDS = [
  { value: 'project-university', label: '专业相关科研课题立项 - 校级', weight: 120 },
  { value: 'project-provincial', label: '专业相关科研课题立项 - 省部级', weight: 55 },
  { value: 'project-national', label: '专业相关科研课题立项 - 国家级', weight: 4 },
  { value: 'paper-general', label: '专业相关论文 - 一般刊物', weight: 25 },
  { value: 'paper-proceedings', label: '专业相关论文 - 正式出版的论文集', weight: 10 },
  { value: 'paper-core', label: '专业相关论文 - 核心刊物', weight: 2 },
  { value: 'software', label: '专业相关知识产权成果 - 软件著作权', weight: 30 },
  { value: 'utility-patent', label: '专业相关知识产权成果 - 实用新型专利', weight: 4 },
] as const

export const RESEARCH_ROLES = [
  { value: 'lead', label: '主持人', weight: 30 },
  { value: 'first', label: '第一参与人', weight: 28 },
  { value: 'second', label: '第二参与人', weight: 22 },
  { value: 'third', label: '第三参与人', weight: 14 },
  { value: 'fourth', label: '第四参与人', weight: 6 },
] as const

/** made-up project titles, assembled from a subject and a treatment */
export const RESEARCH_SUBJECTS = [
  '校园二手交易',
  '宿舍能耗监测',
  '课堂考勤',
  '智慧食堂排队',
  '高校社团管理',
  '古籍文字识别',
  '老年人跌倒检测',
  '外卖配送路径',
  '垃圾分类识别',
  '图书馆座位预约',
  '心理健康筛查',
  '乡村农产品溯源',
  '多语种术语检索',
  '实验室设备预约',
  '代码克隆检测',
] as const

export const RESEARCH_TREATMENTS = [
  '基于深度学习的{subject}系统设计与实现',
  '面向{subject}的轻量级推荐算法研究',
  '{subject}数据可视化平台',
  '基于知识图谱的{subject}分析方法',
  '{subject}小程序的开发与应用',
] as const

/** articles outside the profession, by the outlet the rules tier */
export const ARTICLE_KINDS = [
  { value: 'news-national', label: '全国性官方新闻网站发表作品且署名', weight: 12 },
  { value: 'news-provincial', label: '省市级官方新闻网站发表作品且署名', weight: 4 },
  { value: 'journal-national', label: '校外全国性刊物发表非专业学术论文且署名', weight: 8 },
  { value: 'journal-provincial', label: '校外省市级刊物发表非专业学术论文且署名', weight: 4 },
  { value: 'campus', label: '校内刊物、网站或公众号发表', weight: 3 },
] as const

export const ARTICLE_TITLES = [
  '青春助老践初心，温情陪伴暖夕阳',
  '走进乡村课堂：一次云端支教的记录',
  '湿地观鸟，与城市飞羽的一场约会',
  '非遗手艺里的青春答卷',
  '从一次社会调研看社区养老新需求',
  '让代码服务乡村：大学生科技下乡见闻',
] as const

/**
 * Student posts, with the tier the rules score them at. The counsellor
 * records these; nobody files for their own post.
 */
export const CADRE_POSTS = [
  { post: '班长', tier: 'officer', weight: 30 },
  { post: '团支书', tier: 'officer', weight: 30 },
  { post: '学习委员', tier: 'deputy', weight: 28 },
  { post: '副班长', tier: 'member', weight: 25 },
  { post: '文体委员', tier: 'member', weight: 24 },
  { post: '生活委员', tier: 'member', weight: 20 },
  { post: '组织委员', tier: 'member', weight: 18 },
  { post: '年级辅导员助理', tier: 'deputy', weight: 12 },
  { post: '学院分团委学术部部员', tier: 'member', weight: 10 },
  { post: '学院分团委实践部部员', tier: 'member', weight: 10 },
  { post: '学院分团委文体部部员', tier: 'member', weight: 8 },
  { post: '校学生会文体部部员', tier: 'member', weight: 8 },
  { post: '校学生会社团管理部部员', tier: 'member', weight: 6 },
  { post: '校融媒体中心部员', tier: 'member', weight: 8 },
  { post: '校学生会部长', tier: 'officer', weight: 2 },
  { post: '学院学生会主席团成员', tier: 'president', weight: 1 },
] as const

/** why a reviewer turns a claim back, in the words the batch's reasons list uses */
export const REJECTIONS = [
  { reason: '证明材料无法清晰辨识', comment: '照片模糊，请重新上传清晰的证明材料', weight: 30 },
  {
    reason: '现有材料不足以支持申报内容',
    comment: '仅有活动现场照片，请补充组织单位盖章的参与证明',
    weight: 30,
  },
  {
    reason: '申报内容与证明材料不一致',
    comment: '证明上的活动名称与申报不一致，请核对后重新提交',
    weight: 15,
  },
  { reason: '相关时间不在有效范围内', comment: '活动时间不在本学期材料范围内', weight: 10 },
  { reason: '与已有申报重复', comment: '该活动已在另一条申报中提交', weight: 10 },
  { reason: '不符合本项认定条件', comment: '该活动不属于学校或学院组织的校园文化活动', weight: 5 },
] as const

/** what a student writes when contesting a result, by kind */
export const APPEAL_REASONS = {
  missing: [
    '该活动我提交了参与证明，但结果里没有计分，麻烦再核对一下',
    '补交了组织单位盖章的证明，申请重新认定',
    '获奖证书当时漏传了，现已补充',
  ],
  wrong: [
    '认定的获奖等级有误，证书上是一等奖',
    '该项应为个人项目，不应按集体项目减半',
    '参与分按 0.2 计算，但该活动公布的参与分是 0.5',
  ],
} as const
