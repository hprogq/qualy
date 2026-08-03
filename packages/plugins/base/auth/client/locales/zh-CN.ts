import type { CatalogFor } from '@qualy/i18n-contract'
import type { authMessages } from '../i18n.ts'

export default {
  'auth/login/title': 'Qualy 登录',
  'auth/login/methods-failed': '登录方式加载失败',
  'auth/login/methods-failed-hint': '请检查网络后重试。',
  'auth/login/no-methods': '当前没有可用的登录方式，请联系管理员。',
  'auth/login/other-methods': '← 其他登录方式',
  'auth/login/renderer-missing': '该登录方式暂不可用',
  'auth/action/sign-in': '登录',
  'auth/action/sign-out': '退出登录',
} satisfies CatalogFor<typeof authMessages>
