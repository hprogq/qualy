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
  'common/error/request-origin-refused': '当前页面无法完成该操作，请刷新后重试。',
  'common/error/network': '暂时无法连接 Qualy，请检查网络后重试。',
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
  'common/release/skew-title': '需要刷新页面',
  'common/release/skew-hint': '页面需要刷新后才能继续使用。',
  'common/release/asset-failed-title': '页面加载失败',
  'common/release/asset-failed-hint': '请检查网络后刷新页面。',
  'common/release/client-protocol-title': '需要刷新页面',
  'common/release/client-protocol-hint': '页面需要刷新后才能继续使用。',
  'common/action/reload-page': '刷新页面',
  'common/state/more-results': '还有更多结果，缩小搜索范围可以看到。',
  'common/manifest/load-failed': '暂时无法加载 Qualy，请检查网络后重试。',
  'common/component/missing': '该页面暂时无法打开。',
  'common/layout/missing': 'Qualy 暂时无法显示，请重试。',
  'common/page/empty-title': '暂无可用页面',
  'common/page/empty-hint': '你的账号目前没有可访问的内容。',
  'common/component/page-failed': '该页面无法显示。',
  'common/component/layout-failed': 'Qualy 暂时无法显示，请重试。',
  'common/page/not-found-title': '页面不存在',
  'common/page/not-found-hint': '该地址无法打开，请检查后重试。',
} satisfies CatalogFor<typeof runtimeMessages>
