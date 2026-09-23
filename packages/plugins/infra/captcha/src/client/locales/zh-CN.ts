import type { MessageCatalog } from '@qualy/i18n-contract'

export default {
  'captcha/state/working': '正在进行安全验证',
  'captcha/state/failed': '安全验证未能完成',
  'captcha/action/retry': '重试',
  'captcha/dialog/title': '安全验证',
  'captcha/error/required': '请先完成安全验证',
} satisfies MessageCatalog
