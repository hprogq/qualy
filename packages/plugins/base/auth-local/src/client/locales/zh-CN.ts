import type { MessageCatalog } from '@qualy/i18n-contract'

export default {
  'auth-local/binding/identifier': '登录名',
  'auth-local/binding/identifier-hint': '2 至 64 位，可用小写字母、数字、点、下划线和连字符，以字母或数字开头',
  'auth-local/binding/password': '密码',
  'auth-local/field/identifier': '用户名',
  'auth-local/field/password': '密码',
  'auth-local/action/submit': '登录',
  'auth-local/action/submitting': '登录中…',
  'auth-local/error/invalid-credentials': '用户名或密码错误。',
  // exact key coverage per locale is enforced by scripts/tests/catalogs.test
} satisfies MessageCatalog
