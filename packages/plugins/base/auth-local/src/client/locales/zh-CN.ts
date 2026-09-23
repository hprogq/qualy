import type { MessageCatalog } from '@qualy/i18n-contract'

export default {
  'auth-local/binding/password': '密码',
  'auth-local/entrance/kind': '邮箱密码',
  'auth-local/field/email': '邮箱',
  'auth-local/field/password': '密码',
  'auth-local/action/submit': '登录',
  'auth-local/action/submitting': '登录中…',
  'auth-local/action/wait': '{time} 后可重试',
  'auth-local/action/preparing-check': '正在准备安全验证…',
  'auth-local/action/checking': '正在进行安全验证…',
  'auth-local/action/forgot': '忘记密码？',
  'auth-local/error/invalid-credentials': '邮箱或密码错误。',
  'auth-local/action/show-password': '显示密码',
  'auth-local/action/hide-password': '隐藏密码',
  'auth-local/field/remember': '在此设备上记住邮箱',
  'auth-local/check/email': '请输入有效的邮箱地址',
  'auth-local/check/password-short': '密码至少 {min} 个字符',
  'auth-local/check/password-long': '密码最多 {max} 个字符',
  // exact key coverage per locale is enforced by scripts/tests/catalogs.test
} satisfies MessageCatalog
