import { defaultLocale, localeOfAcceptLanguage, type SupportedLocale } from '@qualy/i18n-contract'

// Human-readable fallback for direct navigation. The application uses its
// own messages; it never parses these words to decide how to recover.
export type Notice = 'expired' | 'invalid' | 'missing' | 'unavailable' | 'not_found' | 'unsupported'

const NOTICES: Readonly<Record<Notice, Readonly<Record<SupportedLocale, string>>>> = {
  expired: { 'zh-CN': '下载链接已过期', 'en-US': 'This download link has expired.' },
  invalid: { 'zh-CN': '下载链接无效', 'en-US': 'This download link is invalid.' },
  missing: { 'zh-CN': '文件不存在', 'en-US': 'File not found.' },
  unavailable: { 'zh-CN': '下载失败，请稍后重试', 'en-US': 'Download failed. Try again later.' },
  not_found: { 'zh-CN': '页面无法访问', 'en-US': 'This address is unavailable.' },
  unsupported: { 'zh-CN': '无法完成下载', 'en-US': 'This download could not be completed.' },
}

export const refusalLocaleOf = (acceptLanguage: string | null): SupportedLocale =>
  localeOfAcceptLanguage(acceptLanguage ?? undefined) ?? defaultLocale

export const noticeText = (notice: Notice, locale: SupportedLocale): string =>
  NOTICES[notice][locale]
