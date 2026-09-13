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
  requestOriginRefused: commonErrorMessages.REQUEST_ORIGIN_REFUSED.message,
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
  'common/error/request-origin-refused': '请求来源不受信任，请刷新页面后重试。',
  'common/error/network': '无法连接服务器，请检查网络后重试。',
  'common/error/unexpected': '操作失败，请重试。',
  'common/clock/hour': '小时',
  'common/clock/minute': '分钟',
  'common/clock/second': '秒',
  'common/calendar/month': '月份',
  'common/calendar/year': '年份',
  'common/state/loading': '加载中',
  'common/state/still-loading': '加载时间较长，请稍候…',
  'common/release/update-available-title': 'Qualy 已更新',
  'common/release/update-available-hint': '刷新后即可使用最新版本。',
  'common/action/later': '稍后',
  'common/action/reload': '刷新',
  'common/release/skew-title': 'Qualy 已更新',
  'common/release/skew-hint': '当前版本无法继续加载该页面。刷新后即可继续使用。',
  'common/release/asset-failed-title': '页面资源加载失败',
  'common/release/asset-failed-hint': '请检查网络后刷新页面。',
  'common/release/client-protocol-title': 'Qualy 需要更新',
  'common/release/client-protocol-hint': '当前页面版本已无法与服务器继续通信。刷新后即可继续使用。',
  'common/action/reload-page': '刷新页面',
  'common/state/more-results': '还有更多结果，缩小搜索范围可以看到。',
  'common/manifest/load-failed': '界面清单加载失败，请检查网络。',
  'common/component/missing': '渲染器缺失：{component}',
  'common/layout/missing': '布局渲染器缺失：{component}',
  'common/page/empty-title': '暂无可用页面',
  'common/page/empty-hint': '当前部署里没有你的账号可以打开的页面。',
  'common/component/page-failed': '该页面无法显示。',
  'common/component/layout-failed': '应用框架无法显示。',
  'common/page/not-found-title': '页面不存在',
  'common/page/not-found-hint': '未找到页面，请检查路径后重试。',
} satisfies CatalogFor<typeof runtimeMessages>
