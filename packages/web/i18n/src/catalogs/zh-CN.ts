import type { CatalogFor } from '@qualy/i18n-contract'
import { commonMessages } from '../messages.ts'
import { commonErrorMessages, networkErrorMessage, unexpectedErrorMessage } from '../format.ts'

// the exact key set the runtime declares: a missing translation, an orphan
// key or a typo fails typecheck instead of waiting for the catalog test
const runtimeMessages = {
  ...commonMessages,
  network: networkErrorMessage,
  unexpected: unexpectedErrorMessage,
  authRequired: commonErrorMessages.AUTH_REQUIRED.message,
  sessionExpired: commonErrorMessages.SESSION_EXPIRED.message,
  accessDenied: commonErrorMessages.ACCESS_DENIED.message,
  badRequest: commonErrorMessages.BAD_REQUEST.message,
} as const

// common/* messages: shared shell copy and transport-level api errors.
// Raw icu strings, compiled by the runtime on demand.
export default {
  'common/action/retry': '重试',
  'common/action/back': '返回',
  'common/action/cancel': '取消',
  'common/action/close': '关闭',
  'common/action/go-home': '回到首页',
  'common/error/auth-required': '请先登录。',
  'common/error/session-expired': '登录状态已过期，请重新登录。',
  'common/error/access-denied': '你没有执行该操作的权限。',
  'common/error/bad-request': '输入内容有误。',
  'common/error/network': '无法连接服务器，请检查网络后重试。',
  'common/error/unexpected': '操作失败，请重试。',
  'common/calendar/month': '月份',
  'common/calendar/year': '年份',
  'common/clock/hour': '小时',
  'common/clock/minute': '分钟',
  'common/state/loading': '加载中',
  'common/state/more-results': '还有更多结果，缩小搜索范围可以看到。',
  'common/manifest/load-failed': '界面清单加载失败，请检查网络。',
  'common/component/missing': '渲染器缺失：{component}',
  'common/layout/missing': '布局渲染器缺失：{component}',
  'common/page/empty-title': '暂无可用页面',
  'common/page/empty-hint': '当前部署里没有你的账号可以打开的页面。',
  'common/component/page-failed': '该页面无法显示。',
  'common/component/layout-failed': '应用框架无法显示。',
  'common/page/not-found-title': '页面不存在',
  'common/page/not-found-hint': '这个地址没有对应到任何你能打开的页面。',
} satisfies CatalogFor<typeof runtimeMessages>
