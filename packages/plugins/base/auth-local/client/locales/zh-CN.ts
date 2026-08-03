import type { CatalogFor } from '@qualy/i18n-contract'
import type { localDeclaredMessages } from '../i18n.ts'

export default {
  'auth-local/field/identifier': '用户名',
  'auth-local/field/password': '密码',
  'auth-local/action/submit': '登录',
  'auth-local/action/submitting': '登录中…',
  'auth-local/error/invalid-credentials': '用户名或密码错误。',
} satisfies CatalogFor<typeof localDeclaredMessages>
