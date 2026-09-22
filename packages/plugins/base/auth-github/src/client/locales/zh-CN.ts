import type { MessageCatalog } from '@qualy/i18n-contract'

export default {
  'auth-github/entrance/kind': 'GitHub',
  'auth-github/field/client-id': 'Client ID',
  'auth-github/field/client-secret': 'Client Secret',
  'auth-github/field/enterprise-url': 'GitHub Enterprise Server 地址',
  'auth-github/field/enterprise-url-hint': '使用 github.com 时留空',
  'auth-github/error/rejected': 'GitHub 未能确认你的账号，请重试。',
  'auth-github/error/unavailable': '暂时无法连接 GitHub，请稍后再试。',
} satisfies MessageCatalog
