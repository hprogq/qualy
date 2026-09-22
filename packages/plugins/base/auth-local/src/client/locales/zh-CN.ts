import type { MessageCatalog } from '@qualy/i18n-contract'

export default {
  'auth-local/binding/password': '密码',
  'auth-local/field/email': '邮箱',
  'auth-local/field/password': '密码',
  'auth-local/action/submit': '登录',
  'auth-local/action/submitting': '登录中…',
  'auth-local/action/forgot': '忘记密码？',
  'auth-local/error/invalid-credentials': '邮箱或密码错误。',
  // exact key coverage per locale is enforced by scripts/tests/catalogs.test
} satisfies MessageCatalog
